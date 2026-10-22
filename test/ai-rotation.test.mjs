import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer as startServer, authenticatedFetch as fetch } from "./helpers.mjs";
import { testDirectory, releaseDirectory } from "./helpers.mjs";
import { createSettings } from "../lib/core/settings.mjs";
import { createRotatingAi } from "../lib/ai/ai-rotation.mjs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("ordem de chaves: limite pula para próxima, persiste pausa, oculta segredos e respeita desativação", async () => {
  const dataDir = await testDirectory(); const calls = [];
  const app = await startServer({ port: 0, dataDir, aiFetch: async (_url, options) => {
    const key = options.headers.Authorization?.replace("Bearer ", ""); calls.push(key);
    if (key === "first-secret") return Response.json({ error: { message: "private remote error" } }, { status: 429, headers: { "Retry-After": "120" } });
    const answer = { formatRationale: "Resposta", message: { text: "Olá pela segunda chave" }, materialIds: [] };
    return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }] });
  } });
  const post = async (path, data) => { const r = await fetch(app.url + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); return { status: r.status, body: await r.json() }; };
  try {
    let result = await post("/api/ai/keys", { label: "Primeira", provider: "openai", model: "test-model", apiKey: "first-secret" });
    assert.equal(result.status, 201); const first = result.body.id;
    result = await post("/api/ai/keys", { label: "Segunda", provider: "openai", model: "test-model", apiKey: "second-secret" }); const second = result.body.id;
    assert.equal((await post("/api/ai/rotation", { enabled: true, order: [first, second] })).status, 200);
    result = await post("/api/chat", { text: "Olá" }); assert.equal(result.status, 200); assert.equal(result.body.reply.text, "Olá pela segunda chave"); assert.deepEqual(calls, ["first-secret", "second-secret"]);
    let dashboard = await (await fetch(app.url + "/api/dashboard")).json();
    assert.equal(dashboard.settings.aiLastUsed.id, second); assert.ok(dashboard.settings.aiKeys[0].cooldownUntil > Date.now());
    assert.ok(!JSON.stringify(dashboard).includes("first-secret") && !JSON.stringify(dashboard).includes("second-secret"));
    await post("/api/chat", { text: "Outra pergunta" }); assert.deepEqual(calls, ["first-secret", "second-secret", "second-secret"]);
    await post(`/api/ai/keys/${first}`, { label: "Primeira renomeada", provider: "openai", model: "test-model", apiKey: "", enabled: false });
    await post("/api/ai/rotation", { enabled: true, order: [second, first] });
    assert.equal(app.settings.get().aiKeys.find(key => key.id === first).apiKey, "first-secret");
    assert.equal((await post("/api/ai/rotation", { enabled: true, order: [second, second] })).status, 400);
    await post(`/api/ai/keys/${second}`, { label: "Segunda", provider: "openai", model: "test-model", apiKey: "", enabled: false });
    result = await post("/api/chat", { text: "Sem chave ativa" }); assert.equal(result.status, 409); assert.equal(calls.length, 3);
  } finally { await app.close(); await releaseDirectory(dataDir); }
});

test("troca entre provedores, cota Claude 400, liberação após prazo e persistência", async () => {
  const directory = await testDirectory(); const settings = await createSettings(directory); let now = Date.now(), allowFirst = false;
  await settings.update({ assistantName: "Assistente Global", instructions: "INSTRUCAO_GLOBAL: atenda com clareza e use a mesma orientação em qualquer provedor." });
  const first = await settings.saveAiKey({ label: "Google", provider: "gemini", apiKey: "secret-google", model: "gemini-2.5-flash" });
  const second = await settings.saveAiKey({ label: "Claude", provider: "anthropic", apiKey: "secret-claude", model: "test-model" });
  const third = await settings.saveAiKey({ label: "GPT", provider: "openai", apiKey: "secret-gpt", model: "test-model" });
  await settings.configureAiRotation({ enabled: true, order: [first.id, second.id, third.id] });
  const calls = [], answer = { formatRationale: "Resposta", message: { text: "OK" }, materialIds: [] };
  const model = createRotatingAi(settings, { clock: () => now, fetchImpl: async (url, options) => {
    assert.ok(options.body.includes("Assistente Global")); assert.ok(options.body.includes("INSTRUCAO_GLOBAL"));
    calls.push(url);
    if (url.includes("googleapis")) return allowFirst ? Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }) : Response.json({}, { status: 429, headers: { "Retry-After": "5" } });
    if (url.includes("anthropic")) return Response.json({ error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } }, { status: 400 });
    assert.equal(options.headers.Authorization, "Bearer secret-gpt"); return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }] });
  } });
  const request = { prompt: "Olá", responseSchema: { properties: { message: {} } } };
  assert.equal((await model.generate(request)).structured.message.text, "OK"); assert.equal(calls.length, 3); assert.equal(model.used().id, third.id);
  const reloaded = await createSettings(directory); assert.equal(reloaded.get().aiRotationEnabled, true); assert.equal(reloaded.get().aiKeys[0].id, first.id); assert.ok(reloaded.get().aiKeys[0].cooldownUntil > now);
  now += 6000; allowFirst = true; await model.generate(request); assert.equal(calls.length, 4); assert.equal(model.used().id, first.id);
  await releaseDirectory(directory);
});

