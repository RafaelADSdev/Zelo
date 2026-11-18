import { initSettingsUi, syncConnectionMode, renderConnectionPresentation } from "/settings-ui.js";
import { initWorkspace } from "/workspace.js";
import { initReplySchedule, renderReplySchedule } from "/reply-schedule.js";
import { initCatalog, refreshCatalog, showProductEditor, canLeaveProductEditor, returnCatalogFocus } from "/catalog.js";
import { initAiKeys, renderAiKeys } from "/ai-keys.js";
import { audioStatus, audioPreview, canRetryJob } from "/audio-status.js";
import { bindPhoneFormatting, phoneNumber } from "/broadcast-import.js";
let refreshBroadcasts = async () => {};
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let workspace, dashboard, view = "knowledge", currentPhone = "", waBusy = false, pollBusy = false;
let lastContacts = "", lastWaHistory = "", templates = [];
let historyRequest = 0, sendRequest = 0, historyReady = true;
let dashboardRequest = 0, appliedDashboardRequest = 0, conversationAccount = "", connectionGeneration = 0;
const settingsValues = new WeakMap();
const waDrafts = new Map(), sendIntents = new Map();
const templateFields = ["approved-template", "template-name", "template-language", "template-params", "template-components"];
const draftFields = ["wa-to", "wa-kind", "wa-text", ...templateFields];
const readDraft = () => Object.fromEntries(draftFields.map(id => [id, document.getElementById(id).value]));
const emptyDraft = readDraft();
let providers = {};
const activeAi = () => dashboard?.settings.aiRotationEnabled ? dashboard.settings.aiLastUsed || dashboard.settings.aiKeys.find(key => key.enabled && key.cooldownUntil <= Date.now()) || {} : dashboard?.settings.aiListOnly ? dashboard.settings.aiKeys.find(key => key.enabled) || {} : { provider: dashboard?.settings.aiProvider, model: dashboard?.settings.model };
const aiName = () => providers[activeAi().provider]?.name || "Lista de IAs";
const date = value => value ? new Date(Number(value)).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Ainda não";
const labels = { pending: "Na fila", requested: "Na fila do operador", processing: "Processando", done: "Respondida", failed: "Falhou", manual: "Atendimento manual", blocked: "IA bloqueada", unknown: "Envio sem confirmação", sending: "Enviando", sent: "Envio aceito", delivered: "Entregue", read: "Lida" };
function node(tag, className, text) { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; }
function conversationIcon(paths, className = "icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
  for (const d of paths) { const path = document.createElementNS(svg.namespaceURI, "path"); path.setAttribute("d", d); svg.append(path); }
  return svg;
}
const broadcastNav = node('button', 'nav-button');
const broadcastIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
broadcastIcon.setAttribute('class', 'icon'); broadcastIcon.setAttribute('viewBox', '0 0 24 24'); broadcastIcon.setAttribute('aria-hidden', 'true');
const broadcastPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
broadcastPath.setAttribute('d', 'm3 11 18-8-8 18-2-8-8-2Zm8 2L21 3'); broadcastIcon.append(broadcastPath);
broadcastNav.append(broadcastIcon, node('span', '', 'Disparos'));
broadcastNav.type = 'button'; broadcastNav.dataset.view = 'broadcasts';
document.querySelector('.nav-button[data-view="whatsapp"]').after(broadcastNav);
// One navigation for both layouts; mobile labels stay short without losing their accessible names.
for (const [name, label] of Object.entries({ knowledge: 'Produtos', whatsapp: 'Conversas', broadcasts: 'Disparos', settings: 'Conexões', access: 'Acessos' })) {
  const button = $(`.nav-button[data-view="${name}"]`);
  button.setAttribute('aria-label', button.textContent.trim());
  button.querySelector('span').classList.add('nav-desktop-label');
  button.append(node('span', 'nav-mobile-label', label));
  button.lastChild.setAttribute('aria-hidden', 'true');
}
const mobileViewport = window.visualViewport;
function syncMobileViewport() {
  if (mobileViewport && mobileViewport.scale !== 1) return; // Preserve pinch zoom.
  const editing = document.activeElement?.matches('input:not([type=checkbox]):not([type=radio]), textarea, select');
  const keyboardOpen = matchMedia('(max-width:800px)').matches && editing && mobileViewport && window.innerHeight - mobileViewport.height > 120;
  $('.shell').dataset.keyboardOpen = String(Boolean(keyboardOpen));
  if (keyboardOpen) {
    $('.shell').style.setProperty('--mobile-viewport-height', `${mobileViewport.height}px`);
    $('.shell').style.setProperty('--mobile-viewport-offset', `${mobileViewport.offsetTop}px`);
  }
}
mobileViewport?.addEventListener('resize', syncMobileViewport);
mobileViewport?.addEventListener('scroll', syncMobileViewport);
document.addEventListener('focusin', syncMobileViewport);
document.addEventListener('focusout', () => requestAnimationFrame(syncMobileViewport));
window.addEventListener('resize', syncMobileViewport);
new ResizeObserver(([entry]) => $('.shell').style.setProperty('--pwa-tools-height', `${entry.target.offsetHeight}px`)).observe($('.main-topbar'));
const blockContactButton = node("button", "secondary-button contact-block-button", "Bloquear IA");
blockContactButton.type = "button"; blockContactButton.hidden = true;
$("#wa-window").closest("header").append(blockContactButton);
let contactFilter = "all";
const blockFilter = node("div", "contact-filters");
blockFilter.setAttribute("role", "group"); blockFilter.setAttribute("aria-label", "Filtrar conversas");
for (const [value, text] of [["all", "Todas"], ["blocked", "IA bloqueada"]]) {
  const button = node("button", "contact-filter"); button.type = "button"; button.dataset.filter = value;
  button.setAttribute("aria-pressed", String(value === contactFilter));
  button.append(node("span", "", text), node("span", "contact-filter-count", "0"));
  button.addEventListener("click", () => {
    contactFilter = value;
    blockFilter.querySelectorAll("button").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    filterContacts();
  });
  blockFilter.append(button);
}
$(".contact-search-wrap").after(blockFilter);
$(".contacts-heading").insertBefore($("#refresh-inbox"), $("#new-wa-conversation"));
$("#refresh-inbox").replaceChildren(conversationIcon(["M20 4v6h-6M4 20v-6h6", "M6.1 7a7 7 0 0 1 11.6-2L20 8M4 16l2.3 3A7 7 0 0 0 17.9 17"]), node("span", "refresh-label", "Atualizar"));
$("#refresh-inbox").setAttribute("aria-label", "Atualizar conversas"); $("#refresh-inbox").title = "Atualizar conversas";
$(".activity-panel").addEventListener("toggle", event => {
  $(".activity-action-text").textContent = event.currentTarget.open ? "Ocultar" : "Ver atividade";
});
async function api(path, data) {
  const response = await fetch(path, { ...(data === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), signal: AbortSignal.timeout((path === "/api/tunnel/start" || /^\/api\/ai\/keys\/[^/]+\/verify(?:\?|$)/.test(path)) ? 190000 : 60000) });
  if (response.status === 401) { location.replace("/login"); throw new Error("Sua sessão terminou. Entre novamente."); }
  const result = await response.json(); if (!response.ok) throw new Error(result.error || "Não foi possível concluir."); return result;
}
function error(message = "") { $("#global-error").textContent = message; $("#global-error").hidden = !message; }
function messageBox(container, role, text, at, status) {
  const item = node("article", `message ${role === "user" ? "user" : "agent"}`);
  const whatsapp = container.id === "wa-messages";
  const bubble = node("div", "bubble");
  item.append(node("div", "message-label", role === "user" ? (whatsapp ? "Contato" : "Você") : dashboard?.settings.assistantName || "Assistente"), bubble);
  bubble.append(node("div", "message-body", text || "[Mensagem sem texto]"));
  if (at || status) {
    const timestamp = at ? new Date(Number(at)).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
    const time = node("div", "message-time", [whatsapp ? timestamp : date(at), labels[status] || status].filter(Boolean).join(" · "));
    time.title = date(at); (whatsapp ? bubble : item).append(time);
  }
  container.append(item);
}
function fillSettings(scope) {
  const config = dashboard.settings;
  for (const input of $$(scope ? `#settings-${scope}-panel [name]` : "#settings-form [name]")) {
    const property = input.type === "checkbox" ? "checked" : "value";
    if (!scope && settingsValues.has(input) && settingsValues.get(input) !== input[property]) continue;
    if (["apiKey", "accessToken", "appSecret"].includes(input.name)) { input.value = ""; input.placeholder = config[input.name + "Configured"] ? "Salvo no servidor · deixe vazio para manter" : "Ainda não configurado"; }
    else if (input.type === "checkbox") input.checked = config[input.name];
    else input.value = config[input.name] || "";
    settingsValues.set(input, input[property]);
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
  const signature = JSON.stringify([dashboard.conversations, dashboard.jobs]);
  if (signature !== lastContacts) {
    lastContacts = signature; const contacts = $("#contacts"); contacts.replaceChildren();
    blockFilter.querySelector('[data-filter="all"] .contact-filter-count').textContent = dashboard.conversations.length;
    blockFilter.querySelector('[data-filter="blocked"] .contact-filter-count').textContent = dashboard.conversations.filter(contact => contact.blocked).length;
    if (!dashboard.conversations.length) contacts.append(node("p", "hint", "Ainda não há conversas. Com o WhatsApp conectado, use Nova mensagem ou aguarde uma mensagem de um contato."));
    dashboard.conversations.forEach(contact => {
      const button = node("button", "contact-button"); button.type = "button"; button.dataset.phone = contact.phone; button.setAttribute("aria-pressed", String(currentPhone === contact.phone));
      button.dataset.blocked = String(Boolean(contact.blocked));
      button.title = `${contact.name} · ${contact.phone}`;
      button.dataset.search = `${contact.name} ${contact.phone}`;
      const nameParts = contact.name.trim().split(/\s+/).filter(part => /\p{L}/u.test(part));
      const initials = nameParts.length ? [nameParts[0][0], nameParts.length > 1 ? nameParts.at(-1)[0] : ""].join("").toLocaleUpperCase("pt-BR") : "";
      const avatar = node("span", "contact-avatar", initials); avatar.setAttribute("aria-hidden", "true");
      avatar.dataset.color = String([...contact.phone].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 3);
      if (!initials) avatar.append(conversationIcon(["M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0M5 21v-2a7 7 0 0 1 14 0v2"]));
      const content = node("span", "contact-content"), headline = node("span", "contact-headline");
      headline.append(node("strong", "", contact.name));
      if (contact.blocked) {
        const badge = node("span", "contact-block-badge"); badge.title = "IA bloqueada · atendimento manual disponível";
        badge.append(conversationIcon(["M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3"]), node("span", "sr-only", "IA bloqueada")); headline.append(badge);
      }
      if (contact.last_inbound) {
        const at = new Date(Number(contact.last_inbound));
        const time = node("time", "contact-time", at.toDateString() === new Date().toDateString() ? at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : at.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }));
        time.dateTime = at.toISOString(); time.title = `Última mensagem recebida: ${date(contact.last_inbound)}`; headline.append(time);
      }
      const preview = node("p", "contact-preview", audioPreview(contact.last_text, dashboard.jobs.find(job => job.phone === contact.phone)) || "Sem mensagem de texto");
      content.append(headline, preview); button.append(avatar, content);
      button.addEventListener("click", () => {
        selectConversation(contact.phone, contact.name);
        $("#wa-contact").focus({ preventScroll: true });
        loadConversation().catch(failure => error(failure.message));
      });
      contacts.append(button);
    });
  }
  filterContacts();
  const jobs = $("#jobs"); jobs.replaceChildren();
  const attention = dashboard.jobs.filter(job => !["done", "blocked"].includes(job.state));
  $("#activity-count").textContent = attention.length || "Em dia";
  $(".activity-panel").dataset.attention = String(Boolean(attention.length));
  const failed = attention.filter(job => job.state === "failed").length;
  const manual = attention.filter(job => job.state === "manual").length;
  const processing = attention.filter(job => job.state === "processing").length;
  const other = attention.length - failed - manual - processing;
  $("#activity-description").textContent = attention.length ? [failed && `${failed} ${failed === 1 ? "falha para revisar" : "falhas para revisar"}`, manual && `${manual} em atendimento manual`, processing && `${processing} em processamento`, other && `${other} para acompanhar`].filter(Boolean).join(" · ") : "Nenhuma mensagem pendente. Tudo em dia.";
  $("#activity-mobile-description").textContent = attention.length ? `${attention.length} ${attention.length === 1 ? "mensagem para acompanhar" : "mensagens para acompanhar"}` : "Nenhuma mensagem pendente.";
  $("#activity-count").setAttribute("aria-label", attention.length ? `${attention.length} ${attention.length === 1 ? "mensagem para acompanhar" : "mensagens para acompanhar"}` : "Atendimento em dia");
  if (!attention.length) jobs.append(node("p", "hint", "Nenhuma mensagem pendente ou com falha."));
  attention.forEach(job => {
    const row = node("div", "job-row"), content = node("div", "activity-job-content");
    const contact = dashboard.conversations.find(item => item.phone === job.phone);
    const heading = node("div", "activity-job-heading");
    heading.append(node("strong", "", contact?.name || job.phone), node("span", `activity-job-state ${job.state === "failed" ? "is-failed" : ""}`, labels[job.state] || job.state));
    content.append(heading);
    if (job.error) content.append(node("p", "activity-job-error", job.error));
    if (job.created) content.append(node("small", "", date(job.created)));
    row.append(content);
    if (canRetryJob(job)) {
      const retry = node("button", "secondary-button", "Tentar responder"); retry.type = "button";
      retry.addEventListener("click", () => action(retry, "#wa-send-status", async () => { await api("/api/whatsapp/retry", { id: job.id }); await loadDashboard(); return "Mensagem recolocada na fila."; })); row.append(retry);
    }
    jobs.append(row);
  });
  dashboard.outbox.forEach(item => jobs.append(node("p", "hint", `${item.phone} · ${labels[item.state]} · ${item.error || ""}`)));
  const events = $("#events"); events.replaceChildren(); if (!dashboard.events.length) events.append(node("p", "hint", "Nenhum evento recente.")); dashboard.events.slice(0, 10).forEach(item => events.append(node("p", "event-row", `${date(item.at)} · ${item.detail}`)));
}
async function loadDashboard(refreshForm = false) {
  const request = ++dashboardRequest;
  const next = await api("/api/dashboard");
  if (request > appliedDashboardRequest) {
    appliedDashboardRequest = request;
    dashboard = next;
    const mode = dashboard.settings.whatsappMode;
    const number = mode === "qr" ? dashboard.qr.account : dashboard.settings.phoneNumberId;
    const account = `${mode}:${number || ""}`;
    if (account !== conversationAccount) {
      const changing = Boolean(conversationAccount);
      conversationAccount = account;
      connectionGeneration++;
      if (changing) resetConversationAccount();
    }
    renderDashboard();
  }
  if (refreshForm) fillSettings();
}
async function loadConversation() {
  if (!currentPhone) return;
  const request = ++historyRequest;
  let result;
  try {
    result = await api("/api/conversation?phone=" + encodeURIComponent(currentPhone));
  } catch (failure) {
    if (request !== historyRequest) return;
    if (historyReady) throw failure;
    $("#wa-window").textContent = "Não foi possível carregar a conversa.";
    $("#wa-messages").replaceChildren(node("p", "hint", "Na lista de conversas, use Atualizar para carregar o histórico antes de responder."));
    return;
  }
  if (request !== historyRequest) return;
  historyReady = true;
  updateSendAvailability();
  const audioJobs = dashboard.jobs.filter(job => job.phone === currentPhone && job.audio && !["done", "blocked"].includes(job.state)).slice(0, 5);
  const signature = JSON.stringify([result, audioJobs, dashboard.replyStatus.active, dashboard.settings.whatsappMode]); if (signature === lastWaHistory) return;
  const container = $("#wa-messages");
  const followLatest = !lastWaHistory || container.scrollHeight - container.scrollTop - container.clientHeight < 80;
  const previousScroll = container.scrollTop; lastWaHistory = signature;
  const contact = dashboard.conversations.find(item => item.phone === currentPhone);
  $("#wa-contact").textContent = contact?.name || currentPhone;
  $("#wa-avatar").textContent = (contact?.name || currentPhone).trim().slice(0, 1).toLocaleUpperCase("pt-BR");
  blockContactButton.hidden = false; blockContactButton.dataset.blocked = String(Boolean(result.blocked));
  blockContactButton.textContent = result.blocked ? "Desbloquear IA" : "Bloquear IA";
  blockContactButton.setAttribute("aria-label", `${result.blocked ? "Desbloquear" : "Bloquear"} IA para ${contact?.name || currentPhone}`);
  $("#wa-window").textContent = dashboard.settings.whatsappMode === "qr" ? "WhatsApp · " + (result.blocked || !dashboard.replyStatus.active ? "Atendimento manual" : "Atendimento com IA") : contact?.last_inbound && Date.now() - Number(contact.last_inbound) < 86400000 ? "Janela de 24 horas aberta para texto livre." : "Envie um template aprovado ou aguarde uma mensagem do contato.";
  container.replaceChildren();
  let previousDay = "";
  const appendMessage = (role, text, at, status) => {
    if (at) {
      const day = new Date(Number(at)).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
      if (day !== previousDay) { container.append(node("div", "chat-date", day)); previousDay = day; }
    }
    messageBox(container, role, text, at, status);
  };
  result.history.forEach(turn => {
    const outgoing = result.outbound.find(item => item.id === turn.id || item.id === "auto:" + turn.id.replace(/:reply$/, ""));
    appendMessage(turn.role, turn.text, turn.timestamp, outgoing?.deliveryStatus || outgoing?.state);
  });
  result.outbound.filter(item => !result.history.some(turn => turn.id === item.id || item.id === "auto:" + turn.id.replace(/:reply$/, ""))).forEach(item => appendMessage("agent", item.text, item.created, item.deliveryStatus || item.state));
  if (result.blocked) {
    const notice = node("section", "audio-job-status contact-block-notice"); notice.setAttribute("role", "status");
    notice.append(node("strong", "", "IA bloqueada para este contato"), node("p", "", "Este contato não recebe respostas da IA nem tem áudios transcritos. Você pode continuar o atendimento manualmente. Ao desbloquear, somente novas mensagens voltam ao atendimento automático.")); container.append(notice);
  }
  audioJobs.slice().reverse().forEach(job => {
    const status = audioStatus(job), card = node("section", `audio-job-status audio-job-${status.tone}`);
    card.setAttribute("role", "status");
    const details = node("details", "audio-job-details"), summary = node("summary", "", "Ver detalhes");
    details.append(summary, node("p", "", status.detail));
    card.append(node("strong", "", status.title), node("small", "", `Áudio recebido em ${date(job.created)}`), details);
    if (status.retry && !result.blocked) {
      const retry = node("button", "secondary-button", "Tentar atender este áudio"); retry.type = "button";
      retry.addEventListener("click", () => action(retry, "#wa-send-status", async () => { await api("/api/whatsapp/retry", { id: job.id }); await loadDashboard(); lastWaHistory = ""; await loadConversation(); return "Áudio recolocado na fila."; })); card.append(retry);
    }
    container.append(card);
  });
  if (!container.children.length) container.append(node("p", "hint", "Ainda não há mensagens nesta conversa."));
  container.scrollTop = followLatest ? container.scrollHeight : previousScroll;
}
function updatePage(next) {
  const pages = {
    knowledge: ["Produtos e materiais", "O catálogo que a IA consulta para responder aos clientes.", "Base de conhecimento"],
    whatsapp: ["Conversas", "Leia e responda às mensagens dos seus contatos no WhatsApp.", "Caixa de entrada"],
    broadcasts: ["Disparos", "Prepare campanhas, revise os destinatários e acompanhe os envios.", "Mensagens em lote"],
    access: ["Gestão de acessos", "Convide pessoas e acompanhe quem tem acesso ao Zelo.", "Admin master"],
    settings: ["Conexões e IA", "Conecte o WhatsApp e configure os modelos e as instruções da IA.", "Configurações"],
  };
  const section = next === 'product' ? 'knowledge' : next;
  const [title, description, badge] = pages[section];
  $("#page-title").replaceChildren(node('span', 'page-title-full', title), node('span', 'page-title-mobile', section === 'knowledge' ? 'Produtos' : title)); $("#page-description").textContent = description; $("#page-breadcrumb").textContent = title;
  $(".mode-badge").textContent = badge;
  $(".page-heading").hidden = next === 'product';
  document.querySelectorAll(".nav-button[data-view]").forEach(button => { button.classList.toggle("active", button.dataset.view === section); if (button.dataset.view === section) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current"); });
}
function filterContacts() {
  const query = $("#contact-search").value.toLocaleLowerCase("pt-BR");
  const buttons = $$("#contacts .contact-button");
  buttons.forEach(button => button.hidden = !`${button.dataset.search} ${button.textContent}`.toLocaleLowerCase("pt-BR").includes(query) || contactFilter === "blocked" && button.dataset.blocked !== "true");
  $("#contact-search-empty").hidden = !buttons.length || buttons.some(button => !button.hidden);
}
$("#contact-search").addEventListener("input", filterContacts);
$('#wa-contact').tabIndex = -1;
$('.contacts-heading h3').tabIndex = -1;
function openChat() {
  $('.inbox-layout').dataset.contactSelected = 'true';
  if (matchMedia('(max-width:580px)').matches && !history.state?.chat) history.pushState({ zelo: true, view: 'whatsapp', chat: true }, '', '/#conversas');
}
function closeChat({ focus = true } = {}) {
  $('.inbox-layout').dataset.contactSelected = 'false';
  if (focus) ($('#contacts .contact-button[aria-pressed="true"]') || $('.contacts-heading h3')).focus({ preventScroll: true });
}
$('#mobile-chat-back').onclick = () => { if (history.state?.chat) history.back(); else closeChat(); };
function updateSendAvailability() { $("#wa-send").disabled = waBusy || !historyReady; }
function sendStatus(message, state = "") {
  const status = $("#wa-send-status");
  status.textContent = message;
  status.dataset.state = state;
}
function fillDraft(draft) {
  for (const id of draftFields) document.getElementById(id).value = draft[id];
  if (dashboard?.settings.whatsappMode === "qr") $("#wa-kind").value = "text";
  updateMessageKind();
  renderTemplatePreview();
  resizeComposer();
}
function showConversation(phone, name, open) {
  currentPhone = phone;
  historyRequest++;
  historyReady = !phone;
  lastWaHistory = "";
  sendStatus("");
  blockContactButton.hidden = true;
  $(".message-options").open = !phone;
  $("#wa-to").readOnly = Boolean(phone);
  if (phone) $("#wa-to").value = phone;
  $("#wa-contact").textContent = name;
  $("#wa-avatar").textContent = phone ? name.trim().slice(0, 1).toLocaleUpperCase("pt-BR") : "+";
  $("#wa-window").textContent = phone ? "Carregando conversa…" : "Informe o destinatário e escreva sua mensagem.";
  $("#wa-messages").replaceChildren(node("p", "hint", phone ? "Carregando histórico…" : "Sua nova conversa aparecerá aqui após o envio."));
  $$("#contacts .contact-button").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.phone === phone)));
  if (open) openChat();
  else closeChat({ focus: false });
  updateSendAvailability();
}
function selectConversation(phone, name = phone || "Nova mensagem") {
  if (phone !== currentPhone) {
    waDrafts.set(currentPhone, readDraft());
    fillDraft(waDrafts.get(phone) || emptyDraft);
  }
  showConversation(phone, name, true);
}
function resetConversationAccount() {
  waDrafts.clear();
  sendIntents.clear();
  lastContacts = "";
  templates = [];
  $("#approved-template").replaceChildren(new Option("Selecione ou preencha abaixo", ""));
  fillDraft(emptyDraft);
  showConversation("", "Nova mensagem", false);
  $("#wa-window").textContent = "A conexão mudou. Escolha um contato desta conexão ou inicie outra mensagem.";
}
$('#new-wa-conversation').onclick = () => { selectConversation(""); $("#wa-to").focus(); };

