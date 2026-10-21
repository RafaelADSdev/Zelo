import { PWA_ASSETS } from "./pwa-assets.mjs";
import { replyStatus } from "./reply-schedule.mjs";
import { createAuth } from "./auth.mjs";
import { createSupabase } from "./supabase-client.mjs";
import { createSupabaseAuth } from "./supabase-auth.mjs";
import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnvFile } from "node:process";
import { createRuntime } from "./runtime.mjs";
import { createSettings, fail } from "./settings.mjs";
import { createWhatsApp } from "./whatsapp.mjs";
import { createWhatsAppQr } from "./whatsapp-qr.mjs";
import { createTunnel } from "./tunnel.mjs";
import { createAiModel } from "./ai.mjs";
import { AI_PROVIDERS } from "./ai-providers.mjs";
import { createUploads } from "./deployment/uploads.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const assets = new Map([["/", ["index.html", "text/html"]], ["/app.js", ["app.js", "text/javascript"]], ["/reply-schedule.js", ["reply-schedule.js", "text/javascript"]], ["/style.css", ["style.css", "text/css"]]]);
assets.set("/motion.css", ["motion.css", "text/css"]);
assets.set("/motion.js", ["motion.js", "text/javascript"]);
assets.set("/panel.css", ["panel.css", "text/css"]);
assets.set("/settings-ui.js", ["settings-ui.js", "text/javascript"]);
assets.set("/workspace.js", ["workspace.js", "text/javascript"]);
assets.set("/catalog.js", ["catalog.js", "text/javascript"]);
assets.set("/catalog.css", ["catalog.css", "text/css"]);
assets.set("/ai-keys.js", ["ai-keys.js", "text/javascript"]);
for (const provider of Object.keys(AI_PROVIDERS)) assets.set(`/brand/providers/${provider}.svg`, [`brand/providers/${provider}.svg`, "image/svg+xml"]);
for (const file of ["logo.svg", "logo-light.svg", "icon.svg"]) assets.set("/brand/" + file, ["brand/" + file, "image/svg+xml"]);
assets.set("/login", ["login.html", "text/html"]);
assets.set("/login.js", ["login.js", "text/javascript"]);
assets.set("/login.css", ["login.css", "text/css"]);
for (const [path,asset] of PWA_ASSETS) assets.set(path,[asset.file,asset.type]);
const publicAssets = new Set([...PWA_ASSETS.keys(),"/motion.css", "/motion.js", "/login", "/login.js", "/login.css", "/brand/logo.svg", "/brand/logo-light.svg", "/brand/icon.svg", "/favicon.ico"]);
function json(res, status, data) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(data)); }
async function rawBody(req, limit) {
  const parts = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw fail("Conteúdo muito grande.", 413); parts.push(chunk); }
  return Buffer.concat(parts);
}
async function body(req) {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw fail("Use application/json.", 415);
  try { return JSON.parse((await rawBody(req, 64000)).toString("utf8")); }
  catch (error) { if (error.status) throw error; throw fail("JSON inválido."); }
}
const validText = (value, max, empty = false) => typeof value === "string" && value.length <= max && (empty || value.trim().length);
function sameToken(a, b) { const x = Buffer.from(a || ""); const y = Buffer.from(b || ""); return x.length === y.length && timingSafeEqual(x, y); }
async function listen(server, port) { await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); }); }
async function closeServer(server) { await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); }

