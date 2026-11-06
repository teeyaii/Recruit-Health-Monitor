// Issue #77 reproducer + regression: G02 R06 streams while R07–R10 are GATT-connected
// but silent. All devices are MOCKED Web Bluetooth objects; results are SIMULATED and
// do not prove the real Bluefy/iOS cause.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const html=await readFile(new URL('../dashboard/gateway.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const packet=bytes=>new DataView(Uint8Array.from(bytes).buffer);
const drain=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};

class El {
 constructor(){this.listeners={};this.value='';this.disabled=false;this.hidden=false;this.open=false;this.checked=false;this.children=[];this.textContent='';}
 addEventListener(n,f){this.listeners[n]=f;}
 removeEventListener(n,f){if(this.listeners[n]===f)delete this.listeners[n];}
 append(...c){this.children.push(...c);}
 replaceChildren(){this.children=[];}
 remove(){}
 click(){return this.listeners.click?.();}
}
// Tracks GATT operations the page issues. A "hung" op never settles; it is excluded
// from the overlap count once the page has given up on it (its own timeout).
function tracker(){return {inFlight:new Set(),maxOverlap:0,log:[]};}
function band(T,id,suffix){
 const d=new El();d.id=id;d.name='Xiaomi Smart Band 10 '+suffix;
 const c=new El();d.characteristic=c;
 d.starts=0;d.stops=0;d.effectiveFrom=1;d.hang={};d.subscribed=false;
 const op=(name,body)=>(...a)=>{
  const token={name,id};T.log.push(name+':'+id);
  if(d.hang[name]){d.hang[name]--;T.inFlight.add(token);token.hung=true;return new Promise(()=>{});}
  T.inFlight.add(token);T.maxOverlap=Math.max(T.maxOverlap,[...T.inFlight].filter(t=>!t.hung).length);
  return Promise.resolve().then(()=>body(...a)).finally(()=>T.inFlight.delete(token));
 };
 c.startNotifications=op('start',()=>{d.starts++;d.subscribed=d.starts>=d.effectiveFrom;return c;});
 c.stopNotifications=op('stop',()=>{d.stops++;d.subscribed=false;return c;});
 const service={getCharacteristic:op('char',()=>c)};
 d.gatt={connected:false,connect:op('connect',()=>{d.gatt.connected=true;return d.gatt;}),getPrimaryService:op('service',()=>service),
  disconnect(){d.gatt.connected=false;d.subscribed=false;d.listeners.gattserverdisconnected?.();}};
 // A watch delivers HR only while its notification subscription is effective.
 d.emit=(bpm=70)=>{if(d.gatt.connected&&d.subscribed)c.listeners.characteristicvaluechanged?.({target:{value:packet([6,bpm])}});};
 return d;
}
function harness(slots,{storage=new Map(),reply}={}){
 const nodes=new Map(),intervals=[],timers=new Map();let timerId=0,clock=1793980800000;
 const document={hidden:false,listeners:{},getElementById(id){if(!nodes.has(id))nodes.set(id,new El());return nodes.get(id);},createElement(){return new El();},addEventListener(n,f){this.listeners[n]=f;}};
 const window={isSecureContext:true,listeners:{},addEventListener(n,f){this.listeners[n]=f;},
  localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)}};
 const calls=[],fetches=[];let selection=null;let answer=reply||{ok:true,status:200,json:async()=>({accepted:1})};
 const bluetooth={requestDevice(o){calls.push(o);return Promise.resolve(selection);}};
 class Clock extends Date{static now(){return clock;}}
 const context={document,window,navigator:{bluetooth},Date:Clock,Map,Set,AbortController,JSON,Math,Object,
  setInterval(f){intervals.push(f);},setTimeout(f,ms){timers.set(++timerId,{f,at:clock+ms});return timerId;},clearTimeout(id){timers.delete(id);},
  fetch:async(url,options)=>{fetches.push({url,options});
   if(url==='/api/gateway/provision')return {ok:true,json:async()=>({gateway:'G02',slots})};
   return typeof answer==='function'?answer():answer;}};
 vm.createContext(context);
 vm.runInContext(script+'\nthis.api={live,bindings,sessions,readinessRows};',context);
 const get=id=>document.getElementById(id);
 const tick=async(ms=1000)=>{clock+=ms;for(const [id,t] of [...timers])if(t.at<=clock){timers.delete(id);t.f();}intervals.forEach(f=>f());await drain();};
 return {context,get,calls,fetches,api:context.api,storage,tick,now:()=>clock,select(d){selection=d;},reply(r){answer=r;},
  async login(){get('gateway').value='G02';get('token').value='test-only-credential-with-32-characters';await get('load').click();await drain();}};
}
const G02=['R06','R07','R08','R09','R10'].map((id,i)=>({id,device_id:'sim-g02-'+(i+6)}));
const SUFFIX={R06:'6A06',R07:'7B07',R08:'8C08',R09:'9D09',R10:'AE10'};
const SILENT=['R07','R08','R09','R10'];

