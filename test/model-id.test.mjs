import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSettings} from '../lib/core/settings.mjs';
import {testDirectory,releaseDirectory} from './helpers.mjs';

test('cadastro Gemini aceita ID real, remove espaços e prefixo da API, e explica nome incompleto',async()=>{
  const directory=await testDirectory();
  try{
    const settings=await createSettings(directory);
    const valid=await settings.saveAiKey({provider:'gemini',label:'Gemini',model:'gemini-3.5-flash-lite',apiKey:'test-only-gemini-key'});
    assert.equal(valid.model,'gemini-3.5-flash-lite');
    const item=await settings.saveAiKey({provider:'gemini',label:'Gemini',model:'  models/gemini-3.5-flash-lite  '},valid.id);
    assert.equal(item.model,'gemini-3.5-flash-lite');
    assert.equal(item.apiKey,undefined);
    await settings.update({aiProvider:'gemini',model:' models/gemini-3.5-flash-lite ',apiKey:'test-only-profile-key'});
    assert.equal(settings.get().model,'gemini-3.5-flash-lite');
    await assert.rejects(settings.saveAiKey({provider:'gemini',model:'gemini',apiKey:'test-incomplete-model'}),/modelo completo/);
    await assert.rejects(settings.saveAiKey({provider:'gemini',model:'https://invalid.example/key',apiKey:'test-invalid-model'}),/modelo/);
  }finally{await releaseDirectory(directory);}
});

test('a mesma chave pode usar modelos diferentes, mas não duplicar o mesmo modelo',async()=>{
  const directory=await testDirectory();
  try{
    const settings=await createSettings(directory);
    await settings.saveAiKey({provider:'gemini',model:'gemini-3.5-flash-lite',apiKey:'same-test-only-key'});
    await settings.saveAiKey({provider:'gemini',model:'gemini-3.8-flash',apiKey:'same-test-only-key'});
    assert.equal(settings.get().aiKeys.length,2);
    await assert.rejects(settings.saveAiKey({provider:'gemini',model:'gemini-3.8-flash',apiKey:'same-test-only-key'}),error=>error.status===409);
  }finally{await releaseDirectory(directory);}
});

test('observação da IA persiste, aparece no painel e é preservada ao pausar ou ordenar',async()=>{
  const directory=await testDirectory();
  try{
    let settings=await createSettings(directory);
    const key=await settings.saveAiKey({provider:'openrouter',model:'nvidia/nemotron-3-ultra-550b-a55b:free',apiKey:'test-only-secret',notes:'Maior porte: 550B parâmetros totais. Contexto: 1M.'});
    assert.equal(key.notes,'Maior porte: 550B parâmetros totais. Contexto: 1M.');
    await settings.saveAiKey({provider:'openrouter',model:key.model,enabled:false},key.id);
    settings=await createSettings(directory);
    assert.equal(settings.public().aiKeys[0].notes,key.notes);
    assert.ok(!JSON.stringify(settings.public()).includes('test-only-secret'));
    await assert.rejects(settings.saveAiKey({provider:'openrouter',model:key.model,notes:'x'.repeat(501)},key.id),/observação/i);
    await assert.rejects(settings.saveAiKey({provider:'openrouter',model:key.model,notes:{}},key.id),/observação/i);
  }finally{await releaseDirectory(directory);}
});
