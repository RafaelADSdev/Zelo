import { fail } from "../core/settings.mjs";
export function createSupabase({ url, secretKey, publishableKey, fetchImpl = fetch }) {
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url || "") || !secretKey) throw fail("Configure a URL e a chave de servidor do Supabase.", 500);
  const origin = url.replace(/\/$/, "");
  async function request(path, { method = "GET", body, headers = {}, binary = false, publicKey = false, timeoutMs = 90000 } = {}) {
    let response;
    try {
      response = await fetchImpl(origin + path, { method, redirect: "error", headers: { apikey: publicKey ? publishableKey : secretKey, ...(body && !(body instanceof Uint8Array) ? { "Content-Type": "application/json" } : {}), ...headers }, ...(body !== undefined ? { body: body instanceof Uint8Array ? body : JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs) });
    } catch { throw fail("Não foi possível conectar ao Supabase. Os dados locais foram preservados.", 502); }
    if (!response.ok) {
      if (path.startsWith("/auth/v1/token") && [400,401,422].includes(response.status)) throw fail("Usuário ou senha inválido.", 401);
      let code; try { code = (await response.json()).code; } catch {}
      if (code === "P0001") throw fail("O Supabase recusou a alteração. Reabra a ficha e confira os limites do catálogo.", 409);
      throw fail(response.status === 401 || response.status === 403 ? "Acesso ao Supabase recusado. Confira a configuração de servidor." : "Falha na operação do Supabase. Verifique a conexão e a migração do banco.", 502);
    }
    if (binary) return Buffer.from(await response.arrayBuffer());
    const text = await response.text(); return text ? JSON.parse(text) : null;
  }
  return { request, origin };
}
