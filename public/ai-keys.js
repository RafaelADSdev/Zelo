const $ = selector => document.querySelector(selector);
const el = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
const icon = path => { const span = el("span", "ai-button-icon"); span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`; return span; };
let config, providers, api, changed, busy = false, editing, revision, signature = "", editorOpener, sorting = false;
let rootSettings, textProviders, audioProviders, purposeTabs, scope = "text";
const when = time => new Date(time).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
export function installAiKeyReorder(list, { canStart, start, finish, announce }) {
  let drag, frame;
  const rows = () => [...list.querySelectorAll('.ai-key-row')];
  const positions = () => rows().forEach((row, index) => { row.querySelector('.ai-key-position').textContent = String(index + 1); });
  const begin = (handle, pointer) => {
    if (drag || !canStart()) return false;
    const row = handle.closest('.ai-key-row');
    drag = { row, handle, original: rows(), pointer, bounds: row.getBoundingClientRect() };
    handle.setAttribute('aria-pressed', 'true'); row.classList.add('ai-key-reordering'); start();
    return true;
  };
  const announcePosition = () => announce(`Posição ${rows().indexOf(drag.row) + 1} de ${rows().length}. Solte para salvar ou pressione Escape para cancelar.`);
  const end = (cancel, refocus = true) => {
    if (!drag) return;
    const current = drag; drag = null;
    cancelAnimationFrame(frame);
    current.ghost?.remove(); current.row.classList.remove('ai-key-drag-placeholder', 'ai-key-reordering');
    current.handle.setAttribute('aria-pressed', 'false');
    if (current.pointer !== undefined && list.hasPointerCapture(current.pointer)) list.releasePointerCapture(current.pointer);
    if (cancel) list.append(...current.original);
    positions();
    const order = rows().map(row => row.dataset.keyId);
    const moved = !cancel && order.some((id, index) => id !== current.original[index].dataset.keyId);
    if (cancel) announce('Reordenação cancelada. A prioridade anterior foi mantida.');
    finish(moved ? order : null, current.row.dataset.keyId, refocus);
  };
  const placeAtPointer = () => {
    const center = drag.y - drag.offset + drag.bounds.height / 2;
    const others = rows().filter(row => row !== drag.row);
    const target = others.find(row => { const bounds = row.getBoundingClientRect(); return center < bounds.top + bounds.height / 2; });
    const before = rows().indexOf(drag.row);
    list.insertBefore(drag.row, target || null);
    positions();
    if (before !== rows().indexOf(drag.row)) announcePosition();
    drag.ghost.style.transform = `translateY(${drag.y - drag.startY}px)`;
  };
  const scroll = () => {
    if (!drag?.ghost) return;
    const speed = drag.y < 150 ? -Math.min(18, (150 - drag.y) / 5) : drag.y > window.innerHeight - 80 ? Math.min(18, (drag.y - window.innerHeight + 80) / 5) : 0;
    if (speed) { window.scrollBy(0, speed); placeAtPointer(); }
    frame = requestAnimationFrame(scroll);
  };
  list.addEventListener('pointerdown', event => {
    const handle = event.target.closest('.ai-key-drag');
    if (!handle || event.button !== 0 || event.isPrimary === false || !begin(handle, event.pointerId)) return;
    event.preventDefault(); handle.focus({ preventScroll: true });
    drag.startY = drag.y = event.clientY; drag.offset = event.clientY - drag.bounds.top;
    list.setPointerCapture(event.pointerId);
  });
  list.addEventListener('pointermove', event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    drag.y = event.clientY;
    if (!drag.ghost) {
      if (Math.abs(drag.y - drag.startY) < 6) return;
      const ghost = drag.row.cloneNode(true);
      ghost.classList.add('ai-key-drag-ghost'); ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
      Object.assign(ghost.style, { position: 'fixed', left: `${drag.bounds.left}px`, top: `${drag.bounds.top}px`, width: `${drag.bounds.width}px`, height: `${drag.bounds.height}px` });
      document.body.append(ghost); drag.ghost = ghost; drag.row.classList.add('ai-key-drag-placeholder');
      frame = requestAnimationFrame(scroll);
    }
    event.preventDefault(); placeAtPointer();
  });
  list.addEventListener('pointerup', event => { if (drag?.pointer === event.pointerId) end(false); });
  list.addEventListener('pointercancel', event => { if (drag?.pointer === event.pointerId) end(true); });
  list.addEventListener('lostpointercapture', event => { if (drag?.pointer === event.pointerId) end(true); });
  list.addEventListener('keydown', event => {
    const handle = event.target.closest('.ai-key-drag');
    if (!handle) return;
    if (event.key === 'Escape' && drag) { event.preventDefault(); end(true); return; }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (drag) end(false); else if (begin(handle)) announcePosition();
      return;
    }
    if (!drag || drag.pointer !== undefined || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const all = rows(), from = all.indexOf(drag.row);
    const to = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : Math.max(0, Math.min(all.length - 1, from + (event.key === 'ArrowUp' ? -1 : 1)));
    all.splice(from, 1); all.splice(to, 0, drag.row); drag.moving = true; list.append(...all);
    positions(); handle.focus({ preventScroll: true }); drag.moving = false; drag.row.scrollIntoView({ block: 'nearest' }); announcePosition();
  });
  list.addEventListener('focusout', event => { if (drag && !drag.moving && drag.pointer === undefined && event.relatedTarget !== drag.handle) end(true, false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && drag) { event.preventDefault(); end(true); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) end(true); });
  window.addEventListener('blur', () => end(true));
}
function status(text, failure = false) { $("#ai-keys-status").textContent = text; $("#ai-keys-status").classList.toggle("catalog-error", failure); }
async function run(task) {
  if (busy) return; busy = true; $("#ai-key-list").inert = true; $("#add-ai-key").disabled = true; $("#ai-rotation-enabled").disabled = true; purposeTabs.querySelectorAll("button").forEach(button => button.disabled = true); status("Salvando…");
  try { status(await task() || "Salvo."); await changed(); }
  catch (error) { status(error.message, true); await changed().catch(() => {}); }
  finally { busy = false; $("#ai-key-list").inert = false; $("#add-ai-key").disabled = false; $("#ai-rotation-enabled").disabled = false; purposeTabs.querySelectorAll("button").forEach(button => button.disabled = false); }
}
function edit(key = null) {
  if (busy) return;
  editorOpener = document.activeElement;
  editing = key; revision = config.aiKeysRevision;
  $("#ai-key-form").reset(); $("#ai-key-editor").hidden = false;
  $("#ai-key-title").textContent = key ? `Editar ${key.label}` : "Adicionar chave";
  $("#ai-key-label").value = key?.label || ""; $("#ai-key-provider").value = key?.provider || "gemini";
  $("#ai-key-model").value = key?.model || providers[$('#ai-key-provider').value].defaultModel || ""; $("#ai-key-enabled").checked = key?.enabled ?? true;
  $("#ai-key-notes").value = key?.notes || "";
  $("#ai-key-secret").placeholder = key ? "Deixe vazio para manter esta chave" : "Cole a chave de API";
  $("#ai-key-secret").required = !key; providerInfo(); $("#ai-key-label").focus();
}
function providerInfo() {
  const id = $("#ai-key-provider").value, info = providers[id], local = ['ollama', 'llamacpp'].includes(id);
  $('#gemini-privacy-warning').hidden = id !== 'gemini';
  $("#ai-key-model").placeholder = info.example; $("#ai-key-console").hidden = local; if (info.console) $("#ai-key-console").href = info.console;
  $("#ai-key-secret").hidden = local; document.querySelector('label[for="ai-key-secret"]').hidden = local; $("#ai-key-secret").nextElementSibling.hidden = local;
  $('#ai-key-model-help').textContent = id === 'gemini' ? `Use o ID completo, por exemplo ${info.example}. “Gemini” sozinho é o nome do provedor. A disponibilidade depende da sua conta Google.` : `Informe o ID exato do modelo disponível na sua conta. ${info.defaultModel ? 'Sugestão: ' + info.defaultModel + '.' : info.example + '.'}`;
  if (id === 'ollama') $('#ai-key-model-help').textContent = 'Informe o nome exato do modelo instalado no Ollama. O Ollama precisa estar aberto neste computador; não é necessária chave de API.';
  if (id === 'llamacpp') $('#ai-key-model-help').textContent = 'Informe o nome exato do modelo no aplicativo llama.cpp. Mantenha o aplicativo aberto neste computador, com a API local na porta 9931. Não é necessária chave de API.';
  if (id === 'openrouter') $('#ai-key-model-help').textContent = 'Um modelo por cadastro. A ordem desta lista define quem responde e quem assume quando necessário. Modelos com a mesma chave compartilham a cota do OpenRouter.';
  $('#openrouter-privacy-warning').hidden = id !== 'openrouter';
  $('#ai-key-model').setCustomValidity(''); $('#ai-key-model').removeAttribute('aria-invalid');
  if (scope === "audio") $("#ai-key-model-help").textContent = "Modelo de transcrição de áudio. Sugestão: " + info.defaultModel + ". Essa lista é independente da IA que responde aos clientes.";
  $("#ai-key-secret").required = !local && (!editing || editing.provider !== id);
}
export function renderAiKeys(settings) {
  rootSettings = settings;
  if (sorting) return;
  config = scope === "audio" ? { ...settings, aiKeys: settings.audioAiKeys, aiKeysRevision: settings.audioAiKeysRevision, aiRotationEnabled: settings.audioAiRotationEnabled, aiLastUsed: settings.audioAiLastUsed } : settings;
  $("#provider-settings h2").textContent = scope === "audio" ? "Transcrição de áudios" : "Modelos de resposta";
  $("#provider-settings .settings-section-heading p").textContent = scope === "audio" ? "Estas IAs transcrevem a voz. A resposta usa a lista de textos." : "Estas IAs elaboram as respostas, inclusive depois de um áudio ser transcrito.";
  purposeTabs.querySelectorAll("button").forEach(button => { const selected = button.dataset.scope === scope; button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1; });
  $("#ai-purpose-content").setAttribute("aria-labelledby", "ai-purpose-" + scope);
  $("#ai-rotation-enabled").checked = config.aiRotationEnabled;
  const latest = config.aiLastUsed;
  $("#ai-rotation-summary").textContent = config.aiRotationEnabled
    ? `Troca automática ativada. ${latest ? `${scope === "audio" ? "Última transcrição" : "Última resposta"}: ${latest.label} · ${latest.model} · ${when(latest.at)}.` : "A primeira chave ativa e liberada será utilizada."}`
    : "Troca automática desativada. Apenas a primeira chave ativa da lista será utilizada.";
  const nextSignature = JSON.stringify([scope, config.aiKeys, config.aiKeysRevision, config.aiKeys.map(key => key.cooldownUntil > Date.now())]);
  if (nextSignature === signature) return; signature = nextSignature;
  $("#ai-key-count").textContent = `${config.aiKeys.length} ${config.aiKeys.length === 1 ? "chave cadastrada" : "chaves cadastradas"}`;
  const ready = config.aiKeys.findIndex(key => key.enabled && key.cooldownUntil <= Date.now());
  const list = $("#ai-key-list"); list.replaceChildren();
  if (!config.aiKeys.length) { const empty = el("div", "ai-keys-empty"); empty.append(icon("M8 10V7a4 4 0 0 1 8 0v3M5 10h14v11H5z"), el("h3", "", "Conecte sua primeira IA"), el("p", "hint", "Adicione uma chave para começar. Depois, organize os modelos na ordem que preferir.")); list.append(empty); }
  config.aiKeys.forEach((key, index) => {
    const row = el("article", "ai-key-row"), order = el("div", "ai-key-position", String(index + 1)), content = el("div", "ai-key-content");
    row.dataset.enabled = String(key.enabled); row.dataset.keyId = key.id;
    row.classList.toggle('ai-key-next', index === ready);
    const identity = el('div','ai-key-identity'), provider = el('span','ai-provider-avatar'), title = el('div','ai-key-title');
    const logo = el('img'); const modelIcon = ['ollama', 'llamacpp'].includes(key.provider) ? (/^(?:hf\.co\/[^/]+\/)?qwen/i.test(key.model) ? "qwen" : /^gemma/i.test(key.model) ? "gemma" : "ollama") : key.provider; logo.src = `/brand/providers/${modelIcon}.svg`; logo.alt = ''; logo.width = 26; logo.height = 26; provider.append(logo);
    title.append(el('strong','',key.label),el('span','ai-key-provider-name',providers[key.provider].name.split(' · ')[0])); identity.append(provider,title);
    content.append(identity,el('code','ai-model-name',key.model));
    if (key.notes) content.append(el('p', 'hint ai-key-notes', key.notes));
    const waiting = key.cooldownUntil > Date.now(), state = !key.enabled ? 'paused' : waiting ? 'waiting' : key.lastError ? 'error' : key.validatedAt ? 'validated' : 'unverified';
    const stateText = {paused:'Pausada',waiting:'Em espera',error:'Atenção',validated:'Validada',unverified:'Não validada'}[state];
    const statusArea = el('div','ai-key-state'); statusArea.append(el('span','ai-status ai-status-'+state,stateText));
    if(index === ready) statusArea.append(el('span','ai-next-label','Próxima a usar'));
    if(key.validatedAt || waiting) statusArea.title = waiting ? `Nova tentativa a partir de ${when(key.cooldownUntil)}` : `Validada em ${when(key.validatedAt)}`;
    if(key.lastError) { const detail=el('details','ai-key-error'); detail.append(el('summary','','Ver aviso'),el('p','',key.lastError)); content.append(detail); }
    const actions = el("div", "ai-key-actions"), menu=el('details','ai-key-menu'), summary=el('summary',''); summary.setAttribute('aria-label',`Mais ações para ${key.label}`); summary.title='Mais ações'; summary.append(icon('M5 12h.01M12 12h.01M19 12h.01')); menu.append(summary);
    const menuItems=el('div','ai-action-menu');menu.append(menuItems);
    const button = (label, task, disabled = false, destination = menuItems, glyph) => { const btn = el("button", destination === menuItems ? "ai-menu-action" : "secondary-button", glyph ? undefined : label); btn.type = "button"; btn.disabled = disabled; btn.setAttribute('aria-label',`${label} · ${key.label}`); btn.title=label; if(glyph)btn.append(icon(glyph));btn.addEventListener("click", () => { if(busy)return; menu.open=false;task(); }); destination.append(btn); return btn; };
    const handle = el('button', 'ai-key-drag'); handle.type = 'button';
    handle.setAttribute('aria-label', `Mover prioridade de ${key.label}`); handle.setAttribute('aria-describedby', 'ai-reorder-help'); handle.setAttribute('aria-pressed', 'false');
    handle.title = 'Segure e arraste para mudar a prioridade';
    handle.append(icon('M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01'));
    handle.disabled = config.aiKeys.length < 2;
    button("Editar", () => edit(key), false, actions);
    button(key.enabled ? "Pausar" : "Ativar", () => run(async () => { await api(`/api/ai/keys/${key.id}`, { label: key.label, provider: key.provider, model: key.model, enabled: !key.enabled, revision: config.aiKeysRevision }); return key.enabled ? "Chave pausada." : "Chave ativada."; }));
    button("Validar", () => run(async () => { status("Validando a chave com uma solicitação real…"); await api(`/api/ai/keys/${key.id}/verify`, {}); return "Chave e modelo validados."; }));
    button("Excluir", () => {
      if (busy) return;
      const last = config.aiRotationEnabled && key.enabled && config.aiKeys.filter(item => item.enabled).length === 1;
      if (!confirm(`Excluir “${key.label}” da lista de prioridade? O segredo deste cadastro será removido. Isso não revoga a chave no site do provedor.${last ? " Esta é a última chave ativa: o atendimento com IA ficará sem uma chave disponível nesta lista." : ""}`)) return;
      const deletingRevision = config.aiKeysRevision;
      run(async () => {
        await api(`/api/ai/keys/${key.id}/remove`, { revision: deletingRevision });
        if (editing?.id === key.id) { editing = null; $("#ai-key-secret").value = ""; $("#ai-key-editor").hidden = true; }
        return "Chave excluída da lista de prioridade.";
      });
    });
    menuItems.lastElementChild.classList.add("ai-key-delete");
    if (waiting) button("Liberar nova tentativa", () => run(async () => { await api(`/api/ai/keys/${key.id}/reset`, {}); return "Chave liberada para uma nova tentativa. A cota depende do provedor."; }));
    actions.append(menu);
    const priority=el("div","ai-key-priority");priority.append(order,handle);
    row.append(priority, content, statusArea, actions); list.append(row);
  });
}
export async function initAiKeys(options) {
  textProviders = options.providers; audioProviders = await options.api("/api/ai/providers?scope=audio"); providers = textProviders; changed = options.changed;
  api = (path, data) => options.api(path + (path.includes("?") ? "&" : "?") + "scope=" + scope, data);
  const section = $("#provider-settings"), content = el("div");
  section.querySelector('.settings-section-heading').after($('#ai-key-editor')); content.id = "ai-purpose-content"; content.setAttribute("role", "tabpanel"); content.append(...section.childNodes);
  purposeTabs = el("div", "ai-purpose-tabs"); purposeTabs.setAttribute("role", "tablist"); purposeTabs.setAttribute("aria-label", "Finalidade da IA");
  for (const [value, title] of [["text", "Textos"], ["audio", "Áudios"]]) {
    const button = el("button", "");
    button.append(el('strong', '', title === 'Textos' ? 'Respostas em texto' : 'Transcrição de áudios'), el('span', '', value === 'text' ? 'IA que conversa com seus clientes' : 'IA que transforma voz em texto'));
    button.type = "button"; button.id = "ai-purpose-" + value; button.dataset.scope = value; button.setAttribute("role", "tab"); button.setAttribute("aria-controls", content.id); button.setAttribute("aria-selected", String(value === scope)); button.tabIndex = value === scope ? 0 : -1;
    button.addEventListener("click", () => {
      if (busy || sorting || value === scope) return;
      if (!$("#ai-key-editor").hidden) { status("Salve ou cancele a edição antes de trocar de lista.", true); return; }
      scope = value; providers = scope === "audio" ? audioProviders : textProviders; signature = "";
      $("#ai-key-provider").replaceChildren(...Object.entries(providers).map(([id, info]) => new Option(info.name, id)));
      status(""); renderAiKeys(rootSettings);
    });
    button.addEventListener("keydown", event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const target = event.key === "Home" ? 0 : event.key === "End" ? 1 : value === "text" ? 1 : 0; const next = purposeTabs.children[target]; next.click(); if (scope === next.dataset.scope) next.focus(); } });
    purposeTabs.append(button);
  }
  section.append(purposeTabs, content);
  installAiKeyReorder($('#ai-key-list'), {
    canStart: () => !busy && $('#ai-key-editor').hidden,
    start: () => { sorting = true; },
    announce: message => status(message),
    async finish(order, id, refocus) {
      sorting = false; signature = '';
      if (order) await run(async () => {
        await api('/api/ai/rotation', { enabled: config.aiRotationEnabled, order, revision: config.aiKeysRevision });
        return 'Ordem de prioridade salva.';
      });
      else renderAiKeys(rootSettings);
      if (refocus) [...$('#ai-key-list').querySelectorAll('.ai-key-row')].find(row => row.dataset.keyId === id)?.querySelector('.ai-key-drag').focus({ preventScroll: true });
    },
  });
  document.addEventListener('click', event => { document.querySelectorAll('.ai-key-menu[open]').forEach(menu => { if(!menu.contains(event.target))menu.open=false; }); });
  document.addEventListener('keydown', event => { if(event.key==='Escape')document.querySelectorAll('.ai-key-menu[open]').forEach(menu=>{menu.open=false;menu.querySelector('summary').focus();}); });
  const modelHelp = el('p', 'hint'); modelHelp.id = 'ai-key-model-help'; $('#ai-key-model').after(modelHelp); $('#ai-key-model').setAttribute('aria-describedby', modelHelp.id);
  const notesLabel = el('label', '', 'Observação (opcional)'); notesLabel.htmlFor = 'ai-key-notes';
  const notesInput = el('textarea'); notesInput.id = 'ai-key-notes'; notesInput.rows = 3; notesInput.maxLength = 500; notesInput.placeholder = 'Ex.: maior porte, contexto de 1M, modelo gratuito para testes.';
  modelHelp.after(notesLabel, notesInput);
  const routerWarning = el('p', 'privacy-field-note', 'Modelos gratuitos têm cotas e condições próprias. No Nemotron gratuito, use somente dados fictícios: o endpoint registra conteúdo e pede que não sejam enviados dados pessoais ou confidenciais. ');
  routerWarning.id = 'openrouter-privacy-warning'; routerWarning.hidden = true;
  const routerTerms = el('a', '', 'Ver condições do Nemotron'); routerTerms.href = 'https://openrouter.ai/nvidia/nemotron-3-ultra-550b-a55b:free'; routerTerms.target = '_blank'; routerTerms.rel = 'noreferrer'; routerWarning.append(routerTerms); modelHelp.after(routerWarning);
  $('#ai-key-model').setAttribute('aria-describedby', `${modelHelp.id} ${routerWarning.id}`);
  $('#ai-key-model').addEventListener('input', providerInfo);
  $("#ai-key-provider").replaceChildren(...Object.entries(providers).map(([id, info]) => new Option(info.name, id)));
  $("#ai-rotation-enabled").addEventListener("change", event => {
    const enabled = event.target.checked;
    run(async () => { await api("/api/ai/rotation", { enabled, revision: config.aiKeysRevision }); return enabled ? "Troca automática ativada." : "Troca automática desativada. A primeira chave ativa será utilizada."; });
  });
  $("#add-ai-key").addEventListener("click", () => edit());
  $("#ai-key-cancel").addEventListener("click", () => {
    if (busy) return;
    $("#ai-key-editor").hidden = true;
    $("#ai-key-secret").value = "";
    (editorOpener?.isConnected ? editorOpener : $("#add-ai-key")).focus();
  });
  $("#ai-key-provider").addEventListener("change", () => { $("#ai-key-secret").value = ""; $("#ai-key-model").value = providers[$("#ai-key-provider").value].defaultModel || ""; providerInfo(); });
  $("#ai-key-form").addEventListener("submit", event => {
    event.preventDefault();
    const modelInput = $('#ai-key-model');
    modelInput.value = modelInput.value.trim();
    if ($('#ai-key-provider').value === 'gemini') {
      modelInput.value = modelInput.value.replace(/^models\//, '');
      if (!/^gemini-[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(modelInput.value)) {
        modelInput.setCustomValidity('Use o ID completo, por exemplo ' + providers.gemini.defaultModel + '.');
        modelInput.setAttribute('aria-invalid', 'true'); modelInput.reportValidity(); return;
      }
    }
    run(async () => {
      await api(editing ? `/api/ai/keys/${editing.id}` : "/api/ai/keys", { label: $("#ai-key-label").value, notes: $("#ai-key-notes").value, provider: $("#ai-key-provider").value, model: $("#ai-key-model").value, apiKey: $("#ai-key-secret").value, enabled: $("#ai-key-enabled").checked, revision });
      $("#ai-key-secret").value = ""; $("#ai-key-editor").hidden = true; return "Chave salva na lista. Segure e arraste a alça para definir a prioridade.";
    });
  });
}
