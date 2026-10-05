import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.env.SMART_MONITOR_DB || resolve(root, 'data/monitor.sqlite');
if (!existsSync(source)) throw new Error('Start the server once before creating a backup.');
mkdirSync(resolve(root, 'backups'), { recursive: true });
const filename = resolve(root, 'backups', `monitor-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
const db = new DatabaseSync(source, { readOnly: true });
try { await backup(db, filename); console.log(`Backup saved: ${filename}`); } finally { db.close(); }
