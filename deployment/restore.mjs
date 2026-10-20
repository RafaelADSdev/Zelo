import { createDecipheriv, createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { readRecord } from './records.mjs';
export function decodeSnapshot(row,key) {
  if(!/^[a-f0-9]{64}$/.test(key||'') || row.version!==1)throw new Error('Backup incompatível.');
  const decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(row.iv,'base64'));
  decipher.setAuthTag(Buffer.from(row.tag,'base64'));
  const plaintext=gunzipSync(Buffer.concat([decipher.update(Buffer.from(row.ciphertext,'base64')),decipher.final()]),{maxOutputLength:128*1024*1024});
  if(createHash('sha256').update(plaintext).digest('hex')!==row.sha256)throw new Error('Backup sem integridade.');
  const snapshot=JSON.parse(plaintext);if(snapshot.version!==1 || !Array.isArray(snapshot.tables))throw new Error('Backup inválido.');return snapshot;
}
export async function restoreState({cloud,key,directory}) {
  await mkdir(directory,{recursive:true});
  try {await access(join(directory,'wappy.db'));throw new Error('Restauração exige um diretório vazio.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const row=await readRecord(cloud,'primary');if(!row)throw new Error('Backup inicial não encontrado. Migre os dados antes de publicar.');
  const snapshot=decodeSnapshot(row,key), client=createClient({url:pathToFileURL(join(directory,'wappy.db')).href});
  const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
  const value=item=>item?.$bytes ? Buffer.from(item.$bytes,'base64') : item?.$bigint ? BigInt(item.$bigint) : item;
  try {
    for(const table of snapshot.tables){
      await client.execute(table.sql);
      const sql=`INSERT INTO ${quote(table.name)} (${table.columns.map(quote).join(',')}) VALUES (${table.columns.map(()=>'?').join(',')})`;
      for(let start=0;start<table.rows.length;start+=100)await client.batch(table.rows.slice(start,start+100).map(row=>({sql,args:row.map(value)})),'write');
    }
    for(const name of ['settings.json','base.txt','auth.json'])if(typeof snapshot.files?.[name]==='string')await writeFile(join(directory,name),snapshot.files[name],{mode:0o600});
  } finally {client.close();}
  return {tables:snapshot.tables.length,updated:Number(row.updated)};
}