// Yesterday: all five paired and verified. This morning: reload, the remembered
// handles reconnect, but R07–R10's first subscription delivers nothing.
async function morning({hang={},silentFirst=SILENT,neverEmit=[],reply}={}){
 const storage=new Map(),T=tracker(),bands={};
 const day1=harness(G02,{storage});await day1.login();
 for(const {id} of G02){
  const d=band(T,'sim-'+id,SUFFIX[id]);bands[id]=d;day1.select(d);
  await day1.get('extraBandControls').children.find(x=>x.textContent.includes(id)).click();
  day1.get('expected').value=SUFFIX[id];await day1.get('connect').click();await drain();
  d.emit();await drain();
 }
 for(const d of Object.values(bands)){d.gatt.connected=false;d.subscribed=false;d.starts=0;d.stops=0;}
 for(const id of silentFirst)bands[id].effectiveFrom=2;          // first subscribe ineffective
 for(const id of neverEmit)bands[id].effectiveFrom=Infinity;      // never delivers
 for(const [id,h] of Object.entries(hang))bands[id].hang={...h};
 T.maxOverlap=0;T.log.length=0;
 const h=harness(G02,{storage,reply});h.context.navigator.bluetooth.getDevices=async()=>Object.values(bands);
 await h.login();
 return {h,bands,T};
}
const advance=async(h,bands,seconds,emitters=['R06'])=>{for(let i=0;i<seconds;i++){for(const id of emitters)bands[id].emit();await drain();await h.tick(1000);}};
const fresh=(h,id)=>{const s=h.api.live.get(id);return !!s&&s.bpm!==null&&h.now()-s.lastAt<=15000;};

