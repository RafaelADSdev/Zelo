import { Readable } from 'node:stream';
import { allowedPath } from './routes.mjs';
export function createProxy({origin,gateway,fetchImpl=fetch}) {
  const trusted = new URL(origin).origin;
  return async function handler(req,res) {
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Strict-Transport-Security','max-age=31536000');
    res.setHeader('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const json=(status,error)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error}));};
    const url = new URL(req.url,trusted);
    if (!allowedPath(url.pathname)) return json(404,'Página não encontrada.');
    if (!['GET','HEAD','POST'].includes(req.method)) return json(405,'Método não permitido.');
    if (url.pathname!=='/webhook' && ((req.headers.origin && req.headers.origin!==trusted) || req.headers['sec-fetch-site']==='cross-site')) return json(403,'Origem da solicitação não permitida.');
    try {
      const remote = await gateway();
      if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(remote.url) || !/^[a-f0-9]{64}$/.test(remote.secret)) throw new Error('gateway');
      const headers={'x-zelo-gateway':remote.secret};
      for(const key of ['cookie','content-type','x-file-name','x-upload-offset','x-hub-signature-256']) if(req.headers[key])headers[key]=req.headers[key];
      let body;
      if(req.method==='POST') {
        if(req.body!==undefined) body=Buffer.isBuffer(req.body)?req.body:Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body));
        else {const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>3*1024*1024)return json(413,'Envie arquivos usando o envio em partes.');chunks.push(chunk);}body=Buffer.concat(chunks);}
        if(body.length>3*1024*1024)return json(413,'Conteúdo muito grande.');
      }
      const response = await fetchImpl(remote.url+url.pathname+url.search,{method:req.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(55000)});
      for(const key of ['content-type','content-disposition','content-security-policy','location','x-content-type-options','referrer-policy']) if(response.headers.has(key))res.setHeader(key,response.headers.get(key));
      const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies);
      res.writeHead(response.status);
      if(response.body)await new Promise((resolve,reject)=>{const stream=Readable.fromWeb(response.body);stream.on('error',reject);res.on('error',reject);res.on('finish',resolve);stream.pipe(res);});else res.end();
    } catch {if(!res.headersSent)json(503,'O servidor de atendimento está iniciando ou indisponível. Tente novamente em instantes.');else res.end();}
  };
}
