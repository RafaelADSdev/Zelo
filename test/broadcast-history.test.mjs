import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { createBroadcasts } from '../lib/whatsapp/broadcasts.mjs';
test('histórico agrega em uma consulta e lê entrega QR/Cloud com páginas limitadas', async () => {
  const db = createClient({ url: ':memory:' }); let now = Date.parse('2026-10-30T15:00:00Z'), sequence = 0;
  await db.executeMultiple('CREATE TABLE wa_statuses(id TEXT PRIMARY KEY,status TEXT); CREATE TABLE qr_outbox(id TEXT PRIMARY KEY,account TEXT,state TEXT)');
  try {
    const service = await createBroadcasts({ db, connection: () => 'qr:a', clock: () => now, send: async input => { await db.execute({ sql: 'INSERT INTO qr_outbox VALUES(?,?,?)', args: ['broadcast:' + input.requestId, 'a', ++sequence === 1 ? 'read' : 'delivered'] }); return { messageId: 'm' + sequence }; } });
    const campaign = await service.create({ requestId: randomUUID(), consent: true, phones: '5511988887777\n5511977776666', text: 'Olá' });
    await service.tick(); now += 30000; await service.tick();
    const list = await service.list(); assert.equal(list[0].total, 2); assert.equal(list[0].counts.sent, 2); assert.equal(list[0].delivered, 2); assert.equal(list[0].read, 1); assert.equal('items' in list[0], false);
    const first = await service.details(campaign.id, { limit: 1, page: 1 }), second = await service.details(campaign.id, { limit: 1, page: 2 });
    assert.equal(first.items[0].delivery_status, 'read'); assert.notEqual(first.items[0].id, second.items[0].id);
    await db.execute({ sql: "UPDATE wa_broadcast_items SET state='unknown' WHERE id=?", args: [first.items[0].id] });
    await assert.rejects(service.resolve({ id: campaign.id, itemId: first.items[0].id, requestId: randomUUID(), decision: 'retry', confirmed: true }), /já confirmou a entrega/);
    await assert.rejects(service.details(campaign.id, { limit: 101 }), /Paginação/);
    const cloud = await createBroadcasts({ db, connection: () => 'cloud:123', clock: () => now, send: async () => { await db.execute("INSERT INTO wa_statuses VALUES('cloud-id','read')"); return { messageId: 'cloud-id' }; } });
    const other = await cloud.create({ requestId: randomUUID(), consent: true, phones: '5511988887777', template: { name: 'hello', language: { code: 'pt_BR' } } }); await cloud.tick();
    assert.equal((await cloud.details(other.id)).items[0].delivery_status, 'read');
  } finally { db.close(); }
});
test('migração idempotente preserva banco legado e pausa fila sem consentimento', async () => {
  const db = createClient({ url: ':memory:' }), id = randomUUID(), item = randomUUID(); let calls = 0;
  try {
    await db.executeMultiple('CREATE TABLE wa_broadcasts(id TEXT PRIMARY KEY,account TEXT,hash TEXT,payload TEXT,state TEXT,scheduled INTEGER,next_at INTEGER,created INTEGER); CREATE TABLE wa_broadcast_items(id TEXT PRIMARY KEY,campaign TEXT,phone TEXT,state TEXT,error TEXT,message_id TEXT)');
    await db.execute({ sql: "INSERT INTO wa_broadcasts VALUES(?,'qr:a','old','{\"text\":\"Olá\"}','queued',0,0,0)", args: [id] });
    await db.execute({ sql: "INSERT INTO wa_broadcast_items VALUES(?,?,'5511988887777','sending',NULL,NULL)", args: [item,id] });
    const options = { db, connection: () => 'qr:a', send: async () => { calls++; return {}; } };
    await createBroadcasts(options); const service = await createBroadcasts(options);
    const campaign = await service.get(id); assert.equal(campaign.state, 'paused'); assert.equal(campaign.items[0].state, 'unknown'); assert.equal(campaign.items[0].vars, '{}');
    await service.tick(); assert.equal(calls, 0); await assert.rejects(service.resume(id), /consentimento/);
    assert.equal((await service.duplicate(id)).consent, false);
  } finally { db.close(); }
});
