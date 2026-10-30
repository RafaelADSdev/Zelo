const $ = id => document.getElementById(id);

export function initBroadcastProduct({ api }) {
  const group = document.createElement('section'); group.className = 'broadcast-product'; group.setAttribute('aria-label', 'Produto da campanha');
  group.innerHTML = '<div class="broadcast-product-heading"><label for="broadcast-product">Produto da campanha</label><button id="broadcast-product-refresh" type="button" class="quiet-button">Atualizar catálogo</button></div><select id="broadcast-product" aria-describedby="broadcast-product-help broadcast-product-status"><option value="">Sem produto vinculado</option></select><div id="broadcast-product-card" class="broadcast-product-card" hidden><p id="broadcast-product-price" class="hint"></p><button id="broadcast-product-insert" type="button" class="secondary-button">Incluir dados na mensagem</button></div><p id="broadcast-product-help" class="hint">Escolha o produto para incluir seus dados ou criar a mensagem com IA.</p><p id="broadcast-product-status" class="hint" role="status" aria-live="polite"></p>';
  $('broadcast-kind').previousElementSibling.before(group);
  const select = $('broadcast-product'), status = $('broadcast-product-status'), insert = $('broadcast-product-insert');
  const review = document.createElement('p'); review.id = 'broadcast-review-product'; review.className = 'broadcast-product-review'; review.hidden = true; ($('broadcast-review').querySelector('.broadcast-review-message-title') || $('broadcast-review-message')).before(review);
  let products = [], selected = null, loaded = false, loading = false;
  const writer = initProductWriter({ api, product: () => products.find(item => item.id === selected?.id) || null });
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
    $('broadcast-product-price').textContent = selected?.price || 'Preço não informado no catálogo';
    $('broadcast-product-help').hidden = Boolean(selected) && $('broadcast-kind').value === 'text';
    insert.disabled = !selected || !live;
    writer.update();
    if (unavailable) status.textContent = 'O produto foi arquivado ou removido. Escolha outro produto ou selecione “Sem produto vinculado”.';
  }
  select.addEventListener('change', () => {
    if (select.value !== selected?.id) selected = products.find(item => item.id === select.value) || null;
    status.textContent = ''; render();
  });
  function kind() {
    const template = $('broadcast-kind').value === 'template'; insert.hidden = template;
    $('broadcast-product-help').hidden = Boolean(selected) && !template;
    $('broadcast-product-help').textContent = template ? 'O vínculo fica salvo na campanha. A mensagem enviada segue o template aprovado selecionado.' : 'Escolha o produto para incluir seus dados ou criar a mensagem com IA.';
    writer.update();
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

function initProductWriter({ api, product }) {
  const area = document.createElement('section'); area.className = 'broadcast-ai-writer';
  area.innerHTML = '<button id="broadcast-ai-open" type="button" class="secondary-button" aria-expanded="false" aria-controls="broadcast-ai-panel">Criar mensagem com IA</button><div id="broadcast-ai-panel" hidden><div class="broadcast-ai-panel-heading"><h3>Criar com IA</h3><button id="broadcast-ai-close" type="button" class="quiet-button">Voltar à mensagem</button></div><details id="broadcast-ai-settings" open><summary>Ajustar orientação</summary><p class="hint">Usa os materiais deste produto e sua API. Pode gerar cobrança pelo provedor e modelo configurados.</p><label for="broadcast-ai-instructions">Como você quer apresentar este produto? <span class="hint">· opcional</span></label><textarea id="broadcast-ai-instructions" rows="2" maxlength="600" placeholder="Ex.: Destaque a localização, use um tom acolhedor e convide a conhecer o produto."></textarea><p class="hint">A IA usa os conhecimentos cadastrados deste produto. Revise preços, condições e informações antes de enviar.</p><label class="broadcast-check"><input id="broadcast-ai-cost" type="checkbox">Autorizo o uso da minha API para esta geração, que pode ter custo.</label></details><button id="broadcast-ai-generate" type="button" class="primary-button" disabled>Gerar sugestão</button><p id="broadcast-ai-status" role="status" aria-live="polite" class="hint"></p><div id="broadcast-ai-suggestion" hidden><label for="broadcast-ai-text">Mensagem sugerida</label><textarea id="broadcast-ai-text" rows="6" readonly></textarea><p class="hint">Substitui o texto atual. Você pode editar antes de enviar.</p><div class="broadcast-actions"><button id="broadcast-ai-use" type="button" class="primary-button">Usar esta mensagem</button><button id="broadcast-ai-discard" type="button" class="quiet-button">Descartar sugestão</button></div></div></div>';
  $('broadcast-product-card').append(area);
  const toggle = $('broadcast-ai-open'), panel = $('broadcast-ai-panel'), cost = $('broadcast-ai-cost'), generate = $('broadcast-ai-generate'), status = $('broadcast-ai-status'), suggestion = $('broadcast-ai-suggestion');
  let context = '', busy = false, generated = null;
  const current = () => `${product()?.id || ''}:${product()?.revision || ''}:${$('broadcast-kind').value}`;
  function buttons() { generate.className = generated ? 'secondary-button' : 'primary-button'; generate.disabled = busy || !cost.checked || !product(); generate.textContent = busy ? 'Criando mensagem…' : generated ? 'Gerar outra sugestão' : 'Gerar sugestão'; }
  function close() { panel.hidden = true; toggle.hidden = false; $('broadcast-text-fields').hidden = $('broadcast-kind').value !== 'text'; toggle.setAttribute('aria-expanded', 'false'); }
  $('broadcast-ai-close').addEventListener('click', () => { close(); $('broadcast-text').focus(); });
  $('broadcast-text').addEventListener('invalid', () => { if (!panel.hidden) close(); });
  function update() {
    const next = current();
    if (next !== context) {
      context = next; generated = null; cost.checked = false; close(); $('broadcast-ai-settings').open = true; suggestion.hidden = true; status.textContent = ''; $('broadcast-ai-text').value = ''; $('broadcast-ai-instructions').value = '';
    }
    area.hidden = !product() || $('broadcast-kind').value !== 'text'; buttons();
  }
  toggle.addEventListener('click', () => { panel.hidden = false; toggle.hidden = true; toggle.setAttribute('aria-expanded', 'true'); (generated ? $('broadcast-ai-text') : $('broadcast-ai-instructions')).focus(); });
  cost.addEventListener('change', buttons);
  $('broadcast-ai-instructions').addEventListener('input', () => { generated = null; suggestion.hidden = true; status.textContent = ''; buttons(); });
  generate.addEventListener('click', async () => {
    if (busy || !cost.checked || !product() || $('broadcast-kind').value !== 'text') return;
    const started = context, chosen = product(), instructions = $('broadcast-ai-instructions').value.trim();
    busy = true; generated = null; suggestion.hidden = true; status.textContent = 'Criando uma sugestão com os conhecimentos deste produto…'; panel.setAttribute('aria-busy', 'true'); $('broadcast-ai-settings').open = true; buttons();
    try {
      const result = await api('/api/broadcasts/generate-message', { productId: chosen.id, instructions, costConfirmed: true, requestId: crypto.randomUUID() });
      if (current() !== started || $('broadcast-ai-instructions').value.trim() !== instructions) { if (current() === started) status.textContent = 'A orientação mudou durante a geração. A sugestão anterior foi descartada.'; return; }
      if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > 4000 || result.product?.id !== chosen.id || result.product?.revision !== chosen.revision) throw new Error('O produto mudou ou a sugestão retornou incompleta. Atualize o catálogo e gere novamente.');
      generated = { ...result, context: started }; $('broadcast-ai-text').value = result.text; suggestion.hidden = false; $('broadcast-ai-settings').open = false; status.textContent = 'Sugestão pronta. Revise antes de usar.'; if (!panel.hidden) $('broadcast-ai-text').focus();
    } catch (error) { if (current() === started) status.textContent = error.message; }
    finally { busy = false; panel.setAttribute('aria-busy', 'false'); buttons(); }
  });
  $('broadcast-ai-use').addEventListener('click', () => {
    if (!generated || generated.context !== current()) return;
    $('broadcast-text').value = generated.text; $('broadcast-text').dispatchEvent(new Event('input', { bubbles: true })); close(); $('broadcast-text').focus();
     generated = null; suggestion.hidden = true; $('broadcast-ai-settings').open = true; $('broadcast-product-status').textContent = 'Mensagem aplicada. Revise o texto acima antes de continuar.'; status.textContent = 'Mensagem aplicada. Você pode editar o texto e revisar o disparo antes de enviar.'; buttons();
  });
  $('broadcast-ai-discard').addEventListener('click', () => { generated = null; suggestion.hidden = true; $('broadcast-ai-text').value = ''; $('broadcast-ai-settings').open = true; status.textContent = 'Sugestão descartada. A mensagem atual foi preservada.'; buttons(); });
  update(); return { update };
}
