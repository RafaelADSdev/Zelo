import { assertAutomatic } from "./reply-schedule.mjs";
import { createHash, randomUUID } from "node:crypto";
import { parseWebhookPayload, verifySignature, renderSmartMessage } from "@wappy_ai/whatsapp";
import { fail } from "./settings.mjs";
import { cloudMedia } from "./media.mjs";
import { downloadCloudAudio } from "./audio.mjs";
import { createContactBlocks } from "./contact-blocks.mjs";

const WINDOW = 24 * 60 * 60 * 1000;
const phonePattern = /^\d{7,20}$/;
export async function createWhatsApp({ runtime, settings, fetchImpl = fetch, clock = Date.now }) {
  const db = runtime.client;
  const blocks = await createContactBlocks(db);
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS wa_contacts (phone TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT, last_inbound INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wa_jobs (id TEXT PRIMARY KEY, phone TEXT NOT NULL, message TEXT NOT NULL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, error TEXT, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS wa_jobs_contact_state ON wa_jobs(phone,state);
    CREATE TABLE IF NOT EXISTS wa_outbox (id TEXT PRIMARY KEY, phone TEXT NOT NULL, account_id TEXT NOT NULL, text TEXT NOT NULL, payload TEXT NOT NULL, hash TEXT NOT NULL, state TEXT NOT NULL, meta_id TEXT, error TEXT, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wa_statuses (id TEXT PRIMARY KEY, status TEXT NOT NULL, rank INTEGER NOT NULL, at INTEGER NOT NULL, error TEXT);
    CREATE TABLE IF NOT EXISTS wa_events (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, detail TEXT NOT NULL, at INTEGER NOT NULL);
    UPDATE wa_jobs SET state='pending' WHERE state='processing';
    UPDATE wa_outbox SET state='unknown', error='Servidor reiniciado durante o envio. Confira o WhatsApp antes de enviar novamente.' WHERE state='sending';
  `);
  let stopped = false;
  const workers = new Set();
  const event = async (type, detail) => {
    await db.execute({ sql: "INSERT INTO wa_events(type, detail, at) VALUES (?,?,?)", args: [type, detail, clock()] });
    await db.execute("DELETE FROM wa_events WHERE id NOT IN (SELECT id FROM wa_events ORDER BY id DESC LIMIT 200)");
  };
  function config() {
    const value = settings.get();
    if (!value.accessToken || !value.phoneNumberId || !value.appSecret) throw fail("Preencha token de acesso, ID do número e App Secret nas conexões do WhatsApp.", 409);
    return value;
  }
  async function graph(path, method = "GET", body) {
    const value = config();
    let response;
    try {
      response = await fetchImpl(`https://graph.facebook.com/${value.graphVersion}/${path}`, {
        method, redirect: "error", headers: { Authorization: `Bearer ${value.accessToken}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
      });
    } catch { throw fail("A Meta não confirmou a solicitação. Verifique a conexão; um envio pode ter sido recebido pela Meta.", 504); }
    let data; try { data = await response.json(); } catch { throw fail("Resposta inválida da Meta. Confira o status antes de repetir um envio.", 504); }
    if (!response.ok || data.error) {
      const code = Number(data.error?.code) || response.status;
      const descriptions = { 190: "Token de acesso inválido ou expirado.", 10: "Token sem permissão para esta conta.", 200: "Token sem permissão para esta conta.", 131047: "A janela de 24 horas terminou. Use um template aprovado.", 131030: "Destinatário não autorizado no ambiente da Meta. Adicione-o à lista de destinatários de teste.", 100: "A Meta recusou os parâmetros. Confira os IDs, o registro do número e o template." };
      throw fail(`${descriptions[code] || "A Meta recusou a solicitação."} Código ${code}.`, 502);
    }
    return data;
  }
  async function send(phone, outgoing, id, template) {
    if (settings.get().whatsappMode === "qr") throw fail("O modo Cloud API está pausado.", 409);
    if (!phonePattern.test(phone)) throw fail("Informe o número com DDI e DDD, somente dígitos.");
    const value = config();
    const payload = outgoing.attachment ? { fileId: outgoing.attachment.id } : template
      ? { messaging_product: "whatsapp", to: phone, type: "template", template }
      : renderSmartMessage({ text: outgoing.text }, phone);
    const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const existing = (await db.execute({ sql: "SELECT * FROM wa_outbox WHERE id=?", args: [id] })).rows[0];
    if (existing) {
      if (existing.account_id !== value.phoneNumberId) throw fail("Este envio pertence a outro número da Meta. Não será repetido com a nova conexão.", 409);
      if (!id.startsWith("auto:") && existing.hash !== hash) throw fail("Identificador de envio reutilizado com outra mensagem.", 409);
      if (existing.state === "sent") return { status: "sent", messageId: existing.meta_id, text: existing.text };
      if (["unknown", "sending"].includes(existing.state)) throw fail(existing.error || "Envio em andamento ou sem confirmação. Confira o WhatsApp antes de tentar novamente.", 409);
    }
    if (!template) {
        const contact = (await db.execute({ sql: "SELECT last_inbound FROM wa_contacts WHERE phone=? AND account_id=?", args: [phone, value.phoneNumberId] })).rows[0];
        if (!contact || clock() - Number(contact.last_inbound) >= WINDOW) throw fail("Texto livre exige uma mensagem recebida desse contato nas últimas 24 horas. Use um template aprovado ou peça que o contato envie uma mensagem.", 409);
    }
    if (!existing) await db.execute({ sql: "INSERT INTO wa_outbox(id,phone,account_id,text,payload,hash,state,created) VALUES (?,?,?,?,?,?,'pending',?)", args: [id, phone, value.phoneNumberId, outgoing.text || `[Template: ${template.name}]`, JSON.stringify(payload), hash, clock()] });
    // Persist before calling Meta. An interrupted POST is never retried silently.
    const claimed = await db.execute({ sql: "UPDATE wa_outbox SET state='sending',error=NULL WHERE id=? AND state IN ('pending','failed')", args: [id] });
    if (claimed.rowsAffected !== 1) throw fail("Este envio já está em andamento.", 409);
    let accepted = false;
    try {
      let packet = existing ? JSON.parse(existing.payload) : payload;
      if (packet.fileId) {
        const file = await runtime.catalog.file(packet.fileId, true);
        if (id.startsWith("auto:")) await blocks.assertAllowed("cloud", value.phoneNumberId, phone);
        packet = await cloudMedia(value, file, phone, fetchImpl);
      }
      if (settings.get().whatsappMode === "qr" || settings.get().phoneNumberId !== value.phoneNumberId) throw fail("A conexão mudou durante o envio.", 409);
      if (id.startsWith("auto:")) await blocks.assertAllowed("cloud", value.phoneNumberId, phone);
      const result = await graph(`${value.phoneNumberId}/messages`, "POST", packet);
      const metaId = result.messages?.[0]?.id;
      if (typeof metaId !== "string" || !metaId) throw fail("A Meta não retornou um ID de mensagem. Confira o WhatsApp antes de reenviar.", 504);
      accepted = true;
      await db.execute({ sql: "UPDATE wa_outbox SET state='sent',meta_id=? WHERE id=?", args: [metaId, id] });
      await event("sent", `Mensagem aceita pela Meta para ${phone}.`).catch(() => {});
      return { status: "sent", messageId: metaId, text: existing?.text || outgoing.text };
    } catch (error) {
      if (error.contactBlocked) {
        await db.execute({ sql: "UPDATE wa_outbox SET state='failed',error=? WHERE id=?", args: [error.message, id] });
        throw error;
      }
      const message = error.status ? error.message : "Falha ao registrar o resultado do envio. Confira o WhatsApp antes de repetir.";
      const uncertain = accepted || error.status === 504 || !error.status;
      await db.execute({ sql: "UPDATE wa_outbox SET state=?,error=? WHERE id=?", args: [uncertain ? "unknown" : "failed", message, id] }).catch(() => {});
      await event("send_error", message).catch(() => {});
      throw fail(message, uncertain ? 504 : error.status);
    }
  }
  async function drain() {
    while (!stopped) {
      if (settings.get().whatsappMode === "qr") return;
      const job = (await db.execute({ sql: "SELECT j.* FROM wa_jobs j WHERE j.state IN ('pending','requested') AND j.next_at<=? AND NOT EXISTS (SELECT 1 FROM wa_jobs busy WHERE busy.phone=j.phone AND busy.state='processing') ORDER BY j.created,j.rowid LIMIT 1", args: [clock()] })).rows[0];
      if (!job) return;
      const claimed = await db.execute({ sql: "UPDATE wa_jobs SET state='processing',attempts=attempts+1 WHERE id=? AND state=? AND NOT EXISTS (SELECT 1 FROM wa_jobs busy WHERE busy.phone=wa_jobs.phone AND busy.state='processing')", args: [job.id, job.state] });
      if (!claimed.rowsAffected) continue;
      try {
        const checkSchedule = async () => { await blocks.assertAllowed("cloud", JSON.parse(job.message).accountId, job.phone); if (job.state !== "requested") assertAutomatic(settings.get(), JSON.parse(job.message).timestamp, clock()); };
        await checkSchedule();
        const message = JSON.parse(job.message);
        if (message.accountId !== settings.get().phoneNumberId) throw fail("Mensagem recebida em outro número da Meta. Verifique a configuração antes de tentar novamente.", 409);
        if (["audio", "voice"].includes(message.media?.kind) && !message.transcribed) {
          await db.execute({ sql: "UPDATE wa_jobs SET message=json_set(message,'$.audioStage','download') WHERE id=?", args: [job.id] });
          const audio = await downloadCloudAudio(message.media, config(), fetchImpl);
          if (message.accountId !== settings.get().phoneNumberId || settings.get().whatsappMode === "qr") throw fail("A conta conectada mudou durante o download.", 409);
          await checkSchedule();
          await db.execute({ sql: "UPDATE wa_jobs SET message=json_set(message,'$.audioStage','transcribe') WHERE id=?", args: [job.id] });
          const transcription = await runtime.transcribe(audio);
          if (message.accountId !== settings.get().phoneNumberId || settings.get().whatsappMode === "qr") throw fail("A conta conectada mudou durante a transcrição.", 409);
          message.text = `[Áudio transcrito] ${transcription.text}`;
          message.transcribed = true;
          message.audioStage = "reply";
          delete message.media;
          await db.execute({ sql: "UPDATE wa_jobs SET message=? WHERE id=?", args: [JSON.stringify(message), job.id] });
          await db.execute({ sql: "UPDATE turns SET text=? WHERE id=? AND contactId=? AND role='user'", args: [message.text, message.id, `whatsapp:${message.accountId}:${job.phone}`] });
          await checkSchedule();
        }
        if (!message.text || message.text.startsWith("[unsupported WhatsApp")) {
          const text = "Posso entender mensagens de texto e de voz. Por favor, descreva o que você precisa por escrito ou envie um áudio.";
          await runtime.memory.append({ id: message.id, contactId: `whatsapp:${message.accountId}:${job.phone}`, role: "user", text: `[${message.media?.kind || "Mensagem não textual"}]`, timestamp: message.timestamp });
          await checkSchedule();
          await send(job.phone, { text }, `auto:${message.id}`);
          await runtime.memory.append({ id: `${message.id}:reply`, contactId: `whatsapp:${message.accountId}:${job.phone}`, role: "agent", text, timestamp: clock() });
        } else {
          await runtime.whatsapp({ ...message, contactId: `whatsapp:${message.accountId}:${job.phone}` }, async (_to, outgoing) => {
            await checkSchedule();
          const result = await send(job.phone, outgoing, `auto:${message.id}`);
            for (const material of outgoing.materials || []) {
              if (message.accountId !== settings.get().phoneNumberId) throw fail("A conta conectada mudou.", 409);
              await checkSchedule();
              await send(job.phone, { text: `[Arquivo: ${material.name}]`, attachment: material }, `auto:${message.id}:file:${material.id}`);
            }
            return result;
          });
        }
        await db.execute({ sql: "UPDATE wa_jobs SET state='done',error=NULL WHERE id=?", args: [job.id] });
      } catch (error) {
        if (error.contactBlocked || error.replyPaused) {
          const message = JSON.parse(job.message);
          await runtime.memory.append({ id: message.id, contactId: `whatsapp:${message.accountId}:${job.phone}`, role: "user", text: message.text || `[${message.media?.kind || "Mídia"} recebida — IA não acionada]`, timestamp: message.timestamp });
        }
        // Errors remain visible for operator retry; no hidden duplicate messages.
        await db.execute({ sql: "UPDATE wa_jobs SET state=?,error=? WHERE id=?", args: [error.contactBlocked ? "blocked" : error.replyPaused ? "manual" : "failed", error.message, job.id] });
        await event("processing_error", error.message);
      }
    }
  }
  function kick() {
    if (stopped) return;
    while (workers.size < 2) {
      const task = Promise.resolve().then(drain).catch(() => event("worker_error", "Falha ao processar fila local.").catch(() => {})).finally(() => workers.delete(task));
      workers.add(task);
    }
  }
  const timer = setInterval(kick, 2000); timer.unref(); kick();
  return {
    async verify() {
      const value = config();
      const phone = await graph(`${value.phoneNumberId}?fields=id,display_phone_number,verified_name`);
      if (String(phone.id) !== value.phoneNumberId) throw fail("A Meta não retornou o número configurado.", 502);
      await settings.mark({ phone: { id: phone.id, number: phone.display_phone_number || "", name: phone.verified_name || "" }, validatedAt: clock() });
      await event("connection", "Credenciais e número validados na Meta.");
      return settings.public();
    },
    async subscribe() {
      const value = config();
      if (!value.businessAccountId) throw fail("Informe o WhatsApp Business Account ID (WABA ID).");
      const result = await graph(`${value.businessAccountId}/subscribed_apps`, "POST", {});
      if (result.success !== true) throw fail("A Meta não confirmou a inscrição do aplicativo na WABA.", 502);
      await settings.mark({ subscribedAt: clock() });
      await event("subscription", "Aplicativo inscrito na conta WhatsApp Business.");
      return { subscribed: true };
    },
    async templates() {
      const value = config();
      if (!value.businessAccountId) throw fail("Informe o WABA ID para listar templates.");
      const result = await graph(`${value.businessAccountId}/message_templates?fields=name,language,status,components,parameter_format&limit=100`);
      if (!Array.isArray(result.data)) throw fail("A Meta não retornou uma lista válida de templates.", 502);
      return { templates: result.data.filter(item => item.status === "APPROVED").map(({ name, language, components, parameter_format }) => ({ name, language, components, parameterFormat: parameter_format })) };
    },
    async accept(raw, signature) {
      if (settings.get().whatsappMode === "qr") throw fail("O modo Cloud API está pausado enquanto QR Code está selecionado.", 409);
      const value = config();
      if (!verifySignature(raw, signature, value.appSecret)) throw fail("Assinatura do webhook inválida.", 403);
      let payload; try { payload = JSON.parse(raw.toString("utf8")); } catch { throw fail("JSON inválido."); }
      if (payload.object !== "whatsapp_business_account") throw fail("Evento inválido.");
      if (!Array.isArray(payload.entry)) throw fail("Lista de eventos inválida.");
      let accepted = 0;
      for (const entry of payload.entry || []) {
        if (value.businessAccountId && String(entry.id) !== value.businessAccountId) continue;
        for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
          if (change.field !== "messages" || String(change.value?.metadata?.phone_number_id) !== value.phoneNumberId) continue;
          const { messages, statuses } = parseWebhookPayload({ entry: [{ changes: [change] }] });
          for (const status of statuses) {
            const rank = { sent: 1, failed: 2, delivered: 3, read: 4 }[status.status];
            await db.execute({ sql: "INSERT INTO wa_statuses(id,status,rank,at,error) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,rank=excluded.rank,at=excluded.at,error=excluded.error WHERE excluded.rank>wa_statuses.rank OR (excluded.rank=wa_statuses.rank AND excluded.at>wa_statuses.at)", args: [status.messageId, status.status, rank, status.timestamp, status.error ? `Falha de entrega Meta: ${status.error.code}` : null] });
          }
          for (const message of messages) {
            if (!phonePattern.test(message.contactId) || message.id.length > 256 || message.raw?.type === "reaction") continue;
            const name = (Array.isArray(change.value.contacts) ? change.value.contacts : []).find(item => item.wa_id === message.contactId)?.profile?.name || message.contactId;
            await db.execute({ sql: "INSERT INTO wa_contacts(phone,account_id,name,last_inbound) VALUES(?,?,?,?) ON CONFLICT(phone) DO UPDATE SET name=excluded.name,account_id=excluded.account_id,last_inbound=CASE WHEN wa_contacts.account_id=excluded.account_id THEN MAX(last_inbound,excluded.last_inbound) ELSE excluded.last_inbound END", args: [message.contactId, value.phoneNumberId, String(name).slice(0, 100), Math.min(message.timestamp, clock())] });
            delete message.raw;
            message.accountId = value.phoneNumberId;
            const result = await db.execute({ sql: "INSERT INTO wa_jobs(id,phone,message,state,created) VALUES(?,?,?,'pending',?) ON CONFLICT(id) DO NOTHING", args: [message.id, message.contactId, JSON.stringify(message), clock()] });
            accepted += result.rowsAffected;
          }
        }
      }
      await settings.mark({ lastWebhookAt: clock() });
      if (accepted) await event("received", `${accepted} mensagem(ns) recebida(s).`);
      kick();
      return { accepted };
    },
    async manual(input) {
      const { phone, text, template, requestId } = input || {};
      if (typeof phone !== "string" || !phonePattern.test(phone) || typeof requestId !== "string" || !/^[\w-]{16,100}$/.test(requestId)) throw fail("Informe número válido e identificador único de envio.");
      if (template) {
        if (typeof template.name !== "string" || !/^[a-z0-9_]{1,512}$/.test(template.name) || typeof template.language?.code !== "string" || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(template.language.code)) throw fail("Nome ou idioma do template inválido.");
        const components = template.components || [];
        if (!Array.isArray(components) || JSON.stringify(components).length > 12000) throw fail("Componentes do template inválidos.");
      } else if (typeof text !== "string" || !text.trim() || text.length > 4000) throw fail("Informe uma mensagem de até 4.000 caracteres.");
      const id = `manual:${requestId}`;
      const displayText = template ? `[Template: ${template.name}]` : text.trim();
      const result = await send(phone, { text: displayText }, id, template);
      const accountId = settings.get().phoneNumberId;
      await runtime.memory.append({ id, contactId: `whatsapp:${accountId}:${phone}`, role: "agent", text: displayText, timestamp: clock() });
      await db.execute({ sql: "INSERT INTO wa_contacts(phone,account_id,name,last_inbound) VALUES(?,?,?,0) ON CONFLICT(phone) DO UPDATE SET account_id=excluded.account_id,last_inbound=CASE WHEN wa_contacts.account_id=excluded.account_id THEN wa_contacts.last_inbound ELSE 0 END", args: [phone, accountId, phone] });
      return result;
    },
    async conversations() {
      return blocks.contacts("cloud", settings.get().phoneNumberId, (await db.execute({ sql: "SELECT c.*, (SELECT text FROM turns WHERE contactId='whatsapp:'||c.account_id||':'||c.phone ORDER BY timestamp DESC,rowid DESC LIMIT 1) AS last_text FROM wa_contacts c WHERE c.account_id=? ORDER BY last_inbound DESC LIMIT 100", args: [settings.get().phoneNumberId] })).rows);
    },
    async setBlocked(input) {
      if (typeof input?.phone !== "string" || !phonePattern.test(input.phone) || !settings.get().phoneNumberId) throw fail("Informe um contato válido e configure seu WhatsApp.");
      return blocks.set("cloud", settings.get().phoneNumberId, input.phone, input.blocked);
    },
    async history(phone) {
      if (!phonePattern.test(phone)) throw fail("Número inválido.");
      const accountId = settings.get().phoneNumberId;
      const history = await runtime.memory.load(`whatsapp:${accountId}:${phone}`);
      const outbound = (await db.execute({ sql: "SELECT o.*, s.status AS delivery_status, s.error AS delivery_error FROM wa_outbox o LEFT JOIN wa_statuses s ON s.id=o.meta_id WHERE o.phone=? AND o.account_id=? ORDER BY o.created", args: [phone, accountId] })).rows;
      return { history, blocked: await blocks.blocked("cloud", accountId, phone), outbound: outbound.map(({ id, text, state, meta_id, delivery_status, delivery_error, error, created }) => ({ id, text, state, metaId: meta_id, deliveryStatus: delivery_status, error: delivery_error || error, created })) };
    },
    async status() {
      return {
        jobs: (await db.execute("SELECT id,phone,state,error,attempts,created,CASE WHEN json_extract(message,'$.media.kind') IN ('audio','voice') OR json_extract(message,'$.transcribed')=1 THEN 1 ELSE 0 END AS audio,json_extract(message,'$.audioStage') AS stage FROM wa_jobs ORDER BY created DESC,rowid DESC LIMIT 50")).rows,
        events: (await db.execute("SELECT type,detail,at FROM wa_events ORDER BY id DESC LIMIT 30")).rows,
        outbox: (await db.execute("SELECT phone,state,error,created FROM wa_outbox WHERE state IN ('failed','unknown') ORDER BY created DESC LIMIT 20")).rows,
      };
    },
    async retry(id) {
      if (typeof id !== "string" || id.length > 256) throw fail("Mensagem inválida.");
      const job = (await db.execute({ sql: "SELECT phone,message,state FROM wa_jobs WHERE id=?", args: [id] })).rows[0];
      if (!job || JSON.parse(job.message).accountId !== settings.get().phoneNumberId) throw fail("Mensagem não encontrada neste WhatsApp.", 404);
      await blocks.assertAllowed("cloud", settings.get().phoneNumberId, job.phone);
      if (job.state === "blocked") throw fail("Esta mensagem foi recebida com a IA bloqueada. Após desbloquear, aguarde uma nova mensagem ou atenda manualmente.", 409);
      const unknown = (await db.execute({ sql: "SELECT state FROM wa_outbox WHERE id=?", args: [`auto:${id}`] })).rows[0];
      if (unknown && ["unknown", "sending"].includes(unknown.state)) throw fail("Envio sem confirmação. Confira o WhatsApp; uma nova tentativa automática foi bloqueada para evitar duplicação.", 409);
      await db.execute({ sql: "UPDATE wa_jobs SET state='requested',error=NULL WHERE id=? AND state IN ('failed','manual')", args: [id] }); kick();
      return { queued: true };
    },
    async idle() { kick(); while (workers.size) await Promise.all([...workers]); },
    async close() { stopped = true; clearInterval(timer); while (workers.size) await Promise.all([...workers]); },
  };
}
