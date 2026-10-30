import { createHash, randomUUID } from 'node:crypto';
import { fail } from '../core/settings.mjs';
import { migrateBroadcasts } from './broadcast-schema.mjs';
import { createOptouts } from './optouts.mjs';

export async function createBroadcasts({ db, connection, send, clock = Date.now }) {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS wa_broadcasts (id TEXT PRIMARY KEY, account TEXT NOT NULL, hash TEXT NOT NULL, payload TEXT NOT NULL, state TEXT NOT NULL, scheduled INTEGER NOT NULL, next_at INTEGER NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wa_broadcast_items (id TEXT PRIMARY KEY, campaign TEXT NOT NULL, phone TEXT NOT NULL, state TEXT NOT NULL, error TEXT, message_id TEXT);
    CREATE INDEX IF NOT EXISTS wa_broadcast_items_campaign ON wa_broadcast_items(campaign,state);
    UPDATE wa_broadcast_items SET state='unknown',error='Servidor reiniciado durante o envio. Confira a conversa antes de enviar novamente.' WHERE state='sending';
  `);
  await migrateBroadcasts(db);
  const optouts = await createOptouts(db, clock);
  const get = async id => {
    const row = (await db.execute({ sql: 'SELECT * FROM wa_broadcasts WHERE id=?', args: [id] })).rows[0];
    if (!row) throw fail('Disparo não encontrado.', 404);
    const { hash, payload, ...campaign } = row;
    return { ...campaign, connectionReady: campaign.account === connection(), ...JSON.parse(payload), items: (await db.execute({ sql: 'SELECT * FROM wa_broadcast_items WHERE campaign=? ORDER BY rowid', args: [id] })).rows };
  };
  return {
    get,
    async list() {
      const rows = (await db.execute('SELECT id FROM wa_broadcasts ORDER BY created DESC,rowid DESC LIMIT 30')).rows;
      return Promise.all(rows.map(row => get(row.id)));
    },
    async create(input, actor = 'operador') {
      if (input?.consent !== true) throw fail('Confirme que os contatos aceitaram receber suas mensagens.');
      if (!input || !/^[a-f0-9-]{36}$/.test(input.requestId || '')) throw fail('Identificador do disparo inválido.');
      if (input.name !== undefined && (typeof input.name !== 'string' || input.name.length > 100)) throw fail('Use um nome de até 100 caracteres.');
      const account = connection();
      if (!account || account.endsWith(':')) throw fail('Conecte seu WhatsApp antes de criar o disparo.', 409);
      if (typeof input.phones !== 'string' || input.phones.length > 25000) throw fail('Informe uma lista de números.');
      const lines = input.phones.split(/[\n;,]+/).map(line => line.trim()).filter(Boolean);
      if (!lines.length || lines.length > 500) throw fail('Informe de 1 a 500 números por disparo.');
      const normalized = [...new Set(lines.map(line => {
        if (!/^\+?[\d\s().-]+$/.test(line)) throw fail(`Número inválido: ${line.slice(0, 40)}.`);
        const phone = line.replace(/\D/g, '');
        if (!/^[1-9]\d{6,14}$/.test(phone)) throw fail('Informe números com DDI e DDD, com 7 a 15 dígitos.');
        return phone;
      }))];
      const phones = []; let suppressed = 0;
      for (const phone of normalized) { if (await optouts.blocked(account, phone)) suppressed++; else phones.push(phone); }
      if (!phones.length) throw fail('Todos os destinatários estão na lista de supressão.');
      let template;
      if (input.template) {
        if (account.startsWith('qr:')) throw fail('Templates exigem a Cloud API. No QR Code, use texto.');
        const value = input.template;
        if (!/^[a-z0-9_]{1,512}$/.test(value.name || '') || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(value.language?.code || '') || !Array.isArray(value.components || []) || JSON.stringify(value.components || []).length > 12000) throw fail('Template inválido.');
        template = { name: value.name, language: { code: value.language.code }, components: value.components || [] };
      } else if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 4000) throw fail('Informe uma mensagem de até 4.000 caracteres.');
      const scheduled = input.scheduledAt == null ? clock() : Date.parse(input.scheduledAt);
      if (!Number.isFinite(scheduled)) throw fail('Escolha uma data e horário futuros.');
      const payload = JSON.stringify({ ...(input.name?.trim() ? { name: input.name.trim() } : {}), text: template ? '' : input.text.trim(), ...(template ? { template } : {}) });
      const hash = createHash('sha256').update(JSON.stringify({ phones, payload, scheduledAt: input.scheduledAt || null })).digest('hex');
      const existing = (await db.execute({ sql: 'SELECT account,hash FROM wa_broadcasts WHERE id=?', args: [input.requestId] })).rows[0];
      if (existing) {
        if (existing.hash !== hash || existing.account !== account) throw fail('Identificador reutilizado com outro disparo.', 409);
        return get(input.requestId);
      }
      if (input.scheduledAt != null && scheduled < clock()) throw fail('Escolha uma data e horário futuros.');
      await db.batch([
        { sql: "INSERT INTO wa_broadcasts(id,account,hash,payload,state,scheduled,next_at,created,consent_at,consent_by) VALUES (?,?,?,?,'queued',?,?,?,?,?)", args: [input.requestId, account, hash, payload, scheduled, scheduled, clock(), clock(), actor] },
        ...phones.map(phone => ({ sql: "INSERT INTO wa_broadcast_items(id,campaign,phone,state) VALUES(?,?,?,'pending')", args: [randomUUID(), input.requestId, phone] })),
      ], 'write');
      return { ...await get(input.requestId), suppressed };
    },
    async cancel(id) {
      await get(id);
      await db.batch([
        { sql: "UPDATE wa_broadcasts SET state='cancelled' WHERE id=? AND state IN ('queued','paused')", args: [id] },
        { sql: "UPDATE wa_broadcast_items SET state='cancelled' WHERE campaign=? AND state='pending'", args: [id] },
      ], 'write');
      return get(id);
    },
    async pause(id) {
      await get(id);
      const result = await db.execute({ sql: "UPDATE wa_broadcasts SET state='paused' WHERE id=? AND state='queued'", args: [id] });
      if (!result.rowsAffected) throw fail('Somente um disparo na fila pode ser pausado.', 409);
      return get(id);
    },
    async resume(id) {
      if (!(await get(id)).consent_at) throw fail('Confirme consentimento em um novo disparo antes de retomar.', 409);
      const result = await db.execute({ sql: "UPDATE wa_broadcasts SET state='queued' WHERE id=? AND state='paused'", args: [id] });
      if (!result.rowsAffected) throw fail('Somente um disparo pausado pode ser retomado.', 409);
      return get(id);
    },
    async tick() {
      await db.execute("UPDATE wa_broadcasts SET state='completed' WHERE state='queued' AND NOT EXISTS(SELECT 1 FROM wa_broadcast_items WHERE campaign=wa_broadcasts.id AND state IN ('pending','sending'))");
      const campaign = (await db.execute({ sql: "SELECT * FROM wa_broadcasts WHERE state='queued' AND account=? AND next_at<=? ORDER BY scheduled,created,rowid LIMIT 1", args: [connection(), clock()] })).rows[0];
      if (!campaign) return;
      const item = (await db.execute({ sql: "SELECT * FROM wa_broadcast_items WHERE campaign=? AND state='pending' ORDER BY rowid LIMIT 1", args: [campaign.id] })).rows[0];
      if (!item) return;
      if (await optouts.blocked(campaign.account, item.phone)) { await db.execute({ sql: "UPDATE wa_broadcast_items SET state='skipped',skip_reason='Contato descadastrado',updated=? WHERE id=? AND state='pending'", args: [clock(), item.id] }); return; }
      const claimed = await db.execute({ sql: "UPDATE wa_broadcast_items SET state='sending' WHERE id=? AND state='pending'", args: [item.id] });
      if (!claimed.rowsAffected) return;
      try {
        const result = await send({ ...JSON.parse(campaign.payload), phone: item.phone, requestId: item.id, broadcast: true });
        await db.execute({ sql: "UPDATE wa_broadcast_items SET state='sent',message_id=? WHERE id=?", args: [result.messageId || null, item.id] });
      } catch (error) {
        await db.execute({ sql: 'UPDATE wa_broadcast_items SET state=?,error=? WHERE id=?', args: [error.suppressed ? 'skipped' : !error.status || error.status === 504 ? 'unknown' : 'failed', error.status ? error.message : 'Resultado sem confirmação. Confira a conversa antes de reenviar.', item.id] });
      }
      await db.execute({ sql: 'UPDATE wa_broadcasts SET next_at=? WHERE id=?', args: [clock() + 3000, campaign.id] });
      await db.execute("UPDATE wa_broadcasts SET state='completed' WHERE state='queued' AND NOT EXISTS(SELECT 1 FROM wa_broadcast_items WHERE campaign=wa_broadcasts.id AND state IN ('pending','sending'))");
    },
  };
}
