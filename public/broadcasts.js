import { initTemplateMap } from '/broadcast-template-map.js';
import { initSuppression } from '/broadcast-suppression.js';
import { initBroadcastImport } from '/broadcast-import-ui.js';
import { initBroadcastHistory, refreshBroadcastHistory } from '/broadcast-history.js';
import { inspectNumbers, phoneNumber } from '/broadcast-import.js';
const $ = id => document.getElementById(id);
const el = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
const date = value => new Date(Number(value)).toLocaleString('pt-BR');
let api, templates = [], draft, signature, requestId, contacts = [], review, templateMap, testId;
const metadata = new Map();

export const refreshBroadcasts = refreshBroadcastHistory;
async function run(button, action, status = 'broadcast-status') {
  button.disabled = true; $(status).textContent = '';
  try { await action(); } catch (error) { $(status).textContent = error.message; }
  finally { button.disabled = false; }
}
const recipientLines = () => $('broadcast-phones').value.split(/[\n;,]+/).map(line => line.trim()).filter(Boolean);
function updateRecipients(imported) {
  imported?.recipients?.forEach(item => metadata.set(item.phone, item));
  if (templateMap && $('broadcast-template').value !== '') templateMap.render(templates[Number($('broadcast-template').value)]);
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
function reviewMessage() {
  const output = review.recipients[0]?.preview;
  if (!output?.template) return output?.text || draft.text || '';
  const approved = templates[Number($('broadcast-template').value)];
  const rendered = (approved?.components || []).filter(component => component.text).map(component => {
    const params = output.template.components?.find(item => item.type.toLowerCase() === component.type.toLowerCase())?.parameters || [];
    return component.text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => params.find((item, index) => (item.parameter_name || String(index + 1)) === key)?.text || match);
  }).join('\n');
  return `[Template: ${output.template.name}]\n${rendered || 'Parâmetros: ' + (output.template.components || []).flatMap(component => (component.parameters || []).map(item => item.text || item.type)).join(' · ')}`;
}
function renderReview() {
  $('broadcast-confirm').disabled = !review.ready;
  $('broadcast-window-only-label').hidden = !review.outsideWindow || Boolean(draft.template);
  $('broadcast-review-summary').textContent = `${review.recipients.length} destinatário(s) disponíveis · ${review.duplicates} duplicados · ${review.invalid.length} inválidos · ${review.suppressed.length} suprimidos. ${review.canText} podem receber texto; ${review.outsideWindow} exigem template.`;
  $('broadcast-review-phones').textContent = review.recipients.map(item => '+' + item.phone).join(' · ');
  $('broadcast-review-message').textContent = reviewMessage();
  $('broadcast-review-exclusions').textContent = [...review.invalid, ...review.errors].map(item => `Linha ${item.row}: ${item.reason}`).join(' ') || (!review.recipients.length ? 'Nenhum destinatário disponível. Confira a lista de supressão e a seleção da janela.' : '');
  const minutes = Math.max(review.recipients.length * (draft.intervalMs + draft.jitterMs / 2) / 60000, review.recipients.length / draft.perMinute);
  $('broadcast-review-estimate').textContent = `Duração estimada pelo ritmo: ${Math.max(1, Math.ceil(minutes))} min, sem contar esperas de janela, limite diário ou conexão. ${draft.scheduledAt ? 'Agendado para ' + date(Date.parse(draft.scheduledAt)) : 'Envio após confirmação'}.`;
  $('broadcast-review-window').textContent = `Janela ${draft.windowStart}–${draft.windowEnd} · ${draft.timezone} · dias ${draft.days.join(', ')} · teto diário ${draft.dailyCap} tentativas. Intervalo ${draft.intervalMs / 1000}–${(draft.intervalMs + draft.jitterMs) / 1000} s, até ${draft.perMinute}/min.`;
}
export function initBroadcasts(options) {
  templateMap = initTemplateMap({ variables: () => [...new Set([...metadata.values()].flatMap(item => Object.keys(item.vars || {})))] });
  api = options.api; initSuppression({ api });
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
  ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].forEach((text, index) => { const label = el('label', text); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = String(index + 1); checkbox.checked = true; label.prepend(checkbox); $('broadcast-days').append(label); });
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
  $('broadcast-template').addEventListener('change', () => { templateMap.render(templates[Number($('broadcast-template').value)]); $('broadcast-template-preview').textContent = $('broadcast-template').value === '' ? '' : templates[Number($('broadcast-template').value)]?.components?.map(item => item.text || item.type).join('\n') || ''; });
  $('broadcast-form').addEventListener('submit', event => {
    event.preventDefault();
    run($('broadcast-submit'), async () => {
      const lines = $('broadcast-phones').value.split(/[\n;,]+/).map(line => line.trim()).filter(Boolean);
      if (!lines.length || lines.length > 500) throw new Error('Informe de 1 a 500 números válidos, com DDI e DDD.');
      const phones = [...new Set(lines.map(line => phoneNumber(line) || line))];
      draft = { intervalMs: Number($('broadcast-interval').value) * 1000, jitterMs: Number($('broadcast-jitter').value) * 1000, perMinute: Number($('broadcast-minute').value), dailyCap: Number($('broadcast-daily').value), timezone: $('broadcast-zone').value, windowStart: $('broadcast-start').value, windowEnd: $('broadcast-end').value, days: [...$('broadcast-days').querySelectorAll('input:checked')].map(input => Number(input.value)), name: $('broadcast-name').value.trim(), phones: phones.join('\n'), text: $('broadcast-text').value.trim() };
      draft.recipients = phones.map(phone => metadata.get(phone) || { phone });
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
        else components = templateMap.components();
        draft.template = { name: template.name, language: { code: template.language }, components }; delete draft.text;
      }
      if ($('broadcast-when').value === 'later') {
        const scheduled = new Date($('broadcast-schedule').value);
        if (!Number.isFinite(scheduled.getTime()) || scheduled.getTime() <= Date.now()) throw new Error('Escolha uma data e horário futuros.');
        draft.scheduledAt = scheduled.toISOString();
      }
      testId = crypto.randomUUID();
      review = await api('/api/broadcasts/preview', draft);
      $('broadcast-window-only').checked = false;
      renderReview();
      const nextSignature = JSON.stringify(draft);
      if (signature !== nextSignature) { signature = nextSignature; requestId = crypto.randomUUID(); }
      draft.requestId = requestId;
      $('broadcast-review-title').textContent = draft.name || 'Confira antes de enviar';

      $('broadcast-review-status').textContent = ''; $('broadcast-consent').checked = false;
      $('broadcast-review-summary').dataset.legacy = `${phones.length} destinatário(s) único(s). ${lines.length - phones.length} duplicado(s) removido(s). ${draft.scheduledAt ? `Agendado para ${date(Date.parse(draft.scheduledAt))}.` : 'Envio imediato.'}`;
      $('broadcast-review-message').textContent = reviewMessage();
      $('broadcast-form').hidden = true; $('broadcast-review').hidden = false; $('broadcast-confirm').focus();
    });
  });
  $('broadcast-window-only').addEventListener('change', async () => { try { draft.windowOnly = $('broadcast-window-only').checked; review = await api('/api/broadcasts/preview', draft); renderReview(); } catch (error) { $('broadcast-review-status').textContent = error.message; $('broadcast-confirm').disabled = true; } });
  $('broadcast-test').addEventListener('click', event => run(event.currentTarget, async () => { if (!confirm('Enviar somente um teste ao próprio número identificado na conexão? Ele entra na fila e respeita a janela e os limites.')) return; await api('/api/broadcasts/test', { ...draft, requestId: testId, confirmed: true }); $('broadcast-review-status').textContent = 'Teste criado na fila. Confira a mensagem no próprio WhatsApp antes de confirmar o disparo.'; await refreshBroadcasts(); }, 'broadcast-review-status'));
  document.addEventListener('broadcast-duplicate', event => {
    const copy = event.detail; metadata.clear(); copy.recipients.forEach(item => metadata.set(item.phone, item));
    $('broadcast-phones').value = copy.recipients.map(item => item.phone).join('\n'); $('broadcast-name').value = copy.name || ''; $('broadcast-text').value = copy.text || '';
    for (const [id, value] of Object.entries({ 'broadcast-interval': copy.intervalMs / 1000, 'broadcast-jitter': copy.jitterMs / 1000, 'broadcast-minute': copy.perMinute, 'broadcast-daily': copy.dailyCap, 'broadcast-zone': copy.timezone, 'broadcast-start': copy.windowStart, 'broadcast-end': copy.windowEnd })) $(id).value = value;
    $('broadcast-days').querySelectorAll('input').forEach(input => input.checked = copy.days.includes(Number(input.value)));
    $('broadcast-kind').value = copy.template ? 'template' : 'text'; $('broadcast-kind').dispatchEvent(new Event('change'));
    if (copy.template) { templates.push({ ...copy.template, language: copy.template.language.code }); $('broadcast-template').append(new Option(copy.template.name, String(templates.length - 1))); $('broadcast-template').value = String(templates.length - 1); $('broadcast-components').value = JSON.stringify(copy.template.components || []); } else $('broadcast-components').value = '';
    $('broadcast-when').value = 'now'; $('broadcast-when').dispatchEvent(new Event('change')); $('broadcast-form').hidden = false; $('broadcast-review').hidden = true; $('broadcast-consent').checked = false; signature = null; requestId = null;
    updateRecipients(); updateMessage(); $('broadcast-status').textContent = 'Cópia preparada. Revise o conteúdo e confirme um novo consentimento antes de enviar.'; $('broadcast-name').focus();
  });
  $('broadcast-edit').addEventListener('click', () => { $('broadcast-form').hidden = false; $('broadcast-review').hidden = true; $('broadcast-phones').focus(); });
  $('broadcast-confirm').addEventListener('click', event => run(event.currentTarget, async () => {
    if (!review?.ready) throw new Error('Use um template ou selecione apenas os contatos na janela de 24 horas.');
    if (!$('broadcast-consent').checked) throw new Error('Confirme o consentimento da lista antes de enviar.');
    draft.consent = true;
    $('broadcast-edit').disabled = true;
    try { await api('/api/broadcasts', draft); } finally { $('broadcast-edit').disabled = false; }
    draft = null; signature = null;
    $('broadcast-review').hidden = true; $('broadcast-form').hidden = false;
    $('broadcast-status').textContent = 'Disparo criado. Acompanhe os resultados no histórico.'; await refreshBroadcasts();
  }, 'broadcast-review-status'));
  $('broadcast-refresh').addEventListener('click', event => run(event.currentTarget, () => refreshBroadcasts(true), 'broadcast-history-status'));
}
