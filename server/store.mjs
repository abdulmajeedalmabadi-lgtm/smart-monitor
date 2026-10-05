import { connectDatabase } from './database.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationDir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const WORKSPACE = 'local-development';
const POOL = 'local-pool';
const DEVICE = 'local-device';
const now = () => new Date().toISOString();
export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function fail(message, status = 400) { throw new AppError(status, message); }
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`أدخل ${label} صحيحًا`);
  return value.trim();
}
export function normalizePhone(value) {
  if (typeof value !== 'string' || value.length > 30) fail('أدخل رقم جوال صحيحًا');
  const ascii = value.replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776));
  if (!/^[+\d\s()-]+$/.test(ascii)) fail('أدخل رقم جوال صحيحًا');
  let phone = ascii.replace(/[\s()-]/g, '');
  if (/^05\d{8}$/.test(phone)) phone = '+966' + phone.slice(1);
  else if (/^00966\d{9}$/.test(phone)) phone = '+' + phone.slice(2);
  else if (/^966\d{9}$/.test(phone)) phone = '+' + phone;
  if (!/^\+?[0-9]{8,15}$/.test(phone)) fail('رقم الجوال يجب أن يحتوي على 8 إلى 15 رقمًا');
  return phone;
}
function bool(value) { if (typeof value !== 'boolean') fail('قيمة الإعداد غير صحيحة'); return Number(value); }
function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('بيانات الطلب غير صحيحة'); }
function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('تاريخ الحدث غير صحيح');
  return new Date(value).toISOString();
}

