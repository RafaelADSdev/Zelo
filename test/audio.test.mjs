import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { createHmac, createCipheriv } from "node:crypto";
import { getMediaKeys } from "@whiskeysockets/baileys";
import { startTestServer, testDirectory, releaseDirectory } from "./helpers.mjs";
import { createHash } from "node:crypto";
import { createTranscriber, qrAudio, downloadQrAudio, downloadCloudAudio, MAX_AUDIO_BYTES } from "../audio.mjs";

const bytes = Buffer.from("OggS-test-only-audio"), mimeType = "audio/ogg";
const key = (provider, id = provider) => ({ id, provider, model: provider === "gemini" ? "gemini-2.5-flash" : "chat-model", enabled: true, apiKey: `test-${id}` });
const settings = (keys, rotation = true) => ({ get: () => ({ aiListOnly: true, aiRotationEnabled: rotation, aiKeys: keys }) });
test("áudio: transcrição Groq usa arquivo e modelo de voz, reserva por limite e erros seguros", async () => {
  const calls = [];
  const transcribe = createTranscriber(settings([key("anthropic"), key("groq", "one"), key("groq", "two")]), { fetchImpl: async (url, options) => {
    calls.push(options.headers.Authorization);
    assert.equal(url, "https://api.groq.com/openai/v1/audio/transcriptions");
    assert.equal(options.body.get("model"), "whisper-large-v3-turbo");
    assert.deepEqual(Buffer.from(await options.body.get("file").arrayBuffer()), bytes);
    return calls.length === 1 ? Response.json({ error: { message: "private-provider-detail" } }, { status: 429 }) : Response.json({ text: "Gostaria de conhecer o Sopro." });
  } });
  assert.equal((await transcribe({ bytes, mimeType })).text, "Gostaria de conhecer o Sopro.");
  assert.deepEqual(calls, ["Bearer test-one", "Bearer test-two"]);
  let invalidCalls = 0;
  const invalid = createTranscriber(settings([key("groq"), key("openai")]), { fetchImpl: async () => { invalidCalls++; return Response.json({ error: "secret" }, { status: 401 }); } });
  await assert.rejects(invalid({ bytes, mimeType }), /credenciais/i); assert.equal(invalidCalls, 1);
  await assert.rejects(transcribe({ bytes: Buffer.alloc(MAX_AUDIO_BYTES + 1), mimeType }), /10 MB/);
  await assert.rejects(createTranscriber(settings([key("anthropic")]))({ bytes, mimeType }), /Gemini, Groq ou OpenAI/);
});
test("áudio: Gemini envia somente áudio para transcrição e OpenAI usa endpoint próprio", async () => {
  const gemini = createTranscriber(settings([key("gemini")]), { fetchImpl: async (url, options) => {
    assert.match(url, /models\/gemini-2.5-flash:generateContent$/);
    assert.equal(options.headers["x-goog-api-key"], "test-gemini");
    const body = JSON.parse(options.body);
    assert.equal(body.contents[0].parts[1].inlineData.data, bytes.toString("base64"));
    return Response.json({ candidates: [{ content: { parts: [{ text: "Quero fotos." }] } }] });
  } });
  assert.equal((await gemini({ bytes, mimeType })).text, "Quero fotos.");
  const openai = createTranscriber(settings([key("openai")]), { fetchImpl: async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(options.body.get("model"), "gpt-transcribe");
    return Response.json({ text: "Olá." });
  } });
  assert.equal((await openai({ bytes, mimeType })).text, "Olá.");
});
test("áudio: download QR e Cloud recusam hosts externos e tamanho excessivo", async () => {
  const descriptor = qrAudio({ mimetype: "audio/ogg; codecs=opus", mediaKey: Buffer.alloc(32, 1), fileSha256: createHash("sha256").update(bytes).digest(), directPath: "/v/test", fileLength: bytes.length });
  assert.deepEqual((await downloadQrAudio(descriptor, async () => Readable.from([bytes]))).bytes, bytes);
  assert.throws(() => qrAudio({ ...descriptor, url: "https://localhost/private" }), /origem/i);
  await assert.rejects(downloadQrAudio({ ...descriptor, size: MAX_AUDIO_BYTES + 1 }), /10 MB/);
  await assert.rejects(downloadQrAudio(descriptor, async () => Readable.from([Buffer.from("wrong")])), /integridade/i);
  const config = { accessToken: "test-meta", graphVersion: "v23.0" };
  let calls = 0;
  await assert.rejects(downloadCloudAudio({ url: "12345", mimeType }, config, async () => {
    calls++; return Response.json({ url: "https://localhost/private", mime_type: mimeType });
  }), /origem/i); assert.equal(calls, 1);
  const audio = await downloadCloudAudio({ url: "12345", mimeType }, config, async (url, options) => {
    assert.equal(options.redirect, "error"); assert.equal(options.headers.Authorization, "Bearer test-meta");
    return url.startsWith("https://graph.facebook.com/") ? Response.json({ url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/test", mime_type: mimeType, file_size: bytes.length }) : new Response(bytes);
  });
  assert.deepEqual(audio.bytes, bytes);
});

test("áudio: download real QR autentica e decifra envelope, bloqueia corrupção e redirecionamentos", async () => {
  const mediaKey = Buffer.alloc(32, 1), { iv, cipherKey, macKey } = await getMediaKeys(mediaKey, "audio");
  const cipher = createCipheriv("aes-256-cbc", cipherKey, iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const encrypted = Buffer.concat([ciphertext, createHmac("sha256", macKey).update(iv).update(ciphertext).digest().subarray(0, 10)]);
  const descriptor = qrAudio({ mimetype: mimeType, mediaKey, fileSha256: createHash("sha256").update(bytes).digest(), directPath: "/v/test" });
  const result = await downloadQrAudio(descriptor, undefined, async (url, options) => {
    assert.equal(url, "https://mmg.whatsapp.net/v/test"); assert.equal(options.redirect, "error"); assert.ok(options.signal);
    return new Response(encrypted);
  });
  assert.deepEqual(result.bytes, bytes);
  const corrupted = Buffer.from(encrypted); corrupted[0] ^= 1;
  await assert.rejects(downloadQrAudio(descriptor, undefined, async () => new Response(corrupted)), /integridade/);
});

test("áudio: sem troca automática não usa a segunda chave e silêncio não gera resposta", async () => {
  let calls = 0;
  const transcribe = createTranscriber(settings([key("groq"), key("gemini")], false), { fetchImpl: async () => { calls++; return new Response("", { status: 429 }); } });
  await assert.rejects(transcribe({ bytes, mimeType }), /limite/); assert.equal(calls, 1);
  const empty = createTranscriber(settings([key("groq")]), { fetchImpl: async () => Response.json({ text: "   " }) });
  await assert.rejects(empty({ bytes, mimeType }), /entender/);
});

test("áudio: tentativa travada em arquivo curto passa à reserva e erro de rede fica claro", async () => {
  let calls = 0;
  const transcribe = createTranscriber(settings([key("gemini"), key("groq")]), { shortAudioTimeoutMs: 10, fetchImpl: async (_url, options) => {
    calls++;
    if (calls === 1) await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 500);
      options.signal.addEventListener("abort", () => { clearTimeout(timer); reject(options.signal.reason); }, { once: true });
    });
    return Response.json({ text: "Entendido." });
  } });
  assert.equal((await transcribe({ bytes, mimeType })).text, "Entendido."); assert.equal(calls, 2);
  const disconnected = createTranscriber(settings([key("groq")]), { fetchImpl: async () => { throw new TypeError("fetch failed secret-url"); } });
  await assert.rejects(disconnected({ bytes, mimeType }), /conexão com o provedor/i);
});

