import { fail } from '../core/settings.mjs';
const formatters = new Map();
export function localTime(now, timezone = 'America/Sao_Paulo') {
  if (!formatters.has(timezone)) formatters.set(timezone, new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  const parts = Object.fromEntries(formatters.get(timezone).formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
export function broadcastPolicy(input, account) {
  const qr = account.startsWith('qr:');
  const integer = (key, fallback, min, max) => { const value = input[key] ?? fallback; if (!Number.isInteger(value) || value < min || value > max) throw fail(`Configuração ${key}: informe de ${min} a ${max}.`); return value; };
  const timezone = input.timezone || 'America/Sao_Paulo';
  try { localTime(0, timezone); } catch { throw fail('Fuso horário inválido.'); }
  const start = input.windowStart ?? '00:00', end = input.windowEnd ?? '00:00', days = input.days ?? [1,2,3,4,5,6,7];
  if (![start, end].every(value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) || !Array.isArray(days) || !days.length || days.some(day => !Number.isInteger(day) || day < 1 || day > 7)) throw fail('Confira a janela de horários e os dias de envio.');
  return { timezone, window_start: start, window_end: end, days: JSON.stringify([...new Set(days)].sort()), interval_ms: integer('intervalMs', qr ? 8000 : 1000, qr ? 8000 : 1000, 3600000), jitter_ms: integer('jitterMs', qr ? 17000 : 1000, qr ? 1000 : 0, 3600000), per_minute: integer('perMinute', qr ? 5 : 30, 1, qr ? 5 : 60), daily_cap: integer('dailyCap', qr ? 100 : 1000, 1, qr ? 500 : 10000) };
}
export function insideWindow(campaign, now) {
  let { date, time } = localTime(now, campaign.timezone);
  const start = campaign.window_start, end = campaign.window_end;
  if (start !== end && !(start < end ? time >= start && time < end : time >= start || time < end)) return false;
  if (start > end && time < end) date = new Date(Date.parse(date) - 86400000).toISOString().slice(0, 10);
  return JSON.parse(campaign.days).includes(new Date(date).getUTCDay() || 7);
}
