// Shared by the import preview and the recipient editor. No message is sent here.
export function phoneNumber(value, country = '') {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return null;
    value = String(value);
  }
  if (typeof value !== 'string' || !/^\+?[\d\s().-]+$/.test(value.trim())) return null;
  let phone = value.replace(/\D/g, '');
  if (country === '55' && [10, 11].includes(phone.length) && !value.trim().startsWith('+')) phone = '55' + phone;
  return /^[1-9]\d{6,14}$/.test(phone) ? phone : null;
}
export function formatPhone(value, country = '55') {
  const phone = phoneNumber(value, country), original = String(value ?? '');
  if (!phone) return original;
  if (phone.startsWith('55') && [12, 13].includes(phone.length)) return `+55 ${phone.slice(2, 4)} ${phone.slice(4, -4)}-${phone.slice(-4)}`;
  return original.trim().startsWith('+') || phone.length > 11 ? '+' + phone : original;
}
export function formatPhoneList(value, country = '55') {
  return value.split(/[\n;,]/).map(line => formatPhone(line.trim(), country)).join('\n');
}
export function bindPhoneFormatting(control, { multiple = false } = {}) {
  control.placeholder = multiple ? '+55 81 8593-2808\n+55 11 99999-9999' : '+55 81 8593-2808';
  if (!multiple) { control.inputMode = 'tel'; control.autocomplete = 'tel'; }
  function format() {
    const original = control.value, next = multiple ? formatPhoneList(original) : formatPhone(original);
    if (original === next) return;
    const atEnd = control.selectionStart === original.length && control.selectionEnd === original.length;
    const start = control.selectionStart, end = control.selectionEnd;
    control.value = next;
    // Full international numbers keep every digit; preserve edits in the middle.
    const caret = index => {
      const digits = original.slice(0, index).replace(/\D/g, '').length;
      if (!digits) return 0;
      let seen = 0;
      for (let i = 0; i < next.length; i++) if (/\d/.test(next[i]) && ++seen === digits) return i + 1;
      return next.length;
    };
    if (atEnd) control.setSelectionRange(next.length, next.length);
    else control.setSelectionRange(caret(start), caret(end));
    control.dispatchEvent(new Event('input', { bubbles: true }));
  }
  control.addEventListener('blur', format);
  control.addEventListener('change', format);
  control.addEventListener('input', event => {
    if (event.isComposing) return;
    // Do not add a country code mid-typing: the user may still be entering 55.
    const fullBrazilian = /^55\d{10,11}$/.test(control.value.replace(/[+\s().-]/g, ''));
    if (['insertFromPaste', 'insertFromDrop'].includes(event.inputType) || fullBrazilian) format();
  });
  return format;
}
export function spreadsheetRows(rows) {
  if (!Array.isArray(rows) || rows.length > 5001) throw new Error('Use uma planilha com até 5.000 linhas de dados. Divida o arquivo em listas menores.');
  if (rows.some(row => !Array.isArray(row) || row.length > 60)) throw new Error('Use uma planilha com até 60 colunas.');
  return rows;
}
export function parseCsv(input) {
  let text = input.replace(/^\uFEFF/, ''), separator;
  const directive = text.match(/^sep=([;,\t])\r?\n/i);
  if (directive) { separator = directive[1]; text = text.slice(directive[0].length); }
  if (!separator) {
    const counts = { ';': 0, ',': 0, '\t': 0 }; let quoted = false;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '"') { if (quoted && text[i + 1] === '"') i++; else quoted = !quoted; }
      else if (!quoted && /[\r\n]/.test(text[i])) break;
      else if (!quoted && text[i] in counts) counts[text[i]]++;
    }
    separator = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  }
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  const addCell = () => { row.push(cell); cell = ''; closed = false; if (row.length > 60) throw new Error('Use uma planilha com até 60 colunas.'); };
  const addRow = () => { addCell(); rows.push(row); row = []; if (rows.length > 5001) throw new Error('Use uma planilha com até 5.000 linhas de dados.'); };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += char;
    } else if (char === separator) addCell();
    else if (char === '\r' || char === '\n') { addRow(); if (char === '\r' && text[i + 1] === '\n') i++; }
    else if (char === '"' && !cell.trim() && !closed) { cell = ''; quoted = true; }
    else if (closed && char.trim()) throw new Error('CSV com aspas fora do lugar. Salve novamente como CSV e tente importar.');
    else cell += char;
  }
  if (quoted) throw new Error('O CSV tem aspas sem fechamento. Corrija o arquivo e tente novamente.');
  if (cell || row.length) addRow();
  while (rows.length && rows.at(-1).every(value => !value.trim())) rows.pop();
  return spreadsheetRows(rows);
}
export function inspectNumbers(rows, { column = 0, header = false, country = '' } = {}) {
  const phones = [], invalid = [], seen = new Set(); let duplicates = 0, empty = 0;
  for (let index = header ? 1 : 0; index < rows.length; index++) {
    const value = rows[index][column];
    if (value == null || String(value).trim() === '') { empty++; continue; }
    const phone = phoneNumber(value, country);
    if (!phone) invalid.push({ row: index + 1, value: String(value) });
    else if (seen.has(phone)) duplicates++;
    else { seen.add(phone); phones.push(phone); }
  }
  return { phones, invalid, duplicates, empty };
}
export function importRecipients(rows, { column = 0, nameColumn = null, header = false, country = '', variables = [] } = {}) {
  const recipients = [], seen = new Set();
  for (let index = header ? 1 : 0; index < rows.length; index++) {
    const phone = phoneNumber(rows[index][column], country);
    if (!phone || seen.has(phone)) continue; seen.add(phone);
    recipients.push({ phone, name: nameColumn == null ? '' : String(rows[index][nameColumn] ?? ''), vars: Object.fromEntries(variables.map(item => [item.key, String(rows[index][item.column] ?? '')])) });
  }
  return recipients;
}

