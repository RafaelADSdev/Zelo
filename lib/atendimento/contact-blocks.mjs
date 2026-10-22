import { fail } from "../core/settings.mjs";

export async function createContactBlocks(db) {
  await db.execute("CREATE TABLE IF NOT EXISTS contact_blocks(mode TEXT NOT NULL,account TEXT NOT NULL,contact TEXT NOT NULL,blocked INTEGER NOT NULL,updated INTEGER NOT NULL,PRIMARY KEY(mode,account,contact))");
  async function blocked(mode, account, contact) {
    const row = (await db.execute({ sql: "SELECT blocked FROM contact_blocks WHERE mode=? AND account=? AND contact=?", args: [mode, account, contact] })).rows[0];
    return row?.blocked === 1;
  }
  return {
    blocked,
    async set(mode, account, contact, value) {
      if (typeof value !== "boolean") throw fail("Informe um bloqueio válido.");
      await db.execute({ sql: "INSERT INTO contact_blocks(mode,account,contact,blocked,updated) VALUES(?,?,?,?,?) ON CONFLICT(mode,account,contact) DO UPDATE SET blocked=excluded.blocked,updated=excluded.updated", args: [mode, account, contact, Number(value), Date.now()] });
      return { blocked: value };
    },
    async contacts(mode, account, contacts) {
      const rows = (await db.execute({ sql: "SELECT contact FROM contact_blocks WHERE mode=? AND account=? AND blocked=1", args: [mode, account] })).rows;
      const denied = new Set(rows.map(row => row.contact));
      return contacts.map(contact => ({ ...contact, blocked: denied.has(contact.phone) }));
    },
    async assertAllowed(mode, account, contact) {
      if (await blocked(mode, account, contact)) throw Object.assign(fail("A IA está bloqueada para este contato. Desbloqueie a conversa antes de tentar responder com IA.", 409), { contactBlocked: true });
    },
  };
}
