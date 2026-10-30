import { inspectNumbers } from '/broadcast-import.js';
const $ = id => document.getElementById(id);
const node = (tag, text, className = '') => { const item = document.createElement(tag); item.textContent = text; item.className = className; return item; };

export function initBroadcastLayout({ refreshHistory }) {
  const root = $('view-broadcasts'), compose = root.querySelector('.broadcast-compose');
  const history = root.querySelector(':scope > section.settings-card:not(.broadcast-compose):not(.broadcast-suppression)'), suppression = root.querySelector(':scope > .broadcast-suppression');
  const suppressionPanel = node('section', ''); suppression.before(suppressionPanel); suppressionPanel.append(suppression);
  const form = $('broadcast-form'), steps = [...form.querySelectorAll(':scope > .broadcast-step')], names = ['Contatos', 'Mensagem', 'Envio'];
  const description = ['Escolha os contatos que vão receber sua mensagem.', 'Prepare o conteúdo e confira como ele vai aparecer.', 'Defina quando enviar e revise antes de confirmar.'];
  let current = 0;
  const tabs = node('nav', '', 'broadcast-workspace-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Áreas de disparos');
  const panels = { compose, history, suppression: suppressionPanel }, tabButtons = new Map();
  for (const [key, label] of [['compose', 'Novo disparo'], ['history', 'Histórico'], ['suppression', 'Descadastros']]) {
    const button = node('button', label); button.type = 'button'; button.id = `broadcast-area-${key}`; button.setAttribute('role', 'tab');
    panels[key].id = `broadcast-panel-${key}`; panels[key].setAttribute('role', 'tabpanel'); panels[key].setAttribute('aria-labelledby', button.id); button.setAttribute('aria-controls', panels[key].id);
    button.addEventListener('click', () => pane(key)); tabs.append(button); tabButtons.set(key, button);
  }
  tabs.addEventListener('keydown', event => {
    const buttons = [...tabButtons.values()], index = buttons.indexOf(document.activeElement);
    if (index < 0 || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].click(); buttons[next].focus();
  }); root.prepend(tabs);
  const main = node('div', '', 'broadcast-compose-main'); main.append(...compose.childNodes); compose.append(main);
  const stepNav = node('nav', '', 'broadcast-step-nav'); stepNav.setAttribute('aria-label', 'Etapas da campanha');
  const stepList = node('ol', ''); const stepButtons = steps.map((_step, index) => {
    const li = node('li', ''), button = node('button', ''); button.type = 'button'; button.dataset.composeStep = String(index);
    steps[index].id = `broadcast-compose-step-${index}`; button.setAttribute('aria-controls', steps[index].id);
    button.append(node('span', String(index + 1), 'broadcast-step-number'), node('span', names[index]));
    button.addEventListener('click', () => { if (index <= current || validUntil(index - 1)) go(index); }); li.append(button); stepList.append(li); return button;
  }); stepNav.append(stepList); form.before(stepNav);
  // Keep the common path short; optional tools remain available in one place.
  const options = node('details', '', 'broadcast-contact-options');
  options.append(node('summary', 'Mais opções de contatos'));
  const conversations = $('broadcast-contacts').closest('details');
  options.append(form.querySelector('.broadcast-number-check'), conversations,
    form.querySelector('label[for="broadcast-name"]'), $('broadcast-name'));
  steps[0].append(options);
  $('broadcast-phones').rows = 3;
  const footer = form.querySelector('.dialog-footer'), back = node('button', 'Voltar', 'secondary-button'), next = node('button', 'Ir para mensagem', 'primary-button');
  back.type = next.type = 'button'; footer.classList.add('broadcast-compose-footer'); footer.prepend(back); footer.append(next);
  back.addEventListener('click', () => go(current - 1)); next.addEventListener('click', () => { if (validUntil(current)) go(current + 1); });
  const summary = node('aside', '', 'broadcast-compose-summary'), disclosure = node('details', '');
  const toggle = node('summary', 'Resumo da campanha'); disclosure.append(toggle);
  const content = node('div', '', 'broadcast-summary-content'); const title = node('h3', 'Sem nome definido');
  const list = node('dl', ''), values = {};
  for (const [key, label] of [['contacts','Destinatários'], ['product','Produto'], ['format','Formato'], ['when','Envio'], ['window','Janela']]) { const row = node('div', ''); values[key] = node('dd', ''); if (key === 'product') values[key].id = 'broadcast-summary-product'; row.append(node('dt', label), values[key]); list.append(row); }
  const previewTitle = node('h4', 'Prévia rápida'), preview = node('p', '', 'broadcast-summary-message');
  content.append(title, list, previewTitle, preview, node('p', 'A confirmação e o consentimento ficam na revisão final.', 'hint')); disclosure.append(content); summary.append(disclosure); compose.append(summary);
  // The summary is available on demand at every width, without a competing rail.
  disclosure.open = false;
  const policy = {};
  for (const [key, label] of [['hours', 'Horários'], ['days', 'Dias da semana'], ['pace', 'Ritmo'], ['limit', 'Limite diário']]) {
    const row = node('div', ''); policy[key] = node('dd', '');
    row.append(node('dt', label), policy[key]); $('broadcast-policy-summary').append(row);
  }
  let deliveryMode;
  function update() {
    const lines = $('broadcast-phones').value.split(/[\n;,]+/).map(value => [value.trim()]).filter(row => row[0]);
    const count = inspectNumbers(lines).phones.length;
    title.textContent = $('broadcast-name').value.trim() || 'Sem nome definido';
    values.contacts.textContent = count ? `${count} contato${count === 1 ? '' : 's'} na lista` : 'Nenhum contato adicionado';
    values.format.textContent = $('broadcast-kind').value === 'template' ? 'Template aprovado' : 'Mensagem de texto';
    values.product.textContent = $('broadcast-product')?.value ? $('broadcast-product').selectedOptions[0]?.textContent : 'Sem produto vinculado';
    values.when.textContent = $('broadcast-when').value === 'later' ? ($('broadcast-schedule').value ? new Date($('broadcast-schedule').value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Data a definir') : 'Após confirmação';
    values.window.textContent = `${$('broadcast-start').value}–${$('broadcast-end').value} · ${$('broadcast-zone').value === 'America/Sao_Paulo' ? 'São Paulo' : $('broadcast-zone').value}`;
    policy.hours.textContent = $('broadcast-start').value === $('broadcast-end').value ? `Dia inteiro · ${$('broadcast-zone').value}` : values.window.textContent;
    const days = [...$('broadcast-days').querySelectorAll('input:checked')].map(input => Number(input.value));
    policy.days.textContent = days.length === 7 ? 'Todos os dias' : days.length ? days.map(day => ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'][day - 1]).join(', ') : 'Nenhum dia selecionado';
    policy.pace.textContent = `Até ${$('broadcast-minute').value || '—'} por minuto · intervalo de ${$('broadcast-interval').value || '—'} a ${Number($('broadcast-interval').value) + Number($('broadcast-jitter').value)} s`;
    policy.limit.textContent = `${$('broadcast-daily').value || '—'} tentativas por dia`;
    if (deliveryMode !== $('broadcast-when').value) {
      deliveryMode = $('broadcast-when').value;
      form.querySelector('.broadcast-delivery-policy').open = deliveryMode === 'later';
    }
    $('broadcast-timing-note').textContent = $('broadcast-when').value === 'later' ? 'A campanha entra na fila na data escolhida e respeita os horários permitidos.' : 'A campanha entra na fila após sua confirmação, respeitando as condições de envio configuradas.';
    preview.textContent = $('broadcast-kind').value === 'template' ? $('broadcast-template-preview').textContent || 'Selecione o template na etapa Mensagem.' : $('broadcast-text').value.trim().slice(0, 280) || 'Sua mensagem aparecerá aqui enquanto você escreve.';
  }
  form.addEventListener('input', update); form.addEventListener('change', update);
  // Importers update values programmatically; their existing status mutations
  // provide a stable update signal without polling or changing their contract.
  new MutationObserver(update).observe($('broadcast-list-summary'), { childList: true, subtree: true });
  function reveal(control) { let parent = control.parentElement; while (parent && parent !== form) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; } }
  function validUntil(index) {
    for (let i = 0; i <= index; i++) {
      const invalid = [...steps[i].querySelectorAll('input,select,textarea')].find(control => !control.checkValidity());
      if (invalid) { go(i, false); reveal(invalid); invalid.reportValidity(); invalid.focus(); return false; }
    } return true;
  }
  form.noValidate = true;
  form.addEventListener('submit', event => {
    if (current < 2) { event.preventDefault(); event.stopImmediatePropagation(); if (validUntil(current)) go(current + 1); }
    else if (!validUntil(steps.length - 1)) { event.preventDefault(); event.stopImmediatePropagation(); }
  });
  function go(index, focus = true) {
    current = Math.max(0, Math.min(2, index));
    steps.forEach((step, i) => { step.hidden = i !== current; stepButtons[i].dataset.state = i === current ? 'current' : i < current ? 'complete' : 'next'; if (i === current) stepButtons[i].setAttribute('aria-current','step'); else stepButtons[i].removeAttribute('aria-current'); });
    back.hidden = current === 0; next.hidden = current === 2; $('broadcast-submit').hidden = current !== 2;
    next.textContent = current === 0 ? 'Ir para mensagem' : 'Ir para envio'; main.querySelector('.broadcast-heading .hint').textContent = description[current];
    if (focus) { steps[current].tabIndex = -1; steps[current].focus({ preventScroll: true }); stepNav.scrollIntoView({ block: 'nearest' }); } update();
  }
  function pane(key, focus = false) {
    for (const [name, panel] of Object.entries(panels)) { panel.hidden = name !== key; tabButtons.get(name).setAttribute('aria-selected', String(name === key)); tabButtons.get(name).tabIndex = name === key ? 0 : -1; }
    if (key === 'history') refreshHistory().catch(error => { $('broadcast-history-status').textContent = error.message; });
    if (focus) { panels[key].tabIndex = -1; panels[key].focus(); }
  }
  root.dataset.layout = 'guided'; pane('compose'); go(0, false);
  return { go, pane, review(active) { stepNav.hidden = active; summary.hidden = active; update(); } };
}
