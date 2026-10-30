import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { createBroadcasts } from '../lib/whatsapp/broadcasts.mjs';
test('resolução auditada é idempotente, falhas nunca incluem incertos e cada tentativa tem chave estável', async () => {
  const db = createClient({ url: ':memory:' }); let now = Date.parse('2026-10-30T15:00:00Z'), calls = 0; const keys = [];
  const options = { db, connection: () => 'qr:a', clock: () => now, selfPhone: () => '5511999999999', send: async input => { keys.push(input.requestId); calls++; if (calls === 1) throw Object.assign(new Error('Incerto'), { status: 504 }); if (calls === 2) throw Object.assign(new Error('Recusado'), { status: 502 }); return { messageId: 'ok' }; } };
  try {
    const service = await createBroadcasts(options);
    const campaign = await service.create({ requestId: randomUUID(), consent: true, phones: '5511988887777\n5511977776666', text: 'Olá' });
    await service.tick(); now += 30000; await service.tick();
    const retry = { id: campaign.id, requestId: randomUUID() };
    await service.retryFailed(retry, 'usuario'); await service.retryFailed(retry, 'usuario');
    assert.equal((await service.get(campaign.id)).items[0].state, 'unknown');
    now += 30000; await service.tick();
    const decision = { id: campaign.id, itemId: campaign.items[0].id, decision: 'retry', confirmed: true, requestId: randomUUID() };
    await assert.rejects(service.resolve({ ...decision, confirmed: false }), /explicitamente/);
    await service.resolve(decision, 'usuario'); await service.resolve(decision, 'usuario');
    now += 30000; await service.tick(); assert.equal(calls, 4); assert.equal(new Set(keys).size, 4);
    await service.resolve(decision, 'usuario'); now += 30000; await service.tick(); assert.equal(calls, 4);
    assert.equal((await db.execute("SELECT COUNT(*) AS n FROM wa_broadcast_audit WHERE actor='usuario'")).rows[0].n, 2);
    const copy = await service.duplicate(campaign.id); assert.equal(copy.consent, false); assert.equal(copy.recipients.length, 2);
    assert.equal((await service.list()).length, 1);
    const own = await service.test({ ...copy, requestId: randomUUID(), confirmed: true }, 'usuario'); assert.equal(own.items.length, 1); assert.equal(own.items[0].phone, '5511999999999');
    assert.equal(own.consent_by, 'usuario');
  } finally { db.close(); }
});
test('confirmação manual de entrega é auditada e não gera envio', async () => {
  const db = createClient({ url: ':memory:' });
  try {
    const service = await createBroadcasts({ db, connection: () => 'qr:a', clock: () => Date.parse('2026-10-30T15:00:00Z'), send: async () => { throw Object.assign(new Error('Incerto'), { status: 504 }); } });
    const campaign = await service.create({ requestId: randomUUID(), consent: true, phones: '5511988887777', text: 'Olá' }); await service.tick();
    const input = { id: campaign.id, itemId: campaign.items[0].id, decision: 'delivered', confirmed: true, requestId: randomUUID() };
    await service.resolve(input, 'auditor'); await service.resolve(input, 'auditor');
    const item = (await service.get(campaign.id)).items[0]; assert.equal(item.state, 'sent'); assert.equal(item.resolved_by, 'auditor');
    assert.equal((await db.execute('SELECT COUNT(*) n FROM wa_broadcast_audit')).rows[0].n, 1);
  } finally { db.close(); }
});
