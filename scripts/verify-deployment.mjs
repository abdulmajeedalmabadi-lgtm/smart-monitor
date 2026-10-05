import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const origin=process.env.PUBLIC_ORIGIN;
if(!origin||!origin.startsWith('https://')||!process.env.IOT_API_KEY)throw new Error('Set PUBLIC_ORIGIN and IOT_API_KEY in your private .env.');
if(!process.argv.includes('--write-test-alert'))throw new Error('This creates a TEST alert. Run npm run verify:deployment -- --write-test-alert');
const request=(path,options={})=>fetch(new URL(path,origin),{...options,signal:AbortSignal.timeout(120000),redirect:'error'});
const health=await request('/api/health');assert.equal(health.status,200);
assert.deepEqual(await health.json(),{status:'ok',storage:'turso',mode:'production'});
let state=await (await request('/api/state')).json();
assert.equal(state.enabled,true,'Enable monitoring first');assert.ok(!state.events.some(e=>!e.acknowledged),'Acknowledge existing alerts first');
let high;
for(const waterDetected of [false,true]){
  const body={deviceId:'SM-001',sampleId:randomUUID(),source:'wokwi',waterDetected,batteryPercent:84,rssi:-55,timestamp:new Date().toISOString()};
  const options={method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.IOT_API_KEY}`},body:JSON.stringify(body)};
  const res=await request('/api/iot/telemetry',options);assert.equal(res.status,201);const data=await res.json();
  if(waterDetected){assert.ok(data.alertId);high=data.alertId;const retry=await request('/api/iot/telemetry',options);assert.equal(retry.status,200);assert.equal((await retry.json()).duplicate,true);}
}
state=await (await request('/api/state')).json();
assert.ok(state.events.some(e=>e.id===high&&!e.acknowledged));assert.equal(state.device.batteryPercent,84);
console.log('PASS: public HTTPS health, Turso mode, public dashboard, telemetry persistence, duplicate protection and dashboard state. Open your phone to verify the live TEST alert; then acknowledge it.');
