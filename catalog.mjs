import { randomUUID } from "node:crypto";
import { fail } from "./settings.mjs";
import { normalize } from "./search.mjs";

const MAX_FILE = 50 * 1024 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;
export { text as catalogText, links as catalogLinks, mime as catalogMime };
const text = (value, max, required = false) => {
  if (typeof value !== "string" || value.length > max || required && !value.trim()) throw fail("Confira os campos do produto e seus limites.");
  return value.trim();
};
function links(value) {
  if (!Array.isArray(value) || value.length > 15) throw fail("Cadastre até 15 links por produto.");
  return value.map(item => {
    const title = text(item?.title, 120, true); let url;
    try { url = new URL(text(item?.url, 2000, true)); } catch { throw fail("Informe um link HTTPS válido."); }
    if (url.protocol !== "https:" || url.username || url.password) throw fail("Os links devem usar HTTPS e não conter credenciais.");
    return { title, url: url.href };
  });
}
function mime(bytes) {
  if (bytes.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "image/webp";
  throw fail("O conteúdo precisa ser um PDF ou uma imagem JPG, PNG ou WebP válida.");
}
export async function createCatalog(db) {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,price TEXT NOT NULL,links TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 1,updated INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS product_files (id TEXT PRIMARY KEY,product_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,bytes BLOB NOT NULL,created INTEGER NOT NULL);
  `);
  const fileInfo = row => ({ id: row.id, name: row.name, mime: row.mime, size: Number(row.size), url: `/api/files/${row.id}` });
  const allFiles = async id => (await db.execute({ sql: "SELECT id,name,mime,size FROM product_files WHERE product_id=? ORDER BY created,rowid", args: [id] })).rows.map(fileInfo);
  async function get(id) {
    const row = (await db.execute({ sql: "SELECT * FROM products WHERE id=?", args: [id] })).rows[0];
    if (!row) throw fail("Produto não encontrado.", 404);
    return { ...row, active: Boolean(row.active), revision: Number(row.revision), links: JSON.parse(row.links), files: await allFiles(id) };
  }
  return {
    maxFile: MAX_FILE,
    async list() { const rows = (await db.execute("SELECT id FROM products ORDER BY updated DESC,rowid DESC")).rows; return Promise.all(rows.map(row => get(row.id))); },
    get,
    async save(input, id) {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("Produto inválido.");
      const before = id ? await get(id) : null;
      if (before && input.revision !== before.revision) throw fail("Este produto foi alterado. Reabra a ficha antes de salvar.", 409);
      const name = text(input.name, 120, true), description = text(input.description || "", 12000), price = text(input.price || "", 160), refs = links(input.links || []);
      if (input.active !== undefined && typeof input.active !== "boolean") throw fail("Situação do produto inválida.");
      const active = input.active ?? before?.active ?? true;
      if (before) await db.execute({ sql: "UPDATE products SET name=?,description=?,price=?,links=?,active=?,revision=revision+1,updated=? WHERE id=? AND revision=?", args: [name, description, price, JSON.stringify(refs), Number(active), Date.now(), id, before.revision] });
      else {
        const count = Number((await db.execute("SELECT COUNT(*) AS total FROM products")).rows[0].total);
        if (count >= 100) throw fail("O catálogo local aceita até 100 produtos.", 409);
        id = randomUUID();
        await db.execute({ sql: "INSERT INTO products(id,name,description,price,links,active,updated) VALUES (?,?,?,?,?,?,?)", args: [id, name, description, price, JSON.stringify(refs), Number(active), Date.now()] });
      }
      return get(id);
    },
    async upload(id, bytes, name, contentType) {
      await get(id);
      if (!bytes.length || bytes.length > MAX_FILE) throw fail("Cada arquivo deve ter entre 1 byte e 50 MB.", 413);
      const type = mime(bytes);
      if (type.startsWith("image/") && bytes.length > MAX_IMAGE) throw fail("Cada imagem deve ter até 10 MB.", 413);
      if (type !== contentType) throw fail("O tipo informado não corresponde ao conteúdo do arquivo.");
      name = text(name, 180, true).replace(/[\x00-\x1f\x7f/\\]/g, "_");
      const files = await allFiles(id);
      if (files.length >= 100) throw fail("Cada produto aceita até 100 arquivos.", 409);
      const total = Number((await db.execute("SELECT COALESCE(SUM(size),0) AS total FROM product_files")).rows[0].total);
      if (total + bytes.length > 500 * 1024 * 1024) throw fail("O catálogo atingiu o limite local de 500 MB.", 409);
      const fileId = randomUUID();
      await db.batch([
        { sql: "INSERT INTO product_files(id,product_id,name,mime,size,bytes,created) VALUES (?,?,?,?,?,?,?)", args: [fileId, id, name, type, bytes.length, bytes, Date.now()] },
        { sql: "UPDATE products SET revision=revision+1,updated=? WHERE id=?", args: [Date.now(), id] },
      ], "write");
      return fileInfo({ id: fileId, name, mime: type, size: bytes.length });
    },
    async removeFile(productId, fileId, revision) {
      const product = await get(productId);
      if (product.revision !== revision) throw fail("A ficha mudou. Reabra o produto antes de remover o anexo.", 409);
      await db.batch([
        { sql: "DELETE FROM product_files WHERE id=? AND product_id=?", args: [fileId, productId] },
        { sql: "UPDATE products SET revision=revision+1,updated=? WHERE id=?", args: [Date.now(), productId] },
      ], "write");
      return get(productId);
    },
    async file(id, activeOnly = false) {
      const row = (await db.execute({ sql: "SELECT f.*,p.active FROM product_files f JOIN products p ON p.id=f.product_id WHERE f.id=?", args: [id] })).rows[0];
      if (!row) throw fail("Arquivo não encontrado.", 404);
      if (activeOnly && !row.active) throw fail("O produto deste arquivo foi arquivado.", 409);
      return { ...fileInfo(row), bytes: Buffer.from(row.bytes) };
    },
    async search(query) {
      const products = (await this.list()).filter(item => item.active);
      const words = [...new Set(normalize(query).split(/\W+/).filter(word => word.length > 2))];
      const ranked = products.map(product => {
        const name = normalize(product.name), content = normalize(product.name + " " + product.description);
        return { product, score: words.reduce((score, word) => score + (name.includes(word) ? 8 : content.includes(word) ? 1 : 0), 0) };
      }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(item => item.product);
      return { products: ranked, summary: products.map(item => item.name).join(", ") };
    },
    reference(product) {
      return `PRODUTO: ${product.name}\nPreço/condições de referência: ${product.price || "Não informado; confirmar com a equipe."}\n${product.description}\nLinks públicos (podem ser enviados ao cliente):\n${product.links.map(item => `${item.title}: ${item.url}`).join("\n")}\nArquivos disponíveis para envio quando solicitados (materialIds):\n${product.files.map(item => `ID ${item.id}: ${item.name} (${item.mime})`).join("\n")}\nOs arquivos não foram lidos pela IA. Não invente o conteúdo deles. Não envie endereços locais /api/files ao cliente no WhatsApp.`;
    },
  };
}
