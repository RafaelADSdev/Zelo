import { automaticAllowed, assertAutomatic } from "./reply-schedule.mjs";
import makeWASocket, { Browsers, DisconnectReason, jidNormalizedUser, makeCacheableSignalKeyStore, normalizeMessageContent } from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { createHash, randomUUID } from "node:crypto";
import { createQrAuth } from "./qr-auth.mjs";
import { fail } from "./settings.mjs";
import { qrMedia } from "./media.mjs";
import { qrAudio, downloadQrAudio } from "./audio.mjs";

const logger = pino({ level: "silent" });
const direct = jid => /^\d{5,20}@(s\.whatsapp\.net|lid)$/.test(jid || "");
function recipient(phone) {
  const jid = /^\d{7,20}$/.test(phone || "") ? `${phone}@s.whatsapp.net` : phone;
  if (!direct(jid)) throw fail("Informe o número com DDI e DDD ou selecione um contato recebido.");
  return jid;
}
export async function createWhatsAppQr({ runtime, settings, socketFactory = makeWASocket, audioDownload, clock = Date.now }) {
  const db = runtime.client;
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS qr_contacts (account TEXT NOT NULL, jid TEXT NOT NULL, name TEXT, last_inbound INTEGER, last_text TEXT, PRIMARY KEY(account,jid));
    CREATE TABLE IF NOT EXISTS qr_jobs (id TEXT PRIMARY KEY, account TEXT NOT NULL, jid TEXT NOT NULL, message TEXT NOT NULL, state TEXT NOT NULL, error TEXT, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS qr_jobs_contact_state ON qr_jobs(account,jid,state);
    CREATE TABLE IF NOT EXISTS qr_outbox (id TEXT PRIMARY KEY, account TEXT NOT NULL, jid TEXT NOT NULL, text TEXT NOT NULL, hash TEXT NOT NULL, state TEXT NOT NULL, meta_id TEXT, error TEXT, created INTEGER NOT NULL);
    UPDATE qr_jobs SET state='pending' WHERE state='processing';
    UPDATE qr_outbox SET state='unknown',error='Servidor reiniciado durante envio. Confira no celular antes de reenviar.' WHERE state='sending';
  `);
  let socket, auth, generation = 0, reconnectTimer, qrTimer, events = [], eventQueue = Promise.resolve();
  const workers = new Set();
  let stopped = false, desired = false, retries = 0;
  let state = { status: "disconnected", account: settings.get().qrAccount || "", qr: "", expiresAt: 0, error: "" };
  const event = detail => { events.unshift({ at: clock(), detail }); events = events.slice(0, 30); };
  function enqueue(task) {
    const result = eventQueue.then(task);
    eventQueue = result.catch(() => { state.error = "Falha ao salvar um evento da conexão. Confira a fila e reconecte."; });
    return result;
  }
  const accountId = jid => `whatsapp-qr:${state.account}:${jid}`;
  function online() {
    if (settings.get().whatsappMode !== "qr" || state.status !== "connected" || !socket) throw fail("Conecte seu WhatsApp pelo QR Code primeiro.", 409);
  }
  async function send(jid, text, id, material) {
    online();
    const account = state.account, currentSocket = socket;
    const hash = createHash("sha256").update(jid + "\n" + text + (material?.id || "")).digest("hex");
    const existing = (await db.execute({ sql: "SELECT * FROM qr_outbox WHERE id=?", args: [id] })).rows[0];
    if (existing) {
      if (existing.account !== account || existing.jid !== jid || (!id.startsWith("auto:") && existing.hash !== hash)) throw fail("Este envio pertence a outra mensagem ou conta.", 409);
      if (["sent", "delivered", "read"].includes(existing.state)) return { status: "sent", messageId: existing.meta_id, text: existing.text };
      throw fail("Envio já iniciado ou sem confirmação. Confira no celular antes de reenviar.", 409);
    }
    const file = material ? await runtime.catalog.file(material.id, true) : null;
    await db.execute({ sql: "INSERT INTO qr_outbox(id,account,jid,text,hash,state,created) VALUES (?,?,?,?,?,'sending',?)", args: [id, account, jid, text, hash, clock()] });
    try {
      online();
      if (socket !== currentSocket || state.account !== account) throw fail("A conexão mudou durante o envio.", 409);
      const result = await currentSocket.sendMessage(jid, file ? qrMedia(file) : { text });
      if (!result?.key?.id) throw new Error("missing message id");
      await db.execute({ sql: "UPDATE qr_outbox SET state='sent',meta_id=? WHERE id=?", args: [result.key.id, id] });
      await db.execute({ sql: "INSERT INTO qr_contacts(account,jid,name,last_inbound,last_text) VALUES (?,?,?,0,?) ON CONFLICT(account,jid) DO UPDATE SET last_text=excluded.last_text", args: [account, jid, jid.split("@")[0], text] });
      return { status: "sent", messageId: result.key.id, text };
    } catch {
      await db.execute({ sql: "UPDATE qr_outbox SET state='unknown',error='WhatsApp não confirmou o envio. Confira no celular antes de repetir.' WHERE id=?", args: [id] });
      throw fail("WhatsApp não confirmou o envio. Confira no celular antes de repetir.", 504);
    }
  }
  async function drain() {
    while (!stopped && state.status === "connected" && settings.get().whatsappMode === "qr") {
      const job = (await db.execute({ sql: "SELECT j.* FROM qr_jobs j WHERE j.account=? AND j.state IN ('pending','requested') AND NOT EXISTS (SELECT 1 FROM qr_jobs busy WHERE busy.account=j.account AND busy.jid=j.jid AND busy.state='processing') ORDER BY j.created,j.rowid LIMIT 1", args: [state.account] })).rows[0];
      if (!job) return;
      const claimed = await db.execute({ sql: "UPDATE qr_jobs SET state='processing',error=NULL WHERE id=? AND state=? AND NOT EXISTS (SELECT 1 FROM qr_jobs busy WHERE busy.account=qr_jobs.account AND busy.jid=qr_jobs.jid AND busy.state='processing')", args: [job.id, job.state] });
      if (!claimed.rowsAffected) continue;
      if (job.state !== "requested" && !automaticAllowed(settings.get(), JSON.parse(job.message).timestamp, clock())) {
        const message = JSON.parse(job.message);
        await runtime.memory.append({ id: message.id, contactId: message.contactId, role: "user", text: message.text, timestamp: message.timestamp });
        await db.execute({ sql: "UPDATE qr_jobs SET state='manual',error='Resposta automática pausada pelo controle de atendimento.' WHERE id=?", args: [job.id] }); continue;
      }
      try {
        const checkSchedule = () => { if (job.state !== "requested") assertAutomatic(settings.get(), JSON.parse(job.message).timestamp, clock()); };
        const message = JSON.parse(job.message);
        if (message.audioError) throw fail(message.audioError, 422);
        if (message.audio && !message.transcribed) {
          const audio = await downloadQrAudio(message.audio, audioDownload);
          if (state.account !== job.account || settings.get().whatsappMode !== "qr") throw fail("A conta conectada mudou durante o download.", 409);
          checkSchedule();
          const transcription = await runtime.transcribe(audio);
          if (state.account !== job.account || settings.get().whatsappMode !== "qr") throw fail("A conta conectada mudou durante a transcrição.", 409);
          message.text = `[Áudio transcrito] ${transcription.text}`;
          message.transcribed = true;
          delete message.audio;
          await db.execute({ sql: "UPDATE qr_jobs SET message=? WHERE id=?", args: [JSON.stringify(message), job.id] });
          await db.execute({ sql: "UPDATE turns SET text=? WHERE id=? AND contactId=? AND role='user'", args: [message.text, message.id, message.contactId] });
          await db.execute({ sql: "UPDATE qr_contacts SET last_text=? WHERE account=? AND jid=? AND last_inbound=?", args: [message.text, job.account, job.jid, message.timestamp] });
          checkSchedule();
        }
        await runtime.whatsapp(message, async (_to, outgoing) => {
          if (state.account !== job.account) throw fail("A conta conectada mudou.", 409);
          checkSchedule();
          const result = await send(job.jid, outgoing.text, `auto:${job.id}`);
          for (const material of outgoing.materials || []) {
            if (state.account !== job.account) throw fail("A conta conectada mudou.", 409);
            checkSchedule();
            await send(job.jid, `[Arquivo: ${material.name}]`, `auto:${job.id}:file:${material.id}`, material);
          }
          return result;
        });
        await db.execute({ sql: "UPDATE qr_jobs SET state='done' WHERE id=?", args: [job.id] });
      } catch (error) {
        await db.execute({ sql: "UPDATE qr_jobs SET state=?,error=? WHERE id=?", args: [error.replyPaused ? "manual" : "failed", error.status ? error.message : "Não foi possível responder. Confira a conexão e o Gemini.", job.id] });
      }
    }
  }
  function kick() {
    if (stopped) return;
    while (workers.size < 2) {
      const task = Promise.resolve().then(drain).catch(() => event("Falha ao processar a fila local.")).finally(() => workers.delete(task));
      workers.add(task);
    }
  }
  async function incoming(upsert) {
    if (upsert.type !== "notify" || !desired || state.status !== "connected" || settings.get().whatsappMode !== "qr") return;
    const account = state.account;
    for (const item of upsert.messages || []) {
      const jid = jidNormalizedUser(item.key?.remoteJid || "");
      if (item.key?.fromMe || !direct(jid) || !item.key?.id || !item.message || item.messageStubType) continue;
      const content = normalizeMessageContent(item.message);
      const text = content?.conversation || content?.extendedTextMessage?.text;
      const audio = content?.audioMessage;
      if ((!text || typeof text !== "string" || !text.trim()) && !audio) continue;
      // Offline/history messages must never trigger a retroactive wave of replies.
      const at = Number(item.messageTimestamp) * 1000;
      if (!Number.isFinite(at) || at < connectedAt - 60000 || at > clock() + 60000) continue;
      const id = `${account}:${jid}:${item.key.id}`;
      const message = { id, contactId: `whatsapp-qr:${account}:${jid}`, channel: "whatsapp", text: audio ? "[Áudio recebido — aguardando transcrição]" : text.slice(0, 4000), timestamp: at };
      if (audio) {
        try { message.audio = qrAudio(audio); } catch (error) { message.audioError = error.status ? error.message : "Referência de áudio inválida."; }
      }
      const inserted = await db.execute({ sql: "INSERT OR IGNORE INTO qr_jobs(id,account,jid,message,state,created) VALUES (?,?,?,?,'pending',?)", args: [id, account, jid, JSON.stringify(message), clock()] });
      if (!inserted.rowsAffected) continue;
      await db.execute({ sql: "INSERT INTO qr_contacts(account,jid,name,last_inbound,last_text) VALUES (?,?,?,?,?) ON CONFLICT(account,jid) DO UPDATE SET name=excluded.name,last_inbound=excluded.last_inbound,last_text=excluded.last_text", args: [account, jid, item.pushName || jid.split("@")[0], at, message.text] });
    }
    kick();
  }
  let connectedAt = 0;
  async function openSocket() {
    const token = ++generation;
    clearTimeout(reconnectTimer); clearTimeout(qrTimer);
    state = { ...state, status: "connecting", qr: "", expiresAt: 0, error: "" };
    if (auth) await auth.close();
    auth = await createQrAuth(db);
    if (!desired || stopped || token !== generation) { await auth.close(); return; }
    const thisAuth = auth;
    const sock = socketFactory({ auth: { creds: auth.state.creds, keys: makeCacheableSignalKeyStore(auth.state.keys, logger) }, logger,
      browser: Browsers.ubuntu("Chrome"), printQRInTerminal: false, syncFullHistory: false,
      shouldSyncHistoryMessage: () => false, markOnlineOnConnect: false, connectTimeoutMs: 20000, defaultQueryTimeoutMs: 20000,
      shouldIgnoreJid: jid => !direct(jidNormalizedUser(jid)),
    });
    socket = sock;
    sock.ev.on("creds.update", () => { if (token === generation) enqueue(() => thisAuth.save()); });
    sock.ev.on("messages.upsert", data => { if (token === generation) enqueue(() => incoming(data)); });
    sock.ev.on("messages.update", updates => { if (token === generation) enqueue(async () => {
      for (const { key, update } of updates) if (key.fromMe && update.status >= 3) {
        const status = update.status >= 4 ? "read" : "delivered";
        await db.execute({ sql: "UPDATE qr_outbox SET state=? WHERE account=? AND meta_id=? AND state IN ('sent','delivered')", args: [status, state.account, key.id] });
      }
    }); });
    sock.ev.on("connection.update", update => { if (token === generation) enqueue(async () => {
      if (token !== generation) return;
      if (update.qr) {
        const qr = await QRCode.toDataURL(update.qr, { width: 320, margin: 3, errorCorrectionLevel: "M" });
        if (token !== generation) return;
        clearTimeout(qrTimer);
        state = { ...state, status: "qr", qr, expiresAt: clock() + 55000 };
        qrTimer = setTimeout(() => { if (token === generation) state = { ...state, qr: "", status: "expired", expiresAt: 0 }; }, 55000); qrTimer.unref();
      }
      if (update.connection === "open") {
        clearTimeout(qrTimer); retries = 0; connectedAt = clock();
        const account = jidNormalizedUser(sock.user?.id || "");
        if (!direct(account)) { state.error = "WhatsApp não identificou a conta vinculada."; return; }
        state = { status: "connected", account, qr: "", expiresAt: 0, error: "" };
        await settings.mark({ qrAccount: account, qrAutoConnect: true });
        event("WhatsApp vinculado. Novas mensagens individuais de texto e áudio podem ser atendidas."); kick();
      }
      if (update.connection === "close") {
        clearTimeout(qrTimer); socket = null;
        const code = update.lastDisconnect?.error?.output?.statusCode;
        state = { ...state, status: "disconnected", qr: "", expiresAt: 0 };
        if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession || code === DisconnectReason.connectionReplaced) {
          desired = false; state.error = "Sessão encerrada ou substituída. Clique em Gerar QR Code para vincular novamente.";
          await settings.mark({ qrAutoConnect: false }); await thisAuth.clear(); return;
        }
        if (desired && !stopped && retries < 6) {
          const delay = code === DisconnectReason.restartRequired ? 500 : Math.min(30000, 1500 * 2 ** retries);
          retries++; state.status = "reconnecting";
          reconnectTimer = setTimeout(() => { openSocket().catch(() => { state.status = "disconnected"; state.error = "Falha ao reconectar. Tente gerar outro QR Code."; }); }, delay); reconnectTimer.unref();
        } else { desired = false; state.error = "Conexão encerrada. Tente gerar outro QR Code."; }
      }
    }); });
  }
  async function disconnect() {
    desired = false; generation++; clearTimeout(reconnectTimer); clearTimeout(qrTimer);
    const old = socket; socket = null; old?.end(new Error("Conexão pausada pelo painel"));
    await eventQueue; if (auth) await auth.close();
    state = { ...state, status: "disconnected", qr: "", expiresAt: 0, error: "" };
    await settings.mark({ qrAutoConnect: false });
  }
  const timer = setInterval(kick, 2000); timer.unref();
  const service = {
    state: () => ({ ...state, qr: state.expiresAt > clock() ? state.qr : "" }),
    async connect() {
      if (settings.get().whatsappMode !== "qr") throw fail("Selecione o modo QR Code nas conexões.", 409);
      if (desired && ["connected", "connecting", "qr", "reconnecting"].includes(state.status)) return this.state();
      await disconnect(); desired = true; retries = 0;
      try { await openSocket(); } catch {
        await disconnect(); state.error = "Não foi possível iniciar a conexão. Tente novamente.";
        throw fail(state.error, 502);
      }
      return this.state();
    },
    disconnect,
    async logout() {
      if (socket && state.status === "connected") {
        try { await socket.logout(); } catch { throw fail("Não foi possível revogar a sessão. Remova este dispositivo em Aparelhos conectados no celular.", 502); }
      }
      await disconnect(); if (auth) await auth.clear();
      await settings.mark({ qrAccount: "", qrAutoConnect: false }); state.account = "";
      return { loggedOut: true };
    },
    async manual(input) {
      if (input.template) throw fail("Templates pertencem à Cloud API. Neste modo envie texto.");
      if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 4000 || !/^[a-f0-9-]{36}$/.test(input.requestId || "")) throw fail("Informe uma mensagem de até 4.000 caracteres e um identificador válido.");
      return send(recipient(input.phone), input.text.trim(), `manual:${input.requestId}`);
    },
    async conversations() { return (await db.execute({ sql: "SELECT jid AS phone,name,last_inbound,last_text FROM qr_contacts WHERE account=? ORDER BY last_inbound DESC LIMIT 100", args: [state.account] })).rows; },
    async history(phone) {
      const jid = recipient(phone);
      const outbound = (await db.execute({ sql: "SELECT id,text,state,meta_id AS metaId,error,created FROM qr_outbox WHERE account=? AND jid=? ORDER BY created LIMIT 200", args: [state.account, jid] })).rows;
      return { history: (await runtime.state(accountId(jid))).history, outbound };
    },
    async status() {
      const jobs = (await db.execute({ sql: "SELECT id,jid AS phone,state,error,created FROM qr_jobs WHERE account=? ORDER BY created DESC LIMIT 100", args: [state.account] })).rows;
      const outbox = (await db.execute({ sql: "SELECT jid AS phone,state,error FROM qr_outbox WHERE account=? AND state='unknown' LIMIT 100", args: [state.account] })).rows;
      return { jobs, events, outbox };
    },
    async retry(id) {
      online();
      const out = (await db.execute({ sql: "SELECT state FROM qr_outbox WHERE id=?", args: [`auto:${id}`] })).rows[0];
      if (out) throw fail("Este atendimento já teve uma tentativa de envio. Confira no celular antes de enviar manualmente.", 409);
      await db.execute({ sql: "UPDATE qr_jobs SET state='requested',error=NULL WHERE id=? AND account=? AND state IN ('failed','manual')", args: [id, state.account] }); kick(); return { queued: true };
    },
    async idle() { await eventQueue; while (workers.size) await Promise.all([...workers]); },
    async close() {
      const resume = settings.get().qrAutoConnect;
      stopped = true; clearInterval(timer); await disconnect(); while (workers.size) await Promise.all([...workers]);
      await settings.mark({ qrAutoConnect: resume });
    },
  };
  if (settings.get().whatsappMode === "qr" && settings.get().qrAutoConnect) await service.connect();
  return service;
}
