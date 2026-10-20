export const AI_PROVIDERS = {
  gemini: { name: "Google Gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta", console: "https://aistudio.google.com/api-keys", example: "gemini-2.5-flash" },
  openai: { name: "OpenAI · GPT", endpoint: "https://api.openai.com/v1/responses", console: "https://platform.openai.com/api-keys", example: "ID do modelo disponível na sua conta" },
  anthropic: { name: "Anthropic · Claude", endpoint: "https://api.anthropic.com/v1/messages", console: "https://platform.claude.com/settings/keys", example: "claude-sonnet-4-5" },
  xai: { name: "xAI · Grok", endpoint: "https://api.x.ai/v1/chat/completions", console: "https://console.x.ai/", example: "ID do modelo Grok disponível na sua conta" },
  openrouter: { name: "OpenRouter · outros modelos", endpoint: "https://openrouter.ai/api/v1/chat/completions", console: "https://openrouter.ai/settings/keys", example: "provedor/modelo" },
  deepseek: { name: "DeepSeek", endpoint: "https://api.deepseek.com/chat/completions", console: "https://platform.deepseek.com/api_keys", example: "deepseek-flash" },
  groq: { name: "Groq · plano gratuito disponível", endpoint: "https://api.groq.com/openai/v1/chat/completions", console: "https://console.groq.com/keys", example: "openai/gpt-oss-20b", defaultModel: "openai/gpt-oss-20b" },
};
