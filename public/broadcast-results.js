import { downloadCsv } from '/broadcast-import-ui.js';
const el = (tag, text, className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
const labels = { pending: 'Pendente', sending: 'Enviando', sent: 'Envio aceito', failed: 'Falhou', unknown: 'Sem confirmação', skipped: 'Ignorado', cancelled: 'Cancelado', delivered: 'Entregue', read: 'Lida' };
const status = item => item.resolution === 'delivered' ? 'Entrega confirmada pelo operador' : item.delivery_status === 'failed' ? 'Falha na entrega' : labels[item.delivery_status] || labels[item.state];
export function mountResults({ campaign, detail, api, changed }) {
  const container = el('div', '', 'broadcast-results'); const note = el('p', '', 'hint'); note.setAttribute('role', 'status');
  const more = el('button', 'Carregar mais destinatários', 'secondary-button'); more.type = 'button'; more.hidden = true;
  const audit = el('details', ''); audit.append(el('summary', 'Registro de decisões do operador'));
  detail.append(note, container, more, audit); let page = 0, busy = false;
  async function load() {
    if (busy) return; busy = true; more.disabled = true; note.textContent = 'Carregando destinatários…';
    try {
      const data = await api(`/api/broadcasts/${campaign.id}?page=${page + 1}&limit=50`); page++;
      for (const recipient of data.items) {
        const row = el('div', '', 'broadcast-result-row');
        row.append(el('strong', `+${recipient.phone}${recipient.name ? ' · ' + recipient.name : ''}`), el('span', status(recipient)));
        if (recipient.error || recipient.skip_reason) row.append(el('p', recipient.error || recipient.skip_reason, 'hint'));
        if (recipient.state === 'unknown') for (const [decision, label] of [['delivered', 'Confirmei que foi entregue'], ['retry', 'Não chegou, reenviar']]) {
          const button = el('button', label, 'secondary-button'); button.type = 'button'; const requestId = crypto.randomUUID();
          button.addEventListener('click', async () => {
            if (!confirm(decision === 'retry' ? 'Confira a conversa. Um resultado incerto pode já ter chegado. Você confirma que não chegou e autoriza uma nova tentativa, com risco de duplicação?' : 'Você conferiu a conversa e confirma a entrega? Sua decisão ficará registrada.')) return;
            button.disabled = true;
            try { await api('/api/broadcasts/resolve', { id: campaign.id, itemId: recipient.id, decision, confirmed: true, requestId }); await changed(true); }
            catch (error) { note.textContent = error.message; } finally { button.disabled = false; }
          }); row.append(button);
        }
        if (recipient.resolved_by) row.append(el('p', `Conferido por ${recipient.resolved_by}`, 'hint'));
        container.append(row);
      }
      more.hidden = page * data.limit >= data.total; note.textContent = `${Math.min(page * data.limit, data.total)} de ${data.total} destinatários.`;
      if (page === 1) for (const record of data.audit) {
        const names = { resolve: 'Resultado conferido', retry_failed: 'Falhas reenfileiradas' };
        audit.append(el('p', `${new Date(Number(record.created)).toLocaleString('pt-BR')} · ${record.actor} · ${names[record.action] || record.action} · ${JSON.parse(record.detail).decision}`, 'hint'));
      }
    } catch (error) { note.textContent = error.message; }
    finally { busy = false; more.disabled = false; }
  }
  more.addEventListener('click', load); detail.addEventListener('toggle', () => { if (detail.open && page === 0) load(); });
  if (detail.open) load();
}
export async function exportResults(api, id) {
  const items = []; let page = 1, data;
  do { data = await api(`/api/broadcasts/${id}?page=${page++}&limit=100`); items.push(...data.items); } while (items.length < data.total && data.items.length);
  downloadCsv(`zelo-resultados-${id.slice(0,8)}.csv`, [['Telefone','Nome','Situação do envio','Entrega','Erro ou motivo','Tentativas','Decisão','Operador','ID da mensagem'], ...items.map(item => [item.phone, item.name, labels[item.state], status(item), item.error || item.skip_reason, item.attempts, item.resolution, item.resolved_by, item.message_id])]);
}
