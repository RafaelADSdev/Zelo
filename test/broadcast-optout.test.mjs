import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { randomUUID, createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createBroadcasts } from '../lib/whatsapp/broadcasts.mjs';
import { createOptouts, isOptout } from '../lib/whatsapp/optouts.mjs';
import { createWhatsApp } from '../lib/whatsapp/whatsapp.mjs';
import { createWhatsAppQr } from '../lib/whatsapp/whatsapp-qr.mjs';

test('supressão isolada por conta, consentimento e exclusão antes e durante o disparo', async () => {
  const db = createClient({ url: ':memory:' }); let sent = 0;
  try {
    const optouts = await createOptouts(db);
    const service = await createBroadcasts({ db, connection: () => 'qr:a', send: async () => { sent++; return { messageId: 'ok' }; } });
    const input = { requestId: randomUUID(), phones: '5511988887777\n5511977776666', text: 'Olá' };
    await assert.rejects(service.create(input), /aceitaram/);
    await optouts.set('qr:a', ['5511988887777']);
    assert.equal(await optouts.blocked('qr:b', '5511988887777'), false);
    const campaign = await service.create({ ...input, consent: true }, 'usuario-teste');
    assert.equal(campaign.suppressed, 1); assert.equal(campaign.consent_by, 'usuario-teste');
    await optouts.set('qr:a', ['5511977776666']); await service.tick();
    assert.equal(sent, 0); assert.equal((await service.get(campaign.id)).items[0].state, 'skipped');
    assert.ok(['SAIR', ' parar ', 'NÃO QUERO RECEBER!', 'cancelar', 'stop'].every(isOptout));
    assert.equal(isOptout('quero cancelar meu pedido'), false);
  } finally { db.close(); }
});
for (const mode of ['qr', 'cloud']) test(`descadastro ${mode}: persiste, confirma uma vez e não aciona a IA`, async () => {
  const db = createClient({ url: ':memory:' }); let socket, calls = 0, sent = 0; const memory = [];
  const config = { whatsappMode: mode, autoReply: true, accessToken: 'test-token', appSecret: 'test-secret', phoneNumberId: '123456789', graphVersion: 'v23.0' };
  const settings = { get: () => ({ ...config }), mark: async value => Object.assign(config, value) };
  const runtime = { client: db, memory: { append: async item => memory.push(item) }, whatsapp: async () => { calls++; }, state: async () => ({ history: [] }) };
  const service = mode === 'qr' ? await createWhatsAppQr({ runtime, settings, socketFactory: () => (socket = { ev: new EventEmitter(), user: { id: '5511999999999@s.whatsapp.net' }, end() {}, async sendMessage() { sent++; return { key: { id: 'ack' } }; } }) }) : await createWhatsApp({ runtime, settings, fetchImpl: async () => { sent++; return Response.json({ messages: [{ id: 'ack' }] }); } });
  const phone = '5511988887777';
  try {
    if (mode === 'qr') { await service.connect(); socket.ev.emit('connection.update', { connection: 'open' }); await service.idle(); }
    const receive = async () => {
      if (mode === 'qr') { socket.ev.emit('messages.upsert', { type: 'notify', messages: [{ key: { id: 'optout-message', remoteJid: `${phone}@s.whatsapp.net` }, message: { conversation: 'Não quero receber' }, messageTimestamp: Math.floor(Date.now() / 1000) }] }); await service.idle(); }
      else { const raw = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: config.phoneNumberId }, messages: [{ id: 'optout-message', from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'SAIR' } }] } }] }] })); await service.accept(raw, 'sha256=' + createHmac('sha256', config.appSecret).update(raw).digest('hex')); await service.idle(); }
    };
    await receive(); await receive();
    const account = mode === 'qr' ? 'qr:5511999999999@s.whatsapp.net' : 'cloud:123456789';
    const store = await createOptouts(db); assert.equal(await store.blocked(account, phone), true);
    assert.equal(calls, 0); assert.equal(sent, 1);
    await assert.rejects(service.manual({ phone, text: 'Campanha', broadcast: true, requestId: randomUUID() }), /suprimido/);
    assert.equal(sent, 1);
    await store.set(account, [phone], true); await receive(); assert.equal(await store.blocked(account, phone), false);
    if (mode === 'qr') { await service.manual({ phone, text: 'Mensagem do operador', requestId: randomUUID() }); assert.equal(memory.at(-1).role, 'agent'); assert.equal(memory.at(-1).text, 'Mensagem do operador'); }
  } finally { await service.close(); db.close(); }
});
