import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { PWA_ASSETS } from '../lib/http/pwa-assets.mjs';
import { allowedPath } from '../deployment/routes.mjs';

const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
function worker() {
  const listeners = new Map(), stores = new Map(), writes = [], removed = [];
  let offline = false, responseStatus = 200, claimed = false, skipped = false;
  const fetch = async request => { if (offline) throw new Error('offline'); const path = new URL(typeof request === 'string' ? request : request.url, 'https://zelo.test').pathname; return new Response(path === '/offline' ? 'PUBLIC OFFLINE PAGE' : 'RESPONSE '+path, { status: responseStatus }); };
  const caches = {
    async open(name) { if (!stores.has(name)) stores.set(name,new Map()); const data = stores.get(name); return {
      async addAll(requests) { for (const request of requests) { writes.push(request.url); data.set(new URL(request.url).pathname, await fetch(request)); } },
      async put(path,response) { writes.push(path); data.set(path,response); },
      async match(path) { return data.get(path)?.clone(); },
    }; },
    async keys() { return [...stores.keys()]; }, async delete(name) { removed.push(name); return stores.delete(name); },
  };
  runInNewContext(source, { self: { skipWaiting: async () => { skipped = true; }, location: { origin: 'https://zelo.test' }, clients: { claim: async () => { claimed = true; } }, addEventListener: (name,callback) => listeners.set(name,callback) }, caches, fetch, URL, Response,
    Request: class extends Request { constructor(path, options) { super(new URL(path,'https://zelo.test'), options); } } });
  return { writes, stores, removed, offline: value => { offline = value; }, status: value => { responseStatus = value; }, claimed: () => claimed,
    skipped: () => skipped,
    async message(data) { let work; listeners.get('message')({ data, waitUntil: promise => { work = promise; } }); await work; },
    async lifecycle(name) { let work; listeners.get(name)({ waitUntil: promise => { work = promise; } }); await work; },
    async request(path, options = {}) { let result; listeners.get('fetch')({ request: { url: new URL(path,'https://zelo.test').href, method: 'GET', mode: 'cors', headers: new Headers(), ...options }, respondWith: promise => { result = promise; } }); return result; },
  };
}
test('PWA caches only public recovery files and never stores authenticated navigation', async () => {
  const w = worker(); await w.lifecycle('install'); const installed = w.writes.length;
  assert.ok(installed > 0); assert.ok(w.writes.every(url => { const path = new URL(url).pathname; return PWA_ASSETS.has(path) || path === '/brand/icon.svg'; }));
  const online = await w.request('/', { mode: 'navigate' }); assert.equal(await online.text(), 'RESPONSE /'); assert.equal(w.writes.length, installed);
  w.offline(true); const fallback = await w.request('/admin/access', { mode: 'navigate' }); assert.equal(await fallback.text(), 'PUBLIC OFFLINE PAGE'); assert.equal(w.writes.length, installed);
});
test('PWA does not intercept private APIs, attachments, mutations, query strings or external hosts', async () => {
  const w = worker(); await w.lifecycle('install'); w.offline(true);
  for (const path of ['/api/dashboard','/api/settings','/api/files/secret','/app.js','/brand/providers/gemini.svg','/offline?token=secret','https://external.test/offline']) assert.equal(await w.request(path),undefined);
  assert.equal(await w.request('/offline',{method:'POST'}),undefined);
  assert.equal(await w.request('/offline',{headers:new Headers({Authorization:'Bearer private'})}),undefined);
});
test('PWA public resources recover offline; rejected login stays rejected; activation removes only old Zelo caches', async () => {
  const w = worker(); await w.lifecycle('install');
  w.status(401); assert.equal((await w.request('/',{mode:'navigate'})).status,401);
  w.offline(true); assert.equal((await w.request('/offline.css')).status,200);
  w.stores.set('other-app',new Map()); w.stores.set('zelo-public-old',new Map()); await w.lifecycle('activate');
  assert.deepEqual(w.removed,['zelo-public-old']); assert.equal(w.claimed(),true); assert.ok(w.stores.has('other-app'));
});
test('PWA manifest has correct PNG sizes, maskable icon and exact public routes', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest',import.meta.url),'utf8'));
  assert.equal(manifest.display,'standalone'); assert.equal(manifest.start_url,'/');
  assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable'));
  for (const icon of manifest.icons) { const file=await readFile(new URL('../public'+icon.src,import.meta.url)); const [width,height]=icon.sizes.split('x').map(Number); assert.equal(file.readUInt32BE(16),width); assert.equal(file.readUInt32BE(20),height); assert.equal(PWA_ASSETS.get(icon.src).type,'image/png'); }
  for (const path of PWA_ASSETS.keys()) assert.equal(allowedPath(path),true);
  assert.equal(allowedPath('/brand/pwa/secret.png'),false); assert.equal(allowedPath('/offline/../../.env'),false);
});

