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
import { encryptRecord,saveRecord } from './records.mjs';
import { createLease } from './lease.mjs';

const cloud=createSupabase({url:process.env.SUPABASE_URL,secretKey:process.env.SUPABASE_SECRET_KEY,publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY});
const key=process.env.SUPABASE_BACKUP_KEY, lease=createLease(cloud,key);
let app,bridge,tunnel,timer,stopping=false,renewing=false,owned=false,stage='lease';
async function stop(code=0){
  if(stopping)return;stopping=true;clearInterval(timer);tunnel?.stop();
  try{await bridge?.close();await app?.close();if(owned)await lease.release();}catch{console.error('Zelo: encerramento incompleto; confira o último backup.');}
  process.exit(code);
}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>stop());
try {
  console.log('Zelo: aguardando a liberação do worker anterior.');
  while(!await lease.acquire())await pause(5000);
  owned=true;
  timer=setInterval(async()=>{
    if(renewing || stopping)return;renewing=true;
    try{await lease.renew();if(tunnel && !tunnel.state().running && !tunnel.state().starting)throw new Error('tunnel');if(tunnel?.state().url)await saveRecord(cloud,encryptRecord('gateway',{url:tunnel.state().url,secret},key));}
    catch{owned=false;console.error('Zelo: conexão de controle perdida; encerrando para evitar duplicidade.');await stop(1);}finally{renewing=false;}
  },10000);
  const directory=await mkdtemp(join(tmpdir(),'zelo-runtime-'));
  stage='workspaces';
  const original=await originalAccount(cloud,key);
  const origin=process.env.ZELO_PUBLIC_ORIGIN;
  if(!origin || new URL(origin).protocol!=='https:')throw new Error('public origin');
  const cloudConfig={url:process.env.SUPABASE_URL,secretKey:process.env.SUPABASE_SECRET_KEY,publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY};
  const access=createWorkspaceAccess(cloud,createSupabaseAuth(cloud));
  const manager=createWorkspaceManager({directory,cloud,cloudConfig,key,original,origin});
  // Keep every authorized WhatsApp connection alive even when its owner logs out.
  for(const member of await access.list())if(member.enabled && member.user_id)await manager.get(member.user_id);
  app=await createWorkspaceRouter({access,manager,original,origin});
  const secret=randomBytes(32).toString('hex');
  stage='bridge';
  bridge=await createBridge({target:app.url,webhookTarget:app.webhookUrl,secret});
  tunnel=createTunnel({dataDir:directory,port:bridge.port,settings:{update:async()=>{}}});
  stage='tunnel';
  await tunnel.start();
  await saveRecord(cloud,encryptRecord('gateway',{url:tunnel.state().url,secret},key));
  console.log('Zelo: atendimento e painel online; estado protegido no Supabase.');
} catch(error) {console.error(`Zelo: falha na etapa ${stage} (${error.code || error.name || 'Error'}). Confira as variáveis e o backup no Supabase.`);await stop(1);}
