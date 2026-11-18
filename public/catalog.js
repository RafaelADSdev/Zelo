const $ = selector => document.querySelector(selector);
const el = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
let products = [], editing = null, pending = [], busy = false, editorOpener;
let navigateToProduct, fieldsChanged = false, savedMessage = "";
async function fetchResult(path, options) {
  let response;
  try { response = await fetch(path, options); }
  catch { throw new Error("A conexão com o Zelo foi interrompida."); }
  const result = await response.json().catch(() => { throw new Error("O Zelo não confirmou a operação."); });
  if (!response.ok) throw new Error(result?.error || "Não foi possível concluir a operação.");
  return result;
}
function request(path, data) {
  return fetchResult(path, data === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
}
function cancelUpload({ uploadId }) {
  if (!uploadId) return;
  return fetch(`/api/uploads/${uploadId}/cancel`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", keepalive: true,
  }).catch(() => {});
}
const size = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
function status(message, error = false) { $("#product-status").textContent = message; $("#product-status").classList.toggle("catalog-error", error); }
function setBusy(value) {
  busy = value;
  $("#product-fields").setAttribute("aria-busy", String(value));
  $("#product-fields").disabled = value;
  $("#save-product").disabled = value;
  $("#close-product").disabled = value;
  $("#cancel-product").disabled = value;
  $("#save-product").textContent = value ? "Salvando…" : "Salvar produto";
}
function linkRow(value = { title: "", url: "" }) {
  const row = el("div", "product-link-row");
  const title = el("input");
  title.placeholder = "Site do produto";
  title.maxLength = 120;
  title.value = value.title;
  const titleField = el("label", "", "Nome do link");
  titleField.append(title);
  const url = el("input");
  url.type = "url";
  url.placeholder = "https://…";
  url.maxLength = 2000;
  url.value = value.url;
  const urlField = el("label", "", "Endereço do link");
  urlField.append(url);
  const remove = el("button", "quiet-button", "Remover link"); remove.type = "button";
  remove.addEventListener("click", () => {
    if (title.value.trim() || url.value.trim()) fieldsChanged = true;
    row.remove();
    $("#add-product-link").focus();
  });
  row.append(titleField, urlField, remove);
  $("#product-links").append(row);
  return title;
}
function files() {
  const list = $("#product-files"); list.replaceChildren();
  const savedFiles = editing?.files || [];
  if (savedFiles.length) list.append(el("p", "product-file-label", "Arquivos anexados"));
  for (const file of savedFiles) {
    const row = el("div", "product-file");
    const info = el("div", "product-file-info");
    const link = el("a", "", file.name); link.href = file.url; link.target = "_blank"; link.rel = "noreferrer";
    info.append(link, el("small", "", size(file.size)));
    row.append(info);
    if (file.mime.startsWith("image/")) { const image = el("img"); image.src = file.url; image.alt = file.name; image.loading = "lazy"; row.prepend(image); }
    const remove = el("button", "quiet-button", "Remover"); remove.type = "button";
    remove.setAttribute('aria-label', `Remover anexo ${file.name}`);
    remove.addEventListener("click", async () => {
      if (busy) return;
      if (!confirm(`Remover “${file.name}” deste produto? Para recuperar o anexo, você terá que enviá-lo de novo.`)) return;
      setBusy(true);
      try {
        editing = await request(`/api/products/${editing.id}/files/${file.id}/remove`, { revision: editing.revision });
        files();
        updateCatalogProduct();
        status("Anexo removido.");
      } catch (error) {
        status(error.message, true);
      } finally {
        setBusy(false);
      }
      $("#product-status").focus({ preventScroll: true });
    });
    row.append(remove); list.append(row);
  }
  const selection = $("#product-pending"); selection.replaceChildren();
  if (pending.length) selection.append(el("p", "product-file-label", `${pending.length} ${pending.length === 1 ? "arquivo" : "arquivos"} para enviar ao salvar`));
  for (const [index, entry] of pending.entries()) {
    const { file } = entry;
    const row = el("div", "product-file product-pending-file");
    const remove = el("button", "quiet-button", "Remover"); remove.type = "button";
    remove.setAttribute("aria-label", `Remover da seleção ${file.name}`);
    remove.addEventListener("click", () => {
      if (busy) return;
      cancelUpload(entry);
      pending.splice(index, 1); files();
      const remaining = selection.querySelectorAll("button");
      (remaining[Math.min(index, remaining.length - 1)] || $("#product-upload")).focus();
    });
    const info = el("div", "product-file-info", file.name);
    info.append(el("small", "", size(file.size)));
    row.append(info, remove);
    selection.append(row);
  }
}
function open(productId, opener) {
  editorOpener = opener;
  navigateToProduct(productId);
}
export function showProductEditor(productId) {
  const product = products.find(item => item.id === productId);
  const unavailable = productId !== null && !product;
  editing = product || null;
  pending = [];
  fieldsChanged = false;
  $("#catalog-feedback").textContent = "";
  $("#product-form").reset();
  $("#product-form").hidden = unavailable;
  $("#product-unavailable").hidden = !unavailable;
  $("#product-editor-title").textContent = productId === null ? "Novo produto" : "Editar produto";
  $("#product-name").value = product?.name || "";
  $("#product-description").value = product?.description || "";
  $("#product-price").value = product?.price || "";
  $("#product-active").checked = product?.active ?? true;
  $("#product-links").replaceChildren();
  product?.links.forEach(linkRow);
  files();
  status("");
  $("#product-editor-title").focus({ preventScroll: true });
}
export function canLeaveProductEditor() {
  if (busy) return false;
  if ((fieldsChanged || pending.length) && !confirm("Descartar as alterações não salvas deste produto?")) return false;
  pending.forEach(cancelUpload);
  pending = [];
  return true;
}
export function returnCatalogFocus(productId) {
  $("#catalog-feedback").textContent = savedMessage;
  savedMessage = "";
  const trigger = editorOpener?.isConnected ? editorOpener : productId && document.getElementById(`edit-product-${productId}`);
  (trigger || $("#new-product")).focus();
  editorOpener = null;
}
function render() {
  const query = $("#product-search").value.trim().toLocaleLowerCase("pt-BR");
  const selected = products.filter(product => `${product.name} ${product.description}`.toLocaleLowerCase("pt-BR").includes(query));
  const list = $("#product-list"); list.replaceChildren();
  const activeCount = products.filter(product => product.active).length;
  $("#catalog-summary").textContent = query
    ? `${selected.length} ${selected.length === 1 ? "produto encontrado" : "produtos encontrados"}`
    : `${products.length} ${products.length === 1 ? "produto" : "produtos"}, ${activeCount} ${activeCount === 1 ? "ativo" : "ativos"}`;
  if (!selected.length) {
    const row = el('tr', 'product-empty-row'); const cell = el('td'); cell.colSpan = 4;
    const empty = el("div", "catalog-empty"); empty.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6v18h12V7l-4-4ZM14 3v5h4"/></svg>';
    empty.append(el("h3", "", products.length ? "Nenhum produto encontrado" : "Nenhum produto cadastrado"), el("p", "hint", products.length ? "Busque por outro nome ou por uma palavra da descrição." : "Cadastre seu primeiro produto com descrição, preço de referência e materiais."));
    if (!products.length) {
      const add = el("button", "secondary-button", "Cadastrar primeiro produto");
      add.type = "button"; add.addEventListener("click", () => open(null, add)); empty.append(add);
    }
    cell.append(empty); row.append(cell); list.append(row);
  }
  for (const product of selected) {
    const row = el('tr', 'product-row');
    const name = el('th'); name.scope = 'row';
    const title = el('button', 'product-name-button'); title.type = 'button';
    const symbol = el('span', 'product-file-symbol'); symbol.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6v18h12V7l-4-4ZM14 3v5h4"/></svg>';
    const details = el('span', 'product-row-details');
    details.append(el('span', '', product.name));
    if (product.price) details.append(el('small', '', product.price));
    title.append(symbol, details); title.addEventListener('click', () => open(product.id, title)); name.append(title);
    const state = el('td'); state.append(el('span', product.active ? 'product-state is-active' : 'product-state', product.active ? 'Ativo' : 'Arquivado'));
    const materials = el('td', 'product-table-materials', `${product.files.length} ${product.files.length === 1 ? 'arquivo' : 'arquivos'}${product.links.length ? ` · ${product.links.length} ${product.links.length === 1 ? 'link' : 'links'}` : ''}`);
    const actions = el('td'); const edit = el('button', 'product-row-action'); edit.type = 'button'; edit.setAttribute('aria-label', `Editar ${product.name}`); edit.title = `Editar ${product.name}`;
    edit.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z"/></svg>';
    edit.id = `edit-product-${product.id}`;
    edit.addEventListener('click', () => open(product.id, edit)); actions.append(edit); row.append(name, state, materials, actions); list.append(row);
  }
}
function updateCatalogProduct() {
  products = [editing, ...products.filter(product => product.id !== editing.id)];
  render();
}
export async function refreshCatalog() {
  try {
    products = await request("/api/products");
    render();
  } catch (error) {
    $("#catalog-summary").textContent = "Não foi possível atualizar o catálogo. Recarregue a página para tentar novamente.";
    throw error;
  }
}
export async function initCatalog({ openEditor, closeEditor, productCreated }) {
  navigateToProduct = openEditor;
  const newProduct = $("#new-product");
  newProduct.addEventListener("click", event => open(null, event.currentTarget));
  newProduct.disabled = false;
  $("#close-product").addEventListener("click", closeEditor);
  $("#cancel-product").addEventListener("click", closeEditor);
  $("#add-product-link").addEventListener("click", () => {
    if ($("#product-links").children.length < 15) linkRow().focus();
  });
  $("#product-search").addEventListener("input", render);
  $("#product-fields").addEventListener("input", event => {
    if (event.target !== $("#product-upload")) fieldsChanged = true;
  });
  $("#product-fields").addEventListener("focusin", event => {
    const control = event.target;
    requestAnimationFrame(() => {
      if (control !== document.activeElement) return;
      const actions = $(".product-actions");
      if (getComputedStyle(actions).position !== "sticky") return;
      const target = control.closest(".product-upload-button") || control;
      const overlap = target.getBoundingClientRect().bottom - actions.getBoundingClientRect().top;
      if (overlap > -8) window.scrollBy({ top: overlap + 8, behavior: "instant" });
    });
  });
  $("#product-upload").addEventListener("change", event => {
    if (busy) return;
    pending.push(...Array.from(event.target.files, file => ({ file }))); event.target.value = ""; files();
  });
  window.addEventListener("pagehide", event => { if (!event.persisted) pending.forEach(cancelUpload); });
  $("#product-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    status("Salvando produto…");
    let detailsSaved = false;
    try {
      if (pending.some(({ file }) => !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type) || file.size > (file.type === "application/pdf" ? 52428800 : 10485760))) throw new Error("Use imagens JPG, PNG ou WebP de até 10 MB, ou PDFs de até 50 MB.");
      if ((editing?.files.length || 0) + pending.length > 100) throw new Error("Cada produto aceita até 100 arquivos.");
      const creating = !editing;
      if (creating || fieldsChanged) {
        const links = [...$("#product-links").children].map(row => {
          const [title, url] = row.querySelectorAll("input");
          return { title: title.value.trim(), url: url.value.trim() };
        }).filter(item => item.title || item.url);
        editing = await request(editing ? `/api/products/${editing.id}` : "/api/products", { name: $("#product-name").value, description: $("#product-description").value, price: $("#product-price").value, active: $("#product-active").checked, links, ...(editing ? { revision: editing.revision } : {}) });
      }
      detailsSaved = true;
      fieldsChanged = false;
      if (creating) {
        $("#product-editor-title").textContent = "Editar produto";
        productCreated(editing.id);
      }
      while (pending.length) {
        const entry = pending[0], { file } = entry;
        entry.uploadId ??= crypto.randomUUID();
        status(`Enviando ${file.name}…`);
        const upload = await request('/api/uploads', { uploadId: entry.uploadId, productId: editing.id, name: file.name, mime: file.type, size: file.size });
        for (let offset = upload.received ?? 0; offset < file.size; offset += upload.chunkSize) {
          status(`Enviando ${file.name}… ${Math.round(offset / file.size * 100)}%`);
          await fetchResult(`/api/uploads/${upload.id}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-Offset': String(offset) }, body: file.slice(offset, offset + upload.chunkSize) });
        }
        const result = await request(`/api/uploads/${upload.id}/finish`, {});
        pending.shift();
        if (!editing.files.some(file => file.id === result.id)) { editing.files.push(result); editing.revision++; }
        files();
      }
      updateCatalogProduct();
      savedMessage = editing.active ? "Produto salvo." : "Produto arquivado. A IA consulta apenas produtos ativos.";
    } catch (error) {
      if (detailsSaved) updateCatalogProduct();
      const confirmation = detailsSaved ? " A ficha está salva." : "";
      const retry = pending.length ? "Confira os arquivos e tente salvar novamente." : "Confira os dados e tente salvar novamente.";
      status(`${error.message}${confirmation} ${retry}`, true);
      $("#product-status").focus({ preventScroll: true });
      if (!detailsSaved) await refreshCatalog().catch(() => {});
      return;
    } finally {
      setBusy(false);
    }
    closeEditor();
  });
  await refreshCatalog();
}
