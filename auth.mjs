import { randomBytes, scrypt as derive, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
const scrypt = promisify(derive), lifetime = 12 * 60 * 60 * 1000;
const digest = value => createHash("sha256").update(value).digest("hex");
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function equal(a, b) { const x = Buffer.from(a || ""), y = Buffer.from(b || ""); return x.length === y.length && timingSafeEqual(x, y); }
async function passwordHash(password, salt) { return (await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })).toString("hex"); }
export async function createAuth(directory, { clock = Date.now, provider } = {}) {
  await mkdir(directory, { recursive: true });
  const file = join(directory, "auth.json"), setupFile = join(directory, "primeiro-acesso.txt");
  let account = null, creating = false, failures = 0, blockedUntil = 0;
  try {
    account = JSON.parse(await readFile(file, "utf8"));
    if (typeof account.username !== "string" || (account.provider === "supabase" ? !provider || !/^[a-f0-9-]{36}$/.test(account.userId) : !/^[a-f0-9]{32}$/.test(account.salt) || !/^[a-f0-9]{128}$/.test(account.hash))) throw new Error("invalid auth");
  } catch (error) { if (error.code !== "ENOENT") throw new Error("Não foi possível ler a autenticação local. Verifique auth.json."); }
  const setupToken = account ? "" : randomBytes(32).toString("hex");
  const controlToken = randomBytes(32).toString("hex");
  await writeFile(join(directory, "control-token"), controlToken, { mode: 0o600 });
  if (setupToken) await writeFile(setupFile, `ZELO — PRIMEIRO ACESSO\n\nCódigo para criar o administrador (uso único):\n${setupToken}\n\nAbra http://127.0.0.1:4173/login e informe esse código, seu usuário e uma senha com pelo menos 12 caracteres.\n`, { mode: 0o600 });
  const sessions = new Map();
  function session(req) {
    const token = req.headers.cookie?.match(/(?:^|;\s*)zelo_auth=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
    if (!token) return null;
    const key = digest(token), record = sessions.get(key);
    if (!record || record.expires <= clock()) { sessions.delete(key); return null; }
    return { key, username: record.username };
  }
  function throttle() { if (blockedUntil > clock()) throw fail("Muitas tentativas. Aguarde 5 minutos e tente novamente.", 429); if (blockedUntil) { blockedUntil = 0; failures = 0; } }
  function denied() { failures++; if (failures >= 5) blockedUntil = clock() + 300000; throw fail("Usuário, senha ou código inválido.", 401); }
  function issue() {
    failures = 0; blockedUntil = 0;
    for (const [key, record] of sessions) if (record.expires <= clock()) sessions.delete(key);
    while (sessions.size >= 10) sessions.delete(sessions.keys().next().value);
    const token = randomBytes(32).toString("base64url");
    sessions.set(digest(token), { username: account.username, expires: clock() + lifetime });
    return token;
  }
  return {
    configured: () => Boolean(account), session,
    provider: () => account?.provider || (!account && provider ? "supabase" : "local"),
    control: token => equal(token, controlToken),
    async setup(input) {
      throttle();
      if (account || creating) throw fail("O administrador já foi configurado. Entre com sua conta.", 409);
      if (typeof input?.setupToken !== "string" || !equal(input.setupToken, setupToken)) denied();
      const username = typeof input.username === "string" ? input.username.trim().toLowerCase() : "";
      if (!/^[a-z0-9_.@+-]{3,80}$/.test(username)) throw fail("Use um usuário de 3 a 80 caracteres, sem espaços ou acentos.");
      if (provider && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) throw fail("Informe seu e-mail para criar a conta no Supabase.");
      if (typeof input.password !== "string" || input.password.length < 12 || input.password.length > 256) throw fail("A senha deve ter entre 12 e 256 caracteres.");
      creating = true;
      try {
        const salt = randomBytes(16).toString("hex");
        const next = provider ? { username, provider: "supabase", userId: await provider.create({ username, password: input.password }), createdAt: clock() } : { username, salt, hash: await passwordHash(input.password, salt), createdAt: clock() };
        await writeFile(file + ".tmp", JSON.stringify(next), { mode: 0o600 }); await rename(file + ".tmp", file);
        account = next; await unlink(setupFile).catch(() => {}); return issue();
      } finally { creating = false; }
    },
    async login(input) {
      throttle();
      if (!account || typeof input?.username !== "string" || typeof input?.password !== "string" || input.password.length > 256) denied();
      if (account.provider === "supabase") {
        if (input.username.trim().toLowerCase() !== account.username) denied();
        let id; try { id = await provider.login({ username: account.username, password: input.password }); } catch (error) { if (error.status === 401) denied(); throw error; }
        if (id !== account.userId) denied();
        return issue();
      }
      const hash = await passwordHash(input.password, account.salt);
      if (!equal(hash, account.hash) || input.username.trim().toLowerCase() !== account.username) denied();
      return issue();
    },
    logout(req) { const current = session(req); if (current) sessions.delete(current.key); },
    cookie(token = "") { return `zelo_auth=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? lifetime / 1000 : 0}`; },
  };
}
