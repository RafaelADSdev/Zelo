const $ = selector => document.querySelector(selector);
const el = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
const icon = path => { const span = el("span", "ai-button-icon"); span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`; return span; };
let config, providers, api, changed, busy = false, editing, revision, signature = "";
const when = time => new Date(time).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
function status(text, failure = false) { $("#ai-keys-status").textContent = text; $("#ai-keys-status").classList.toggle("catalog-error", failure); }
async function run(task) {
  if (busy) return; busy = true; $("#ai-key-list").inert = true; $("#add-ai-key").disabled = true; $("#ai-rotation-enabled").disabled = true; status("Salvando…");
  try { status(await task() || "Salvo."); await changed(); }
  catch (error) { status(error.message, true); await changed().catch(() => {}); }
  finally { busy = false; $("#ai-key-list").inert = false; $("#add-ai-key").disabled = false; $("#ai-rotation-enabled").disabled = false; }
}
function edit(key = null) {
  if (busy) return;
  editing = key; revision = config.aiKeysRevision;
  $("#ai-key-form").reset(); $("#ai-key-editor").hidden = false;
  $("#ai-key-title").textContent = key ? `Editar ${key.label}` : "Adicionar chave";
  $("#ai-key-label").value = key?.label || ""; $("#ai-key-provider").value = key?.provider || "gemini";
  $("#ai-key-model").value = key?.model || providers[$('#ai-key-provider').value].defaultModel || ""; $("#ai-key-enabled").checked = key?.enabled ?? true;
  $("#ai-key-secret").placeholder = key ? "Deixe vazio para manter esta chave" : "Cole a chave de API";
  $("#ai-key-secret").required = !key; providerInfo(); $("#ai-key-label").focus();
}
function providerInfo() {
  const id = $("#ai-key-provider").value, info = providers[id];
  $("#ai-key-model").placeholder = info.example; $("#ai-key-console").href = info.console;
  $('#ai-key-model-help').textContent = id === 'gemini' ? `Use o ID completo, por exemplo ${info.example}. “Gemini” sozinho é o nome do provedor. A disponibilidade depende da sua conta Google.` : `Informe o ID exato do modelo disponível na sua conta. ${info.defaultModel ? 'Sugestão: ' + info.defaultModel + '.' : info.example + '.'}`;
  $('#ai-key-model').setCustomValidity(''); $('#ai-key-model').removeAttribute('aria-invalid');
  $("#ai-key-secret").required = !editing || editing.provider !== id;
}
export function renderAiKeys(settings) {
  config = settings;
  $("#ai-rotation-enabled").checked = config.aiRotationEnabled;
  const latest = config.aiLastUsed;
  $("#ai-rotation-summary").textContent = config.aiRotationEnabled
    ? `Troca automática ativada. ${latest ? `Última resposta: ${latest.label} · ${providers[latest.provider].name} · ${when(latest.at)}.` : "A primeira chave ativa e liberada será utilizada."}`
    : "Troca automática desativada. Apenas a primeira chave ativa da lista será utilizada.";
  const nextSignature = JSON.stringify([config.aiKeys, config.aiKeysRevision, config.aiKeys.map(key => key.cooldownUntil > Date.now())]);
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
    const logo = el('img'); logo.src = `/brand/providers/${key.provider}.svg`; logo.alt = ''; logo.width = 26; logo.height = 26; provider.append(logo);
    title.append(el('strong','',key.label),el('span','ai-key-provider-name',providers[key.provider].name.split(' · ')[0])); identity.append(provider,title);
    content.append(identity,el('code','ai-model-name',key.model));
    const waiting = key.cooldownUntil > Date.now(), state = !key.enabled ? 'paused' : waiting ? 'waiting' : key.lastError ? 'error' : key.validatedAt ? 'validated' : 'unverified';
    const stateText = {paused:'Pausada',waiting:'Em espera',error:'Atenção',validated:'Validada',unverified:'Não validada'}[state];
    const statusArea = el('div','ai-key-state'); statusArea.append(el('span','ai-status ai-status-'+state,stateText));
    if(index === ready) statusArea.append(el('span','ai-next-label','Próxima a usar'));
    if(key.validatedAt || waiting) statusArea.title = waiting ? `Nova tentativa a partir de ${when(key.cooldownUntil)}` : `Validada em ${when(key.validatedAt)}`;
    if(key.lastError) { const detail=el('details','ai-key-error'); detail.append(el('summary','','Ver aviso'),el('p','',key.lastError)); content.append(detail); }
    const actions = el("div", "ai-key-actions"), menu=el('details','ai-key-menu'), summary=el('summary',''); summary.setAttribute('aria-label',`Mais ações para ${key.label}`); summary.title='Mais ações'; summary.append(icon('M5 12h.01M12 12h.01M19 12h.01')); menu.append(summary);
    const menuItems=el('div','ai-action-menu');menu.append(menuItems);
    const button = (label, task, disabled = false, destination = menuItems, glyph) => { const btn = el("button", destination === menuItems ? "ai-menu-action" : "secondary-button", glyph ? undefined : label); btn.type = "button"; btn.disabled = disabled; btn.setAttribute('aria-label',`${label} · ${key.label}`); btn.title=label; if(glyph)btn.append(icon(glyph));btn.addEventListener("click", () => { if(busy)return; menu.open=false;task(); }); destination.append(btn); return btn; };
    const move = direction => run(async () => {
      const order = config.aiKeys.map(item => item.id), target = index + direction;
      [order[index], order[target]] = [order[target], order[index]];
      await api("/api/ai/rotation", { enabled: config.aiRotationEnabled, order, revision: config.aiKeysRevision }); return "Ordem de prioridade salva.";
    });
    const movers=el("div","ai-key-movers");
    button("Subir prioridade", () => move(-1), index === 0, movers, "m6 15 6-6 6 6"); button("Descer prioridade", () => move(1), index === config.aiKeys.length - 1, movers, "m6 9 6 6 6-6");
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
    const priority=el("div","ai-key-priority");priority.append(order,movers);
    row.append(priority, content, statusArea, actions); list.append(row);
  });
}
export function initAiKeys(options) {
  ({ providers, api, changed } = options);
  document.addEventListener('click', event => { document.querySelectorAll('.ai-key-menu[open]').forEach(menu => { if(!menu.contains(event.target))menu.open=false; }); });
  document.addEventListener('keydown', event => { if(event.key==='Escape')document.querySelectorAll('.ai-key-menu[open]').forEach(menu=>{menu.open=false;menu.querySelector('summary').focus();}); });
  const modelHelp = el('p', 'hint'); modelHelp.id = 'ai-key-model-help'; $('#ai-key-model').after(modelHelp); $('#ai-key-model').setAttribute('aria-describedby', modelHelp.id);
  $('#ai-key-model').addEventListener('input', () => { $('#ai-key-model').setCustomValidity(''); $('#ai-key-model').removeAttribute('aria-invalid'); });
  $("#ai-key-provider").replaceChildren(...Object.entries(providers).map(([id, info]) => new Option(info.name, id)));
  $("#ai-rotation-enabled").addEventListener("change", event => {
    const enabled = event.target.checked;
    run(async () => { await api("/api/ai/rotation", { enabled, revision: config.aiKeysRevision }); return enabled ? "Troca automática ativada." : "Troca automática desativada. A primeira chave ativa será utilizada."; });
  });
  $("#add-ai-key").addEventListener("click", () => edit());
  $("#ai-key-cancel").addEventListener("click", () => { if (!busy) { $("#ai-key-editor").hidden = true; $("#ai-key-secret").value = ""; } });
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
      await api(editing ? `/api/ai/keys/${editing.id}` : "/api/ai/keys", { label: $("#ai-key-label").value, provider: $("#ai-key-provider").value, model: $("#ai-key-model").value, apiKey: $("#ai-key-secret").value, enabled: $("#ai-key-enabled").checked, revision });
      $("#ai-key-secret").value = ""; $("#ai-key-editor").hidden = true; return "Chave salva na lista. Use Subir e Descer para definir a prioridade.";
    });
  });
}
