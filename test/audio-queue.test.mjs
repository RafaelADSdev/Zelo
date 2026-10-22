import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { EventEmitter } from "node:events";
import { createHash, createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { createWhatsAppQr } from "../lib/whatsapp/whatsapp-qr.mjs";
import { createWhatsApp } from "../lib/whatsapp/whatsapp.mjs";

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function promptly(promise) {
  let timer;
  try { await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Outro contato ficou bloqueado pelo primeiro áudio.")), 1500); })]); }
  finally { clearTimeout(timer); }
}
for (const mode of ["qr", "cloud"]) test(`áudio rápido ${mode}: dois contatos simultâneos, ordem por conversa e sem duplicação`, async () => {
  const client = createClient({ url: ":memory:" });
  await client.execute("CREATE TABLE turns(id TEXT PRIMARY KEY, contactId TEXT, role TEXT, text TEXT)");
  const config = { whatsappMode: mode, autoReply: true, accessToken: "test-meta", appSecret: "test-secret", phoneNumberId: "123456789", graphVersion: "v23.0" };
  const settings = { get: () => ({ ...config }), mark: async value => Object.assign(config, value) };
  const first = deferred(), second = deferred(), firstStarted = deferred(), secondStarted = deferred(), thirdStarted = deferred();
  const starts = [], sent = []; let active = 0, peak = 0, socket;
  const runtime = { client, memory: { append: async () => {} }, async transcribe({ bytes }) {
    const id = bytes.toString(); starts.push(id); active++; peak = Math.max(peak, active);
    try {
      if (id === "1") { firstStarted.resolve(); await first.promise; }
      if (id === "3") { secondStarted.resolve(); await second.promise; }
      if (id === "4") thirdStarted.resolve();
      return { text: id };
    } finally { active--; }
  }, async whatsapp(message, send) { await send(message.contactId, { text: message.text }); } };
  const service = mode === "qr" ? await createWhatsAppQr({ runtime, settings,
    audioDownload: async descriptor => Readable.from([Buffer.from(descriptor.directPath.slice(1))]),
    socketFactory: () => (socket = { ev: new EventEmitter(), user: { id: "5511999999999@s.whatsapp.net" }, end() {}, async sendMessage(_jid, content) { sent.push(content.text); return { key: { id: `sent-${sent.length}` } }; } }),
  }) : await createWhatsApp({ runtime, settings, fetchImpl: async (url, options) => {
    if (url.includes("/messages")) { sent.push(JSON.parse(options.body).text.body); return Response.json({ messages: [{ id: `sent-${sent.length}` }] }); }
    const id = new URL(url).pathname.split("/").at(-1);
    return url.startsWith("https://graph.facebook.com/") ? Response.json({ url: `https://lookaside.fbsbx.com/${id}`, mime_type: "audio/ogg" }) : new Response(id);
  } });
  async function receive(entries) {
    if (mode === "qr") socket.ev.emit("messages.upsert", { type: "notify", messages: entries.map(([id, phone]) => ({ key: { remoteJid: `${phone}@s.whatsapp.net`, id }, messageTimestamp: Math.floor(Date.now() / 1000), message: { audioMessage: { mimetype: "audio/ogg", directPath: `/${id}`, mediaKey: Buffer.alloc(32, 1), fileSha256: createHash("sha256").update(id).digest() } } })) });
    else {
      const raw = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: config.phoneNumberId }, messages: entries.map(([id, phone]) => ({ id, from: phone, timestamp: String(Math.floor(Date.now() / 1000)), type: "audio", audio: { id, mime_type: "audio/ogg" } })) } }] }] }));
      await service.accept(raw, "sha256=" + createHmac("sha256", config.appSecret).update(raw).digest("hex"));
    }
  }
  try {
    if (mode === "qr") { await service.connect(); socket.ev.emit("connection.update", { connection: "open" }); await service.idle(); }
    await receive([["1", "5511888888888"]]); await promptly(firstStarted.promise);
    await receive([["2", "5511888888888"], ["3", "5511777777777"], ["4", "5511666666666"], ["3", "5511777777777"]]);
    await promptly(secondStarted.promise);
    assert.deepEqual(starts, ["1", "3"]);
    second.resolve(); await promptly(thirdStarted.promise);
    assert.ok(!starts.includes("2")); first.resolve(); await service.idle();
    assert.equal(peak, 2); assert.equal(sent.length, 4);
    assert.equal(starts.filter(id => id === "3").length, 1);
    assert.ok(sent.indexOf("[Áudio transcrito] 1") < sent.indexOf("[Áudio transcrito] 2"));
  } finally { first.resolve(); second.resolve(); await service.close(); client.close(); }
});
