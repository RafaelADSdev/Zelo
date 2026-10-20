const $ = selector => document.querySelector(selector);
const el = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
let config, providers, api, changed, busy = false, editing, revision, signature = "";
const when = time => new Date(time).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
function status(text, failure = false) { $("#ai-keys-status").textContent = text; $("#ai-keys-status").classList.toggle("catalog-error", failure); }
async function run(task) {
  if (busy) return; busy = true; status("Salvando…");
  try { status(await task() || "Salvo."); await changed(); }
  catch (error) { status(error.message, true); await changed().catch(() => {}); }
  finally { busy = false; }
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
  const nextSignature = JSON.stringify([config.aiKeys, config.aiKeysRevision]);
  if (nextSignature === signature) return; signature = nextSignature;
  const list = $("#ai-key-list"); list.replaceChildren();
  if (!config.aiKeys.length) list.append(el("p", "hint", "Adicione as chaves e coloque-as na ordem em que o assistente deve usá-las."));
  config.aiKeys.forEach((key, index) => {
    const row = el("article", "ai-key-row"), order = el("div", "ai-key-position", String(index + 1)), content = el("div", "ai-key-content");
    content.append(el("strong", "", key.label), el("p", "hint", `${providers[key.provider].name} · ${key.model}`));
    const waiting = key.cooldownUntil > Date.now();
    content.append(el("p", "hint", !key.enabled ? "Pausada por você" : waiting ? `Limite atingido · nova tentativa a partir de ${when(key.cooldownUntil)}` : key.validatedAt ? `Disponível · validada em ${when(key.validatedAt)}` : "Disponível · ainda não validada"));
    if (key.lastError) content.append(el("p", "hint catalog-error", key.lastError));
    const actions = el("div", "ai-key-actions");
    const button = (label, task, disabled = false) => { const btn = el("button", "secondary-button", label); btn.type = "button"; btn.disabled = disabled; btn.addEventListener("click", task); actions.append(btn); };
    const move = direction => run(async () => {
      const order = config.aiKeys.map(item => item.id), target = index + direction;
      [order[index], order[target]] = [order[target], order[index]];
      await api("/api/ai/rotation", { enabled: config.aiRotationEnabled, order, revision: config.aiKeysRevision }); return "Ordem de prioridade salva.";
    });
    button("↑ Subir", () => move(-1), index === 0); button("↓ Descer", () => move(1), index === config.aiKeys.length - 1);
    button("Editar", () => edit(key));
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
    actions.lastElementChild.classList.add("ai-key-delete");
    if (waiting) button("Liberar nova tentativa", () => run(async () => { await api(`/api/ai/keys/${key.id}/reset`, {}); return "Chave liberada para uma nova tentativa. A cota depende do provedor."; }));
    row.append(order, content, actions); list.append(row);
  });
}
export function initAiKeys(options) {
  ({ providers, api, changed } = options);
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
