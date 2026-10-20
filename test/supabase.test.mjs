import { test } from "node:test";
import assert from "node:assert/strict";
import { createDecipheriv } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { createSupabase } from "../supabase-client.mjs";
import { createSupabaseCatalog } from "../supabase-catalog.mjs";
import { createStateBackup } from "../supabase-state.mjs";
import { createAuth } from "../auth.mjs";
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
