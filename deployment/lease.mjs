import { randomUUID } from 'node:crypto';
import { encryptRecord, decryptRecord, snapshotPath } from './records.mjs';
const lost = () => Object.assign(new Error('Posse do worker perdida.'), { status: 503, leaseLost: true });
export function createLease(cloud,key,clock=Date.now) {
  const owner=randomUUID(), id='worker-lease';let held;
  const read=()=>cloud.request(snapshotPath+'?id=eq.'+id+'&select=*',{timeoutMs:5000});
  function assertActive() {
    if (!held || clock()-Number(held.updated)>=35000) throw lost();
  }
  return {
    assertActive,
    invalidate() { held = undefined; },
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
      try {
        assertActive();
        const previous = held;
        const next=encryptRecord(id,{owner},key,clock());
        const rows=await cloud.request(snapshotPath+`?id=eq.${id}&sha256=eq.${previous.sha256}&updated=eq.${previous.updated}`,{method:'PATCH',body:next,headers:{Prefer:'return=representation'},timeoutMs:5000});
        if(!rows?.length || held !== previous) throw lost();
        held=rows[0];
      } catch (error) { held = undefined; throw error; }
    },
    async publish(record, timeoutMs = 30000) {
      assertActive();
      const accepted = await cloud.request('/rest/v1/rpc/zelo_publish_worker_snapshot', {
        method: 'POST', timeoutMs, body: { lease_digest: held.sha256, payload: record },
      });
      if (accepted !== true) { held = undefined; throw lost(); }
    },
    async release(){if(held)await cloud.request(snapshotPath+`?id=eq.${id}&sha256=eq.${held.sha256}&updated=eq.${held.updated}`,{method:'DELETE',timeoutMs:5000});held=null;},
  };
}
