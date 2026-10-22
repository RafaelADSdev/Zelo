import { test } from "node:test";
import assert from "node:assert/strict";
import { startTestServer as startServer, authenticatedFetch as fetch } from "./helpers.mjs";
import { EventEmitter } from "node:events";
import { cloudMedia } from "../lib/whatsapp/media.mjs";
import { testDirectory, releaseDirectory } from "./helpers.mjs";

test("catálogo aceita galeria com mais de 20 arquivos e PDF acima de 10 MB, preservando limite das imagens", async () => {
  const dataDir = await testDirectory();
  const app = await startServer({ port: 0, dataDir });
  try {
    const product = await app.runtime.catalog.save({ name: "Galeria completa", links: [] });
    for (let i = 0; i < 21; i++) await app.runtime.catalog.upload(product.id, Buffer.from("%PDF-1.7\n%%EOF"), `Material ${i}.pdf`, "application/pdf");
    const large = Buffer.alloc(11 * 1024 * 1024); large.write("%PDF-1.7");
    const response = await fetch(app.url + `/api/products/${product.id}/files`, { method: "POST", headers: { "Content-Type": "application/pdf", "X-File-Name": "Book.pdf" }, body: large });
    assert.equal(response.status, 201);
    const file = await response.json(); assert.equal(file.size, large.length);
    const downloaded = await fetch(app.url + file.url); assert.equal(Number(downloaded.headers.get("content-length")), large.length);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), large);
    const image = Buffer.alloc(11 * 1024 * 1024); Buffer.from([137,80,78,71,13,10,26,10]).copy(image);
    await assert.rejects(app.runtime.catalog.upload(product.id, image, "Grande.png", "image/png"), /imagem.*10 MB/);
    assert.equal((await app.runtime.catalog.get(product.id)).files.length, 22);
  } finally { await app.close(); await releaseDirectory(dataDir); }
});

test("catálogo: produtos isolados, anexos validados, consulta pela IA e arquivamento", async () => {
  const dataDir = await testDirectory(); let materialId, prompt = "";
  const sent = [], socket = { ev: new EventEmitter(), user: { id: "5511999999999:1@s.whatsapp.net" }, end() {}, async sendMessage(jid, content) { sent.push({ jid, content }); return { key: { id: `catalog-${sent.length}` } }; } };
  const app = await startServer({ port: 0, dataDir, qrSocketFactory: () => socket, ai: { apiKey: "test-catalog-key" }, geminiFetch: async (_url, options) => {
    const request = JSON.parse(options.body); prompt = request.contents.at(-1).parts[0].text;
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ formatRationale: "Material solicitado", message: { text: "Segue o material do produto Aurora." }, materialIds: [materialId, "inventado"] }) }] } }] });
  } });
  const post = async (path, body) => fetch(app.url + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    let r = await post("/api/products", { name: "Aurora", description: "Apartamento com piscina privativa", price: "A partir de R$ 450.000", links: [{ title: "Site Aurora", url: "https://example.com/aurora" }] });
    assert.equal(r.status, 201); const product = await r.json();
    assert.equal((await post("/api/products", { name: "Perigoso", links: [{ title: "Link", url: "javascript:alert(1)" }] })).status, 400);
    const pdf = Buffer.from("%PDF-1.7\nmaterial de teste\n%%EOF");
    const upload = (data, type = "application/pdf") => fetch(app.url + `/api/products/${product.id}/files`, { method: "POST", headers: { "Content-Type": type, "X-File-Name": encodeURIComponent("Book Aurora.pdf") }, body: data });
    assert.equal((await upload(Buffer.from("<html>não é PDF</html>"))).status, 400);
    r = await upload(pdf); assert.equal(r.status, 201); const file = await r.json(); materialId = file.id;
    r = await fetch(app.url + file.url); assert.equal(r.status, 200); assert.deepEqual(Buffer.from(await r.arrayBuffer()), pdf); assert.match(r.headers.get("content-disposition"), /attachment/);
    assert.equal((await fetch(app.webhookUrl.replace("/webhook", file.url))).status, 404);
    r = await post("/api/chat", { text: "Quero o PDF do Aurora" }); const response = await r.json();
    assert.equal(r.status, 200); assert.match(prompt, /Aurora/); assert.match(prompt, /450.000/); assert.equal(response.reply.materials.length, 1); assert.equal(response.reply.materials[0].id, materialId);
    assert.ok(!JSON.stringify(response).includes("%PDF"));
    await app.settings.update({ whatsappMode: "qr" }); await app.qr.connect(); socket.ev.emit("connection.update", { connection: "open" }); await app.qr.idle();
    const incoming = { type: "notify", messages: [{ key: { remoteJid: "5511888888888@s.whatsapp.net", fromMe: false, id: "material-request" }, message: { conversation: "Me envie o PDF do Aurora" }, messageTimestamp: Math.floor(Date.now() / 1000) }] };
    socket.ev.emit("messages.upsert", incoming); await app.qr.idle();
    assert.equal(sent.length, 2); assert.deepEqual(sent[1].content.document, pdf); assert.equal(sent[1].content.mimetype, "application/pdf"); assert.equal(sent[1].content.fileName, "Book Aurora.pdf");
    socket.ev.emit("messages.upsert", incoming); await app.qr.idle(); assert.equal(sent.length, 2);
    await post(`/api/products/${product.id}`, { name: "Aurora atualizado", description: "Nova descrição", price: "Consulte", links: [], active: false, revision: product.revision + 1 });
    r = await fetch(app.url + "/api/products"); const products = await r.json(); assert.equal(products[0].active, false); assert.equal(products[0].files.length, 1);
    assert.equal((await post(`/api/products/${product.id}`, { name: "Conflito", revision: 1 })).status, 409);
  } finally { await app.close(); await releaseDirectory(dataDir); }
});

