import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { createBroadcasts } from '../lib/whatsapp/broadcasts.mjs';
import { normalizeBroadcastPhone } from '../lib/whatsapp/broadcast-preview.mjs';
test('preview normaliza BR, classifica 24h e cria somente dentro da janela com escolha explícita', async () => {
  const db = createClient({ url: ':memory:' }); let now = Date.parse('2026-10-30T15:00:00Z'), sent = 0;
  try {
    await db.execute('CREATE TABLE wa_contacts(phone TEXT PRIMARY KEY,account_id TEXT,name TEXT,last_inbound INTEGER)');
    await db.execute({ sql: "INSERT INTO wa_contacts VALUES('5511988887777','123','Ana',?)", args: [now - 1000] });
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
