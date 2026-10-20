import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { startTestServer as startServer, authenticatedFetch as fetch } from "./helpers.mjs";
import { testDirectory, releaseDirectory } from "./helpers.mjs";

async function cleanup(directory) {
  await releaseDirectory(directory);
}
test("sem credenciais, a aplicação não produz respostas simuladas nem envia", async () => {
  const dataDir = await testDirectory();
  const app = await startServer({ port: 0, dataDir });
  try {
    const result = await fetch(app.url + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Olá" }) });
    assert.equal(result.status, 409); assert.match((await result.json()).error, /Configure a chave/);
    const state = await (await fetch(app.url + "/api/state")).json();
    assert.equal(state.history.length, 0); assert.equal(state.knowledge, "");
    const outside = await fetch(app.url + "/api/settings", { method: "POST", headers: { Origin: "https://outside.invalid", "Content-Type": "application/json" }, body: "{}" });
    assert.equal(outside.status, 403);
    const forwarded = await fetch(app.url + "/api/dashboard", { headers: { "X-Forwarded-For": "1.2.3.4" } });
    assert.equal(forwarded.status, 403);
    assert.equal((await fetch(app.webhookUrl.replace("/webhook", "/api/dashboard"))).status, 404);
  } catch (error) { console.error("Primary test failure:", error); throw error; }
  finally { await app.close(); await cleanup(dataDir); }
});

test("webhook assinado → fila persistente → Gemini → envio Meta, dedupe e status", async () => {
  const dataDir = await testDirectory();
  const config = { accessToken: "meta-private-unit-token", appSecret: "unit-app-secret", phoneNumberId: "123456789", businessAccountId: "987654321" };
  const posts = []; let timeOutNextSend = false, modelCalls = 0;
  const metaFetch = async (url, options) => {
    assert.ok(url.startsWith("https://graph.facebook.com/v23.0/"));
    assert.equal(options.headers.Authorization, `Bearer ${config.accessToken}`);
    if (url.includes("/messages")) {
      if (timeOutNextSend) { timeOutNextSend = false; throw new Error("network unavailable"); }
      posts.push(JSON.parse(options.body));
      return Response.json({ messages: [{ id: `wamid.sent-${posts.length}` }] });
    }
    if (url.includes("subscribed_apps")) return Response.json({ success: true });
    if (url.includes("message_templates")) return Response.json({ data: [{ name: "approved_template", language: "pt_BR", status: "APPROVED" }, { name: "draft", language: "pt_BR", status: "PENDING" }] });
    return Response.json({ id: config.phoneNumberId, display_phone_number: "+55 11 00000-0000", verified_name: "Unit account" });
  };
  const geminiFetch = async (_url, options) => {
    modelCalls++; const request = JSON.parse(options.body);
    assert.ok(!options.body.includes(config.accessToken) && !options.body.includes(config.appSecret));
    const prompt = request.contents.at(-1).parts[0].text;
    if (prompt.includes("horário")) assert.match(prompt, /10h às 17h/);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ formatRationale: "Resposta em texto.", message: { text: "Atendemos das 10h às 17h." } }) }] } }] });
  };
  let app = await startServer({ port: 0, dataDir, ai: { apiKey: "gemini-private-unit-token" }, metaFetch, geminiFetch });
  const request = async (path, input) => {
    const response = await fetch(app.url + path, { ...(input === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }) });
    return { status: response.status, data: await response.json() };
  };
  const payload = (id, extra = {}) => ({ object: "whatsapp_business_account", entry: [{ id: config.businessAccountId, changes: [{ field: "messages", value: { metadata: { phone_number_id: config.phoneNumberId }, contacts: [{ wa_id: "5511999990000", profile: { name: "Cliente" } }], messages: [{ id, from: "5511999990000", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Qual o horário?" } }], ...extra } }] }] });
  const webhook = async body => {
    const raw = JSON.stringify(body);
    return fetch(app.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": "sha256=" + createHmac("sha256", config.appSecret).update(raw).digest("hex") }, body: raw });
  };
  try {
    assert.equal((await request("/api/settings", config)).status, 200);
    await Promise.all([app.settings.mark({ webhookVerifiedAt: 123 }), app.settings.update({ assistantName: "Atendimento" }), app.settings.mark({ lastWebhookAt: 456 })]);
    assert.equal(app.settings.public().assistantName, "Atendimento");
    assert.equal(app.settings.public().webhookVerifiedAt, 123);
    assert.equal(app.settings.public().lastWebhookAt, 456);
    await request("/api/knowledge", { text: "Horário de atendimento: das 10h às 17h." });
    const publicSettings = (await request("/api/dashboard")).data.settings;
    for (const secret of [config.accessToken, config.appSecret, "gemini-private-unit-token"]) assert.ok(!JSON.stringify(publicSettings).includes(secret));
    assert.equal((await request("/api/settings", { accessToken: "", apiKey: "" })).data.accessTokenConfigured, true);
    assert.equal((await request("/api/whatsapp/verify", {})).status, 200);
    assert.equal((await request("/api/whatsapp/subscribe", {})).status, 200);
    assert.equal((await request("/api/templates")).data.templates.length, 1);
    const verifyUrl = app.webhookUrl + `?hub.mode=subscribe&hub.verify_token=${publicSettings.verifyToken}&hub.challenge=verify123`;
    assert.equal(await (await fetch(verifyUrl)).text(), "verify123");
    assert.equal((await fetch(app.webhookUrl + "?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=a")).status, 403);
    assert.equal((await fetch(app.webhookUrl, { method: "POST", body: JSON.stringify(payload("bad")) })).status, 403);
    assert.equal((await fetch(app.webhookUrl, { method: "POST", headers: { "X-Hub-Signature-256": "sha256=" + "0".repeat(64) }, body: JSON.stringify(payload("forged")) })).status, 403);
    const wrongNumber = payload("other-account"); wrongNumber.entry[0].changes[0].value.metadata.phone_number_id = "000000000";
    await webhook(wrongNumber); await app.whatsapp.idle(); assert.equal(posts.length, 0);
    assert.equal((await webhook(payload("wamid.in-1"))).status, 200);
    await app.whatsapp.idle();
    assert.equal(posts.length, 1); assert.equal(posts[0].type, "text"); assert.equal(posts[0].to, "5511999990000");
    assert.equal(posts[0].text.body, "Atendemos das 10h às 17h."); assert.equal(modelCalls, 1);
    await webhook(payload("wamid.in-1")); await app.whatsapp.idle();
    assert.equal(posts.length, 1); assert.equal(modelCalls, 1);
    let conversation = (await request("/api/conversation?phone=5511999990000")).data;
    assert.equal(conversation.history.length, 2);
    assert.equal(conversation.outbound[0].state, "sent");
    await webhook(payload("unused", { messages: [], statuses: [{ id: "wamid.sent-1", recipient_id: "5511999990000", status: "read", timestamp: String(Math.floor(Date.now() / 1000)) }] }));
    await webhook(payload("unused", { messages: [], statuses: [{ id: "wamid.sent-1", recipient_id: "5511999990000", status: "sent", timestamp: String(Math.floor(Date.now() / 1000)) }] }));
    assert.equal((await request("/api/conversation?phone=5511999990000")).data.outbound[0].deliveryStatus, "read");
    const freeText = await request("/api/whatsapp/send", { phone: "5511988880000", text: "Olá", requestId: randomUUID() });
    assert.equal(freeText.status, 409); assert.match(freeText.data.error, /24 horas/);
    const template = { phone: "5511988880000", template: { name: "approved_template", language: { code: "pt_BR" }, components: [] }, requestId: randomUUID() };
    assert.equal((await request("/api/whatsapp/send", template)).status, 200); assert.equal(posts.length, 2);
    assert.equal((await request("/api/whatsapp/send", template)).status, 200); assert.equal(posts.length, 2);
    assert.equal((await request("/api/whatsapp/send", { ...template, template: { ...template.template, name: "another_template" } })).status, 409);
    timeOutNextSend = true;
    const uncertain = { ...template, requestId: randomUUID() };
    assert.equal((await request("/api/whatsapp/send", uncertain)).status, 504);
    assert.equal((await request("/api/whatsapp/send", uncertain)).status, 409);
    assert.equal(posts.length, 2);
    await app.whatsapp.close();
    const queued = { id: "wamid.resume", contactId: "5511999990000", channel: "whatsapp", text: "Qual o horário?", timestamp: Date.now(), accountId: config.phoneNumberId };
    await app.runtime.client.execute({ sql: "INSERT INTO wa_jobs(id,phone,message,state,created) VALUES(?,?,?,'pending',?)", args: [queued.id, queued.contactId, JSON.stringify(queued), Date.now()] });
    await app.runtime.client.execute({ sql: "UPDATE wa_outbox SET state='sending' WHERE id=?", args: [`manual:${uncertain.requestId}`] });
    await app.close();
    app = await startServer({ port: 0, dataDir, metaFetch, geminiFetch });
    await app.whatsapp.idle(); assert.equal(posts.length, 3);
    assert.equal((await request("/api/conversation?phone=5511999990000")).data.history.length, 4);
    assert.equal((await request("/api/whatsapp/send", uncertain)).status, 409);
    await webhook(payload("wamid.in-1")); await app.whatsapp.idle(); assert.equal(posts.length, 3);
    const scheduled = { enabled: true, days: [1,2,3,4,5,6,7], start: "08:00", end: "18:00", allDay: true, fromDate: "2000-01-01", untilDate: "2000-01-02" };
    assert.equal((await request("/api/settings", { replySchedule: scheduled })).status, 200);
    assert.equal((await request("/api/dashboard")).data.replyStatus.active, false);
    const callsBeforePause = modelCalls;
    await webhook(payload("wamid.scheduled-pause")); await app.whatsapp.idle();
    assert.equal(posts.length, 3); assert.equal(modelCalls, callsBeforePause);
    assert.equal((await app.whatsapp.status()).jobs.find(job => job.id === "wamid.scheduled-pause").state, "manual");
    await request("/api/settings", { phoneNumberId: "111222333" });
    assert.equal((await request("/api/conversation?phone=5511999990000")).data.history.length, 0);
    assert.equal((await request("/api/whatsapp/send", template)).status, 409);
  } catch (error) { console.error("Primary test failure:", error); throw error; }
  finally { await app.close(); await cleanup(dataDir); }
});