test("Cloud API carrega o arquivo em multipart e usa o ID de mídia, sem tornar o painel público", async () => {
  const file = { name: "Book.pdf", mime: "application/pdf", size: 10, bytes: Buffer.from("%PDF-1.7\n") };
  const config = { graphVersion: "v23.0", phoneNumberId: "123456", accessToken: "test-private-token" };
  const payload = await cloudMedia(config, file, "5511999999999", async (url, options) => {
    assert.equal(url, "https://graph.facebook.com/v23.0/123456/media"); assert.equal(options.headers.Authorization, "Bearer test-private-token");
    assert.ok(options.body instanceof FormData); assert.equal(options.body.get("messaging_product"), "whatsapp");
    assert.deepEqual(Buffer.from(await options.body.get("file").arrayBuffer()), file.bytes);
    return Response.json({ id: "uploaded-media-id" });
  });
  assert.deepEqual(payload.document, { id: "uploaded-media-id", filename: "Book.pdf" }); assert.equal(payload.to, "5511999999999");
  await assert.rejects(cloudMedia(config, { ...file, mime: "image/png", size: 6 * 1024 * 1024 }, "5511999999999", () => { throw new Error("must not upload"); }), /até 5 MB/);
});

test("produtos e arquivos sobrevivem ao reinício do servidor", async () => {
  const dataDir = await testDirectory(); let app;
  try {
    app = await startServer({ port: 0, dataDir });
    const product = await app.runtime.catalog.save({ name: "Produto persistente", description: "Descrição preservada", links: [] });
    const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.from("test fixture")]);
    const file = await app.runtime.catalog.upload(product.id, png, "imagem.png", "image/png");
    await app.close(); app = null;
    app = await startServer({ port: 0, dataDir });
    const saved = await app.runtime.catalog.get(product.id);
    assert.equal(saved.name, product.name); assert.equal(saved.files[0].id, file.id);
    assert.deepEqual((await app.runtime.catalog.file(file.id)).bytes, png);
  } finally { if (app) await app.close(); await releaseDirectory(dataDir); }
});
