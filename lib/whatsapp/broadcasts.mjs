import { broadcastActions } from './broadcast-actions.mjs';
import { previewBroadcast } from './broadcast-preview.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { fail } from '../core/settings.mjs';
import { migrateBroadcasts } from './broadcast-schema.mjs';
import { createOptouts } from './optouts.mjs';
import { broadcastPolicy, insideWindow, localTime } from './broadcast-policy.mjs';
import { recipientContent } from './broadcast-content.mjs';

export async function createBroadcasts({ db, connection, send, clock = Date.now, random = Math.random, selfPhone = () => '' }) {
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
    ...broadcastActions({ db, connection, get, clock }),
    preview: input => previewBroadcast({ db, optouts, connection, clock }, input),
    async test(input, actor = 'operador') {
      if (input.confirmed !== true) throw fail('Confirme o envio de teste ao seu próprio número.');
      const phone = selfPhone(); if (!phone) throw fail('Não foi possível identificar o próprio número. Valide a conexão primeiro.', 409);
      return this.create({ ...input, name: 'Teste · ' + (input.name || 'Disparo'), scheduledAt: undefined, phones: phone, recipients: [{ ...(input.recipients?.[0] || {}), phone }], consent: true }, actor);
    },
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
      const policy = broadcastPolicy(input, account);
      const preview = await previewBroadcast({ db, optouts, connection, clock }, input);
      const phones = preview.recipients.map(item => item.phone), suppressed = preview.suppressed.length;
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
      const hash = createHash('sha256').update(JSON.stringify({ recipients: preview.normalized, windowOnly: input.windowOnly === true, payload, policy, scheduledAt: input.scheduledAt || null })).digest('hex');
      const existing = (await db.execute({ sql: 'SELECT account,hash FROM wa_broadcasts WHERE id=?', args: [input.requestId] })).rows[0];
      if (existing) {
        if (existing.hash !== hash || existing.account !== account) throw fail('Identificador reutilizado com outro disparo.', 409);
        return get(input.requestId);
      }
      if (preview.errors.length) throw fail(`Linha ${preview.errors[0].row}: ${preview.errors[0].reason}`);
      if (!preview.ready) throw fail('Há contatos fora da janela de 24 horas. Escolha enviar somente na janela ou use um template aprovado.', 409);
      if (!phones.length) throw fail('Não há destinatários disponíveis após aplicar a supressão e a janela.');
      if (input.scheduledAt != null && scheduled < clock()) throw fail('Escolha uma data e horário futuros.');
      await db.batch([
        { sql: "INSERT INTO wa_broadcasts(id,account,hash,payload,state,scheduled,next_at,created,consent_at,consent_by) VALUES (?,?,?,?,'queued',?,?,?,?,?)", args: [input.requestId, account, hash, payload, scheduled, scheduled, clock(), clock(), actor] },
        ...preview.recipients.map(item => ({ sql: "INSERT INTO wa_broadcast_items(id,campaign,phone,state,name,vars,updated) VALUES(?,?,?,'pending',?,?,?)", args: [randomUUID(), input.requestId, item.phone, item.name, JSON.stringify(item.vars), clock()] })),
        { sql: `UPDATE wa_broadcasts SET ${Object.keys(policy).map(key => `${key}=?`).join(',')} WHERE id=?`, args: [...Object.values(policy), input.requestId] },
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
      const result = await db.execute({ sql: "UPDATE wa_broadcasts SET state='queued',failures=0,paused_reason=NULL WHERE id=? AND state='paused'", args: [id] });
      if (!result.rowsAffected) throw fail('Somente um disparo pausado pode ser retomado.', 409);
      return get(id);
    },
    async tick() {
      await db.execute("UPDATE wa_broadcasts SET state='completed' WHERE state='queued' AND NOT EXISTS(SELECT 1 FROM wa_broadcast_items WHERE campaign=wa_broadcasts.id AND state IN ('pending','sending'))");
      const campaign = (await db.execute({ sql: "SELECT * FROM wa_broadcasts WHERE state='queued' AND account=? AND next_at<=? ORDER BY scheduled,created,rowid LIMIT 1", args: [connection(), clock()] })).rows[0];
      if (!campaign) return;
      if (!insideWindow(campaign, clock())) return;
      const pacing = (await db.execute({ sql: 'SELECT next_at FROM wa_broadcast_accounts WHERE account=?', args: [campaign.account] })).rows[0];
      if (Number(pacing?.next_at || 0) > clock()) return;
      const day = localTime(clock()).date;
      const usage = (await db.execute({ sql: 'SELECT count FROM wa_broadcast_usage WHERE account=? AND day=?', args: [campaign.account, day] })).rows[0];
      const minute = (await db.execute({ sql: 'SELECT COUNT(*) AS count FROM wa_broadcast_attempts WHERE account=? AND created>?', args: [campaign.account, clock() - 60000] })).rows[0];
      if (Number(usage?.count || 0) >= campaign.daily_cap || minute.count >= campaign.per_minute) {
        await db.execute({ sql: 'UPDATE wa_broadcasts SET paused_reason=? WHERE id=?', args: [Number(usage?.count || 0) >= campaign.daily_cap ? 'Teto diário de tentativas atingido. A fila aguarda o próximo dia em São Paulo.' : 'Aguardando o limite por minuto.', campaign.id] }); return;
      }
      const item = (await db.execute({ sql: "SELECT * FROM wa_broadcast_items WHERE campaign=? AND state='pending' ORDER BY rowid LIMIT 1", args: [campaign.id] })).rows[0];
      if (!item) return;
      if (campaign.account.startsWith('cloud:') && !JSON.parse(campaign.payload).template) {
        const window = await previewBroadcast({ db, optouts, connection: () => campaign.account, clock }, { phones: item.phone });
        if (window.outsideWindow) { await db.execute({ sql: "UPDATE wa_broadcast_items SET state='skipped',skip_reason='Janela de 24 horas encerrada. Use um template.',updated=? WHERE id=? AND state='pending'", args: [clock(), item.id] }); return; }
      }
      if (await optouts.blocked(campaign.account, item.phone)) { await db.execute({ sql: "UPDATE wa_broadcast_items SET state='skipped',skip_reason='Contato descadastrado',updated=? WHERE id=? AND state='pending'", args: [clock(), item.id] }); return; }
      const claimed = await db.execute({ sql: "UPDATE wa_broadcast_items SET state='sending',attempts=attempts+1,updated=? WHERE id=? AND state='pending' AND NOT EXISTS(SELECT 1 FROM wa_broadcast_items b JOIN wa_broadcasts c ON c.id=b.campaign WHERE c.account=? AND b.state='sending')", args: [clock(), item.id, campaign.account] });
      if (!claimed.rowsAffected) return;
      const nextAt = clock() + campaign.interval_ms + Math.floor(random() * (campaign.jitter_ms + 1));
      await db.batch([
        { sql: 'INSERT INTO wa_broadcast_accounts VALUES(?,?) ON CONFLICT(account) DO UPDATE SET next_at=excluded.next_at', args: [campaign.account, nextAt] },
        { sql: 'INSERT INTO wa_broadcast_usage VALUES(?,?,1) ON CONFLICT(account,day) DO UPDATE SET count=count+1', args: [campaign.account, day] },
        { sql: 'INSERT INTO wa_broadcast_attempts VALUES(?,?,?,?)', args: [randomUUID(), campaign.account, item.id, clock()] },
        { sql: 'UPDATE wa_broadcasts SET next_at=?,paused_reason=NULL WHERE id=?', args: [nextAt, campaign.id] },
      ], 'write');
      try {
        const result = await send({ ...recipientContent(JSON.parse(campaign.payload), { ...item, vars: JSON.parse(item.vars) }), phone: item.phone, requestId: item.send_id || item.id, broadcast: true });
        await db.execute({ sql: "UPDATE wa_broadcast_items SET state='sent',message_id=? WHERE id=?", args: [result.messageId || null, item.id] });
        await db.execute({ sql: 'UPDATE wa_broadcasts SET failures=0 WHERE id=?', args: [campaign.id] });
      } catch (error) {
        await db.execute({ sql: 'UPDATE wa_broadcast_items SET state=?,error=? WHERE id=?', args: [error.suppressed ? 'skipped' : !error.status || error.status === 504 ? 'unknown' : 'failed', error.status ? error.message : 'Resultado sem confirmação. Confira a conversa antes de reenviar.', item.id] });
        if (!error.suppressed) await db.execute({ sql: "UPDATE wa_broadcasts SET failures=failures+1,state=CASE WHEN failures>=2 OR ? THEN 'paused' ELSE state END,paused_reason=CASE WHEN failures>=2 OR ? THEN ? ELSE paused_reason END WHERE id=?", args: [error.authError || error.rateLimited ? 1 : 0, error.authError || error.rateLimited ? 1 : 0, error.authError ? 'Credencial ou permissão recusada. Corrija a conexão antes de retomar.' : error.rateLimited ? 'Limite da Meta. Confira a conta antes de retomar.' : 'Pausa automática após 3 falhas consecutivas. Confira os resultados.', campaign.id] });
      }
      await db.execute("UPDATE wa_broadcasts SET state='completed' WHERE state='queued' AND NOT EXISTS(SELECT 1 FROM wa_broadcast_items WHERE campaign=wa_broadcasts.id AND state IN ('pending','sending'))");
    },
  };
}
