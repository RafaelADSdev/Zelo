import { normalizeBroadcastPhone } from './broadcast-preview.mjs';
import { fail } from '../core/settings.mjs';
export function optoutPhone(value) { const raw = String(value || '').replace(/@s\.whatsapp\.net$/, '').replace(/@lid$/, ''); return normalizeBroadcastPhone(raw) || ''; }
export const isOptout = text => typeof text === 'string' && ['sair','parar','cancelar','stop','nao quero receber'].includes(text.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase().replace(/[.!?]+$/, '').replace(/\s+/g, ' '));
export async function createOptouts(db, clock = Date.now) {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS wa_optouts(account TEXT NOT NULL,phone TEXT NOT NULL,reason TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(account,phone));
    CREATE TABLE IF NOT EXISTS wa_optout_receipts(account TEXT NOT NULL,message_id TEXT NOT NULL,PRIMARY KEY(account,message_id));
    CREATE TABLE IF NOT EXISTS wa_optout_preferences(account TEXT PRIMARY KEY,confirmation TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wa_optout_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,account TEXT NOT NULL,phone TEXT NOT NULL,action TEXT NOT NULL,actor TEXT NOT NULL,created INTEGER NOT NULL);
  `);
  const phone = value => { const result = optoutPhone(value); if (!/^[1-9]\d{6,14}$/.test(result)) throw fail('Número de supressão inválido.'); return result; };
  const account = value => { if (typeof value !== 'string' || !/^(qr|cloud):.+/.test(value)) throw fail('Conecte seu WhatsApp para gerenciar a supressão.', 409); return value; };
  return {
    async blocked(owner, number) { return Boolean((await db.execute({ sql: 'SELECT 1 FROM wa_optouts WHERE account=? AND phone=?', args: [owner, optoutPhone(number)] })).rows.length); },
    async assertAllowed(owner, number) { if (await this.blocked(owner, number)) throw Object.assign(fail('Contato descadastrado: envio suprimido.', 409), { suppressed: true }); },
    async list(owner) { account(owner); return (await db.execute({ sql: 'SELECT phone,reason,created FROM wa_optouts WHERE account=? ORDER BY created DESC,phone', args: [owner] })).rows; },
    async confirmation(owner) { return (await db.execute({ sql: 'SELECT confirmation FROM wa_optout_preferences WHERE account=?', args: [owner] })).rows[0]?.confirmation ?? 'Você saiu da lista de mensagens. Seu pedido foi registrado.'; },
    async configure(owner, text) { account(owner); if (typeof text !== 'string' || text.length > 500) throw fail('Use uma confirmação de até 500 caracteres.'); await db.execute({ sql: 'INSERT INTO wa_optout_preferences VALUES(?,?) ON CONFLICT(account) DO UPDATE SET confirmation=excluded.confirmation', args: [owner, text.trim()] }); },
    async set(owner, numbers, remove = false, reason = 'Inclusão manual', actor = 'operador') {
      account(owner); if (!Array.isArray(numbers) || !numbers.length || numbers.length > 5000 || typeof remove !== 'boolean' || typeof reason !== 'string' || reason.length > 300) throw fail('Informe até 5.000 números e um motivo de até 300 caracteres.');
      const phones = [...new Set(numbers.map(phone))];
      await db.batch(phones.flatMap(number => [remove ? { sql: 'DELETE FROM wa_optouts WHERE account=? AND phone=?', args: [owner, number] } : { sql: 'INSERT INTO wa_optouts VALUES(?,?,?,?) ON CONFLICT(account,phone) DO UPDATE SET reason=excluded.reason,created=excluded.created', args: [owner, number, reason, clock()] }, { sql: 'INSERT INTO wa_optout_audit(account,phone,action,actor,created) VALUES(?,?,?,?,?)', args: [owner, number, remove ? 'remove' : 'add', actor, clock()] }]), 'write');
      return { count: phones.length };
    },
    async receive(owner, number, id) {
      const normalized = phone(number);
      const results = await db.batch([
        { sql: "INSERT INTO wa_optouts SELECT ?,?,'Pedido recebido no WhatsApp',? WHERE NOT EXISTS(SELECT 1 FROM wa_optout_receipts WHERE account=? AND message_id=?) ON CONFLICT(account,phone) DO UPDATE SET reason=excluded.reason", args: [owner, normalized, clock(), owner, id] },
        { sql: 'INSERT OR IGNORE INTO wa_optout_receipts VALUES(?,?)', args: [owner, id] },
      ], 'write');
      return results[1].rowsAffected === 1;
    },
  };
}
