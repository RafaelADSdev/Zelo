import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { createBroadcasts } from '../lib/whatsapp/broadcasts.mjs';
import { startTestServer, authenticatedFetch, testDirectory } from './helpers.mjs';
import { EventEmitter } from 'node:events';
import { allowedPath } from '../deployment/routes.mjs';

test('disparos validam, deduplicam, persistem e não repetem resultados incertos', async () => {
  const db = createClient({ url: 'file::memory:' });
  let account = 'qr:account-a', now = 10000, uncertain = false;
  const sent = [];
  const options = { db, connection: () => account, clock: () => now, send: async input => {
    sent.push(input);
    if (uncertain) throw Object.assign(new Error('Sem confirmação'), { status: 504 });
    return { status: 'sent', messageId: 'm1' };
  } };
  let broadcasts = await createBroadcasts(options);
  const input = { requestId: randomUUID(), phones: '+55 (11) 98888-7777\n5511988887777\n5511977776666', text: 'Olá' };
  try {
    await assert.rejects(broadcasts.create({ ...input, phones: 'número inválido' }), /número/i);
    const campaign = await broadcasts.create(input);
    assert.equal(campaign.items.length, 2);
    assert.equal((await broadcasts.create(input)).id, campaign.id);
    await assert.rejects(broadcasts.create({ ...input, text: 'Mudou' }), /identificador/i);
    await broadcasts.tick(); assert.equal(sent.length, 1);
    await broadcasts.tick(); assert.equal(sent.length, 1);
    account = 'qr:account-b'; now += 3000;
    await broadcasts.tick(); assert.equal(sent.length, 1);
    account = 'qr:account-a'; uncertain = true;
    await broadcasts.tick(); assert.equal(sent.length, 2);
    broadcasts = await createBroadcasts(options);
    now += 3000; await broadcasts.tick(); assert.equal(sent.length, 2);
    const result = await broadcasts.get(campaign.id);
    assert.deepEqual(result.items.map(item => item.state), ['sent', 'unknown']);
    assert.equal(result.state, 'completed');
    const second = await broadcasts.create({ ...input, requestId: randomUUID() });
    await broadcasts.cancel(second.id); now += 3000; await broadcasts.tick();
    assert.equal(sent.length, 2);
    assert.ok((await broadcasts.get(second.id)).items.every(item => item.state === 'cancelled'));
  } finally { db.close(); }
});

test('agendamento aguarda o horário e retoma pendentes após reinício sem repetir envio interrompido', async () => {
  const db = createClient({ url: 'file::memory:' });
  let now = Date.now(), sends = 0;
  const options = { db, connection: () => 'cloud:123', clock: () => now, send: async () => { sends++; return { messageId: 'test' }; } };
  try {
    let service = await createBroadcasts(options);
    const input = { requestId: randomUUID(), phones: '5511999999999\n5521999999999', template: { name: 'hello_world', language: { code: 'pt_BR' } }, scheduledAt: new Date(now + 60000).toISOString() };
    const campaign = await service.create(input);
    await service.tick(); assert.equal(sends, 0);
    await assert.rejects(service.create({ ...input, requestId: randomUUID(), scheduledAt: 'inválido' }), /data/i);
    await db.execute({ sql: "UPDATE wa_broadcast_items SET state='sending' WHERE id=?", args: [campaign.items[0].id] });
    service = await createBroadcasts(options);
    now += 60001;
    assert.equal((await service.create(input)).id, input.requestId);
    await service.tick(); assert.equal(sends, 1);
    assert.deepEqual((await service.get(campaign.id)).items.map(item => item.state), ['unknown', 'sent']);
  } finally { db.close(); }
});