export async function startServer({ port = 4173, webhookPort = port ? port + 1 : 0, dataDir = join(root, ".wappy"), ai = {}, metaFetch, geminiFetch, aiFetch, qrSocketFactory, onShutdown, cloudConfig, authDelegate, ownerId, snapshotId, backupKey } = {}) {
  const instanceId = randomUUID();
  const settings = await createSettings(dataDir, ai);
  const config = cloudConfig || (process.env.SUPABASE_URL ? { url: process.env.SUPABASE_URL, secretKey: process.env.SUPABASE_SECRET_KEY, publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY } : null);
  const cloud = config ? createSupabase(config) : null;
  const auth = authDelegate || await createAuth(dataDir, { provider: cloud ? createSupabaseAuth(cloud) : undefined, bootstrapToken: process.env.ZELO_SETUP_TOKEN });
  const runtime = await createRuntime(dataDir, settings, { fetchImpl: aiFetch || geminiFetch || ai.fetchImpl, cloud, backupKey: backupKey || process.env.SUPABASE_BACKUP_KEY, ownerId, snapshotId });
  const uploads = createUploads(runtime.catalog);
  await runtime.memory.load("system:init");
  const whatsapp = await createWhatsApp({ runtime, settings, fetchImpl: metaFetch });
  const qr = await createWhatsAppQr({ runtime, settings, socketFactory: qrSocketFactory });
  const transport = () => settings.get().whatsappMode === "qr" ? qr : whatsapp;
  const webhook = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== "/webhook") return json(res, 404, { error: "Não encontrado." });
      if (req.method === "GET") {
        const challenge = url.searchParams.get("hub.challenge");
        if (url.searchParams.get("hub.mode") !== "subscribe" || !sameToken(url.searchParams.get("hub.verify_token"), settings.get().verifyToken) || !challenge || challenge.length > 1000) return json(res, 403, { error: "Verificação inválida." });
        await settings.mark({ webhookVerifiedAt: Date.now() });
        res.writeHead(200, { "Content-Type": "text/plain" }); return res.end(challenge);
      }
      if (req.method === "POST") {
        const signature = req.headers["x-hub-signature-256"];
        if (typeof signature !== "string") return json(res, 403, { error: "Assinatura obrigatória." });
        await whatsapp.accept(await rawBody(req, 1000000), signature);
        return json(res, 200, { received: true });
      }
      json(res, 405, { error: "Método não permitido." });
    } catch (error) { json(res, error.status || 500, { error: error.status ? error.message : "Falha ao persistir o evento. A Meta pode tentar novamente." }); }
  });
  webhook.requestTimeout = 15000;
  try { await listen(webhook, webhookPort); } catch (error) { await qr.close(); await whatsapp.close(); await runtime.close(); throw error; }
  const tunnel = createTunnel({ dataDir, port: webhook.address().port, settings });
  let adminQueue = Promise.resolve();
  const serial = fn => { const result = adminQueue.then(fn); adminQueue = result.catch(() => {}); return result; };
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (cloud && req.headers['x-zelo-remote'] === '1') res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: ${cloud.origin}; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    const allowed = [`127.0.0.1:${server.address().port}`, `localhost:${server.address().port}`];
    if (!allowed.includes(req.headers.host) || Object.keys(req.headers).some(key => ["forwarded", "x-forwarded-for", "x-forwarded-host", "cf-connecting-ip"].includes(key)) || (req.headers.origin && !allowed.map(host => `http://${host}`).includes(req.headers.origin))) return json(res, 403, { error: "Painel disponível somente neste computador." });
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { app: "wappy", instanceId });
      if (req.method === "GET" && url.pathname === "/api/auth/status") return json(res, 200, { configured: auth.configured(), authenticated: Boolean(auth.session(req)), provider: auth.provider() });
      if (!authDelegate && req.method === "POST" && ["/api/auth/setup", "/api/auth/login", "/api/auth/logout"].includes(url.pathname)) {
        // Login and logout require the same Origin checks as administrative writes.
        const input = await body(req);
        if (url.pathname === "/api/auth/logout") { auth.logout(req); res.setHeader("Set-Cookie", auth.cookie()); return json(res, 200, { ok: true }); }
        const token = await (url.pathname.endsWith("setup") ? auth.setup(input) : auth.login(input));
        if (url.pathname.endsWith('setup')) await runtime.flushBackup();
        res.setHeader("Set-Cookie", auth.cookie(token)); return json(res, 200, { ok: true });
      }
      const controlledShutdown = req.method === "POST" && url.pathname === "/api/shutdown" && auth.control(req.headers["x-zelo-control"]);
      if (!publicAssets.has(url.pathname) && !auth.session(req) && !controlledShutdown) {
        if (req.method === "GET" && url.pathname === "/") { res.writeHead(302, { Location: "/login" }); return res.end(); }
        return json(res, 401, { error: "Entre na sua conta para acessar o Zelo." });
      }
      let contactId = req.headers.cookie?.match(/(?:^|;\s*)wappy_session=([a-f0-9-]{36})(?:;|$)/)?.[1];
      if (!contactId) { contactId = randomUUID(); res.setHeader("Set-Cookie", `wappy_session=${contactId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`); }
      if (req.method === "GET" && assets.has(url.pathname)) {
        const [name, type] = assets.get(url.pathname); const bytes = await readFile(join(root, "public", name));
        res.writeHead(200, { "Content-Type": type + "; charset=utf-8" }); return res.end(bytes);
      }
      if (req.method === "GET" && url.pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }
      if (req.method === "GET" && url.pathname === "/api/products") return json(res, 200, await runtime.catalog.list());
      if (req.method === "GET" && url.pathname === "/api/ai/providers") return json(res, 200, AI_PROVIDERS);
      const fileMatch = url.pathname.match(/^\/api\/files\/([a-f0-9-]{36})$/);
      if (req.method === "GET" && fileMatch) {
        if (cloud && req.headers['x-zelo-remote'] === '1') { res.writeHead(302, { Location: await runtime.catalog.signedFile(fileMatch[1]) }); return res.end(); }
        const file = await runtime.catalog.file(fileMatch[1]);
        res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
        res.writeHead(200, { "Content-Type": file.mime, "Content-Length": file.size, "Content-Disposition": `${file.mime === "application/pdf" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.name)}` }); return res.end(file.bytes);
      }
      const uploadPart = url.pathname.match(/^\/api\/uploads\/([a-f0-9-]{36})$/);
      if (req.method === 'POST' && uploadPart) return json(res, 200, uploads.append(uploadPart[1], auth.session(req).key, Number(req.headers['x-upload-offset']), await rawBody(req, 2 * 1024 * 1024)));
      const uploadMatch = url.pathname.match(/^\/api\/products\/([a-f0-9-]{36})\/files$/);
      if (req.method === "POST" && uploadMatch) {
        if (!["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(req.headers["content-type"])) throw fail("Envie JPG, PNG, WebP ou PDF.", 415);
        let name; try { name = decodeURIComponent(req.headers["x-file-name"] || ""); } catch { throw fail("Nome de arquivo inválido."); }
        const bytes = await rawBody(req, runtime.catalog.maxFile);
        return json(res, 201, await serial(() => runtime.catalog.upload(uploadMatch[1], bytes, name, req.headers["content-type"])));
      }
      if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, await serial(() => runtime.state(`browser:${contactId}`)));
      if (req.method === "GET" && url.pathname === "/api/dashboard") return json(res, 200, { app: "wappy", instanceId, storageProvider: cloud ? "supabase" : "local", settings: settings.public(), replyStatus: replyStatus(settings.get()), qr: qr.state(), tunnel: tunnel.state(), webhookPort: webhook.address().port, conversations: await transport().conversations(), ...await transport().status() });
      if (req.method === "GET" && url.pathname === "/api/conversation") return json(res, 200, await transport().history(url.searchParams.get("phone") || ""));
      if (req.method === "GET" && url.pathname === "/api/templates") return json(res, 200, await whatsapp.templates());
      if (req.method === "POST") {
        const input = await body(req);
        if (url.pathname === '/api/uploads') return json(res, 201, uploads.start(input, auth.session(req).key));
        const finishUpload = url.pathname.match(/^\/api\/uploads\/([a-f0-9-]{36})\/finish$/);
        if (finishUpload) return json(res, 201, await serial(() => uploads.finish(finishUpload[1], auth.session(req).key)));
        if (url.pathname === "/api/ai/keys") return json(res, 201, await settings.saveAiKey(input));
        if (url.pathname === "/api/ai/rotation") return json(res, 200, await settings.configureAiRotation(input));
        const aiKeyMatch = url.pathname.match(/^\/api\/ai\/keys\/([a-f0-9-]{36})(?:\/(verify|reset|remove))?$/);
        if (aiKeyMatch) {
          const key = settings.get().aiKeys.find(item => item.id === aiKeyMatch[1]);
          if (!key) throw fail("Chave não encontrada.", 404);
          if (aiKeyMatch[2] === "remove") return json(res, 200, await settings.removeAiKey(key.id, input.revision));
          if (aiKeyMatch[2] === "reset") { await settings.markAiKey(key, { cooldownUntil: 0, lastError: "" }); return json(res, 200, { reset: true }); }
          if (aiKeyMatch[2] === "verify") {
            const config = settings.get();
            try {
              await createAiModel({ ...config, aiProvider: key.provider, apiKey: key.apiKey, model: key.model, fetchImpl: aiFetch || geminiFetch || ai.fetchImpl }).generate({ prompt: "Responda OK em message.text, sem anexos ou dados pessoais.", responseSchema: { properties: { message: {} } } });
              await settings.markAiKey(key, { validatedAt: Date.now(), cooldownUntil: 0, lastError: "" }); return json(res, 200, { verified: true });
            } catch (error) {
              await settings.markAiKey(key, { lastError: error.status ? error.message : "Falha ao validar a chave.", ...(error.fallbackEligible ? { cooldownUntil: Date.now() + error.retryAfterMs } : {}) }); throw error;
            }
          }
          return json(res, 200, await settings.saveAiKey(input, key.id));
        }
        if (url.pathname === "/api/products") return json(res, 201, await serial(() => runtime.catalog.save(input)));
        const productMatch = url.pathname.match(/^\/api\/products\/([a-f0-9-]{36})$/);
        if (productMatch) return json(res, 200, await serial(() => runtime.catalog.save(input, productMatch[1])));
        const removeMatch = url.pathname.match(/^\/api\/products\/([a-f0-9-]{36})\/files\/([a-f0-9-]{36})\/remove$/);
        if (removeMatch) return json(res, 200, await serial(() => runtime.catalog.removeFile(removeMatch[1], removeMatch[2], input.revision)));
        switch (url.pathname) {
          case "/api/shutdown":
            if (!onShutdown || input?.instanceId !== instanceId) throw fail("Instância inválida.", 409);
            json(res, 200, { stopped: true }); setImmediate(onShutdown); return;
          case "/api/settings": return json(res, 200, await serial(async () => {
            const previous = settings.get().whatsappMode;
            const result = await settings.update(input);
            if (previous === "qr" && result.whatsappMode !== "qr") await qr.disconnect();
            return result;
          }));
          case "/api/qr/connect": return json(res, 200, await serial(() => qr.connect()));
          case "/api/qr/disconnect": await serial(() => qr.disconnect()); return json(res, 200, { disconnected: true });
          case "/api/qr/logout": return json(res, 200, await serial(() => qr.logout()));
          case "/api/gemini/verify":
          case "/api/ai/verify": {
            const config = settings.get();
            if (!config.apiKey) throw fail("Configure a chave do provedor de IA selecionado.", 409);
            await createAiModel({ ...config, fetchImpl: aiFetch || geminiFetch || ai.fetchImpl }).generate({ prompt: "Responda OK em message.text, sem anexos e sem informações pessoais, usando o formato estruturado solicitado.", responseSchema: { properties: { message: { type: "object" } } } });
            await settings.markAiValidated(config); return json(res, 200, { verified: true, provider: config.aiProvider, model: config.model });
          }
          case "/api/whatsapp/verify": return json(res, 200, await whatsapp.verify());
          case "/api/whatsapp/subscribe": return json(res, 200, await whatsapp.subscribe());
          case "/api/whatsapp/send": return json(res, 200, await serial(() => transport().manual(input)));
          case "/api/whatsapp/retry": return json(res, 200, await transport().retry(input.id));
          case "/api/tunnel/start": return json(res, 200, await tunnel.start());
          case "/api/tunnel/stop": return json(res, 200, tunnel.stop());
          case "/api/chat":
            if (!validText(input?.text, 4000)) throw fail("Escreva uma mensagem de 1 a 4.000 caracteres.");
            return json(res, 200, await serial(() => runtime.chat(`browser:${contactId}`, input.text.trim())));
          case "/api/knowledge":
            if (!validText(input?.text, 20000, true)) throw fail("A base aceita até 20.000 caracteres.");
            await serial(() => runtime.saveKnowledge(input.text.trim())); return json(res, 200, { saved: true });
          case "/api/new":
            contactId = randomUUID(); res.setHeader("Set-Cookie", `wappy_session=${contactId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);
            return json(res, 200, await runtime.state(`browser:${contactId}`));
        }
      }
      json(res, 404, { error: "Página não encontrada." });
    } catch (error) { if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : "Falha interna. Confira o estado da conexão e tente novamente." }); else res.end(); }
  });
  try { await listen(server, port); } catch (error) { await closeServer(webhook); await qr.close(); await whatsapp.close(); await runtime.close(); throw error; }
  return {
    server, settings, whatsapp, qr, runtime, url: `http://127.0.0.1:${server.address().port}`, webhookUrl: `http://127.0.0.1:${webhook.address().port}/webhook`,
    async close() { tunnel.stop(); await closeServer(server); await closeServer(webhook); await adminQueue; await qr.close(); await whatsapp.close(); await runtime.close(); },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { loadEnvFile(join(root, ".env")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const app = await startServer({ port: Number(process.env.PORT || 4173), webhookPort: Number(process.env.WEBHOOK_PORT || (Number(process.env.PORT || 4173) + 1)), ai: { apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL }, onShutdown: async () => { await app.close(); process.exit(0); } });
  console.log(`Zelo: ${app.url}\nWebhook separado: ${app.webhookUrl}\nConfigure as conexões pelo painel. Ctrl+C para encerrar.`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await app.close(); process.exit(0); });
}
