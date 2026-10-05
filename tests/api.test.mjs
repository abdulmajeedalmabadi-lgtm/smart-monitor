import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createApp } from '../server/index.mjs';

async function fixture(t, path = ':memory:') {
  const app = await createApp({ databasePath: path });
  const url = await app.listen(0);
  t.after(() => app.close());
  const state = () => fetch(url + '/api/state').then(r => r.json());
  const send = async (method, endpoint, body = {}, revision, extra = {}) => {
    const current = revision ?? (await state()).revision;
    const response = await fetch(url + endpoint, {
      method, headers: { 'Content-Type': 'application/json', 'X-Smart-Monitor': '1', 'If-Match': String(current), ...extra }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { app, url, state, send, pair: () => send('POST', '/api/pair') };
}
const legacy = () => ({ paired: true, enabled: true, pool: 'المسبح القديم', settings: { phone: false, sound: true, escalate: false }, contacts: [{ name: 'تجريبي', phone: '0501234567' }], events: [{ pool: 'المسبح القديم', time: '2025-01-01T10:00:00Z', acknowledged: true, acknowledgedAt: '2025-01-01T10:05:00Z' }] });

test('fresh database: schema, foreign keys and defaults', async t => {
  const f = await fixture(t); const s = await f.state();
  assert.equal(s.storage, 'sqlite'); assert.equal(s.paired, false); assert.equal(s.revision, 0);
  assert.deepEqual(s.events, []); assert.deepEqual(s.contacts, []);
  assert.equal(f.app.store.db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(f.app.store.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
});
test('pair, simulate, acknowledge and reopen history', async t => {
  const f = await fixture(t); assert.equal((await f.pair()).status, 200);
  let r = await f.send('POST', '/api/events/simulate'); assert.equal(r.status, 200); assert.equal(r.body.events[0].acknowledged, false);
  const id = r.body.events[0].id;
  r = await f.send('POST', `/api/events/${id}/ack`); assert.equal(r.status, 200); assert.equal(r.body.events[0].acknowledged, true);
  assert.ok(r.body.events[0].acknowledgedAt); assert.equal((await f.state()).events.length, 1);
});
test('unpaired or disabled devices cannot emit alerts', async t => {
  const f = await fixture(t); assert.equal((await f.send('POST', '/api/events/simulate')).status, 409);
  await f.pair(); await f.send('PATCH', '/api/monitoring', { enabled: false });
  assert.equal((await f.send('POST', '/api/events/simulate')).status, 409); assert.equal((await f.state()).events.length, 0);
});
test('cannot disable monitoring with an active alert', async t => {
  const f = await fixture(t); await f.pair(); await f.send('POST', '/api/events/simulate');
  assert.equal((await f.send('PATCH', '/api/monitoring', { enabled: false })).status, 409);
  assert.equal((await f.state()).enabled, true);
});
test('duplicate alert requests cannot create two active alerts', async t => {
  const f = await fixture(t); await f.pair(); const rev = (await f.state()).revision;
  const results = await Promise.all([f.send('POST', '/api/events/simulate', {}, rev), f.send('POST', '/api/events/simulate', {}, rev)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200,409]);
  assert.equal((await f.send('POST', '/api/events/simulate')).status, 409);
  assert.equal((await f.state()).events.length, 1);
});
test('acknowledging an alert twice preserves first acknowledgement time', async t => {
  const f = await fixture(t); await f.pair(); const r = await f.send('POST', '/api/events/simulate');
  const path = `/api/events/${r.body.events[0].id}/ack`;
  const first = await f.send('POST', path); const second = await f.send('POST', path);
  assert.equal(second.status, 200); assert.equal(first.body.events[0].acknowledgedAt, second.body.events[0].acknowledgedAt);
});
test('pool rename preserves historical pool name', async t => {
  const f = await fixture(t); await f.pair(); await f.send('POST', '/api/events/simulate');
  const r = await f.send('PATCH', '/api/pool', { name: 'مسبح العائلة' });
  assert.equal(r.body.pool, 'مسبح العائلة'); assert.equal(r.body.events[0].pool, 'المسبح الرئيسي');
});
test('empty and overlong pool names are rejected without mutation', async t => {
  const f = await fixture(t);
  for (const name of ['', '   ', 'a'.repeat(51), null]) assert.equal((await f.send('PATCH', '/api/pool', { name })).status, 400);
  assert.equal((await f.state()).revision, 0);
});
test('all notification preferences persist and reject non-booleans', async t => {
  const f = await fixture(t); const settings = { phone: false, sound: false, escalate: false };
  assert.deepEqual((await f.send('PATCH', '/api/settings', settings)).body.settings, settings);
  assert.equal((await f.send('PATCH', '/api/settings', { sound: 'false' })).status, 400);
  assert.equal((await f.send('PATCH', '/api/settings', { unknown: true })).status, 400);
  assert.deepEqual((await f.state()).settings, settings);
});
test('contact create, normalized Arabic phone, duplicate prevention and delete', async t => {
  const f = await fixture(t); let r = await f.send('POST', '/api/contacts', { name: 'اختبار', phone: '٠٥٠١٢٣٤٥٦٧' });
  assert.equal(r.status, 200); assert.equal(r.body.contacts[0].phone, '+966501234567');
  const id = r.body.contacts[0].id;
  assert.equal((await f.send('POST', '/api/contacts', { name: 'آخر', phone: '+966 50 123 4567' })).status, 409);
  r = await f.send('DELETE', `/api/contacts/${id}`); assert.equal(r.status, 200); assert.equal(r.body.contacts.length, 0);
});
test('phone cannot contain only punctuation, letters, misplaced plus or too few digits', async t => {
  const f = await fixture(t);
  for (const phone of ['--------', '(        )', 'abcdefgh', '123', '050+1234567', '1234567890123456', null]) {
    assert.equal((await f.send('POST', '/api/contacts', { name: 'اختبار', phone })).status, 400);
  }
  assert.equal((await f.state()).contacts.length, 0);
});
test('SQL-like input is stored literally and cannot modify schema', async t => {
  const f = await fixture(t); const name = "'); DROP TABLE contacts; --";
  const r = await f.send('POST', '/api/contacts', { name, phone: '0502223333' });
  assert.equal(r.status, 200); assert.equal(r.body.contacts[0].name, name);
  assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM contacts').get().n, 1);
});
test('stale tabs cannot overwrite newer data', async t => {
  const f = await fixture(t); const oldRevision = (await f.state()).revision;
  await f.send('PATCH', '/api/pool', { name: 'آخر تعديل' }, oldRevision);
  assert.equal((await f.send('PATCH', '/api/pool', { name: 'تعديل قديم' }, oldRevision)).status, 409);
  assert.equal((await f.state()).pool, 'آخر تعديل');
});
test('unknown contact, alert and API route return 404', async t => {
  const f = await fixture(t);
  assert.equal((await f.send('DELETE', '/api/contacts/missing')).status, 404);
  assert.equal((await f.send('POST', '/api/events/missing/ack')).status, 404);
  assert.equal((await f.send('POST', '/api/missing')).status, 404);
});
test('cross-origin and missing request headers are rejected', async t => {
  const f = await fixture(t);
  assert.equal((await f.send('POST', '/api/pair', {}, 0, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await f.send('POST', '/api/pair', {}, 0, { 'X-Smart-Monitor': '' })).status, 403);
  assert.equal((await f.send('POST', '/api/pair', {}, 0, { 'If-Match': '' })).status, 428);
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const req = request(f.url + '/api/state', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(hostileHostStatus, 403);
});
test('malformed JSON, wrong content type and huge requests rejected', async t => {
  const f = await fixture(t);
  const headers = { 'X-Smart-Monitor': '1', 'If-Match': '0', 'Content-Type': 'application/json' };
  assert.equal((await fetch(f.url + '/api/pair', { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await f.send('POST', '/api/pair', {}, 0, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await fetch(f.url + '/api/pair', { method: 'POST', headers, body: JSON.stringify({ data: 'x'.repeat(530000) }) })).status, 413);
});
test('private database and source files are not served', async t => {
  const f = await fixture(t);
  for (const path of ['/data/monitor.sqlite', '/server/store.mjs', '/.git/config', '/.openai/hosting.json', '/db/migrations/001_initial.sql']) {
    assert.equal((await fetch(f.url + path)).status, 404);
  }
  const response = await fetch(f.url); assert.equal(response.status, 200);
  assert.ok(response.headers.get('Content-Security-Policy').includes("script-src 'self'"));
});
test('legacy browser data imports once and keeps history', async t => {
  const f = await fixture(t); let r = await f.send('POST', '/api/import', legacy());
  assert.equal(r.status, 200); assert.equal(r.body.pool, 'المسبح القديم'); assert.equal(r.body.legacyImported, true);
  assert.equal(r.body.contacts.length, 1); assert.equal(r.body.events[0].source, 'legacy_import');
  r = await f.send('POST', '/api/import', legacy()); assert.equal(r.status, 409);
  assert.equal((await f.state()).events.length, 1);
});
test('failed import rolls back every partially written table', async t => {
  const f = await fixture(t); const data = legacy(); data.contacts.push({ name: 'غير صالح', phone: '--------' });
  assert.equal((await f.send('POST', '/api/import', data)).status, 400);
  const state = await f.state(); assert.equal(state.pool, 'المسبح الرئيسي'); assert.equal(state.paired, false);
  assert.equal(state.contacts.length, 0); assert.equal(state.revision, 0);
  assert.equal(f.app.store.db.prepare('SELECT count(*) AS n FROM audit_log').get().n, 0);
});
test('import cannot overwrite an already used database', async t => {
  const f = await fixture(t); await f.send('PATCH', '/api/pool', { name: 'بيانات محفوظة' });
  assert.equal((await f.send('POST', '/api/import', legacy())).status, 409);
  assert.equal((await f.state()).pool, 'بيانات محفوظة');
});
test('foreign-key and unique active alert constraints enforced by database', async t => {
  const f = await fixture(t); const db = f.app.store.db;
  assert.throws(() => db.prepare('INSERT INTO alerts VALUES (?,?,?,?,?,?)').run('a', 'bad-device', 'pool', 'simulation', new Date().toISOString(), null));
  await f.pair(); await f.send('POST', '/api/events/simulate');
  assert.throws(() => db.prepare('INSERT INTO alerts VALUES (?,?,?,?,?,?)').run('b', 'local-device', 'pool', 'simulation', new Date().toISOString(), null));
});
test('committed mutations create an audit trail without contact details', async t => {
  const f = await fixture(t); await f.pair(); await f.send('POST', '/api/contacts', { name: 'اسم خاص', phone: '0507654321' });
  const rows = f.app.store.db.prepare('SELECT * FROM audit_log ORDER BY id').all();
  assert.deepEqual(rows.map(r => r.action), ['device.paired', 'contact.created']);
  assert.ok(!JSON.stringify(rows).includes('اسم خاص')); assert.ok(!JSON.stringify(rows).includes('0507654321'));
});
test('all records survive server restart; migrations are idempotent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'smart-monitor-test-')); const dbPath = join(dir, 'test.sqlite');
  let app = await createApp({ databasePath: dbPath });
  try {
    let state = await app.store.getState();
    state = await app.store.mutate('POST', '/api/pair', {}, state.revision);
    state = await app.store.mutate('POST', '/api/contacts', { name: 'اختبار البقاء', phone: '0507654321' }, state.revision);
    state = await app.store.mutate('POST', '/api/events/simulate', {}, state.revision);
    app.store.close(); app = await createApp({ databasePath: dbPath });
    assert.deepEqual(await app.store.getState(), state);
    assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM schema_migrations').get().n, 2);
    assert.equal(app.store.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { app.store.close(); rmSync(dir, { recursive: true, force: true }); }
});
