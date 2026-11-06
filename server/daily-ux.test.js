// Daily-operations UX (Gateway + Live). All Bluetooth devices and HTTP
// responses here are MOCKED / SIMULATED; nothing in this file is hardware evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const drain=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const packet=bytes=>new DataView(Uint8Array.from(bytes).buffer);

// ---------------- Gateway harness ----------------
const gatewayHtml=await readFile(new URL('../dashboard/gateway.html',import.meta.url),'utf8');
const gatewayScript=gatewayHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
class El {
 constructor(){this.listeners={};this.value='';this.disabled=false;this.hidden=false;this.open=false;this.checked=false;this.children=[];this.textContent='';}
 addEventListener(n,f){this.listeners[n]=f;}
 removeEventListener(n,f){if(this.listeners[n]===f)delete this.listeners[n];}
 append(...c){this.children.push(...c);}
 replaceChildren(){this.children=[];}
 remove(){}
 click(){return this.listeners.click?.();}
}
function gateway(slots,{gatewayId='G02',storage=new Map()}={}){
 const nodes=new Map(),intervals=[],timers=new Map();let timerId=0,clock=1793952000000;
 const document={hidden:false,listeners:{},getElementById(id){if(!nodes.has(id))nodes.set(id,new El());return nodes.get(id);},createElement(){return new El();},addEventListener(n,f){this.listeners[n]=f;}};
 const window={isSecureContext:true,listeners:{},addEventListener(n,f){this.listeners[n]=f;},
  localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)}};
 const calls=[],fetches=[];let selection=null,reply={ok:true,status:200,json:async()=>({accepted:1})};
 const bluetooth={requestDevice(o){calls.push(o);return Promise.resolve(typeof selection==='function'?selection():selection);}};
 class Clock extends Date{static now(){return clock;}}
 const context={document,window,navigator:{bluetooth},Date:Clock,Map,Set,AbortController,JSON,Math,Object,
  setInterval(f){intervals.push(f);},setTimeout(f,ms){timers.set(++timerId,{f,at:clock+ms});return timerId;},clearTimeout(id){timers.delete(id);},
  fetch:async(url,options)=>{fetches.push({url,options});
   if(url==='/api/gateway/provision')return {ok:true,json:async()=>({gateway:gatewayId,slots})};
   return typeof reply==='function'?reply():reply;}};
 vm.createContext(context);
 vm.runInContext(gatewayScript+'\nthis.api={live,bindings,sessions,readinessRows};',context);
 const get=id=>document.getElementById(id);
 const tick=async(ms=1000)=>{clock+=ms;for(const [id,t] of timers)if(t.at<=clock){timers.delete(id);t.f();}intervals.forEach(f=>f());await drain();};
 return {context,document,get,calls,fetches,api:context.api,storage,tick,select(d){selection=d;},reply(r){reply=r;},
  async login(){get('gateway').value=gatewayId;get('token').value='test-only-credential-with-32-characters';await get('load').click();await drain();}};
}
function band(id,suffix){
 const d=new El();d.id=id;d.name='Xiaomi Smart Band 10 '+suffix;
 const c=new El();c.startNotifications=async()=>c;
 d.gatt={connected:false,connect:async()=>{d.gatt.connected=true;return d.gatt;},getPrimaryService:async()=>({getCharacteristic:async()=>c}),
  disconnect(){d.gatt.connected=false;d.listeners.gattserverdisconnected?.();}};
 d.emit=(bpm=72)=>c.listeners.characteristicvaluechanged?.({target:{value:packet([6,bpm])}});
 return d;
}
const G02=['R06','R07','R08','R09','R10'].map((id,i)=>({id,device_id:'sim-g02-'+(i+6)}));
const SUFFIX={R06:'6A06',R07:'7B07',R08:'8C08',R09:'9D09',R10:'AE10'};
async function enroll(h,slots=G02){
 const bands={};
 for(const {id} of slots){
  const d=band('sim-'+id,SUFFIX[id]);bands[id]=d;h.select(d);
  await h.get('extraBandControls').children.find(x=>x.textContent.includes(id)).click(); // existing "เพิ่ม Rxx" path
  h.get('expected').value=SUFFIX[id];await h.get('connect').click();await drain();
  d.emit();await drain();
 }
 return bands;
}
const stream=async(h,bands,seconds)=>{for(let i=0;i<seconds;i++){for(const d of Object.values(bands))d.emit();await drain();await h.tick(1000);}};
const chip=(h,slot)=>h.api.readinessRows.get(slot).chip.textContent;
const btn=(h,slot)=>h.api.readinessRows.get(slot).btn;

