import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createWorkspaceAccess } from '../lib/workspaces/workspace-access.mjs';
import { createWorkspaceManager, workspaceKey, originalAccount } from '../lib/workspaces/workspace-manager.mjs';
import { createStateBackup } from '../lib/supabase/supabase-state.mjs';
import { createWorkspaceRouter } from '../lib/workspaces/workspace-router.mjs';
import { createSupabaseCatalog } from '../lib/supabase/supabase-catalog.mjs';
import { decodeSnapshot } from '../deployment/restore.mjs';
import { startServer } from '../server.mjs';
import { createQrAuth } from '../lib/whatsapp/qr-auth.mjs';
import { testDirectory } from './helpers.mjs';

export function fixture() {
  const tables = new Map(['zelo_workspaces','zelo_products','zelo_product_files','zelo_runtime_snapshots'].map(name=>[name,[]])), objects = new Map(), calls = [];
  function selected(url, row) {
    for (const [key,value] of url.searchParams) {
      if (['select','order','on_conflict'].includes(key)) continue;
      if (value === 'is.null' && row[key] != null) return false;
      if (value.startsWith('eq.') && String(row[key]) !== value.slice(3)) return false;
    }
    return true;
  }
  const request = async (path, options={}) => {
    const method=options.method || 'GET', data=options.body, url=new URL('https://test'+path); calls.push({path,method,data});
    if (path.startsWith('/storage/v1/object/sign/')) return {signedURL:'/object/sign/zelo-materials/test?token=test'};
    if (path.startsWith('/storage/v1/object/')) {
      if (method==='POST') objects.set(path,Buffer.from(data));
      if (method==='DELETE') objects.delete(path);
      return options.binary ? objects.get(path) : {};
    }
    if (path.startsWith('/rest/v1/rpc/')) {
      const products=tables.get('zelo_products'), files=tables.get('zelo_product_files');
      if (path.endsWith('workspace_save_product')) {
        const previous=products.find(row=>row.id===data.target_id);
        if (previous) { assert.equal(previous.owner_id,data.target_owner); Object.assign(previous,data.payload,{revision:previous.revision+1}); }
        else products.push({...data.payload,id:data.target_id,owner_id:data.target_owner,revision:1});
      } else if (path.endsWith('workspace_register_file')) { files.push({...data.payload,owner_id:data.target_owner}); products.find(row=>row.id===data.payload.product_id).revision++; }
      return null;
    }
    const name=url.pathname.split('/').pop(), table=tables.get(name);
    if (!table) throw new Error('Unexpected path '+path);
    const matching=table.filter(row=>selected(url,row));
    if (method==='GET') return structuredClone(matching);
    if (method==='PATCH') { matching.forEach(row=>Object.assign(row,data)); return structuredClone(matching); }
    if (method==='POST') {
      const column=url.searchParams.get('on_conflict') || 'id', before=table.find(row=>row[column]===data[column]);
      if (before) Object.assign(before,data); else table.push({enabled:true,user_id:null,...structuredClone(data)});
      return null;
    }
    throw new Error('Unexpected mutation');
  };
  const cloud={origin:'https://project.supabase.co',request};
  const cloudConfig={url:cloud.origin,secretKey:'test-private',publishableKey:'test-public',fetchImpl:async(url,options)=>{
    const body=options.body === undefined ? undefined : options.headers['Content-Type']==='application/json' ? JSON.parse(options.body) : options.body;
    const result=await request(url.slice(cloud.origin.length),{method:options.method,body,binary:!options.headers['Content-Type'] && url.includes('/storage/v1/object/') && !url.includes('/sign/')});
    return result instanceof Uint8Array ? new Response(result) : result === null ? new Response(null,{status:204}) : Response.json(result);
  }};
  const passwords=new Map(), ids=new Map();
  const provider={async login({username,password}) { if (!passwords.has(username) || passwords.get(username)!==password) throw Object.assign(new Error('denied'),{status:401}); return ids.get(username); },async create({username,password}) { if (ids.has(username)) throw Error('exists'); const id=randomUUID();ids.set(username,id);passwords.set(username,password);return id; }};
  return {cloud,cloudConfig,tables,calls,objects,provider,passwords,ids};
}
const password='test-only-workspace-password-2026';

