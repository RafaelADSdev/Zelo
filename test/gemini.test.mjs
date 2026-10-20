import { test } from "node:test";
import assert from "node:assert/strict";
import { testDirectory, releaseDirectory } from "./helpers.mjs";
import { createGeminiModel } from "../gemini.mjs";
import { startTestServer as startServer, authenticatedFetch as fetch } from "./helpers.mjs";

test("Gemini usa cabeçalho secreto e mantém a resposta no fluxo Wappy", async () => {
  const dataDir = await testDirectory();
  const apiKey = "test-secret-never-in-state";
  let calls = 0;
  const app = await startServer({ port: 0, dataDir, ai: {
    apiKey,
    async fetchImpl(url, options) {
      calls++;
      assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
      assert.equal(options.headers["x-goog-api-key"], apiKey);
      assert.ok(!url.includes(apiKey) && !options.body.includes(apiKey));
      const request = JSON.parse(options.body);
      assert.match(request.contents.at(-1).parts[0].text, /diga oi/);
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        formatRationale: "Resposta curta.", message: { text: "Olá, sou Gemini." },
      }) }] } }] });
    },
  } });
  try {
    const initial = await fetch(app.url + "/api/state");
    const state = await initial.json();
    assert.equal(state.mode, "gemini");
    assert.ok(!JSON.stringify(state).includes(apiKey));
    const result = await fetch(app.url + "/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json", cookie: initial.headers.get("set-cookie").split(";")[0] },
      body: JSON.stringify({ text: "diga oi" }),
    });
    const data = await result.json();
    assert.equal(result.status, 200);
    assert.equal(data.reply.text, "Olá, sou Gemini.");
    assert.equal(data.history.at(-1).text, "Olá, sou Gemini.");
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(data).includes(apiKey));
  } finally {
    await app.close();
    await releaseDirectory(dataDir);
  }
});

test("limite do provedor retorna mensagem segura sem expor detalhes da resposta", async () => {
  const model = createGeminiModel({ apiKey: "test-secret", fetchImpl: async () => new Response("test-secret", { status: 429 }) });
  await assert.rejects(model.generate({ prompt: "oi" }), error => {
    assert.equal(error.status, 502);
    assert.match(error.message, /limite de uso/);
    assert.ok(!error.message.includes("test-secret"));
    return true;
  });
});
