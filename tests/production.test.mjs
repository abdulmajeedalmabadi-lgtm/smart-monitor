import test from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { createApp } from '../server/index.mjs';
import { openStore } from '../server/store.mjs';
import { readConfig } from '../server/config.mjs';
import { createAuth } from '../server/auth.mjs';

const credentials={APP_PASSWORD:'test-dashboard-password-123456',SESSION_SECRET:'test-session-secret-12345678901234567890',IOT_API_KEY:'test-device-only-key-12345678901234567890'};
const sample=(waterDetected=false,extra={})=>({deviceId:'SM-001',sampleId:randomUUID(),source:'wokwi',waterDetected,batteryPercent:82,rssi:-51,timestamp:new Date().toISOString(),...extra});
async function fixture(t){
  const config=readConfig(credentials),app=await createApp({config,databasePath:':memory:'}),url=await app.listen(0);
  t.after(()=>app.close());
  const req=(path,options={})=>fetch(url+path,options);
  const post=(path,body,headers={})=>req(path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  const telemetry=(body=sample(),key=credentials.IOT_API_KEY)=>post('/api/iot/telemetry',body,{Authorization:`Bearer ${key}`});
  const login=()=>post('/api/login',{password:credentials.APP_PASSWORD},{'X-Smart-Monitor':'1'});
  return {app,req,post,telemetry,login};
}
test('production refuses ephemeral SQLite, missing secrets and private/non-HTTPS origins',()=>{
  const env={NODE_ENV:'production',RENDER_EXTERNAL_URL:'https://smart-monitor.onrender.com',TURSO_DATABASE_URL:'libsql://test.turso.io',TURSO_AUTH_TOKEN:'test',...credentials};
  assert.equal(readConfig(env).host,'0.0.0.0');assert.equal(readConfig(env).publicOrigin,env.RENDER_EXTERNAL_URL);
  for(const key of ['TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','APP_PASSWORD','SESSION_SECRET','IOT_API_KEY','RENDER_EXTERNAL_URL'])assert.throws(()=>readConfig({...env,[key]:''}));
  for(const origin of ['http://example.com','https://localhost','https://192.168.8.56','https://127.0.0.1','https://172.20.0.2','https://example.com/path'])assert.throws(()=>readConfig({...env,PUBLIC_ORIGIN:origin}));
  assert.throws(()=>readConfig({...env,TURSO_DATABASE_URL:'file:data.sqlite'}));
  assert.throws(()=>readConfig({...env,APP_PASSWORD:credentials.IOT_API_KEY}));
});
test('login, cookie auth, logout, CSRF and separate device credentials',async t=>{
  const f=await fixture(t);
  assert.equal((await f.req('/api/state')).status,401);
  assert.equal((await f.req('/api/state',{headers:{Authorization:`Bearer ${credentials.IOT_API_KEY}`}})).status,401);
  assert.equal((await f.telemetry(sample(),credentials.APP_PASSWORD)).status,401);
  assert.equal((await f.post('/api/login',{password:credentials.APP_PASSWORD})).status,403);
  assert.equal((await f.post('/api/login',{password:'wrong'},{'X-Smart-Monitor':'1'})).status,401);
  const login=await f.login();assert.equal(login.status,200);
  const setCookie=login.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);
  const Cookie=setCookie.split(';')[0];const state=await f.req('/api/state',{headers:{Cookie}});assert.equal(state.status,200);
  assert.equal((await f.post('/api/pair',{}, {Cookie,Origin:'https://evil.example','X-Smart-Monitor':'1','If-Match':'0'})).status,403);
  const logout=await f.post('/api/logout',{}, {Cookie,'X-Smart-Monitor':'1'});assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await f.req('/api/state',{headers:{Cookie:Cookie+'tampered'}})).status,401);
  assert.equal((await f.req('/server/config.mjs')).status,404);
  assert.equal((await f.req('/.env')).status,404);
});
test('production secure cookie and password rotation invalidate old sessions',()=>{
  const config={...readConfig(credentials),production:true};const auth=createAuth(config);const cookie=auth.loginCookie();
  assert.match(cookie,/; Secure/);assert.ok(auth.authenticated({headers:{cookie}}));
  assert.equal(createAuth({...config,password:'another-password'}).authenticated({headers:{cookie}}),false);
});
test('telemetry creates a persisted alert without dashboard login and retries are idempotent',async t=>{
  const f=await fixture(t),body=sample(true);
  const results=await Promise.all([f.telemetry(body),f.telemetry(body)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);
  const state=await f.app.store.getState();assert.equal(state.events.length,1);assert.equal(state.events[0].source,'wokwi');
  assert.equal(state.device.online,true);assert.equal(state.device.batteryPercent,82);assert.equal(state.paired,true);
  assert.equal((await f.telemetry({...body,batteryPercent:12})).status,409);
  assert.equal((await f.app.store.getState()).revision,1);
});
test('telemetry validates key, device scope, ranges, clock and JSON',async t=>{
  const f=await fixture(t);
  assert.equal((await f.telemetry(sample(),'wrong')).status,401);
  assert.equal((await f.telemetry(sample(false,{deviceId:'SM-999'}))).status,403);
  for(const extra of [{batteryPercent:101},{rssi:1},{rssi:-30.1},{source:'browser'},{waterDetected:1},{sampleId:'bad id'},{timestamp:'invalid'},{timestamp:new Date(Date.now()+600000).toISOString()},{timestamp:new Date(Date.now()-2*86400000).toISOString()}])assert.equal((await f.telemetry(sample(false,extra))).status,400);
  assert.equal((await f.req('/api/iot/telemetry')).status,405);
  assert.equal((await f.app.store.getState()).revision,0);
});
test('alarm latches until dry reading, respects disabled mode and ignores out-of-order readings',async t=>{
  const f=await fixture(t);let s;
  await f.telemetry(sample(true));s=await f.app.store.getState();
  await f.app.store.mutate('POST',`/api/events/${s.events[0].id}/ack`,{},s.revision);
  await f.telemetry(sample(true));assert.equal((await f.app.store.getState()).events.length,1);
  const stale=await f.telemetry(sample(false,{timestamp:new Date(Date.now()-60000).toISOString()}));assert.equal((await stale.json()).stale,true);
  await f.telemetry(sample(true));assert.equal((await f.app.store.getState()).events.length,1);
  await f.telemetry(sample(false));s=await f.app.store.getState();
  await f.app.store.mutate('PATCH','/api/monitoring',{enabled:false},s.revision);
  await f.telemetry(sample(true));s=await f.app.store.getState();assert.equal(s.events.length,1);
  await f.app.store.mutate('PATCH','/api/monitoring',{enabled:true},s.revision);
  await f.telemetry(sample(true));assert.equal((await f.app.store.getState()).events.length,2);
});
test('database outage is reported by health, not masked as healthy',async t=>{
  const app=await createApp({store:{kind:'turso',health:async()=>{throw new Error('offline');},close(){}}});const url=await app.listen(0);t.after(()=>app.close());
  const r=await fetch(url+'/api/health');assert.equal(r.status,503);assert.equal((await r.json()).status,'unavailable');
});
test('local libSQL SDK exercises remote adapter transactions, rollback and restart persistence',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'smart-libsql-'));t.after(()=>rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:150}));
  const url=pathToFileURL(join(dir,'cloud-contract.sqlite')).href;
  // Isolate the native libSQL file client: Windows releases all its handles at process exit.
  const child=spawnSync(process.execPath,['--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import { createClient } from '@libsql/client';
    import { openStore } from './server/store.mjs';
    import { uploadTables,buildUploadPlan } from './scripts/upload-plan.mjs';
    const open=()=>openStore(':memory:',{client:createClient({url:process.argv[1]})});
    let store=await open();
    try{
      assert.equal(store.kind,'turso');await store.ingestTelemetry(JSON.parse(process.argv[2]));let s=await store.getState();
      assert.equal(s.events.length,1);await assert.rejects(store.mutate('PATCH','/api/pool',{name:'changed'},0),e=>e.status===409);
      assert.equal((await store.getState()).pool,s.pool);
      store.close();store=await open();s=await store.getState();assert.equal(s.events.length,1);assert.equal(s.device.batteryPercent,82);
      await store.mutate('POST','/api/events/'+s.events[0].id+'/ack',{},s.revision);
      assert.equal((await store.getState()).events[0].acknowledged,true);
      const source=await openStore(':memory:');
      await source.ingestTelemetry(JSON.parse(process.argv[2]));
      const rows=Object.fromEntries(uploadTables.map(table=>[table,source.db.prepare('SELECT * FROM '+table).all()]));
      source.close();
      const target=createClient({url:process.argv[1]+'.upload'});
      const initialized=await openStore(':memory:',{client:target});
      await target.batch(buildUploadPlan(rows),'write');
      assert.equal((await initialized.getState()).events.length,1);
      await assert.rejects(target.batch(buildUploadPlan(rows),'write'));
      assert.equal((await initialized.getState()).events.length,1);
      initialized.close();
    }finally{store.close();}
  `,url,JSON.stringify(sample(true))],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr||child.stdout);
});
