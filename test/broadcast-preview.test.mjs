import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { createBroadcasts } from '../lib/whatsapp/broadcasts.mjs';
import { normalizeBroadcastPhone } from '../lib/whatsapp/broadcast-preview.mjs';
import { createOptouts } from '../lib/whatsapp/optouts.mjs';
test('preview normaliza BR, classifica 24h e cria somente dentro da janela com escolha explícita', async () => {
  const db = createClient({ url: ':memory:' }); let now = Date.parse('2026-10-30T15:00:00Z'), sent = 0;
  try {
    await db.execute('CREATE TABLE wa_contacts(phone TEXT,account_id TEXT NOT NULL,name TEXT,last_inbound INTEGER NOT NULL,PRIMARY KEY(account_id,phone))');
    await db.execute({ sql: "INSERT INTO wa_contacts VALUES('551188887777','123','Ana',?)", args: [now - 1000] });
    const service = await createBroadcasts({ db, connection: () => 'cloud:123', clock: () => now, send: async () => { sent++; return {}; } });
    const input = { requestId: randomUUID(), consent: true, phones: '(11) 8888-7777\n5511988887777\n5511977776666\ninválido', country: '55', text: 'Olá' };
    const preview = await service.preview(input);
    assert.equal(preview.canText, 1); assert.equal(preview.outsideWindow, 1); assert.equal(preview.duplicates, 1); assert.equal(preview.invalid[0].row, 4);
    assert.equal(preview.ready, false); await assert.rejects(service.create(input), /24 horas/);
    const campaign = await service.create({ ...input, windowOnly: true }); assert.equal(campaign.items.length, 1);
    now += 86400000; await service.tick(); assert.equal(sent, 0);
    assert.equal((await service.get(campaign.id)).items[0].state, 'skipped');
    assert.equal(normalizeBroadcastPhone('(11) 8888-7777', '55'), '5511988887777');
    assert.equal(normalizeBroadcastPhone('551132345678'), '551132345678');
    assert.equal(normalizeBroadcastPhone('5500988887777'), null);
    assert.equal(normalizeBroadcastPhone('+1 202 555 0123'), '12025550123');
  } finally { db.close(); }
});

test('prévia lê a supressão de 500 contatos de uma vez e preserva aliases e bloqueio por LID', async () => {
  const db = createClient({ url: ':memory:' });
  let suppressionReads = 0;
  const tracked = {
    execute(query) {
      if (query?.sql?.includes('SELECT') && query.sql.includes('FROM wa_optouts')) suppressionReads++;
      return db.execute(query);
    },
    executeMultiple: sql => db.executeMultiple(sql),
    batch: (...args) => db.batch(...args),
  };
  try {
    const service = await createBroadcasts({ db: tracked, connection: () => 'qr:a', send: async () => assert.fail('Prévia não envia mensagens') });
    const optouts = await createOptouts(db);
    const recipients = Array.from({ length: 500 }, (_, i) => ({ phone: String(5511988000000 + i) }));
    await optouts.set('qr:a', ['551188000000']);
    await optouts.set('qr:b', [recipients[1].phone]);
    const first = await service.preview({ recipients, text: 'Exemplo' });
    assert.equal(suppressionReads, 1);
    assert.deepEqual(first.suppressed.map(item => item.phone), [recipients[0].phone]);
    assert.equal(first.recipients.length, 499);
    await optouts.receive('qr:a', '123456789@lid', 'pedido-de-teste');
    const second = await service.preview({ recipients, text: 'Exemplo' });
    assert.equal(suppressionReads, 2);
    assert.equal(second.suppressed.length, 500);
    assert.equal(second.ready, false);
  } finally { db.close(); }
});
test('personalização valida todos os contatos, usa fallback e resolve componentes por destinatário', async () => {
  const db = createClient({ url: ':memory:' }); const sent = []; let now = Date.parse('2026-10-30T15:00:00Z');
  try {
    const service = await createBroadcasts({ db, connection: () => 'qr:a', clock: () => now, send: async input => { sent.push(input); return {}; } });
    const input = { requestId: randomUUID(), consent: true, recipients: [{ phone: '5511988887777', name: 'Ana', vars: { cidade: 'São Paulo' } }, { phone: '5511977776666', vars: { cidade: 'Rio' } }], text: 'Olá {nome|cliente} de {cidade}.' };
    const preview = await service.preview(input); assert.equal(preview.errors.length, 0); assert.equal(preview.recipients[0].preview.text, 'Olá Ana de São Paulo.');
    await service.create(input); await service.tick(); now += 30000; await service.tick();
    assert.deepEqual(sent.map(item => item.text), ['Olá Ana de São Paulo.', 'Olá cliente de Rio.']);
    const bad = { ...input, requestId: randomUUID(), text: '{nome}' };
    assert.equal((await service.preview(bad)).ready, false); await assert.rejects(service.create(bad), /variável/);
    const cloud = await createBroadcasts({ db, connection: () => 'cloud:123', clock: () => now, send: async input => { sent.push(input); return {}; } });
    await cloud.create({ ...input, requestId: randomUUID(), template: { name: 'saudacao', language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: '{nome|cliente}' }] }] } });
    await cloud.tick(); assert.equal(sent.at(-1).template.components[0].parameters[0].text, 'Ana');
  } finally { db.close(); }
});
