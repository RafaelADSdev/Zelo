import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createUploads } from '../deployment/uploads.mjs';
import { allowedPath } from '../deployment/routes.mjs';
import { startTestServer, authenticatedFetch, testDirectory } from './helpers.mjs';

const metadata = (productId = randomUUID()) => ({ uploadId: randomUUID(), productId, name: 'material.pdf', mime: 'application/pdf', size: 6 });

test('upload retoma pelo tamanho recebido e uma confirmação repetida devolve o mesmo arquivo', async () => {
  let writes = 0;
  const uploads = createUploads({ async upload(_id, bytes) {
    assert.equal(bytes.toString(), 'abcdef');
    writes++;
    return { id: 'material-salvo' };
  } });
  const file = metadata();
  const { id } = uploads.start(file, 'owner');
  uploads.append(id, 'owner', 0, Buffer.from('abc'));
  assert.throws(() => uploads.start(file, 'another-session'), { status: 404 });
  assert.throws(() => uploads.start({ ...file, name: 'outro.pdf' }, 'owner'), { status: 409 });
  assert.equal(uploads.start(file, 'owner').received, 3);
  uploads.append(id, 'owner', 3, Buffer.from('def'));
  const saved = await uploads.finish(id, 'owner');
  assert.equal(uploads.start(file, 'owner').received, 6);
  assert.deepEqual(await uploads.finish(id, 'owner'), saved);
  assert.equal(writes, 1);
});

test('cancelamento autenticado libera vaga de upload e só descarta envio da própria sessão', async () => {
  const app = await startTestServer({ port: 0, dataDir: await testDirectory() });
  try {
    const post = (path, data) => authenticatedFetch(app.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const first = metadata();
    assert.equal((await post('/api/uploads', first)).status, 201);
    for (let i = 0; i < 2; i++) assert.equal((await post('/api/uploads', metadata())).status, 201);
    assert.equal((await post('/api/uploads', metadata())).status, 429);
    const path = `/api/uploads/${first.uploadId}/cancel`;
    assert.equal(allowedPath(path), true);
    assert.equal((await fetch(app.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await post(path, {})).status, 200);
    assert.equal((await post('/api/uploads', metadata())).status, 201);
  } finally { await app.close(); }
});
