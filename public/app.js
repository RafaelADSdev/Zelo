import { initSettingsUi, syncConnectionMode, renderConnectionPresentation } from "/settings-ui.js";
import { initWorkspace } from "/workspace.js";
import { initReplySchedule, renderReplySchedule } from "/reply-schedule.js";
import { initCatalog, refreshCatalog } from "/catalog.js";
import { initAiKeys, renderAiKeys } from "/ai-keys.js";
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let workspace, dashboard, view = "knowledge", currentPhone = "", waBusy = false, pollBusy = false;
let lastContacts = "", lastWaHistory = "", templates = [], sendIntent;
let providers = {};
const activeAi = () => dashboard?.settings.aiRotationEnabled ? dashboard.settings.aiLastUsed || dashboard.settings.aiKeys.find(key => key.enabled && key.cooldownUntil <= Date.now()) || {} : dashboard?.settings.aiListOnly ? dashboard.settings.aiKeys.find(key => key.enabled) || {} : { provider: dashboard?.settings.aiProvider, model: dashboard?.settings.model };
const aiName = () => providers[activeAi().provider]?.name || "Lista de IAs";
const date = value => value ? new Date(Number(value)).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Ainda não";
const labels = { pending: "Na fila", requested: "Na fila do operador", processing: "Processando", done: "Respondida", failed: "Falhou", manual: "Atendimento manual", unknown: "Envio sem confirmação", sending: "Enviando", sent: "Envio aceito", delivered: "Entregue", read: "Lida" };
function node(tag, className, text) { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; }
async function api(path, data) {
  const response = await fetch(path, { ...(data === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), signal: AbortSignal.timeout(path === "/api/tunnel/start" ? 190000 : 60000) });
  if (response.status === 401) { location.replace("/login"); throw new Error("Sua sessão terminou. Entre novamente."); }
  const result = await response.json(); if (!response.ok) throw new Error(result.error || "Não foi possível concluir."); return result;
}
function error(message = "") { $("#global-error").textContent = message; $("#global-error").hidden = !message; }
function messageBox(container, role, text, at, status) {
  const item = node("article", `message ${role === "user" ? "user" : "agent"}`);
  item.append(node("div", "message-label", role === "user" ? (container.id === "wa-messages" ? "Contato" : "Você") : dashboard?.settings.assistantName || "Assistente"), node("div", "bubble", text || "[Mensagem sem texto]"));
  if (at || status) item.append(node("div", "message-time", [date(at), labels[status] || status].filter(Boolean).join(" · ")));
  container.append(item);
}
function fillSettings(scope) {
  const config = dashboard.settings;
  for (const input of $$(scope ? `#settings-${scope}-panel [name]` : "#settings-form [name]")) {
    if (["apiKey", "accessToken", "appSecret"].includes(input.name)) { input.value = ""; input.placeholder = config[input.name + "Configured"] ? "Salvo no servidor · deixe vazio para manter" : "Ainda não configurado"; }
    else if (input.type === "checkbox") input.checked = config[input.name];
    else input.value = config[input.name] || "";
  }
  updateCallback();
  connectionFields();
  renderConnectionPresentation(dashboard.qr, config);
}
function connectionFields() {
  syncConnectionMode($("#whatsappMode").value);
  const qr = $("#whatsappMode").value === "qr";
  $("#qr-section").hidden = !qr;
  $$(".cloud-only").forEach(section => { section.hidden = qr; });
}
function renderQr() {
  const state = dashboard.qr;
  const names = { disconnected: "Desconectado", connecting: "Conectando ao WhatsApp…", qr: "QR pronto. Escaneie com o WhatsApp do celular.", connected: "WhatsApp conectado", reconnecting: "Reconectando ao WhatsApp…", expired: "Código expirado. Gere outro QR Code." };
  $("#qr-status").textContent = state.error || `${names[state.status] || state.status}${state.status === "connected" ? " · " + state.account.split("@")[0] : ""}`;
  const fresh = state.qr && state.expiresAt > Date.now();
  $("#qr-image").hidden = !fresh; $("#qr-placeholder").hidden = Boolean(fresh);
  if (fresh) { if ($("#qr-image").src !== state.qr) $("#qr-image").src = state.qr; }
  else { $("#qr-image").removeAttribute("src"); $("#qr-placeholder-text").textContent = state.status === "connected" ? "WhatsApp conectado" : state.status === "disconnected" ? "Pronto para conectar" : names[state.status] || "Gere seu QR Code"; }
}
function updateCallback() { const base = $("#publicUrl").value.trim().replace(/\/$/, "").replace(/\/webhook$/, ""); $("#callback-url").value = base ? base + "/webhook" : "Gere ou preencha uma URL pública HTTPS"; }
function renderDashboard() {
  renderReplySchedule(dashboard);
  $(".local-pill").textContent = dashboard.storageProvider === "supabase" ? "Dados no Supabase" : "Painel local";
  const config = dashboard.settings;
  const qrMode = config.whatsappMode === "qr";
  renderAiKeys(config);
  renderQr();
  renderConnectionPresentation(dashboard.qr, config);
  $("#assistant-name").textContent = config.assistantName;
  $("#gemini-status").textContent = config.aiRotationEnabled ? "Ordem automática" : config.aiValidatedAt ? "Validado" : config.apiKeyConfigured ? "Configurado" : "Não configurado";
  $("#ai-provider-name").textContent = aiName();
  $("#whatsapp-status").textContent = config.validatedAt ? "Número validado" : config.whatsappConfigured ? "Validar credenciais" : "Não configurado";
  $("#webhook-status").textContent = config.lastWebhookAt ? "Eventos recebidos" : config.webhookVerifiedAt ? "Verificado" : "Aguardando";
  $("#connection-summary").textContent = !config.apiKeyConfigured ? "Configure a IA e a conexão do WhatsApp em Conexões." : !config.whatsappConfigured ? "IA configurada. Adicione suas credenciais do WhatsApp em Conexões para receber e responder mensagens reais." : !config.lastWebhookAt ? "WhatsApp configurado. Valide o número, configure o webhook na Meta e envie uma mensagem para iniciar o atendimento." : `Último evento do WhatsApp: ${date(config.lastWebhookAt)}. Respostas automáticas ${dashboard.replyStatus.active ? "ativadas" : "pausadas"}.`;
  $("#meta-result").textContent = config.phone ? `Número validado: ${config.phone.number} · ${config.phone.name}. ${config.subscribedAt ? "Aplicativo inscrito na WABA." : "Inscreva o aplicativo na WABA."}` : "Número ainda não validado na Meta.";
  $("#webhook-result").textContent = `Verificação do webhook: ${date(config.webhookVerifiedAt)}. Último evento: ${date(config.lastWebhookAt)}. Receptor local na porta ${dashboard.webhookPort}.`;
  $("#tunnel-result").textContent = dashboard.tunnel.running ? `Túnel ativo: ${dashboard.tunnel.url}. A URL muda ao reiniciar o túnel; para uso contínuo, use um endereço HTTPS estável.` : dashboard.tunnel.error || "O túnel temporário será baixado do repositório oficial da Cloudflare quando você solicitar.";
  if (qrMode) {
    $("#whatsapp-status").textContent = dashboard.qr.status === "connected" ? "Conectado por QR" : "Aguardando vinculação";
    $("#webhook-status").textContent = "Dispensado no QR";
    $("#connection-summary").textContent = dashboard.qr.status === "connected" ? `WhatsApp conectado. Respostas automáticas ${dashboard.replyStatus.active ? "ativadas" : "pausadas"}.` : "Abra Conexões, gere o QR Code e escaneie em WhatsApp → Aparelhos conectados → Conectar aparelho.";
    $("#wa-kind").value = "text"; $("#wa-kind").disabled = true; $("#text-fields").hidden = false; $("#template-fields").hidden = true;
  } else $("#wa-kind").disabled = false;
  $("#wa-kind option[value='text']").textContent = qrMode ? "Texto pelo WhatsApp vinculado" : "Texto · dentro da janela de 24 horas";
  const signature = JSON.stringify(dashboard.conversations);
  if (signature !== lastContacts) {
    lastContacts = signature; const contacts = $("#contacts"); contacts.replaceChildren();
    if (!dashboard.conversations.length) contacts.append(node("p", "hint", "Nenhum contato recebido ou envio realizado. Conecte o WhatsApp e envie uma mensagem para ele usando outro celular."));
    dashboard.conversations.forEach(contact => {
      const button = node("button", "contact-button", ""); button.type = "button"; button.dataset.initial = contact.name.trim().slice(0, 1).toLocaleUpperCase("pt-BR"); button.setAttribute("aria-pressed", String(currentPhone === contact.phone));
      button.append(node("strong", "", contact.name), node("small", "", contact.phone), node("p", "", contact.last_text || "Sem mensagem de texto"));
      button.addEventListener("click", async () => { currentPhone = contact.phone; document.querySelectorAll("#contacts .contact-button").forEach(item => item.setAttribute("aria-pressed", String(item === button))); $("#wa-to").value = currentPhone; lastWaHistory = ""; try { await loadConversation(); } catch (failure) { error(failure.message); } }); contacts.append(button);
    });
  }
  filterContacts();
  const jobs = $("#jobs"); jobs.replaceChildren();
  const attention = dashboard.jobs.filter(job => job.state !== "done");
  $("#activity-count").textContent = attention.length ? attention.length + " para revisar" : "Tudo em dia";
  if (!attention.length) jobs.append(node("p", "hint", "Nenhuma mensagem pendente ou com falha."));
  attention.forEach(job => {
    const row = node("div", "job-row"); row.append(node("div", "", `${job.phone} · ${labels[job.state] || job.state}${job.error ? " · " + job.error : ""}`));
    if (["failed", "manual"].includes(job.state)) {
      const retry = node("button", "secondary-button", "Tentar responder"); retry.type = "button";
      retry.addEventListener("click", () => action(retry, "#wa-send-status", async () => { await api("/api/whatsapp/retry", { id: job.id }); await loadDashboard(); return "Mensagem recolocada na fila."; })); row.append(retry);
    }
    jobs.append(row);
  });
  dashboard.outbox.forEach(item => jobs.append(node("p", "hint", `${item.phone} · ${labels[item.state]} · ${item.error || ""}`)));
  const events = $("#events"); events.replaceChildren(); dashboard.events.slice(0, 10).forEach(item => events.append(node("p", "event-row", `${date(item.at)} · ${item.detail}`)));
}
async function loadDashboard(refreshForm = false) { dashboard = await api("/api/dashboard"); renderDashboard(); if (refreshForm) fillSettings(); }
async function loadConversation() {
  if (!currentPhone) return;
  const result = await api("/api/conversation?phone=" + encodeURIComponent(currentPhone));
  const signature = JSON.stringify(result); if (signature === lastWaHistory) return; lastWaHistory = signature;
  const contact = dashboard.conversations.find(item => item.phone === currentPhone);
  $("#wa-contact").textContent = contact?.name || currentPhone;
  $("#wa-window").textContent = dashboard.settings.whatsappMode === "qr" ? "Conversa pelo WhatsApp vinculado por QR Code." : contact?.last_inbound && Date.now() - Number(contact.last_inbound) < 86400000 ? "Janela de 24 horas aberta para texto livre." : "Envie um template aprovado ou aguarde uma mensagem do contato.";
  const container = $("#wa-messages"); container.replaceChildren();
  result.history.forEach(turn => {
    const outgoing = result.outbound.find(item => item.id === turn.id || item.id === "auto:" + turn.id.replace(/:reply$/, ""));
    messageBox(container, turn.role, turn.text, turn.timestamp, outgoing?.deliveryStatus || outgoing?.state);
  });
  result.outbound.filter(item => !result.history.some(turn => turn.id === item.id || item.id === "auto:" + turn.id.replace(/:reply$/, ""))).forEach(item => messageBox(container, "agent", item.text, item.created, item.deliveryStatus || item.state));
  if (!container.children.length) container.append(node("p", "hint", "Ainda não há mensagens nesta conversa.")); container.scrollTop = container.scrollHeight;
}
function updatePage(next) {
  const pages = { knowledge: ["Produtos e materiais", "Tudo que sua IA precisa saber, organizado em um só lugar.", "Base de conhecimento"], whatsapp: ["Conversas", "Acompanhe seus contatos e continue o atendimento pelo WhatsApp.", "Caixa de entrada"], access: ["Gestão de acessos", "Gerencie as contas autorizadas a usar o Zelo.", "Admin master"], settings: ["Conexões e IA", "Suas IAs, seu WhatsApp e o jeito de atender.", "Configurações"] };
  const [title, description, badge] = pages[next];
  $("#page-title").textContent = title; $("#page-description").textContent = description; $("#page-breadcrumb").textContent = next === "settings" ? "Conexões e IA" : title;
  $(".mode-badge").textContent = badge;
  document.querySelectorAll(".nav-button[data-view]").forEach(button => { button.classList.toggle("active", button.dataset.view === next); if (button.dataset.view === next) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current"); });
}
function filterContacts() {
  const query = $("#contact-search").value.toLocaleLowerCase("pt-BR");
  document.querySelectorAll("#contacts .contact-button").forEach(button => button.hidden = !button.textContent.toLocaleLowerCase("pt-BR").includes(query));
}
$("#contact-search").addEventListener("input", filterContacts);
async function showView(next) {
  if (next === "access" && !workspace?.isMaster) return;
  updatePage(next);
  view = next; $$(".view").forEach(item => { item.hidden = item.id !== "view-" + next; });
  document.querySelectorAll(".nav-button[data-view]").forEach(item => item.classList.toggle("active", item.dataset.view === next)); error();
  history.replaceState(null, "", next === "access" ? "/admin/access" : "/");
  $(".reply-control").hidden = next === "access";
  $(".connection-notice").hidden = ["access", "settings"].includes(next);
  try { if (next === "settings") await loadDashboard(true); if (next === "knowledge") await refreshCatalog(); if (next === "whatsapp") { await loadDashboard(); await loadConversation(); } } catch (failure) { error(failure.message); }
}
$$('[data-view]').forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
async function action(button, statusSelector, task) {
  button.disabled = true; error(); $(statusSelector).textContent = "Aguarde…";
  try { $(statusSelector).textContent = await task() || "Concluído."; } catch (failure) { $(statusSelector).textContent = failure.message; error(failure.message); } finally { button.disabled = false; }
}
async function saveSettings(scope = 'whatsapp') {
  const fields = $$(`#settings-${scope}-panel [name]`).filter(field => field.id === 'whatsappMode' || !field.closest('[hidden]'));
  for (const field of fields) if (!field.reportValidity()) throw new Error('Confira os campos desta seção.');
  const input = {}; fields.forEach(field => { input[field.name] = field.type === 'checkbox' ? field.checked : field.value; });
  await api('/api/settings', input); await loadDashboard(); fillSettings(scope);
}
$('#settings-form').addEventListener('submit', event => {
  event.preventDefault(); const assistant = !$('#settings-assistant-panel').hidden;
  action($(assistant ? '#save-global-instructions' : '#save-settings'), assistant ? '#global-instructions-status' : '#settings-status', async () => { await saveSettings(assistant ? 'assistant' : 'whatsapp'); return 'Configurações salvas.'; });
});
$("#whatsappMode").addEventListener("change", () => { connectionFields(); renderConnectionPresentation(dashboard.qr, dashboard.settings); });
$("#qr-connect").addEventListener("click", event => action(event.currentTarget, "#settings-status", async () => { await saveSettings(); await api("/api/qr/connect", {}); await loadDashboard(); return "Aguarde o QR e escaneie pelo celular. O código é atualizado automaticamente."; }));
$("#qr-disconnect").addEventListener("click", event => action(event.currentTarget, "#settings-status", async () => { await api("/api/qr/disconnect", {}); await loadDashboard(); return "Conexão pausada. A sessão foi mantida para reconectar."; }));
$("#qr-logout").addEventListener("click", event => action(event.currentTarget, "#settings-status", async () => { await api("/api/qr/logout", {}); await loadDashboard(); return "Sessão local apagada. Se ainda aparecer no celular, remova-a em Aparelhos conectados."; }));
$("#save-global-instructions").addEventListener("click", event => action(event.currentTarget, "#global-instructions-status", async () => { await saveSettings("assistant"); return "Nome e instruções globais salvos para todas as IAs."; }));
$("#verify-whatsapp").addEventListener("click", event => action(event.currentTarget, "#settings-status", async () => { await saveSettings(); await api("/api/whatsapp/verify", {}); await loadDashboard(); return "Número e credenciais validados na Meta."; }));
$("#subscribe-whatsapp").addEventListener("click", event => action(event.currentTarget, "#settings-status", async () => { await saveSettings(); await api("/api/whatsapp/subscribe", {}); await loadDashboard(); return "Aplicativo inscrito na conta WhatsApp Business. Assine também o campo messages no painel Meta."; }));
$("#start-tunnel").addEventListener("click", event => action(event.currentTarget, "#settings-status", async () => {
  await saveSettings(); $("#settings-status").textContent = "Preparando cloudflared oficial e iniciando o túnel. Isso pode levar alguns minutos…";
  await api("/api/tunnel/start", {}); await loadDashboard(true); return "URL pública pronta. Copie o callback e o token para a Meta.";
}));
$("#stop-tunnel").addEventListener("click", event => action(event.currentTarget, "#settings-status", async () => { await api("/api/tunnel/stop", {}); await loadDashboard(); return "Túnel encerrado."; }));
$("#publicUrl").addEventListener("input", updateCallback);
$("#copy-token").addEventListener("click", event => action(event.currentTarget, "#settings-status", async () => { await navigator.clipboard.writeText($("#verifyToken").value); return "Token copiado. Cole no campo de verificação do webhook na Meta."; }));
$("#knowledge-form").addEventListener("submit", event => { event.preventDefault(); action(event.submitter, "#knowledge-status", async () => { await api("/api/knowledge", { text: $("#knowledge").value }); return "Informações salvas. As próximas respostas consultarão esta base."; }); });
$("#refresh-inbox").addEventListener("click", async () => { try { await loadDashboard(); await loadConversation(); } catch (failure) { error(failure.message); } });
$("#wa-kind").addEventListener("change", () => { $("#text-fields").hidden = $("#wa-kind").value !== "text"; $("#template-fields").hidden = $("#wa-kind").value !== "template"; });
$("#load-templates").addEventListener("click", event => action(event.currentTarget, "#wa-send-status", async () => {
  templates = (await api("/api/templates")).templates; const select = $("#approved-template"); select.replaceChildren(new Option("Selecione um template", ""));
  templates.forEach((template, index) => select.append(new Option(`${template.name} · ${template.language}`, String(index)))); return `${templates.length} template(s) aprovado(s) encontrado(s).`;
}));
$("#approved-template").addEventListener("change", () => {
  if ($("#approved-template").value === "") return; const template = templates[Number($("#approved-template").value)];
  $("#template-name").value = template.name; $("#template-language").value = template.language;
  $("#template-preview").textContent = template.components?.map(component => component.text || component.type).join("\n") || "";
});
$("#wa-send-form").addEventListener("submit", async event => {
  event.preventDefault(); if (waBusy) return;
  let input;
  try {
    input = { phone: $("#wa-to").value.trim() };
    if ($("#wa-kind").value === "template") {
      let components = [];
      if ($("#template-components").value.trim()) components = JSON.parse($("#template-components").value);
      else if ($("#template-params").value.trim()) components = [{ type: "body", parameters: $("#template-params").value.split("\n").filter(line => line.trim()).map(line => { const match = line.match(/^([a-zA-Z_][\w]*)=(.*)$/); return match ? { type: "text", parameter_name: match[1], text: match[2] } : { type: "text", text: line }; }) }];
      input.template = { name: $("#template-name").value.trim(), language: { code: $("#template-language").value.trim() }, components };
    } else input.text = $("#wa-text").value.trim();
  } catch { error("O JSON dos componentes do template é inválido."); return; }
  const intent = JSON.stringify(input); if (!sendIntent || sendIntent.intent !== intent) sendIntent = { intent, requestId: crypto.randomUUID() };
  input.requestId = sendIntent.requestId; waBusy = true;
  await action($("#wa-send"), "#wa-send-status", async () => {
    const result = await api("/api/whatsapp/send", input); sendIntent = null; currentPhone = input.phone;
    await loadDashboard(); lastWaHistory = ""; await loadConversation(); $("#wa-text").value = "";
    return `Enviada ao WhatsApp. ID: ${result.messageId}. Aguarde o status de entrega.`;
  }); waBusy = false;
});
try {
  providers = await api("/api/ai/providers");
  initSettingsUi();
  initReplySchedule({ api, changed: () => loadDashboard() });
  initAiKeys({ providers, api, changed: () => loadDashboard() });
  await loadDashboard(true); $("#knowledge").value = (await api("/api/state")).knowledge;
  await initCatalog();
  workspace = await initWorkspace({ api });
  if (location.pathname === "/admin/access") await showView("access");
  updatePage(view);
} catch (failure) { error("Não foi possível carregar o painel. " + failure.message); }
setInterval(async () => {
  if (pollBusy || document.hidden) return; pollBusy = true;
  try { await loadDashboard(); if (view === "whatsapp") await loadConversation(); } catch {} finally { pollBusy = false; }
}, 5000);

$("#logout").addEventListener("click", async event => { event.currentTarget.disabled = true; try { await api("/api/auth/logout", {}); location.replace("/login"); } catch (failure) { error(failure.message); event.currentTarget.disabled = false; } });
