import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { createApp } from '../server/index.mjs';
import { readConfig } from '../server/config.mjs';
import { request } from 'node:http';

test('upgrade from original 001 database retains existing names, contacts, alerts and revision',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'monitor-upgrade-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const filename=join(dir,'old.sqlite');const db=new DatabaseSync(filename);
  const sql=readFileSync(new URL('../db/migrations/001_initial.sql',import.meta.url),'utf8');
  db.exec(sql);db.exec('CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT');
  const time='2026-01-01T00:00:00.000Z';db.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run('001_initial.sql',createHash('sha256').update(sql).digest('hex'),time);
  db.prepare('INSERT INTO workspaces(id,name,revision,created_at) VALUES(?,?,?,?)').run('local-development','Original',9,time);
  db.prepare('INSERT INTO pools VALUES(?,?,?,?,?)').run('local-pool','local-development','Existing pool',time,time);
  db.prepare('INSERT INTO devices(id,pool_id,serial,paired,updated_at) VALUES(?,?,?,?,?)').run('local-device','local-pool','SM-001',1,time);
  db.prepare('INSERT INTO notification_settings(workspace_id,updated_at) VALUES(?,?)').run('local-development',time);
  db.prepare('INSERT INTO contacts VALUES(?,?,?,?,?)').run('old-contact','local-development','Existing contact','+966500000000',time);
  db.prepare('INSERT INTO alerts VALUES(?,?,?,?,?,?)').run('old-alert','local-device','Historical pool','simulation',time,time);
  db.close();const store=await openStore(filename);
  try{
    const s=await store.getState();assert.equal(s.revision,9);assert.equal(s.pool,'Existing pool');assert.equal(s.contacts[0].id,'old-contact');
    assert.equal(s.events[0].pool,'Historical pool');assert.equal(s.events[0].acknowledged,true);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n,2);
    assert.equal(store.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  }finally{store.close();}
});
test('configured production domain works behind proxy and sends HSTS',async t=>{
  const config={...readConfig({}),production:true,publicOrigin:'https://smart-monitor.example'};
  const app=await createApp({config,databasePath:':memory:'});await app.listen(0);t.after(()=>app.close());
  const url=`http://127.0.0.1:${app.server.address().port}`;
  const home=await new Promise((resolve,reject)=>{const req=request(url,{headers:{Host:'smart-monitor.example'}},res=>{res.resume();res.on('end',()=>resolve(res));});req.on('error',reject);req.end();});assert.equal(home.statusCode,200);assert.match(home.headers['strict-transport-security'],/max-age/);
  assert.equal((await fetch(url)).status,403);
  assert.equal((await fetch(url+'/api/health')).status,200);
});
