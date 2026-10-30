import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { createCatalog } from '../lib/catalog/catalog.mjs';
import { createBroadcasts } from '../lib/whatsapp/broadcasts.mjs';
import { startTestServer, authenticatedFetch, testDirectory } from './helpers.mjs';
import { allowedPath } from '../deployment/routes.mjs';

const input = () => ({ requestId: randomUUID(), consent: true, phones: '5511988887777', text: 'Olá, conheça nossa novidade!', windowStart: '00:00', windowEnd: '00:00' });
const fixture = { name: 'Apartamento Jardim', price: 'A partir de R$ 320 mil', description: 'Notas internas que não devem ser enviadas', links: [{ title: 'Saiba mais', url: 'https://example.com/apartamento' }] };

test('produto vinculado é validado no catálogo, persiste na revisão/histórico e não altera o conteúdo enviado', async () => {
  const db = createClient({ url: ':memory:' }), sent = [];
  try {
    const catalog = await createCatalog(db), product = await catalog.save(fixture);
    const service = await createBroadcasts({ db, catalog, connection: () => 'qr:a', send: async message => { sent.push(message); return {}; } });
    const draft = { ...input(), productId: product.id, product: { id: product.id, name: 'Nome adulterado' } };
    const expected = { id: product.id, name: fixture.name, price: fixture.price, revision: product.revision };
    const review = await service.preview(draft);
    assert.deepEqual(review.product, expected); assert.equal(review.recipients[0].preview.text, draft.text); assert.equal(sent.length, 0);
    const campaign = await service.create(draft);
    assert.deepEqual(campaign.product, expected);
    assert.deepEqual((await service.create(draft)).product, expected);
    assert.equal((await service.list()).length, 1);
    assert.deepEqual((await service.details(campaign.id)).product, expected);
    const copy = await service.duplicate(campaign.id);
    assert.equal(copy.productId, product.id); assert.deepEqual(copy.product, expected); assert.equal(copy.consent, false);
    await catalog.save({ ...product, name: 'Nome atualizado', active: false }, product.id);
    assert.deepEqual((await service.list())[0].product, expected);
    await assert.rejects(service.preview(copy), /arquivado/);
    await service.tick(); assert.equal(sent.length, 1); assert.equal(sent[0].text, draft.text);
    assert.equal(Object.hasOwn(sent[0], 'product'), false); assert.doesNotMatch(JSON.stringify(sent[0]), /Notas internas|example.com/);
  } finally { db.close(); }
});

test('produto inválido, ausente ou arquivado impede a criação; remover o vínculo mantém disparos comuns', async () => {
  const db = createClient({ url: ':memory:' });
  try {
    const catalog = await createCatalog(db), product = await catalog.save({ ...fixture, active: false });
    const service = await createBroadcasts({ db, catalog, connection: () => 'qr:a', send: async () => ({}) });
    for (const [productId, reason] of [[123, /válido/], ['não-é-um-id', /válido/], [randomUUID(), /não encontrado/], [product.id, /arquivado/]]) {
      await assert.rejects(service.preview({ ...input(), productId }), reason);
      await assert.rejects(service.create({ ...input(), productId }), reason);
    }
    assert.equal((await service.list()).length, 0);
    assert.equal((await service.preview({ ...input(), productId: '' })).ready, true);
    const campaign = await service.create(input()); assert.equal(campaign.product, undefined);
    assert.equal((await service.duplicate(campaign.id)).productId, undefined);
  } finally { db.close(); }
});

test('templates aceitam vínculo e a identidade do disparo inclui o produto', async () => {
  const db = createClient({ url: ':memory:' });
  try {
    const catalog = await createCatalog(db), first = await catalog.save(fixture), second = await catalog.save({ ...fixture, name: 'Outro imóvel' });
    const service = await createBroadcasts({ db, catalog, connection: () => 'cloud:123', send: async () => ({}) });
    const draft = { ...input(), productId: first.id, template: { name: 'novidade', language: { code: 'pt_BR' } } };
    assert.equal((await service.preview(draft)).ready, true);
    const campaign = await service.create(draft); assert.equal(campaign.product.id, first.id);
    assert.equal(campaign.template.name, 'novidade');
    await assert.rejects(service.create({ ...draft, productId: second.id }), /reutilizado/);
    await assert.rejects(service.create({ ...draft, productId: '' }), /reutilizado/);
  } finally { db.close(); }
});

test('API usa o catálogo autenticado e serve o módulo do seletor de produto', async () => {
  const app = await startTestServer({ port: 0, dataDir: await testDirectory() });
  const post = (path, data) => authenticatedFetch(app.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  try {
    await app.settings.update({ whatsappMode: 'cloud', phoneNumberId: '123456789' });
    const product = await (await post('/api/products', fixture)).json();
    const draft = { ...input(), productId: product.id, template: { name: 'novidade', language: { code: 'pt_BR' } }, scheduledAt: new Date(Date.now() + 3600000).toISOString() };
    const review = await post('/api/broadcasts/preview', draft); assert.equal(review.status, 200); assert.equal((await review.json()).product.name, fixture.name);
    const created = await post('/api/broadcasts', draft); assert.equal(created.status, 201); const campaign = await created.json();
    const details = await (await authenticatedFetch(app.url + '/api/broadcasts/' + campaign.id)).json(); assert.equal(details.product.id, product.id);
    const duplicate = await (await post('/api/broadcasts/duplicate', { id: campaign.id })).json(); assert.equal(duplicate.productId, product.id);
    assert.equal(allowedPath('/broadcast-product.js'), true); assert.equal((await authenticatedFetch(app.url + '/broadcast-product.js')).status, 200);
    assert.equal((await post('/api/broadcasts/preview', { ...draft, productId: randomUUID() })).status, 404);
  } finally { await app.close(); }
});
