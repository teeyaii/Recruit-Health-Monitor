// Issue #70: anonymous session reliability logger + technical readiness view.
// All devices here are MOCKED Web Bluetooth objects and all streams are
// SIMULATED. Nothing in this file is hardware evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../dashboard/gateway.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const packet=bytes=>new DataView(Uint8Array.from(bytes).buffer);
const drain=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};

class Element {
 constructor(){this.listeners={};this.value='';this.disabled=false;this.hidden=false;this.checked=false;this.children=[];this.textContent='';}
 addEventListener(n,f){this.listeners[n]=f;}
 removeEventListener(n,f){if(this.listeners[n]===f)delete this.listeners[n];}
 append(...c){this.children.push(...c);}
 replaceChildren(){this.children=[];}
 remove(){}
 click(){return this.listeners.click?.();}
}
function harness(slots,{gateway='G01',storage=new Map()}={}){
 const nodes=new Map(),intervals=[],timers=new Map();let timerId=0,clock=1793865600000;
 const document={hidden:false,listeners:{},getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement(){return new Element();},addEventListener(n,f){this.listeners[n]=f;}};
 const window={isSecureContext:true,listeners:{},addEventListener(n,f){this.listeners[n]=f;},
  localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)}};
 const calls=[],fetches=[];let selection=null,reply={ok:true,status:200,json:async()=>({accepted:1})};
 const bluetooth={requestDevice(o){calls.push(o);return typeof selection==='function'?selection():Promise.resolve(selection);}};
 class Clock extends Date{static now(){return clock;}}
 const context={document,window,navigator:{bluetooth},Date:Clock,Map,Set,AbortController,JSON,Math,Object,
  setInterval(f){intervals.push(f);},setTimeout(f,ms){timers.set(++timerId,{f,at:clock+ms});return timerId;},clearTimeout(id){timers.delete(id);},
  fetch:async(url,options)=>{fetches.push({url,options});
   if(url==='/api/gateway/provision')return {ok:true,json:async()=>({gateway,slots})};
   return typeof reply==='function'?reply():reply;}};
 vm.createContext(context);
 vm.runInContext(script+`\nthis.api={live,bindings,slotCategory,sessionCreate,sessionTick,sessionEvent,sessionStop,sessionSummary,sessionCsv,
  log:()=>sessionLog,readinessRows};`,context);
 const get=id=>document.getElementById(id);
 const tick=async(ms=1000)=>{clock+=ms;for(const [id,t] of timers)if(t.at<=clock){timers.delete(id);t.f();}intervals.forEach(f=>f());await drain();};
 return {context,document,get,calls,fetches,api:context.api,storage,tick,
  now:()=>clock,select(d){selection=d;},reply(r){reply=r;},
  async login(){get('gateway').value=gateway;get('token').value='test-only-credential-with-32-characters';await get('load').click();await drain();}};
}
function band(id,suffix){
 const d=new Element();d.id=id;d.name='Xiaomi Smart Band 10 '+suffix;
 const c=new Element();c.startNotifications=async()=>c;
 const service={getCharacteristic:async()=>c};
 d.gatt={connected:false,connect:async()=>{d.gatt.connected=true;return d.gatt;},getPrimaryService:async()=>service,disconnect(){d.gatt.connected=false;d.listeners.gattserverdisconnected?.();}};
 d.emit=(bpm=70)=>c.listeners.characteristicvaluechanged?.({target:{value:packet([6,bpm])}});
 return d;
}
const G01=['R01','R02','R03','R04','R05'].map((id,i)=>({id,device_id:'opaque-g01-'+(i+1)}));
const G02=['R06','R07','R08','R09','R10'].map((id,i)=>({id,device_id:'opaque-g02-'+(i+6)}));
const SUFFIX={R01:'47FD',R02:'A746',R03:'1121',R04:'CD42',R05:'5E05',R06:'6A06',R07:'7B07',R08:'8C08',R09:'9D09',R10:'AE10'};
async function pairAll(h,slots){
 const bands={};
 for(const {id} of slots){
  const d=band('sim-'+id,SUFFIX[id]);bands[id]=d;h.select(d);
  if(id==='R01'||id==='R02')await h.get('quick'+id).click();
  else{
   const known=h.get('extraBandControls').children.find(x=>x.textContent.includes(id));
   await known.click();
   if(h.get('slot').value===id&&h.get('expected').value===''){h.get('expected').value=SUFFIX[id];await h.get('connect').click();}
  }
  await drain();d.emit(70);await drain();
 }
 return bands;
}
async function startLog(h,label='SIMULATED'){
 h.get('sessionLabel').value=label;h.get('sessionLabel').listeners.change?.();
 if(label==='HARDWARE_OBSERVED'){h.get('sessionObservedConfirm').checked=true;h.get('sessionObservedConfirm').listeners.change?.();}
 await h.get('sessionStart').click();return h.api.log();
}
const stream=async(h,bands,seconds,except=[])=>{for(let i=0;i<seconds;i++){for(const [id,d] of Object.entries(bands))if(!except.includes(id))d.emit(70+i%5);await drain();await h.tick(1000);}};
const row=(sum,slot)=>sum.slots.find(r=>r.slot===slot);

