import { createCipheriv, randomBytes, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const encode = value => value instanceof ArrayBuffer || value instanceof Uint8Array ? { $bytes: Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value).toString("base64") } : typeof value === "bigint" ? { $bigint: value.toString() } : value;
export function createStateBackup({ client, dataDir, cloud, key }) {
  if (!/^[a-f0-9]{64}$/.test(key || "")) throw new Error("Configure SUPABASE_BACKUP_KEY com 32 bytes hexadecimais.");
  let working, stopped = false, lastHash = "";
  async function save() {
    const tables = [];
    // Catalog files live in private Storage and are not duplicated in this snapshot.
    const schema = await client.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('products','product_files') ORDER BY name");
    for (const row of schema.rows) {
      const result = await client.execute('SELECT * FROM "' + String(row.name).replaceAll('"','""') + '"');
      tables.push({ name: row.name, sql: row.sql, columns: result.columns, rows: result.rows.map(record => result.columns.map(column => encode(record[column]))) });
    }
    const files = {};
    for (const name of ["settings.json", "base.txt", "auth.json"]) {
      try { files[name] = await readFile(join(dataDir, name), "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const plaintext = Buffer.from(JSON.stringify({ version: 1, tables, files }));
    const sha256 = createHash("sha256").update(plaintext).digest("hex");
    if (sha256 === lastHash) return;
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
    const encrypted = Buffer.concat([cipher.update(gzipSync(plaintext)), cipher.final()]);
    const updated = Date.now();
    await cloud.request("/rest/v1/zelo_runtime_snapshots?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: { id: "primary", version: 1, ciphertext: encrypted.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), sha256, updated } });
    lastHash = sha256;
    await writeFile(join(dataDir, "last-cloud-backup.json"), JSON.stringify({ updated, tables: tables.length, rows: tables.reduce((sum,table)=>sum+table.rows.length,0), sha256, encryptedBytes: encrypted.length }), { mode: 0o600 });
  }
  function run() {
    if (stopped) return Promise.resolve();
    if (!working) working = save().finally(() => { working = null; });
    return working;
  }
  const timer = setInterval(() => run().catch(() => { console.warn("Zelo: o backup criptografado do Supabase falhou. A cópia local foi preservada."); }), 60000); timer.unref();
  return { run, async close() { stopped = true; clearInterval(timer); await working?.catch(() => {}); } };
}
