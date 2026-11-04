import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettings } from '../lib/core/settings.mjs';
import { createAiModel } from '../lib/ai/ai.mjs';
import { testDirectory, releaseDirectory, startTestServer, authenticatedFetch } from './helpers.mjs';

test('orientações de escrita têm sugestão inicial, aceitam parágrafos e persistem separadas das instruções globais', async () => {
  const dir = await testDirectory();
  try {
    const settings = await createSettings(dir);
    assert.match(settings.public().responseInstructions, /linha em branco/);
    const original = settings.get().instructions;
    const custom = 'Responda primeiro à pergunta.\n\nUse parágrafos curtos.';
    await settings.update({ responseInstructions: custom });
    assert.equal(settings.get().instructions, original);
    const restored = await createSettings(dir);
    assert.equal(restored.public().responseInstructions, custom);
    for (const invalid of [null, 42, {}, 'a'.repeat(3001)]) {
      await assert.rejects(settings.update({ responseInstructions: invalid }), { status: 400 });
    }
    await settings.update({ responseInstructions: '' });
    assert.equal((await createSettings(dir)).get().responseInstructions, '');
  } finally { await releaseDirectory(dir); }
});

for (const provider of ['gemini', 'llamacpp']) {
  test(`orientações de escrita chegam ao ${provider} junto das regras do assistente`, async () => {
    let instruction;
    const ai = createAiModel({ aiProvider: provider, apiKey: provider === 'gemini' ? 'test-key' : '', model: provider === 'gemini' ? 'gemini-2.5-flash' : 'Spark-X2.5-4B', instructions: 'Não invente preços.', responseInstructions: 'Use linhas em branco entre parágrafos.', fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      instruction = provider === 'gemini' ? body.systemInstruction.parts[0].text : body.messages[0].content;
      return Response.json(provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: 'Olá!\n\nComo posso ajudar?' }] } }] } : { choices: [{ message: { content: 'Olá!\n\nComo posso ajudar?' } }] });
    } });
    assert.equal((await ai.generate({ prompt: 'Olá' })).text, 'Olá!\n\nComo posso ajudar?');
    assert.match(instruction, /Não invente preços/);
    assert.match(instruction, /Use linhas em branco entre parágrafos/);
  });
}

test('painel salva orientações de escrita pela API e rejeita conteúdo inválido sem apagar o anterior', async () => {
  const dir = await testDirectory();
  const app = await startTestServer({ port: 0, dataDir: dir });
  try {
    const post = data => authenticatedFetch(app.url + '/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal((await post({ responseInstructions: 'Seja objetivo.\nSepare os parágrafos.' })).status, 200);
    assert.equal((await post({ responseInstructions: 9 })).status, 400);
    const dashboard = await (await authenticatedFetch(app.url + '/api/dashboard')).json();
    assert.equal(dashboard.settings.responseInstructions, 'Seja objetivo.\nSepare os parágrafos.');
  } finally { await app.close(); await releaseDirectory(dir); }
});
