import { createHash, randomBytes } from 'node:crypto';
import { fail } from '../core/settings.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const path = '/rest/v1/zelo_workspaces';
export const validOwner = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const emailValue = value => {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('Informe um e-mail válido.');
  return email;
};
export function createWorkspaceAccess(cloud, provider, { clock = Date.now, maxAccounts = 10 } = {}) {
  const byEmail = async email => (await cloud.request(`${path}?email=eq.${encodeURIComponent(email)}&select=*`))[0];
  const list = () => cloud.request(path + '?select=*&order=created.asc');
  const member = async id => {
    if (!validOwner(id)) return null;
    return (await cloud.request(`${path}?user_id=eq.${id}&enabled=eq.true&select=*`))[0] || null;
  };
  const publicRecord = row => ({ email: row.email, userId: row.user_id, role: row.role, enabled: row.enabled, pending: !row.user_id, expires: row.invitation_expires, created: row.created });
  async function invitation(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw fail('Convite inválido ou expirado.', 403);
    const rows = await cloud.request(`${path}?invitation_hash=eq.${digest(token)}&enabled=eq.true&select=*`);
    const row = rows[0];
    if (!row || row.user_id || Number(row.invitation_expires) <= clock()) throw fail('Convite inválido ou expirado.', 403);
    return row;
  }
  let edits = Promise.resolve();
  const serial = operation => { const result = edits.then(operation); edits = result.catch(() => {}); return result; };
  return {
    member, list,
    async accounts() { return (await list()).map(publicRecord); },
    async login(input) {
      const email = emailValue(input?.username);
      if (typeof input?.password !== 'string' || input.password.length > 256) throw fail('E-mail ou senha inválidos.', 401);
      const row = await byEmail(email);
      if (!row?.enabled || !row.user_id) throw fail('E-mail ou senha inválidos, ou conta sem acesso.', 401);
      const id = await provider.login({ username: email, password: input.password });
      if (id !== row.user_id) throw fail('E-mail ou senha inválidos.', 401);
      return row;
    },
    async invitation(token) { const row = await invitation(token); return { email: row.email, expires: row.invitation_expires }; },
    invite(email) { return serial(async () => {
      email = emailValue(email);
      const before = await byEmail(email);
      if (before?.user_id) throw fail('Essa conta já existe. Use os controles de acesso da lista.', 409);
      if (!before && (await list()).length >= maxAccounts) throw fail(`Este servidor aceita até ${maxAccounts} contas.`, 409);
      const token = randomBytes(32).toString('hex'), expires = clock() + 48 * 60 * 60 * 1000;
      await cloud.request(path + '?on_conflict=email', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: { email, role: 'member', enabled: true, invitation_hash: digest(token), invitation_expires: expires, created: before?.created || clock() } });
      return { token, email, expires };
    }); },
    accept(input) { return serial(async () => {
      const row = await invitation(input?.token);
      if (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 256) throw fail('A senha deve ter entre 12 e 256 caracteres.');
      let id;
      // Existing Supabase accounts must prove their own password; never reset one.
      try { id = await provider.login({ username: row.email, password: input.password }); }
      catch (error) { if (![400, 401, 422].includes(error.status)) throw error; }
      if (!id) {
        try { id = await provider.create({ username: row.email, password: input.password }); }
        catch { throw fail('Não foi possível ativar. Se esse e-mail já tem conta, use a senha existente.', 409); }
      }
      if (!validOwner(id)) throw fail('Não foi possível confirmar a conta.', 502);
      const result = await cloud.request(`${path}?email=eq.${encodeURIComponent(row.email)}&invitation_hash=eq.${digest(input.token)}&user_id=is.null`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { user_id: id, invitation_hash: null, invitation_expires: null } });
      if (result.length !== 1) throw fail('Convite já utilizado. Entre com sua conta.', 409);
      return result[0];
    }); },
    setEnabled(email, enabled) { return serial(async () => {
      email = emailValue(email);
      const row = await byEmail(email);
      if (!row) throw fail('Conta não encontrada.', 404);
      if (row.role === 'owner') throw fail('O acesso do administrador não pode ser desativado.', 403);
      if (typeof enabled !== 'boolean') throw fail('Situação inválida.');
      await cloud.request(`${path}?email=eq.${encodeURIComponent(email)}`, { method: 'PATCH', body: { enabled, ...(!enabled ? { invitation_hash: null, invitation_expires: null } : {}) } });
      return { userId: row.user_id, enabled };
    }); },
  };
}
