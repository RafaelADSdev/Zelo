import { fail } from '../core/settings.mjs';
export async function broadcastHistory({ db, connection }) {
  const tables = new Set((await db.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map(row => row.name));
  const cloudId = tables.has('wa_outbox') ? "COALESCE(i.message_id,(SELECT meta_id FROM wa_outbox WHERE account_id=substr(c.account,7) AND (id='broadcast:'||COALESCE(i.send_id,i.id) OR id='manual:'||COALESCE(i.send_id,i.id)) LIMIT 1))" : 'i.message_id';
  const cloud = tables.has('wa_statuses') ? `(SELECT status FROM wa_statuses WHERE id=${cloudId})` : 'NULL';
  const qr = tables.has('qr_outbox') ? "(SELECT state FROM qr_outbox WHERE account=substr(c.account,4) AND (id='broadcast:'||COALESCE(i.send_id,i.id) OR id='manual:'||COALESCE(i.send_id,i.id)) LIMIT 1)" : 'NULL';
  const delivery = `CASE WHEN c.account LIKE 'cloud:%' THEN ${cloud} ELSE ${qr} END`;
  const fields = row => { const { hash, payload, ...campaign } = row; return { ...campaign, connectionReady: campaign.account === connection(), ...JSON.parse(payload) }; };
  async function header(id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw fail('Identificador de disparo inválido.');
    const row = (await db.execute({ sql: 'SELECT * FROM wa_broadcasts WHERE id=?', args: [id] })).rows[0];
    if (!row) throw fail('Disparo não encontrado.', 404); return fields(row);
  }
  const items = async (id, limit = 500, offset = 0) => (await db.execute({ sql: `SELECT i.*,${delivery} AS delivery_status FROM wa_broadcast_items i JOIN wa_broadcasts c ON c.id=i.campaign WHERE i.campaign=? ORDER BY i.rowid LIMIT ? OFFSET ?`, args: [id, limit, offset] })).rows;
  return {
    async get(id) { return { ...await header(id), items: await items(id) }; },
    async details(id, { page = 1, limit = 50 } = {}) {
      if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw fail('Paginação inválida. Use até 100 destinatários por página.');
      const campaign = await header(id), total = Number((await db.execute({ sql: 'SELECT COUNT(*) AS total FROM wa_broadcast_items WHERE campaign=?', args: [id] })).rows[0].total);
      const audit = (await db.execute({ sql: 'SELECT item,action,actor,detail,created FROM wa_broadcast_audit WHERE campaign=? ORDER BY id DESC LIMIT 50', args: [id] })).rows;
      return { ...campaign, items: await items(id, limit, (page - 1) * limit), page, limit, total, audit };
    },
    async list() {
      const states = ['pending','sending','sent','failed','unknown','skipped','cancelled'];
      const rows = (await db.execute(`WITH recent AS (SELECT * FROM wa_broadcasts ORDER BY created DESC,rowid DESC LIMIT 30), enriched AS (SELECT i.*,${delivery} AS delivery FROM wa_broadcast_items i JOIN recent c ON c.id=i.campaign) SELECT c.*,COUNT(i.id) AS total,${states.map(state => `SUM(CASE WHEN i.state='${state}' THEN 1 ELSE 0 END) AS n_${state}`).join(',')},SUM(CASE WHEN i.delivery IN ('delivered','read') THEN 1 ELSE 0 END) AS delivered,SUM(CASE WHEN i.delivery='read' THEN 1 ELSE 0 END) AS read,SUM(CASE WHEN i.delivery='failed' THEN 1 ELSE 0 END) AS delivery_failed FROM recent c LEFT JOIN enriched i ON i.campaign=c.id GROUP BY c.id ORDER BY c.created DESC`)).rows;
      return rows.map(row => { const result = fields(row), counts = {}; states.forEach(state => { counts[state] = Number(result[`n_${state}`]); delete result[`n_${state}`]; }); return { ...result, counts }; });
    },
  };
}
