import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createClient } from "@libsql/client";
import { createSupabase } from "../lib/supabase/supabase-client.mjs";
import { createStateBackup } from "../lib/supabase/supabase-state.mjs";
try { process.loadEnvFile(".env"); } catch (error) { if (error.code !== "ENOENT") throw error; }
const dataDir = resolve(".wappy"), client = createClient({ url: pathToFileURL(join(dataDir,"wappy.db")).href });
const cloud = createSupabase({ url: process.env.SUPABASE_URL, secretKey: process.env.SUPABASE_SECRET_KEY, publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY });
const report = { project: new URL(process.env.SUPABASE_URL).hostname, startedAt: new Date().toISOString(), products: 0, files: [], verified: 0 };
let backup;
try {
  const products = (await client.execute("SELECT * FROM products ORDER BY updated DESC")).rows;
  for (const product of products) {
    const existing = await cloud.request(`/rest/v1/zelo_products?id=eq.${product.id}&select=*`);
    const row = { id: product.id, name: product.name, description: product.description, price: product.price, links: JSON.parse(product.links), active: Boolean(product.active), revision: Number(product.revision), updated: Number(product.updated) };
    if (existing.length && (existing[0].name !== row.name || existing[0].description !== row.description || JSON.stringify(existing[0].links) !== JSON.stringify(row.links))) throw new Error("Já existe uma versão diferente deste produto na nuvem. Migração interrompida sem sobrescrever.");
    if (!existing.length) await cloud.request("/rest/v1/zelo_products?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: row });
    report.products++;
    const files = (await client.execute({ sql: "SELECT * FROM product_files WHERE product_id=? ORDER BY created,rowid", args: [product.id] })).rows;
    for (const file of files) {
      const bytes = Buffer.from(file.bytes), path = `${product.id}/${file.id}`;
      const metadata = { id: file.id, product_id: product.id, name: file.name, mime: file.mime, size: Number(file.size), storage_path: path, created: Number(file.created) };
      const remote = await cloud.request(`/rest/v1/zelo_product_files?id=eq.${file.id}&select=id`);
      if (!remote.length) {
        await cloud.request("/storage/v1/object/zelo-materials/" + path, { method: "POST", headers: { "Content-Type": file.mime, "x-upsert": "true" }, body: bytes });
        await cloud.request("/rest/v1/zelo_product_files?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates" }, body: metadata });
      }
      const downloaded = await cloud.request("/storage/v1/object/zelo-materials/" + path, { binary: true });
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (createHash("sha256").update(downloaded).digest("hex") !== sha256) throw new Error("Falha ao conferir um arquivo na nuvem.");
      report.files.push({ id: file.id, name: file.name, size: bytes.length, sha256 }); report.verified++;
      console.log(`Verificado ${report.verified}/${files.length}: ${file.name}`);
      await writeFile(join(dataDir,"supabase-migration.json"),JSON.stringify(report,null,2),{mode:0o600});
    }
  }
  backup = createStateBackup({ client, dataDir, cloud, key: process.env.SUPABASE_BACKUP_KEY }); await backup.run();
  report.completedAt = new Date().toISOString();
  await writeFile(join(dataDir,"supabase-migration.json"),JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify({ migrated: true, products: report.products, files: report.verified, encryptedState: true }));
} finally { await backup?.close(); client.close(); }
