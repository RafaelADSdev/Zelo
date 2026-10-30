import { fail } from '../core/settings.mjs';
const ddds = new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
export function normalizeBroadcastPhone(value, country = '') {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value);
  if (typeof value !== 'string' || !/^\+?[\d\s().-]+$/.test(value.trim())) return null;
  let phone = value.replace(/\D/g, '');
  if (country === '55' && [10,11].includes(phone.length) && !value.trim().startsWith('+')) phone = '55' + phone;
  if (!/^[1-9]\d{6,14}$/.test(phone)) return null;
  if (phone.startsWith('55') && [12,13].includes(phone.length)) {
    if (!ddds.has(phone.slice(2,4))) return null;
    if (phone.length === 12 && /^[6-9]/.test(phone.slice(4))) phone = phone.slice(0,4) + '9' + phone.slice(4);
  }
  return phone;
}
export function recipientsOf(input) {
  let rows;
  if (input.recipients !== undefined) {
    if (!Array.isArray(input.recipients)) throw fail('Lista de destinatários inválida.');
    rows = input.recipients;
  } else {
    if (typeof input.phones !== 'string' || input.phones.length > 25000) throw fail('Informe uma lista de números.');
    rows = input.phones.split(/[\n;,]+/).map(phone => phone.trim()).filter(Boolean).map(phone => ({ phone }));
  }
  if (!rows.length || rows.length > 500 || JSON.stringify(rows).length > 512000) throw fail('Informe de 1 a 500 números por disparo, com dados de até 512 KB.');
  const recipients = [], invalid = [], seen = new Set(); let duplicates = 0;
  rows.forEach((row, index) => {
    const phone = normalizeBroadcastPhone(row?.phone, input.country || '');
    if (!phone) { invalid.push({ row: index + 1, reason: 'Número inválido. Confira DDI, DDD e dígitos.' }); return; }
    if (seen.has(phone)) { duplicates++; return; } seen.add(phone);
    if (typeof (row.name ?? '') !== 'string' || (row.name || '').length > 200 || !row.vars && row.vars !== undefined) throw fail(`Nome ou variáveis inválidos na linha ${index + 1}.`);
    const vars = row.vars ?? {};
    if (typeof vars !== 'object' || Array.isArray(vars) || Object.keys(vars).length > 32 || Object.entries(vars).some(([key, value]) => !/^[a-z][a-z0-9_]{0,39}$/.test(key) || ['constructor','prototype','__proto__'].includes(key) || !['string','number'].includes(typeof value) || String(value).length > 1000)) throw fail(`Variáveis inválidas na linha ${index + 1}. Use até 32 colunas com valores de até 1.000 caracteres.`);
    recipients.push({ phone, name: (row.name || '').trim(), vars: Object.fromEntries(Object.entries(vars).map(([key,value]) => [key, String(value)])), row: index + 1 });
  });
  return { recipients, invalid, duplicates, total: rows.length };
}
export async function previewBroadcast({ db, optouts, connection, clock }, input) {
  if (!input || typeof input !== 'object') throw fail('Disparo inválido.');
  const account = connection(); if (!account || account.endsWith(':')) throw fail('Conecte seu WhatsApp antes de revisar o disparo.', 409);
  const parsed = recipientsOf(input), recipients = [], suppressed = [], outside = [];
  const cloud = account.startsWith('cloud:');
  let contacts = new Map();
  if (cloud && (await db.execute("SELECT name FROM sqlite_master WHERE name='wa_contacts'")).rows.length) contacts = new Map((await db.execute({ sql: 'SELECT phone,last_inbound FROM wa_contacts WHERE account_id=?', args: [account.slice(6)] })).rows.map(row => [normalizeBroadcastPhone(row.phone), Number(row.last_inbound)]));
  const at = Math.max(clock(), input.scheduledAt ? Date.parse(input.scheduledAt) : clock());
  for (const recipient of parsed.recipients) {
    if (await optouts.blocked(account, recipient.phone)) { suppressed.push(recipient); continue; }
    const canText = !cloud || contacts.has(recipient.phone) && contacts.get(recipient.phone) > 0 && at - contacts.get(recipient.phone) < 86400000;
    const item = { ...recipient, canText };
    if (!canText) outside.push(item);
    if (input.template || canText || !input.windowOnly) recipients.push(item);
  }
  return { ...parsed, normalized: parsed.recipients, recipients, suppressed, outsideWindow: outside.length, canText: parsed.recipients.length - suppressed.length - outside.length, ready: recipients.length > 0 && (!cloud || !!input.template || outside.length === 0 || input.windowOnly === true), account };
}