export async function openStore(filename, remote = {}) {
  const db = await connectDatabase({ filename, ...remote });
  let queue = Promise.resolve();
  function locked(action) { const result = queue.then(action); queue = result.catch(() => {}); return result; }
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT');
  for (const name of readdirSync(migrationDir).filter(f => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(resolve(migrationDir, name), 'utf8');
    const hash = createHash('sha256').update(sql).digest('hex');
    const existing = await db.prepare('SELECT checksum FROM schema_migrations WHERE name = ?').get(name);
    if (existing) {
      if (existing.checksum !== hash) throw new Error(`Applied migration changed: ${name}`);
      continue;
    }
    await db.exec('BEGIN IMMEDIATE');
    try { await db.exec(sql); await db.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(name, hash, now()); await db.exec('COMMIT'); }
    catch (e) { await db.exec('ROLLBACK'); db.close(); throw e; }
  }
  // Development workspace is seeded once, outside the schema migrations.
  await db.exec('BEGIN IMMEDIATE');
  try {
    const time = now();
    await db.prepare('INSERT OR IGNORE INTO workspaces(id,name,created_at) VALUES (?,?,?)').run(WORKSPACE, 'مساحة التطوير المحلية', time);
    await db.prepare('INSERT OR IGNORE INTO pools VALUES (?,?,?,?,?)').run(POOL, WORKSPACE, 'المسبح الرئيسي', time, time);
    await db.prepare('INSERT OR IGNORE INTO devices(id,pool_id,serial,updated_at) VALUES (?,?,?,?)').run(DEVICE, POOL, 'SM-001', time);
    await db.prepare('INSERT OR IGNORE INTO notification_settings(workspace_id,updated_at) VALUES (?,?)').run(WORKSPACE, time);
    await db.exec('COMMIT');
  } catch (e) { await db.exec('ROLLBACK'); db.close(); throw e; }

  async function getState() {
    const ws = await db.prepare('SELECT * FROM workspaces WHERE id = ?').get(WORKSPACE);
    const pool = await db.prepare('SELECT * FROM pools WHERE id = ? AND workspace_id = ?').get(POOL, WORKSPACE);
    const device = await db.prepare('SELECT * FROM devices WHERE pool_id = ?').get(pool.id);
    const settings = await db.prepare('SELECT * FROM notification_settings WHERE workspace_id = ?').get(WORKSPACE);
    const latest = await db.prepare('SELECT * FROM telemetry WHERE device_id=? ORDER BY observed_at DESC,received_at DESC,rowid DESC LIMIT 1').get(DEVICE);
    return {
      revision: ws.revision, legacyImported: Boolean(ws.legacy_imported), storage: db.kind,
      paired: Boolean(device.paired), enabled: Boolean(device.enabled), pool: pool.name,
      device: { id: device.id, serial: device.serial, mode: device.input_source, lastSeen: latest?.received_at || null, online: Boolean(latest && Date.now()-Date.parse(latest.received_at)<90000), batteryPercent: latest?.battery_percent ?? null, waterDetected: latest ? Boolean(latest.water_detected) : null, rssi: latest?.rssi ?? null },
      settings: { phone: Boolean(settings.phone), sound: Boolean(settings.sound), escalate: Boolean(settings.escalate) },
      contacts: await db.prepare('SELECT id,name,phone FROM contacts WHERE workspace_id = ? ORDER BY created_at,id').all(WORKSPACE),
      events: (await db.prepare('SELECT * FROM alerts WHERE device_id = ? ORDER BY occurred_at DESC,id DESC').all(device.id)).map(e => ({
        id: e.id, pool: e.pool_name, time: e.occurred_at, source: e.source,
        acknowledged: Boolean(e.acknowledged_at), acknowledgedAt: e.acknowledged_at,
      })),
    };
  }

  async function mutate(method, path, body, revision) {
    object(body);
    if (!Number.isSafeInteger(revision) || revision < 0) fail('حدّث الصفحة قبل حفظ التغييرات', 428);
    await db.exec('BEGIN IMMEDIATE');
    try {
      const before = await getState();
      if (revision !== before.revision) fail('تغيّرت البيانات في نافذة أخرى. تم تحديثها؛ أعد المحاولة.', 409);
      const time = now();
      let entity = DEVICE;
      let action;
      if (method === 'POST' && path === '/api/pair') {
        await db.prepare('UPDATE devices SET paired=1,paired_at=COALESCE(paired_at,?),updated_at=? WHERE id=?').run(time, time, DEVICE);
        action = 'device.paired';
      } else if (method === 'PATCH' && path === '/api/pool') {
        await db.prepare('UPDATE pools SET name=?,updated_at=? WHERE id=?').run(text(body.name, 50, 'اسم مسبح'), time, POOL);
        entity = POOL; action = 'pool.renamed';
      } else if (method === 'PATCH' && path === '/api/monitoring') {
        const enabled = bool(body.enabled);
        if (!before.paired) fail('اربط الجهاز أولًا', 409);
        if (!enabled && before.events.some(e => !e.acknowledged)) fail('تحقق من التنبيه النشط قبل إيقاف المراقبة', 409);
        await db.prepare('UPDATE devices SET enabled=?,updated_at=? WHERE id=?').run(enabled, time, DEVICE);
        action = enabled ? 'monitoring.enabled' : 'monitoring.disabled';
      } else if (method === 'PATCH' && path === '/api/settings') {
        const keys = Object.keys(body);
        if (!keys.length || keys.some(k => !['phone', 'sound', 'escalate'].includes(k))) fail('إعداد غير معروف');
        const updated = { ...before.settings, ...body };
        await db.prepare('UPDATE notification_settings SET phone=?,sound=?,escalate=?,updated_at=? WHERE workspace_id=?')
          .run(bool(updated.phone), bool(updated.sound), bool(updated.escalate), time, WORKSPACE);
        entity = WORKSPACE; action = 'settings.updated';
      } else if (method === 'POST' && path === '/api/events/simulate') {
        if (!before.paired || !before.enabled) fail('شغّل المراقبة واربط الجهاز أولًا', 409);
        if (before.events.some(e => !e.acknowledged)) fail('يوجد تنبيه نشط؛ تحقق منه أولًا', 409);
        entity = randomUUID();
        await db.prepare('INSERT INTO alerts(id,device_id,pool_name,source,occurred_at) VALUES (?,?,?,?,?)').run(entity, DEVICE, before.pool, 'simulation', time);
        action = 'alert.simulated';
      } else if (method === 'POST' && /^\/api\/events\/[^/]+\/ack$/.test(path)) {
        entity = path.split('/')[3];
        const alert = await db.prepare('SELECT * FROM alerts WHERE id=? AND device_id=?').get(entity, DEVICE);
        if (!alert) fail('التنبيه غير موجود', 404);
        await db.prepare('UPDATE alerts SET acknowledged_at=COALESCE(acknowledged_at,?) WHERE id=? AND device_id=?').run(time < alert.occurred_at ? alert.occurred_at : time, entity, DEVICE);
        action = 'alert.acknowledged';
      } else if (method === 'POST' && path === '/api/contacts') {
        if (before.contacts.length >= 100) fail('الحد الأقصى 100 جهة اتصال');
        const name = text(body.name, 60, 'اسم');
        const phone = normalizePhone(body.phone);
        if (before.contacts.some(c => c.phone === phone)) fail('رقم الجوال موجود بالفعل', 409);
        entity = randomUUID();
        await db.prepare('INSERT INTO contacts VALUES (?,?,?,?,?)').run(entity, WORKSPACE, name, phone, time);
        action = 'contact.created';
      } else if (method === 'DELETE' && /^\/api\/contacts\/[^/]+$/.test(path)) {
        entity = path.split('/')[3];
        const result = await db.prepare('DELETE FROM contacts WHERE id=? AND workspace_id=?').run(entity, WORKSPACE);
        if (!result.changes) fail('جهة الاتصال غير موجودة', 404);
        action = 'contact.deleted';
      } else if (method === 'POST' && path === '/api/import') {
        if (before.revision !== 0 || before.legacyImported) fail('يمكن نقل بيانات المتصفح إلى قاعدة جديدة فقط؛ بيانات المتصفح لم تُحذف.', 409);
        if (!Array.isArray(body.contacts) || body.contacts.length > 100 || !Array.isArray(body.events) || body.events.length > 1000) fail('حجم البيانات القديمة غير مدعوم');
        object(body.settings);
        await db.prepare('UPDATE pools SET name=?,updated_at=? WHERE id=?').run(text(body.pool, 50, 'اسم مسبح'), time, POOL);
        const paired = bool(body.paired), enabled = bool(body.enabled);
        if ((!paired || !enabled) && body.events.some(e => !e.acknowledged)) fail('حالة التنبيهات القديمة لا تتوافق مع حالة الجهاز');
        await db.prepare('UPDATE devices SET paired=?,enabled=?,paired_at=?,updated_at=? WHERE id=?').run(paired, enabled, paired ? time : null, time, DEVICE);
        await db.prepare('UPDATE notification_settings SET phone=?,sound=?,escalate=?,updated_at=? WHERE workspace_id=?')
          .run(bool(body.settings.phone), bool(body.settings.sound), bool(body.settings.escalate), time, WORKSPACE);
        const phones = new Set();
        const importedRows = [];
        for (const contact of body.contacts) {
          object(contact);
          const name = text(contact.name, 60, 'اسم'), phone = normalizePhone(contact.phone);
          if (phones.has(phone)) fail('أرقام مكررة في البيانات القديمة');
          phones.add(phone);
          importedRows.push({sql:'INSERT INTO contacts VALUES (?,?,?,?,?)',args:[randomUUID(), WORKSPACE, name, phone, time]});
        }
        let active = 0;
        for (const alert of body.events) {
          object(alert); const acknowledged = bool(alert.acknowledged);
          if (!acknowledged && ++active > 1) fail('تحتوي البيانات القديمة على أكثر من تنبيه نشط');
          const occurredAt = timestamp(alert.time);
          if (occurredAt > time) fail('يوجد حدث قديم بتاريخ مستقبلي');
          const ackAt = acknowledged ? timestamp(alert.acknowledgedAt || alert.time) : null;
          if (ackAt && ackAt < occurredAt) fail('وقت التحقق أسبق من الحدث');
          importedRows.push({sql:'INSERT INTO alerts VALUES (?,?,?,?,?,?)',args:[randomUUID(), DEVICE, text(alert.pool, 50, 'اسم مسبح'), 'legacy_import', occurredAt, ackAt]});
        }
        if(importedRows.length) await db.batch(importedRows);
        await db.prepare('UPDATE workspaces SET legacy_imported=1 WHERE id=?').run(WORKSPACE);
        entity = WORKSPACE; action = 'legacy.imported';
      } else fail('المسار غير موجود', 404);
      await db.prepare('UPDATE workspaces SET revision=revision+1 WHERE id=?').run(WORKSPACE);
      await db.prepare('INSERT INTO audit_log(workspace_id,action,entity_id,created_at) VALUES (?,?,?,?)').run(WORKSPACE, action, entity, time);
      const result = await getState();
      await db.exec('COMMIT');
      return result;
    } catch (error) { await db.exec('ROLLBACK'); throw error; }
  }
  async function ingestTelemetry(body) {
    object(body);
    const serial = text(body.deviceId, 64, 'معرّف الجهاز');
    const sampleId = text(body.sampleId, 100, 'معرّف العينة');
    if (!/^[A-Za-z0-9_-]+$/.test(sampleId)) fail('معرّف العينة غير صحيح');
    if (!['wokwi','esp32'].includes(body.source)) fail('مصدر القياس غير صحيح');
    const water = bool(body.waterDetected);
    if (typeof body.batteryPercent !== 'number' || !Number.isFinite(body.batteryPercent) || body.batteryPercent < 0 || body.batteryPercent > 100) fail('نسبة البطارية غير صحيحة');
    if (!Number.isInteger(body.rssi) || body.rssi < -120 || body.rssi > 0) fail('إشارة Wi-Fi غير صحيحة');
    const observed = timestamp(body.timestamp);
    if (Date.parse(observed) > Date.now()+300000 || Date.parse(observed) < Date.now()-86400000) fail('اضبط توقيت الجهاز: العينة خارج الفترة المسموحة');
    const fingerprint = createHash('sha256').update(JSON.stringify([serial,sampleId,body.source,water,body.batteryPercent,body.rssi,observed])).digest('hex');
    await db.exec('BEGIN IMMEDIATE');
    try {
      const device = await db.prepare('SELECT * FROM devices WHERE serial=?').get(serial);
      if (!device) fail('الجهاز غير مسجل', 404);
      const duplicate = await db.prepare('SELECT payload_hash FROM telemetry WHERE sample_id=?').get(sampleId);
      if (duplicate) {
        if (duplicate.payload_hash !== fingerprint) fail('أُعيد استخدام معرّف العينة لبيانات مختلفة',409);
        await db.exec('COMMIT');
        return { accepted:true, duplicate:true, sampleId, monitoringEnabled:Boolean(device.enabled) };
      }
      const latest = await db.prepare('SELECT observed_at FROM telemetry WHERE device_id=? ORDER BY observed_at DESC LIMIT 1').get(device.id);
      const received = now();
      await db.prepare('INSERT INTO telemetry VALUES (?,?,?,?,?,?,?,?,?)').run(sampleId,device.id,body.source,water,body.batteryPercent,body.rssi,observed,received,fingerprint);
      const stale = Boolean(latest && observed < latest.observed_at);
      let alertId = null;
      if (!stale) {
        await db.prepare('UPDATE devices SET input_source=?,paired=1,paired_at=COALESCE(paired_at,?),updated_at=? WHERE id=?').run(body.source,received,received,device.id);
        if (!water) await db.prepare('UPDATE devices SET alarm_armed=1 WHERE id=?').run(device.id);
        const active = await db.prepare('SELECT id FROM alerts WHERE device_id=? AND acknowledged_at IS NULL').get(device.id);
        if(water && device.enabled && active) await db.prepare('UPDATE devices SET alarm_armed=0 WHERE id=?').run(device.id);
        if (water && device.enabled && device.alarm_armed && !active) {
          const pool = await db.prepare('SELECT name FROM pools WHERE id=?').get(device.pool_id);
          alertId = randomUUID();
          await db.prepare('INSERT INTO alerts(id,device_id,pool_name,source,occurred_at) VALUES (?,?,?,?,?)').run(alertId,device.id,pool.name,body.source,received);
          await db.prepare('UPDATE devices SET alarm_armed=0 WHERE id=?').run(device.id);
          await db.prepare('INSERT INTO audit_log(workspace_id,action,entity_id,created_at) VALUES (?,?,?,?)').run(WORKSPACE,'alert.telemetry',alertId,received);
        }
      }
      // Retain 7 days of telemetry. Alert history is retained independently.
      await db.prepare('DELETE FROM telemetry WHERE received_at < ?').run(new Date(Date.now()-7*86400000).toISOString());
      await db.prepare('UPDATE workspaces SET revision=revision+1 WHERE id=?').run(WORKSPACE);
      await db.exec('COMMIT');
      return { accepted:true, duplicate:false, stale, sampleId, alertId, monitoringEnabled:Boolean(device.enabled) };
    } catch(error) { await db.exec('ROLLBACK'); throw error; }
  }
  return {
    db: db.native || db,
    kind: db.kind,
    getState: () => locked(async () => { await db.exec('BEGIN'); try { const result=await getState(); await db.exec('COMMIT'); return result; } catch(e) { await db.exec('ROLLBACK'); throw e; } }),
    mutate: (...args) => locked(() => mutate(...args)),
    ingestTelemetry: body => locked(() => ingestTelemetry(body)),
    health: () => locked(async () => { await db.prepare('SELECT 1 AS ok').get(); return true; }),
    close: () => db.close(),
  };
}
