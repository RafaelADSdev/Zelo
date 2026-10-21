let api, refresh, current, initialized = false;
const $ = selector => document.querySelector(selector);
export function replyPresentation(dashboard) {
  const status = dashboard.replyStatus;
  if (status.mode === 'off') return { state: 'off', label: 'Desligado', description: 'A IA está pausada. Você pode continuar o atendimento manualmente.' };
  if (!status.active) return { state: 'waiting', label: 'Aguardando horário', description: 'A IA volta a atender automaticamente dentro da programação.' };
  const connected = dashboard.settings.whatsappMode === 'qr' ? dashboard.qr?.status === 'connected' : Boolean(dashboard.settings.validatedAt);
  const description = !dashboard.settings.aiReadyConfigured ? 'A IA está ligada. Configure uma chave de IA válida para responder.' : !connected ? 'A IA está ligada. Para começar a responder, conecte o WhatsApp.' : status.mode === 'scheduled' ? 'Respostas automáticas ativadas dentro da sua programação.' : 'Respostas automáticas ativadas, sem restrição de horário.';
  return { state: 'on', label: 'Ligado', description };
}
export function initReplySchedule(options) {
  api = options.api; refresh = options.changed;
  const card = document.createElement("section");
  card.className = "reply-control";
  card.dataset.state = 'loading';
  card.setAttribute('aria-label', 'Controle do atendimento automático');
  card.innerHTML = `<div class="reply-control-head"><div class="reply-overview"><div class="reply-state-icon" aria-hidden="true"><svg class="reply-power-icon" viewBox="0 0 24 24"><path d="M12 3v9M6.2 6.2a8 8 0 1 0 11.6 0"/></svg><svg class="reply-clock-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg></div><div class="reply-status-copy"><h2>Atendimento automático</h2><p id="reply-live" role="status" aria-live="polite">Verificando…</p><p id="reply-description">Consultando o estado do atendimento.</p></div></div><div class="reply-actions"><div class="reply-power-controls" role="group" aria-label="Ligar ou desligar o atendimento"><button type="button" id="reply-on" aria-pressed="false"><span class="reply-button-dot" aria-hidden="true"></span>Ligar agora</button><button type="button" id="reply-off" aria-pressed="false">Desligar</button></div><button type="button" id="reply-program" class="secondary-button" aria-expanded="false" aria-controls="reply-program-form"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4m8-4v4M4 10h16m-11 4h2m3 0h1"/></svg>Programar horário</button></div></div><p id="reply-schedule-summary" hidden></p>
  <form id="reply-program-form" aria-describedby="reply-program-privacy" hidden><p class="privacy-field-note" id="reply-program-privacy">Os horários controlam o atendimento deste ambiente. Não é necessário informar dados de clientes para programar. <a href="/privacidade">Política de Privacidade</a>.</p><p>Horário de São Paulo. A programação se repete nos dias selecionados.</p><fieldset><legend>Dias da semana</legend><div class="reply-days">${["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day, index) => `<label><input type="checkbox" name="reply-day" value="${index + 1}">${day}</label>`).join("")}</div></fieldset>
  <div class="reply-fields"><label>Das<input id="reply-start" type="time" required></label><label>Até<input id="reply-end" type="time" required></label><label class="checkbox-row"><input id="reply-all-day" type="checkbox">Dia inteiro</label></div>
  <div class="reply-fields"><label>A partir de (opcional)<input id="reply-from" type="date"></label><label>Até o dia (opcional)<input id="reply-until" type="date"></label></div>
  <p>Se o horário final for menor que o inicial, o atendimento segue até o dia seguinte. Mensagens recebidas fora da programação ficam para atendimento manual.</p><p>O servidor de atendimento precisa permanecer ativo e conectado ao WhatsApp.</p><button type="submit" class="primary-button">Salvar e ativar programação</button></form><p id="reply-feedback" role="status"></p>`;
  $(".connection-notice").after(card);
  card.querySelectorAll('button').forEach(button => button.disabled = true);
  $("#reply-program").onclick = () => {
    const form = $("#reply-program-form"); form.hidden = !form.hidden;
    $("#reply-program").setAttribute("aria-expanded", String(!form.hidden));
  };
  $("#reply-all-day").onchange = () => {
    $("#reply-start").disabled = $("#reply-end").disabled = $("#reply-all-day").checked;
  };
  async function save(data, message) {
    const buttons = card.querySelectorAll("button"); buttons.forEach(button => button.disabled = true);
    card.setAttribute('aria-busy', 'true');
    $('#reply-feedback').classList.remove('reply-feedback-error');
    $("#reply-feedback").textContent = "Salvando…";
    try { await api("/api/settings", data); await refresh(); $("#reply-feedback").textContent = message; }
    catch (error) { $("#reply-feedback").textContent = error.message; $('#reply-feedback').classList.add('reply-feedback-error'); }
    finally { buttons.forEach(button => button.disabled = false); card.setAttribute('aria-busy', 'false'); }
  }
  $("#reply-on").onclick = () => save({ autoReply: true, replySchedule: { ...current, enabled: false } }, "IA ligada continuamente. A programação foi desativada.");
  $("#reply-off").onclick = () => save({ autoReply: false }, "IA desligada. Para voltar à programação, clique em Salvar e ativar programação.");
  $("#reply-program-form").onsubmit = event => {
    event.preventDefault();
    const days = [...card.querySelectorAll('[name="reply-day"]:checked')].map(input => Number(input.value));
    save({ autoReply: true, replySchedule: { enabled: true, days, start: $("#reply-start").value, end: $("#reply-end").value, allDay: $("#reply-all-day").checked, fromDate: $("#reply-from").value, untilDate: $("#reply-until").value } }, "Programação ativada. O atendimento liga e pausa automaticamente nos horários escolhidos.");
  };
}
export function renderReplySchedule(dashboard) {
  current = dashboard.settings.replySchedule;
  if (!current || !$("#reply-live")) return;
  const status = dashboard.replyStatus;
  const presentation = replyPresentation(dashboard);
  if ($('.reply-control').getAttribute('aria-busy') !== 'true') $('.reply-control').querySelectorAll('button').forEach(button => button.disabled = false);
  $('.reply-control').dataset.state = presentation.state;
  $('#reply-live').textContent = presentation.label;
  $('#reply-description').textContent = presentation.description;
  $('#reply-on').setAttribute('aria-pressed', String(status.mode === 'always'));
  $('#reply-off').setAttribute('aria-pressed', String(status.mode === 'off'));
  $('#reply-program').dataset.scheduled = String(status.mode === 'scheduled');
  $('#reply-schedule-summary').hidden = status.mode !== 'scheduled';
  $('#reply-schedule-summary').textContent = `Programação ativa · ${current.allDay ? "Dia inteiro" : current.start + "–" + current.end} · ${current.days.map(day => ["", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][day]).join(", ")} · Horário de São Paulo${current.fromDate ? " · De " + current.fromDate.split("-").reverse().join("/") : ""}${current.untilDate ? " · Até " + current.untilDate.split("-").reverse().join("/") : ""}`;
  if (!initialized) {
    $("#reply-start").value = current.start; $("#reply-end").value = current.end;
    $("#reply-from").value = current.fromDate; $("#reply-until").value = current.untilDate;
    $("#reply-all-day").checked = current.allDay; $("#reply-all-day").onchange();
    document.querySelectorAll('[name="reply-day"]').forEach(input => input.checked = current.days.includes(Number(input.value)));
    initialized = true;
  }
}
