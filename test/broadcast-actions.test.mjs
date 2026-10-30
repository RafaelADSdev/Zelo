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

test('excluir do histórico exige confirmação, preserva envios e persiste sem reabrir a fila', async () => {
  const db = createClient({url:':memory:'}); let sent=0;
  const options={db,connection:()=> 'qr:a',send:async()=>{sent++;return {messageId:'kept'};},clock:()=>Date.parse('2026-10-30T15:00:00Z')};
  try {
    const service=await createBroadcasts(options);
    const input={requestId:randomUUID(),consent:true,phones:'5511988887777',text:'Olá',windowStart:'00:00',windowEnd:'00:00'};
    const campaign=await service.create(input);
    await assert.rejects(service.remove({id:campaign.id}),/Confirme/);
    await assert.rejects(service.remove({id:campaign.id,confirmed:true}),/concluídos ou cancelados/);
    await service.pause(campaign.id);
    await assert.rejects(service.remove({id:campaign.id,confirmed:true}),/concluídos ou cancelados/);
    await service.resume(campaign.id); await service.tick();
    assert.equal(sent,1);
    await service.remove({id:campaign.id,confirmed:true},'auditor');
    await service.remove({id:campaign.id,confirmed:true},'auditor');
    assert.equal((await service.list()).length,0);
    assert.equal((await service.get(campaign.id)).items[0].message_id,'kept');
    assert.equal((await db.execute('SELECT COUNT(*) n FROM wa_broadcast_attempts')).rows[0].n,1);
    assert.equal((await db.execute("SELECT COUNT(*) n FROM wa_broadcast_audit WHERE action='remove_history' AND actor='auditor'")).rows[0].n,1);
    await service.create(input); await service.tick(); assert.equal(sent,1);
    await assert.rejects(service.retryFailed({id:campaign.id,requestId:randomUUID()}),/excluído do histórico/);
    const restored=await createBroadcasts(options); assert.equal((await restored.list()).length,0);
    const other=await restored.create({...input,requestId:randomUUID()});
    await db.execute({sql:"UPDATE wa_broadcast_items SET state='sending' WHERE campaign=?",args:[other.id]});
    await restored.cancel(other.id);
    await assert.rejects(restored.remove({id:other.id,confirmed:true}),/em andamento/);
    assert.equal((await db.execute({sql:"SELECT COUNT(*) n FROM wa_broadcast_audit WHERE campaign=? AND action='remove_history'",args:[other.id]})).rows[0].n,0);
    await db.execute({sql:"UPDATE wa_broadcast_items SET state='unknown' WHERE campaign=?",args:[other.id]});
    await restored.remove({id:other.id,confirmed:true}); assert.equal((await restored.list()).length,0);
    await assert.rejects(restored.remove({id:'invalid',confirmed:true}),/Identificador/);
  } finally {db.close();}
});
