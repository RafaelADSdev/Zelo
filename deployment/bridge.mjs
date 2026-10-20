import { createServer, request } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { allowedPath } from './routes.mjs';
const equal = (a,b) => { const x=Buffer.from(a||''),y=Buffer.from(b||''); return x.length===y.length && timingSafeEqual(x,y); };
export async function createBridge({target,webhookTarget,secret,port=0}) {
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Segredo do gateway inválido.');
  const server = createServer((req,res) => {
    res.setHeader('Cache-Control','no-store');
    if (!equal(req.headers['x-zelo-gateway'],secret)) { res.writeHead(403); return res.end(); }
    const url = new URL(req.url,'http://localhost');
    if (!allowedPath(url.pathname)) { res.writeHead(404); return res.end(); }
    const destination = new URL(url.pathname+url.search,url.pathname==='/webhook' && webhookTarget ? webhookTarget : target);
    const headers = {'x-zelo-remote':'1'};
    for (const key of ['cookie','content-type','content-length','x-file-name','x-upload-offset','x-hub-signature-256']) if (req.headers[key]) headers[key]=req.headers[key];
    const upstream = request(destination,{method:req.method,headers},response=>{
      const outgoing={...response.headers}; delete outgoing.connection; delete outgoing['transfer-encoding'];
      if (outgoing['set-cookie']) outgoing['set-cookie']=outgoing['set-cookie'].map(cookie=>cookie.includes('; Secure')?cookie:cookie+'; Secure');
      res.writeHead(response.statusCode,outgoing); response.pipe(res);
    });
    upstream.setTimeout(55000,()=>upstream.destroy());
    upstream.on('error',()=>{ if(!res.headersSent)res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"Servidor temporariamente indisponível."}'); });
    req.on('aborted',()=>upstream.destroy()); req.pipe(upstream);
  });
  server.requestTimeout=60000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,port:server.address().port,async close(){await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();});}};
}
