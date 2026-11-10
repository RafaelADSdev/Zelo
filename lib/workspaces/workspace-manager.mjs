import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { startServer } from '../../server.mjs';
import { restoreState, decodeSnapshot } from '../../deployment/restore.mjs';
import { readRecord } from '../../deployment/records.mjs';
import { validOwner } from './workspace-access.mjs';
import { createSettings, fail } from '../core/settings.mjs';

export function workspaceKey(master, id) {
  if (!/^[a-f0-9]{64}$/.test(master || '') || !validOwner(id)) throw new Error('Ambiente inválido.');
  return createHmac('sha256', Buffer.from(master, 'hex')).update('zelo-workspace-v1:' + id).digest('hex');
}
export async function originalAccount(cloud, key) {
  const row = await readRecord(cloud, 'primary');
  if (!row) throw new Error('Backup do administrador não encontrado.');
  const auth = JSON.parse(decodeSnapshot(row, key).files?.['auth.json'] || 'null');
  if (!validOwner(auth?.userId) || auth.provider !== 'supabase' || !auth.username) throw new Error('Administrador original não identificado.');
  const user = await cloud.request('/auth/v1/admin/users/' + auth.userId);
  if (user?.id !== auth.userId || user.email?.toLowerCase() !== auth.username.toLowerCase()) throw new Error('Vínculo do administrador original inválido.');
  await cloud.request('/rest/v1/rpc/zelo_claim_legacy', { method: 'POST', body: { target_owner: auth.userId, target_email: auth.username } });
  return auth;
}
export function createWorkspaceManager({ directory, cloud, cloudConfig, key, original, origin, originalDirectory, persistent = false, start = startServer }) {
  const contexts = new Map(), initialized = new Set();
  let closed = false;
  async function create(id) {
    const originalState = id === original.userId && originalDirectory;
    const dataDir = originalState || join(directory, id);
    const snapshotId = originalState ? 'primary' : 'workspace:' + id;
    const backupKey = originalState ? key : workspaceKey(key, id);
    let saved = false;
    if (persistent) {
      try { await access(join(dataDir, 'wappy.db')); saved = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const restored = initialized.has(id) || saved || await restoreState({ cloud, key: backupKey, directory: dataDir, snapshotId, allowMissing: true });
    if (!restored && id === original.userId) await restoreState({ cloud, key, directory: dataDir });
    else if (!restored) {
      const settings = await createSettings(dataDir);
      await settings.update({ autoReply: false, whatsappMode: 'qr' });
    }
    initialized.add(id);
    const secret = randomBytes(32).toString('hex');
    const auth = {
      configured: () => true, provider: () => 'supabase', control: () => false,
      session(req) {
        const supplied = Buffer.from(req.headers['x-zelo-workspace-secret'] || ''), expected = Buffer.from(secret);
        return supplied.length === expected.length && timingSafeEqual(supplied, expected) && /^[a-f0-9]{64}$/.test(req.headers['x-zelo-session'] || '') ? { key: req.headers['x-zelo-session'], userId: id } : null;
      },
    };
    const app = await start({ port: 0, webhookPort: 0, dataDir, cloudConfig, ownerId: id, snapshotId, backupKey, authDelegate: auth });
    try {
      // publicUrl remains compatible with the UI that appends /webhook.
      await app.settings.update({ publicUrl: origin + '/w/' + id });
      await app.runtime.flushBackup();
      return { ...app, secret, id };
    } catch (error) { await app.close().catch(() => {}); throw error; }
  }
  return {
    async get(id) {
      if (closed) throw fail('Servidor encerrando.', 503);
      if (!validOwner(id)) throw fail('Ambiente inválido.', 403);
      if (!contexts.has(id)) {
        const pending = create(id).catch(error => { contexts.delete(id); throw error; });
        contexts.set(id, pending);
      }
      return contexts.get(id);
    },
    async pause(id) { const pending = contexts.get(id); if (!pending) return; contexts.delete(id); const app = await pending; await app.close(); },
    async close() { closed = true; const pending = [...contexts.values()]; contexts.clear(); await Promise.all(pending.map(async item => (await item).close())); },
  };
}
