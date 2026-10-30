import { mountResults, exportResults } from '/broadcast-results.js';
const $ = id => document.getElementById(id);
const el = (tag, text, className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
const date = value => new Date(Number(value)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const labels = { queued: 'Na fila', paused: 'Pausado', completed: 'Concluído', cancelled: 'Cancelado', pending: 'Pendente', sending: 'Enviando', sent: 'Envio aceito', failed: 'Falhou', unknown: 'Sem confirmação' };
const cards = new Map();
let api, campaigns = [], lastHistory = '', refreshing = false, acting = false;
function render() {
  const container = $('broadcast-history');
  const open = new Set([...container.querySelectorAll('details[open]')].map(item => item.dataset.campaign));
  const search = $('broadcast-search').value.trim().toLocaleLowerCase('pt-BR'), filter = $('broadcast-filter').value;
  const visible = campaigns.filter(item => (filter === 'all' || item.state === filter) && `${item.name || ''} ${item.text} ${item.template?.name || ''}`.toLocaleLowerCase('pt-BR').includes(search));
  const visibleIds = new Set(visible.map(item => item.id));
  [...container.children].forEach(child => { if (!visibleIds.has(child.dataset.campaignId)) child.remove(); });
  for (const id of cards.keys()) if (!campaigns.some(item => item.id === id)) cards.delete(id);
  const place = (node, index) => { if (container.children[index] !== node) container.insertBefore(node, container.children[index] || null); };
  if (!visible.length) {
    const empty = el('div', '', 'broadcast-empty');
    empty.append(el('h3', campaigns.length ? 'Nenhum disparo encontrado' : 'Sua primeira mensagem começa acima.'), el('p', campaigns.length ? 'Tente outro nome ou altere o filtro de situação.' : 'Prepare a lista e revise o envio. O progresso e os resultados aparecerão aqui.'));
    container.append(empty); return;
  }
  for (const [index, campaign] of visible.entries()) {
    const fingerprint = JSON.stringify(campaign), cached = cards.get(campaign.id);
    if (cached?.fingerprint === fingerprint) { place(cached.node, index); continue; }
    [...container.children].find(child => child.dataset.campaignId === campaign.id)?.remove();
    const count = state => campaign.counts[state] || 0;
    const processed = campaign.total - count('pending') - count('sending');
    const item = el('article', '', 'broadcast-history-item'); item.dataset.campaignId = campaign.id;
    const heading = el('div', '', 'broadcast-heading'), title = el('div', '');
    title.append(el('h3', campaign.name || (campaign.template ? `Template: ${campaign.template.name}` : 'Disparo de mensagem')), el('p', `${date(campaign.scheduled)} · ${campaign.total} destinatários`, 'hint'));
    const badge = el('span', labels[campaign.state], 'broadcast-badge'); badge.dataset.state = campaign.state; heading.append(title, badge); item.append(heading);
    const progress = document.createElement('progress'); progress.max = campaign.total; progress.value = processed;
    progress.setAttribute('aria-label', `${processed} de ${campaign.total} destinatários processados`);
    item.append(progress, el('p', `${count('sent')} aceitos · ${campaign.delivered} entregues · ${campaign.read} lidos · ${campaign.delivery_failed} falhas na entrega · ${count('skipped')} ignorados · ${count('pending')} pendentes · ${count('failed')} falhas · ${count('unknown')} sem confirmação${count('cancelled') ? ` · ${count('cancelled')} cancelados` : ''}`, 'broadcast-result-summary'));
    if (['queued','paused'].includes(campaign.state) && !campaign.connectionReady) item.append(el('p', 'Aguardando a conexão original do WhatsApp. Reconecte a conta usada ao criar este disparo.', 'hint'));
    if (campaign.paused_reason) item.append(el('p', campaign.paused_reason, 'hint'));
    item.append(el('p', campaign.template ? `Template: ${campaign.template.name}` : campaign.text, 'broadcast-history-message'));
    const detail = el('details', ''); detail.dataset.campaign = campaign.id; detail.open = open.has(campaign.id); detail.append(el('summary', 'Ver resultados por destinatário'));
    mountResults({ campaign, detail, api, changed: refreshBroadcastHistory }); item.append(detail);
    const actions = el('div', '', 'broadcast-actions');
    const exportButton = el('button', 'Baixar resultados CSV', 'quiet-button'); exportButton.type = 'button';
    exportButton.addEventListener('click', async () => { exportButton.disabled = true; try { await exportResults(api, campaign.id); } catch (error) { $('broadcast-history-status').textContent = error.message; } finally { exportButton.disabled = false; } });
    if (['queued', 'paused'].includes(campaign.state)) {
      for (const [action, label] of [[campaign.state === 'paused' ? 'resume' : 'pause', campaign.state === 'paused' ? 'Retomar disparo' : 'Pausar disparo'], ['cancel', 'Cancelar pendentes']]) {
        const button = el('button', label, 'secondary-button'); button.type = 'button';
        button.addEventListener('click', async () => {
          if (acting) return; acting = true; actions.querySelectorAll('button').forEach(item => item.disabled = true);
          try { await api(`/api/broadcasts/${action}`, { id: campaign.id }); await refreshBroadcastHistory(true); $('broadcast-history-status').textContent = action === 'pause' ? 'Disparo pausado. Os pendentes foram preservados.' : action === 'resume' ? 'Disparo retomado.' : 'Envios pendentes cancelados.'; }
          catch (error) { $('broadcast-history-status').textContent = error.message; }
          finally { acting = false; actions.querySelectorAll('button').forEach(item => item.disabled = false); }
        }); actions.append(button);
      }
    }
    const duplicate = el('button', 'Duplicar disparo', 'quiet-button'); duplicate.type = 'button';
    duplicate.addEventListener('click', async () => { duplicate.disabled = true; try { const draft = await api('/api/broadcasts/duplicate', { id: campaign.id }); document.dispatchEvent(new CustomEvent('broadcast-duplicate', { detail: draft })); } catch (error) { $('broadcast-history-status').textContent = error.message; } finally { duplicate.disabled = false; } }); actions.append(duplicate);
    if (count('failed')) {
      const retry = el('button', 'Reenviar somente falhas', 'secondary-button'); retry.type = 'button'; const requestId = crypto.randomUUID();
      retry.addEventListener('click', async () => { if (!confirm('Reenviar apenas os itens com falha? Resultados sem confirmação serão preservados para conferência individual.')) return; retry.disabled = true; try { await api('/api/broadcasts/retry-failed', { id: campaign.id, requestId }); await refreshBroadcastHistory(true); } catch (error) { $('broadcast-history-status').textContent = error.message; } finally { retry.disabled = false; } }); actions.append(retry);
    }
    actions.append(exportButton); item.append(actions); cards.set(campaign.id, { node: item, fingerprint }); place(item, index);
  }
}
export async function refreshBroadcastHistory(force = false) {
  if (refreshing || (acting && !force)) return;
  refreshing = true;
  try {
    const data = await api('/api/broadcasts');
    const signature = JSON.stringify(data.campaigns);
    if (lastHistory === signature && !force) return;
    lastHistory = signature; campaigns = data.campaigns; if (force === true) cards.clear(); render();
    $('broadcast-history-status').textContent = `${campaigns.length} disparo(s) no histórico recente.`;
  } finally { refreshing = false; }
}
export function initBroadcastHistory(options) {
  api = options.api;
  $('broadcast-search').addEventListener('input', render); $('broadcast-filter').addEventListener('change', render);
}