test('migração confere identidade original pela Auth Admin API antes de atribuir os dados',async()=>{
  const f=fixture(), directory=await testDirectory(), key='c'.repeat(64), userId=randomUUID();
  await writeFile(join(directory,'auth.json'),JSON.stringify({provider:'supabase',username:'owner@test.example',userId}));
  const backup=createStateBackup({client:{execute:async()=>({rows:[]})},dataDir:directory,cloud:f.cloud,key});
  await backup.run(); await backup.close();
  let identity={id:userId,email:'another@test.example'};
  const cloud={request:(path,options)=>path.startsWith('/auth/v1/admin/users/') ? identity : f.cloud.request(path,options)};
  await assert.rejects(originalAccount(cloud,key),/Vínculo/);
  assert.ok(!f.calls.some(call=>call.path.endsWith('zelo_claim_legacy')));
  identity={id:userId,email:'OWNER@test.example'};
  assert.equal((await originalAccount(cloud,key)).userId,userId);
  assert.equal(f.calls.filter(call=>call.path.endsWith('zelo_claim_legacy')).length,1);
});

test('convites: uso único, expiração, senha, cadastro externo não autorizado e administrador protegido',async()=>{
  const f=fixture(); let now=100000;
  const access=createWorkspaceAccess(f.cloud,f.provider,{clock:()=>now,maxAccounts:2});
  const owner=randomUUID(); f.tables.get('zelo_workspaces').push({email:'owner@test.example',user_id:owner,role:'owner',enabled:true,created:1});
  const invite=await access.invite(' Guest@Test.example ');
  assert.equal(invite.email,'guest@test.example'); assert.ok(!JSON.stringify(f.tables.get('zelo_workspaces')).includes(invite.token));
  await assert.rejects(access.accept({token:invite.token,password:'short'}));
  const row=await access.accept({token:invite.token,password}); assert.equal(row.role,'member');
  await assert.rejects(access.accept({token:invite.token,password}),error=>error.status===403);
  await assert.rejects(access.invite('third@test.example'),error=>error.status===409);
  await f.provider.create({username:'outsider@test.example',password});
  await assert.rejects(access.login({username:'outsider@test.example',password}),error=>error.status===401);
  await access.setEnabled(row.email,false); assert.equal(await access.member(row.user_id),null);
  await assert.rejects(access.setEnabled('owner@test.example',false),error=>error.status===403);
  const exp=fixture(), expAccess=createWorkspaceAccess(exp.cloud,exp.provider,{clock:()=>now});
  const expired=await expAccess.invite('expired@test.example'); now+=49*60*60*1000;
  await assert.rejects(expAccess.invitation(expired.token),error=>error.status===403);
});

test('catálogo remoto isola consultas, arquivos, links assinados, mutações e caminhos de Storage',async()=>{
  const f=fixture(), a=randomUUID(), b=randomUUID(), ca=createSupabaseCatalog(f.cloud,a), cb=createSupabaseCatalog(f.cloud,b);
  const product=await ca.save({name:'Produto privado A'});
  const file=await ca.upload(product.id,Buffer.from('%PDF-1.7\ntest'),'book.pdf','application/pdf');
  assert.equal((await ca.list()).length,1); assert.deepEqual(await cb.list(),[]);
  for (const operation of [()=>cb.get(product.id),()=>cb.save({name:'roubado',revision:2},product.id),()=>cb.upload(product.id,Buffer.from('%PDF-x'),'x.pdf','application/pdf'),()=>cb.removeFile(product.id,file.id,2),()=>cb.file(file.id),()=>cb.signedFile(file.id)]) await assert.rejects(operation,error=>error.status===404);
  assert.ok([...f.objects.keys()][0].includes('/'+a+'/'+product.id+'/'));
  assert.equal((await ca.file(file.id)).bytes.toString(),'%PDF-1.7\ntest');
  assert.match(await ca.signedFile(file.id),/^https:\/\/project.supabase.co\/storage/);
  assert.throws(()=>createSupabaseCatalog(f.cloud,'../another'));
});

