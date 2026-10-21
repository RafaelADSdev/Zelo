import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTunnel } from '../tunnel.mjs';
import { testDirectory, releaseDirectory } from './helpers.mjs';

test('tunnel uses a pinned official binary without release API discovery and rejects a corrupt download', async () => {
  const dataDir = await testDirectory(), requests = [];
  const tunnel = createTunnel({ dataDir, port: 1, settings: { async update() {} }, fetchImpl: async url => {
    requests.push(url);
    return new Response('corrupt download', { headers: { 'Content-Length': '16' } });
  } });
  try {
    await assert.rejects(tunnel.start(), /Checksum/);
    assert.equal(requests.length, 1);
    assert.match(requests[0], /^https:\/\/github\.com\/cloudflare\/cloudflared\/releases\/download\/2026\.10\.3\/cloudflared-/);
    assert.equal(tunnel.state().running, false);
  } finally { tunnel.stop(); await releaseDirectory(dataDir); }
});
