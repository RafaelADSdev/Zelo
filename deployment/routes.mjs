import { PWA_ASSETS } from '../pwa-assets.mjs';
import { LEGAL_ASSETS } from '../legal-assets.mjs';
const files = new Set(['/motion.css','/motion.js','/','/admin/access','/login','/login.js','/login.css','/app.js','/workspace.js','/panel.css','/settings-ui.js','/style.css','/catalog.js','/catalog.css','/ai-keys.js','/reply-schedule.js','/brand/logo.svg','/brand/logo-light.svg','/brand/icon.svg','/favicon.ico','/webhook']);
export function allowedPath(path) {
  if (LEGAL_ASSETS.has(path)) return true;
  if (/^\/brand\/providers\/(gemini|openai|anthropic|xai|openrouter|deepseek|groq)\.svg$/.test(path)) return true;
  return PWA_ASSETS.has(path) || files.has(path) || /^\/w\/[a-f0-9-]{36}\/webhook$/.test(path) || /^\/api\/workspace(?:\/(?:accounts|invites|access))?$/.test(path) || /^\/api\/(?:health|auth\/(?:status|setup|login|logout|invitation|accept)|products(?:\/[a-f0-9-]{36}(?:\/files(?:\/[a-f0-9-]{36}\/remove)?)?)?|files\/[a-f0-9-]{36}|uploads(?:\/[a-f0-9-]{36}(?:\/finish)?)?|ai\/(?:providers|keys(?:\/[a-f0-9-]{36}(?:\/(?:verify|reset|remove))?)?|rotation|verify)|dashboard|state|conversation|templates|settings|qr\/(?:connect|disconnect|logout)|gemini\/verify|whatsapp\/(?:verify|subscribe|send|retry)|tunnel\/(?:start|stop)|chat|knowledge|new)$/.test(path);
}
