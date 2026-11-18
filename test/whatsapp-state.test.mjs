import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createClient } from '@libsql/client';
import { createWhatsApp } from '../lib/whatsapp/whatsapp.mjs';
import { createWhatsAppQr } from '../lib/whatsapp/whatsapp-qr.mjs';

const now = Date.parse('2026-11-04T18:00:00Z');
const phone = '5511988887777';
const firstAccount = '100000001';
const nextAccount = '100000002';
const template = { name: 'exemplo', language: { code: 'pt_BR' } };

function cloudFixture(options = {}) {
  const db = createClient({ url: ':memory:' });
  const config = { whatsappMode: 'cloud', phoneNumberId: firstAccount, appSecret: 'fake-webhook-secret',
    accessToken: 'fake-meta-token', graphVersion: 'v23.0', autoReply: false };
  const settings = { get: () => ({ ...config }), mark: async patch => Object.assign(config, patch) };
  const turns = [];
  const runtime = { client: db, memory: { append: async turn => { turns.push(turn); } }, whatsapp: options.reply };
  const start = () => createWhatsApp({ runtime, settings, clock: () => now, assertActive: options.assertActive,
    fetchImpl: options.fetchImpl || (async () => assert.fail('A fixture não pode consultar a Meta.')) });
  async function receive(service, id, name = 'Contato') {
    const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: config.phoneNumberId }, contacts: [{ wa_id: phone, profile: { name } }],
      messages: [{ id, from: phone, type: 'text', text: { body: 'Olá' }, timestamp: String(now / 1000) }],
    } }] }] }));
    return service.accept(body, 'sha256=' + createHmac('sha256', config.appSecret).update(body).digest('hex'));
  }
  return { db, config, turns, start, receive };
}

test('migração Cloud mantém contato legado e separa nome e janela de dois números da Meta', async () => {
  const { db, config, start, receive } = cloudFixture();
  let service;
  try {
    await db.executeMultiple(`
      CREATE TABLE turns(id TEXT PRIMARY KEY,contactId TEXT,role TEXT,text TEXT,timestamp INTEGER);
      CREATE TABLE wa_contacts(phone TEXT PRIMARY KEY,account_id TEXT NOT NULL,name TEXT,last_inbound INTEGER NOT NULL);
    `);
    await db.execute({ sql: 'INSERT INTO wa_contacts VALUES(?,?,?,?)', args: [phone, firstAccount, 'Nome salvo', now - 90000] });
    service = await start();
    assert.equal((await service.conversations())[0].name, 'Nome salvo');
    config.phoneNumberId = nextAccount;
    await receive(service, 'nova-conta', 'Perfil da segunda conta');
    await service.idle();
    assert.equal((await service.conversations())[0].last_inbound, now);
    assert.equal((await service.conversations())[0].name, 'Perfil da segunda conta');
    await service.close();
    service = undefined;
    config.phoneNumberId = firstAccount;
    service = await start();
    assert.deepEqual((await service.conversations()).map(item => [item.name, item.last_inbound]), [['Nome salvo', now - 90000]]);
  } finally { await service?.close(); db.close(); }
});

test('resposta automática Cloud não troca de conta quando a configuração muda durante a geração', async () => {
  const hold = Promise.withResolvers(), started = Promise.withResolvers();
  const requests = [];
  const { db, config, start, receive } = cloudFixture({
    async reply(_message, send) { started.resolve(); await hold.promise; return send(phone, { text: 'Resposta gerada' }); },
    async fetchImpl(url) { requests.push(url); return Response.json({ messages: [{ id: 'fake-result' }] }); },
  });
  let service;
  try {
    service = await start();
    config.autoReply = true;
    await db.execute({ sql: 'INSERT INTO wa_contacts VALUES(?,?,?,?)', args: [phone, nextAccount, 'Outro contato', now - 1000] });
    await receive(service, 'mensagem-da-conta-original');
    await started.promise;
    config.phoneNumberId = nextAccount;
    hold.resolve();
    await service.idle();
    assert.deepEqual(requests, []);
    assert.match((await service.status()).jobs[0].error, /conexão original mudou/i);
  } finally { hold.resolve(); await service?.close(); db.close(); }
});

