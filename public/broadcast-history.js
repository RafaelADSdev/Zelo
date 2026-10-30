import { productKey, historyView } from '/broadcast-history-model.js';
import { mountResults, exportResults } from '/broadcast-results.js';
const $ = id => document.getElementById(id);
const el = (tag, text, className = '') => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
const date = value => new Date(Number(value)).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const labels = { queued: 'Na fila', paused: 'Pausado', completed: 'Concluído', cancelled: 'Cancelado', pending: 'Pendente', sending: 'Enviando', sent: 'Envio aceito', failed: 'Falhou', unknown: 'Sem confirmação' };
const cards = new Map(), groups = new Map(), expandedProducts = new Set();
let groupByProduct = true;
let api, campaigns = [], lastHistory = '', refreshing = false, acting = false;
function render() {
  const container = $('broadcast-history');
  const open = new Set([...container.querySelectorAll('details[open][data-detail]')].map(item => item.dataset.detail));
  const filters = {search:$('broadcast-search').value, state:$('broadcast-filter').value, product:$('broadcast-product-filter').value};
  const {visible, groups:productGroups} = historyView(campaigns, filters);
  $('broadcast-clear-filters').hidden = !filters.search && filters.state === 'all' && filters.product === 'all';
  $('broadcast-history-status').textContent = `${visible.length} disparo${visible.length === 1 ? '' : 's'} ${visible.length === 1 ? 'exibido' : 'exibidos'} de ${campaigns.length} no histórico recente.`;
  const overview = $('broadcast-history-overview'); overview.replaceChildren();
  for (const [label, value] of [
    ['Disparos', visible.length], ['Envios aceitos', visible.reduce((n,c) => n + (c.counts.sent || 0), 0)],
    ['Pendentes', visible.reduce((n,c) => n + (c.counts.pending || 0) + (c.counts.sending || 0), 0)],
    ['Falhas de envio', visible.reduce((n,c) => n + (c.counts.failed || 0), 0)],
  ]) { const fact = el('div', ''); fact.append(el('dt',label),el('dd',Number(value).toLocaleString('pt-BR'))); overview.append(fact); }
  const visibleIds = new Set(visible.map(item => item.id));
  container.querySelectorAll('[data-campaign-id]').forEach(child => { if (!visibleIds.has(child.dataset.campaignId)) child.remove(); });
  container.querySelector('.broadcast-empty')?.remove();
  for (const id of cards.keys()) if (!campaigns.some(item => item.id === id)) cards.delete(id);
  const place = (parent, node, index) => { if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] || null); };
  const activeGroups = new Set(groupByProduct ? productGroups.map(g => g.key) : []);
  for (const [key, group] of groups) if (!activeGroups.has(key)) {
    if (group.open) expandedProducts.add(key); else expandedProducts.delete(key);
    group.remove(); groups.delete(key);
  }
  if (!visible.length) {
    const empty = el('div', '', 'broadcast-empty');
    empty.append(el('h3', campaigns.length ? 'Nenhum disparo encontrado' : 'Seus disparos vão aparecer aqui'), el('p', campaigns.length ? 'Altere a busca ou limpe os filtros de produto e situação.' : 'Crie um novo disparo para acompanhar o progresso e os resultados.'));
    container.append(empty); return;
  }
  if (groupByProduct) for (const [index, group] of productGroups.entries()) {
    let section = groups.get(group.key);
    if (!section) {
      section = el('details', '', 'broadcast-history-group');
      section.open = expandedProducts.has(group.key);
      section.addEventListener('toggle', () => {
        if (section.open) expandedProducts.add(group.key); else expandedProducts.delete(group.key);
      });
      const heading = el('summary', '', 'broadcast-history-group-heading');
      const title = el('span', '', 'broadcast-history-group-name');
      heading.append(title, el('span', '', 'hint')); section.append(heading, el('div', '', 'broadcast-history-group-list'));
      groups.set(group.key,section);
    }
    section.querySelector('.broadcast-history-group-name').textContent = group.name;
    section.querySelector('.hint').textContent = `${group.items.length} disparo${group.items.length === 1 ? '' : 's'}`;
    place(container,section,index);
  }
  for (const [index, campaign] of visible.entries()) {
    const parent = groupByProduct ? groups.get(productKey(campaign)).lastElementChild : container;
    const position = groupByProduct ? productGroups.find(g => g.key === productKey(campaign)).items.indexOf(campaign) : index;
    const fingerprint = JSON.stringify(campaign), cached = cards.get(campaign.id);
    if (cached?.fingerprint === fingerprint) { place(parent, cached.node, position); continue; }
    cached?.node.remove();
    const count = state => campaign.counts[state] || 0;
    const processed = campaign.total - count('pending') - count('sending');
    const item = el('article', '', 'broadcast-history-item'); item.dataset.campaignId = campaign.id;
    const heading = el('div', '', 'broadcast-heading'), title = el('div', '');
    title.append(el('h3', campaign.name || (campaign.template ? `Template: ${campaign.template.name}` : 'Disparo de mensagem')), el('p', `${date(campaign.scheduled)} · ${campaign.total} destinatário${campaign.total === 1 ? '' : 's'}`, 'hint'));
    const needsReview = campaign.state === 'completed' && (count('failed') || count('unknown') || campaign.delivery_failed);
    const badge = el('span', needsReview ? 'Concluído · conferir' : labels[campaign.state], 'broadcast-badge'); badge.dataset.state = needsReview ? 'review' : campaign.state; heading.append(title, badge); item.append(heading);
    if (!groupByProduct) item.append(el('p', campaign.product?.name || 'Sem empreendimento', 'broadcast-history-product'));
    const progress = document.createElement('progress'); progress.max = campaign.total; progress.value = processed;
    progress.setAttribute('aria-label', `${processed} de ${campaign.total} destinatários processados`);
    const metrics = el('div', '', 'broadcast-result-summary');
    for (const [value, label] of [[count('sent'), 'aceitos'], [campaign.delivered, 'entregues'], [campaign.read, 'lidos'], [count('pending'), 'pendentes'], [count('sending'), 'em envio'], [count('failed'), 'falhas'], [campaign.delivery_failed, 'falhas na entrega'], [count('unknown'), 'sem confirmação'], [count('skipped'), 'ignorados'], [count('cancelled'), 'cancelados']]) if (value || label === 'aceitos') {
      const singular = {aceitos:'aceito', entregues:'entregue', lidos:'lido', pendentes:'pendente', falhas:'falha', 'falhas na entrega':'falha na entrega', ignorados:'ignorado', cancelados:'cancelado'};
      const metric = el('span', `${value} ${value === 1 ? singular[label] || label : label}`);
      if (['falhas','falhas na entrega','sem confirmação'].includes(label)) metric.className = 'broadcast-result-warning';
      metrics.append(metric);
    }
    if (['queued','paused'].includes(campaign.state)) item.append(progress);
    item.append(metrics);
    if (['queued','paused'].includes(campaign.state) && !campaign.connectionReady) item.append(el('p', 'Aguardando a conexão original do WhatsApp. Reconecte a conta usada ao criar este disparo.', 'hint'));
    if (campaign.paused_reason) item.append(el('p', campaign.paused_reason, 'hint'));
    const message = el('details', '', 'broadcast-history-content'); message.dataset.detail = `${campaign.id}:message`; message.open = open.has(message.dataset.detail);
    message.append(el('summary', campaign.template ? `Template: ${campaign.template.name}` : campaign.text || 'Mensagem sem texto', 'broadcast-history-excerpt'), el('p', campaign.template ? JSON.stringify(campaign.template, null, 2) : campaign.text, 'broadcast-history-message'));
    message.querySelector('summary').setAttribute('aria-label', 'Ver mensagem completa');
    item.append(message);
    const detail = el('details', ''); detail.dataset.campaign = campaign.id; detail.dataset.detail = `${campaign.id}:results`; detail.open = open.has(detail.dataset.detail); detail.append(el('summary', 'Ver resultados por destinatário'));
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
    actions.append(exportButton);
    if (['completed','cancelled'].includes(campaign.state)) {
      const remove = el('button', 'Excluir do histórico', 'quiet-button broadcast-delete-button'); remove.type = 'button';
      remove.addEventListener('click', async () => {
        if (acting) return;
        const description = `${campaign.name || 'Disparo de mensagem'} · ${date(campaign.scheduled)}${campaign.product?.name ? ' · ' + campaign.product.name : ''}`;
        if (!confirm(`Excluir este disparo do histórico?\n\n${description}\n\nAs mensagens já enviadas continuarão no WhatsApp.`)) return;
        acting = true; actions.querySelectorAll('button').forEach(button => button.disabled = true);
        try {
          await api('/api/broadcasts/remove', {id:campaign.id, confirmed:true});
          campaigns = campaigns.filter(item => item.id !== campaign.id); lastHistory = ''; syncProducts(); render();
          $('broadcast-search').focus({preventScroll:true});
          await refreshBroadcastHistory(true);
          $('broadcast-history-status').textContent = 'Disparo excluído do histórico. As mensagens enviadas foram preservadas.';
        } catch (error) { $('broadcast-history-status').textContent = error.message; }
        finally { acting = false; actions.querySelectorAll('button').forEach(button => button.disabled = false); }
      }); actions.append(remove);
    }
    item.append(actions); cards.set(campaign.id, { node: item, fingerprint }); place(parent, item, position);
  }
}
export async function refreshBroadcastHistory(force = false) {
  if (refreshing || (acting && !force)) return;
  refreshing = true;
  $('broadcast-refresh').disabled = true;
  $('broadcast-refresh').textContent = 'Atualizando…';
  $('broadcast-history').setAttribute('aria-busy', 'true');
  try {
    const data = await api('/api/broadcasts');
    const signature = JSON.stringify(data.campaigns);
    if (lastHistory === signature && !force) { render(); return; }
    lastHistory = signature; campaigns = data.campaigns; syncProducts(); render();

  } catch (error) { $('broadcast-history-status').textContent = `Não foi possível atualizar o histórico. ${error.message}`; throw error; }
  finally { refreshing = false; $('broadcast-refresh').disabled = false; $('broadcast-refresh').textContent = 'Atualizar'; $('broadcast-history').setAttribute('aria-busy', 'false'); }
}
function syncProducts() {
  const select = $('broadcast-product-filter'), selected = select.value;
  const products = new Map();
  for (const campaign of campaigns) if (!products.has(productKey(campaign))) products.set(productKey(campaign), campaign.product?.name || 'Sem empreendimento');
  select.replaceChildren(new Option('Todos os empreendimentos', 'all'));
  for (const [key, name] of [...products].sort((a,b) => a[1].localeCompare(b[1], 'pt-BR'))) select.append(new Option(name, key));
  select.value = products.has(selected) ? selected : 'all';
}
export function initBroadcastHistory(options) {
  api = options.api;
  $('broadcast-product-filter').addEventListener('change', render);
  $('broadcast-clear-filters').addEventListener('click', () => { $('broadcast-search').value = ''; $('broadcast-filter').value = 'all'; $('broadcast-product-filter').value = 'all'; render(); $('broadcast-search').focus(); });
  for (const [id, grouped] of [['broadcast-group-product',true], ['broadcast-group-date',false]]) $(id).addEventListener('click', () => {
    groupByProduct = grouped;
    $('broadcast-group-product').setAttribute('aria-pressed', String(grouped)); $('broadcast-group-date').setAttribute('aria-pressed', String(!grouped));
    // The product caption depends on this view; rebuild cards while preserving disclosures.
    for (const card of cards.values()) card.fingerprint = '';
    render();
  });
  $('broadcast-search').addEventListener('input', render); $('broadcast-filter').addEventListener('change', render);
}