test("áudio QR: transcrição vira contexto e histórico, sem duplicar; pausa não baixa nem transcreve", async () => {
  const dataDir = await testDirectory(); let socket, downloads = 0, transcriptions = 0, replies = 0, sends = 0, failReply = false;
  const app = await startTestServer({ port: 0, dataDir, ai: { apiKey: "test-gemini" },
    qrAudioDownload: async () => { downloads++; return Readable.from([bytes]); },
    qrSocketFactory: () => (socket = { ev: new EventEmitter(), user: { id: "5511999999999@s.whatsapp.net" }, end() {}, async sendMessage() { sends++; return { key: { id: `sent-${sends}` } }; } }),
    aiFetch: async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.contents[0].parts[1]?.inlineData) { transcriptions++; return Response.json({ candidates: [{ content: { parts: [{ text: "Quero conhecer o Sopro." }] } }] }); }
      replies++; assert.match(options.body, /Quero conhecer o Sopro/);
      if (failReply) return new Response("", { status: 500 });
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ formatRationale: "Resposta em texto", message: { text: "Vamos falar sobre o Sopro." } }) }] } }] });
    },
  });
  try {
    await app.settings.update({ whatsappMode: "qr", autoReply: true }); await app.qr.connect();
    socket.ev.emit("connection.update", { connection: "open" }); await app.qr.idle();
    const incoming = id => ({ key: { remoteJid: "5511888888888@s.whatsapp.net", id }, messageTimestamp: Math.floor(Date.now() / 1000), message: { audioMessage: { mimetype: mimeType, mediaKey: Buffer.alloc(32, 1), fileSha256: createHash("sha256").update(bytes).digest(), directPath: "/v/test", fileLength: bytes.length } } });
    socket.ev.emit("messages.upsert", { type: "notify", messages: [incoming("voice"), incoming("voice")] }); await app.qr.idle();
    assert.equal((await app.qr.status()).jobs[0]?.state, "done", JSON.stringify(await app.qr.status()));
    assert.equal(downloads, 1); assert.equal(transcriptions, 1); assert.equal(replies, 1); assert.equal(sends, 1);
    assert.match((await app.qr.history("5511888888888")).history[0].text, /Áudio transcrito.*Quero conhecer/s);
    await app.settings.update({ autoReply: false });
    socket.ev.emit("messages.upsert", { type: "notify", messages: [incoming("paused")] }); await app.qr.idle();
    assert.equal(downloads, 1); assert.equal((await app.qr.status()).jobs.find(job => job.id.endsWith(":paused")).state, "manual");
    const paused = (await app.qr.status()).jobs.find(job => job.id.endsWith(":paused"));
    await app.qr.retry(paused.id); await app.qr.idle(); assert.equal(transcriptions, 2); assert.equal(sends, 2);
    assert.match((await app.qr.history("5511888888888")).history.find(turn => turn.id.endsWith(":paused")).text, /Áudio transcrito.*Quero conhecer/s);
    await app.settings.update({ autoReply: true }); failReply = true;
    socket.ev.emit("messages.upsert", { type: "notify", messages: [incoming("retry")] }); await app.qr.idle();
    const retry = (await app.qr.status()).jobs.find(job => job.id.endsWith(":retry"));
    assert.equal(retry.state, "failed"); assert.equal(transcriptions, 3);
    assert.equal(retry.audio, 1); assert.equal(retry.stage, "reply");
    failReply = false; await app.qr.retry(retry.id); await app.qr.idle();
    assert.equal(transcriptions, 3); assert.equal(sends, 3);
    const stored = (await app.runtime.client.execute("SELECT message FROM qr_jobs")).rows;
    assert.ok(stored.every(row => !row.message.includes(bytes.toString("base64"))));
  } finally { await app.close(); await releaseDirectory(dataDir); }
});

