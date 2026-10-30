import { initBroadcastImport } from '/broadcast-import-ui.js';
import { initBroadcastHistory, refreshBroadcastHistory } from '/broadcast-history.js';
import { inspectNumbers, phoneNumber } from '/broadcast-import.js';
const $ = id => document.getElementById(id);
const el = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
const date = value => new Date(Number(value)).toLocaleString('pt-BR');
let api, templates = [], draft, signature, requestId, contacts = [];

export const refreshBroadcasts = refreshBroadcastHistory;
async function run(button, action, status = 'broadcast-status') {
  button.disabled = true; $(status).textContent = '';
  try { await action(); } catch (error) { $(status).textContent = error.message; }
  finally { button.disabled = false; }
}
const recipientLines = () => $('broadcast-phones').value.split(/[\n;,]+/).map(line => line.trim()).filter(Boolean);
function updateRecipients() {
  const result = inspectNumbers(recipientLines().map(value => [value]));
  $('broadcast-list-summary').textContent = recipientLines().length ? `${result.phones.length} contatos válidos · ${result.duplicates} duplicados · ${result.invalid.length} inválidos${result.phones.length > 500 ? ' · Limite de 500 excedido' : ''}` : 'Adicione os contatos para começar.';
  $('broadcast-clean').disabled = recipientLines().length === 0;
  $('broadcast-contacts').querySelectorAll('input').forEach(input => { input.checked = result.phones.includes(input.value); });
}
function cleanRecipients() {
  const result = inspectNumbers(recipientLines().map(value => [value]));
  $('broadcast-phones').value = [...result.phones, ...result.invalid.map(item => item.value)].join('\n');
  updateRecipients();
  $('broadcast-status').textContent = `${result.duplicates} duplicados removidos.${result.invalid.length ? ` Corrija os ${result.invalid.length} números inválidos que continuam na lista.` : ' Lista organizada.'}`;
}
function updateMessage() {
  $('broadcast-text-count').textContent = `${$('broadcast-text').value.length.toLocaleString('pt-BR')} / 4.000 caracteres`;
  $('broadcast-live-message').textContent = $('broadcast-text').value || 'Sua mensagem aparecerá aqui.';
}
export function initBroadcasts(options) {
  api = options.api;
  initBroadcastImport({ changed: updateRecipients }); initBroadcastHistory({ api });
  $('broadcast-phones').addEventListener('input', updateRecipients);
  $('broadcast-clean').addEventListener('click', cleanRecipients);
  $('broadcast-text').addEventListener('input', updateMessage);
  $('broadcast-select-all').addEventListener('click', () => {
    const phones = new Set(recipientLines().map(value => phoneNumber(value) || value)); contacts.forEach(contact => phones.add(contact.phone));
    if (phones.size > 500) { $('broadcast-status').textContent = 'A lista ultrapassa 500 contatos. Selecione menos destinatários.'; return; }
    $('broadcast-phones').value = [...phones].join('\n'); updateRecipients();
    $('broadcast-contacts').querySelectorAll('input').forEach(input => input.checked = true);
  });
  updateRecipients(); updateMessage();
  $('broadcast-timezone').textContent = `Fuso horário: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`;
  $('broadcast-kind').addEventListener('change', () => {
    const template = $('broadcast-kind').value === 'template';
    $('broadcast-text-fields').hidden = template; $('broadcast-template-fields').hidden = !template; $('broadcast-text').required = !template;
  });
  $('broadcast-when').addEventListener('change', () => {
    const later = $('broadcast-when').value === 'later'; $('broadcast-schedule-fields').hidden = !later; $('broadcast-schedule').required = later;
  });
  $('broadcast-load-contacts').addEventListener('click', event => run(event.currentTarget, async () => {
    const dashboard = await api('/api/dashboard'); contacts = []; const container = $('broadcast-contacts'); container.replaceChildren();
    for (const contact of dashboard.conversations) {
      const phone = contact.phone.replace(/@s\.whatsapp\.net$/, '');
      if (!/^[1-9]\d{6,14}$/.test(phone)) continue;
      contacts.push({ phone });
      const label = el('label', ''); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = phone;
      const numbers = () => recipientLines().map(value => phoneNumber(value) || value);
      checkbox.checked = numbers().includes(phone);
      checkbox.addEventListener('change', () => { const phones = new Set(numbers()); if (checkbox.checked) phones.add(phone); else phones.delete(phone); $('broadcast-phones').value = [...phones].join('\n'); updateRecipients(); });
      label.append(checkbox, document.createTextNode(` ${contact.name || phone} · ${phone}`)); container.append(label);
    }
    $('broadcast-select-all').hidden = !contacts.length;
    if (!container.children.length) container.append(el('p', 'Nenhum contato com número disponível nesta conexão.'));
  }));
  $('broadcast-load-templates').addEventListener('click', event => run(event.currentTarget, async () => {
    templates = (await api('/api/templates')).templates;
    $('broadcast-template').replaceChildren(new Option('Selecione um template', ''));
    templates.forEach((template, i) => $('broadcast-template').append(new Option(`${template.name} · ${template.language}`, String(i))));
  }));
  $('broadcast-template').addEventListener('change', () => { $('broadcast-template-preview').textContent = $('broadcast-template').value === '' ? '' : templates[Number($('broadcast-template').value)]?.components?.map(item => item.text || item.type).join('\n') || ''; });
  $('broadcast-form').addEventListener('submit', event => {
    event.preventDefault();
    run($('broadcast-submit'), async () => {
      const lines = $('broadcast-phones').value.split(/[\n;,]+/).map(line => line.trim()).filter(Boolean);
      if (!lines.length || lines.length > 500 || lines.some(line => !/^\+?[\d\s().-]+$/.test(line) || !/^[1-9]\d{6,14}$/.test(line.replace(/\D/g, '')))) throw new Error('Informe de 1 a 500 números válidos, com DDI e DDD.');
      const phones = [...new Set(lines.map(line => line.replace(/\D/g, '')))];
      draft = { name: $('broadcast-name').value.trim(), phones: phones.join('\n'), text: $('broadcast-text').value.trim() };
      if ($('broadcast-kind').value === 'template') {
        if ($('broadcast-template').value === '') throw new Error('Selecione um template aprovado.');
        const template = templates[Number($('broadcast-template').value)];
        let components = [];
        if ($('broadcast-components').value.trim()) {
          try { components = JSON.parse($('broadcast-components').value); } catch { throw new Error('JSON de componentes inválido.'); }
          if (!Array.isArray(components)) throw new Error('Os componentes devem ser um array JSON.');
        } else if ($('broadcast-params').value.trim()) components = [{ type: 'body', parameters: $('broadcast-params').value.split('\n').filter(line => line.trim()).map(line => {
          const match = line.match(/^([a-zA-Z_][\w]*)=(.*)$/); return match ? { type: 'text', parameter_name: match[1], text: match[2] } : { type: 'text', text: line };
        }) }];
        draft.template = { name: template.name, language: { code: template.language }, components }; delete draft.text;
      }
      if ($('broadcast-when').value === 'later') {
        const scheduled = new Date($('broadcast-schedule').value);
        if (!Number.isFinite(scheduled.getTime()) || scheduled.getTime() <= Date.now()) throw new Error('Escolha uma data e horário futuros.');
        draft.scheduledAt = scheduled.toISOString();
      }
      const nextSignature = JSON.stringify(draft);
      if (signature !== nextSignature) { signature = nextSignature; requestId = crypto.randomUUID(); }
      draft.requestId = requestId;
      $('broadcast-review-title').textContent = draft.name || 'Confira antes de enviar';
      $('broadcast-review-phones').textContent = phones.map(phone => '+' + phone).join(' · ');
      $('broadcast-review-status').textContent = '';
      $('broadcast-review-summary').textContent = `${phones.length} destinatário(s) único(s). ${lines.length - phones.length} duplicado(s) removido(s). ${draft.scheduledAt ? `Agendado para ${date(Date.parse(draft.scheduledAt))}.` : 'Envio imediato.'}`;
      $('broadcast-review-message').textContent = draft.template ? `Template: ${draft.template.name}\n${$('broadcast-template-preview').textContent}\n${$('broadcast-params').value}` : draft.text;
      $('broadcast-form').hidden = true; $('broadcast-review').hidden = false; $('broadcast-confirm').focus();
    });
  });
  $('broadcast-edit').addEventListener('click', () => { $('broadcast-form').hidden = false; $('broadcast-review').hidden = true; $('broadcast-phones').focus(); });
  $('broadcast-confirm').addEventListener('click', event => run(event.currentTarget, async () => {
    $('broadcast-edit').disabled = true;
    try { await api('/api/broadcasts', draft); } finally { $('broadcast-edit').disabled = false; }
    draft = null; signature = null;
    $('broadcast-review').hidden = true; $('broadcast-form').hidden = false;
    $('broadcast-status').textContent = 'Disparo criado. Acompanhe os resultados no histórico.'; await refreshBroadcasts();
  }, 'broadcast-review-status'));
  $('broadcast-refresh').addEventListener('click', event => run(event.currentTarget, refreshBroadcasts, 'broadcast-history-status'));
}
