import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer as startServer, authenticatedFetch as fetch } from "./helpers.mjs";
import { testDirectory, releaseDirectory } from "./helpers.mjs";

for (const provider of ["openai", "anthropic", "xai", "openrouter", "deepseek", "groq"]) test(`IA ${provider}: rota real, segredo isolado e resposta no Wappy`, async () => {
  const dataDir = await testDirectory(); const key = `test-private-${provider}`; let calls = 0;
  const app = await startServer({ port: 0, dataDir, aiFetch: async (url, options) => {
    calls++; const body = JSON.parse(options.body);
    assert.equal(options.redirect, "error"); assert.ok(!url.includes(key) && !options.body.includes(key));
    const answer = { formatRationale: "Resposta", message: { text: `Olá via ${provider}.` }, materialIds: [], sessionFacts: {} };
    if (provider === "openai") { assert.equal(url, "https://api.openai.com/v1/responses"); assert.equal(options.headers.Authorization, `Bearer ${key}`); return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }] }); }
    if (provider === "anthropic") { assert.equal(url, "https://api.anthropic.com/v1/messages"); assert.equal(options.headers["x-api-key"], key); if (!body.tools) return Response.json({ content: [{ type: "text", text: "OK" }] }); assert.equal(body.tool_choice.name, "responder"); return Response.json({ content: [{ type: "tool_use", name: "responder", input: answer }] }); }
    const hosts = { xai: "https://api.x.ai/v1/chat/completions", openrouter: "https://openrouter.ai/api/v1/chat/completions", deepseek: "https://api.deepseek.com/chat/completions", groq: "https://api.groq.com/openai/v1/chat/completions" };
    assert.equal(url, hosts[provider]); assert.equal(options.headers.Authorization, `Bearer ${key}`); if (body.response_format) assert.equal(body.response_format.type, "json_object"); return Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }] });
  } });
  try {
    await app.settings.update({ aiProvider: provider, apiKey: key, model: "test-model" });
    const response = await fetch(app.url + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Oi" }) });
    const data = await response.json(); assert.equal(response.status, 200); assert.equal(data.reply.text, `Olá via ${provider}.`); assert.equal(calls, 1);
    const state = app.settings.public(); assert.ok(!JSON.stringify(state).includes(key)); assert.equal(state.aiProvider, provider);
    const verified = await fetch(app.url + "/api/ai/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(verified.status, 200); assert.ok(app.settings.public().aiValidatedAt > 0);
    await app.settings.update({ aiProvider: "gemini" }); assert.equal(app.settings.get().apiKey, "");
    await app.settings.update({ aiProvider: provider }); assert.equal(app.settings.get().apiKey, key);
    assert.ok(app.settings.public().aiValidatedAt > 0);
    await assert.rejects(app.settings.update({ aiProvider: "__proto__" }), /inválido/);
  } finally { await app.close(); await releaseDirectory(dataDir); }
});

test("erro de um provedor não expõe a chave nem tenta outra IA", async () => {
  const dataDir = await testDirectory(); let calls = 0;
  const app = await startServer({ port: 0, dataDir, aiFetch: async () => { calls++; return Response.json({ error: { message: "test-secret-private" } }, { status: 401 }); } });
  try {
    await app.settings.update({ aiProvider: "openai", apiKey: "test-secret-private", model: "test-model" });
    const result = await fetch(app.url + "/api/ai/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const text = await result.text(); assert.equal(result.status, 502); assert.equal(calls, 1); assert.ok(!text.includes("test-secret-private")); assert.match(text, /chave ou as permissões/);
  } finally { await app.close(); await releaseDirectory(dataDir); }
});