test('G02 first login shows pairing; only its provisioned R06–R10 appear; G01 R01/R02 buttons hidden',async()=>{
 const h=gateway(G02);await h.login();
 assert.equal(h.get('pairingPanel').open,true,'nothing verified yet: first-time pairing is visible');
 assert.deepEqual([...h.api.readinessRows.keys()],['R06','R07','R08','R09','R10']);
 assert.equal(h.get('quickR01').hidden,true);assert.equal(h.get('quickR02').hidden,true);
 assert.deepEqual(h.get('extraBandControls').children.map(b=>b.textContent),['เพิ่ม R06','เพิ่ม R07','เพิ่ม R08','เพิ่ม R09','เพิ่ม R10']);
});
test('next login with remembered watches folds pairing; connect-all and per-row retry still use the existing path',async()=>{
 const storage=new Map();const first=gateway(G02,{storage});await first.login();const bands=await enroll(first);
 const h=gateway(G02,{storage});h.context.navigator.bluetooth.getDevices=async()=>Object.values(bands);
 await h.login();
 assert.equal(h.get('pairingPanel').open,false,'daily use: pairing folded, still reachable');
 for(let i=0;i<6;i++)await h.tick(1000);
 for(const {id} of G02)assert.equal(h.api.live.get(id)?.ready,true,id+' reconnected without chooser');
 assert.equal(h.calls.length,0,'no native chooser, no re-pairing');
 assert.match(h.get('connectAll').textContent,/\(5\/5\)/);
});
test('opening or folding the pairing panel never starts or stops a BLE session',async()=>{
 const h=gateway(G02);await h.login();const bands=await enroll(h);await stream(h,bands,2);
 const before=[...h.api.live.entries()],calls=h.calls.length;
 for(const open of [false,true,false]){h.get('pairingPanel').open=open;await h.tick(1000);}
 assert.deepEqual([...h.api.live.entries()],before);assert.equal(h.calls.length,calls);
 for(const d of Object.values(bands))assert.equal(d.gatt.connected,true);
});
test('one ACK definition: readiness, card and header agree; an old ACK is never shown as confirmed',async()=>{
 const h=gateway(G02);await h.login();const bands=await enroll(h);await stream(h,bands,3);
 assert.match(h.get('readinessSummary').textContent,/พร้อมส่งข้อมูล 5\/5 • G02/);
 assert.equal(h.get('gatewayUpload').textContent,'รับแล้ว 5 เรือน');
 for(const {id} of G02){assert.match(h.api.live.get(id).indicator.textContent,/^LIVE • Server acknowledged/);assert.match(chip(h,id),/เซิร์ฟเวอร์ยืนยันแล้ว/);}
 // Server stops acknowledging (requests hang); BLE keeps streaming. After 15 s nothing may claim a fresh ACK.
 h.reply(()=>new Promise(()=>{}));
 for(let i=0;i<17;i++){for(const d of Object.values(bands))d.emit();await h.tick(1000);}
 assert.match(h.get('readinessSummary').textContent,/พร้อมส่งข้อมูล 0\/5/);
 assert.notEqual(h.get('gatewayUpload').textContent,'รับแล้ว 5 เรือน');
 for(const {id} of G02){assert.doesNotMatch(h.api.live.get(id).indicator.textContent,/Server acknowledged/);assert.doesNotMatch(chip(h,id),/ยืนยันแล้ว/);}
});
test('503: server problem says so, offers no pairing action; BLE untouched',async()=>{
 const h=gateway(G02);await h.login();const bands=await enroll(h);await stream(h,bands,2);
 h.reply({ok:false,status:503});await stream(h,bands,2);
 assert.match(chip(h,'R07'),/เซิร์ฟเวอร์ยังไม่ยืนยัน • ไม่ต้องจับคู่ใหม่ • เซิร์ฟเวอร์ขัดข้องชั่วคราว \(HTTP 503\)/);
 assert.equal(btn(h,'R07').hidden,true,'no reconnect/pair button for a server problem');
 for(const d of Object.values(bands))assert.equal(d.gatt.connected,true);
});
test('401: session problem asks to log in again (same Gateway), never to re-pair; rows show it',async()=>{
 const h=gateway(G02);await h.login();const bands=await enroll(h);await stream(h,bands,2);
 h.reply({ok:false,status:401});await stream(h,bands,2);
 assert.match(h.get('readinessSummary').textContent,/ต้องเข้าใช้งาน G02 ใหม่/);
 for(const {id} of G02){assert.match(chip(h,id),/ต้องเข้าใช้งานใหม่ • นาฬิกายังเชื่อมอยู่ ไม่ต้องจับคู่ใหม่/);assert.equal(btn(h,id).hidden,true);}
 assert.equal(h.get('loginFields').hidden,false);assert.equal(h.get('gateway').disabled,true);
 assert.equal(h.calls.length,5,'no chooser was opened');
});
test('409: slot used by another session is explained; no re-pair button',async()=>{
 const h=gateway(G02);await h.login();const bands=await enroll(h);await stream(h,bands,2);
 h.reply({ok:false,status:409,json:async()=>({})});bands.R08.emit();await h.tick(1100);bands.R08.emit();await drain();await h.tick(1000);
 assert.match(chip(h,'R08'),/ช่องนี้ถูกใช้จากอีกเครื่อง/);
 assert.equal(btn(h,'R08').hidden,true);
});
test('watch drop: honest "หลุด" with automatic retry countdown, per-row reconnect only for that watch',async()=>{
 const h=gateway(G02);await h.login();const bands=await enroll(h);await stream(h,bands,62);
 bands.R09.gatt.connect=async()=>{throw {name:'NetworkError'};};
 bands.R09.gatt.connected=false;bands.R09.listeners.gattserverdisconnected?.();await drain();await h.tick(1000);
 assert.match(chip(h,'R09'),/นาฬิกาหลุด/);assert.match(chip(h,'R09'),/จะลองเชื่อมเองใน \d+ วิ|ต้องกดเชื่อมใหม่/);
 assert.equal(btn(h,'R09').hidden,false);assert.equal(btn(h,'R09').textContent,'เชื่อมใหม่');
 for(const id of ['R06','R07','R08','R10'])assert.equal(btn(h,id).hidden,true,id+' healthy: no troubleshooting button');
});
test('all ready clears finished pairing guidance; disconnect action lives in card details',async()=>{
 const h=gateway(G02);await h.login();const bands=await enroll(h);
 await stream(h,bands,2);
 assert.equal(h.get('pairGuide').hidden,true,'guidance from the last pairing is cleared once all 5 are LIVE+ACK');
 assert.equal(h.get('simpleStatus').textContent,'ทุกเรือนส่งข้อมูลและเซิร์ฟเวอร์ยืนยันแล้ว');
 const card=h.get('slots').children[0];
 const actions=card.children.at(-1),details=card.children.at(-2);
 assert.ok(!actions.children.some(b=>/ตัดการเชื่อมต่อ/.test(b.textContent)),'no prominent disconnect in daily actions');
 assert.ok(details.children.some(b=>/ตัดการเชื่อมต่อ R06/.test(b.textContent)),'disconnect still reachable in details');
});