test('API autenticada cria, agenda, cancela e envia pelo transporte QR existente', async () => {
  const sent = [], sockets = [];
  const app = await startTestServer({ port: 0, dataDir: await testDirectory(), qrSocketFactory: () => {
    const socket = { ev: new EventEmitter(), user: { id: '5511999999999:1@s.whatsapp.net' }, end() {}, async sendMessage(jid, content) { sent.push({ jid, content }); return { key: { id: 'test-broadcast' } }; } };
    sockets.push(socket); return socket;
  } });
  const post = async (path, body) => authenticatedFetch(app.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(app.url + '/api/broadcasts')).status, 401);
    // A missing imported module stops the entire panel before navigation/catalog initialize.
    const pending = ['/app.js'], visited = new Set();
    while (pending.length) {
      const path = pending.pop(); if (visited.has(path)) continue; visited.add(path);
      const asset = await authenticatedFetch(app.url + path);
      assert.equal(asset.status, 200, `Módulo obrigatório indisponível: ${path}`);
      assert.match(asset.headers.get('content-type'), /javascript/);
      const source = await asset.text();
      for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*)["'](\/[^"']+\.js)["']/g)) pending.push(match[1]);
    }
    assert.ok(allowedPath('/api/broadcasts')); assert.ok(allowedPath('/api/broadcasts/cancel')); assert.ok(allowedPath('/broadcasts.js'));
    await app.settings.update({ whatsappMode: 'qr' }); await app.qr.connect();
    sockets[0].ev.emit('connection.update', { connection: 'open' }); await app.qr.idle();
    const input = { requestId: randomUUID(), phones: '5511888888888', text: 'Mensagem de campanha' };
    assert.equal((await post('/api/broadcasts', input)).status, 201);
    assert.equal((await post('/api/broadcasts', input)).status, 201);
    const scheduled = { ...input, requestId: randomUUID(), scheduledAt: new Date(Date.now() + 3600000).toISOString() };
    assert.equal((await post('/api/broadcasts', scheduled)).status, 201);
    const until = Date.now() + 6000;
    while (!sent.length && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(sent.length, 1); assert.equal(sent[0].content.text, input.text);
    assert.equal((await post('/api/broadcasts/cancel', { id: scheduled.requestId })).status, 200);
    const { campaigns } = await (await authenticatedFetch(app.url + '/api/broadcasts')).json();
    assert.equal(campaigns.length, 2);
    assert.equal(campaigns.find(item => item.id === scheduled.requestId).state, 'cancelled');
    assert.equal((await app.qr.history('5511888888888')).outbound.at(-1).text, input.text);
  } finally { await app.close(); }
});

test('Cloud API envia template e mantém bloqueio de texto fora da janela', async () => {
  const posts = [];
  const app = await startTestServer({ port: 0, dataDir: await testDirectory(), metaFetch: async (_url, options) => {
    posts.push(JSON.parse(options.body)); return Response.json({ messages: [{ id: 'template-test' }] });
  } });
  try {
    await app.settings.update({ whatsappMode: 'cloud', accessToken: 'test-token', appSecret: 'test-secret', phoneNumberId: '123456789' });
    const service = await createBroadcasts({ db: app.runtime.client, connection: () => 'cloud:123456789', send: input => app.whatsapp.manual(input) });
    const template = await service.create({ requestId: randomUUID(), phones: '5511888888888', template: { name: 'hello_world', language: { code: 'pt_BR' } } });
    await service.tick();
    assert.equal(posts.length, 1); assert.equal(posts[0].template.name, 'hello_world');
    assert.equal((await service.get(template.id)).items[0].state, 'sent');
    const text = await service.create({ requestId: randomUUID(), phones: '5511777777777', text: 'Fora da janela' });
    await service.tick();
    assert.equal(posts.length, 1);
    assert.equal((await service.get(text.id)).items[0].state, 'failed');
    assert.match((await service.get(text.id)).items[0].error, /24 horas/);
  } finally { await app.close(); }
});

test('pausar preserva pendentes, retomar continua uma vez e cancelar também funciona pausado', async () => {
  const db = createClient({ url: 'file::memory:' }); let now = Date.now(), sent = 0;
  const service = await createBroadcasts({ db, connection: () => 'qr:abc', clock: () => now, send: async () => { sent++; return { messageId: 'test' }; } });
  try {
    const input = { requestId: randomUUID(), name: 'Campanha de novembro', phones: '5511988887777\n5511977776666', text: 'Olá' };
    const campaign = await service.create(input); assert.equal(campaign.name, input.name);
    await service.tick(); assert.equal(sent, 1);
    await service.pause(campaign.id); now += 4000; await service.tick(); assert.equal(sent, 1);
    assert.equal((await service.get(campaign.id)).state, 'paused');
    await service.resume(campaign.id); await service.tick(); assert.equal(sent, 2);
    const other = await service.create({ ...input, requestId: randomUUID() });
    await service.pause(other.id); await service.cancel(other.id);
    assert.equal((await service.get(other.id)).state, 'cancelled');
    await assert.rejects(service.resume(other.id), /pausado/);
    await assert.rejects(service.create({ ...input, requestId: randomUUID(), name: 'x'.repeat(101) }), /nome/i);
  } finally { db.close(); }
});
