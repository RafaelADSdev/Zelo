const zone = "America/Sao_Paulo";
const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const invalid = message => Object.assign(new Error(message), { status: 400 });
export function validateSchedule(input) {
  if (!input || typeof input.enabled !== "boolean" || !Array.isArray(input.days) || !input.days.length || input.days.some(day => !Number.isInteger(day) || day < 1 || day > 7)) throw invalid("Selecione pelo menos um dia da semana.");
  for (const key of ["start", "end"]) if (typeof input[key] !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input[key])) throw invalid("Informe horários válidos.");
  if (typeof input.allDay !== "boolean" || !input.allDay && input.start === input.end) throw invalid("Use horários diferentes ou marque o dia inteiro.");
  for (const key of ["fromDate", "untilDate"]) {
    if (input[key] && (typeof input[key] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input[key]) || !Number.isFinite(Date.parse(input[key])) || new Date(input[key]).toISOString().slice(0, 10) !== input[key])) throw invalid("Informe uma data válida.");
  }
  if (input.fromDate && input.untilDate && input.fromDate > input.untilDate) throw invalid("A data final deve ser igual ou posterior à inicial.");
  return { enabled: input.enabled, timeZone: zone, days: [...new Set(input.days)].sort(), start: input.start, end: input.end, allDay: input.allDay, fromDate: input.fromDate || "", untilDate: input.untilDate || "" };
}
export const defaultSchedule = () => ({ enabled: false, timeZone: zone, days: [1, 2, 3, 4, 5], start: "08:00", end: "18:00", allDay: false, fromDate: "", untilDate: "" });
export function replyStatus(config, now = Date.now()) {
  if (!config.autoReply) return { active: false, mode: "off", reason: "IA desligada" };
  const schedule = config.replySchedule;
  if (!schedule?.enabled) return { active: true, mode: "always", reason: "IA ligada sem programação" };
  const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
  let date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  let inTime = schedule.allDay || (schedule.start < schedule.end ? time >= schedule.start && time < schedule.end : time >= schedule.start || time < schedule.end);
  // A faixa que atravessa a meia-noite pertence ao dia em que começou.
  if (!schedule.allDay && schedule.start > schedule.end && time < schedule.end) date = new Date(Date.parse(date) - 86400000).toISOString().slice(0, 10);
  const weekday = new Date(date).getUTCDay() || 7;
  const active = Boolean(inTime && schedule.days.includes(weekday) && (!schedule.fromDate || date >= schedule.fromDate) && (!schedule.untilDate || date <= schedule.untilDate));
  return { active, mode: "scheduled", reason: active ? "IA ligada dentro da programação" : "IA pausada fora da programação" };
}
export function automaticAllowed(config, timestamp, now = Date.now()) {
  return replyStatus(config, now).active && replyStatus(config, timestamp ?? now).active;
}
export function assertAutomatic(config, timestamp, now) {
  if (!automaticAllowed(config, timestamp, now)) throw Object.assign(new Error("Atendimento automático pausado pelo controle de horário."), { status: 409, replyPaused: true });
}