// ---------------- pure core ----------------
test('slotCategory: fresh ACK only; old ACK, failed upload, stale BLE and no link are never LIVE_ACK',()=>{
 const {api}=harness(G01),now=1_000_000;
 const s=over=>({ready:true,closed:false,probe:null,bpm:70,lastAt:now-1000,ackAt:now-1000,ack:'Server acknowledged',error:'',...over});
 assert.equal(api.slotCategory(s({}),now),'LIVE_ACK');
 assert.equal(api.slotCategory(s({ackAt:now-16000}),now),'LIVE_NO_ACK','ACK older than 15 s is not fresh');
 assert.equal(api.slotCategory(s({error:'HTTP 503'}),now),'LIVE_NO_ACK','failed upload overrides an earlier ACK');
 assert.equal(api.slotCategory(s({ack:'กำลังส่ง HTTPS'}),now),'LIVE_NO_ACK');
 assert.equal(api.slotCategory(s({ackAt:now}),now),'LIVE_NO_ACK','ACK newer than the latest sample is inconsistent');
 assert.equal(api.slotCategory(s({lastAt:now-16000,bpm:70}),now),'BLE_NO_DATA');
 assert.equal(api.slotCategory(s({bpm:null}),now),'BLE_NO_DATA','contact-lost packet is no data');
 assert.equal(api.slotCategory(s({bpm:null,lifecycle:'ERROR',error:'HTTP 503',ack:'x'}),now),'LIVE_NO_ACK','server rejection is a missing ACK, not a BLE failure');
 assert.equal(api.slotCategory(s({bpm:null,lifecycle:'ERROR',error:'x',lastAt:now-16000}),now),'BLE_NO_DATA');
 assert.equal(api.slotCategory(s({closed:true}),now),'DISCONNECTED');
 assert.equal(api.slotCategory(s({probe:{phase:'baseline'}}),now),'DISCONNECTED','quarantined pairing is not data');
 assert.equal(api.slotCategory(undefined,now),'DISCONNECTED');
});
test('session requires an explicit label; gaps and hidden time are NOT_OBSERVED, never success or failure',()=>{
 const {api}=harness(G01);
 assert.throws(()=>api.sessionCreate('',"G01",['R01'],0));
 assert.throws(()=>api.sessionCreate('OBSERVED',"G01",['R01'],0));
 const log=api.sessionCreate('SIMULATED','G01',['R01','R02'],0);
 let t=0;const live={R01:'LIVE_ACK',R02:'DISCONNECTED'};
 for(let i=0;i<10;i++)api.sessionTick(log,t+=1000,live);
 api.sessionTick(log,t+=30000,live);                       // 30 s with no tick (page reload / suspended)
 for(let i=0;i<5;i++)api.sessionTick(log,t+=1000,live,{visible:false}); // hidden
 api.sessionStop(log,t+=400);
 const sum=api.sessionSummary(log);
 assert.equal(sum.elapsedSeconds,sum.observedSeconds+sum.notObservedSeconds);
 assert.equal(sum.observedSeconds,10);assert.equal(sum.notObservedSeconds,35.4); // whole 30 s gap + 5 hidden + 0.4 stop tail
 assert.equal(row(sum,'R01').coveragePct,100,'unobserved time does not dilute coverage');
 assert.equal(row(sum,'R01').drops,0,'a gap is not a drop');
 assert.equal(row(sum,'R02').coveragePct,0);
 const empty=api.sessionSummary(api.sessionCreate('SIMULATED','G01',['R03'],0));
 assert.equal(row(empty,'R03').coveragePct,null,'no observation is unknown, not 0% or 100%');
});
test('drops, recoveries, crossed gaps and unrecovered slots are counted from observed transitions',()=>{
 const {api}=harness(G01);
 const log=api.sessionCreate('SIMULATED','G01',['R01','R02'],0);let t=0;
 const at=(r1,r2)=>api.sessionTick(log,t+=1000,{R01:r1,R02:r2});
 for(let i=0;i<5;i++)at('LIVE_ACK','LIVE_ACK');
 for(let i=0;i<4;i++)at('DISCONNECTED','LIVE_NO_ACK');
 at('LIVE_ACK','BLE_NO_DATA');                   // R01 recovers after 4 s; R02 drops
 api.sessionTick(log,t+=20000,{R01:'LIVE_ACK',R02:'LIVE_ACK'}); // R02 recovers across a gap
 at('LIVE_ACK','DISCONNECTED');                  // R02 drops again, never recovers
 api.sessionStop(log,t+=1);
 const sum=api.sessionSummary(log);
 assert.deepEqual([row(sum,'R01').drops,row(sum,'R01').recoveries,row(sum,'R01').recoveryMaxSeconds],[1,1,4]);
 assert.equal(row(sum,'R01').recoveriesCrossingGap,0);assert.equal(row(sum,'R01').unrecoveredAtEnd,false);
 assert.deepEqual([row(sum,'R02').drops,row(sum,'R02').recoveries,row(sum,'R02').recoveriesCrossingGap],[2,1,1]);
 assert.equal(row(sum,'R02').unrecoveredAtEnd,true);
 assert.equal(row(sum,'R02').seconds.LIVE_NO_ACK,4,'server ACK failure time is separate from BLE failure time');
});
test('export JSON/CSV: label, PENDING hardware validation, definitions; no BPM, device, suffix, token or names',async()=>{
 const h=harness(G01);await h.login();const bands=await pairAll(h,G01);
 await startLog(h);await stream(h,bands,20);
 await h.get('sessionStop').click();
 await h.get('sessionExportJson').click();
 const text=h.get('sessionExportText').value,json=JSON.parse(text);
 assert.equal(json.label,'SIMULATED');assert.equal(json.hardwareSixtyMinuteValidation,'PENDING');
 assert.equal(json.schema,'steve.gateway.session-metrics.v1');
 for(const key of ['LIVE_ACK','LIVE_NO_ACK','BLE_NO_DATA','DISCONNECTED','NOT_OBSERVED','coveragePct'])assert.ok(json.definitions[key],key);
 assert.ok(json.observationBoundaries.some(b=>/NOT_OBSERVED/.test(b)));
 assert.deepEqual(json.slots.map(r=>r.slot),['R01','R02','R03','R04','R05']);
 const forbidden=[/opaque-g01/,/sim-R0/,/47FD|A746|1121|CD42|5E05/,/test-only-credential/,/"(?:bpm|hr|heartRate|device_id|name|token)"/i,/Xiaomi/];
 for(const re of forbidden)assert.doesNotMatch(text,re,'export leaks '+re);
 for(const v of [70,71,72,73,74])assert.ok(!new RegExp('"'+v+'"').test(text));
 await h.get('sessionExportCsv').click();
 const csv=h.get('sessionExportText').value;
 assert.match(csv,/^# steve\.gateway\.session-metrics\.v1\n# label=SIMULATED\n# hardwareSixtyMinuteValidation=PENDING/);
 assert.match(csv,/\nslot,observedSeconds,LIVE_ACK,LIVE_NO_ACK,BLE_NO_DATA,DISCONNECTED,coveragePct/);
 for(const key of ['LIVE_ACK','NOT_OBSERVED','coveragePct','drop','recovery','bleDisconnectEvents'])assert.match(csv,new RegExp('\n# definition '+key+': '),'CSV carries definition '+key);
 assert.match(csv,/\n# boundary: .*NOT_OBSERVED/);
 assert.equal(csv.split('\n').filter(l=>/^R0[1-5],/.test(l)).length,5);
 for(const re of forbidden)assert.doesNotMatch(csv,re);
 const stored=h.storage.get('steve.gateway.session-log.v1');
 for(const re of forbidden)assert.doesNotMatch(stored,re,'persisted log leaks '+re);
});

// ---------------- integrated, mocked BLE ----------------
test('SIMULATED G01 five watches: coverage measured; R03 drop + automatic reconnect recorded; peers unaffected',async()=>{
 const h=harness(G01);await h.login();const bands=await pairAll(h,G01);
 const choicesAfterPairing=h.calls.length;assert.equal(choicesAfterPairing,5,'first pairing: one chooser per watch');
 const log=await startLog(h);assert.equal(log.label,'SIMULATED');
 await stream(h,bands,70);                      // >60 s healthy so the next drop reconnects at once
 const before=Object.fromEntries(['R01','R02','R04','R05'].map(s=>[s,h.api.live.get(s)]));
 bands.R03.gatt.connected=false;bands.R03.listeners.gattserverdisconnected?.();await drain();
 await stream(h,bands,10);
 await h.get('sessionStop').click();
 const sum=h.api.sessionSummary(h.api.log());
 for(const slot of ['R01','R02','R04','R05']){
  assert.equal(h.api.live.get(slot),before[slot],slot+' session untouched');
  assert.equal(row(sum,slot).drops,0);assert.ok(row(sum,slot).coveragePct>=95,slot+' '+row(sum,slot).coveragePct);
 }
 assert.ok(row(sum,'R03').autoReconnectAttempts>=1,'automatic reconnect counted');
 assert.equal(row(sum,'R03').bleDisconnectEvents,1,'BLE disconnect counted even though reconnect beat the 1 s sampling');
 assert.equal(row(sum,'R03').unrecoveredAtEnd,false);
 for(const slot of ['R01','R02','R04','R05'])assert.equal(row(sum,slot).bleDisconnectEvents,0);
 assert.equal(h.calls.length,choicesAfterPairing,'reconnect opened no chooser and needed no extra pairing');
});
test('server ACK outage: time is LIVE_NO_ACK with ACK failures counted, never LIVE_ACK',async()=>{
 const h=harness(G01.slice(0,2));await h.login();const bands=await pairAll(h,G01.slice(0,2));
 await startLog(h);await stream(h,bands,5);
 h.reply({ok:false,status:503});await stream(h,bands,20);
 h.reply({ok:true,status:200,json:async()=>({accepted:1})});await stream(h,bands,5);
 await h.get('sessionStop').click();
 const r=row(h.api.sessionSummary(h.api.log()),'R01');
 assert.ok(r.seconds.LIVE_NO_ACK>=18,'outage recorded as missing ACK: '+r.seconds.LIVE_NO_ACK);
 assert.ok(r.serverAckFailures>=15);assert.equal(r.seconds.DISCONNECTED,0,'BLE stayed up: not a BLE failure');
 assert.ok(r.coveragePct<80&&r.coveragePct>10);
});
test('HARDWARE_OBSERVED requires an explicit human confirmation; no label means no recording',async()=>{
 const h=harness(G01.slice(0,1));await h.login();
 assert.equal(h.get('sessionStart').disabled,true,'no label selected');
 await h.get('sessionStart').click();assert.equal(h.api.log(),null);
 h.get('sessionLabel').value='HARDWARE_OBSERVED';h.get('sessionLabel').listeners.change();
 assert.equal(h.get('sessionObservedConfirmRow').hidden,false);
 assert.equal(h.get('sessionStart').disabled,true,'confirmation required');
 await h.get('sessionStart').click();assert.equal(h.api.log(),null);
 h.get('sessionObservedConfirm').checked=true;h.get('sessionObservedConfirm').listeners.change();
 assert.equal(h.get('sessionStart').disabled,false);
 await h.get('sessionStart').click();assert.equal(h.api.log().label,'HARDWARE_OBSERVED');
 assert.equal(h.get('sessionLabel').disabled,true,'label is locked while recording');
});
test('reload during a session keeps the log; the reload gap is NOT_OBSERVED',async()=>{
 const storage=new Map();const h=harness(G01.slice(0,1),{storage});await h.login();const bands=await pairAll(h,G01.slice(0,1));
 await startLog(h);await stream(h,bands,10);
 const page=harness(G01.slice(0,1),{storage});
 assert.equal(page.api.log().active,true,'restored');
 await page.tick(1000);
 const sum=page.api.sessionSummary(page.api.log());
 assert.ok(sum.notObservedSeconds>0||sum.observationGaps>=0);
 assert.equal(row(sum,'R01').slot,'R01');
});

// ---------------- readiness view ----------------
test('readiness G01: five rows R01–R05, unconfigured R05 has no action, summary counts only fresh LIVE+ACK',async()=>{
 const h=harness(G01.slice(0,4));await h.login();
 assert.equal(h.get('readiness').hidden,false);
 assert.deepEqual([...h.api.readinessRows.keys()],['R01','R02','R03','R04','R05']);
 const r05=h.api.readinessRows.get('R05');
 assert.match(r05.chip.textContent,/ยังไม่ได้ตั้งค่า/);assert.equal(r05.btn.hidden,true);
 assert.match(h.get('readinessSummary').textContent,/พร้อมส่งข้อมูล 0\/4 • G01/);
 const bands=await pairAll(h,G01.slice(0,4));await stream(h,bands,2);
 assert.match(h.get('readinessSummary').textContent,/พร้อมส่งข้อมูล 4\/4/);
 assert.match(html,/id="readiness"[\s\S]{0,400}ไม่ใช่ผลประเมินทางการแพทย์หรือความพร้อมฝึก/,'readiness is explicitly not medical clearance');
 await h.tick(16000);await h.tick(1000);
 assert.match(h.get('readinessSummary').textContent,/พร้อมส่งข้อมูล 0\/4/,'stale data is never shown ready');
 assert.match(h.api.readinessRows.get('R01').chip.textContent,/NO DATA/);
});
test('readiness retry reconnects a dropped verified watch without chooser or re-pairing; peers untouched',async()=>{
 const h=harness(G01);await h.login();const bands=await pairAll(h,G01);await stream(h,bands,70);
 h.api.bindings.get('R04').autoEnabled=false;            // operator stopped auto recovery for R04
 const peers=Object.fromEntries(['R01','R02','R03','R05'].map(s=>[s,h.api.live.get(s)]));
 bands.R04.gatt.connected=false;bands.R04.listeners.gattserverdisconnected?.();await drain();
 const r=h.api.readinessRows.get('R04');await h.tick(1000);
 assert.equal(r.btn.hidden,false);assert.equal(r.btn.textContent,'เชื่อมใหม่');
 const choices=h.calls.length;await r.btn.click();await drain();
 assert.equal(h.api.live.get('R04')?.ready,true);assert.equal(h.calls.length,choices,'no chooser');
 for(const [s,v] of Object.entries(peers))assert.equal(h.api.live.get(s),v);
});
test('two gateways: G02 readiness and log hold only R06–R10; G01 holds only R01–R05',async()=>{
 const g1=harness(G01),g2=harness(G02,{gateway:'G02'});
 await g1.login();await g2.login();
 assert.deepEqual([...g2.api.readinessRows.keys()],['R06','R07','R08','R09','R10']);
 assert.equal(g2.get('quickR01').hidden,true);
 const b1=await pairAll(g1,G01),b2=await pairAll(g2,G02);
 await startLog(g1);await startLog(g2);
 await Promise.all([stream(g1,b1,15),stream(g2,b2,15)]);
 await g1.get('sessionStop').click();await g2.get('sessionStop').click();
 const s1=g1.api.sessionSummary(g1.api.log()),s2=g2.api.sessionSummary(g2.api.log());
 assert.deepEqual(s1.slots.map(r=>r.slot),['R01','R02','R03','R04','R05']);
 assert.deepEqual(s2.slots.map(r=>r.slot),['R06','R07','R08','R09','R10']);
 assert.equal(s2.gateway,'G02');
 for(const r of [...s1.slots,...s2.slots])assert.ok(r.coveragePct>=90,r.slot+' '+r.coveragePct);
 const g2Uploads=g2.fetches.filter(x=>x.url==='/api/ingest').map(x=>JSON.parse(x.options.body));
 assert.ok(g2Uploads.every(b=>b.gateway==='G02'&&/^R(0[6-9]|10)$/.test(b.readings[0].id)));
});
test('logger never changes uploads or identity: identical ingest payloads with and without logging',async()=>{
 const run=async withLog=>{const h=harness(G01.slice(0,2));await h.login();const b=await pairAll(h,G01.slice(0,2));
  if(withLog)await startLog(h);await stream(h,b,10);
  return h.fetches.filter(x=>x.url==='/api/ingest').map(x=>{const r=JSON.parse(x.options.body).readings[0];return [r.id,r.device_id,r.hr];});};
 assert.deepEqual(await run(true),await run(false));
});

test('a drop that lasts several seconds is an observed drop with a measured recovery time',async()=>{
 const h=harness(G01.slice(0,2));await h.login();const bands=await pairAll(h,G01.slice(0,2));
 await startLog(h);await stream(h,bands,70);
 const realConnect=bands.R02.gatt.connect;bands.R02.gatt.connect=async()=>{throw {name:'NetworkError'};};
 bands.R02.gatt.connected=false;bands.R02.listeners.gattserverdisconnected?.();await drain();
 await stream(h,bands,8,['R02']);
 bands.R02.gatt.connect=realConnect;
 for(let i=0;i<70&&!h.api.live.get('R02')?.ready;i++)await stream(h,bands,1,['R02']);
 await stream(h,bands,3);
 await h.get('sessionStop').click();
 const r=row(h.api.sessionSummary(h.api.log()),'R02');
 assert.equal(r.drops,1);assert.equal(r.recoveries,1);assert.ok(r.recoveryMaxSeconds>=8,'recovery '+r.recoveryMaxSeconds);
 assert.ok(r.seconds.DISCONNECTED>=8);assert.ok(r.autoReconnectAttempts>=2);assert.equal(r.bleDisconnectEvents,1);
 assert.equal(row(h.api.sessionSummary(h.api.log()),'R01').drops,0);
});

// Review #72 (Codex, Issue #71) regressions — exact reproductions.
test('review P2: a 60 s observation gap earns no credit; coverage stays unknown until continuous observation',()=>{
 const {api}=harness(G01);
 const log=api.sessionCreate('SIMULATED','G01',['R01'],100000);
 api.sessionTick(log,160000,{R01:'LIVE_ACK'});
 let sum=api.sessionSummary(log);
 assert.equal(sum.observedSeconds,0);assert.equal(sum.notObservedSeconds,60);
 assert.equal(row(sum,'R01').coveragePct,null,'no partial 2.5 s credit inside the gap');
 api.sessionTick(log,161000,{R01:'LIVE_ACK'});
 sum=api.sessionSummary(log);
 assert.equal(sum.observedSeconds,1);assert.equal(row(sum,'R01').coveragePct,100);
 assert.equal(sum.observationGaps,1);
});
test('review P2: a hidden-only gap between drop and recovery is flagged crossedGap',()=>{
 const {api}=harness(G01);
 const log=api.sessionCreate('SIMULATED','G01',['R01'],100000);
 api.sessionTick(log,101000,{R01:'LIVE_ACK'});
 api.sessionTick(log,102000,{R01:'DISCONNECTED'});
 api.sessionTick(log,112000,{R01:'DISCONNECTED'},{visible:false});
 api.sessionTick(log,113000,{R01:'LIVE_ACK'});
 const r=row(api.sessionSummary(log),'R01');
 assert.equal(r.recoveries,1);assert.equal(r.recoveryMaxSeconds,11);
 assert.equal(r.recoveriesCrossingGap,1,'10 s hidden interval inside the drop');
 const s=api.sessionSummary(log);
 assert.equal(s.observedSeconds,3);assert.equal(s.notObservedSeconds,10);
});
test('a drop first seen after a gap is counted but flagged as crossing the gap',()=>{
 const {api}=harness(G01);
 const log=api.sessionCreate('SIMULATED','G01',['R01'],0);
 api.sessionTick(log,1000,{R01:'LIVE_ACK'});
 api.sessionTick(log,20000,{R01:'DISCONNECTED'});   // reload gap, then seen down
 api.sessionTick(log,21000,{R01:'LIVE_ACK'});
 const r=row(api.sessionSummary(log),'R01');
 assert.equal(r.drops,1);assert.equal(r.recoveriesCrossingGap,1);
 assert.equal(r.seconds.DISCONNECTED,0,'the gap itself is not credited as DISCONNECTED');
});