// ---------------- Live dashboard harness ----------------
const liveHtml=await readFile(new URL('../dashboard/live.html',import.meta.url),'utf8');
const liveScript=liveHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
class Node {
 constructor(id){this.id=id;this.value='';this.textContent='';this.innerHTML='';this.hidden=false;this.disabled=false;this.open=false;this.checked=false;this.dataset={};this.style={};
  this.classList={toggle(){},add(){},remove(){},contains(){return false;}};}
 addEventListener(){}setAttribute(){}getAttribute(){return null;}querySelector(){return null;}querySelectorAll(){return [];}closest(){return null;}
 append(){}appendChild(){}replaceChildren(){}scrollIntoView(){this.scrolled=true;}focus(){}
}
const res=(status,body={})=>({ok:status>=200&&status<300,status,json:async()=>{if(typeof body==='string')throw SyntaxError('not JSON');return body;}});
function liveView(route){
 const nodes=new Map(),requests=[];
 const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id);},querySelector:sel=>sel==='#wbgtForm button'?document.getElementById('wbgtButton'):null,
  querySelectorAll:()=>[],createElement:()=>new Node(),body:new Node('body'),addEventListener(){},hidden:false};
 const context={document,window:{addEventListener(){},confirm:()=>true},navigator:{},localStorage:{getItem:()=>null,setItem(){}},
  fetch:async(url,o={})=>{requests.push({url,method:o.method||'GET',body:o.body});return route(url,o.method||'GET',o.body);},
  EventSource:class{close(){}},setInterval(){},setTimeout(){},clearTimeout(){},Date,Math,JSON,Promise,URL,Audio:class{},location:{hash:'',origin:'http://x'}};
 vm.createContext(context);vm.runInContext(liveScript,context);
 return {node:id=>document.getElementById(id),requests,run:code=>vm.runInContext(code,context),context};
}
const roster=(slots)=>({slots,ephemeral:false});
const me={role:'trainer',privateProfilesEnabled:true};

