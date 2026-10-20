import { createSupabase } from '../supabase-client.mjs';
import { createProxy } from '../deployment/proxy.mjs';
import { readRecord, decryptRecord } from '../deployment/records.mjs';
export const config = {api:{bodyParser:false}};
export default async function handler(req,res) {
  const origin=process.env.ZELO_PUBLIC_ORIGIN;
  if(!origin || !process.env.SUPABASE_URL){res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end('{"error":"Configuração da hospedagem pendente."}');}
  const cloud=createSupabase({url:process.env.SUPABASE_URL,secretKey:process.env.SUPABASE_SECRET_KEY});
  return createProxy({origin,gateway:async()=>{const row=await readRecord(cloud,'gateway');if(!row || Date.now()-Number(row.updated)>90000)throw new Error('offline');return decryptRecord(row,process.env.SUPABASE_BACKUP_KEY);}})(req,res);
}
