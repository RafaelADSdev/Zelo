import { createDecipheriv, createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdir, writeFile, access, mkdtemp, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
export async function restoreState({cloud,key,directory,snapshotId="primary",allowMissing=false}) {
  try {await access(join(directory,'wappy.db'));throw new Error('Restauração exige um diretório vazio.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const row=await readRecord(cloud,snapshotId);if(!row && allowMissing)return null;if(!row)throw new Error('Backup inicial não encontrado. Migre os dados antes de publicar.');
  const snapshot=decodeSnapshot(row,key);
  const files=['settings.json','base.txt','auth.json'].filter(name=>typeof snapshot.files?.[name]==='string');
  await mkdir(dirname(directory),{recursive:true});
  const staging=await mkdtemp(join(dirname(directory),'.zelo-restore-'));
  const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
  const value=item=>item?.$bytes ? Buffer.from(item.$bytes,'base64') : item?.$bigint ? BigInt(item.$bigint) : item;
  try {
    const client=createClient({url:':memory:'});
    try {
      for(const table of snapshot.tables){
        await client.execute(table.sql);
        const sql=`INSERT INTO ${quote(table.name)} (${table.columns.map(quote).join(',')}) VALUES (${table.columns.map(()=>'?').join(',')})`;
        for(let start=0;start<table.rows.length;start+=100)await client.batch(table.rows.slice(start,start+100).map(row=>({sql,args:row.map(value)})),'write');
      }
      // VACUUM closes the output before returning, including on Windows where libSQL can keep a file handle.
      await client.execute({sql:'VACUUM INTO ?',args:[join(staging,'wappy.db')]});
    } finally {client.close();}
    for(const name of files)await writeFile(join(staging,name),snapshot.files[name],{mode:0o600});
    await mkdir(directory,{recursive:true});
    for(const name of files)await rename(join(staging,name),join(directory,name));
    // The database is the commit marker even when the destination already contains server files.
    await rename(join(staging,'wappy.db'),join(directory,'wappy.db'));
  } finally {
    for(const name of [...files,'wappy.db']) {
      await rm(join(staging,name),{force:true});
    }
    await rmdir(staging);
  }
  return {tables:snapshot.tables.length,updated:Number(row.updated)};
}
