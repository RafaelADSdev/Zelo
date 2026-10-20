import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
const keyBytes = key => { if (!/^[a-f0-9]{64}$/.test(key || '')) throw new Error('Chave de implantação inválida.'); return Buffer.from(key,'hex'); };
export function encryptRecord(id, value, key, updated = Date.now()) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm',keyBytes(key),iv);
  cipher.setAAD(Buffer.from(`${id}:${updated}`));
  const bytes = Buffer.from(JSON.stringify(value));
  return {id,version:1,ciphertext:Buffer.concat([cipher.update(bytes),cipher.final()]).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex'),updated};
}
export function decryptRecord(row,key) {
  const cipher = createDecipheriv('aes-256-gcm',keyBytes(key),Buffer.from(row.iv,'base64'));
  cipher.setAAD(Buffer.from(`${row.id}:${row.updated}`)); cipher.setAuthTag(Buffer.from(row.tag,'base64'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(row.ciphertext,'base64')),cipher.final()]).toString());
}
export const snapshotPath = '/rest/v1/zelo_runtime_snapshots';
export async function saveRecord(cloud,row) {
  await cloud.request(snapshotPath+'?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:row});
}
export async function readRecord(cloud,id) { return (await cloud.request(snapshotPath+`?id=eq.${encodeURIComponent(id)}&select=*`))[0]; }
