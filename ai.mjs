import { createGeminiModel, buildInstruction } from "./gemini.mjs";
import { AI_PROVIDERS } from "./ai-providers.mjs";
import { fail } from "./settings.mjs";
import { tagProviderError } from "./ai-errors.mjs";

const schema = {
  type: "object", additionalProperties: false,
  properties: {
    formatRationale: { type: "string" },
    message: { type: "object", additionalProperties: false, properties: { text: { type: "string" } }, required: ["text"] },
    sessionFacts: { type: "object", additionalProperties: false, properties: { nome: { type: ["string", "null"] } }, required: ["nome"] },
    materialIds: { type: "array", items: { type: "string" } },
  }, required: ["formatRationale", "message", "sessionFacts", "materialIds"],
};
function parse(text, name) {
  try {
    const data = typeof text === "string" ? JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")) : text;
    if (!data || typeof data.message?.text !== "string" || !data.message.text.trim() || typeof data.formatRationale !== "string") throw new Error();
    return { structured: { formatRationale: data.formatRationale.slice(0, 300) || "Resposta em texto.", message: { text: data.message.text.slice(0, 4000) },
      sessionFacts: typeof data.sessionFacts?.nome === "string" ? { nome: data.sessionFacts.nome.slice(0, 120) } : {},
      materialIds: Array.isArray(data.materialIds) ? data.materialIds.filter(id => typeof id === "string").slice(0, 3) : [],
    } };
  } catch { throw fail(`${name} retornou uma resposta incompleta ou fora do formato esperado. Tente novamente.`, 502); }
}
function providerError(name, status) {
  if ([401, 403].includes(status)) return `${name} recusou a chave ou as permissões. Confira sua API e o acesso ao modelo.`;
  if (status === 429 || status === 402) return `${name} atingiu o limite de uso ou está sem créditos. Confira a cota e a cobrança da API.`;
  if (status === 404) return `O modelo informado não está disponível na API de ${name}. Confira o ID do modelo.`;
  if (status === 400 || status === 422) return `${name} recusou a configuração. Confira o modelo e se ele aceita respostas estruturadas.`;
  return `${name} está indisponível no momento. Tente novamente mais tarde.`;
}
export function createAiModel(config) {
  const provider = config.aiProvider || "gemini";
  if (!Object.hasOwn(AI_PROVIDERS, provider)) throw fail("Provedor de IA inválido.");
  if (!config.apiKey || !config.model) throw fail("Configure a chave e o modelo de IA em Conexões.", 409);
  if (provider === "gemini") return createGeminiModel(config);
  const info = AI_PROVIDERS[provider], fetchImpl = config.fetchImpl || fetch;
  return {
    async generate(request) {
      const compose = Boolean(request.responseSchema?.properties?.message);
      const system = buildInstruction(config, request) + (compose ? `\nResponda somente com um objeto JSON de acordo com este schema: ${JSON.stringify(schema)}. Use nome null quando não houver nome informado e materialIds vazio quando não houver anexos solicitados.` : "");
      const messages = [...(request.history || []).filter(turn => turn.text).map(turn => ({ role: turn.role === "agent" ? "assistant" : "user", content: turn.text })), { role: "user", content: request.prompt }];
      let body, headers = { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` };
      if (provider === "openai") body = { model: config.model, instructions: system, input: messages, store: false, max_output_tokens: 4096,
        ...(compose ? { text: { format: { type: "json_schema", name: "resposta_atendimento", strict: true, schema } } } : {}),
      };
      else if (provider === "anthropic") {
        headers = { "Content-Type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" };
        body = { model: config.model, max_tokens: 4096, system, messages,
          ...(compose ? { tools: [{ name: "responder", description: "Produz a resposta final do atendimento no formato solicitado. Não executa ações externas.", input_schema: schema }], tool_choice: { type: "tool", name: "responder" } } : {}),
        };
      } else body = { model: config.model, messages: [{ role: "system", content: system }, ...messages], max_tokens: 4096, ...(compose ? { response_format: { type: "json_object" } } : {}) };
      if (provider === "groq" && compose && ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b", "meta-models/muse-spark-open"].includes(config.model)) {
        body.response_format = { type: "json_schema", json_schema: { name: "resposta_atendimento", strict: true, schema } };
      }
      let response;
      try { response = await fetchImpl(info.endpoint, { method: "POST", redirect: "error", headers, body: JSON.stringify(body), signal: config.signal ? AbortSignal.any([config.signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000) }); }
      catch { throw fail(`Não foi possível acessar ${info.name}. Confira a conexão e tente novamente.`, 502); }
      if (!response.ok) {
        let quota = false;
        if (provider === "anthropic" && response.status === 400) {
          const body = await response.json().catch(() => ({}));
          quota = body.error?.type === "billing_error" || /credit balance.*too low|spend(?:ing)? limit|insufficient (?:credits|balance)/i.test(String(body.error?.message || ""));
        }
        throw tagProviderError(fail(providerError(info.name, quota ? 402 : response.status), 502), response, quota);
      }
      let data; try { data = await response.json(); } catch { throw fail(`${info.name} retornou uma resposta inválida.`, 502); }
      let text;
      if (provider === "openai") {
        if (data.status === "incomplete" || data.error) throw fail(`${info.name} não concluiu a resposta. Confira o modelo ou tente uma pergunta mais curta.`, 502);
        text = data.output?.filter(item => item.type === "message").flatMap(item => item.content || []).filter(item => item.type === "output_text").map(item => item.text).join("");
      } else if (provider === "anthropic") {
        if (compose) return parse(data.content?.find(item => item.type === "tool_use" && item.name === "responder")?.input, info.name);
        text = data.content?.filter(item => item.type === "text").map(item => item.text).join("");
      } else text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) throw fail(`${info.name} não retornou texto. Tente novamente.`, 502);
      return compose ? parse(text, info.name) : { text };
    },
  };
}
