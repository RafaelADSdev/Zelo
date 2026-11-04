import test from 'node:test';
import assert from 'node:assert/strict';
import { createRotatingAi } from '../lib/ai/ai-rotation.mjs';
import { startTestServer, authenticatedFetch, testDirectory, releaseDirectory } from './helpers.mjs';

const answer = { formatRationale: 'Texto', message: { text: 'Olá do Spark!' }, sessionFacts: { nome: null }, materialIds: [] };
test('llama.cpp usa a API local e schema sem enviar credenciais', async () => {
  const entry = { id: 'spark', provider: 'llamacpp', model: 'Spark-X2.5-4B', apiKey: '', enabled: true };
  const settings = { get: () => ({ aiListOnly: true, aiKeys: [entry] }), markAiKey: async () => {} };
  const ai = createRotatingAi(settings, { fetchImpl: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:9931/v1/chat/completions');
    assert.equal(options.headers.Authorization, undefined);
    const body = JSON.parse(options.body);
    assert.equal(body.model, entry.model);
    assert.equal(body.stream, false);
    assert.equal(body.response_format.type, 'json_schema');
    assert.ok(body.response_format.json_schema.schema.required.includes('message'));
    return Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }] });
  } });
  const result = await ai.generate({ prompt: 'Olá', responseSchema: { properties: { message: {} } } });
  assert.equal(result.structured.message.text, answer.message.text);
});

test('llama.cpp cadastra, valida e atende com Spark sem chave', async () => {
  const dir = await testDirectory();
  const app = await startTestServer({ port: 0, dataDir: dir, aiFetch: async () => Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }] }) });
  try {
    const post = (path, data) => authenticatedFetch(app.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const saved = await post('/api/ai/keys', { label: 'Spark local', provider: 'llamacpp', model: 'Spark-X2.5-4B' });
    assert.equal(saved.status, 201);
    const key = await saved.json();
    const verified = await post(`/api/ai/keys/${key.id}/verify`, {});
    assert.equal(verified.status, 200);
    const { settings: state } = await (await authenticatedFetch(app.url + '/api/dashboard')).json();
    assert.equal(state.aiReadyConfigured, true);
    const chat = await post('/api/chat', { text: 'Olá' });
    assert.equal(chat.status, 200);
    assert.equal((await chat.json()).reply.text, answer.message.text);
    const remote = await post('/api/ai/keys', { label: 'Remoto', provider: 'openai', model: 'example' });
    assert.equal(remote.status, 400);
  } finally { await app.close(); await releaseDirectory(dir); }
});
