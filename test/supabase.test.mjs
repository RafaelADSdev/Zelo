import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { createSupabase } from "../lib/supabase/supabase-client.mjs";
import { createSupabaseCatalog } from "../lib/supabase/supabase-catalog.mjs";
import { createStateBackup } from "../lib/supabase/supabase-state.mjs";
import { createAuth } from "../lib/auth/auth.mjs";
import { createRuntime } from "../lib/core/runtime.mjs";
import { createSettings } from "../lib/core/settings.mjs";
import { decodeSnapshot } from "../deployment/restore.mjs";
import { testDirectory, releaseDirectory } from "./helpers.mjs";

test("Supabase usa segredo só no servidor e oculta erros externos; autenticação usa chave pública", async () => {
  const calls = [];
  const cloud = createSupabase({ url: "https://project.supabase.co", secretKey: "private-server-key", publishableKey: "public-key", fetchImpl: async (url, options) => { calls.push({url,options}); return Response.json({}); } });
  await cloud.request("/rest/v1/zelo_products");
  await cloud.request("/auth/v1/token?grant_type=password", { method: "POST", publicKey: true, body: { email: "test@example.com", password: "test-only" } });
  assert.equal(calls[0].options.headers.apikey, "private-server-key"); assert.equal(calls[1].options.headers.apikey, "public-key");
  assert.ok(!calls[0].url.includes("private-server-key"));
  const failed = createSupabase({ url: "https://project.supabase.co", secretKey: "private-server-key", fetchImpl: async () => Response.json({ message: "private-server-key" }, { status: 403 }) });
  await assert.rejects(failed.request("/rest/v1/zelo_products"), error => error.status === 502 && !error.message.includes("private-server-key"));
  assert.throws(() => createSupabase({url:"http://internal",secretKey:"secret"}));
  const local = createSupabase({ url: "http://127.0.0.1:8000/", secretKey: "private-server-key", fetchImpl: async (url, options) => { calls.push({url,options}); return Response.json({}); } });
  await local.request("/rest/v1/zelo_products");
  assert.equal(calls.at(-1).url, "http://127.0.0.1:8000/rest/v1/zelo_products");
  assert.throws(() => createSupabase({ url: "http://127.0.0.1:8000@other.example", secretKey: "secret" }));
});
test("catálogo remoto rejeita arquivo disfarçado e revisão antiga antes de enviar mutações", async () => {
  let writes = 0;
  const catalog = createSupabaseCatalog({ request: async (path, options) => { if (options?.method) { writes++; throw Error("unexpected write"); } return path.includes("zelo_product_files") ? [] : [{ id: "id", revision: 5, active: true, files: [] }]; } });
  await assert.rejects(catalog.upload("id", Buffer.from("not-a-pdf"), "Book.pdf", "application/pdf"));
  await assert.rejects(catalog.save({name:"Sopro",revision:4},"id"),error=>error.status===409);
  assert.equal(writes,0);
});
test("cópia de runtime é criptografada, preserva bytes e não repete envio sem alterações", async () => {
  const directory = await testDirectory(), client = createClient({url:pathToFileURL(join(directory,"state.db")).href});
  let backup; const writes = [];
  try {
    await client.execute("CREATE TABLE qr_secret(id TEXT, bytes BLOB)");
    await client.execute({sql:"INSERT INTO qr_secret VALUES (?,?)",args:["session",Buffer.from([0,128,255])]});
    await writeFile(join(directory,"settings.json"),JSON.stringify({apiKey:"never-public-secret"}));
    const key = "a".repeat(64);
    backup = createStateBackup({client,dataDir:directory,key,cloud:{request:async (_path,options)=>writes.push(options.body)}});
    await backup.run(); await backup.run(); assert.equal(writes.length,1);
    assert.ok(!JSON.stringify(writes[0]).includes("never-public-secret"));
    const record=writes[0], decipher=createDecipheriv("aes-256-gcm",Buffer.from(key,"hex"),Buffer.from(record.iv,"base64"));
    decipher.setAuthTag(Buffer.from(record.tag,"base64"));
    const decoded=JSON.parse(gunzipSync(Buffer.concat([decipher.update(Buffer.from(record.ciphertext,"base64")),decipher.final()])));
    assert.equal(JSON.parse(decoded.files["settings.json"]).apiKey,"never-public-secret");
    assert.equal(decoded.tables[0].rows[0][1].$bytes,Buffer.from([0,128,255]).toString("base64"));
  } finally { await backup?.close();client.close();await releaseDirectory(directory); }
});
test("backup registra a campanha e os destinatários no mesmo ponto do banco", async () => {
  const dataDir = await testDirectory(), url = pathToFileURL(join(dataDir, "state.db")).href;
  const reader = createClient({ url }), writer = createClient({ url }), writes = [], key = "a".repeat(64);
  let backup;
  try {
    await writer.executeMultiple("PRAGMA journal_mode=WAL; CREATE TABLE wa_broadcast_items (id TEXT, campaign TEXT); CREATE TABLE wa_broadcasts (id TEXT);");
    let inserted = false;
    const client = { async transaction(mode) {
      const tx = await reader.transaction(mode);
      return {
        async execute(sql) {
          const result = await tx.execute(sql);
          if (!inserted && sql.includes('FROM "wa_broadcast_items"')) {
            inserted = true;
            await writer.batch(["INSERT INTO wa_broadcasts VALUES ('campanha')", "INSERT INTO wa_broadcast_items VALUES ('destinatario','campanha')"], "write");
          }
          return result;
        },
        close: () => tx.close(),
      };
    } };
    backup = createStateBackup({ client, dataDir, key, cloud: { request: async (_, { body }) => writes.push(body) } });
    await backup.run(); await backup.run();
    assert.equal(inserted, true);
    assert.deepEqual(writes.map(row => decodeSnapshot(row,key).tables.map(table => table.rows.length)), [[0,0],[1,1]]);
  } finally { await backup?.close(); reader.close(); writer.close(); await releaseDirectory(dataDir); }
});
test("encerramento espera o backup em curso e captura alterações mais recentes", async () => {
  const dataDir = await testDirectory(), key = "b".repeat(64), records = [];
  const started = Promise.withResolvers(), finish = Promise.withResolvers();
  const cloud = { request: async (_, { body }) => { records.push(body); started.resolve(); await finish.promise; } };
  const runtime = await createRuntime(dataDir, await createSettings(dataDir), { cloud, backupKey: key });
  try {
    await started.promise;
    await runtime.client.execute("CREATE TABLE alteracao_confirmada (id TEXT)");
    const closing = runtime.close();
    finish.resolve(); await closing;
    assert.equal(records.length, 2);
    assert.equal(decodeSnapshot(records[0],key).tables.some(table=>table.name==='alteracao_confirmada'),false);
    assert.equal(decodeSnapshot(records[1],key).tables.some(table=>table.name==='alteracao_confirmada'),true);
  } finally { finish.resolve(); await releaseDirectory(dataDir); }
});
test("um snapshot capturado antes de perder a posse não começa a publicação", async () => {
  const dataDir = await testDirectory(), key = "b".repeat(64);
  let active = true, publishes = 0;
  const backup = createStateBackup({
    dataDir, key,
    client: { transaction: async () => ({ execute: async () => ({ rows: [] }), close() { active = false; } }) },
    assertActive() { if (!active) throw Object.assign(new Error("Posse perdida"), { leaseLost:true }); },
    publishSnapshot: async () => { publishes++; },
  });
  try { await assert.rejects(backup.run(), error => error.leaseLost === true); assert.equal(publishes,0); }
  finally { await backup.close(); await releaseDirectory(dataDir); }
});
test("administrador Supabase mantém vínculo único e não grava senha ou hash local", async () => {
  const directory=await testDirectory(), password="test-only-long-password-2026"; let created=0;
  const auth=await createAuth(directory,{provider:{create:async()=>{created++;return "12345678-1234-1234-1234-123456789abc";},login:async()=>"12345678-1234-1234-1234-123456789abc"}});
  try {
    const setupToken=(await readFile(join(directory,"primeiro-acesso.txt"),"utf8")).match(/[a-f0-9]{64}/)[0];
    await assert.rejects(auth.setup({username:"not-an-email",password,setupToken}));assert.equal(created,0);
    await auth.setup({username:"owner@example.com",password,setupToken});assert.equal(created,1);
    const disk=await readFile(join(directory,"auth.json"),"utf8");assert.ok(!disk.includes(password));assert.ok(!disk.includes('"hash"'));
    assert.ok(await auth.login({username:"owner@example.com",password}));
    await assert.rejects(auth.login({username:"other@example.com",password}),error=>error.status===401);
  } finally {await releaseDirectory(directory);}
});
