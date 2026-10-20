import { mkdtemp, realpath, readFile } from "node:fs/promises";
import { join, basename, sep } from "node:path";
import { startServer as actualStartServer } from "../server.mjs";

const cookies = new Map(), testPassword = "test-only-password-2026-unique";
export async function authenticatedFetch(url, options = {}) {
  const origin = new URL(url).origin, headers = new Headers(options.headers);
  if (!headers.get("Cookie")?.includes("zelo_auth=") && cookies.has(origin)) headers.set("Cookie", [headers.get("Cookie"), cookies.get(origin)].filter(Boolean).join("; "));
  return globalThis.fetch(url, { ...options, headers });
}
export async function startTestServer(options) {
  const app = await actualStartServer(options);
  try {
    const status = await (await globalThis.fetch(app.url + "/api/auth/status")).json();
    const setupToken = status.configured ? undefined : (await readFile(join(options.dataDir, "primeiro-acesso.txt"), "utf8")).match(/[a-f0-9]{64}/)[0];
    const response = await globalThis.fetch(app.url + (status.configured ? "/api/auth/login" : "/api/auth/setup"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "test-admin", password: testPassword, setupToken }) });
    if (!response.ok) throw new Error("Falha ao autenticar o servidor de teste.");
    cookies.set(app.url, response.headers.getSetCookie().find(item => item.startsWith("zelo_auth=")).split(";")[0]);
    return app;
  } catch (error) { await app.close(); throw error; }
}

export async function testDirectory() {
  if (!process.env.WAPPY_TEST_ROOT) throw new Error("Execute estes testes com npm test; o runner faz a limpeza após o processo nativo SQLite terminar.");
  return mkdtemp(join(process.env.WAPPY_TEST_ROOT, "wappy-test-"));
}
export async function releaseDirectory(directory) {
  const resolved = await realpath(directory), root = await realpath(process.env.WAPPY_TEST_ROOT);
  if (!resolved.startsWith(root + sep) || !basename(resolved).startsWith("wappy-test-")) throw new Error("Diretório de teste fora da raiz permitida.");
  // The parent runner removes this owned tree after the native SQLite process exits.
}
