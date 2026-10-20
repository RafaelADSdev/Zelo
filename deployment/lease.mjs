import { randomUUID } from 'node:crypto';
import { encryptRecord, decryptRecord, snapshotPath } from './records.mjs';
export function createLease(cloud,key,clock=Date.now) {
  const owner=randomUUID(), id='worker-lease';let held;
  const read=()=>cloud.request(snapshotPath+'?id=eq.'+id+'&select=*',{timeoutMs:5000});
  return {
    async acquire(){
      const next=encryptRecord(id,{owner},key,clock());
      await cloud.request(snapshotPath+'?on_conflict=id',{method:'POST',body:next,headers:{Prefer:'resolution=ignore-duplicates'},timeoutMs:5000});
      const [current]=await read();
      if(!current)return false;
      if(decryptRecord(current,key).owner!==owner && clock()-Number(current.updated)<45000)return false;
      const changed=await cloud.request(snapshotPath+`?id=eq.${id}&sha256=eq.${current.sha256}&updated=eq.${current.updated}`,{method:'PATCH',body:next,headers:{Prefer:'return=representation'},timeoutMs:5000});
      held=changed?.[0];return Boolean(held);
    },
    async renew(){
      if(!held || clock()-Number(held.updated)>35000)throw new Error('Posse do worker expirada.');
      const next=encryptRecord(id,{owner},key,clock());
      const rows=await cloud.request(snapshotPath+`?id=eq.${id}&sha256=eq.${held.sha256}&updated=eq.${held.updated}`,{method:'PATCH',body:next,headers:{Prefer:'return=representation'},timeoutMs:5000});
      if(!rows?.length)throw new Error('Posse do worker perdida.');held=rows[0];
    },
    async release(){if(held)await cloud.request(snapshotPath+`?id=eq.${id}&sha256=eq.${held.sha256}&updated=eq.${held.updated}`,{method:'DELETE',timeoutMs:5000});held=null;},
  };
}
