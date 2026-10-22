import { test } from "node:test";
import assert from "node:assert/strict";
import { createAiModel } from "../ai.mjs";
import { createRotatingAi } from "../ai-rotation.mjs";
import { createSettings } from "../settings.mjs";
import { testDirectory, releaseDirectory, startTestServer, authenticatedFetch } from "./helpers.mjs";

const primary = "nvidia/nemotron-3-ultra-550b-a55b:free";
const fallback = "google/gemma-4-31b-it:free";
const request = { prompt: "Olá, teste fictício.", responseSchema: { properties: { message: {} } } };
const answer = { formatRationale: "Resposta", message: { text: "Olá! Como posso ajudar?" }, sessionFacts: { nome: null }, materialIds: [] };
const completion = (args = JSON.stringify(answer), model = primary) => ({ model, choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ type: "function", function: { name: "responder", arguments: args } }] } }] });

test("OpenRouter individual envia somente o modelo escolhido e compõe a resposta por função", async () => {
  const model = createAiModel({ aiProvider: "openrouter", apiKey: "test-private-openrouter", model: primary, fetchImpl: async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer test-private-openrouter");
    assert.ok(!options.body.includes("test-private-openrouter"));
    const body = JSON.parse(options.body);
    assert.equal(body.models, undefined);
    assert.equal(body.model, primary);
    assert.equal(body.response_format, undefined);
    assert.equal(body.provider.require_parameters, true);
    assert.equal(body.tool_choice.function.name, "responder");
    assert.ok(body.tools[0].function.parameters.properties.materialIds);
    return Response.json(completion());
  } });
  const result = await model.generate(request);
  assert.equal(result.structured.message.text, answer.message.text);
  assert.equal(result.modelUsed, primary);
});

test("OpenRouter gratuito rejeita função incorreta, argumentos inválidos e respostas truncadas", async () => {
  const wrongFunction = completion(); wrongFunction.choices[0].message.tool_calls[0].function.name = "executar";
  const truncated = completion(); truncated.choices[0].finish_reason = "length";
  const invalidCalls = completion(); invalidCalls.choices[0].message.tool_calls = {};
  for (const response of [completion("não é JSON"), wrongFunction, truncated, invalidCalls, null]) {
    const model = createAiModel({ aiProvider: "openrouter", apiKey: "test-secret", model: primary, fetchImpl: async () => Response.json(response) });
    await assert.rejects(model.generate(request), error => error.status === 502 && !error.message.includes("test-secret"));
  }
});

test("OpenRouter individual passa pela rota de atendimento e valida sem expor segredos", async () => {
  const directory = await testDirectory();
  const app = await startTestServer({ port: 0, dataDir: directory, aiFetch: async () => Response.json(completion()) });
  const post = (path, data) => authenticatedFetch(app.url + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  try {
    const saved = await post("/api/ai/keys", { label: "OpenRouter teste", provider: "openrouter", model: primary, apiKey: "test-private-openrouter" });
    assert.equal(saved.status, 201);
    const key = await saved.json();
    const verified = await post(`/api/ai/keys/${key.id}/verify`, {});
    assert.equal(verified.status, 200);
    const response = await post("/api/chat", { text: "Olá, teste fictício." });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reply.text, answer.message.text);
    const dashboard = await (await authenticatedFetch(app.url + "/api/dashboard")).json();
    assert.equal(dashboard.settings.aiLastUsed.model, primary);
    assert.ok(dashboard.settings.aiKeys[0].validatedAt > 0);
    assert.ok(!JSON.stringify(dashboard).includes("test-private-openrouter"));
  } finally { await app.close(); await releaseDirectory(directory); }
});

test("OpenRouter individual aceita todos os modelos de conversa salvos sem reservas ocultas", async () => {
  for (const selected of [primary, fallback, "nvidia/nemotron-3.5-super-vl:free", "google/gemma-4-26b-a4b-it:free", "google/gemma-4-31b-it"]) {
  const direct = createAiModel({ aiProvider: "openrouter", apiKey: "test-secret", model: selected, fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.model, selected); assert.equal(body.models, undefined);
    assert.equal(body.response_format, undefined); assert.ok(body.tools);
    return Response.json(completion(JSON.stringify(answer), selected));
  } });
  assert.equal((await direct.generate(request)).structured.message.text, answer.message.text);
  }
  const directory = await testDirectory();
  try {
    const settings = await createSettings(directory);
    await settings.saveAiKey({ label: "OpenRouter grátis", provider: "openrouter", model: primary, apiKey: "test-secret" });
    const rotating = createRotatingAi(settings, { fetchImpl: async () => Response.json(completion()) });
    await rotating.generate(request);
    assert.equal(rotating.used().model, primary);
    assert.ok(!JSON.stringify(settings.public()).includes("test-secret"));
  } finally { await releaseDirectory(directory); }
});

test("OpenRouter individual segue a ordem do Zelo ao receber limite ou indisponibilidade", async () => {
  for (const status of [429, 503, 404]) {
    const directory = await testDirectory();
    try {
      const settings = await createSettings(directory), calls = [];
      await settings.saveAiKey({ label: "Maior", provider: "openrouter", model: primary, apiKey: "same-test-secret" });
      await settings.saveAiKey({ label: "Menor", provider: "openrouter", model: fallback, apiKey: "same-test-secret" });
      await settings.configureAiRotation({ enabled: true });
      const rotating = createRotatingAi(settings, { fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body); calls.push(body.model);
        assert.equal(body.models, undefined);
        return body.model === primary ? Response.json({}, { status }) : Response.json(completion(JSON.stringify(answer), fallback));
      } });
      assert.equal((await rotating.generate(request)).structured.message.text, answer.message.text);
      assert.deepEqual(calls, [primary, fallback]);
      assert.equal(rotating.used().model, fallback);
      assert.ok(settings.public().aiKeys[0].lastError);
    } finally { await releaseDirectory(directory); }
  }
});