test('mutationFailure: cause-specific Thai text for 401/403/409/503 and non-JSON errors; never "success"',async()=>{
 const v=liveView(()=>res(401));
 const msg=async(status,body)=>v.run('mutationFailure')(res(status,body));
 assert.match(await msg(401),/หมดเวลาเข้าใช้งาน/);
 assert.match(await msg(403),/ไม่มีสิทธิ์/);
 assert.match(await msg(409,{error:'wearer changed; reload before continuing'}),/อีกจอหรือเปลี่ยนผู้สวม.*ยังไม่ได้บันทึก/);
 assert.match(await msg(503),/ยังไม่ถือว่าบันทึกสำเร็จ/);
 assert.match(await msg(502,'<html>Bad gateway</html>'),/\(HTTP 502\) • ยังไม่ได้บันทึก/,'HTML error page does not crash');
 for(const s of [401,403,409,500,503])assert.doesNotMatch(await msg(s),/(?<!ไม่ถือว่า)บันทึกสำเร็จ|บันทึกแล้ว/);
});
test('roster save 409: one write, no automatic retry, latest server data loaded, typed values kept',async()=>{
 let version=3;
 const v=liveView((url,method)=>{
  if(url==='/api/roster/R06'&&method==='PUT')return res(409,{error:'stale roster version'});
  if(url==='/api/operator/me')return res(200,me);
  if(url==='/api/roster')return res(200,roster([{id:'R06',code:'B006',version:++version,restriction:'watch',observation:'none'}]));
  if(url==='/api/roster/audit')return res(200,{events:[]});
  return res(401);
 });
 await drain();
 v.run(`rosterData=${JSON.stringify(roster([{id:'R06',code:'A006',version:3,restriction:'none',observation:'none'}]))};operatorRole='trainer';`);
 v.node('rosterSlot').value='R06';v.node('rosterCode').value='NEW007';v.node('rosterRestriction').value='none';
 const first=v.run('rosterAction("save")'),second=v.run('rosterAction("save")');await Promise.all([first,second]);await drain();
 assert.equal(v.requests.filter(r=>r.method==='PUT').length,1,'double tap and 409 never cause a second write');
 assert.match(v.node('rosterStatus').textContent,/อีกจอหรือเปลี่ยนผู้สวม/);
 assert.equal(v.node('rosterCode').value,'NEW007','typed value kept for the operator to review');
 assert.equal(v.run('rosterData.slots[0].version'),4,'latest server version loaded');
 assert.equal(v.node('rosterSave').disabled,false);
});
test('roster save network failure: not reported as saved; button re-enabled',async()=>{
 const v=liveView((url,method)=>{if(method==='PUT')throw TypeError('offline');return res(401);});
 await drain();
 v.run(`rosterData=${JSON.stringify(roster([{id:'R07',code:'A007',version:1,restriction:'none',observation:'none'}]))};`);
 v.node('rosterSlot').value='R07';v.node('rosterCode').value='A007';
 await v.run('rosterAction("save")');
 assert.match(v.node('rosterStatus').textContent,/เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ • ยังไม่ได้บันทึก/);
 assert.equal(v.node('rosterSave').disabled,false);
});
test('private profile: a slow save for R06 is never applied after switching to R07',async()=>{
 let release;
 const v=liveView((url,method)=>{
  if(url==='/api/private-profile/R06'&&method==='PUT')return new Promise(r=>{release=()=>r(res(200,{profile:{version:9}}));});
  if(url==='/api/private-profile/R07')return res(200,{profile:{version:2}});
  return res(401);
 });
 await drain();
 v.run(`rosterData=${JSON.stringify(roster([{id:'R06',code:'A006',version:1,restriction:'none',observation:'none'},{id:'R07',code:'A007',version:1,restriction:'none',observation:'none'}]))};privateSlot='R06';privateVersion=1;`);
 v.node('privatePanel').open=true;v.node('rosterSlot').value='R06';
 const saving=v.node('privateSave').onclick();
 v.node('rosterSlot').value='R07';await v.run('loadPrivateProfile()');
 release();await saving;await drain();
 assert.equal(v.run('privateSlot'),'R07');assert.equal(v.run('privateVersion'),2,'R06 result not applied to R07');
 assert.doesNotMatch(v.node('privateStatus').textContent,/บันทึกข้อมูลส่วนตัวแบบเข้ารหัสสำเร็จ/);
});
test('WBGT: repeated submit ignored while saving; failure keeps the measured value and says not saved',async()=>{
 let release;
 const v=liveView((url,method)=>url==='/api/context'&&method==='POST'?new Promise(r=>{release=()=>r(res(503));}):res(401));
 await drain();
 v.node('wbgt').value='31.2';
 const a=v.node('wbgtForm').onsubmit({preventDefault(){}}),b=v.node('wbgtForm').onsubmit({preventDefault(){}});
 assert.match(v.node('conditions').textContent,/กำลังบันทึก/);
 release();await Promise.all([a,b]);
 assert.equal(v.requests.filter(r=>r.url==='/api/context'&&r.method==='POST').length,1);
 assert.equal(v.node('wbgt').value,'31.2');
 assert.match(v.node('conditions').textContent,/ยังไม่ถือว่าบันทึกสำเร็จ/);
});
test('Medic close 409: explains the change after reloading the latest case; no automatic retry',async()=>{
 const v=liveView((url,method)=>{
  if(url==='/api/medic-reviews/R08'&&method==='PUT')return res(409,{error:'wearer changed; reload before continuing'});
  return res(401);
 });
 await drain();
 v.run(`rosterData=${JSON.stringify(roster([{id:'R08',code:'A008',version:1,restriction:'none',observation:'none'}]))};medicSlot='R08';medicCode='A008';medicVersion=4;`);
 v.node('rosterSlot').value='R08';
 await v.node('medicClose').onclick();await drain();
 assert.equal(v.requests.filter(r=>r.method==='PUT').length,1);
 assert.match(v.node('medicMessage').textContent,/อีกจอหรือเปลี่ยนผู้สวม/);
 assert.match(liveHtml,/ไม่ใช่การอนุญาตให้กลับไปฝึกโดยอัตโนมัติ/);
});
test('pending automatic case: shortcut to the existing Medic Review only for permitted operators; EMERGENCY unchanged',async()=>{
 const v=liveView(()=>res(401));await drain();
 const now=Date.now();
 const data={recruits:[{id:'R06',hr:150,timestamp:now,stale:false,autoCheck:true},{id:'R07',hr:null,timestamp:now-20000,stale:true}]};
 const profiles=[{id:'R06',code:'A006',version:1,restriction:'none',observation:'none'},{id:'R07',code:'A007',version:1,restriction:'none',observation:'confusion_collapse_seizure'}];
 v.run(`rosterData=${JSON.stringify(roster(profiles))};transportUp=true;operatorRole=null;`);
 v.node('medicPanel').hidden=true;v.run(`draw(${JSON.stringify(data)})`);
 assert.doesNotMatch(v.node('cards').innerHTML,/data-review-slot/,'no shortcut without the existing permission');
 v.run(`operatorRole='medic';`);v.node('medicPanel').hidden=false;v.run(`draw(${JSON.stringify(data)})`);
 assert.match(v.node('cards').innerHTML,/data-review-slot="R06">เปิดรายการรอประเมิน/);
 assert.doesNotMatch(v.node('cards').innerHTML,/data-review-slot="R07"/,'only pending automatic cases');
 assert.match(v.node('autoPauseAlerts').innerHTML,/data-review-slot="R06"/);
 assert.match(v.node('emergencyAlerts').innerHTML,/EMERGENCY \(1\)/);
 assert.equal(v.node('emergencyAlerts').hidden,false);
 v.node('medicPanel').open=false;v.run('openMedicReview("R06")');
 assert.equal(v.node('rosterSlot').value,'R06');assert.equal(v.node('medicPanel').open,true);assert.equal(v.node('medicPanel').scrolled,true);
 v.run('openMedicReview("R99")');assert.equal(v.node('rosterSlot').value,'R06','unknown slot ignored');
});
test('Commander page and reliability export gain no private health fields from this change',async()=>{
 const commander=await readFile(new URL('../dashboard/commander.html',import.meta.url),'utf8');
 assert.doesNotMatch(commander,/data-review-slot|medic-reviews\/|private-profile/);
 assert.doesNotMatch(gatewayScript.match(/function sessionSummary[\s\S]*?\n}\n/)[0],/hr|bpm|code|medication|condition/i);
});
