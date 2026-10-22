import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { EventEmitter } from "node:events";
import { createHash, createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { createContactBlocks } from "../contact-blocks.mjs";
import { createWhatsAppQr } from "../whatsapp-qr.mjs";
import { createWhatsApp } from "../whatsapp.mjs";
import { allowedPath } from "../deployment/routes.mjs";

test("bloqueios persistem por conta e conexão, sem atravessar ambientes", async () => {
  const db = createClient({ url: ":memory:" }), other = createClient({ url: ":memory:" });
  try {
    const store = await createContactBlocks(db);
    await store.set("qr", "account-one", "contact", true);
    assert.equal(await (await createContactBlocks(db)).blocked("qr", "account-one", "contact"), true);
    assert.equal(await store.blocked("qr", "account-two", "contact"), false);
    assert.equal(await store.blocked("cloud", "account-one", "contact"), false);
    assert.equal(await (await createContactBlocks(other)).blocked("qr", "account-one", "contact"), false);
    await store.set("qr", "account-one", "contact", false);
    assert.equal(await store.blocked("qr", "account-one", "contact"), false);
    await assert.rejects(store.set("qr", "account-one", "contact", "true"), /bloqueio/i);
    assert.ok(allowedPath("/api/whatsapp/block"));
  } finally { db.close(); other.close(); }
});

for (const mode of ["qr", "cloud"]) test(`bloqueio ${mode}: impede IA, áudio, retomada e resposta já em geração; desbloqueio vale para novas mensagens`, async () => {
  const db = createClient({ url: ":memory:" });
  await db.execute("CREATE TABLE turns(id TEXT PRIMARY KEY,contactId TEXT,role TEXT,text TEXT,timestamp INTEGER)");
  const config = { whatsappMode: mode, autoReply: true, accessToken: "test-meta", appSecret: "test-secret", phoneNumberId: "123456789", graphVersion: "v23.0" };
  const settings = { get: () => ({ ...config }), mark: async value => Object.assign(config, value) };
  let socket, calls = 0, downloads = 0, sends = 0, release, started, fileRelease, fileStarted;
  const held = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; });
  const fileHeld = new Promise(resolve => { fileRelease = resolve; }), fileEntered = new Promise(resolve => { fileStarted = resolve; });
  const phone = "5511888888888", data = Buffer.from("test-audio");
  const runtime = { client: db, memory: { append: async () => {}, load: async () => [] }, state: async () => ({ history: [] }),
    transcribe: async () => { calls++; return { text: "Áudio" }; },
    catalog: { async file() { fileStarted(); await fileHeld; return { mime: "image/png", bytes: Buffer.from("test"), name: "exemplo.png" }; } },
    async whatsapp(message, send) { calls++; if (message.id.endsWith("held")) { started(); await held; } return send(message.contactId, { text: "Resposta", ...(message.id.endsWith("material") ? { materials: [{ id: "file", name: "exemplo.png" }] } : {}) }); },
  };
  const service = mode === "qr" ? await createWhatsAppQr({ runtime, settings,
    audioDownload: async () => { downloads++; return Readable.from([data]); },
    socketFactory: () => (socket = { ev: new EventEmitter(), user: { id: "5511999999999@s.whatsapp.net" }, end() {}, async sendMessage() { sends++; return { key: { id: `sent-${sends}` } }; } }),
  }) : await createWhatsApp({ runtime, settings, fetchImpl: async () => { sends++; return Response.json({ messages: [{ id: `sent-${sends}` }] }); } });
  async function receive(id, audio = false) {
    if (mode === "qr") socket.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { id, remoteJid: `${phone}@s.whatsapp.net` }, messageTimestamp: Math.floor(Date.now() / 1000), message: audio ? { audioMessage: { mimetype: "audio/ogg", directPath: "/v/test", mediaKey: Buffer.alloc(32, 1), fileSha256: createHash("sha256").update(data).digest() } } : { conversation: "Olá" } }] });
    else {
      const raw = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: config.phoneNumberId }, messages: [{ id, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: audio ? "audio" : "text", ...(audio ? { audio: { id: "123", mime_type: "audio/ogg" } } : { text: { body: "Olá" } }) }] } }] }] }));
      await service.accept(raw, "sha256=" + createHmac("sha256", config.appSecret).update(raw).digest("hex"));
    }
  }
  try {
    if (mode === "qr") { await service.connect(); socket.ev.emit("connection.update", { connection: "open" }); await service.idle(); }
    await service.setBlocked({ phone, blocked: true });
    await receive("blocked-audio", true); await service.idle();
    assert.equal(calls, 0); assert.equal(downloads, 0); assert.equal(sends, 0);
    const job = (await service.status()).jobs[0]; assert.equal(job.state, "blocked");
    assert.equal((await service.history(phone)).blocked, true);
    assert.equal((await service.conversations())[0].blocked, true);
    await assert.rejects(service.retry(job.id), /bloquead/i);
    await service.setBlocked({ phone, blocked: false }); await service.idle(); assert.equal(calls, 0);
    await assert.rejects(service.retry(job.id), /nova mensagem/i);
    await receive("allowed"); await service.idle(); assert.equal(sends, 1);
    await receive("held"); await entered;
    await service.setBlocked({ phone, blocked: true }); release(); await service.idle();
    assert.equal(sends, 1); assert.equal((await service.status()).jobs.find(job => job.id.endsWith("held")).state, "blocked");
    await service.setBlocked({ phone, blocked: false });
    await receive("material"); await fileEntered;
    await service.setBlocked({ phone, blocked: true }); fileRelease(); await service.idle();
    assert.equal(sends, 2, "Bloqueio durante leitura do material deve impedir o anexo");
    assert.equal((await service.status()).jobs.find(job => job.id.endsWith("material")).state, "blocked");
  } finally { release(); fileRelease(); await service.close(); db.close(); }
});
