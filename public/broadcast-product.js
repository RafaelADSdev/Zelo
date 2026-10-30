const $ = id => document.getElementById(id);

export function initBroadcastProduct({ api }) {
  const group = document.createElement('section'); group.className = 'broadcast-product'; group.setAttribute('aria-label', 'Produto da campanha');
  group.innerHTML = '<div class="broadcast-product-heading"><label for="broadcast-product">Vincular a um produto <span>opcional</span></label><button id="broadcast-product-refresh" type="button" class="quiet-button">Atualizar catálogo</button></div><select id="broadcast-product" aria-describedby="broadcast-product-help broadcast-product-status"><option value="">Sem produto vinculado</option></select><div id="broadcast-product-card" class="broadcast-product-card" hidden><strong id="broadcast-product-name"></strong><p id="broadcast-product-price" class="hint"></p><button id="broadcast-product-insert" type="button" class="secondary-button">Incluir dados na mensagem</button></div><p id="broadcast-product-help" class="hint">O vínculo fica salvo na campanha. Use o botão para incluir nome, preço e links públicos na mensagem. Os anexos continuam no catálogo.</p><p id="broadcast-product-status" class="hint" role="status" aria-live="polite"></p>';
  $('broadcast-kind').previousElementSibling.before(group);
  const select = $('broadcast-product'), status = $('broadcast-product-status'), insert = $('broadcast-product-insert');
  const review = document.createElement('p'); review.id = 'broadcast-review-product'; review.className = 'broadcast-product-review'; review.hidden = true; $('broadcast-review-message').before(review);
  let products = [], selected = null, loaded = false, loading = false;
  const changed = () => select.dispatchEvent(new Event('input', { bubbles: true }));
  function render() {
    const live = products.find(item => item.id === selected?.id);
    if (live) selected = live;
    select.replaceChildren(new Option('Sem produto vinculado', ''));
    products.forEach(product => select.append(new Option(product.name, product.id)));
    const unavailable = selected && loaded && !live;
    if (selected && !live) { const option = new Option(`${selected.name} · ${unavailable ? 'indisponível' : 'carregando'}`, selected.id); option.disabled = true; select.append(option); }
    select.value = selected?.id || '';
    select.setCustomValidity(unavailable ? 'O produto vinculado está indisponível. Escolha outro produto ou remova o vínculo.' : '');
    $('broadcast-product-card').hidden = !selected;
    $('broadcast-product-name').textContent = selected?.name || '';
    $('broadcast-product-price').textContent = selected?.price || 'Preço não informado no catálogo';
    insert.disabled = !selected || !live;
    if (unavailable) status.textContent = 'O produto foi arquivado ou removido. Escolha outro produto ou selecione “Sem produto vinculado”.';
  }
  select.addEventListener('change', () => {
    if (select.value !== selected?.id) selected = products.find(item => item.id === select.value) || null;
    status.textContent = ''; render();
  });
  function kind() {
    const template = $('broadcast-kind').value === 'template'; insert.hidden = template;
    $('broadcast-product-help').textContent = template ? 'O vínculo fica salvo na campanha. A mensagem enviada segue o template aprovado selecionado abaixo.' : 'O vínculo fica salvo na campanha. Use o botão para incluir nome, preço e links públicos na mensagem. Os anexos continuam no catálogo.';
  }
  $('broadcast-kind').addEventListener('change', kind);
  insert.addEventListener('click', () => {
    if (!selected || insert.disabled || $('broadcast-kind').value !== 'text') return;
    const details = [selected.name, selected.price, ...(selected.links || []).map(link => `${link.title}: ${link.url}`)].filter(Boolean).join('\n');
    const text = $('broadcast-text'), value = [text.value.trimEnd(), details].filter(Boolean).join('\n\n');
    if (value.length > text.maxLength) { status.textContent = 'Os dados ultrapassam o limite de 4.000 caracteres. Encurte a mensagem antes de incluir o produto.'; return; }
    if (text.value.includes(details)) { status.textContent = 'Esses dados do produto já estão na mensagem.'; return; }
    text.value = value; text.dispatchEvent(new Event('input', { bubbles: true })); text.focus(); status.textContent = 'Dados incluídos. Você pode editar o texto antes de revisar.';
  });
  async function load() {
    if (loading) return;
    loading = true; select.disabled = true; $('broadcast-product-refresh').disabled = true; status.textContent = 'Carregando produtos…';
    try {
      products = (await api('/api/products')).filter(product => product.active); loaded = true; status.textContent = products.length ? '' : 'Nenhum produto ativo. Cadastre um em Produtos e materiais e atualize o catálogo aqui.';
      render(); changed();
    } catch (error) { status.textContent = `Não foi possível carregar o catálogo. ${error.message} Use Atualizar catálogo para tentar novamente.`; }
    finally { loading = false; select.disabled = false; $('broadcast-product-refresh').disabled = false; }
  }
  $('broadcast-product-refresh').addEventListener('click', load);
  kind(); void load();
  return {
    id: () => selected?.id || '',
    set(product) { selected = product || null; status.textContent = ''; render(); changed(); },
    review(product) { review.hidden = !product; review.textContent = product ? `Produto vinculado: ${product.name}${product.price ? ' · ' + product.price : ''}` : ''; },
  };
}
