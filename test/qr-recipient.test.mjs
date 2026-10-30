import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { resolveQrRecipient } from '../lib/whatsapp/qr-recipient.mjs';
import { startTestServer, authenticatedFetch, testDirectory } from './helpers.mjs';
import { allowedPath } from '../deployment/routes.mjs';

test('consulta usa o destinatário confirmado, trata nono dígito e preserva LIDs recebidos', async () => {
  let queried;
  const socket = { async onWhatsApp(...jids) { queried = jids; return [{ exists: true, jid: '558171080053@s.whatsapp.net' }]; } };
  assert.equal(await resolveQrRecipient(socket, '5581971080053@s.whatsapp.net'), '558171080053@s.whatsapp.net');
  assert.deepEqual(queried, ['5581971080053@s.whatsapp.net', '558171080053@s.whatsapp.net']);
  const previous = queried;
  assert.equal(await resolveQrRecipient(socket, '279623946485862@lid'), '279623946485862@lid'); assert.equal(queried, previous);
  const exact = { onWhatsApp: async () => [{ exists: true, jid: '558171080053@s.whatsapp.net' }, { exists: true, jid: '5581971080053@s.whatsapp.net' }] };
  assert.equal(await resolveQrRecipient(exact, '5581971080053@s.whatsapp.net'), '5581971080053@s.whatsapp.net');
});

test('consulta não confunde erro de conexão com número ausente e rejeita resposta de outro destinatário', async () => {
  const jid = '5511988887777@s.whatsapp.net';
  await assert.rejects(resolveQrRecipient({ onWhatsApp: async () => [] }, jid), error => error.recipientNotFound === true && error.status === 400);
  for (const onWhatsApp of [async () => undefined, async () => [null], async () => { throw Error('timeout'); }, async () => [{ exists: true, jid: '5511977776666@s.whatsapp.net' }]]) {
    await assert.rejects(resolveQrRecipient({ onWhatsApp }, jid), error => error.status === 502 && !error.recipientNotFound);
  }
});

test('verificação não envia mensagens; envio QR corrige o destinatário e bloqueia números ausentes', async () => {
  let socket; const sent = [];
  const app = await startTestServer({ port: 0, dataDir: await testDirectory(), qrSocketFactory: () => (socket = {
    ev: new EventEmitter(), user: { id: '558171080053@s.whatsapp.net' }, end() {},
    async onWhatsApp(...jids) {
      if (jids[0].startsWith('5511977776666')) throw Error('offline');
      return jids[0].startsWith('5581') ? [{ exists: true, jid: '558171080053@s.whatsapp.net' }] : [];
    },
    async sendMessage(jid, content, options) { sent.push({ jid, content }); return { key: { id: options.messageId } }; },
  }) });
  try {
    await app.settings.update({ whatsappMode: 'qr' }); await app.qr.connect(); socket.ev.emit('connection.update', { connection: 'open' }); await app.qr.idle();
    const response = await authenticatedFetch(app.url + '/api/whatsapp/check-numbers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phones: ['5581971080053','5511988887777','5511977776666'] }) });
    assert.equal(response.status, 200); const { numbers } = await response.json();
    assert.deepEqual(numbers.map(item => item.exists), [true, false, null]); assert.equal(numbers[0].whatsappPhone, '558171080053'); assert.equal(sent.length, 0);
    assert.equal((await app.qr.conversations()).length, 0);
    assert.equal(allowedPath('/api/whatsapp/check-numbers'), true); assert.equal(allowedPath('/broadcast-number-check.js'), true);
    assert.equal((await fetch(app.url + '/api/whatsapp/check-numbers', { method: 'POST' })).status, 401);
    assert.equal((await authenticatedFetch(app.url + '/api/whatsapp/check-numbers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null' })).status, 400);
    await assert.rejects(app.qr.checkNumbers(Array(6).fill('5511988887777')), /1 a 5/);
    await assert.rejects(app.qr.manual({ phone: '5511988887777', text: 'Não enviar', requestId: randomUUID() }), /não encontrado/);
    assert.equal((await app.runtime.client.execute('SELECT COUNT(*) AS count FROM qr_outbox')).rows[0].count, 0);
    await app.qr.manual({ phone: '5581971080053', text: 'Envio validado', requestId: randomUUID() });
    assert.equal(sent.length, 1); assert.equal(sent[0].jid, '558171080053@s.whatsapp.net');
  } finally { await app.close(); }
});

test('confirmações recebidas durante o envio persistem e recusas não viram envio aceito', async () => {
  let socket, app, status = 3;
  app = await startTestServer({ port: 0, dataDir: await testDirectory(), qrSocketFactory: () => (socket = {
    ev: new EventEmitter(), user: { id: '5511999999999@s.whatsapp.net' }, end() {},
    async onWhatsApp(jid) { return [{ exists: true, jid }]; },
    async sendMessage(jid, content, options) {
      socket.ev.emit('messages.update', [{ key: { id: options.messageId, fromMe: true, remoteJid: jid }, update: { status } }]);
      await app.qr.idle(); return { key: { id: options.messageId } };
    },
  }) });
  try {
    await app.settings.update({ whatsappMode: 'qr' }); await app.qr.connect(); socket.ev.emit('connection.update', { connection: 'open' }); await app.qr.idle();
    const phone = '5511988887777';
    await app.qr.manual({ phone, text: 'Entrega rápida', requestId: randomUUID() });
    assert.equal((await app.qr.history(phone)).outbound[0].state, 'delivered');
    status = 0;
    await assert.rejects(app.qr.manual({ phone, text: 'Recusa rápida', requestId: randomUUID() }), /recusou/);
    const states = (await app.qr.history(phone)).outbound.map(item => item.state); assert.deepEqual(states, ['delivered','failed']);
  } finally { await app.close(); }
});