test('reproducer: after morning reconnect R06 streams and R07–R10 are GATT-connected but silent',async()=>{
 const {h,bands}=await morning();
 await advance(h,bands,10);
 assert.ok(fresh(h,'R06'),'R06 streams');
 for(const id of SILENT){assert.equal(h.api.live.get(id)?.ready,true,id+' reports BLE ready');assert.equal(fresh(h,id),false,id+' has no data');}
});
test('recovery never overlaps GATT operations across slots (baseline issued 3 at once)',async()=>{
 const {h,bands,T}=await morning();
 await advance(h,bands,40,['R06',...SILENT]);
 assert.ok(T.maxOverlap<=1,'max concurrent GATT ops issued by the page: '+T.maxOverlap);
});
test('silent peers recover one by one while R06 stays fresh, acknowledged and untouched',async()=>{
 const {h,bands}=await morning();
 await advance(h,bands,5);              // remembered watches reconnect after login
 const r06=h.api.live.get('R06');assert.ok(fresh(h,'R06'));const r06Starts=bands.R06.starts,r06Stops=bands.R06.stops;
 let r06Fresh=true;
 for(let i=0;i<90&&!SILENT.every(id=>fresh(h,id));i++){
  for(const id of ['R06',...SILENT])bands[id].emit();await drain();await h.tick(1000);
  if(i>2&&!fresh(h,'R06'))r06Fresh=false;
 }
 for(const id of SILENT)assert.ok(fresh(h,id),id+' recovered');
 assert.ok(r06Fresh,'R06 never went stale during peer recovery');
 assert.equal(h.api.live.get('R06'),r06,'R06 session untouched');
 assert.deepEqual([bands.R06.starts,bands.R06.stops],[r06Starts,r06Stops],'no notification repair on R06');
 assert.match(h.api.readinessRows.get('R06').chip.textContent,/เซิร์ฟเวอร์ยืนยันแล้ว/);
 assert.equal(h.calls.length,0,'no chooser, pairing kept');
});
test('one hung slot (stopNotifications never settles) cannot block the other silent peers',async()=>{
 const {h,bands}=await morning({hang:{R07:{stop:99}}});
 for(let i=0;i<120&&!['R08','R09','R10'].every(id=>fresh(h,id));i++){
  for(const id of ['R06',...SILENT])bands[id].emit();await drain();await h.tick(1000);
 }
 for(const id of ['R08','R09','R10'])assert.ok(fresh(h,id),id+' recovered despite hung R07');
 assert.ok(fresh(h,'R06'));
});
test('a link that never delivers HR: failure history kept, retries bounded and increasingly spaced, peers unaffected',async()=>{
 const {h,bands}=await morning({silentFirst:[],neverEmit:['R10']});
 let attempts=0;const realConnect=bands.R10.gatt.connect;
 bands.R10.gatt.connect=(...a)=>{attempts++;return realConnect(...a);};
 const at=[];
 for(let i=0;i<600;i++){const before=attempts;for(const id of ['R06','R07','R08','R09'])bands[id].emit();await drain();await h.tick(1000);if(attempts>before)at.push(i);}
 // Measured on baseline AND after the fix: identical pacing (gaps 46,46,51,56,66,86,106,106 s).
 // This guards the behaviour; it did not demonstrate a baseline defect.
 assert.ok(h.api.bindings.get('R10').failures>0,'failure history kept while no HR sample arrives');
 assert.ok(attempts<=10,'reconnects in 10 min bounded: '+attempts);
 const gaps=at.slice(1).map((t,i)=>t-at[i]);
 assert.ok(gaps.at(-1)>=gaps[0]+30,'retry gaps grow: '+gaps.join(','));
 for(const id of ['R06','R07','R08','R09'])assert.ok(fresh(h,id));
});
test('fresh BLE with server 401/503/network failure never starts a Bluetooth repair',async()=>{
 for(const reply of [{ok:false,status:503},{ok:false,status:401},()=>Promise.reject(TypeError('offline'))]){
  const {h,bands,T}=await morning({silentFirst:[]});
  await advance(h,bands,5,G02.map(s=>s.id));
  h.reply(reply);T.log.length=0;
  await advance(h,bands,70,G02.map(s=>s.id));
  assert.deepEqual(T.log.filter(x=>/^(stop|start|connect)/.test(x)),[],'no BLE operations for a server problem: '+JSON.stringify(reply.status||'network'));
 }
});
test('connect-all is refused while automatic recovery is running (no competing loops)',async()=>{
 const {h,bands,T}=await morning({hang:{R07:{connect:1}}});
 await h.tick(1000);await h.tick(1000);
 const before=T.log.length;
 await h.get('connectAll').click();await drain();
 assert.ok(T.log.slice(before).filter(x=>/^connect:/.test(x)).length<=1,'no second reconnect loop: '+T.log.slice(before).join(' '));
});
test('readiness tells "connected but never received data" apart from "server not confirming"',async()=>{
 const {h,bands}=await morning({silentFirst:['R08']});
 await advance(h,bands,17,['R06','R07','R09','R10']);
 assert.match(h.api.readinessRows.get('R08').chip.textContent,/ยังไม่เคยได้รับข้อมูลหลังเชื่อม|กำลังสมัครรับข้อมูลใหม่/);
 h.reply({ok:false,status:503});await advance(h,bands,3,['R06','R07','R09','R10']);
 assert.match(h.api.readinessRows.get('R06').chip.textContent,/เซิร์ฟเวอร์ยังไม่ยืนยัน • ไม่ต้องจับคู่ใหม่/);
});

test('all five silent, then staggered first HR: every slot recovers, serialized, no chooser',async()=>{
 const {h,bands,T}=await morning({silentFirst:['R06',...SILENT]});
 const all=G02.map(s=>s.id);
 for(let i=0;i<150&&!all.every(id=>fresh(h,id));i++){
  // watches start delivering at different times (staggered)
  for(const [k,id] of all.entries())if(i>=k*7)bands[id].emit();
  await drain();await h.tick(1000);
 }
 for(const id of all)assert.ok(fresh(h,id),id);
 assert.ok(T.maxOverlap<=1,'overlap '+T.maxOverlap);assert.equal(h.calls.length,0);
});
test('disconnect during a re-subscribe: queued work is dropped, slot reconnects later, one listener only',async()=>{
 const {h,bands}=await morning({hang:{R08:{stop:1}}});
 await advance(h,bands,27);                       // R07–R10 re-subscribe queued; R08 stop hangs
 bands.R08.gatt.connected=false;bands.R08.subscribed=false;bands.R08.listeners.gattserverdisconnected?.();await drain();
 for(let i=0;i<120&&!SILENT.every(id=>fresh(h,id));i++){for(const id of ['R06',...SILENT])bands[id].emit();await drain();await h.tick(1000);}
 for(const id of SILENT)assert.ok(fresh(h,id),id);
 for(const id of G02.map(s=>s.id)){
  const c=bands[id].characteristic;assert.equal(typeof c.listeners.characteristicvaluechanged,'function');
 }
 // Element mock keeps one listener per event name; also check nothing extra fires per sample
 const before=h.fetches.filter(x=>x.url==='/api/ingest').length;
 await h.tick(1100);bands.R07.emit();await drain();
 assert.equal(h.fetches.filter(x=>x.url==='/api/ingest').length-before,1,'one upload per sample');
});
