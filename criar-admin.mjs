import { readFile } from "node:fs/promises";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

async function credentials(provider) {
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("Execute este comando em um terminal interativo.");
  let echo = true;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (echo) stdout.write(chunk, encoding);
      done();
    }
  });
  const terminal = createInterface({ input: stdin, output, terminal: true, historySize: 0 });
  const controller = new AbortController();
  terminal.once("close", () => controller.abort());
  const ask = prompt => terminal.question(prompt, { signal: controller.signal });
  try {
    const username = await ask(provider === "supabase" ? "E-mail do administrador: " : "Usuário do administrador: ");
    echo = false;
    stdout.write("Senha (pelo menos 12 caracteres): ");
    const password = await ask("");
    stdout.write("\nConfirme a senha: ");
    const confirmation = await ask("");
    stdout.write("\n");
    if (password !== confirmation) throw new Error("As senhas não coincidem.");
    return { username, password };
  } finally { terminal.close(); }
}

try {
  try { process.loadEnvFile(new URL(".env", import.meta.url)); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const base = `http://127.0.0.1:${Number(process.env.PORT || 4173)}`;
  const request = (path, options) => fetch(base + path, { ...options, redirect: "error", signal: AbortSignal.timeout(30000) });
  const health = await request("/api/health");
  if (!health.ok || (await health.json()).app !== "wappy") throw new Error("Inicie o servidor local do Zelo antes de criar o administrador.");
  const response = await request("/api/auth/status");
  if (!response.ok) throw new Error("Não foi possível verificar o acesso ao Zelo.");
  const { configured, provider } = await response.json();
  if (configured === true) {
    console.log(`O administrador já está configurado. Entre em ${base}/login.`);
  } else {
    if (configured !== false) throw new Error("Não foi possível verificar o acesso ao Zelo.");
    const setupFile = await readFile(new URL(".wappy/primeiro-acesso.txt", import.meta.url), "utf8");
    const setupToken = setupFile.match(/^[a-f0-9]{64}$/m)?.[0];
    if (!setupToken) throw new Error("O arquivo de primeiro acesso está inválido. Reinicie o Zelo e tente novamente.");
    const account = await credentials(provider);
    const result = await request("/api/auth/setup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...account, setupToken })
    });
    if (!result.ok) throw new Error((await result.json()).error || "Não foi possível criar o administrador.");
    console.log(`Administrador criado. Entre em ${base}/login.`);
  }
} catch (error) {
  const message = error.message === "fetch failed" ? "Inicie o servidor local do Zelo e tente novamente." : error.code === "ENOENT" ? "Arquivo de primeiro acesso indisponível. Reinicie o Zelo e tente novamente." : error.name === "AbortError" ? "Criação do administrador cancelada." : error.message;
  console.error(`\n${message}`);
  process.exitCode = 1;
}
