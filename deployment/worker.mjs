import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { createSupabase } from '../lib/supabase/supabase-client.mjs';
import { createSupabaseAuth } from '../lib/supabase/supabase-auth.mjs';
import { createWorkspaceAccess } from '../lib/workspaces/workspace-access.mjs';
import { createWorkspaceManager, originalAccount } from '../lib/workspaces/workspace-manager.mjs';
import { createWorkspaceRouter } from '../lib/workspaces/workspace-router.mjs';
import { createTunnel } from '../lib/tunnel/tunnel.mjs';
import { createBridge } from './bridge.mjs';
import { encryptRecord } from './records.mjs';
import { createLease } from './lease.mjs';

const cloud=createSupabase({url:process.env.SUPABASE_URL,secretKey:process.env.SUPABASE_SECRET_KEY,publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY});
const key=process.env.SUPABASE_BACKUP_KEY, lease=createLease(cloud,key);
let app,manager,bridge,tunnel,heartbeat,gatewayTimer,renewing,stopping=false,owned=false,stage='lease',exitCode=0;
async function stop(code=0){
  exitCode = Math.max(exitCode,code);
  if(stopping)return;
  stopping=true;
  clearInterval(gatewayTimer);
  tunnel?.stop();
  try { await bridge?.close(); }
  finally {
    try { if(app) await app.close(); else await manager?.close(); }
    catch { exitCode=1; console.error('Zelo: encerramento incompleto; confira o último backup.'); }
    clearInterval(heartbeat);
    await renewing;
    if(owned) await lease.release().catch(() => { exitCode=1; console.error('Zelo: aguarde a expiração da posse do worker.'); });
    process.exit(exitCode);
  }
}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>stop());
try {
  console.log('Zelo: aguardando a liberação do worker anterior.');
  while(!await lease.acquire())await pause(5000);
  owned=true;
  heartbeat=setInterval(()=>{
    if(renewing || !owned)return;
    renewing=lease.renew().catch(()=>{
      owned=false;
      lease.invalidate();
      console.error('Zelo: conexão de controle perdida; encerrando para evitar duplicidade.');
      void stop(1);
    }).finally(()=>{renewing=undefined;});
  },10000);
  stage='snapshot-fence';
  await lease.publish(null,5000);
  const directory=await mkdtemp(join(tmpdir(),'zelo-runtime-'));
  stage='workspaces';
  const original=await originalAccount(cloud,key);
  const origin=process.env.ZELO_PUBLIC_ORIGIN;
  if(!origin || new URL(origin).protocol!=='https:' || new URL(origin).origin!==origin)throw new Error('public origin');
  const cloudConfig={url:process.env.SUPABASE_URL,secretKey:process.env.SUPABASE_SECRET_KEY,publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY};
  const access=createWorkspaceAccess(cloud,createSupabaseAuth(cloud));
  manager=createWorkspaceManager({directory,cloud,cloudConfig,key,original,origin,assertActive:lease.assertActive,publishSnapshot:row=>lease.publish(row)});
  // Keep every authorized WhatsApp connection alive even when its owner logs out.
  await manager.warm(await access.list());
  app=await createWorkspaceRouter({access,manager,original,origin,assertActive:lease.assertActive});
  const secret=randomBytes(32).toString('hex');
  stage='bridge';
  bridge=await createBridge({target:app.url,webhookTarget:app.webhookUrl,secret});
  tunnel=createTunnel({dataDir:directory,port:bridge.port,settings:{update:async()=>{}}});
  stage='tunnel';
  await tunnel.start();
  async function publishGateway() {
    const {running,starting,url}=tunnel.state();
    if(!running && !starting) throw new Error('tunnel');
    if(url) await lease.publish(encryptRecord('gateway',{url,secret},key),5000);
  }
  await publishGateway();
  gatewayTimer=setInterval(()=>{
    if(!stopping) void publishGateway().catch(()=>{ console.error('Zelo: falha ao atualizar o gateway.'); void stop(1); });
  },10000);
  console.log('Zelo: atendimento e painel online; estado protegido no Supabase.');
} catch(error) {
  const hint = stage==='snapshot-fence' ? 'Aplique a migração 004 no Supabase antes de iniciar o worker.' : 'Confira as variáveis e o backup no Supabase.';
  console.error(`Zelo: falha na etapa ${stage} (${error.code || error.name || 'Error'}). ${hint}`);
  await stop(1);
}
