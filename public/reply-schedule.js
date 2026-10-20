let api, refresh, current, initialized = false;
const $ = selector => document.querySelector(selector);
export function initReplySchedule(options) {
  api = options.api; refresh = options.changed;
  const card = document.createElement("section");
  card.className = "reply-control";
  card.innerHTML = `<div class="reply-control-head"><div><h2>Atendimento automático</h2><p id="reply-live" role="status">Verificando…</p></div><div class="reply-actions"><button type="button" id="reply-on" class="primary-button">Ligar agora</button><button type="button" id="reply-off" class="secondary-button">Desligar</button><button type="button" id="reply-program" class="secondary-button" aria-expanded="false" aria-controls="reply-program-form">Programar horário</button></div></div>
  <form id="reply-program-form" hidden><p>Horário de São Paulo. A programação se repete nos dias selecionados.</p><fieldset><legend>Dias da semana</legend><div class="reply-days">${["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day, index) => `<label><input type="checkbox" name="reply-day" value="${index + 1}">${day}</label>`).join("")}</div></fieldset>
  <div class="reply-fields"><label>Das<input id="reply-start" type="time" required></label><label>Até<input id="reply-end" type="time" required></label><label class="checkbox-row"><input id="reply-all-day" type="checkbox">Dia inteiro</label></div>
  <div class="reply-fields"><label>A partir de (opcional)<input id="reply-from" type="date"></label><label>Até o dia (opcional)<input id="reply-until" type="date"></label></div>
  <p>Se o horário final for menor que o inicial, o atendimento segue até o dia seguinte. Mensagens recebidas fora da programação ficam para atendimento manual.</p><p>O computador e este servidor precisam permanecer ligados e conectados ao WhatsApp.</p><button type="submit" class="primary-button">Salvar e ativar programação</button></form><p id="reply-feedback" role="status"></p>`;
  $(".connection-notice").after(card);
  $("#reply-program").onclick = () => {
    const form = $("#reply-program-form"); form.hidden = !form.hidden;
    $("#reply-program").setAttribute("aria-expanded", String(!form.hidden));
  };
  $("#reply-all-day").onchange = () => {
    $("#reply-start").disabled = $("#reply-end").disabled = $("#reply-all-day").checked;
  };
  async function save(data, message) {
    const buttons = card.querySelectorAll("button"); buttons.forEach(button => button.disabled = true);
    $("#reply-feedback").textContent = "Salvando…";
    try { await api("/api/settings", data); await refresh(); $("#reply-feedback").textContent = message; }
    catch (error) { $("#reply-feedback").textContent = error.message; }
    finally { buttons.forEach(button => button.disabled = false); }
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
  $("#reply-live").textContent = status.reason + (status.mode === "scheduled" ? ` · ${current.allDay ? "Dia inteiro" : current.start + "–" + current.end} · ${current.days.map(day => ["", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][day]).join(", ")} · São Paulo${current.fromDate ? " · De " + current.fromDate.split("-").reverse().join("/") : ""}${current.untilDate ? " · Até " + current.untilDate.split("-").reverse().join("/") : ""}` : "");
  $("#reply-live").dataset.active = String(status.active);
  if (!initialized) {
    $("#reply-start").value = current.start; $("#reply-end").value = current.end;
    $("#reply-from").value = current.fromDate; $("#reply-until").value = current.untilDate;
    $("#reply-all-day").checked = current.allDay; $("#reply-all-day").onchange();
    document.querySelectorAll('[name="reply-day"]').forEach(input => input.checked = current.days.includes(Number(input.value)));
    initialized = true;
  }
}
