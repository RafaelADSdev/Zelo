import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { defaultSchedule, validateSchedule } from "./reply-schedule.mjs";
import { AI_PROVIDERS } from "./ai-providers.mjs";

export function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }

export async function createSettings(dataDir, seed = {}) {
  await mkdir(dataDir, { recursive: true });
  const path = join(dataDir, "settings.json");
  let value = {
    apiKey: seed.apiKey || "", model: seed.model || "gemini-2.5-flash",
    assistantName: "Assistente", instructions: "Atenda em português, seja claro e ajude com base nas informações cadastradas. Quando não houver informação do negócio, diga que não sabe.",
    accessToken: "", appSecret: "", phoneNumberId: "", businessAccountId: "", graphVersion: "v23.0",
    verifyToken: randomBytes(24).toString("hex"), publicUrl: "", autoReply: true, whatsappMode: "cloud",
  };
  try { value = { ...value, ...JSON.parse(await readFile(path, "utf8")) }; }
  catch (error) { if (error.code !== "ENOENT") throw fail("Não foi possível ler a configuração local.", 500); }
  value.replySchedule = validateSchedule(value.replySchedule || defaultSchedule());
  value.aiProvider ||= "gemini";
  if (!Object.hasOwn(AI_PROVIDERS, value.aiProvider)) throw fail("Provedor de IA local inválido.", 500);
  value.aiProfiles ||= { gemini: { apiKey: value.apiKey, model: value.model, validatedAt: value.geminiValidatedAt || 0 } };
  for (const id of Object.keys(AI_PROVIDERS)) value.aiProfiles[id] ||= { apiKey: "", model: id === "gemini" ? "gemini-2.5-flash" : "" };
  value.apiKey = value.aiProfiles[value.aiProvider].apiKey;
  value.model = value.aiProfiles[value.aiProvider].model;
  value.aiRotationEnabled ??= false;
  value.aiListOnly ??= value.aiRotationEnabled;
  value.aiKeysRevision ||= 1;
  value.aiKeys ||= Object.entries(value.aiProfiles).filter(([, profile]) => profile.apiKey && profile.model).sort(([a], [b]) => Number(b === value.aiProvider) - Number(a === value.aiProvider)).map(([provider, profile]) => ({ id: randomUUID(), label: AI_PROVIDERS[provider].name, provider, model: profile.model, apiKey: profile.apiKey, enabled: true, cooldownUntil: 0, validatedAt: profile.validatedAt || 0 }));
  async function persist(next) {
    await writeFile(path + ".tmp", JSON.stringify(next, null, 2), { mode: 0o600 });
    await rename(path + ".tmp", path);
    value = next;
  }
  await persist(value);
  let writes = Promise.resolve();
  function change(operation) {
    const result = writes.then(operation);
    writes = result.catch(() => {});
    return result;
  }
  const secrets = ["apiKey", "accessToken", "appSecret"];
  return {
    get: () => structuredClone(value),
    public() {
      const result = { ...value };
      result.aiProfiles = Object.fromEntries(Object.entries(value.aiProfiles).map(([id, profile]) => [id, { model: profile.model, apiKeyConfigured: Boolean(profile.apiKey), validatedAt: profile.validatedAt || 0 }]));
      result.aiValidatedAt = value.aiProfiles[value.aiProvider].validatedAt || 0;
      result.aiKeys = value.aiKeys.map(({ apiKey, ...item }) => ({ ...item, apiKeyConfigured: Boolean(apiKey) }));
      result.aiReadyConfigured = value.aiListOnly || value.aiRotationEnabled ? value.aiKeys.some(key => key.enabled && key.apiKey && key.model) : Boolean(value.apiKey && value.model);
      for (const field of secrets) { result[field + "Configured"] = Boolean(value[field]); delete result[field]; }
      result.whatsappConfigured = Boolean(value.accessToken && value.appSecret && value.phoneNumberId);
      return result;
    },
    async update(input) {
      return change(async () => {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("Configuração inválida.");
      const limits = { apiKey: 512, model: 100, assistantName: 80, instructions: 6000, accessToken: 4096, appSecret: 512, phoneNumberId: 30, businessAccountId: 30, graphVersion: 12, verifyToken: 128, publicUrl: 300 };
      const next = structuredClone(value);
      if ("aiProvider" in input) {
        if (typeof input.aiProvider !== "string" || !Object.hasOwn(AI_PROVIDERS, input.aiProvider)) throw fail("Provedor de IA inválido.");
        next.aiProvider = input.aiProvider;
        next.apiKey = next.aiProfiles[next.aiProvider].apiKey;
        next.model = next.aiProfiles[next.aiProvider].model;
      }
      if ("whatsappMode" in input) {
        if (!["cloud", "qr"].includes(input.whatsappMode)) throw fail("Modo de conexão inválido.");
        next.whatsappMode = input.whatsappMode;
      }
      for (const [key, limit] of Object.entries(limits)) {
        if (!(key in input)) continue;
        if (typeof input[key] !== "string" || input[key].length > limit || /[\r\n]/.test(input[key]) && key !== "instructions") throw fail(`Campo inválido: ${key}.`);
        const text = input[key].trim();
        if (secrets.includes(key) && !text) continue;
        next[key] = text;
      }
      if ("replySchedule" in input) next.replySchedule = validateSchedule(input.replySchedule);
      if ("autoReply" in input) { if (typeof input.autoReply !== "boolean") throw fail("Resposta automática inválida."); next.autoReply = input.autoReply; }
      for (const key of ["phoneNumberId", "businessAccountId"]) if (next[key] && !/^\d{5,30}$/.test(next[key])) throw fail(`${key} deve conter somente o ID numérico da Meta.`);
      if (next.model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,149}$/.test(next.model) || !/^v\d{2}\.0$/.test(next.graphVersion)) throw fail("Modelo ou versão da API inválidos.");
      if (next.apiKey && !next.model) throw fail("Informe o ID do modelo para a chave cadastrada.");
      if (next.aiProvider === "gemini" && next.model && !/^[\w.-]+$/.test(next.model)) throw fail("Informe apenas o ID do modelo Gemini, sem URL ou prefixo.");
      if (/[\x00-\x20\x7f]/.test(next.apiKey)) throw fail("A chave de API não pode conter espaços ou quebras de linha.");
      if (!next.assistantName || !next.instructions || !/^[a-zA-Z0-9_-]{16,128}$/.test(next.verifyToken)) throw fail("Informe nome, instruções e um token de verificação com pelo menos 16 caracteres.");
      if (next.publicUrl) {
        let url; try { url = new URL(next.publicUrl); } catch { throw fail("Informe uma URL HTTPS válida para o webhook."); }
        if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw fail("A URL pública deve usar HTTPS e não conter credenciais ou parâmetros.");
        next.publicUrl = url.origin + url.pathname.replace(/\/$/, "").replace(/\/webhook$/, "");
      }
      if (["accessToken", "phoneNumberId", "appSecret", "graphVersion", "businessAccountId"].some(key => next[key] !== value[key])) { delete next.phone; delete next.validatedAt; delete next.subscribedAt; }
      if (["phoneNumberId", "appSecret", "businessAccountId"].some(key => next[key] !== value[key])) { delete next.lastWebhookAt; delete next.webhookVerifiedAt; }
      if (next.verifyToken !== value.verifyToken || next.publicUrl !== value.publicUrl) delete next.webhookVerifiedAt;
      if (next.apiKey !== value.apiKey || next.model !== value.model) delete next.geminiValidatedAt;
      const profile = next.aiProfiles[next.aiProvider];
      if (profile.apiKey !== next.apiKey || profile.model !== next.model) delete profile.validatedAt;
      profile.apiKey = next.apiKey; profile.model = next.model;
      await persist(next);
      return this.public();
      });
    },
    async mark(fields) { await change(() => persist({ ...value, ...fields })); },
    async markAiValidated(config) {
      await change(async () => {
        const next = structuredClone(value), profile = next.aiProfiles[config.aiProvider];
        if (profile?.apiKey === config.apiKey && profile?.model === config.model) { profile.validatedAt = Date.now(); await persist(next); }
      });
    },
    async saveAiKey(input, id) {
      return change(async () => {
        if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("Chave inválida.");
        const next = structuredClone(value), before = id ? next.aiKeys.find(item => item.id === id) : null;
        if (id && !before) throw fail("Chave não encontrada.", 404);
        if (input.revision !== undefined && input.revision !== next.aiKeysRevision) throw fail("A lista mudou. Atualize antes de salvar.", 409);
        if (!before && next.aiKeys.length >= 20) throw fail("Cadastre até 20 chaves na lista.", 409);
        const imported = input.importCurrent === true ? { provider: next.aiProvider, ...next.aiProfiles[next.aiProvider] } : null;
        const provider = imported?.provider || input.provider;
        if (typeof provider !== "string" || !Object.hasOwn(AI_PROVIDERS, provider)) throw fail("Provedor de IA inválido.");
        const model = imported?.model || input.model;
        if (typeof model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,99}$/.test(model) || provider === "gemini" && !/^[\w.-]+$/.test(model)) throw fail("Informe um ID de modelo válido.");
        const label = input.label ?? AI_PROVIDERS[provider].name;
        if (typeof label !== "string" || !label.trim() || label.length > 80 || /[\x00-\x1f]/.test(label)) throw fail("Dê um nome à chave, com até 80 caracteres.");
        if (input.apiKey !== undefined && typeof input.apiKey !== "string") throw fail("Chave inválida.");
        const apiKey = imported?.apiKey || input.apiKey?.trim() || (before?.provider === provider ? before.apiKey : "");
        if (!apiKey || apiKey.length > 512 || /[\x00-\x20\x7f]/.test(apiKey)) throw fail("Informe uma chave de API válida para este provedor.");
        if (next.aiKeys.some(item => item.id !== id && item.provider === provider && item.apiKey === apiKey)) throw fail("Esta chave já está na lista deste provedor. Edite o cadastro existente.", 409);
        if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw fail("Situação da chave inválida.");
        const item = { ...before, id: id || randomUUID(), label: label.trim(), provider, model, apiKey, enabled: input.enabled ?? before?.enabled ?? true };
        if (!before || before.apiKey !== apiKey || before.model !== model || before.provider !== provider) { item.cooldownUntil = 0; item.validatedAt = 0; item.lastError = ""; }
        if (before) next.aiKeys[next.aiKeys.findIndex(entry => entry.id === id)] = item; else next.aiKeys.push(item);
        next.aiListOnly = true;
        next.aiKeysRevision++; await persist(next);
        const { apiKey: _secret, ...safe } = item; return { ...safe, apiKeyConfigured: true };
      });
    },
    async removeAiKey(id, revision) {
      return change(async () => {
        const next = structuredClone(value);
        if (revision !== next.aiKeysRevision) throw fail("A lista mudou. Atualize antes de excluir a chave.", 409);
        if (!next.aiKeys.some(key => key.id === id)) throw fail("Chave não encontrada.", 404);
        next.aiKeys = next.aiKeys.filter(key => key.id !== id);
        if (next.aiLastUsed?.id === id) delete next.aiLastUsed;
        next.aiKeysRevision++; await persist(next);
        return { deleted: true, id };
      });
    },
    async configureAiRotation(input) {
      return change(async () => {
        const next = structuredClone(value);
        if (!input || typeof input.enabled !== "boolean") throw fail("Informe se a troca automática está ativada.");
        if (input.revision !== undefined && input.revision !== next.aiKeysRevision) throw fail("A lista mudou. Atualize antes de ordenar.", 409);
        if (input.order !== undefined) {
          if (!Array.isArray(input.order) || input.order.length !== next.aiKeys.length || new Set(input.order).size !== input.order.length || input.order.some(id => !next.aiKeys.some(item => item.id === id))) throw fail("A ordem deve conter cada chave exatamente uma vez.");
          next.aiKeys = input.order.map(id => next.aiKeys.find(item => item.id === id));
        }
        next.aiListOnly = true; next.aiRotationEnabled = input.enabled; next.aiKeysRevision++; await persist(next); return this.public();
      });
    },
    async markAiKey(candidate, fields) {
      await change(async () => {
        const next = structuredClone(value), key = next.aiKeys.find(item => item.id === candidate.id);
        if (!key || key.apiKey !== candidate.apiKey || key.model !== candidate.model || key.provider !== candidate.provider) return;
        Object.assign(key, fields);
        if (fields.lastUsedAt) next.aiLastUsed = { id: key.id, label: key.label, provider: key.provider, model: key.model, at: fields.lastUsedAt };
        await persist(next);
      });
    },
  };
}
