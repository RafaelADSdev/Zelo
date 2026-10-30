export const productKey = campaign => campaign.product?.id ? `id:${campaign.product.id}` : campaign.product?.name ? `name:${campaign.product.name}` : 'none';
export function historyView(campaigns, {search = '', state = 'all', product = 'all'} = {}) {
  const query = search.trim().toLocaleLowerCase('pt-BR');
  const visible = campaigns.filter(item => (state === 'all' || item.state === state)
    && (product === 'all' || productKey(item) === product)
    && `${item.name || ''} ${item.text || ''} ${item.template?.name || ''} ${item.product?.name || ''}`.toLocaleLowerCase('pt-BR').includes(query))
    .sort((a,b) => Number(b.created ?? b.scheduled) - Number(a.created ?? a.scheduled));
  const groups = new Map();
  for (const item of visible) {
    const key = productKey(item);
    if (!groups.has(key)) groups.set(key, {key, name:item.product?.name || 'Sem empreendimento', items:[]});
    groups.get(key).items.push(item);
  }
  return {visible, groups:[...groups.values()]};
}
