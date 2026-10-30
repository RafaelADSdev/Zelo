import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { createBroadcastWriter } from '../lib/whatsapp/broadcast-writer.mjs';
import { createCatalog } from '../lib/catalog/catalog.mjs';
import { startTestServer, authenticatedFetch, testDirectory } from './helpers.mjs';
import { allowedPath } from '../deployment/routes.mjs';

const fixture = { name: 'Sopro', description: 'Apartamentos próximos à praia, com varanda. Informação interna: comissão da equipe.', price: 'A partir de R$ 319.900, sujeito a confirmação', links: [{ title: 'Conheça o Sopro', url: 'https://example.com/sopro' }] };
const answer = text => Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const draft = product => ({ productId: product.id, requestId: randomUUID(), costConfirmed: true, instructions: 'Apresente a localização e convide para conversar.' });
const post = (app, value) => authenticatedFetch(app.url + '/api/broadcasts/generate-message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });

test('geração autenticada exige ciência do custo e produto ativo antes de consultar a IA', async () => {
  let calls = 0;
  const app = await startTestServer({ port: 0, dataDir: await testDirectory(), aiFetch: async () => { calls++; return answer('Olá!'); } });
  try {
    const product = await app.runtime.catalog.save(fixture), input = draft(product);
    await app.settings.update({ aiProvider: 'openai', model: 'test-model', apiKey: 'private-writer-key' });
    assert.equal(allowedPath('/api/broadcasts/generate-message'), true);
    assert.equal((await fetch(app.url + '/api/broadcasts/generate-message', { method: 'POST' })).status, 401);
    for (const invalid of [null, [], { ...input, costConfirmed: false }, { ...input, requestId: 'invalid' }, { ...input, instructions: 'x'.repeat(601) }, { ...input, instructions: 3 }]) assert.equal((await post(app, invalid)).status, 400);
    assert.equal((await post(app, { ...input, productId: randomUUID() })).status, 404);
    await app.runtime.catalog.save({ ...product, active: false }, product.id);
    assert.equal((await post(app, input)).status, 409); assert.equal(calls, 0);
  } finally { await app.close(); }
});

test('rascunho usa apenas conhecimentos do produto selecionado e não cria disparo, conversa ou saída', async () => {
  const requests = [];
  const text = 'Olá {nome|cliente}! Conheça o Sopro, próximo à praia, com varanda. A partir de R$ 319.900, sujeito a confirmação. Quer saber mais?';
  const app = await startTestServer({ port: 0, dataDir: await testDirectory(), aiFetch: async (_url, options) => { requests.push(JSON.parse(options.body)); return answer(text); } });
  try {
    await app.settings.update({ aiProvider: 'openai', model: 'test-model', apiKey: 'private-writer-key' });
    const product = await app.runtime.catalog.save(fixture); await app.runtime.catalog.save({ ...fixture, name: 'Outro produto', description: 'Descrição que não deve ir à IA desta campanha' });
    const response = await post(app, { ...draft(product), product: { description: 'Conteúdo adulterado do navegador' }, phones: '5511999999999' });
    assert.equal(response.status, 200); const result = await response.json();
    assert.equal(result.text, text); assert.deepEqual(result.product, { id: product.id, name: product.name, revision: product.revision });
    assert.deepEqual(result.ai, { provider: 'openai', model: 'test-model' });
    const prompt = JSON.stringify(requests[0]); assert.match(prompt, /próximos à praia/); assert.match(prompt, /319.900/); assert.match(prompt, /sujeito a confirmação/);
    assert.doesNotMatch(prompt, /Outro produto|Descrição que não deve|Conteúdo adulterado|5511999999999/);
    assert.equal(requests[0].store, false); assert.ok(!JSON.stringify(result).includes('private-writer-key'));
    for (const table of ['wa_broadcasts','wa_broadcast_items','qr_outbox','qr_contacts']) assert.equal((await app.runtime.client.execute(`SELECT COUNT(*) AS count FROM ${table}`)).rows[0].count, 0);
  } finally { await app.close(); }
});

test('repetição e requisições concorrentes da mesma geração não duplicam a chamada paga', async () => {
  const db = createClient({ url: ':memory:' }); let calls = 0;
  try {
    const catalog = await createCatalog(db), product = await catalog.save(fixture);
    const settings = { get: () => ({ aiProvider: 'openai', model: 'test-model', apiKey: 'private-key' }) };
    const options = { db, catalog, settings, fetchImpl: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 25)); return answer('Conheça o Sopro!'); } };
    let writer = await createBroadcastWriter(options); const input = draft(product);
    const [first, second] = await Promise.all([writer.generate(input), writer.generate(input)]);
    assert.deepEqual(first, second); assert.equal(calls, 1);
    writer = await createBroadcastWriter(options); assert.deepEqual(await writer.generate(input), first); assert.equal(calls, 1);
    await assert.rejects(writer.generate({ ...input, instructions: 'Outro objetivo' }), /reutilizado/); assert.equal(calls, 1);
    await db.execute({ sql: "UPDATE wa_broadcast_ai_drafts SET state='pending',result=NULL WHERE id=?", args: [input.requestId] });
    await assert.rejects(writer.generate(input), /sem confirmação/); assert.equal(calls, 1);
  } finally { db.close(); }
});

test('falha, resposta vazia ou excessiva não retorna mensagem e repetir o pedido não cobra novamente', async () => {
  const db = createClient({ url: ':memory:' }); let mode = 'error', calls = 0;
  try {
    const catalog = await createCatalog(db), product = await catalog.save(fixture);
    const settings = { get: () => ({ aiProvider: 'openai', model: 'test-model', apiKey: 'private-writer-key' }) };
    const writer = await createBroadcastWriter({ db, catalog, settings, fetchImpl: async () => { calls++; return mode === 'error' ? Response.json({ error: { message: 'private-writer-key' } }, { status: 401 }) : answer(mode === 'long' ? 'x'.repeat(4001) : ''); } });
    for (mode of ['error','long','empty']) {
      const input = draft(product), before = calls;
      await assert.rejects(writer.generate(input), error => error.status === 502 && !error.message.includes('private-writer-key'));
      await assert.rejects(writer.generate(input), error => error.status === 502); assert.equal(calls, before + 1);
    }
    const unconfigured = await createBroadcastWriter({ db, catalog, settings: { get: () => ({ aiProvider: 'openai' }) } });
    await assert.rejects(unconfigured.generate(draft(product)), error => error.status === 409);
  } finally { db.close(); }
});

test('geração respeita a lista de prioridade de IA configurada no Zelo', async () => {
  let calls = 0;
  const app = await startTestServer({ port: 0, dataDir: await testDirectory(), aiFetch: async (_url, options) => { calls++; assert.equal(options.headers.Authorization, 'Bearer priority-private-key'); return answer('Uma mensagem pela IA da lista.'); } });
  try {
    await app.settings.saveAiKey({ label: 'IA de campanhas', provider: 'openai', model: 'test-priority', apiKey: 'priority-private-key' });
    const key = app.settings.get().aiKeys[0]; await app.settings.configureAiRotation({ enabled: true, order: [key.id] });
    const product = await app.runtime.catalog.save(fixture);
    const response = await post(app, draft(product)); assert.equal(response.status, 200); const result = await response.json();
    assert.equal(result.ai.model, 'test-priority'); assert.equal(calls, 1); assert.ok(!JSON.stringify(result).includes('priority-private-key'));
  } finally { await app.close(); }
});