const viewHashes = { knowledge: '', whatsapp: '#conversas', broadcasts: '#disparos', settings: '#conexoes', access: '', product: '#produtos/novo' };
const productEditHash = '#produtos/editar/';
let productRoute;
function viewFromLocation() {
  if (location.pathname === '/admin/access' && workspace?.isMaster) return { view: 'access' };
  if (location.hash.startsWith(productEditHash)) {
    const id = location.hash.slice(productEditHash.length);
    try { return { view: 'product', productId: decodeURIComponent(id) }; }
    catch { return { view: 'product', productId: id }; }
  }
  const next = Object.keys(viewHashes).find(name => name !== 'access' && viewHashes[name] === location.hash);
  return next ? { view: next } : null;
}
function recordView(route, replace = false) {
  const { view: next, productId } = route;
  const hash = next === 'product' && productId !== null ? productEditHash + encodeURIComponent(productId) : viewHashes[next];
  history[replace ? 'replaceState' : 'pushState'](route, '', next === 'access' ? '/admin/access' : '/' + hash);
}
function closeProductView() {
  if (productRoute.fromCatalog) history.back();
  else showView('knowledge', { navigation: 'replace' });
}
function updateProductRoute(productId) {
  productRoute = { ...productRoute, productId };
  recordView(productRoute, true);
}
async function showView(next, { navigation = 'push', productId = null, fromCatalog = false } = {}) {
  $('.account-menu').open = false;
  if (next === "access" && !workspace?.isMaster) return;
  const previousProduct = productRoute;
  if (previousProduct) {
    if (next === 'product' && previousProduct.productId === productId) return;
    if (!canLeaveProductEditor()) {
      if (navigation === 'pop') {
        productRoute = { ...previousProduct, fromCatalog: next === 'knowledge' };
        recordView(productRoute);
      }
      return;
    }
  }
  const route = { zelo: true, view: next, chat: false };
  if (next === 'product') {
    Object.assign(route, { productId, fromCatalog: navigation === 'push' ? history.state?.view === 'knowledge' : fromCatalog });
  }
  productRoute = next === 'product' ? route : null;
  const replyFeedback = $("#reply-feedback");
  if (next !== view && replyFeedback && !replyFeedback.classList.contains('reply-feedback-error')) replyFeedback.textContent = '';
  updatePage(next);
  view = next; document.querySelector(".shell").dataset.view = next; $$(".view").forEach(item => { item.hidden = item.id !== "view-" + next; });
  window.scrollTo(0, 0);
  error();
  if (navigation === 'replace' || navigation === 'push' && (history.state?.view !== next || history.state?.chat || next === 'product')) {
    recordView(route, navigation === 'replace');
    if (next === 'whatsapp' && matchMedia('(max-width:580px)').matches) closeChat({ focus: false });
  }
  const replyControl = $(".reply-control");
  if (replyControl) replyControl.hidden = next === "access" || next === "product";
  $(".connection-notice").hidden = ["access", "settings", "product"].includes(next);
  if (next === 'product') showProductEditor(productId);
  if (next === 'knowledge' && previousProduct) returnCatalogFocus(previousProduct.productId);
  try {
    if (next === 'broadcasts') await refreshBroadcasts();
    if (next === 'settings') await loadDashboard(true);
    if (next === 'knowledge' && !previousProduct && navigation !== 'replace') await refreshCatalog();
    if (next === 'whatsapp') { await loadDashboard(); await loadConversation(); }
  } catch (failure) { error(failure.message); }
}
$$('.nav-button[data-view]').forEach(button => button.addEventListener("click", () => {
  if (button.dataset.view === 'knowledge' && productRoute) closeProductView();
  else showView(button.dataset.view);
}));
window.addEventListener('popstate', event => {
  const route = event.state?.zelo ? event.state : viewFromLocation();
  if (!route || !Object.hasOwn(viewHashes, route.view)) return;
  if (route.view === 'whatsapp') {
    $('.inbox-layout').dataset.contactSelected = String(Boolean(route.chat));
    if (!route.chat) closeChat();
  }
  showView(route.view, { ...route, navigation: 'pop' });
});
async function action(button, statusSelector, task) {
  const status = $(statusSelector);
  const generation = connectionGeneration, recipient = currentPhone;
  const sameContext = () => statusSelector !== "#wa-send-status" || generation === connectionGeneration && recipient === currentPhone;
  button.disabled = true;
  error();
  status.dataset.state = "pending";
  status.textContent = "Aguarde…";
  try {
    const result = await task();
    if (sameContext()) {
      status.textContent = result || "Concluído.";
      status.dataset.state = "success";
    }
  } catch (failure) {
    if (sameContext()) {
      status.textContent = failure.message;
      status.dataset.state = "error";
      error(failure.message);
    }
  } finally {
    button.disabled = false;
  }
}
blockContactButton.addEventListener("click", () => {
  if (!currentPhone) return;
  const phone = currentPhone, blocked = blockContactButton.dataset.blocked !== "true";
  return action(blockContactButton, "#wa-send-status", async () => {
    await api("/api/whatsapp/block", { phone, blocked });
    await loadDashboard(); lastWaHistory = ""; await loadConversation();
    return blocked ? "IA bloqueada para este contato. O atendimento manual continua disponível." : "IA desbloqueada. Somente novas mensagens serão atendidas automaticamente.";
  });
});
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
$("#save-global-instructions").addEventListener("click", event => action(event.currentTarget, "#global-instructions-status", async () => { await saveSettings("assistant"); return "Identidade, instruções e orientações de escrita salvas para todas as IAs."; }));
$("#verify-whatsapp").addEventListener("click", event => action(event.currentTarget, "#settings-status", async () => { await saveSettings(); await api("/api/whatsapp/verify", {}); await loadDashboard(); return "Número e credenciais validados na Meta."; }));
$("#subscribe-whatsapp").addEventListener("click", event => action(event.currentTarget, "#settings-status", async () => { await saveSettings(); await api("/api/whatsapp/subscribe", {}); await loadDashboard(); return "Aplicativo inscrito na conta WhatsApp Business. Assine também o campo messages no painel Meta."; }));
$("#start-tunnel").addEventListener("click", event => action(event.currentTarget, "#settings-status", async () => {
  await saveSettings(); $("#settings-status").textContent = "Preparando cloudflared oficial e iniciando o túnel. Isso pode levar alguns minutos…";
  await api("/api/tunnel/start", {}); await loadDashboard(true); return "URL pública pronta. Copie o callback e o token para a Meta.";
}));
$("#stop-tunnel").addEventListener("click", event => action(event.currentTarget, "#settings-status", async () => { await api("/api/tunnel/stop", {}); await loadDashboard(); return "Túnel encerrado."; }));
$("#publicUrl").addEventListener("input", updateCallback);
$("#copy-token").addEventListener("click", event => action(event.currentTarget, "#settings-status", async () => { await navigator.clipboard.writeText($("#verifyToken").value); return "Token copiado. Cole no campo de verificação do webhook na Meta."; }));
$('#edit-business').addEventListener('click', () => {
  $('#knowledge-business-name').readOnly = false; $('#knowledge').readOnly = false;
  $('#edit-business').hidden = true; $('#save-business').hidden = false; $('#knowledge-business-name').focus();
});
$('#knowledge-form').addEventListener('submit', event => { event.preventDefault(); action(event.submitter, '#knowledge-status', async () => {
  const businessName = $('#knowledge-business-name').value.trim();
  if (businessName !== (dashboard.settings.businessName || '')) await api('/api/settings', { businessName });
  await api('/api/knowledge', { text: $('#knowledge').value });
  dashboard.settings.businessName = businessName;
  $('#knowledge-business-name').readOnly = true; $('#knowledge').readOnly = true;
  $('#edit-business').hidden = false; $('#save-business').hidden = true;
  $('#edit-business').focus();
  return 'Informações salvas. As próximas respostas consultarão esta base.';
}); });
$("#refresh-inbox").addEventListener("click", async event => {
  const button = event.currentTarget; button.disabled = true; button.setAttribute("aria-busy", "true");
  try { await loadDashboard(); await loadConversation(); } catch (failure) { error(failure.message); }
  finally { button.disabled = false; button.removeAttribute("aria-busy"); }
});
function updateMessageKind() {
  const useTemplate = $("#wa-kind").value === "template";
  $("#text-fields").hidden = useTemplate;
  $("#template-fields").hidden = !useTemplate;
}
$("#wa-kind").addEventListener("change", updateMessageKind);
function resizeComposer() {
  const field = $("#wa-text"); field.style.height = "auto";
  field.style.height = Math.min(field.scrollHeight, 144) + "px";
}
$("#wa-text").addEventListener("input", resizeComposer);
$("#wa-text").addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && $("#wa-text").value.trim()) {
    event.preventDefault();
    if (!$("#wa-send").disabled) $("#wa-send-form").requestSubmit($("#wa-send"));
  }
});
const templateKey = template => `${template.name}:${template.language}`;
function renderTemplatePreview() {
  const template = templates.find(item => templateKey(item) === $("#approved-template").value);
  $("#template-preview").textContent = template?.components?.map(component => component.text || component.type).join("\n") || "";
  return template;
}
$("#load-templates").addEventListener("click", event => action(event.currentTarget, "#wa-send-status", async () => {
  const generation = connectionGeneration;
  const result = await api("/api/templates");
  if (generation !== connectionGeneration) return;
  templates = result.templates;
  const select = $("#approved-template"), previous = select.value;
  select.replaceChildren(new Option("Selecione um template", ""));
  templates.forEach(template => select.append(new Option(`${template.name} · ${template.language}`, templateKey(template))));
  select.value = templates.some(template => templateKey(template) === previous) ? previous : "";
  renderTemplatePreview();
  return `${templates.length} template(s) aprovado(s) encontrado(s).`;
}));
$("#approved-template").addEventListener("change", () => {
  const template = renderTemplatePreview();
  if (!template) return;
  $("#template-name").value = template.name;
  $("#template-language").value = template.language;
});
bindPhoneFormatting($("#wa-to"));
const composePhone = value => phoneNumber(value, '55') || value.trim();
$("#wa-send-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (waBusy || !historyReady) return;
  const origin = currentPhone, account = conversationAccount, generation = connectionGeneration, submitted = readDraft();
  const phone = origin || composePhone(submitted["wa-to"]);
  const sameRecipient = value => Boolean(origin) || composePhone(value) === phone;
  const visible = () => view === "whatsapp" && generation === connectionGeneration && origin === currentPhone && sameRecipient($("#wa-to").value)
    && (!matchMedia('(max-width:580px)').matches || $('.inbox-layout').dataset.contactSelected === 'true');
  let input;
  try {
    input = { phone };
    if (account && !account.endsWith(":")) input.expectedAccount = account;
    if (submitted["wa-kind"] === "template") {
      let components = [];
      if (submitted["template-components"].trim()) components = JSON.parse(submitted["template-components"]);
      else if (submitted["template-params"].trim()) components = [{ type: "body", parameters: submitted["template-params"].split("\n").filter(line => line.trim()).map(line => { const match = line.match(/^([a-zA-Z_][\w]*)=(.*)$/); return match ? { type: "text", parameter_name: match[1], text: match[2] } : { type: "text", text: line }; }) }];
      input.template = { name: submitted["template-name"].trim(), language: { code: submitted["template-language"].trim() }, components };
    } else input.text = submitted["wa-text"].trim();
  } catch { sendStatus("O JSON dos componentes do template é inválido.", "error"); return; }
  if (!input.template && !input.text) { sendStatus("Escreva uma mensagem antes de enviar.", "error"); return; }
  const intent = JSON.stringify(input), previous = sendIntents.get(origin);
  input.requestId = previous?.intent === intent ? previous.requestId : crypto.randomUUID();
  sendIntents.set(origin, { intent, requestId: input.requestId });
  const attempt = ++sendRequest;
  waBusy = true;
  updateSendAvailability();
  sendStatus("Enviando mensagem…", "pending");
  try {
    await api("/api/whatsapp/send", input);
  } catch (failure) {
    if (visible()) sendStatus(failure.message, "error");
    return;
  } finally {
    waBusy = false;
    updateSendAvailability();
  }
  if (generation !== connectionGeneration) return;
  sendIntents.delete(origin);
  const here = visible(), fields = input.template ? templateFields : ["wa-text"];
  const draft = origin === currentPhone ? readDraft() : waDrafts.get(origin);
  const unchanged = draft && sameRecipient(draft["wa-to"]) && fields.every(id => draft[id] === submitted[id]);
  if (unchanged) {
    for (const id of fields) draft[id] = emptyDraft[id];
    if (!origin) draft["wa-to"] = "";
    if (origin === currentPhone) fillDraft(draft);
  }
  if (!here) return;
  if (!origin && unchanged) selectConversation(input.phone);
  sendStatus("Enviada ao WhatsApp. Aguarde a confirmação de entrega.", "success");
  const sentContact = currentPhone;
  const stillHere = () => view === "whatsapp" && generation === connectionGeneration && sentContact === currentPhone;
  loadDashboard().then(() => {
    if (stillHere()) return loadConversation();
  }).catch(() => {
    if (stillHere() && attempt === sendRequest && $("#wa-send-status").dataset.state === "success") {
      sendStatus("Enviada ao WhatsApp. Use Atualizar na lista de conversas para consultar o histórico.", "success");
    }
  });
});
try {
  try {
    const broadcasts = await import('/broadcasts.js');
    broadcasts.initBroadcasts({ api }); refreshBroadcasts = broadcasts.refreshBroadcasts;
  } catch {
    broadcastNav.disabled = true;
    error('A área de disparos não carregou. Reinicie o servidor do Zelo e atualize esta página. As outras áreas continuam disponíveis.');
  }
  providers = await api("/api/ai/providers");
  initSettingsUi();
  initReplySchedule({ api, changed: () => loadDashboard() });
  await initAiKeys({ providers, api, changed: () => loadDashboard() });
  await loadDashboard(true); $("#knowledge").value = (await api("/api/state")).knowledge; $("#knowledge-business-name").value = dashboard.settings.businessName || "";
  await initCatalog({ openEditor: productId => showView('product', { productId }), closeEditor: closeProductView, productCreated: updateProductRoute });
  workspace = await initWorkspace({ api });
  const initial = viewFromLocation() || { view: 'knowledge' };
  const fromCatalog = initial.view === 'product' && history.state?.view === 'product' && Boolean(history.state.fromCatalog);
  await showView(initial.view, { ...initial, fromCatalog, navigation: 'replace' });
} catch (failure) { error("Não foi possível carregar o painel. " + failure.message); }
setInterval(async () => {
  if (pollBusy || document.hidden) return; pollBusy = true;
  try { await loadDashboard(); if (view === "whatsapp") await loadConversation(); if (view === 'broadcasts') await refreshBroadcasts(); } catch {} finally { pollBusy = false; }
}, 5000);

$("#logout").addEventListener("click", async event => { event.currentTarget.disabled = true; try { await api("/api/auth/logout", {}); location.replace("/login"); } catch (failure) { error(failure.message); event.currentTarget.disabled = false; } });

// Keep hidden recipient options reachable when native form validation needs them.
$('#wa-send-form').addEventListener('invalid', event => { if ($('.message-options').contains(event.target)) $('.message-options').open = true; }, true);
$('.account-menu').addEventListener('keydown', event => { if (event.key === 'Escape') { $('.account-menu').open = false; $('.account-menu > summary').focus(); } });
document.addEventListener('click', event => { if (!$('.account-menu').contains(event.target)) $('.account-menu').open = false; });
