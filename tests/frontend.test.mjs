import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

// Execute the actual shipped frontend. Stub only browser/AudioContext boundaries.
const code=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
function fixture(){
  const sources=[],contexts=[],requests=[],intervals=[];
  const element=()=>({innerHTML:'',textContent:'',hidden:false,open:false,classList:{add(){},remove(){}},setAttribute(){},addEventListener(){},append(){},remove(){},querySelector:()=>element(),showModal(){this.open=true;},close(){this.open=false;}});
  const nodes=new Map(['#app','#modal','#toast','#live-banner'].map(id=>[id,element()]));
  class AudioContext{
    constructor(){this.sampleRate=8000;this.state='suspended';this.destination={};this.resumeCalls=0;contexts.push(this);}
    async resume(){this.resumeCalls++;this.state='running';}
    createBuffer(channels,length,sampleRate){const data=new Float32Array(length);return {length,sampleRate,getChannelData:()=>data};}
    createBufferSource(){const source={loop:false,starts:0,stops:0,connect(){},disconnect(){this.disconnected=true;},start(...args){this.starts++;this.startArgs=args;},stop(){this.stops++;}};sources.push(source);return source;}
  }
  const context=createContext({console,Float32Array,AudioContext,AbortSignal,FormData,
    window:{AudioContext,addEventListener(){},scrollTo(){}},localStorage:{getItem:()=>null},
    document:{hidden:false,querySelector:s=>nodes.get(s)||null,querySelectorAll:()=>[],createElement:element,body:{append(){}},addEventListener(){}},
    setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length;},setTimeout:()=>0,clearTimeout(){},
    fetch:(...args)=>{requests.push(args);return new Promise(()=>{});},
  });
  runInContext(code,context);
  const run=js=>runInContext(js,context);
  run(`ready=true;state={...initial,revision:1,device:{serial:'SM-001',mode:'wokwi',online:true,batteryPercent:80},events:[]};`);
  const danger=id=>run(`state.events=[{id:${JSON.stringify(id)},pool:'Pool',time:new Date().toISOString(),source:'wokwi',acknowledged:false}];updateLiveBanner();`);
  return {run,danger,sources,contexts,requests,intervals,nodes};
}

test('danger is silent before opt-in; enable gesture unlocks one continuously repeating three-pulse alarm',async()=>{
  const f=fixture();f.danger('danger-1');assert.equal(f.sources.length,0);
  await f.run('enableSound()');assert.equal(f.contexts.length,1);assert.equal(f.contexts[0].state,'running');
  const source=f.sources[0];assert.equal(source.loop,true);assert.equal(source.starts,1);assert.equal(source.stops,0);
  const buffer=source.buffer,data=buffer.getChannelData(0);assert.equal(buffer.length/buffer.sampleRate,3);
  for(let beat=0;beat<3;beat++){
    const loud=data.slice((beat+.05)*buffer.sampleRate,(beat+.5)*buffer.sampleRate);
    const quiet=data.slice((beat+.7)*buffer.sampleRate,(beat+.95)*buffer.sampleRate);
    assert.ok(loud.some(n=>Math.abs(n)>.2));assert.ok(quiet.every(n=>n===0));
  }
  // Many polling/render cycles must not add a loop or schedule its automatic end.
  for(let i=0;i<100;i++)f.run('updateLiveBanner()');
  await f.run('enableSound()');assert.equal(f.sources.length,1);assert.equal(source.stops,0);
  assert.deepEqual(source.startArgs,[]);assert.equal(f.intervals.length,1);assert.equal(f.intervals[0].ms,5000);
});
test('opening details silences audio without acknowledging or mutating the danger, even after polling',async()=>{
  const f=fixture();await f.run('enableSound()');f.danger('danger-1');const requestCount=f.requests.length;
  f.run("detail('danger-1')");assert.equal(f.sources[0].stops,1);assert.equal(f.nodes.get('#modal').open,true);
  assert.equal(f.run('currentAlert().acknowledged'),false);assert.equal(f.requests.length,requestCount);
  assert.match(f.nodes.get('#live-banner').innerHTML,/تنبيه: دخول جسم/);
  f.run('modal.close()');f.danger('danger-1');assert.equal(f.sources.length,1);
  f.danger('danger-2');assert.equal(f.sources.length,2);assert.equal(f.sources[1].loop,true);assert.equal(f.sources[1].stops,0);
});
test('server acknowledgement, sound preference and page exit stop the existing source',async()=>{
  const f=fixture();await f.run('enableSound()');f.danger('a');
  f.run('state.settings.sound=false;updateLiveBanner()');assert.equal(f.sources[0].stops,1);
  f.run('state.settings.sound=true;updateLiveBanner()');assert.equal(f.sources.length,2);
  f.run('state.events[0].acknowledged=true;updateLiveBanner()');assert.equal(f.sources[1].stops,1);
  f.danger('b');f.run('stopDangerAlarm()');assert.equal(f.sources[2].stops,1);
});
test('overlapping enable clicks cannot create competing alarm sources',async()=>{
  const f=fixture();f.danger('a');await Promise.all([f.run('enableSound()'),f.run('enableSound()')]);
  assert.equal(f.contexts.length,1);assert.equal(f.sources.length,1);
});
test('blocked autoplay does not claim success and can be retried on the next gesture',async()=>{
  const f=fixture();f.run("window.AudioContext.prototype.resume=async function(){throw new Error('blocked');}");f.danger('a');
  await f.run('enableSound()');assert.equal(f.run('soundEnabled'),false);assert.equal(f.sources.length,0);
  f.run("window.AudioContext.prototype.resume=async function(){this.state='running';}");await f.run('enableSound()');
  assert.equal(f.sources.length,1);
});
test('the existing polling path starts a new IoT danger alarm and keeps an open form intact',async()=>{
  const f=fixture();await f.run('enableSound()');
  f.run(`page='settings';app.innerHTML='unsaved form';fetch=async()=>({ok:true,status:200,json:async()=>({...state,revision:2,events:[{id:'iot',source:'wokwi',acknowledged:false}]})});`);
  await f.run('poll()');assert.equal(f.sources.length,1);assert.equal(f.nodes.get('#app').innerHTML,'unsaved form');
  f.run("detail('iot')");await f.run('poll()');assert.equal(f.sources.length,1);assert.equal(f.sources[0].stops,1);
});
test('phone number and call icon both use native tel links without changing stored contacts',()=>{
  const f=fixture();f.run(`state.contacts=[{id:'test-contact',name:'اسم <اختبار>',phone:'+966501234567'}];`);
  const before=f.run('JSON.stringify(state.contacts)'),html=f.run('settings()');
  assert.equal((html.match(/href="tel:\+966501234567"/g)||[]).length,2);
  assert.match(html,/class="contact-phone"/);assert.match(html,/class="text-button contact-call"/);
  assert.match(html,/اسم &lt;اختبار&gt;/);assert.equal(f.run('JSON.stringify(state.contacts)'),before);
});

test('fresh unpaired workspace loads straight into the dashboard with no password form',async()=>{
  const f=fixture();f.run(`fetch=async()=>({ok:true,status:200,json:async()=>({...state,paired:false})});`);
  await f.run('load()');assert.equal(f.run('page'),'home');
  assert.match(f.nodes.get('#app').innerHTML,/dashboard-grid/);
  assert.doesNotMatch(f.nodes.get('#app').innerHTML,/login-form|type="password"|data-action="logout"/);
});
