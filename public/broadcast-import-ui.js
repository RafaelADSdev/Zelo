import { readContactFile, inspectNumbers, phoneNumber, importRecipients } from '/broadcast-import.js';
const $ = id => document.getElementById(id);
const el = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
export function downloadCsv(name, rows) {
  const cell = value => { let text = String(value ?? ''); if (/^[\s]*[=+@-]/.test(text)) text = "'" + text; return `"${text.replaceAll('"', '""')}"`; };
  const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = el('a', ''); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function initBroadcastImport({ changed }) {
  let sheets = [], result, reading = false;
  const currentRows = () => sheets[Number($('broadcast-sheet').value)]?.data || [];
  function preview() {
    result = inspectNumbers(currentRows(), { column: Number($('broadcast-column').value), header: $('broadcast-header').checked, country: $('broadcast-country').value });
    $('broadcast-import-summary').textContent = `${result.phones.length} válidos · ${result.duplicates} duplicados · ${result.invalid.length} inválidos · ${result.empty} vazios`;
    const rows = $('broadcast-import-rows'); rows.replaceChildren();
    if (result.phones.length) {
      const list = el('ul', ''); result.phones.slice(0, 8).forEach(phone => list.append(el('li', `+${phone}`))); rows.append(list);
    } else rows.append(el('p', 'Nenhum número válido nesta coluna. Escolha a coluna dos telefones.'));
    if (result.invalid.length) rows.append(el('p', `Revise as linhas ${result.invalid.slice(0, 6).map(item => item.row).join(', ')}${result.invalid.length > 6 ? '…' : ''}. Baixe as linhas inválidas para corrigir a lista.`));
    $('broadcast-import-apply').disabled = result.phones.length === 0 || result.phones.length > 500;
    $('broadcast-import-apply').textContent = `Adicionar ${result.phones.length} números válidos`;
    $('broadcast-import-errors').hidden = !result.invalid.length;
    $('broadcast-import-status').textContent = result.phones.length > 500 ? 'A lista ultrapassa 500 números únicos. Divida o arquivo em disparos menores; nenhum número foi cortado.' : '';
  }
  function columns() {
    const rows = currentRows(), width = Math.max(0, ...rows.map(row => row.length));
    const header = $('broadcast-header').checked, select = $('broadcast-column'); select.replaceChildren();
    $('broadcast-name-column').replaceChildren(new Option('Não importar nome', '')); $('broadcast-variable-columns').replaceChildren(); const keys = new Set();
    let suggested = 0, best = -1;
    for (let i = 0; i < width; i++) {
      const label = header ? String(rows[0]?.[i] ?? '').slice(0, 70) : '';
      select.append(new Option(`${String.fromCharCode(65 + Math.floor(i / 26) - 1).replace('@', '')}${String.fromCharCode(65 + i % 26)}${label ? ` · ${label}` : ''}`, String(i)));
      $('broadcast-name-column').append(new Option(`${i + 1} · ${label || 'Coluna'}`, String(i)));
      if (/^(nome|name|cliente)$/i.test(label.trim())) $('broadcast-name-column').value = String(i);
      let key = (label || 'coluna_' + (i + 1)).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 32);
      if (!/^[a-z]/.test(key) || ['nome','constructor','prototype','__proto__'].includes(key)) key = 'coluna_' + (i + 1);
      if (keys.has(key)) key += '_' + i; keys.add(key);
      const wrap = el('label', `{${key}}`), check = document.createElement('input'); check.type = 'checkbox'; check.value = String(i); check.dataset.key = key; check.checked = false; check.addEventListener('change', preview); wrap.prepend(check); $('broadcast-variable-columns').append(wrap);
      const score = /telefone|celular|whats|phone|numero|número/i.test(label) ? 10000 : rows.slice(header ? 1 : 0, 51).filter(row => phoneNumber(row[i])).length;
      if (score > best) { best = score; suggested = i; }
    }
    select.value = String(suggested); preview();
  }
  async function openFile(file) {
    if (reading || !file) return;
    reading = true; $('broadcast-file').disabled = true;
    $('broadcast-import-status').textContent = 'Lendo arquivo…'; $('broadcast-import-preview').hidden = true;
    try {
      sheets = await readContactFile(file);
      if (!sheets.some(sheet => sheet.data.some(row => row.some(value => value != null && String(value).trim())))) throw new Error('A planilha está vazia. Adicione os números e tente novamente.');
      $('broadcast-sheet').replaceChildren(...sheets.map((sheet, index) => new Option(sheet.sheet, String(index))));
      const firstNonempty = sheets.findIndex(sheet => sheet.data.length); $('broadcast-sheet').value = String(Math.max(0, firstNonempty));
      const first = currentRows()[0] || [];
      $('broadcast-header').checked = first.some(value => /telefone|celular|whats|phone|nome|numero|número/i.test(String(value ?? '')));
      $('broadcast-filename').textContent = file.name; columns();
      $('broadcast-import-preview').hidden = false; if (result.phones.length <= 500) $('broadcast-import-status').textContent = 'Arquivo aberto. Confira a aba, a coluna e o DDI antes de adicionar.';
      $('broadcast-column').focus();
    } catch (error) { sheets = []; result = null; $('broadcast-import-status').textContent = error.message; }
    finally { reading = false; $('broadcast-file').disabled = false; $('broadcast-file').value = ''; }
  }
  $('broadcast-file').addEventListener('change', event => openFile(event.target.files[0]));
  $('broadcast-sheet').addEventListener('change', columns);
  $('broadcast-header').addEventListener('change', columns);
  $('broadcast-column').addEventListener('change', preview);
  $('broadcast-country').addEventListener('change', preview);
  $('broadcast-name-column').addEventListener('change', preview);
  $('broadcast-import-close').addEventListener('click', () => { $('broadcast-import-preview').hidden = true; $('broadcast-import-status').textContent = 'Prévia fechada. A lista atual foi mantida.'; $('broadcast-file').focus(); });
  $('broadcast-import-apply').addEventListener('click', () => {
    if (!result || !result.phones.length || result.phones.length > 500) return;
    const existing = $('broadcast-phones').value.split(/[\n;,]+/).map(line => line.trim()).filter(Boolean);
    const unique = new Set(existing.map(line => phoneNumber(line) || line)); let added = 0;
    result.phones.forEach(phone => { if (!unique.has(phone)) { unique.add(phone); added++; } });
    if (unique.size > 500) { $('broadcast-import-status').textContent = 'Somando à lista atual, são mais de 500 destinatários. Reduza a lista antes de adicionar.'; return; }
    const extras = [...$('broadcast-variable-columns').querySelectorAll('input:checked')];
    if (extras.length > 32) { $('broadcast-import-status').textContent = 'Selecione até 32 colunas para personalização.'; return; }
    const recipients = importRecipients(currentRows(), { column: Number($('broadcast-column').value), nameColumn: $('broadcast-name-column').value === '' ? null : Number($('broadcast-name-column').value), header: $('broadcast-header').checked, country: $('broadcast-country').value, variables: extras.map(input => ({ key: input.dataset.key, column: Number(input.value) })) });
    $('broadcast-phones').value = [...unique].join('\n'); changed({ recipients });
    $('broadcast-import-preview').hidden = true;
    $('broadcast-import-status').textContent = `${added} números adicionados. ${result.phones.length - added} já estavam na lista. ${result.invalid.length} linhas inválidas não foram importadas.`;
    $('broadcast-phones').focus();
  });
  $('broadcast-import-errors').addEventListener('click', () => {
    if (result) downloadCsv('zelo-linhas-invalidas.csv', [['Linha', 'Valor'], ...result.invalid.map(item => [item.row, item.value])]);
  });
  $('broadcast-model').addEventListener('click', () => downloadCsv('zelo-modelo-contatos.csv', [['Nome', 'Telefone'], ['Exemplo — substitua pelo seu contato', '5511999999999']]));
}
