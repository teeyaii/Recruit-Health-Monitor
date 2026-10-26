import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../dashboard/gateway.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const packet=bytes=>new DataView(Uint8Array.from(bytes).buffer);
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
class Element {
 constructor(){this.listeners={};this.value='';this.disabled=false;this.children=[];this.textContent='';}
 addEventListener(n,f){this.listeners[n]=f;}
 removeEventListener(n,f){if(this.listeners[n]===f)delete this.listeners[n];}
 append(...children){this.children.push(...children);}
 replaceChildren(){this.children=[];}
 remove(){}
 click(){return this.listeners.click?.();}
}
function harness(){
 const nodes=new Map(), intervals=[], timers=new Map();let timerId=0;let clock=100000;
 const document={hidden:false,listeners:{},getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement(){return new Element();},addEventListener(n,f){this.listeners[n]=f;}};
 const window={isSecureContext:true,addEventListener(){}};
 const calls=[],fetches=[];let selection=null, uploadResponse={ok:true,status:200,json:async()=>({accepted:1})};
 const bluetooth={requestDevice(options){calls.push(options);return typeof selection==='function'?selection():Promise.resolve(selection);}};
 class Clock extends Date {static now(){return clock;}}
 const context={document,window,navigator:{bluetooth},Date:Clock,Map,Set,AbortController,setInterval(f){intervals.push(f);},setTimeout(f,ms){timers.set(++timerId,{f,at:clock+ms});return timerId;},clearTimeout(id){timers.delete(id);},fetch:async(url,options)=>{
  fetches.push({url,options});
  if(url==='/api/gateway/provision')return {ok:true,json:async()=>({gateway:'G01',slots:[{id:'R01',device_id:'opaque-one'},{id:'R02',device_id:'opaque-two'}]})};
  return typeof uploadResponse==='function'?uploadResponse():uploadResponse;
 }};
 vm.createContext(context);
 vm.runInContext(script+'\nthis.api={connectBand,safeError,decodeHeartRate,live,bindings,stopped,upload};',context);
 const get=id=>document.getElementById(id);
 return {context,document,window,get,calls,fetches,api:context.api,select(d){selection=d;},reply(r){uploadResponse=r;},tick(ms){clock+=ms;for(const [id,t] of timers){if(t.at<=clock){timers.delete(id);t.f();}}intervals.forEach(f=>f());},async login(){get('gateway').value='G01';get('token').value='test-only-credential-with-32-characters';await get('load').click();},async connect(d,slot='R01',suffix='AB12',mode='standard'){selection=d;await context.api.connectBand(slot,suffix,mode);},hide(){document.hidden=true;document.listeners.visibilitychange();}};
}
function device(id='fake-one',suffix='AB12',failStage=null,error={name:'NetworkError'}){
 const d=new Element();d.id=id;d.name='Xiaomi Smart Band 10 '+suffix;d.calls=[];
 const characteristic=new Element();characteristic.startNotifications=async()=>{d.calls.push('subscribe');if(failStage==='subscribe')throw error;return characteristic;};
 const service={getCharacteristic:async uuid=>{d.calls.push(uuid);if(failStage==='characteristic')throw error;return characteristic;}};
 d.gatt={connected:false,connect:async()=>{d.calls.push('gatt');if(failStage==='gatt')throw error;d.gatt.connected=true;return d.gatt;},getPrimaryService:async uuid=>{d.calls.push(uuid);if(failStage==='service')throw error;return service;},disconnect(){d.gatt.connected=false;d.listeners.gattserverdisconnected?.();}};
 d.emit=(bytes=[6,66])=>characteristic.listeners.characteristicvaluechanged?.({target:{value:packet(bytes)}});
 d.characteristic=characteristic;
 return d;
}
test('standard scan invokes chooser synchronously from click and discovers named HR UUIDs',async()=>{
 const h=harness();await h.login();const d=device();h.select(d);h.get('slot').value='R01';h.get('expected').value='AB12';h.get('scanMode').value='standard';
 const connecting=h.get('connect').click();assert.equal(h.calls.length,1);await connecting;
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])),{filters:[{services:['heart_rate']}]});
 assert.deepEqual(d.calls,['gatt','heart_rate','heart_rate_measurement','subscribe']);
 d.emit();await flush();const s=h.api.live.get('R01');assert.equal(s.bpm,66);assert.match(s.state,/LIVE/);assert.equal(s.notifications,'รับ Notify แล้ว');
 const request=h.fetches.find(x=>x.url==='/api/ingest');const body=JSON.parse(request.options.body);
 assert.equal(body.readings[0].device_id,'opaque-one');assert.equal(body.readings[0].id,'R01');assert.match(request.options.headers.Authorization,/^Bearer /);
 assert.equal(h.get('token').value,'');
});
test('broad scan explicitly permits heart_rate, verifies service before accepting notifications',async()=>{
 const h=harness();await h.login();await h.connect(device(),'R01','AB12','broad');
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])),{acceptAllDevices:true,optionalServices:['heart_rate']});
});
for(const failure of [null,undefined,'cancelled by user',{name:'NotFoundError'},new DOMException('cancel','AbortError'),{description:'native bridge failed',code:17},{error:'Permission denied'},{message:'test-only-credential-with-32-characters secret URL'},Object.create(null)]){
 test('chooser rejection safely describes '+String(failure?.name||failure?.code||typeof failure),async()=>{
  const h=harness();await h.login();h.select(()=>Promise.reject(failure));await h.api.connectBand('R01','AB12','standard');
  assert.equal(h.api.live.size,0);assert.match(h.get('bleStatus').textContent,/2\/9/);assert.doesNotMatch(h.get('bleStatus').textContent,/unknown|test-only|secret URL/);
  assert.equal(h.get('connect').disabled,false);
 });
}
for(const [stage,number] of [['gatt',4],['service',5],['characteristic',6],['subscribe',7]]){
 test(stage+' failure names exact stage and disconnects owned device',async()=>{
  const h=harness();await h.login();const d=device('fake-one','AB12',stage);await h.connect(d);
  assert.match(h.get('bleStatus').textContent,new RegExp(number+'/9'));assert.equal(d.gatt.connected,false);assert.equal(h.api.live.size,0);
 });
}
test('two sessions upload independently; duplicate and wrong slot cannot steal connection',async()=>{
 const h=harness();await h.login();const a=device(),b=device('fake-two','CD34');await h.connect(a);await h.connect(b,'R02','CD34');
 a.emit([6,63]);b.emit([6,65]);await flush();assert.equal(h.api.live.get('R01').bpm,63);assert.equal(h.api.live.get('R02').bpm,65);
 await h.api.stopped(h.api.live.get('R02'));await h.connect(a,'R02','AB12');assert.equal(a.gatt.connected,true);assert.match(h.get('bleStatus').textContent,/ช่องอื่น/);
 await h.connect(b,'R03','CD34');assert.equal(h.calls.length,3,'unauthorized slot does not open chooser');
 await h.connect(b,'R02','AB12');assert.match(h.get('bleStatus').textContent,/ไม่ตรงรหัส/);
 await h.api.stopped(h.api.live.get('R01'));await h.connect(b,'R01','CD34');assert.match(h.get('bleStatus').textContent,/ช่องอื่น|จับคู่เดิม/);
});
test('disconnect clears BPM and stale data never remains LIVE',async()=>{
 const h=harness();await h.login();const d=device();await h.connect(d);const s=h.api.live.get('R01');d.emit();await flush();h.tick(15001);
 assert.equal(s.bpm,null);assert.match(s.state,/STALE.*NO DATA/);d.gatt.disconnect();await flush();assert.equal(h.api.live.size,0);assert.match(s.state,/DISCONNECTED/);assert.equal(s.measure.textContent,'NO DATA');
});
test('background stops both connections and prevents further uploads',async()=>{
 const h=harness();await h.login();const a=device(),b=device('two','CD34');await h.connect(a);await h.connect(b,'R02','CD34');h.hide();await flush();
 const count=h.fetches.length;a.emit();b.emit();await flush();assert.equal(h.fetches.length,count);assert.equal(h.api.live.size,0);assert.equal(a.gatt.connected,false);assert.equal(b.gatt.connected,false);
});
test('background during pending GATT cannot resurrect connection',async()=>{
 const h=harness();await h.login();const d=device();let resolve;d.gatt.connect=()=>new Promise(r=>{resolve=r;});h.select(d);
 const promise=h.api.connectBand('R01','AB12','standard');await flush();h.hide();d.gatt.connected=true;resolve(d.gatt);await promise;
 assert.equal(d.gatt.connected,false);assert.equal(h.api.live.size,0);assert.equal(d.characteristic.listeners.characteristicvaluechanged,undefined);
});
test('HTTP rejection and accepted=0 remain actionable per device',async()=>{
 for(const response of [{ok:false,status:403},{ok:true,status:200,json:async()=>({accepted:0})}]){
  const h=harness();await h.login();h.reply(response);const d=device();await h.connect(d);d.emit();await flush();
  const s=h.api.live.get('R01');assert.match(s.state,/SERVER REJECTED/);assert.match(s.error,/9\/9/);assert.match(s.ack,/403|accepted/);
 }
});
test('late acknowledgement cannot turn stale or contact-lost measurement into LIVE',async()=>{
 const h=harness();await h.login();let resolve;h.reply(()=>new Promise(r=>{resolve=r;}));const d=device();await h.connect(d);d.emit();await flush();h.tick(16000);
 resolve({ok:true,json:async()=>({accepted:1})});await flush();assert.match(h.api.live.get('R01').state,/STALE/);
 h.reply({ok:true,json:async()=>({accepted:1})});d.emit([4,66]);await flush();assert.equal(h.api.live.get('R01').bpm,null);assert.match(h.api.live.get('R01').state,/NO DATA/);
});
test('capability missing and arbitrary exception getters do not disclose secrets or crash',async()=>{
 const h=harness();await h.login();h.context.navigator.bluetooth=null;await h.connect(device());assert.match(h.get('bleStatus').textContent,/1\/9/);
 assert.doesNotThrow(()=>h.api.safeError({get name(){throw Error('secret');}}));
});
test('clear invalidates pending chooser and never sends under a new credential',async()=>{
 const h=harness();await h.login();let resolve;h.select(()=>new Promise(r=>resolve=r));const p=h.api.connectBand('R01','AB12','standard');await h.get('clear').click();resolve(device());await p;
 assert.equal(h.api.live.size,0);assert.equal(h.fetches.filter(x=>x.url==='/api/ingest').length,0);assert.equal(h.get('connect').disabled,true);
});
test('upload rejects session assignment tampering before fetch',async()=>{
 const h=harness();await h.login();await h.connect(device());const s=h.api.live.get('R01');s.assignment='opaque-two';const r=await h.api.upload(s,65,100000);
 assert.equal(r.ok,false);assert.equal(h.fetches.filter(x=>x.url==='/api/ingest').length,0);
});
test('three foreground recovery cycles reconnect both slots independently',async()=>{
 const h=harness();await h.login();const a=device(),b=device('two','CD34');
 for(let cycle=0;cycle<3;cycle++){
  await h.connect(a);await h.connect(b,'R02','CD34');a.emit();b.emit([6,57]);await flush();
  const first=h.api.live.get('R01'),second=h.api.live.get('R02');
  h.hide();await flush();assert.equal(first.bpm,null);assert.equal(second.bpm,null);
  h.document.hidden=false;h.document.listeners.visibilitychange();
  assert.equal(first.retry.disabled,false);assert.equal(second.retry.disabled,false);
 }
});
test('explicit disconnect and reconnect of R01 leaves R02 subscribed',async()=>{
 const h=harness();await h.login();const a=device(),b=device('two','CD34');await h.connect(a);await h.connect(b,'R02','CD34');
 await h.api.stopped(h.api.live.get('R01'));await h.connect(a);b.emit([6,57]);await flush();
 assert.equal(h.api.live.get('R02').bpm,57);assert.equal(b.gatt.connected,true);
});
test('getDevices reconnect matches only previously bound ID; unsupported requires new tap',async()=>{
 const h=harness();await h.login();const d=device();await h.connect(d);await h.api.stopped(h.api.live.get('R01'));
 h.context.navigator.bluetooth.getDevices=async()=>[device('other','CD34'),d];
 await h.connect(null,'R01','AB12','known');assert.equal(h.calls.length,1);assert.equal(h.api.live.get('R01').device,d);
 await h.api.stopped(h.api.live.get('R01'));delete h.context.navigator.bluetooth.getDevices;
 await h.connect(null,'R01','AB12','known');assert.equal(h.calls.length,1);assert.match(h.get('bleStatus').textContent,/ไม่รองรับ/);
 await h.connect(d);assert.equal(h.calls.length,2);
});
test('rapid taps and unresolved chooser never launch overlapping native prompts',async()=>{
 const h=harness();await h.login();let resolve;h.select(()=>new Promise(r=>resolve=r));
 const pending=h.api.connectBand('R01','AB12','standard');await h.api.connectBand('R02','CD34','broad');assert.equal(h.calls.length,1);
 h.hide();await pending;h.document.hidden=false;h.document.listeners.visibilitychange();
 await h.api.connectBand('R01','AB12','standard');assert.equal(h.calls.length,1);
 resolve(device());await flush();await h.connect(device());assert.equal(h.calls.length,2);
});
test('old notification and backgrounded upload cannot contaminate replacement session',async()=>{
 const h=harness();await h.login();const a=device();await h.connect(a);const old=h.api.live.get('R01');let reply;
 h.reply(()=>new Promise(r=>reply=r));a.emit();await flush();const signal=h.fetches.find(x=>x.url==='/api/ingest').options.signal;
 h.hide();assert.equal(signal.aborted,true);h.document.hidden=false;h.document.listeners.visibilitychange();
 h.reply({ok:true,json:async()=>({accepted:1})});await h.connect(a);const fresh=h.api.live.get('R01');
 old.onValue({target:{value:packet([6,99])}});reply({ok:true,json:async()=>({accepted:1})});await flush();assert.equal(fresh.bpm,null);
});
test('native chooser timeout releases attempt but requires reset before a second chooser',async()=>{
 const h=harness();await h.login();h.select(()=>new Promise(()=>{}));const p=h.api.connectBand('R01','AB12','standard');h.tick(20001);await p;
 assert.match(h.get('bleStatus').textContent,/TimeoutError/);assert.equal(h.api.live.size,0);
 await h.api.connectBand('R01','AB12','broad');assert.equal(h.calls.length,1);
 let reloaded=false;h.window.location={reload(){reloaded=true;}};h.get('resetBle').click();assert.equal(reloaded,false);assert.match(h.get("bleStatus").textContent,/Manual action required/);
});
test('failed R01 GATT retry leaves R02 data live',async()=>{
 const h=harness();await h.login();const b=device('two','CD34');await h.connect(b,'R02','CD34');await h.connect(device('one','AB12','gatt'));b.emit([6,57]);await flush();
 assert.equal(h.api.live.get('R02').bpm,57);assert.equal(b.gatt.connected,true);
});
const drain=async()=>{for(let i=0;i<150;i++)await Promise.resolve();};
function foreground(h){h.document.hidden=false;h.document.listeners.visibilitychange();}
test('foreground automatically restores two authorized handles without chooser or stale BPM',async()=>{
 const h=harness();await h.login();const a=device(),b=device('two','CD34');await h.connect(a);await h.connect(b,'R02','CD34');a.emit();b.emit();await drain();
 for(let i=0;i<3;i++){
  h.hide();await drain();foreground(h);await drain();assert.equal(h.calls.length,2);assert.equal(h.api.live.size,2);
  assert.equal(h.api.live.get('R01').bpm,null);assert.equal(h.api.live.get('R02').bpm,null);
  h.tick(1001);a.emit([6,52]);b.emit([6,58]);await drain();assert.equal(h.api.live.get('R01').bpm,52);assert.equal(h.api.live.get('R02').bpm,58);
 }
});
test('soft reset keeps G01 credentials and bindings without a provisioning request',async()=>{
 const h=harness();await h.login();const a=device();await h.connect(a);h.get('resetBle').click();await drain();
 assert.equal(h.api.live.size,1);assert.equal(h.api.bindings.size,1);assert.equal(h.fetches.filter(x=>x.url==='/api/gateway/provision').length,1);
 h.tick(1001);a.emit();await drain();assert.match(h.api.live.get('R01').state,/Server acknowledged/);
});
test('explicit operator disconnect and logout suppress foreground restoration',async()=>{
 const h=harness();await h.login();await h.connect(device());h.api.live.get('R01').stop.click();await drain();h.hide();foreground(h);await drain();assert.equal(h.api.live.size,0);
 await h.connect(device());await h.get('clear').click();h.hide();foreground(h);await drain();assert.equal(h.api.live.size,0);assert.equal(h.calls.length,2);
});
test('discarded handle uses getDevices and validates old binding without chooser',async()=>{
 const h=harness();await h.login();const a=device();await h.connect(a);h.hide();await drain();h.api.bindings.get('R01').device=null;
 h.context.navigator.bluetooth.getDevices=async()=>[a];foreground(h);await drain();assert.equal(h.calls.length,1);assert.equal(h.api.live.get('R01').device,a);
});
test('missing handles or native permission failure require manual action with bounded retries',async()=>{
 for(const supported of [true,false]){
  const h=harness();await h.login();const a=device();await h.connect(a);h.hide();await drain();let attempts=0,lookups=0;
  a.gatt.connect=async()=>{attempts++;throw {name:'NotAllowedError'};};
  if(supported)h.context.navigator.bluetooth.getDevices=async()=>{lookups++;return [a];};
  foreground(h);await drain();assert.equal(h.calls.length,1);assert.equal(attempts,supported?2:1);assert.equal(lookups,supported?1:0);assert.equal(h.api.live.size,0);
  assert.match(h.get('slots').children.at(-1).children[2].textContent,/Manual action required/);
 }
});
test('R01 auto failure leaves R02 restored; background cancels in-progress auto connect',async()=>{
 const h=harness();await h.login();const a=device(),b=device('two','CD34');await h.connect(a);await h.connect(b,'R02','CD34');h.hide();await drain();
 a.gatt.connect=async()=>{throw {name:'NetworkError'};};foreground(h);await drain();assert.equal(h.api.live.has('R01'),false);assert.equal(h.api.live.get('R02').ready,true);
 h.hide();await drain();let resolve;b.gatt.connect=()=>new Promise(r=>resolve=r);foreground(h);await drain();h.hide();await drain();b.gatt.connected=true;resolve(b.gatt);await drain();assert.equal(h.api.live.size,0);assert.equal(b.gatt.connected,false);
});