test('duas contas: APIs, instruções, QR, memória, anexos e backups independentes; logout e suspensão',async()=>{
  const f=fixture(), original={userId:randomUUID()}, directory=await testDirectory(), key='a'.repeat(64);
  const access=createWorkspaceAccess(f.cloud,f.provider), sockets=[];
  const ownerId=await f.provider.create({username:'owner@test.example',password}); original.userId=ownerId;
  f.tables.get('zelo_workspaces').push({email:'owner@test.example',user_id:ownerId,role:'owner',enabled:true,created:1});
  const invite=await access.invite('member@test.example'), member=await access.accept({token:invite.token,password});
  // No legacy data: initialize this test owner like any new tenant.
  const manager=createWorkspaceManager({directory,cloud:f.cloud,cloudConfig:f.cloudConfig,key,original:{userId:randomUUID()},origin:'https://zelo.test',start:options=>startServer({...options,qrSocketFactory:opts=>{ const socket={ev:new EventEmitter(),options:opts,end(){},logout:async()=>{}};sockets.push(socket);return socket; }})});
  const router=await createWorkspaceRouter({access,manager,original,origin:'https://zelo.test'});
  const send=(path,input,cookie='',headers={})=>fetch(router.url+path,{...(input===undefined?{}:{method:'POST',body:JSON.stringify(input)}),headers:{'Content-Type':'application/json',cookie,...headers},redirect:'manual'});
  try {
    assert.equal((await send('/api/products')).status,401);
    const anonymousAdmin=await send('/admin/access');
    assert.equal(anonymousAdmin.status,302); assert.equal(anonymousAdmin.headers.get('location'),'/login?next=%2Fadmin%2Faccess');
    const loginA=await send('/api/auth/login',{username:'owner@test.example',password}), cookieA=loginA.headers.get('set-cookie').split(';')[0];
    const loginB=await send('/api/auth/login',{username:'member@test.example',password}), cookieB=loginB.headers.get('set-cookie').split(';')[0];
    assert.equal(loginA.status,200); assert.equal(loginB.status,200);
    const [a,a2,b]=await Promise.all([manager.get(ownerId),manager.get(ownerId),manager.get(member.user_id)]); assert.equal(a,a2); assert.notEqual(a.runtime.client,b.runtime.client);
    await a.settings.saveAiKey({label:'Privada',provider:'gemini',model:'gemini-2.5-flash',apiKey:'secret-only-A',enabled:true});
    await a.runtime.saveKnowledge('Informação exclusiva da conta A');
    await a.runtime.memory.append({id:'private-turn',contactId:'same-contact',role:'user',text:'Conversa exclusiva A',timestamp:Date.now()});
    await a.settings.update({assistantName:'Empresa A',instructions:'Instruções exclusivas A'});
    const bDashboard=await (await send('/api/dashboard',undefined,cookieB,{'x-zelo-workspace-secret':a.secret,'x-zelo-session':'a'.repeat(64)})).json();
    assert.equal(bDashboard.settings.assistantName,'Assistente'); assert.equal(bDashboard.settings.aiKeys.length,0); assert.equal(bDashboard.settings.autoReply,false);
    assert.equal((await (await send('/api/state',undefined,cookieB)).json()).knowledge,'');
    assert.deepEqual(await b.runtime.memory.load('same-contact'),[]);
    assert.equal((await send('/api/ai/keys/'+a.settings.get().aiKeys[0].id+'/remove',{revision:1},cookieB)).status,404);
    const product=await (await send('/api/products',{name:'Privado A',links:[]},cookieA)).json();
    assert.equal((await (await send('/api/products',undefined,cookieB)).json()).length,0);
    assert.equal((await send('/api/products/'+product.id,{name:'Invadido',revision:1},cookieB)).status,404);
    assert.ok(!(await readFile(join(directory,member.user_id,'settings.json'),'utf8')).includes('secret-only-A'));
    await a.qr.connect(); sockets[0].ev.emit('connection.update',{qr:'private-qr-A'}); await a.qr.idle();
    assert.match(a.qr.state().qr,/^data:/); assert.equal(b.qr.state().qr,'');
    const qrA=await createQrAuth(a.runtime.client), qrB=await createQrAuth(b.runtime.client);
    await qrA.state.keys.set({session:{contact:Buffer.from('credential-only-A')}});
    assert.equal((await qrB.state.keys.get('session',['contact'])).contact,null);
    await qrA.close(); await qrB.close();
    assert.equal((await send('/api/workspace/accounts',undefined,cookieB)).status,403);
    assert.equal((await send('/admin/access',undefined,cookieB)).status,403);
    assert.equal((await (await send('/api/workspace',undefined,cookieB)).json()).isMaster,false);
    assert.equal((await (await send('/api/workspace',undefined,cookieA)).json()).isMaster,true);
    assert.equal((await send('/admin/access',undefined,cookieA)).status,200);
    assert.equal((await send('/admin/access',{},cookieA)).status,405);
    // An owner label alone must never grant the original master's authority.
    f.tables.get('zelo_workspaces').find(row=>row.user_id===member.user_id).role='owner';
    assert.equal((await send('/admin/access',undefined,cookieB)).status,403);
    assert.equal((await send('/api/workspace/accounts',undefined,cookieB)).status,403);
    assert.equal((await send('/api/workspace/access',{email:'owner@test.example',enabled:false},cookieB)).status,403);
    f.tables.get('zelo_workspaces').find(row=>row.user_id===member.user_id).role='member';
    assert.equal((await send('/api/workspace/invites',{email:'attacker@test.example',role:'owner'},cookieB)).status,403);
    assert.equal((await send('/api/workspace/accounts',undefined,cookieA)).status,200);
    assert.equal((await send('/api/settings',{assistantName:'evil'},cookieB,{Origin:'https://evil.test'})).status,403);
    assert.equal((await fetch(a.url+'/api/dashboard',{headers:{'x-zelo-workspace-secret':b.secret,'x-zelo-session':'a'.repeat(64)}})).status,401);
    assert.equal((await send('/api/auth/setup',{setupToken:'a'.repeat(64)},cookieB)).status,404);
    await a.runtime.flushBackup(); await b.runtime.flushBackup();
    const rowA=f.tables.get('zelo_runtime_snapshots').find(row=>row.id==='workspace:'+ownerId), rowB=f.tables.get('zelo_runtime_snapshots').find(row=>row.id==='workspace:'+member.user_id);
    assert.ok(decodeSnapshot(rowA,workspaceKey(key,ownerId)).files['settings.json'].includes('secret-only-A'));
    assert.ok(!decodeSnapshot(rowB,workspaceKey(key,member.user_id)).files['settings.json'].includes('secret-only-A'));
    assert.throws(()=>decodeSnapshot(rowA,workspaceKey(key,member.user_id)));
    assert.equal((await send('/api/workspace/access',{email:member.email,enabled:false},cookieA)).status,200);
    assert.equal((await send('/api/dashboard',undefined,cookieB)).status,401);
    await send('/api/workspace/access',{email:member.email,enabled:true},cookieA);
    const again=await send('/api/auth/login',{username:member.email,password}); assert.equal(again.status,200);
    const reopened=await manager.get(member.user_id); assert.equal(reopened.settings.get().assistantName,'Assistente');
    await send('/api/auth/logout',{},cookieA); assert.equal((await send('/api/products',undefined,cookieA)).status,401);
    assert.ok(a.qr.state().qr); // Logging out does not shut down automatic service.
  } finally { await router.close(); }
  const restoredManager=createWorkspaceManager({directory:await testDirectory(),cloud:f.cloud,cloudConfig:f.cloudConfig,key,original:{userId:randomUUID()},origin:'https://zelo.test'});
  try {
    const a=await restoredManager.get(ownerId), b=await restoredManager.get(member.user_id);
    assert.equal(a.settings.get().assistantName,'Empresa A');
    assert.equal(a.settings.get().aiKeys[0].apiKey,'secret-only-A');
    assert.equal(b.settings.get().aiKeys.length,0);
    assert.equal((await a.runtime.state('same-contact')).knowledge,'Informação exclusiva da conta A');
    assert.equal((await b.runtime.state('same-contact')).knowledge,'');
    assert.equal((await a.runtime.memory.load('same-contact'))[0].text,'Conversa exclusiva A');
    assert.deepEqual(await b.runtime.memory.load('same-contact'),[]);
  } finally { await restoredManager.close(); }
});