test("erro de autenticação não dispara troca e todas as cotas esgotadas geram erro claro", async () => {
  const directory = await testDirectory(), settings = await createSettings(directory); let calls = 0, status = 401;
  await settings.saveAiKey({ label: "Uma", provider: "openai", apiKey: "secret-one", model: "test-model" });
  await settings.saveAiKey({ label: "Duas", provider: "openai", apiKey: "secret-two", model: "test-model" });
  await settings.configureAiRotation({ enabled: true });
  const model = createRotatingAi(settings, { fetchImpl: async () => { calls++; return Response.json({}, { status }); } });
  await assert.rejects(model.generate({ prompt: "Olá" }), /chave ou as permissões/); assert.equal(calls, 1);
  status = 429; await assert.rejects(model.generate({ prompt: "Olá" }), /Todas as chaves/); assert.equal(calls, 3);
  await assert.rejects(model.generate({ prompt: "Olá" }), /Todas as chaves/); assert.equal(calls, 3);
  await releaseDirectory(directory);
});

test("Groq usa schema estrito no GPT OSS e passa para reserva ao atingir cota", async () => {
  const directory = await testDirectory(), settings = await createSettings(directory), calls = [];
  await settings.saveAiKey({ label: "Groq", provider: "groq", apiKey: "secret-groq", model: "openai/gpt-oss-20b" });
  await settings.saveAiKey({ label: "Reserva", provider: "openai", apiKey: "secret-reserve", model: "test-model" });
  await settings.configureAiRotation({ enabled: true });
  const model = createRotatingAi(settings, { fetchImpl: async (url, options) => {
    calls.push(url);
    if (url.includes("api.groq.com")) {
      assert.equal(options.headers.Authorization, "Bearer secret-groq");
      const body = JSON.parse(options.body); assert.equal(body.response_format.type, "json_schema"); assert.equal(body.response_format.json_schema.strict, true);
      return Response.json({}, { status: 429, headers: { "Retry-After": "10" } });
    }
    return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ formatRationale: "Resposta", message: { text: "Reserva respondeu" } }) }] }] });
  } });
  const result = await model.generate({ prompt: "Olá", responseSchema: { properties: { message: {} } } });
  assert.equal(result.structured.message.text, "Reserva respondeu"); assert.equal(calls.length, 2); assert.equal(model.used().provider, "openai");
  await releaseDirectory(directory);
});

test("excluir chave exige revisão atual, remove o segredo e não reaparece após reiniciar", async () => {
  const dataDir = await testDirectory(); const app = await startServer({ port: 0, dataDir });
  try {
    const key = await app.settings.saveAiKey({ label: "Descartável", provider: "groq", apiKey: "test-secret-delete-only", model: "openai/gpt-oss-20b" });
    const snapshot = app.settings.get().aiKeys[0];
    await app.settings.markAiKey(snapshot, { lastUsedAt: Date.now() });
    const remove = revision => fetch(app.url + `/api/ai/keys/${key.id}/remove`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision }) });
    assert.equal((await remove(0)).status, 409); assert.equal(app.settings.public().aiKeys.length, 1);
    const response = await remove(app.settings.public().aiKeysRevision); assert.equal(response.status, 200);
    assert.equal(app.settings.public().aiKeys.length, 0); assert.equal(app.settings.public().aiLastUsed, undefined);
    await app.settings.markAiKey(snapshot, { lastUsedAt: Date.now() });
    assert.equal(app.settings.get().aiKeys.length, 0);
    assert.ok(!(await readFile(join(dataDir, "settings.json"), "utf8")).includes("test-secret-delete-only"));
    const restarted = await createSettings(dataDir); assert.equal(restarted.get().aiKeys.length, 0);
  } finally { await app.close(); await releaseDirectory(dataDir); }
});

test("sem troca automática usa a primeira chave da lista e não recorre à configuração antiga", async () => {
  const directory = await testDirectory(), settings = await createSettings(directory); const calls = [];
  await settings.update({ aiProvider: "openai", model: "legacy-model", apiKey: "secret-legacy" });
  const key = await settings.saveAiKey({ label: "Primeira", provider: "groq", apiKey: "secret-list", model: "openai/gpt-oss-20b" });
  await settings.saveAiKey({ label: "Reserva", provider: "groq", apiKey: "secret-second", model: "openai/gpt-oss-20b" });
  await settings.configureAiRotation({ enabled: false });
  const model = createRotatingAi(settings, { fetchImpl: async (_url, options) => { calls.push(options.headers.Authorization); return Response.json({}, { status: 429 }); } });
  await assert.rejects(model.generate({ prompt: "Olá" }), /chaves/); assert.deepEqual(calls, ["Bearer secret-list"]);
  const ids = settings.get().aiKeys.map(item => item.id);
  for (const id of ids) await settings.removeAiKey(id, settings.get().aiKeysRevision);
  await assert.rejects(model.generate({ prompt: "Olá" }), /Adicione e ative/); assert.equal(calls.length, 1);
  assert.ok(key.id); await releaseDirectory(directory);
});
