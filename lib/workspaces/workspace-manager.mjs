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
export function createWorkspaceManager({ directory, cloud, cloudConfig, key, original, origin, originalDirectory, persistent = false, start = startServer, assertActive = () => {}, publishSnapshot }) {
  const contexts = new Map(), initialized = new Set(), paused = new Set(), closing = new Map();
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
    assertActive();
    const app = await start({ port: 0, webhookPort: 0, dataDir, cloudConfig, ownerId: id, snapshotId, backupKey, authDelegate: auth, assertActive, publishSnapshot });
    try {
      // publicUrl remains compatible with the UI that appends /webhook.
      await app.settings.update({ publicUrl: origin + '/w/' + id });
      await app.runtime.flushBackup();
      return { ...app, secret, id };
    } catch (error) { await app.close().catch(() => {}); throw error; }
  }
  function assertAvailable(id) {
    assertActive();
    if (closed) throw fail('Servidor encerrando.', 503);
    if (!validOwner(id) || paused.has(id)) throw fail('Ambiente indisponível.', 403);
  }
  async function get(id) {
    assertAvailable(id);
    if (!contexts.has(id)) {
      const pending = create(id).catch(error => { if (contexts.get(id) === pending) contexts.delete(id); throw error; });
      contexts.set(id, pending);
    }
    const app = await contexts.get(id);
    assertAvailable(id);
    return app;
  }
  const closeApp = async pending => { const app = await pending.catch(() => null); await app?.close(); };
  return {
    get,
    async warm(members) {
      for (const member of members) {
        if (closed) break;
        if (!member.enabled || !member.user_id) continue;
        try { await get(member.user_id); }
        catch (error) {
          if (error.leaseLost) throw error;
          console.error(`Zelo: ambiente ${member.user_id} indisponível. Confira a restauração e a conexão desta conta.`);
        }
      }
    },
    async pause(id) {
      paused.add(id);
      if (closing.has(id)) return closing.get(id);
      const pending = contexts.get(id);
      if (!pending) return;
      contexts.delete(id);
      const cleanup = closeApp(pending).finally(() => closing.delete(id));
      closing.set(id, cleanup);
      await cleanup;
    },
    async resume(id) {
      await closing.get(id);
      paused.delete(id);
      return get(id);
    },
    async close() {
      closed = true;
      const pending = [...contexts.values()].map(closeApp);
      contexts.clear();
      const results = await Promise.allSettled([...pending, ...closing.values()]);
      const failure = results.find(item => item.status === 'rejected');
      if (failure) throw failure.reason;
    },
  };
}