test('envio manual Cloud registra o envio no número usado mesmo se a configuração mudar durante a chamada', async () => {
  const response = Promise.withResolvers(), started = Promise.withResolvers();
  const { db, config, turns, start } = cloudFixture({ fetchImpl: async url => { started.resolve(url); return response.promise; } });
  let service;
  try {
    service = await start();
    const sending = service.manual({ phone, template, requestId: randomUUID() });
    assert.match(await started.promise, new RegExp(`/${firstAccount}/messages$`));
    config.phoneNumberId = nextAccount;
    response.resolve(Response.json({ messages: [{ id: 'fake-result' }] }));
    assert.equal((await sending).messageId, 'fake-result');
    assert.deepEqual(turns.map(turn => turn.contactId), [`whatsapp:${firstAccount}:${phone}`]);
    assert.deepEqual((await db.execute('SELECT account_id FROM wa_contacts')).rows.map(row => row.account_id), [firstAccount]);
  } finally { response.resolve(Response.json({})); await service?.close(); db.close(); }
});

test('Cloud devolve a tentativa ao estado pendente se perder a posse antes do POST', async () => {
  let active = true, requests = 0;
  const { db, start } = cloudFixture({
    assertActive() { if (!active) throw Object.assign(new Error('Posse expirada'), { leaseLost: true, status: 503 }); },
    async fetchImpl() { requests++; return Response.json({ messages: [{ id: 'fake-result' }] }); },
  });
  const execute = db.execute.bind(db);
  db.execute = async query => {
    const result = await execute(query);
    if (query?.sql?.startsWith("UPDATE wa_outbox SET state='sending'")) active = false;
    return result;
  };
  let service;
  try {
    service = await start();
    await assert.rejects(service.manual({ phone, template, requestId: randomUUID() }), error => error.leaseLost === true);
    assert.equal(requests, 0);
    assert.deepEqual((await db.execute('SELECT state FROM wa_outbox')).rows.map(row => row.state), ['pending']);
  } finally { await service?.close(); db.close(); }
});

test('QR mostra os 200 comprovantes mais recentes em ordem cronológica', async () => {
  const db = createClient({ url: ':memory:' });
  const account = '5511999999999@s.whatsapp.net', jid = `${phone}@s.whatsapp.net`;
  const settings = { get: () => ({ whatsappMode: 'qr', qrAccount: account }), mark: async () => {} };
  const service = await createWhatsAppQr({ settings, runtime: { client: db, state: async () => ({ history: [] }) } });
  try {
    await db.batch(Array.from({ length: 201 }, (_, n) => ({
      sql: "INSERT INTO qr_outbox(id,account,jid,text,hash,state,created) VALUES(?,?,?,?,?,'read',?)",
      args: [`send-${n}`, account, jid, 'Exemplo', 'hash', now],
    })), 'write');
    assert.deepEqual((await service.history(jid)).outbound.map(item => item.id), Array.from({ length: 200 }, (_, i) => `send-${i + 1}`));
  } finally { await service.close(); db.close(); }
});

test('QR não abre uma sessão nem envia após perder a posse do worker', async () => {
  const db = createClient({ url: ':memory:' });
  const config = { whatsappMode: 'qr' };
  const settings = { get: () => ({ ...config }), mark: async patch => Object.assign(config, patch) };
  let active = false, sockets = 0, sends = 0;
  const assertActive = () => { if (!active) throw Object.assign(new Error('Posse expirada'), { leaseLost: true, status: 503 }); };
  const socket = { ev: new EventEmitter(), user: { id: '5511999999999@s.whatsapp.net' }, end() {},
    async onWhatsApp(jid) { active = false; return [{ jid, exists: true }]; },
    async sendMessage() { sends++; return { key: { id: 'simulado' } }; } };
  const service = await createWhatsAppQr({ settings, assertActive, runtime: { client: db }, socketFactory: () => { sockets++; return socket; } });
  try {
    await assert.rejects(service.connect(), error => error.leaseLost === true);
    assert.equal(sockets, 0);
    active = true;
    await service.connect();
    socket.ev.emit('connection.update', { connection: 'open' });
    await service.idle();
    await assert.rejects(service.manual({ phone, text: 'Exemplo', requestId: randomUUID() }), error => error.leaseLost === true);
    assert.equal(sends, 0);
    assert.deepEqual((await db.execute('SELECT state FROM qr_outbox')).rows, []);
  } finally { await service.close(); db.close(); }
});
