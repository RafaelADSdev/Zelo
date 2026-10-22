import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSettings } from "../lib/core/settings.mjs";
import { createTranscriber } from "../lib/audio/audio.mjs";
import { startTestServer, authenticatedFetch, testDirectory, releaseDirectory } from "./helpers.mjs";

test("listas de IA: migração única, segredos ocultos e alterações independentes", async () => {
  const directory = await testDirectory();
  try {
    await writeFile(join(directory, "settings.json"), JSON.stringify({ aiProvider: "gemini", apiKey: "legacy-private", model: "gemini-2.5-flash", aiRotationEnabled: true, aiKeys: [{ id: "legacy", label: "Gemini", provider: "gemini", model: "gemini-2.5-flash", apiKey: "legacy-private", enabled: true }] }));
    let settings = await createSettings(directory);
    assert.equal(settings.get().audioAiKeys.length, 1);
    assert.equal(settings.get().audioAiKeys[0].apiKey, "legacy-private");
    const originalText = structuredClone(settings.get().aiKeys);
    const added = await settings.saveAiKey({ provider: "groq", model: "whisper-large-v3-turbo", label: "Áudio rápido", apiKey: "audio-private" }, undefined, "audio");
    await settings.configureAiRotation({ enabled: false, order: [added.id, settings.get().audioAiKeys[0].id] }, "audio");
    assert.deepEqual(settings.get().aiKeys, originalText);
    assert.equal(settings.get().aiRotationEnabled, true);
    assert.equal(settings.get().audioAiRotationEnabled, false);
    assert.ok(!JSON.stringify(settings.public()).includes("audio-private"));
    assert.ok(!JSON.stringify(settings.public()).includes("legacy-private"));
    await assert.rejects(settings.saveAiKey({ provider: "anthropic", model: "claude-test", label: "Claude", apiKey: "test" }, undefined, "audio"), /áudio/);
    for (const key of [...settings.get().audioAiKeys]) await settings.removeAiKey(key.id, settings.get().audioAiKeysRevision, "audio");
    settings = await createSettings(directory);
    assert.equal(settings.get().audioAiKeys.length, 0, "Lista removida não pode ser recriada a partir de textos");
    assert.deepEqual(settings.get().aiKeys, originalText);
  } finally { await releaseDirectory(directory); }
});

test("transcrição usa somente a lista de áudios e seu modelo e reserva próprios", async () => {
  const calls = [];
  const root = { aiListOnly: true, aiRotationEnabled: false, aiKeys: [{ id: "text", provider: "anthropic", apiKey: "text-private", enabled: true }], audioAiRotationEnabled: true, audioAiKeys: [{ id: "a", provider: "groq", model: "whisper-large-v3", apiKey: "audio-one", enabled: true }, { id: "b", provider: "openai", model: "gpt-transcribe", apiKey: "audio-two", enabled: true }] };
  const transcribe = createTranscriber({ get: () => structuredClone(root) }, { fetchImpl: async (_url, options) => {
    calls.push(options.headers.Authorization); assert.ok(!String(options.headers.Authorization).includes("text-private"));
    assert.equal(options.body.get("model"), calls.length === 1 ? "whisper-large-v3" : "gpt-transcribe");
    return calls.length === 1 ? new Response("", { status: 429 }) : Response.json({ text: "Olá." });
  } });
  assert.equal((await transcribe({ bytes: Buffer.from("test"), mimeType: "audio/ogg" })).text, "Olá.");
  assert.deepEqual(calls, ["Bearer audio-one", "Bearer audio-two"]);
  await assert.rejects(createTranscriber({ get: () => ({ ...root, audioAiKeys: [] }) })({ bytes: Buffer.from("test"), mimeType: "audio/ogg" }), /áudio/i);
});

test("API de listas separadas valida áudio pela transcrição, sem usar o modelo de conversa", async () => {
  const dataDir = await testDirectory(); let validations = 0;
  const app = await startTestServer({ port: 0, dataDir, aiFetch: async (url, options) => {
    assert.equal(url, "https://api.groq.com/openai/v1/audio/transcriptions");
    assert.equal(options.body.get("model"), "whisper-large-v3-turbo"); validations++;
    return Response.json({ text: "" });
  } });
  const post = async (path, value) => { const r = await authenticatedFetch(app.url + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }); return { status: r.status, body: await r.json() }; };
  try {
    const added = await post("/api/ai/keys?scope=audio", { provider: "groq", model: "whisper-large-v3-turbo", label: "Áudio", apiKey: "audio-secret" });
    assert.equal(added.status, 201);
    assert.equal(app.settings.get().aiKeys.length, 0);
    assert.equal((await post(`/api/ai/keys/${added.body.id}/verify?scope=audio`, {})).status, 200); assert.equal(validations, 1);
    assert.equal((await post(`/api/ai/keys/${added.body.id}/remove?scope=text`, { revision: app.settings.get().aiKeysRevision })).status, 404);
    assert.equal((await post("/api/ai/keys?scope=invalid", {})).status, 400);
  } finally { await app.close(); await releaseDirectory(dataDir); }
});
