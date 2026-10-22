import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { createInMemoryTracer, systemClock } from "@wappy_ai/core";
import { createAgent, createLibsqlMemory, createLibsqlSessionProfileStore, createKnowledge } from "@wappy_ai/harness";
import { createRotatingAi } from "./ai-rotation.mjs";
import { createTranscriber } from "./audio.mjs";
import { normalize, searchQuery } from "./search.mjs";
import { fail } from "./settings.mjs";
import { createCatalog } from "./catalog.mjs";
import { createSupabaseCatalog } from "./supabase-catalog.mjs";
import { createStateBackup } from "./supabase-state.mjs";

export async function createRuntime(dataDir, settings, { fetchImpl, cloud, backupKey, ownerId, snapshotId } = {}) {
  await mkdir(dataDir, { recursive: true });
  const client = createClient({ url: pathToFileURL(join(dataDir, "wappy.db")).href });
  const memory = createLibsqlMemory({ client });
  const localCatalog = await createCatalog(client);
  const catalog = cloud ? createSupabaseCatalog(cloud, ownerId) : localCatalog;
  const profiles = createLibsqlSessionProfileStore({ client });
  const knowledge = createKnowledge({ client });
  const knowledgeFile = join(dataDir, "base.txt");
  let document = "";
  try { document = await readFile(knowledgeFile, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  let paragraphs = [];
  async function indexDocument(value) {
    await knowledge.ingest("init", "");
    await client.execute("DELETE FROM knowledge_chunks");
    paragraphs = value.split(/\n\s*\n/).map(text => text.trim()).filter(Boolean);
    for (const [index, paragraph] of paragraphs.entries()) await knowledge.ingest(`base-${index}`, normalize(paragraph));
    document = value;
  }
  await indexDocument(document);
  const backup = cloud ? createStateBackup({ client, dataDir, cloud, key: backupKey, snapshotId }) : null;
  backup?.run().catch(() => {});
  async function state(contactId) {
    const config = settings.get();
    return { history: await memory.load(contactId), facts: (await profiles.get(contactId, Date.now()))?.facts || {}, knowledge: document, mode: config.apiKey ? config.aiProvider : "unconfigured", model: config.model, assistantName: config.assistantName };
  }
  const chains = new Map();
  const transcribe = createTranscriber(settings, { fetchImpl });
  async function respond(message, send, channelName) {
    const config = settings.get();
    const listMode = config.aiListOnly || config.aiRotationEnabled;
    if (!listMode && !config.apiKey) throw fail("Configure a chave de IA em Conexões para gerar respostas.", 409);
    if (listMode && !config.aiKeys.some(key => key.enabled && key.apiKey)) throw fail("Adicione e ative uma chave na lista de prioridade de IA.", 409);
    const model = createRotatingAi(settings, { fetchImpl });
    const recent = await memory.load(message.contactId);
    const query = `${message.text || ""} ${recent.filter(turn => turn.role === "user").slice(-2).map(turn => turn.text).join(" ")}`;
    const selected = await catalog.search(query);
    const allowedMaterials = new Map(selected.products.flatMap(product => product.files.map(file => [file.id, file])));
    let materialIds = [];
    const tracer = createInMemoryTracer();
    const started = performance.now();
    let reply, providerError, sources = 0, deliveryError;
    const agent = createAgent({
      memory, sessionProfileStore: profiles, clock: systemClock, tracer, maxRecentTurns: 20,
      channel: {
        name: channelName, receive: () => [],
        async send(to, outgoing) {
          if (providerError) return { status: "failed", reason: "A IA não respondeu." };
          const requested = /foto|image|imagen|pdf|book|catalog|catálog|arquivo|material|planta|anexo|manda|envia|mostr|ver\b/i.test(message.text || "");
          outgoing.materials = requested ? [...new Set(materialIds)].map(id => allowedMaterials.get(id)).filter(Boolean).slice(0, 3) : [];
          const delivered = await send(to, outgoing);
          if (delivered.text) outgoing.text = delivered.text;
          reply = outgoing;
          if (delivered.status !== "sent") deliveryError = delivered.reason || "Envio não confirmado.";
          return delivered;
        },
      },
      router: { route: async () => ({ intent: "conversa", needsRAG: true, needsTool: false, confidence: 1, escalate: false }) },
      model: { async generate(request) {
        if (providerError) throw providerError;
        try {
          const result = await model.generate(request);
          if (result.structured?.message) materialIds = result.structured.materialIds || [];
          return result;
        } catch (error) { providerError = error; throw error; }
      } },
      async retrieveRag() {
        const found = await knowledge.recall(searchQuery(message.text || ""), { topK: 3 });
        const snippets = [...new Set(found.map(item => paragraphs[Number(item.sourceId.replace("base-", ""))]))].filter(Boolean);
        const productSnippets = selected.products.map(product => catalog.reference(product));
        sources = snippets.length + productSnippets.length;
        return [...snippets, ...productSnippets, ...(selected.summary ? [`Produtos ativos no catálogo: ${selected.summary}. Se o pedido for ambíguo, pergunte qual produto o cliente quer.`] : [])];
      },
    });
    const result = await agent.handle(message);
    if (providerError) throw providerError;
    if (deliveryError || result.status !== "sent") throw fail(deliveryError || "Não foi possível concluir a resposta.", 502);
    return { reply, activity: { elapsedMs: Math.round(performance.now() - started), sources, ai: model.used(), steps: [...tracer.touched()] } };
  }
  function serialized(message, send, channel) {
    const previous = chains.get(message.contactId) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => respond(message, send, channel));
    chains.set(message.contactId, next);
    next.finally(() => { if (chains.get(message.contactId) === next) chains.delete(message.contactId); }).catch(() => {});
    return next;
  }
  return {
    client, memory, state, catalog, transcribe, async flushBackup() { if (backup) { await backup.run(); await backup.run(); } },
    async saveKnowledge(value) {
      await writeFile(knowledgeFile + ".tmp", value, "utf8");
      await rename(knowledgeFile + ".tmp", knowledgeFile);
      await indexDocument(value);
    },
    async chat(contactId, text) {
      const result = await serialized({ id: randomUUID(), contactId, channel: "browser", text, timestamp: Date.now() }, async () => ({ status: "sent" }), "browser");
      return { ...await state(contactId), ...result };
    },
    whatsapp(message, send) { return serialized(message, send, "whatsapp"); },
    async close() { await Promise.allSettled([...chains.values()]); await backup?.run().catch(() => {}); await backup?.close(); client.close(); },
  };
}
