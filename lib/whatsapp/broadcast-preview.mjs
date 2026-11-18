import { fail } from '../core/settings.mjs';
import { recipientContent } from './broadcast-content.mjs';
import { contactName } from './contact-name.mjs';
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

// Include legacy Brazilian mobiles that normalize to the same number.
function matchingPhones(phones) {
  return [...new Set(phones.flatMap(phone => /^55\d{2}9[6-9]\d{7}$/.test(phone) ? [phone, phone.slice(0, 4) + phone.slice(5)] : [phone]))];
}

export async function cloudContacts(db, account, phones) {
  const contacts = new Map();
  if (!phones.length || !(await db.execute("SELECT 1 FROM sqlite_master WHERE name='wa_contacts'")).rows.length) return contacts;
  const { rows } = await db.execute({
    sql: 'SELECT phone,name,last_inbound FROM wa_contacts WHERE account_id=? AND phone IN (SELECT value FROM json_each(?))',
    args: [account.slice(6), JSON.stringify(matchingPhones(phones))],
  });
  for (const row of rows) {
    const phone = normalizeBroadcastPhone(row.phone);
    const previous = contacts.get(phone);
    if (!previous || Number(row.last_inbound) > Number(previous.last_inbound)) contacts.set(phone, row);
  }
  return contacts;
}

export function canReceiveCloudText(contact, at) {
  const lastInbound = Number(contact?.last_inbound);
  return lastInbound > 0 && at - lastInbound < 86400000;
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
export async function previewBroadcast({ db, optouts, connection, clock, resolveNames }, input) {
  if (!input || typeof input !== 'object') throw fail('Disparo inválido.');
  const account = connection(); if (!account || account.endsWith(':')) throw fail('Conecte seu WhatsApp antes de revisar o disparo.', 409);
  const parsed = recipientsOf(input), recipients = [], suppressed = [], outside = [];
  const cloud = account.startsWith('cloud:');
  const phones = parsed.recipients.map(item => item.phone);
  const contacts = cloud ? await cloudContacts(db, account, phones) : new Map();
  const names = new Map();
  if (cloud) {
    for (const [phone, row] of contacts) if (contactName(row.name)) names.set(phone, contactName(row.name));
  } else if (resolveNames) {
    for (const [phone, name] of await resolveNames(phones, account)) if (contactName(name)) names.set(phone, contactName(name));
  } else {
    const tables = new Set((await db.execute("SELECT name FROM sqlite_master WHERE name IN ('qr_contacts','qr_contact_names')")).rows.map(row => row.name));
    const jids = JSON.stringify(matchingPhones(phones).map(phone => `${phone}@s.whatsapp.net`));
    for (const table of ['qr_contacts','qr_contact_names']) if (tables.has(table)) {
      const rows = (await db.execute({ sql: `SELECT jid,name FROM ${table} WHERE account=? AND jid IN (SELECT value FROM json_each(?))${table === 'qr_contact_names' ? ' ORDER BY priority' : ''}`, args: [account.slice(3), jids] })).rows;
      for (const row of rows) if (contactName(row.name)) names.set(normalizeBroadcastPhone(row.jid.split('@')[0]), contactName(row.name));
    }
  }
  for (const recipient of parsed.recipients) if (!recipient.name && names.has(recipient.phone)) recipient.name = names.get(recipient.phone);
  const at = Math.max(clock(), input.scheduledAt ? Date.parse(input.scheduledAt) : clock());
  const blocked = await optouts.blockedPhones(account, phones);
  for (const recipient of parsed.recipients) {
    if (blocked.has(recipient.phone)) { suppressed.push(recipient); continue; }
    const canText = !cloud || canReceiveCloudText(contacts.get(recipient.phone), at);
    const item = { ...recipient, canText };
    if (!canText) outside.push(item);
    if (input.template || canText || !input.windowOnly) recipients.push(item);
  }
  const errors = [];
  for (const item of recipients) { try { item.preview = recipientContent(input, item); } catch (error) { errors.push({ row: item.row, phone: item.phone, reason: error.message }); } }
  return { ...parsed, normalized: parsed.recipients, recipients, suppressed, errors, named: recipients.filter(item => item.name).length, withoutName: recipients.filter(item => !item.name).length, outsideWindow: outside.length, canText: parsed.recipients.length - suppressed.length - outside.length, ready: recipients.length > 0 && !errors.length && (!cloud || !!input.template || outside.length === 0 || input.windowOnly === true), account };
}
