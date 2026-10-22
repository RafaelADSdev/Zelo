import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server.mjs';
import { createWorkspaceRouter } from '../lib/workspaces/workspace-router.mjs';
import { testDirectory, releaseDirectory } from './helpers.mjs';

async function verifyPublicLegal(url) {
  for (const path of ['/privacidade', '/termos', '/cookies', '/cancelamento', '/contato']) {
    const response = await fetch(url + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/);
    const html = await response.text();
    assert.match(html, /<html lang="pt-BR"/);
    assert.match(html, /Rafael Arcanjo Dantas dos Santos/);
    assert.match(html, /rafaelarcanjods05@gmail.com/);
    assert.match(html, /href="\/privacidade"/);
  }
  assert.equal((await fetch(url + '/legal.css')).status, 200);
  assert.equal((await fetch(url + '/api/dashboard')).status, 401);
  assert.equal((await fetch(url + '/api/products')).status, 401);
  const login = await (await fetch(url + '/login')).text();
  for (const path of ['/privacidade', '/termos', '/cookies', '/cancelamento', '/contato']) assert.ok(!login.includes(`href="${path}"`));
}

test('legal pages are public without exposing private APIs in local and workspace modes', async () => {
  const dataDir = await testDirectory();
  const local = await startServer({ port: 0, dataDir });
  const router = await createWorkspaceRouter({ access: {}, manager: { async close() {} }, original: {}, port: 0 });
  try { await verifyPublicLegal(local.url); await verifyPublicLegal(router.url); }
  finally { await router.close(); await local.close(); await releaseDirectory(dataDir); }
});
