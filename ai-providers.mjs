export const AI_PROVIDERS = {
  gemini: { name: "Google Gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta", console: "https://aistudio.google.com/api-keys", example: "gemini-3.5-flash-lite", defaultModel: "gemini-3.5-flash-lite" },
  openai: { name: "OpenAI · GPT", endpoint: "https://api.openai.com/v1/responses", console: "https://platform.openai.com/api-keys", example: "ID do modelo disponível na sua conta" },
  anthropic: { name: "Anthropic · Claude", endpoint: "https://api.anthropic.com/v1/messages", console: "https://platform.claude.com/settings/keys", example: "claude-sonnet-4-5" },
  xai: { name: "xAI · Grok", endpoint: "https://api.x.ai/v1/chat/completions", console: "https://console.x.ai/", example: "ID do modelo Grok disponível na sua conta" },
  openrouter: { name: "OpenRouter · outros modelos", endpoint: "https://openrouter.ai/api/v1/chat/completions", console: "https://openrouter.ai/settings/keys", example: "provedor/modelo" },
  deepseek: { name: "DeepSeek", endpoint: "https://api.deepseek.com/chat/completions", console: "https://platform.deepseek.com/api_keys", example: "deepseek-flash" },
  groq: { name: "Groq · plano gratuito disponível", endpoint: "https://api.groq.com/openai/v1/chat/completions", console: "https://console.groq.com/keys", example: "openai/gpt-oss-20b", defaultModel: "openai/gpt-oss-20b" },
};

export function normalizeModelId(provider, input) {
  const fail = message => { throw Object.assign(new Error(message), {status:400}); };
  if (typeof input !== 'string') fail('Informe o ID completo do modelo disponível na sua conta.');
  let model = input.trim();
  if (provider === 'gemini') model = model.replace(/^models\//, '');
  if (provider === 'gemini' && !/^gemini-[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model)) fail('Informe o modelo completo do Gemini, por exemplo gemini-3.5-flash-lite. Apenas “gemini” é o nome do provedor.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,99}$/.test(model)) fail('Informe um ID de modelo válido, sem URL ou espaços no meio do nome.');
  return model;
}