// Bound the ZIP expansion before passing an XLSX archive to the parser.
function checkXlsxArchive(buffer) {
  const view = new DataView(buffer); let end = -1;
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('O arquivo não é uma planilha Excel .xlsx válida.');
  const entries = view.getUint16(end + 10, true); let offset = view.getUint32(end + 16, true), expanded = 0;
  if (entries > 2000) throw new Error('A planilha tem muitos arquivos internos. Exporte apenas a aba de contatos.');
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== 0x02014b50) throw new Error('A planilha está incompleta ou danificada.');
    expanded += view.getUint32(offset + 24, true);
    if (expanded > 20 * 1024 * 1024) throw new Error('A planilha é grande demais após abrir. Exporte apenas os números em CSV.');
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
}
export async function readContactFile(file) {
  if (!file || file.size > 2 * 1024 * 1024) throw new Error('Escolha um arquivo de até 2 MB.');
  const extension = file.name.toLowerCase().split('.').pop();
  if (!['csv', 'xlsx'].includes(extension)) throw new Error('Use CSV ou Excel .xlsx. Para um arquivo .xls antigo, salve como .xlsx no Excel.');
  const buffer = await file.arrayBuffer();
  if (extension === 'csv') {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch { text = new TextDecoder('windows-1252').decode(buffer); }
    return [{ sheet: file.name, data: parseCsv(text) }];
  }
  checkXlsxArchive(buffer);
  await import('/vendor/read-excel-file.js');
  let sheets;
  try { sheets = await globalThis.readXlsxFile(buffer); }
  catch { throw new Error('Não foi possível abrir o Excel. Use um .xlsx sem senha ou exporte a lista como CSV.'); }
  if (!Array.isArray(sheets) || sheets.length > 30) throw new Error('Use um arquivo com até 30 abas.');
  return sheets.map(sheet => ({ sheet: sheet.sheet, data: spreadsheetRows(sheet.data) }));
}
