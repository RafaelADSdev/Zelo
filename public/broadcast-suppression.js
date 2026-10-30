import { downloadCsv } from '/broadcast-import-ui.js';
import { readContactFile, phoneNumber } from '/broadcast-import.js';
const $ = id => document.getElementById(id);
export function initSuppression({ api }) {
  let items = [], busy = false;
  async function load() {
    const data = await api('/api/optouts'); items = data.items;
    $('broadcast-optout-confirmation').value = data.confirmation;
    $('broadcast-optout-count').textContent = `${items.length} contatos suprimidos nesta conexão.`;
    const container = $('broadcast-optout-list'); container.replaceChildren();
    for (const item of items.slice(0, 100)) {
      const row = document.createElement('div'); row.className = 'broadcast-result-row';
      const text = document.createElement('span'); text.textContent = `+${item.phone} · ${item.reason}`;
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'quiet-button'; remove.textContent = 'Remover da supressão';
      remove.addEventListener('click', () => action(async () => { if (!confirm('Remover da supressão? Faça isso somente após obter nova autorização do contato.')) return; await api('/api/optouts', { phones: [item.phone], remove: true }); await load(); }));
      row.append(text, remove); container.append(row);
    }
  }
  async function action(fn) {
    if (busy) return; busy = true;
    $('broadcast-optout-status').textContent = 'Processando…';
    try { await fn(); $('broadcast-optout-status').textContent = 'Lista de supressão atualizada.'; }
    catch (error) { $('broadcast-optout-status').textContent = error.message; }
    finally { busy = false; }
  }
  const add = async phones => { for (let index = 0; index < phones.length; index += 500) await api('/api/optouts', { phones: phones.slice(index, index + 500) }); await load(); };
  $('broadcast-optout-load').addEventListener('click', () => action(load));
  $('broadcast-optout-add').addEventListener('click', () => action(async () => { const phones = $('broadcast-optout-phones').value.split(/[\n;,]+/).map(line => line.trim()).filter(Boolean); if (!phones.length || phones.some(phone => !phoneNumber(phone))) throw new Error('Informe números válidos com DDI e DDD.'); await add(phones); $('broadcast-optout-phones').value = ''; }));
  $('broadcast-optout-file').addEventListener('change', event => action(async () => {
    const file = event.target.files[0]; if (!file) return;
    const sheets = await readContactFile(file), rows = sheets[0]?.data || [];
    const column = Math.max(0, (rows[0] || []).findIndex(value => /telefone|phone|whats|celular/i.test(String(value))));
    const header = /telefone|phone|whats|celular/i.test(String(rows[0]?.[column]));
    const phones = rows.slice(header ? 1 : 0).map(row => row[column]).filter(value => value != null && String(value).trim());
    if (!phones.length || phones.some(value => !phoneNumber(value))) throw new Error('Arquivo com números inválidos. Use a primeira aba com coluna Telefone, incluindo DDI. Nenhum contato foi importado.');
    await add(phones.map(value => phoneNumber(value))); event.target.value = '';
  }));
  $('broadcast-optout-export').addEventListener('click', () => action(async () => { await load(); downloadCsv('zelo-supressao.csv', [['Telefone', 'Motivo', 'Data'], ...items.map(item => [item.phone, item.reason, new Date(Number(item.created)).toISOString()])]); }));
  $('broadcast-optout-save').addEventListener('click', () => action(async () => { await api('/api/optouts', { action: 'configure', confirmation: $('broadcast-optout-confirmation').value }); }));
}
