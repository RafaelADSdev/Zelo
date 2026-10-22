import { AI_PROVIDERS } from "../ai/ai-providers.mjs";

export const AUDIO_PROVIDERS = Object.fromEntries([
  ["gemini", AI_PROVIDERS.gemini.defaultModel],
  ["groq", "whisper-large-v3-turbo"],
  ["openai", "gpt-transcribe"],
].map(([id, model]) => [id, { ...AI_PROVIDERS[id], defaultModel: model, example: model }]));

export function audioConfiguration(config) {
  if (!Array.isArray(config.audioAiKeys)) return config;
  return { ...config, aiKeys: config.audioAiKeys, aiKeysRevision: config.audioAiKeysRevision, aiLastUsed: config.audioAiLastUsed, aiRotationEnabled: config.audioAiRotationEnabled, aiListOnly: true };
}
