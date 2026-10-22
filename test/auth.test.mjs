import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { startServer } from "../server.mjs";
import { createAuth } from "../lib/auth/auth.mjs";
import { testDirectory, releaseDirectory } from "./helpers.mjs";
const password = "test-auth-secret-only-2026";
test("login protege APIs, anexos e painel; primeiro acesso é único, senha persistida como hash e logout revoga sessão", async () => {
  const dataDir = await testDirectory(); let app = await startServer({ port: 0, dataDir });
  try {
    const post = (path, input, cookie) => fetch(app.url + path, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(input) });
    for (const path of ["/api/dashboard", "/api/products", "/api/state", "/api/conversation", "/api/files/00000000-0000-0000-0000-000000000000", "/app.js"]) assert.equal((await fetch(app.url + path)).status, 401, path);
    assert.equal((await fetch(app.url, { redirect: "manual" })).headers.get("location"), "/login");
    assert.equal((await fetch(app.url + "/login")).status, 200);
    assert.equal((await fetch(app.webhookUrl)).status, 403);
    assert.equal((await post("/api/settings", { assistantName: "Invasor" })).status, 401);
    assert.equal((await post("/api/auth/setup", { username: "admin", password, setupToken: "wrong" })).status, 401);
    const setupToken = (await readFile(join(dataDir, "primeiro-acesso.txt"), "utf8")).match(/[a-f0-9]{64}/)[0];
    const response = await post("/api/auth/setup", { username: "admin", password, setupToken }); assert.equal(response.status, 200);
    const cookieHeader = response.headers.get("set-cookie"), cookie = cookieHeader.split(";")[0];
    assert.match(cookieHeader, /HttpOnly/); assert.match(cookieHeader, /SameSite=Strict/); assert.match(cookieHeader, /Max-Age=43200/);
    const disk = await readFile(join(dataDir, "auth.json"), "utf8"); assert.ok(!disk.includes(password)); assert.ok(!disk.includes(setupToken));
    await assert.rejects(readFile(join(dataDir, "primeiro-acesso.txt")), error => error.code === "ENOENT");
    assert.equal((await post("/api/auth/setup", { username: "other", password, setupToken })).status, 409);
    assert.equal((await fetch(app.url + "/api/dashboard", { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await post("/api/auth/logout", {}, cookie)).status, 200);
    assert.equal((await fetch(app.url + "/api/dashboard", { headers: { Cookie: cookie } })).status, 401);
    const login = await post("/api/auth/login", { username: "ADMIN", password }); assert.equal(login.status, 200);
    const prior = login.headers.get("set-cookie").split(";")[0];
    const origin = await post("/api/auth/login", { username: "admin", password }); assert.equal(origin.status, 200);
    assert.equal((await fetch(app.url + "/api/auth/login", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password }) })).status, 403);
    await app.close(); app = await startServer({ port: 0, dataDir });
    assert.equal((await fetch(app.url + "/api/dashboard", { headers: { Cookie: prior } })).status, 401);
    assert.equal((await post("/api/auth/login", { username: "admin", password })).status, 200);
    assert.equal((await post("/api/auth/login", { username: "admin", password: "wrong" })).status, 401);
  } finally { await app.close(); await releaseDirectory(dataDir); }
});
test("sessões expiram em 12 horas e tentativas inválidas são limitadas", async () => {
  const directory = await testDirectory(); let now = Date.now();
  const auth = await createAuth(directory, { clock: () => now });
  try {
    const setupToken = (await readFile(join(directory, "primeiro-acesso.txt"), "utf8")).match(/[a-f0-9]{64}/)[0];
    const token = await auth.setup({ username: "admin", password, setupToken });
    const req = { headers: { cookie: `zelo_auth=${token}` } };
    assert.equal(auth.session(req).username, "admin"); now += 12 * 3600000;
    assert.equal(auth.session(req), null);
    for (let i = 0; i < 5; i++) await assert.rejects(auth.login({ username: "admin", password: "wrong" }), error => error.status === 401);
    await assert.rejects(auth.login({ username: "admin", password }), error => error.status === 429);
    now += 300001; assert.ok(await auth.login({ username: "admin", password }));
  } finally { await releaseDirectory(directory); }
});

test("controle local de encerramento não libera acesso aos dados", async () => {
  const dataDir = await testDirectory(); let stopped = false;
  const app = await startServer({ port: 0, dataDir, onShutdown: () => { stopped = true; } });
  try {
    const health = await (await fetch(app.url + "/api/health")).json();
    const token = await readFile(join(dataDir, "control-token"), "utf8");
    const options = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instanceId: health.instanceId }) };
    assert.equal((await fetch(app.url + "/api/shutdown", options)).status, 401);
    assert.equal((await fetch(app.url + "/api/dashboard", { headers: { "X-Zelo-Control": token } })).status, 401);
    assert.equal((await fetch(app.url + "/api/shutdown", { ...options, headers: { ...options.headers, "X-Zelo-Control": token } })).status, 200);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(stopped, true);
  } finally { await app.close(); await releaseDirectory(dataDir); }
});
