import { PWA_ASSETS } from './pwa-assets.mjs';
import { createServer, request } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { allowedPath } from './deployment/routes.mjs';
import { fail } from './settings.mjs';

const lifetime = 12 * 60 * 60 * 1000;
const hash = value => createHash('sha256').update(value).digest('hex');
const publicFiles = new Map([['/motion.css','motion.css'],['/motion.js','motion.js'],['/login','login.html'],['/login.js','login.js'],['/login.css','login.css'],['/brand/logo.svg','brand/logo.svg'],['/brand/logo-light.svg','brand/logo-light.svg'],['/brand/icon.svg','brand/icon.svg']]);
for (const [path,asset] of PWA_ASSETS) publicFiles.set(path,asset.file);
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw fail('Use application/json.',415);
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 64000) throw fail('Conteúdo muito grande.',413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('JSON inválido.'); }
}
export async function createWorkspaceRouter({ access, manager, original, origin, clock = Date.now, port = 0 }) {
  const sessions = new Map(), attempts = new Map();
  const isMaster = account => account?.role === 'owner' && account.user_id === original.userId;
  const cookie = token => `zelo_auth=${token || ''}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? lifetime / 1000 : 0}`;
  function tokenKey(req) { const token = req.headers.cookie?.match(/(?:^|;\s*)zelo_auth=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1]; return token ? hash(token) : ''; }
  async function session(req) {
    const key = tokenKey(req), item = sessions.get(key);
    if (!item || item.expires <= clock()) { sessions.delete(key); return null; }
    const member = await access.member(item.userId);
    if (!member) { sessions.delete(key); return null; }
    return { ...member, key };
  }
  function issue(row, res) {
    for (const [id,item] of sessions) if (item.expires <= clock()) sessions.delete(id);
    const sameUser = [...sessions].filter(([,item]) => item.userId === row.user_id);
    while (sameUser.length >= 10) sessions.delete(sameUser.shift()[0]);
    const token = randomBytes(32).toString('base64url');
    sessions.set(hash(token),{ userId: row.user_id, expires: clock() + lifetime });
    res.setHeader('Set-Cookie',cookie(token));
  }
  async function protectedAttempt(input, operation) {
    const key = hash(String(input?.username || input?.token || '').trim().toLowerCase().slice(0,300));
    for (const [id,item] of attempts) if (item.until <= clock()) attempts.delete(id);
    if (attempts.size > 1000 || (attempts.get(key)?.count || 0) >= 5) throw fail('Muitas tentativas. Aguarde 5 minutos.',429);
    try { const result = await operation(); attempts.delete(key); return result; }
    catch (error) { const item = attempts.get(key) || { count: 0, until: clock()+300000 }; item.count++; attempts.set(key,item); throw error; }
  }
  function forward(req,res,app,path,authenticated) {
    const headers = {};
    for (const key of ['content-type','content-length','x-file-name','x-upload-offset','x-hub-signature-256','cookie']) if (req.headers[key]) headers[key] = req.headers[key];
    if (authenticated) {
      headers['x-zelo-workspace-secret'] = app.secret;
      headers['x-zelo-session'] = authenticated.key;
      headers['x-zelo-remote'] = '1';
    }
    const upstream = request(new URL(path, authenticated ? app.url : app.webhookUrl), { method: req.method, headers }, response => {
      const outgoing = { ...response.headers }; delete outgoing.connection; delete outgoing['transfer-encoding'];
      res.writeHead(response.statusCode, outgoing); response.pipe(res);
    });
    upstream.setTimeout(55000,()=>upstream.destroy());
    upstream.on('error',()=>{ if (!res.headersSent) json(res,503,{error:'Seu ambiente está temporariamente indisponível.'}); else res.end(); });
    req.on('aborted',()=>upstream.destroy()); req.pipe(upstream);
  }
  const server = createServer(async (req,res) => {
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const hosts = [`127.0.0.1:${server.address().port}`,`localhost:${server.address().port}`];
      if (!hosts.includes(req.headers.host) || Object.keys(req.headers).some(key => ['forwarded','x-forwarded-for','x-forwarded-host','cf-connecting-ip'].includes(key)) || req.headers.origin && !hosts.map(host=>'http://'+host).includes(req.headers.origin)) throw fail('Origem não permitida.',403);
      const url = new URL(req.url,'http://localhost'), path = url.pathname;
      if (!allowedPath(path)) throw fail('Não encontrado.',404);
      if (!['GET','POST','HEAD'].includes(req.method)) throw fail('Método não permitido.',405);
      if (req.method === 'GET' && publicFiles.has(path)) {
        const name = publicFiles.get(path), bytes = await readFile(fileURLToPath(new URL('./public/'+name, import.meta.url)));
        res.writeHead(200,{'Content-Type': (PWA_ASSETS.get(path)?.type || (name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html'))+'; charset=utf-8'}); return res.end(bytes);
      }
      if (path === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (req.method === 'GET' && path === '/api/health') return json(res,200,{ app:'zelo', workspaces:true });
      if (path === '/webhook' || /^\/w\/[a-f0-9-]{36}\/webhook$/.test(path)) {
        const id = path === '/webhook' ? original.userId : path.split('/')[2];
        if (!await access.member(id)) throw fail('Não encontrado.',404);
        const app = await manager.get(id); return forward(req,res,app,'/webhook'+url.search,null);
      }
      if (req.method === 'POST' && ['/api/auth/login','/api/auth/accept','/api/auth/invitation'].includes(path)) {
        const input = await body(req);
        if (path.endsWith('invitation')) return json(res,200,await protectedAttempt(input,()=>access.invitation(input.token)));
        const row = await protectedAttempt(input,()=>path.endsWith('accept') ? access.accept(input) : access.login(input));
        await manager.get(row.user_id); issue(row,res); return json(res,200,{ok:true});
      }
      const current = await session(req);
      if (req.method === 'GET' && path === '/api/auth/status') return json(res,200,{configured:true,authenticated:Boolean(current),provider:'supabase',inviteOnly:true});
      if (req.method === 'POST' && path === '/api/auth/logout') { await body(req); sessions.delete(tokenKey(req)); res.setHeader('Set-Cookie',cookie()); return json(res,200,{ok:true}); }
      if (!current) {
        if (req.method === 'GET' && ['/', '/admin/access'].includes(path)) { res.writeHead(302,{Location:path === '/admin/access' ? '/login?next=%2Fadmin%2Faccess' : '/login'}); return res.end(); }
        throw fail('Entre na sua conta para acessar seu ambiente.',401);
      }
      if (req.method === 'GET' && path === '/api/workspace') return json(res,200,{ email:current.email, role:current.role, isMaster:isMaster(current), userId:current.user_id, webhookUrl:origin+'/w/'+current.user_id+'/webhook' });
      if (path === '/admin/access') {
        if (!isMaster(current)) throw fail('Esta página é exclusiva do administrador master.',403);
        if (req.method !== 'GET') throw fail('Método não permitido.',405);
        return forward(req,res,await manager.get(current.user_id),'/',current);
      }
      if (path.startsWith('/api/workspace/')) {
        if (!isMaster(current)) throw fail('Apenas o administrador master pode gerenciar acessos.',403);
        if (req.method === 'GET' && path === '/api/workspace/accounts') return json(res,200,await access.accounts());
        if (req.method === 'POST') {
          const input = await body(req);
          if (path === '/api/workspace/invites') { const invited = await access.invite(input.email); return json(res,201,{ email:invited.email, expires:invited.expires, link:origin+'/login#invite='+invited.token }); }
          if (path === '/api/workspace/access') {
            const result = await access.setEnabled(input.email,input.enabled);
            if (!result.enabled && result.userId) { for (const [id,item] of sessions) if (item.userId === result.userId) sessions.delete(id); await manager.pause(result.userId); }
            return json(res,200,{ok:true});
          }
        }
        throw fail('Não encontrado.',404);
      }
      if (path === '/api/tunnel/start' || path === '/api/tunnel/stop') throw fail('Este ambiente já possui um webhook público próprio.',409);
      return forward(req,res,await manager.get(current.user_id),path+url.search,current);
    } catch (error) { if (!res.headersSent) json(res,error.status || 500,{error:error.status ? error.message : 'Não foi possível acessar seu ambiente. Tente novamente.'}); else res.end(); }
  });
  server.requestTimeout = 60000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return { url:`http://127.0.0.1:${server.address().port}`, async close() { sessions.clear(); await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();}); await manager.close(); } };
}
