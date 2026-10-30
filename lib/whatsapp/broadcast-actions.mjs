import { createHash, randomUUID } from 'node:crypto';
import { fail } from '../core/settings.mjs';
export function broadcastActions({ db, connection, get, clock }) {
  const active = async (id, sending = false) => {
    const campaign = await get(id);
    if (campaign.account !== connection()) throw fail('Volte à conexão original para realizar esta ação.', 409);
    if (sending && !campaign.consent_at) throw fail('Duplique e confirme o consentimento antes de reenviar.', 409);
    return campaign;
  };
  async function operation(input, actor, campaign, changes, action) {
    if (!/^[a-f0-9-]{36}$/.test(input.requestId || '')) throw fail('Identificador único da decisão inválido.');
    const fingerprint = createHash('sha256').update(JSON.stringify({ input, actor, action })).digest('hex');
    const previous = (await db.execute({ sql: 'SELECT fingerprint FROM wa_broadcast_operations WHERE id=?', args: [input.requestId] })).rows[0];
    if (previous) { if (previous.fingerprint !== fingerprint) throw fail('Identificador de decisão reutilizado.', 409); return get(campaign); }
    const statements = await changes();
    await db.batch([...statements,
      { sql: 'INSERT INTO wa_broadcast_audit(campaign,item,action,actor,detail,created) VALUES(?,?,?,?,?,?)', args: [campaign, input.itemId || null, action, actor, JSON.stringify({ decision: input.decision || action }), clock()] },
      { sql: 'INSERT INTO wa_broadcast_operations VALUES(?,?,?)', args: [input.requestId, fingerprint, clock()] },
    ], 'write');
    return get(campaign);
  }
  return {
    async resolve(input, actor = 'operador') {
      if (input.confirmed !== true || !['delivered','retry'].includes(input.decision)) throw fail('Confirme explicitamente sua decisão após conferir a conversa.');
      await active(input.id, input.decision === 'retry');
      return operation(input, actor, input.id, async () => {
        const item = (await db.execute({ sql: "SELECT * FROM wa_broadcast_items WHERE id=? AND campaign=? AND state='unknown'", args: [input.itemId, input.id] })).rows[0];
        if (!item) throw fail('Somente um item sem confirmação pode ser resolvido.', 409);
        return [
          { sql: 'UPDATE wa_broadcast_items SET state=?,send_id=?,error=NULL,updated=?,resolution=?,resolved_by=? WHERE id=? AND state=\'unknown\'', args: [input.decision === 'retry' ? 'pending' : 'sent', input.decision === 'retry' ? randomUUID() : item.send_id, clock(), input.decision, actor, item.id] },
          ...(input.decision === 'retry' ? [{ sql: "UPDATE wa_broadcasts SET state='queued',failures=0,paused_reason=NULL WHERE id=?", args: [input.id] }] : []),
        ];
      }, 'resolve');
    },
    async retryFailed(input, actor = 'operador') {
      await active(input.id, true);
      return operation(input, actor, input.id, async () => {
        const items = (await db.execute({ sql: "SELECT id FROM wa_broadcast_items WHERE campaign=? AND state='failed'", args: [input.id] })).rows;
        if (!items.length) throw fail('Este disparo não possui falhas para reenviar.', 409);
        return [...items.map(item => ({ sql: "UPDATE wa_broadcast_items SET state='pending',send_id=?,error=NULL,updated=? WHERE id=? AND state='failed'", args: [randomUUID(), clock(), item.id] })), { sql: "UPDATE wa_broadcasts SET state='queued',failures=0,paused_reason=NULL WHERE id=?", args: [input.id] }];
      }, 'retry_failed');
    },
    async duplicate(id) {
      const campaign = await get(id);
      return { name: campaign.name ? `${campaign.name} (cópia)`.slice(0,100) : '', text: campaign.text, ...(campaign.template ? { template: campaign.template } : {}), recipients: campaign.items.map(item => ({ phone: item.phone, name: item.name, vars: JSON.parse(item.vars) })), timezone: campaign.timezone, windowStart: campaign.window_start, windowEnd: campaign.window_end, days: JSON.parse(campaign.days), intervalMs: campaign.interval_ms, jitterMs: campaign.jitter_ms, perMinute: campaign.per_minute, dailyCap: campaign.daily_cap, consent: false };
    },
  };
}
