import { jidNormalizedUser } from '@whiskeysockets/baileys';
import { contactName } from './contact-name.mjs';

const direct = value => /^\d{5,20}@(s\.whatsapp\.net|lid)$/.test(value || '');
export async function createQrContactNames(db) {
  await db.execute('CREATE TABLE IF NOT EXISTS qr_contact_names (account TEXT NOT NULL,jid TEXT NOT NULL,name TEXT NOT NULL,priority INTEGER NOT NULL,PRIMARY KEY(account,jid))');
  async function pnFor(jid, socket) {
    try { return jidNormalizedUser(await socket?.signalRepository?.lidMapping?.getPNForLID?.(jid) || ''); } catch { return ''; }
  }
  function variants(value) {
    const jid = value.includes('@') ? jidNormalizedUser(value) : `${value}@s.whatsapp.net`, result = [jid];
    if (/^55\d{2}9\d{8}@s\.whatsapp\.net$/.test(jid)) result.push(jid.slice(0, 4) + jid.slice(5));
    else if (/^55\d{2}[6-9]\d{7}@s\.whatsapp\.net$/.test(jid)) result.push(jid.slice(0, 4) + '9' + jid.slice(4));
    return result;
  }
  return {
    async remember(account, contacts, socket) {
      if (!direct(account) || !Array.isArray(contacts)) return;
      const statements = [];
      for (const item of contacts) {
        const candidates = [[item?.name,3],[item?.notify,2],[item?.verifiedName,1]], chosen = candidates.map(([value, priority]) => ({ name: contactName(value), priority })).find(item => item.name);
        if (!chosen) continue;
        const jids = new Set([item.id,item.lid,item.phoneNumber].filter(value => typeof value === 'string').map(jidNormalizedUser).filter(direct));
        for (const jid of [...jids]) if (jid.endsWith('@lid')) { const pn = await pnFor(jid, socket); if (direct(pn)) jids.add(pn); }
        for (const jid of jids) statements.push({ sql: 'INSERT INTO qr_contact_names VALUES(?,?,?,?) ON CONFLICT(account,jid) DO UPDATE SET name=excluded.name,priority=excluded.priority WHERE excluded.priority>=qr_contact_names.priority', args: [account,jid,chosen.name,chosen.priority] });
      }
      for (let index = 0; index < statements.length; index += 200) await db.batch(statements.slice(index,index + 200), 'write');
    },
    async lookup(account, phones, socket) {
      const rows = (await db.execute({ sql: 'SELECT jid,name FROM qr_contact_names WHERE account=? ORDER BY priority DESC', args: [account] })).rows;
      const previous = (await db.execute({ sql: 'SELECT jid,name FROM qr_contacts WHERE account=?', args: [account] })).rows;
      const known = new Map();
      for (const row of [...rows,...previous]) { const name = contactName(row.name); if (name && !known.has(row.jid)) known.set(row.jid,name); }
      const result = new Map();
      for (const phone of phones) {
        const ids = variants(phone);
        for (const jid of [...ids]) {
          if (jid.endsWith('@lid')) { const pn = await pnFor(jid,socket); if (direct(pn)) ids.push(...variants(pn)); }
          else { try { const lid = await socket?.signalRepository?.lidMapping?.getLIDForPN?.(jid); if (direct(lid)) ids.push(lid); } catch { /* Use the names already available locally. */ } }
        }
        const name = ids.map(jid => known.get(jid)).find(Boolean);
        if (name) result.set(phone,name);
      }
      return result;
    },
  };
}
