export async function migrateBroadcasts(db) {
  const columns = {
    wa_broadcasts: { consent_at: 'INTEGER', consent_by: 'TEXT', timezone: "TEXT NOT NULL DEFAULT 'America/Sao_Paulo'", window_start: "TEXT NOT NULL DEFAULT '00:00'", window_end: "TEXT NOT NULL DEFAULT '00:00'", days: "TEXT NOT NULL DEFAULT '[1,2,3,4,5,6,7]'", interval_ms: 'INTEGER NOT NULL DEFAULT 8000', jitter_ms: 'INTEGER NOT NULL DEFAULT 17000', per_minute: 'INTEGER NOT NULL DEFAULT 5', daily_cap: 'INTEGER NOT NULL DEFAULT 100', paused_reason: 'TEXT', failures: 'INTEGER NOT NULL DEFAULT 0' },
    wa_broadcast_items: { name: "TEXT NOT NULL DEFAULT ''", vars: "TEXT NOT NULL DEFAULT '{}'", skip_reason: 'TEXT', attempts: 'INTEGER NOT NULL DEFAULT 0', updated: 'INTEGER NOT NULL DEFAULT 0', send_id: 'TEXT', resolution: 'TEXT', resolved_by: 'TEXT' },
  };
  for (const [table, fields] of Object.entries(columns)) {
    const existing = new Set((await db.execute(`PRAGMA table_info(${table})`)).rows.map(row => row.name));
    for (const [name, type] of Object.entries(fields)) if (!existing.has(name)) await db.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS wa_broadcast_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,campaign TEXT,item TEXT,action TEXT NOT NULL,actor TEXT NOT NULL,detail TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wa_broadcast_operations(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wa_broadcast_usage(account TEXT NOT NULL,day TEXT NOT NULL,count INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account,day));
    CREATE TABLE IF NOT EXISTS wa_broadcast_accounts(account TEXT PRIMARY KEY,next_at INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS wa_broadcast_attempts(id TEXT PRIMARY KEY,account TEXT NOT NULL,item TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS wa_broadcast_attempts_account_created ON wa_broadcast_attempts(account,created);
    UPDATE wa_broadcasts SET state='paused',paused_reason='Disparo anterior à confirmação de consentimento. Duplique e revise a lista.' WHERE state='queued' AND consent_at IS NULL;
  `);
}
