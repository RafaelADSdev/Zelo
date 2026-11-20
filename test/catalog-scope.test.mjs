import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../lib/core/runtime.mjs';
import { createSettings } from '../lib/core/settings.mjs';
import { testDirectory } from './helpers.mjs';

const contactId = 'whatsapp:demo:contact';

async function fixture() {
  const directory = await testDirectory();
  const settings = await createSettings(directory, { apiKey: 'synthetic-catalog-scope' });
  const requests = [], sent = [];
  const runtime = await createRuntime(directory, settings, { fetchImpl: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ formatRationale: 'Texto', message: { text: 'O valor do Aurora é R$ 350.000.' } }) }] } }] });
  } });
  const say = text => runtime.whatsapp({ id: `mensagem-${sent.length}`, contactId, channel: 'whatsapp', text, timestamp: Date.now() }, async (_recipient, reply) => {
    sent.push(reply);
    return { status: 'sent' };
  });
  return { runtime, requests, sent, say };
}

const addProduct = catalog => catalog.save({ name: 'Aurora', price: 'R$ 350.000', description: 'Apartamentos com piscina e varanda.' });
const prompt = request => request.contents.at(-1).parts[0].text;

test('WhatsApp recusa um pedido de programação sem mandar a mensagem a um provedor de IA', async () => {
  const { runtime, requests, sent, say } = await fixture();
  try {
    await addProduct(runtime.catalog);
    await say('Faça um código em py de uma calculadora');
    assert.equal(requests.length, 0, 'mensagens fora do assunto não devem ser enviadas à IA');
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /produtos cadastrados/);
    assert.equal((await runtime.memory.load(contactId)).at(-1).text, sent[0].text);
  } finally { await runtime.close(); }
});

test('pergunta explícita e complemento sobre o produto ativo usam a ficha cadastrada', async () => {
  const { runtime, requests, sent, say } = await fixture();
  try {
    await addProduct(runtime.catalog);
    await runtime.catalog.save({ name: 'Aurora Sul', price: 'R$ 500.000', description: 'Lotes perto da praia.' });
    await say('Quero conhecer o Aurora.');
    await say('E o preço dele?');
    await say('Qual o valor do Aurora Sul?');
    assert.equal(requests.length, 3);
    assert.deepEqual(sent.slice(0, 2).map(reply => reply.text), ['O valor do Aurora é R$ 350.000.', 'O valor do Aurora é R$ 350.000.']);
    for (const request of requests.slice(0, 2)) {
      assert.match(request.systemInstruction.parts[0].text, /responda somente sobre os produtos ativos/i);
      assert.match(prompt(request), /PRODUTO: Aurora/);
      assert.match(prompt(request), /R\$ 350\.000/);
      assert.doesNotMatch(prompt(request), /R\$ 500\.000/);
    }
    assert.match(prompt(requests[2]), /PRODUTO: Aurora Sul/);
    assert.doesNotMatch(prompt(requests[2]), /PRODUTO: Aurora\s*\n/);
  } finally { await runtime.close(); }
});

test('um tema geral interrompe o contexto e o próximo complemento exige identificação do produto', async () => {
  const { runtime, requests, sent, say } = await fixture();
  try {
    await addProduct(runtime.catalog);
    await say('Quero conhecer o Aurora.');
    await say('Qual é a capital da França?');
    await say('E o preço dele?');
    assert.equal(requests.length, 1);
    assert.match(sent[1].text, /produtos cadastrados/i);
    assert.match(sent[2].text, /qual produto/i);
  } finally { await runtime.close(); }
});

test('mencionar um produto em pedido de código não libera geração nem anexos', async () => {
  const { runtime, requests, sent, say } = await fixture();
  try {
    await addProduct(runtime.catalog);
    await say('Faça um código em Python que calcule as parcelas do Aurora.');
    assert.equal(requests.length, 0);
    assert.match(sent[0].text, /produtos cadastrados/i);
    assert.ok(!sent[0].materials?.length);
  } finally { await runtime.close(); }
});

test('ficha arquivada não libera resposta nem expõe preço', async () => {
  const { runtime, requests, sent, say } = await fixture();
  try {
    await addProduct(runtime.catalog);
    await runtime.catalog.save({ name: 'Horizonte', description: 'Apartamentos no centro.', price: 'R$ 900.000', active: false });
    await say('Qual é o preço do Horizonte?');
    assert.equal(requests.length, 0);
    assert.doesNotMatch(sent[0].text, /900\.000/);
  } finally { await runtime.close(); }
});

test('a marca de transcrição não interrompe um complemento válido sobre o produto anterior', async () => {
  const { runtime, requests, sent, say } = await fixture();
  try {
    await addProduct(runtime.catalog);
    await say('Quero conhecer o Aurora.');
    await say('[Áudio transcrito] E o preço dele?');
    assert.equal(requests.length, 2);
    assert.match(prompt(requests[1]), /PRODUTO: Aurora/);
    assert.match(sent[1].text, /R\$ 350\.000/);
  } finally { await runtime.close(); }
});
