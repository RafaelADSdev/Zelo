import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { createBroadcasts } from '../lib/whatsapp/broadcasts.mjs';
import { insideWindow, broadcastPolicy } from '../lib/whatsapp/broadcast-policy.mjs';

test('fila explica espera fora do horário e retoma na próxima janela sem antecipar envios', async () => {
  const db = createClient({ url: ':memory:' });
  let now = Date.parse('2026-11-04T00:39:00Z'), sent = 0;
  try {
    const service = await createBroadcasts({ db, connection: () => 'qr:a', clock: () => now, send: async () => { sent++; return { messageId: 'ok' }; } });
    const campaign = await service.create({ requestId: randomUUID(), consent: true, phones: '5511988887777\n5511977776666', text: 'Olá', windowStart: '08:00', windowEnd: '20:00' });
    await service.tick();
    const waiting = await service.get(campaign.id);
    assert.equal(sent, 0);
    assert.equal(waiting.state, 'queued');
    assert.equal(waiting.items.filter(item => item.state === 'pending').length, 2);
    assert.match(waiting.paused_reason || '', /Aguardando o horário permitido.*08:00.*20:00.*America\/Sao_Paulo/);
    assert.equal((await service.list())[0].paused_reason, waiting.paused_reason);
    now = Date.parse('2026-11-04T11:00:00Z');
    await service.tick();
    assert.equal(sent, 1);
    assert.equal((await service.get(campaign.id)).paused_reason, null);
  } finally { db.close(); }
});

test('novos disparos permitem envio o dia inteiro por padrão', () => {
  const policy = broadcastPolicy({}, 'qr:a');
  for (const time of ['2026-11-04T00:39:00Z', '2026-11-04T03:00:00Z', '2026-11-04T10:59:00Z', '2026-11-04T23:00:00Z']) {
    assert.equal(insideWindow(policy, Date.parse(time)), true);
  }
});
test('jitter, minuto e teto diário persistem por conta entre campanhas e reinícios', async () => {
  const db = createClient({ url: ':memory:' }); let now = Date.parse('2026-10-30T15:00:00Z'), sent = 0;
  const options = { db, connection: () => 'qr:a', clock: () => now, random: () => .5, send: async () => { sent++; return { messageId: 'sent' }; } };
  try {
    let service = await createBroadcasts(options);
    const input = { requestId: randomUUID(), consent: true, phones: '5511988887777\n5511977776666\n5511966665555', text: 'Olá', dailyCap: 2, perMinute: 1 };
    const campaign = await service.create(input); await service.tick(); assert.equal(sent, 1);
    assert.equal((await service.get(campaign.id)).next_at, now + 16500);
    now += 20000; await service.tick(); assert.equal(sent, 1);
    service = await createBroadcasts(options); now += 41000; await service.tick(); assert.equal(sent, 2);
    now += 70000; await service.tick(); assert.equal(sent, 2);
    assert.match((await service.get(campaign.id)).paused_reason, /Teto diário/);
    now += 86400000; await service.tick(); assert.equal(sent, 3);
  } finally { db.close(); }
});
test('janela usa fuso explícito, dias e faixa que atravessa meia-noite', () => {
  const base = broadcastPolicy({ windowStart: '22:00', windowEnd: '02:00', days: [5] }, 'qr:a');
  assert.equal(insideWindow(base, Date.parse('2026-10-31T04:00:00Z')), true);
  assert.equal(insideWindow(base, Date.parse('2026-10-31T06:00:00Z')), false);
  assert.equal(insideWindow(base, Date.parse('2026-10-30T20:00:00Z')), false);
  assert.throws(() => broadcastPolicy({ intervalMs: 1000 }, 'qr:a'), /intervalMs/);
  assert.throws(() => broadcastPolicy({ timezone: 'invalid' }, 'qr:a'), /Fuso/);
});
test('dois ticks concorrentes não enviam o mesmo item nem dois contatos da conta em paralelo', async () => {
  const db = createClient({ url: ':memory:' }); let calls = 0;
  try {
    const service = await createBroadcasts({ db, connection: () => 'qr:a', clock: () => Date.parse('2026-10-30T15:00:00Z'), send: async input => { assert.equal(input.expectedAccount, 'qr:a'); calls++; return { messageId: 'ok' }; } });
    await service.create({ requestId: randomUUID(), consent: true, phones: '5511988887777\n5511977776666', text: 'Olá' });
    await Promise.all([service.tick(), service.tick()]); assert.equal(calls, 1);
  } finally { db.close(); }
});
test('fila pausa após três falhas consecutivas ou imediatamente em autenticação e limite', async () => {
  for (const metadata of [{}, { authError: true }, { rateLimited: true }]) {
    const db = createClient({ url: ':memory:' }); let now = Date.parse('2026-10-30T15:00:00Z');
    try {
      const service = await createBroadcasts({ db, connection: () => 'qr:a', clock: () => now, send: async () => { throw Object.assign(new Error('Recusado'), { status: 502, ...metadata }); } });
      const campaign = await service.create({ requestId: randomUUID(), consent: true, phones: '5511988887777\n5511977776666\n5511966665555\n5511955554444', text: 'Olá' });
      for (let i = 0; i < 3; i++) { await service.tick(); now += 70000; }
      const result = await service.get(campaign.id); assert.equal(result.state, 'paused'); assert.ok(result.paused_reason);
      assert.equal(result.items.filter(item => item.state === 'failed').length, Object.keys(metadata).length ? 1 : 3);
    } finally { db.close(); }
  }
});
