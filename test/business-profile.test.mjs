import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDirectory, releaseDirectory } from './helpers.mjs';
import { createSettings } from '../lib/core/settings.mjs';
import { buildInstruction } from '../lib/ai/gemini.mjs';

test('nome do negócio: persiste, valida e orienta a IA sem substituir o assistente', async () => {
  const directory = await testDirectory();
  try {
    const settings = await createSettings(directory);
    await settings.update({ businessName: '  Loja de exemplo  ' });
    const reloaded = await createSettings(directory);
    assert.equal(reloaded.public().businessName, 'Loja de exemplo');
    assert.equal(reloaded.get().assistantName, 'Assistente');
    await assert.rejects(settings.update({ businessName: 'Nome\noutro' }), /inválido/);
    await assert.rejects(settings.update({ businessName: 'x'.repeat(121) }), /inválido/);
    assert.match(buildInstruction(reloaded.get(), {}), /Nome do negócio: Loja de exemplo/);
  } finally { await releaseDirectory(directory); }
});
