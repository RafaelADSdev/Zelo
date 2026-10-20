import { fail } from "./settings.mjs";
export function createSupabaseAuth(cloud) {
  const login = async ({ username, password }) => {
    const result = await cloud.request("/auth/v1/token?grant_type=password", { method: "POST", publicKey: true, body: { email: username, password } });
    if (!result?.user?.id) throw fail("Usuário ou senha inválido.", 401);
    return result.user.id;
  };
  return {
    login,
    async create({ username, password }) {
      const result = await cloud.request("/auth/v1/admin/users", { method: "POST", body: { email: username, password, email_confirm: true } });
      if (!result?.id) throw fail("O Supabase não confirmou a criação da conta.", 502);
      return result.id;
    },
  };
}