const clientSource = await readFile(new URL('../public/pwa.js',import.meta.url),'utf8');
function client(ios = false, registration = { addEventListener() {}, async update() {} }) {
  const listeners = new Map(), nodes = [], registrations = [];
  const serviceListeners = new Map(), documentListeners = new Map(); let reloads = 0;
  const media = { matches: false, addEventListener() {} };
  const document = { visibilityState: 'visible', addEventListener: (name, callback) => documentListeners.set(name,callback), createElement(tag) { const node = { tag, hidden: false, children: [], append(...children) { this.children.push(...children); }, setAttribute() {} }; nodes.push(node); return node; }, querySelector: () => ({ append() {} }) };
  const navigator = { userAgent: ios ? 'iPhone' : 'Desktop', platform: ios ? 'iPhone' : 'Win32', maxTouchPoints: 0, onLine: true,
    serviceWorker: { controller: {}, addEventListener: (name,callback) => serviceListeners.set(name,callback), register: async (...args) => { registrations.push(args); return registration; } } };
  runInNewContext(clientSource,{ document,navigator,matchMedia: () => media,window: { location: { reload() { reloads++; } }, isSecureContext: true,addEventListener(name,callback) { const previous = listeners.get(name); listeners.set(name, (...args) => { previous?.(...args); callback(...args); }); } } });
  return { listeners, registrations, serviceListeners, documentListeners, document, navigator, reloads: () => reloads, container:nodes[0], button:nodes[1], status:nodes[2], help:nodes[3], update:nodes[4], updateButton:nodes[6] };
}
test('PWA installation waits for explicit click, unsupported browsers stay uncluttered and connectivity updates', async () => {
  const c=client(); assert.equal(c.button.hidden,true); assert.equal(c.container.hidden,true); assert.equal(c.registrations[0][0],'/sw.js');
  let prompted=0,prevented=false;
  c.listeners.get('beforeinstallprompt')({preventDefault(){prevented=true;},async prompt(){prompted++;},userChoice:Promise.resolve({outcome:'dismissed'})});
  assert.equal(prevented,true); assert.equal(prompted,0); assert.equal(c.button.hidden,false);
  await c.button.onclick(); assert.equal(prompted,1); assert.equal(c.button.hidden,true);
  c.listeners.get('offline')(); assert.equal(c.status.hidden,false); assert.equal(c.container.hidden,false);
  c.listeners.get('online')(); assert.equal(c.container.hidden,true);
});
test('PWA iOS help is user-controlled and appinstalled hides install UI', async () => {
  const c=client(true); assert.equal(c.button.hidden,false); assert.equal(c.help.hidden,true);
  await c.button.onclick(); assert.equal(c.help.hidden,false); assert.match(c.help.textContent,/Safari/);
  c.listeners.get('appinstalled')(); assert.equal(c.button.hidden,true); assert.equal(c.help.hidden,true); assert.equal(c.container.hidden,true);
});

test('PWA activates a waiting version only after an explicit update message', async () => {
  const w = worker(); await w.lifecycle('install'); assert.equal(w.skipped(),false);
  await w.message({ type: 'OTHER' }); assert.equal(w.skipped(),false);
  await w.message({ type: 'ACTIVATE_UPDATE' }); assert.equal(w.skipped(),true);
});

test('PWA offers a waiting update and reloads once only after the update click', async () => {
  const messages = [];
  const c = client(false, { waiting: { postMessage: value => messages.push(value.type) }, addEventListener() {} });
  await Promise.resolve();
  assert.equal(c.update.hidden,false); assert.equal(c.container.hidden,false); assert.deepEqual(messages,[]);
  c.serviceListeners.get('controllerchange')(); assert.equal(c.reloads(),0);
  c.updateButton.onclick(); c.updateButton.onclick(); assert.deepEqual(messages,['ACTIVATE_UPDATE']); assert.equal(c.reloads(),0);
  c.serviceListeners.get('controllerchange')(); c.serviceListeners.get('controllerchange')(); assert.equal(c.reloads(),1);
});

test('PWA detects updates installed after load and checks again on return without polling offline', async () => {
  const events = new Map(); let stateChanged, checks = 0;
  const registration = { waiting: null, installing: { addEventListener(name, callback) { stateChanged = callback; } }, addEventListener: (name,callback) => events.set(name,callback), update: async () => { checks++; } };
  const c = client(false,registration); await Promise.resolve();
  assert.equal(c.update.hidden,true);
  events.get('updatefound')(); registration.waiting = {}; stateChanged(); assert.equal(c.update.hidden,false);
  c.navigator.onLine = false; c.listeners.get('online')(); assert.equal(checks,0);
  c.navigator.onLine = true; c.document.visibilityState = 'hidden'; c.documentListeners.get('visibilitychange')(); assert.equal(checks,0);
  c.document.visibilityState = 'visible'; c.documentListeners.get('visibilitychange')(); c.listeners.get('online')(); assert.equal(checks,1);
});
