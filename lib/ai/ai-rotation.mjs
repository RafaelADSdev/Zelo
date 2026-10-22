import { createAiModel } from "./ai.mjs";
import { fail } from "../core/settings.mjs";

export function createRotatingAi(settings, { fetchImpl, clock = Date.now } = {}) {
  let used = null;
  return {
    used: () => used,
    async generate(request) {
      const config = settings.get();
      if (!config.aiRotationEnabled && !config.aiListOnly) {
        const result = await createAiModel({ ...config, fetchImpl }).generate(request);
        used = { provider: config.aiProvider, model: result.modelUsed || config.model };
        return result;
      }
      const active = config.aiKeys.filter(key => key.enabled && key.apiKey && key.model);
      const keys = config.aiRotationEnabled ? active : active.slice(0, 1);
      if (!keys.length) throw fail("Adicione e ative uma chave na lista de prioridade de IA.", 409);
      const signal = AbortSignal.timeout(55000);
      let limited = 0;
      for (const candidate of keys) {
        const current = settings.get();
        if (current.aiRotationEnabled !== config.aiRotationEnabled) throw fail("O modo automático mudou durante a resposta. Envie a mensagem novamente.", 409);
        const live = current.aiKeys.find(key => key.id === candidate.id);
        if (!live?.enabled || live.apiKey !== candidate.apiKey || live.model !== candidate.model || live.provider !== candidate.provider) continue;
        if (Number(live.cooldownUntil) > clock()) { limited++; continue; }
        try {
          const result = await createAiModel({ ...config, aiProvider: live.provider, apiKey: live.apiKey, model: live.model, fetchImpl, signal }).generate(request);
          used = { id: live.id, label: live.label, provider: live.provider, model: result.modelUsed || live.model };
          await settings.markAiKey(live, { lastUsedAt: clock(), lastUsedModel: used.model, validatedAt: clock(), cooldownUntil: 0, lastError: "" });
          return result;
        } catch (error) {
          const unavailable = live.provider === "openrouter" && (error.providerStatus ? [404, 408, 500, 502, 503, 504].includes(error.providerStatus) : error.status === 502);
          if (!error.fallbackEligible && !unavailable) {
            await settings.markAiKey(live, { lastError: error.status ? error.message : "Falha ao consultar esta chave." });
            throw error;
          }
          limited++;
          await settings.markAiKey(live, { cooldownUntil: clock() + (error.retryAfterMs || (unavailable ? 60000 : 300000)), lastError: unavailable ? "Modelo indisponível ou resposta inválida. Tentando a próxima IA da lista." : "Limite de uso ou créditos atingido. Tentando a próxima chave da lista." });
          if (signal.aborted) break;
        }
      }
      throw fail(limited ? "Todas as chaves disponíveis atingiram o limite, estão indisponíveis ou em espera. Aguarde a liberação, adicione outra chave ou confira os créditos." : "A lista de chaves mudou durante a solicitação. Tente novamente.", 503);
    },
  };
}
