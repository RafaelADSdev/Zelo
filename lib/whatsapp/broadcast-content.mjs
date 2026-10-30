import { fail } from '../core/settings.mjs';
export function personalize(text, recipient) {
  return String(text || '').replace(/(?<!\{)\{([a-z][a-z0-9_]{0,39})(?:\|([^{}]*))?\}(?!\})/g, (_match, key, fallback) => {
    const value = key === 'nome' ? recipient.name : Object.hasOwn(recipient.vars || {}, key) ? recipient.vars[key] : undefined;
    if (value != null && String(value).trim()) return String(value);
    if (fallback !== undefined && fallback.trim()) return fallback;
    throw fail(`A variável {${key}} está sem valor. Preencha a coluna ou use {${key}|alternativa}.`);
  });
}
export function recipientContent(payload, recipient) {
  const text = personalize(payload.text, recipient);
  if (text.length > 4000) throw fail('A mensagem personalizada ultrapassa 4.000 caracteres.');
  if (!payload.template) return { text };
  const template = structuredClone(payload.template);
  for (const component of template.components || []) for (const parameter of component.parameters || []) if (parameter.type === 'text') parameter.text = personalize(parameter.text, recipient);
  return { text: `[Template: ${template.name}]`, template };
}
