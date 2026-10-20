const $ = selector => document.querySelector(selector);
const el = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
let products = [], editing = null, pending = [], busy = false;
async function request(path, data) {
  const response = await fetch(path, data === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || "Não foi possível concluir."); return result;
}
const size = bytes => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
function status(message, error = false) { $("#product-status").textContent = message; $("#product-status").classList.toggle("catalog-error", error); }
function linkRow(value = { title: "", url: "" }) {
  const row = el("div", "product-link-row");
  const title = el("input"); title.placeholder = "Nome do link · ex.: Site, vídeo, book"; title.setAttribute("aria-label", "Nome do link"); title.maxLength = 120; title.value = value.title;
  const url = el("input"); url.type = "url"; url.placeholder = "https://…"; url.setAttribute("aria-label", "Endereço do link"); url.maxLength = 2000; url.value = value.url;
  const remove = el("button", "quiet-button", "Remover link"); remove.type = "button"; remove.addEventListener("click", () => row.remove());
  row.append(title, url, remove); $("#product-links").append(row);
}
function files() {
  const list = $("#product-files"); list.replaceChildren();
  for (const file of editing?.files || []) {
    const row = el("div", "product-file");
    const link = el("a", "", `${file.name} · ${size(file.size)}`); link.href = file.url; link.target = "_blank"; link.rel = "noreferrer";
    row.append(link);
    if (file.mime.startsWith("image/")) { const image = el("img"); image.src = file.url; image.alt = file.name; image.loading = "lazy"; row.prepend(image); }
    const remove = el("button", "quiet-button", "Remover anexo"); remove.type = "button";
    remove.addEventListener("click", async () => {
      if (busy) return;
      if (!confirm(`Remover o anexo “${file.name}” deste produto? Será necessário enviá-lo novamente para recuperar.`)) return;
      busy = true; remove.disabled = true;
      try { editing = await request(`/api/products/${editing.id}/files/${file.id}/remove`, { revision: editing.revision }); files(); await refreshCatalog(); status("Anexo removido."); }
      catch (error) { status(error.message, true); } finally { busy = false; remove.disabled = false; }
    });
    row.append(remove); list.append(row);
  }
  $("#product-pending").textContent = pending.length ? `Para enviar: ${pending.map(file => `${file.name} (${size(file.size)})`).join(", ")}` : "";
}
function open(product = null) {
  if (busy) return;
  editing = product; pending = []; $("#product-form").reset();
  $("#product-editor").hidden = false; $("#product-editor-title").textContent = product ? `Editar ${product.name}` : "Novo produto";
  $("#product-name").value = product?.name || ""; $("#product-description").value = product?.description || ""; $("#product-price").value = product?.price || "";
  $("#product-active").checked = product?.active ?? true;
  $("#product-links").replaceChildren(); (product?.links || []).forEach(linkRow); if (!product?.links.length) linkRow();
  files(); status(""); $("#product-editor").scrollIntoView({ behavior: "smooth", block: "start" }); $("#product-name").focus();
}
function render() {
  const query = $("#product-search").value.toLocaleLowerCase("pt-BR");
  const selected = products.filter(product => `${product.name} ${product.description}`.toLocaleLowerCase("pt-BR").includes(query));
  const list = $("#product-list"); list.replaceChildren();
  $("#catalog-count").textContent = `${products.filter(product => product.active).length} ativo(s) · ${products.length} cadastrado(s)`;
  $("#catalog-summary").textContent = query ? `${selected.length} ${selected.length === 1 ? "produto encontrado" : "produtos encontrados"}` : `${products.length} ${products.length === 1 ? "produto" : "produtos"} · ${products.filter(product => product.active).length} ${products.filter(product => product.active).length === 1 ? "ativo" : "ativos"}`;
  if (!selected.length) {
    const empty = el("div", "catalog-empty"); empty.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Z"/><path d="m3 8 9 5 9-5M12 13v8M7.5 5.5l9 5"/></svg>';
    empty.append(el("h3", "", products.length ? "Nenhum resultado por aqui" : "Seu catálogo começa aqui"), el("p", "hint", products.length ? "Tente buscar por outro nome ou descrição." : "Adicione um produto com suas informações e materiais para a IA consultar.")); list.append(empty);
  }
  for (const product of selected) {
    const card = el("article", "product-card");
    const images = product.files.filter(file => file.mime.startsWith("image/"));
    if (images[0]) { const image = el("img", "product-cover"); image.src = images[0].url; image.alt = product.name; image.loading = "lazy"; card.append(image); }
    if (!images.length) { const cover = el("div", "product-cover-empty"); cover.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Z"/><path d="m3 8 9 5 9-5M12 13v8M7.5 5.5l9 5"/></svg><span>Adicione uma imagem à ficha</span>'; card.append(cover); }
    const info = el("div", "product-card-body");
    info.append(el("span", "product-badge", product.active ? "Disponível para a IA" : "Arquivado"), el("h3", "", product.name));
    if (product.price) info.append(el("p", "product-price", product.price));
    info.append(el("p", "hint product-description", product.description.slice(0, 170) + (product.description.length > 170 ? "…" : "")));
    info.append(el("p", "hint product-material-count", `${images.length} ${images.length === 1 ? "imagem" : "imagens"} · ${product.files.filter(file => file.mime === "application/pdf").length} PDFs · ${product.links.length} ${product.links.length === 1 ? "link" : "links"}`));
    const button = el("button", "secondary-button", "Abrir ficha do produto"); const arrow = document.createElement("span"); arrow.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>'; button.append(arrow); button.type = "button"; button.addEventListener("click", () => open(product)); info.append(button); card.append(info); list.append(card);
  }
}
export async function refreshCatalog() { products = await request("/api/products"); render(); }
export async function initCatalog() {
  $("#new-product").addEventListener("click", () => open());
  $("#close-product").addEventListener("click", () => { if (!busy) $("#product-editor").hidden = true; });
  $("#add-product-link").addEventListener("click", () => { if ($("#product-links").children.length < 15) linkRow(); });
  $("#product-search").addEventListener("input", render);
  $("#product-upload").addEventListener("change", event => { pending = [...event.target.files]; files(); });
  $("#product-form").addEventListener("submit", async event => {
    event.preventDefault(); if (busy) return; busy = true; $("#save-product").disabled = true; status("Salvando produto…");
    try {
      if (pending.some(file => !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type) || file.size > (file.type === "application/pdf" ? 52428800 : 10485760))) throw new Error("Use imagens JPG, PNG ou WebP de até 10 MB, ou PDFs de até 50 MB.");
      if ((editing?.files.length || 0) + pending.length > 100) throw new Error("Cada produto aceita até 100 arquivos.");
      const links = [...$("#product-links").children].map(row => ({ title: row.children[0].value.trim(), url: row.children[1].value.trim() })).filter(item => item.title || item.url);
      editing = await request(editing ? `/api/products/${editing.id}` : "/api/products", { name: $("#product-name").value, description: $("#product-description").value, price: $("#product-price").value, active: $("#product-active").checked, links, ...(editing ? { revision: editing.revision } : {}) });
      while (pending.length) {
        const file = pending[0]; status(`Enviando ${file.name}…`);
        const upload = await request('/api/uploads', { productId: editing.id, name: file.name, mime: file.type, size: file.size });
        for (let offset = 0; offset < file.size; offset += upload.chunkSize) {
          status(`Enviando ${file.name}… ${Math.round(offset / file.size * 100)}%`);
          const response = await fetch(`/api/uploads/${upload.id}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-Offset': String(offset) }, body: file.slice(offset, offset + upload.chunkSize) });
          const part = await response.json(); if (!response.ok) throw new Error(part.error || 'Falha ao enviar parte do arquivo.');
        }
        const result = await request(`/api/uploads/${upload.id}/finish`, {});
        pending.shift(); editing.files.push(result); editing.revision++; files();
      }
      $("#product-upload").value = ""; await refreshCatalog(); editing = products.find(product => product.id === editing.id);
      $("#product-editor-title").textContent = `Editar ${editing.name}`; files(); status("Produto e materiais salvos. A IA já pode consultá-los.");
    } catch (error) { status(error.message + (editing ? " Os dados já salvos foram mantidos." : ""), true); await refreshCatalog().catch(() => {}); }
    finally { busy = false; $("#save-product").disabled = false; }
  });
  await refreshCatalog();
}
