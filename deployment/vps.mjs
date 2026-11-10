import { loadEnvFile } from 'node:process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSupabase } from '../lib/supabase/supabase-client.mjs';
import { createSupabaseAuth } from '../lib/supabase/supabase-auth.mjs';
import { createWorkspaceAccess, validOwner } from '../lib/workspaces/workspace-access.mjs';
import { createWorkspaceManager } from '../lib/workspaces/workspace-manager.mjs';
import { createWorkspaceRouter } from '../lib/workspaces/workspace-router.mjs';
import { startServer } from '../server.mjs';

export async function startVpsServer({ directory, cloudConfig, key, origin, port = 44173, webhookPort = 44174 }) {
  const publicUrl = new URL(origin);
  if (publicUrl.protocol !== 'https:' || publicUrl.origin !== origin) throw new Error('Configure a URL pública HTTPS do Zelo.');
  const original = JSON.parse(await readFile(join(directory, 'auth.json'), 'utf8'));
  if (original.provider !== 'supabase' || !validOwner(original.userId)) throw new Error('Administrador da VPS inválido.');
  const cloud = createSupabase(cloudConfig);
  const access = createWorkspaceAccess(cloud, createSupabaseAuth(cloud));
  const owner = await access.member(original.userId);
  if (owner?.role !== 'owner' || owner.email !== original.username) throw new Error('Vínculo do administrador da VPS inválido.');
  const manager = createWorkspaceManager({
    directory: join(directory, 'workspaces'), originalDirectory: directory, persistent: true,
    cloud, cloudConfig, key, original, origin,
    start: options => startServer({ ...options, webhookPort: options.ownerId === original.userId ? webhookPort : 0 }),
  });
  try {
    for (const member of await access.list()) {
      if (member.enabled && member.user_id) await manager.get(member.user_id);
    }
    return await createWorkspaceRouter({ access, manager, original, origin, port, streamFiles: true });
  } catch (error) {
    await manager.close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  try { loadEnvFile(join(root, '.env')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const app = await startVpsServer({
    directory: join(root, '.wappy'),
    cloudConfig: { url: process.env.SUPABASE_URL, secretKey: process.env.SUPABASE_SECRET_KEY, publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY },
    key: process.env.SUPABASE_BACKUP_KEY,
    origin: process.env.ZELO_PUBLIC_ORIGIN,
    port: Number(process.env.PORT || 44173),
    webhookPort: Number(process.env.WEBHOOK_PORT || 44174),
  });
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    try { await app.close(); process.exit(0); }
    catch { console.error('Zelo: confira o último backup após o encerramento.'); process.exit(1); }
  });
  console.log('Zelo: acesso de usuários disponível na VPS.');
}
