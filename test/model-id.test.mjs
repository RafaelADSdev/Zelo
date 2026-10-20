import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSettings} from '../settings.mjs';
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