test("áudio Cloud: webhook assinado baixa mídia autenticada, transcreve e responde uma vez", async () => {
  const dataDir = await testDirectory(); let sends = 0, transcriptions = 0, downloads = 0;
  const config = { accessToken: "test-meta", appSecret: "test-app-secret", phoneNumberId: "123456789", businessAccountId: "987654321" };
  const app = await startTestServer({ port: 0, dataDir, ai: { apiKey: "test-gemini" }, metaFetch: async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer test-meta");
    if (url.includes("/messages")) { sends++; return Response.json({ messages: [{ id: `sent-${sends}` }] }); }
    if (url.includes("graph.facebook.com")) return Response.json({ url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/test", mime_type: mimeType });
    downloads++; return new Response(bytes);
  }, aiFetch: async (_url, options) => {
    if (JSON.parse(options.body).contents[0].parts[1]?.inlineData) { transcriptions++; return Response.json({ candidates: [{ content: { parts: [{ text: "Quero conhecer o Sopro." }] } }] }); }
    assert.match(options.body, /Quero conhecer o Sopro/);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ formatRationale: "Resposta em texto", message: { text: "Vamos falar sobre o Sopro." } }) }] } }] });
  } });
  try {
    await app.settings.update({ ...config, autoReply: true });
    const raw = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: config.businessAccountId, changes: [{ field: "messages", value: { metadata: { phone_number_id: config.phoneNumberId }, messages: [{ id: "audio-cloud", from: "5511888888888", timestamp: String(Math.floor(Date.now() / 1000)), type: "audio", audio: { id: "12345", voice: true, mime_type: mimeType } }] } }] }] }));
    const signature = "sha256=" + createHmac("sha256", config.appSecret).update(raw).digest("hex");
    await app.whatsapp.accept(raw, signature); await app.whatsapp.idle();
    assert.equal((await app.whatsapp.status()).jobs[0]?.state, "done", JSON.stringify(await app.whatsapp.status()));
    assert.equal(transcriptions, 1); assert.equal(downloads, 1); assert.equal(sends, 1);
    assert.equal((await app.whatsapp.status()).jobs[0].state, "done");
    assert.equal((await app.whatsapp.status()).jobs[0].audio, 1); assert.equal((await app.whatsapp.status()).jobs[0].stage, "reply");
    assert.match((await app.whatsapp.history("5511888888888")).history[0].text, /Áudio transcrito/);
    await app.whatsapp.accept(raw, signature); await app.whatsapp.idle(); assert.equal(transcriptions, 1);
  } finally { await app.close(); await releaseDirectory(dataDir); }
});
