import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { startTestServer as startServer, authenticatedFetch as fetch } from "./helpers.mjs";
import { createQrAuth } from "../qr-auth.mjs";
import { testDirectory, releaseDirectory } from "./helpers.mjs";

test("QR: credenciais persistidas, novas mensagens, dedupe, isolamento e envio incerto", async () => {
  const dataDir = await testDirectory();
  const sockets = [], sent = []; let modelCalls = 0, uncertain = false;
  const socketFactory = options => {
    const socket = {
      ev: new EventEmitter(), user: { id: "5511999999999:1@s.whatsapp.net" }, options,
      end() {}, async logout() {},
      async sendMessage(jid, content) {
        sent.push({ jid, content });
        if (uncertain) throw new Error("sensitive transport failure");
        return { key: { id: `sent-${sent.length}` } };
      },
    };
    sockets.push(socket); return socket;
  };
  const app = await startServer({ port: 0, dataDir, qrSocketFactory: socketFactory, ai: { apiKey: "test-qr-private" }, geminiFetch: async () => {
    modelCalls++; return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ formatRationale: "Resposta curta", message: { text: "Resposta real do fluxo." } }) }] } }] });
  } });
  try {
    await app.settings.update({ whatsappMode: "qr" });
    await app.qr.connect();
    const socket = sockets[0];
    socket.ev.emit("connection.update", { qr: "test-qr-not-a-real-session" }); await app.qr.idle();
    assert.equal(app.qr.state().status, "qr"); assert.match(app.qr.state().qr, /^data:image\/png;base64,/);
    socket.options.auth.creds.registered = true;
    socket.ev.emit("creds.update", {}); await app.qr.idle();
    const auth = await createQrAuth(app.runtime.client);
    assert.equal(auth.state.creds.registered, true);
    await auth.state.keys.set({ session: { contact: Buffer.from("private-session-key") } });
    assert.deepEqual((await auth.state.keys.get("session", ["contact"])).contact, Buffer.from("private-session-key")); await auth.close();
    socket.ev.emit("connection.update", { connection: "open" }); await app.qr.idle();
    assert.equal(app.qr.state().status, "connected"); assert.equal(app.qr.state().qr, "");
    const incoming = (id, extra = {}) => ({ key: { remoteJid: "5511888888888@s.whatsapp.net", id, fromMe: false, ...extra }, pushName: "Contato", message: { conversation: "Oi" }, messageTimestamp: Math.floor(Date.now() / 1000) });
    socket.ev.emit("messages.upsert", { type: "append", messages: [incoming("history")] });
    socket.ev.emit("messages.upsert", { type: "notify", messages: [incoming("self", { fromMe: true }), incoming("group", { remoteJid: "123456789@g.us" }), { ...incoming("old"), messageTimestamp: 1 }, incoming("first"), incoming("first")] });
    await app.qr.idle();
    assert.equal(modelCalls, 1); assert.equal(sent.length, 1); assert.equal(sent[0].content.text, "Resposta real do fluxo.");
    assert.equal((await app.qr.conversations()).length, 1);
    const history = await app.qr.history("5511888888888"); assert.equal(history.history.at(-1).text, sent[0].content.text);
    assert.equal((await app.qr.status()).jobs[0].state, "done");
    const manual = { phone: "5511888888888", text: "Olá do operador", requestId: randomUUID() };
    await app.qr.manual(manual); await app.qr.manual(manual); assert.equal(sent.length, 2);
    await assert.rejects(app.qr.manual({ ...manual, text: "Outra mensagem" }), /outra mensagem/);
    socket.ev.emit("messages.update", [{ key: { fromMe: true, id: "sent-2" }, update: { status: 4 } }]); await app.qr.idle();
    assert.equal((await app.qr.history(manual.phone)).outbound.at(-1).state, "read");
    await app.qr.manual(manual); assert.equal(sent.length, 2);
    uncertain = true;
    const ambiguous = { ...manual, requestId: randomUUID(), text: "Não repetir automaticamente" };
    await assert.rejects(app.qr.manual(ambiguous), /não confirmou/);
    await assert.rejects(app.qr.manual(ambiguous), /sem confirmação/); assert.equal(sent.length, 3);
    await app.settings.update({ autoReply: false });
    socket.ev.emit("messages.upsert", { type: "notify", messages: [incoming("paused")] }); await app.qr.idle();
    assert.equal((await app.qr.status()).jobs.find(job => job.id.endsWith(":paused")).state, "manual"); assert.equal(modelCalls, 1);
    await app.settings.update({ autoReply: true, replySchedule: { enabled: true, days: [1,2,3,4,5,6,7], start: "08:00", end: "18:00", allDay: true, fromDate: "2000-01-01", untilDate: "2000-01-02" } });
    socket.ev.emit("messages.upsert", { type: "notify", messages: [incoming("outside-schedule")] }); await app.qr.idle();
    const scheduledJob = (await app.qr.status()).jobs.find(job => job.id.endsWith(":outside-schedule"));
    assert.equal(scheduledJob.state, "manual"); assert.equal(modelCalls, 1);
    uncertain = false;
    await app.qr.retry(scheduledJob.id); await app.qr.idle();
    assert.equal(modelCalls, 2); assert.equal(sent.length, 4);
    await app.qr.disconnect();
    socket.ev.emit("connection.update", { qr: "stale" }); await app.qr.idle(); assert.equal(app.qr.state().qr, "");
    await app.qr.connect(); const second = sockets.at(-1); assert.equal(second.options.auth.creds.registered, true);
    second.user.id = "5511777777777:1@s.whatsapp.net";
    second.ev.emit("connection.update", { connection: "open" }); await app.qr.idle();
    assert.equal((await app.qr.conversations()).length, 0);
    await app.qr.logout();
    const cleared = await createQrAuth(app.runtime.client); assert.equal(cleared.state.creds.registered, false); await cleared.close();
    const dashboard = await (await fetch(app.url + "/api/dashboard")).json();
    assert.ok(!JSON.stringify(dashboard).includes("private-session-key")); assert.equal(dashboard.qr.status, "disconnected");
  } finally { await app.close(); await releaseDirectory(dataDir); }
});
