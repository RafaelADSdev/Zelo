import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestServer, authenticatedFetch, testDirectory } from './helpers.mjs';
import { allowedPath } from '../deployment/routes.mjs';
test('rotas v2 exigem login e limite maior de JSON fica restrito aos dados de revisão/criação/teste', async () => {
  const app = await startTestServer({ port: 0, dataDir: await testDirectory() });
  const post = (path, input) => authenticatedFetch(app.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  try {
    await app.settings.update({ whatsappMode: 'cloud', phoneNumberId: '123456789' });
    for (const suffix of ['remove','preview','resolve','retry-failed','duplicate','test',randomUUID()]) {
      const path = '/api/broadcasts/' + suffix; assert.equal(allowedPath(path), true); assert.equal((await fetch(app.url + path)).status, 401);
    }
    assert.equal(allowedPath('/api/optouts'), true);
    const input = { requestId: randomUUID(), consent: true, recipients: Array.from({ length: 60 }, (_, i) => ({ phone: String(5511988800000 + i), vars: { cidade: 'x'.repeat(1000), produto: 'y'.repeat(1000) } })), template: { name: 'hello', language: { code: 'pt_BR' } }, scheduledAt: new Date(Date.now() + 3600000).toISOString() };
    assert.equal((await post('/api/broadcasts/preview', input)).status, 200);
    const created = await post('/api/broadcasts', input); assert.equal(created.status, 201);
    const campaign = await created.json(); assert.equal(campaign.consent_by, 'test-admin');
    const page = await (await authenticatedFetch(app.url + `/api/broadcasts/${campaign.id}?page=2&limit=50`)).json(); assert.equal(page.items.length, 10);
    assert.equal((await post('/api/broadcasts/remove', {id:campaign.id})).status, 400);
    assert.equal((await post('/api/broadcasts/remove', {id:campaign.id,confirmed:true})).status, 409);
    assert.equal((await post('/api/broadcasts/cancel', {id:campaign.id})).status, 200);
    assert.equal((await post('/api/broadcasts/remove', {id:campaign.id,confirmed:true})).status, 200);
    assert.equal((await (await authenticatedFetch(app.url + '/api/broadcasts')).json()).campaigns.length, 0);
    assert.equal((await post('/api/chat', { text: 'x'.repeat(70000) })).status, 413);
    assert.equal((await authenticatedFetch(app.url + `/api/broadcasts/${campaign.id}?limit=101`)).status, 400);
  } finally { await app.close(); }
});
