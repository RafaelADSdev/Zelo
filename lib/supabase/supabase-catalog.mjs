import { randomUUID } from "node:crypto";
import { fail } from "../core/settings.mjs";
import { catalogText as text, catalogLinks as links, catalogMime as mime } from "../catalog/catalog.mjs";
import { normalize } from "../catalog/search.mjs";
const maxFile = 50 * 1024 * 1024;
const info = row => ({ id: row.id, name: row.name, mime: row.mime, size: Number(row.size), url: `/api/files/${row.id}` });
export function createSupabaseCatalog(cloud, ownerId) {
  if (ownerId !== undefined && !/^[a-f0-9-]{36}$/.test(ownerId)) throw new Error("Ambiente inválido.");
  const scope = ownerId ? `&owner_id=eq.${ownerId}` : "";
  const rpc = name => "/rest/v1/rpc/zelo_" + (ownerId ? "workspace_" : "") + name;
  const owned = payload => ownerId ? { ...payload, target_owner: ownerId } : payload;
  const request = cloud.request;
  const objectUrl = path => "/storage/v1/object/zelo-materials/" + path.split("/").map(encodeURIComponent).join("/");
  const product = row => ({ ...row, revision: Number(row.revision), updated: Number(row.updated) });
  async function productRows(activeOnly = false) {
    return (await request(`/rest/v1/zelo_products?select=*&order=updated.desc${scope}${activeOnly ? "&active=eq.true" : ""}`)).map(product);
  }
  async function withFiles(products) {
    const requests = [];
    // Ten products at up to 100 files each fit a single PostgREST response.
    for (let offset = 0; offset < products.length; offset += 10) {
      const ids = products.slice(offset, offset + 10).map(item => encodeURIComponent(item.id)).join(",");
      requests.push(request(`/rest/v1/zelo_product_files?product_id=in.(${ids})&select=product_id,id,name,mime,size&order=created.asc,id.asc${scope}`));
    }
    const files = new Map(products.map(item => [item.id, []]));
    for (const page of await Promise.all(requests)) for (const row of page) files.get(row.product_id)?.push(info(row));
    return products.map(item => ({ ...item, files: files.get(item.id) }));
  }
  async function get(id) {
    const rows = await request(`/rest/v1/zelo_products?id=eq.${encodeURIComponent(id)}&select=*${scope}`);
    if (!rows.length) throw fail("Produto não encontrado.", 404);
    const row = rows[0], files = await request(`/rest/v1/zelo_product_files?product_id=eq.${encodeURIComponent(id)}&select=*&order=created.asc,id.asc${scope}`);
    return { ...product(row), files: files.map(info) };
  }
  return {
    maxFile, get,
    async list() { return withFiles(await productRows()); },
    async save(input, id) {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("Produto inválido.");
      const before = id ? await get(id) : null;
      if (before && input.revision !== before.revision) throw fail("A ficha mudou. Reabra o produto antes de salvar.", 409);
      if (input.active !== undefined && typeof input.active !== "boolean") throw fail("Situação do produto inválida.");
      const payload = { name: text(input.name, 120, true), description: text(input.description || "", 12000), price: text(input.price || "", 160), links: links(input.links || []), active: input.active ?? before?.active ?? true, revision: before?.revision, updated: Date.now() };
      id ||= randomUUID(); await request(rpc("save_product"), { method: "POST", body: owned({ payload, target_id: id }) }); return get(id);
    },
    async upload(productId, bytes, name, contentType) {
      await get(productId);
      if (!bytes.length || bytes.length > maxFile) throw fail("Cada arquivo deve ter entre 1 byte e 50 MB.", 413);
      const type = mime(bytes);
      if (type.startsWith("image/") && bytes.length > 10 * 1024 * 1024) throw fail("Cada imagem deve ter até 10 MB.", 413);
      if (type !== contentType) throw fail("O tipo informado não corresponde ao arquivo.");
      name = text(name, 180, true).replace(/[\x00-\x1f\x7f/\\]/g, "_");
      const id = randomUUID(), storage_path = `${ownerId ? ownerId + "/" : ""}${productId}/${id}`;
      await request(objectUrl(storage_path), { method: "POST", body: bytes, headers: { "Content-Type": type } });
      const row = { id, product_id: productId, name, mime: type, size: bytes.length, storage_path, created: Date.now() };
      try { await request(rpc("register_file"), { method: "POST", body: owned({ payload: row }) }); }
      catch (error) { await request(objectUrl(storage_path), { method: "DELETE" }).catch(() => {}); throw error; }
      return info(row);
    },
    async removeFile(productId, fileId, revision) {
      const product = await get(productId);
      if (product.revision !== revision) throw fail("A ficha mudou. Reabra o produto antes de remover o anexo.", 409);
      const path = await request(rpc("remove_file"), { method: "POST", body: owned({ target_product: productId, target_file: fileId, expected_revision: revision }) });
      if (path) await request(objectUrl(path), { method: "DELETE" });
      return get(productId);
    },
    async file(id, activeOnly = false) {
      const rows = await request(`/rest/v1/zelo_product_files?id=eq.${encodeURIComponent(id)}&select=*${scope}`);
      if (!rows.length) throw fail("Arquivo não encontrado.", 404);
      const row = rows[0];
      if (activeOnly && !(await get(row.product_id)).active) throw fail("O produto deste arquivo foi arquivado.", 409);
      return { ...info(row), bytes: await request(objectUrl(row.storage_path), { binary: true }) };
    },
    async signedFile(id) {
      const rows = await request(`/rest/v1/zelo_product_files?id=eq.${encodeURIComponent(id)}&select=*${scope}`);
      if (!rows.length) throw fail('Arquivo não encontrado.', 404);
      const row = rows[0], path = row.storage_path.split('/').map(encodeURIComponent).join('/');
      const signed = await request('/storage/v1/object/sign/zelo-materials/' + path, { method: 'POST', body: { expiresIn: 60 } });
      if (!signed.signedURL?.startsWith('/object/sign/zelo-materials/')) throw fail('Não foi possível abrir este arquivo.', 502);
      return cloud.origin + '/storage/v1' + signed.signedURL + (row.mime === 'application/pdf' ? '&download=' + encodeURIComponent(row.name) : '');
    },
    async search(query) {
      const products = await productRows(true);
      const words = [...new Set(normalize(query).split(/\W+/).filter(word => word.length > 2))];
      const ranked = products.map(product => { const name = normalize(product.name), content = normalize(product.name + " " + product.description); return { product, score: words.reduce((score, word) => score + (name.includes(word) ? 8 : content.includes(word) ? 1 : 0), 0) }; }).filter(item => item.score > 0).sort((a,b) => b.score-a.score).slice(0,3).map(item => item.product);
      return { products: await withFiles(ranked), summary: products.map(item => item.name).join(", ") };
    },
    reference(product) {
      return `PRODUTO: ${product.name}\nPreço/condições de referência: ${product.price || "Não informado; confirmar com a equipe."}\n${product.description}\nLinks públicos:\n${product.links.map(item => `${item.title}: ${item.url}`).join("\n")}\nArquivos disponíveis para envio quando solicitados (materialIds):\n${product.files.map(item => `ID ${item.id}: ${item.name} (${item.mime})`).join("\n")}\nOs arquivos não foram lidos pela IA. Não invente o conteúdo. Não envie endereços locais /api/files ao cliente.`;
    },
  };
}
