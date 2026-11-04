import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiModel } from '../lib/ai/ai.mjs';
import { createRotatingAi } from '../lib/ai/ai-rotation.mjs';

test('Ollama local gera resposta estruturada sem chave', async () => {
  const entry = { id: 'local', provider: 'ollama', model: 'gemma4:e4b', apiKey: '', enabled: true };
  const settings = { get: () => ({ aiListOnly: true, aiKeys: [entry] }), markAiKey: async () => {} };
  const model = createRotatingAi(settings, { fetchImpl: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(options.headers.Authorization, undefined);
    const body = JSON.parse(options.body);
    assert.equal(body.model, entry.model); assert.equal(body.stream, false); assert.equal(body.format.type, 'object');
    return Response.json({ message: { content: JSON.stringify({ formatRationale: 'texto', message: { text: 'Olá!' }, sessionFacts: { nome: null }, materialIds: [] }) } });
  } });
  const result = await model.generate({ prompt: 'Olá', responseSchema: { properties: { message: {} } } });
  assert.equal(result.structured.message.text, 'Olá!');
});
import { startTestServer, authenticatedFetch, testDirectory, releaseDirectory } from './helpers.mjs';
test('cadastro local sem chave funciona no atendimento', async () => {
  const dir = await testDirectory();
  const app = await startTestServer({ port: 0, dataDir: dir, aiFetch: async () => Response.json({ message: { content: JSON.stringify({ formatRationale: 'texto', message: { text: 'Olá local' }, sessionFacts: { nome: null }, materialIds: [] }) } }) });
  try {
    const post = (path, data) => authenticatedFetch(app.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const saved = await post('/api/ai/keys', { label: 'Local', provider: 'ollama', model: 'gemma4:e4b' });
    assert.equal(saved.status, 201);
    const chat = await post('/api/chat', { text: 'Olá' });
    assert.equal(chat.status, 200); assert.equal((await chat.json()).reply.text, 'Olá local');
  } finally { await app.close(); await releaseDirectory(dir); }
});
