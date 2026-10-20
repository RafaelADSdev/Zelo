import { BufferJSON, initAuthCreds, proto } from "@whiskeysockets/baileys";

// Credentials and Signal keys live only in the local, ignored database.
export async function createQrAuth(db) {
  await db.execute("CREATE TABLE IF NOT EXISTS qr_auth (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const read = async id => {
    const row = (await db.execute({ sql: "SELECT value FROM qr_auth WHERE id=?", args: [id] })).rows[0];
    return row ? JSON.parse(row.value, BufferJSON.reviver) : null;
  };
  let active = true, writes = Promise.resolve();
  function write(entries) {
    const result = writes.then(async () => {
      if (!active) return;
      if (entries.length) await db.batch(entries.map(([id, value]) => value == null
        ? { sql: "DELETE FROM qr_auth WHERE id=?", args: [id] }
        : { sql: "INSERT OR REPLACE INTO qr_auth(id,value) VALUES (?,?)", args: [id, JSON.stringify(value, BufferJSON.replacer)] }), "write");
    });
    writes = result.catch(() => {}); return result;
  }
  const creds = await read("creds") || initAuthCreds();
  return {
    state: { creds, keys: {
      async get(type, ids) {
        const result = {};
        for (const id of ids) {
          const value = await read(`${type}:${id}`);
          result[id] = value && type === "app-state-sync-key" ? proto.Message.AppStateSyncKeyData.fromObject(value) : value;
        }
        return result;
      },
      set: data => write(Object.entries(data).flatMap(([type, entries]) => Object.entries(entries).map(([id, value]) => [`${type}:${id}`, value]))),
    } },
    save: () => write([["creds", creds]]),
    async close() { active = false; await writes; },
    async clear() { active = false; await writes; await db.execute("DELETE FROM qr_auth"); },
  };
}
