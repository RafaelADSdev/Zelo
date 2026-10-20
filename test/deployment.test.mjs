import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createBridge } from '../deployment/bridge.mjs';
import { encryptRecord, decryptRecord } from '../deployment/records.mjs';
import { createProxy } from '../deployment/proxy.mjs';
import { createUploads } from '../deployment/uploads.mjs';
import { createLease } from '../deployment/lease.mjs';
import { decodeSnapshot } from '../deployment/restore.mjs';
import { createCipheriv, randomBytes, createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

test('gateway exige segredo e preserva login, cookies e isolamento do servidor local', async () => {
  let seen;
  const target = createServer((req,res) => { seen = req.headers; res.setHeader('Set-Cookie', ['zelo_auth=abc; HttpOnly; SameSite=Strict; Path=/']); res.end(req.url); });
  await new Promise(resolve => target.listen(0,'127.0.0.1',resolve));
  const bridge = await createBridge({ target: `http://127.0.0.1:${target.address().port}`, secret: 'a'.repeat(64) });
  try {
    assert.equal((await fetch(bridge.url+'/api/products')).status,403);
    assert.equal((await fetch(bridge.url+'/api/shutdown',{headers:{'x-zelo-gateway':'a'.repeat(64)}})).status,404);
    const response = await fetch(bridge.url+'/api/products',{headers:{'x-zelo-gateway':'a'.repeat(64),cookie:'zelo_auth=abc',origin:'https://evil.example','x-forwarded-for':'untrusted'}});
    assert.equal(response.status,200); assert.equal(await response.text(),'/api/products');
    assert.equal(seen.origin,undefined); assert.equal(seen['x-forwarded-for'],undefined); assert.equal(seen.cookie,'zelo_auth=abc');
    assert.match(response.headers.get('set-cookie'),/Secure/);
  } finally { await bridge.close(); await new Promise(resolve=>target.close(resolve)); }
});

test('registro do gateway é autenticado, cifrado e rejeita adulteração', () => {
  const key = 'b'.repeat(64), value = {url:'https://test.trycloudflare.com',secret:'private'};
  const record = encryptRecord('gateway',value,key);
  assert.ok(!JSON.stringify(record).includes('private'));
  assert.deepEqual(decryptRecord(record,key),value);
  assert.throws(()=>decryptRecord({...record,tag:Buffer.alloc(16).toString('base64')},key));
});

test('Vercel rejeita CSRF e caminhos de controle antes de alcançar o servidor', async () => {
  let called = 0;
  const handler = createProxy({ origin:'https://zelo.example', gateway: async()=>{called++;throw new Error('offline');} });
  const server = createServer(handler); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(url+'/api/auth/login',{method:'POST',headers:{Origin:'https://evil.example'}})).status,403);
    assert.equal((await fetch(url+'/api/auth/login',{method:'POST',headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
    assert.equal((await fetch(url+'/.env')).status,404);
    assert.equal((await fetch(url+'/api/shutdown',{method:'POST'})).status,404);
    assert.equal(called,0);
    const response = await fetch(url+'/api/auth/status'); assert.equal(response.status,503);
    assert.ok(!(await response.text()).includes('offline'));
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('envio em partes exige a mesma sessão, sequência e arquivo completo antes de persistir', async()=>{
  let received;
  const upload=createUploads({upload:async(...args)=>{received=args;return {id:'saved'};}});
  const {id}=upload.start({productId:'a'.repeat(8)+'-aaaa-aaaa-aaaa-'+ 'a'.repeat(12),name:'book.pdf',mime:'application/pdf',size:6},'owner');
  assert.throws(()=>upload.append(id,'other',0,Buffer.from('abc')),error=>error.status===404);
  assert.throws(()=>upload.append(id,'owner',3,Buffer.from('abc')),error=>error.status===409);
  upload.append(id,'owner',0,Buffer.from('abc'));
  await assert.rejects(upload.finish(id,'owner'),error=>error.status===409);
  upload.append(id,'owner',3,Buffer.from('def'));
  assert.deepEqual(await upload.finish(id,'owner'),{id:'saved'});assert.equal(received[1].toString(),'abcdef');
  await assert.rejects(upload.finish(id,'owner'),error=>error.status===404);
});

test('lease impede dois workers e permite assumir após expiração',async()=>{
  let row,now=100000;
  const cloud={request:async(path,options={})=>{
    if(options.method==='POST'){row ||= options.body;return null;}
    if(options.method==='PATCH'){
      const query=new URL('https://test'+path).searchParams;
      if(query.get('sha256')!=='eq.'+row.sha256 || query.get('updated')!=='eq.'+row.updated)return [];
      row=options.body;return [row];
    }
    if(options.method==='DELETE'){row=null;return null;}return row?[row]:[];
  }};
  const a=createLease(cloud,'b'.repeat(64),()=>now),b=createLease(cloud,'b'.repeat(64),()=>now);
  assert.equal(await a.acquire(),true);assert.equal(await b.acquire(),false);
  now+=10000;await a.renew();now+=46000;assert.equal(await b.acquire(),true);
  await assert.rejects(a.renew());await b.release();assert.equal(row,null);
});

test('restauração do backup confere GCM e hash antes de usar dados ou chaves',()=>{
  const key=randomBytes(32),iv=randomBytes(12),value=Buffer.from(JSON.stringify({version:1,tables:[],files:{'settings.json':'{"secret":"test"}'}}));
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  const row={version:1,iv:iv.toString('base64'),ciphertext:Buffer.concat([cipher.update(gzipSync(value)),cipher.final()]).toString('base64'),tag:cipher.getAuthTag().toString('base64'),sha256:createHash('sha256').update(value).digest('hex')};
  assert.equal(decodeSnapshot(row,key.toString('hex')).files['settings.json'],'{"secret":"test"}');
  assert.throws(()=>decodeSnapshot({...row,sha256:'0'.repeat(64)},key.toString('hex')));
  assert.throws(()=>decodeSnapshot(row,'0'.repeat(64)));
});
