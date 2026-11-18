import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = (await readFile(new URL('../public/catalog.js', import.meta.url), 'utf8')).replaceAll('export ', '');
async function fixture(fetchImpl = async () => Response.json([])) {
  const nodes = new Map();
  const document = { activeElement: null, querySelector: selector => nodes.get(selector), getElementById: id => nodes.get('#' + id), createElement: element };
  function element(tag = 'div') {
    return {
      tag, children: [], events: {}, attributes: {}, value: '', checked: true, textContent: '',
      classList: { toggle() {} },
      append(...children) { this.children.push(...children); },
      replaceChildren() { this.children = []; this.textContent = ''; },
      setAttribute(key, value) { this.attributes[key] = value; },
      addEventListener(name, handler) { this.events[name] = handler; },
      querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); },
      focus() { document.activeElement = this; }, reset() {},
    };
  }
  for (const id of ['new-product', 'close-product', 'cancel-product', 'add-product-link', 'product-search', 'product-upload', 'product-form', 'product-fields', 'save-product', 'product-status', 'product-files', 'product-pending', 'product-links', 'product-unavailable', 'product-editor-title', 'product-name', 'product-description', 'product-price', 'product-active', 'product-list', 'catalog-feedback', 'catalog-summary']) nodes.set('#' + id, element());
  const context = { document, fetch: fetchImpl, crypto, window: { addEventListener() {} } };
  runInNewContext(source, context);
  let createdId, returned = false;
  await context.initCatalog({
    openEditor: context.showProductEditor,
    closeEditor() { returned = true; context.returnCatalogFocus(createdId); },
    productCreated(id) { createdId = id; },
  });
  const trigger = nodes.get('#new-product');
  trigger.events.click({ currentTarget: trigger });
  return {
    get: id => nodes.get('#' + id), document,
    get createdId() { return createdId; },
    get returned() { return returned; },
    select(files) { const input = nodes.get('#product-upload'); input.files = files; input.value = 'selected'; input.events.change({ target: input }); },
    submit() { return nodes.get('#product-form').events.submit({ preventDefault() {} }); },
  };
}
const file = name => ({ name, type: 'application/pdf', size: 12 });

test('catálogo: seleções sucessivas preservam arquivos e a remoção individual mantém o foco', async () => {
  const f = await fixture();
  f.select([file('Primeiro.pdf')]); f.select([file('Segundo.pdf')]); f.select([]);
  const selection = f.get('product-pending');
  assert.equal(selection.children.length, 3);
  assert.match(selection.children[1].children[0].textContent, /Primeiro.pdf/);
  assert.match(selection.children[2].children[0].textContent, /Segundo.pdf/);
  assert.equal(f.get('product-upload').value, '');
  selection.querySelectorAll('button')[0].events.click();
  assert.match(selection.children[1].children[0].textContent, /Segundo.pdf/);
  assert.equal(f.document.activeElement, selection.querySelectorAll('button')[0]);
  selection.querySelectorAll('button')[0].events.click();
  assert.equal(selection.children.length, 0);
  assert.equal(f.document.activeElement, f.get('product-upload'));
});

test('catálogo: falha no upload libera os campos, preserva a seleção e orienta a retomada', async () => {
  let release, reached;
  const gate = new Promise(resolve => { release = resolve; });
  const uploading = new Promise(resolve => { reached = resolve; });
  const product = { id: 'test', revision: 1, name: 'Teste', files: [], links: [], active: true };
  const f = await fixture(async (path, options) => {
    if (path === '/api/uploads') { reached(); await gate; return Response.json({ error: 'Envio indisponível.' }, { status: 503 }); }
    if (options?.method === 'POST') return Response.json(product);
    return Response.json([]);
  });
  f.select([file('Material.pdf')]);
  const saving = f.submit(); await uploading;
  assert.equal(f.get('product-fields').disabled, true);
  assert.equal(f.get('close-product').disabled, true);
  assert.equal(f.get('cancel-product').disabled, true);
  assert.equal(f.get('product-fields').attributes['aria-busy'], 'true');
  assert.equal(f.get('product-form').attributes['aria-busy'], undefined);
  release(); await saving;
  assert.equal(f.get('product-fields').disabled, false);
  assert.equal(f.get('save-product').disabled, false);
  assert.match(f.get('product-pending').children[1].children[0].textContent, /Material.pdf/);
  assert.match(f.get('product-status').textContent, /Envio indisponível.*A ficha está salva.*tente salvar novamente/);
  assert.equal(f.createdId, product.id);
  assert.equal(f.returned, false);
});

test('catálogo: salvar um produto arquivado não anuncia disponibilidade para a IA', async () => {
  const product = { id: 'test', revision: 1, name: 'Teste', files: [], links: [], active: false };
  const f = await fixture(async (path, options) => Response.json(options?.method === 'POST' ? product : [product]));
  f.get('product-active').checked = false;
  await f.submit();
  assert.equal(f.returned, true);
  assert.match(f.get('catalog-feedback').textContent, /Produto arquivado\. A IA consulta apenas produtos ativos/);
  assert.equal(f.get('product-fields').disabled, false);
});

test('catálogo: uma resposta perdida no fim do upload retoma sem reenviar bytes nem editar a ficha novamente', async () => {
  const product = { id: 'test', revision: 1, name: 'Teste', files: [], links: [], active: true };
  const saved = { id: 'file', mime: 'application/pdf', name: 'Material.pdf', size: 12, url: '/api/files/file' };
  let uploaded = false, uploadWrites = 0, productWrites = 0, finishes = 0, uploadId;
  const f = await fixture(async (path, options) => {
    if (path === '/api/uploads') {
      const data = JSON.parse(options.body);
      uploadId ??= data.uploadId;
      assert.equal(data.uploadId, uploadId);
      return Response.json({ id: uploadId, chunkSize: 100, received: uploaded ? 12 : 0 });
    }
    if (path.endsWith('/finish')) {
      if (++finishes === 1) throw new Error('Conexão interrompida.');
      return Response.json(saved);
    }
    if (path.startsWith('/api/uploads/')) { uploaded = true; uploadWrites++; return Response.json({ received: 12 }); }
    if (options?.method === 'POST') { productWrites++; return Response.json(product); }
    return Response.json([]);
  });
  f.select([{ ...file('Material.pdf'), slice: () => new Uint8Array(12) }]);
  await f.submit();
  assert.equal(f.returned, false);
  assert.match(f.get('product-status').textContent, /conexão com o Zelo foi interrompida.*tente salvar novamente/i);
  await f.submit();
  assert.equal(f.returned, true);
  assert.equal(uploadWrites, 1);
  assert.equal(productWrites, 1);
  assert.equal(finishes, 2);
  assert.equal(f.get('product-files').querySelectorAll('a').length, 1);
});
