import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// One interface, persistent local SQLite in development or remote libSQL in production.
// No embedded replica/cache file is ever created for the hosted database.
export async function connectDatabase({ filename, url, authToken, client: suppliedClient } = {}) {
  if (!url && !suppliedClient) {
    if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true });
    const native = new DatabaseSync(filename, { timeout: 5000 });
    native.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    return { native, kind: 'sqlite', prepare: sql => native.prepare(sql), batch: statements => statements.map(s => native.prepare(s.sql).run(...s.args)), exec: sql => native.exec(sql), close: () => native.close() };
  }
  const { createClient } = await import('@libsql/client/web');
  const client = suppliedClient || createClient({ url, authToken });
  let tx;
  const execute = (sql, args = []) => (tx || client).execute({ sql, args });
  return {
    kind: 'turso',
    batch: statements => (tx || client).batch(statements),
    prepare(sql) {
      return {
        async get(...args) { return (await execute(sql, args)).rows[0]; },
        async all(...args) { return (await execute(sql, args)).rows.map(r => ({ ...r })); },
        async run(...args) { const result = await execute(sql, args); return { changes: result.rowsAffected }; },
      };
    },
    async exec(sql) {
      if (sql === 'BEGIN IMMEDIATE' || sql === 'BEGIN') { tx = await client.transaction(sql === 'BEGIN' ? 'read' : 'write'); return; }
      if (sql === 'COMMIT' || sql === 'ROLLBACK') {
        if (!tx) return;
        try { if (sql === 'COMMIT') await tx.commit(); else await tx.rollback(); }
        finally { tx.close(); tx = undefined; }
        return;
      }
      await (tx || client).executeMultiple(sql);
    },
    close() { if (tx) tx.close(); client.close(); },
  };
}
