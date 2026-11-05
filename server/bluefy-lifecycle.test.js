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
function harness(provisionedSlots=[{id:'R01',device_id:'opaque-one'},{id:'R02',device_id:'opaque-two'}]){
 const nodes=new Map(), intervals=[], timers=new Map();let timerId=0;let clock=100000;
 const document={hidden:false,listeners:{},getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement(){return new Element();},addEventListener(n,f){this.listeners[n]=f;}};
 const window={isSecureContext:true,addEventListener(){}};
 const calls=[],fetches=[];let selection=null, uploadResponse={ok:true,status:200,json:async()=>({accepted:1})};
 const bluetooth={requestDevice(options){calls.push(options);return typeof selection==='function'?selection():Promise.resolve(selection);}};
 class Clock extends Date {static now(){return clock;}}
 const context={document,window,navigator:{bluetooth},Date:Clock,Map,Set,AbortController,setInterval(f){intervals.push(f);},setTimeout(f,ms){timers.set(++timerId,{f,at:clock+ms});return timerId;},clearTimeout(id){timers.delete(id);},fetch:async(url,options)=>{
  fetches.push({url,options});
  if(url==='/api/gateway/provision')return {ok:true,json:async()=>({gateway:'G01',slots:provisionedSlots})};
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
 const h=harness();await h.login();const d=device('fake-one','47FD');h.select(d);h.get('slot').value='R01';h.get('expected').value='AB12';h.get('scanMode').value='standard';
 const connecting=h.get('connect').click();assert.equal(h.calls.length,1);await connecting;
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])),{filters:[{services:['heart_rate']}]});
 assert.deepEqual(d.calls,['gatt','heart_rate','heart_rate_measurement','subscribe']);
 d.emit();await flush();const s=h.api.live.get('R01');assert.equal(s.bpm,66);assert.match(s.state,/LIVE/);assert.equal(s.notifications,'รับ Notify แล้ว');
 const request=h.fetches.find(x=>x.url==='/api/ingest');const body=JSON.parse(request.options.body);
 assert.equal(body.readings[0].device_id,'opaque-one');assert.equal(body.readings[0].id,'R01');assert.equal(request.options.headers.Authorization,undefined);assert.equal(request.options.headers['X-STEVE-Gateway'],'1');assert.equal(request.options.credentials,'same-origin');
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
 assert.equal(s.bpm,null);assert.match(s.state,/STALE.*NO DATA/);d.gatt.disconnect();await flush();assert.equal(h.calls.length,1);assert.match(s.state,/DISCONNECTED/);assert.equal(s.measure.textContent,'NO DATA');assert.equal(h.api.live.get('R01').bpm,null);
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
 h.hide();h.tick(20001);await pending;h.document.hidden=false;h.document.listeners.visibilitychange();
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

test('G01 extra buttons prefill owner-confirmed R03/R04 suffixes without operator re-entry',async()=>{
 const slots=[{id:'R01',device_id:'opaque-one'},{id:'R02',device_id:'opaque-two'},
  {id:'R03',device_id:'opaque-three'},{id:'R04',device_id:'opaque-four'}];
 const h=harness(slots);await h.login();
 assert.equal(h.get('expected').value,'',"manual input starts empty");
 const find=(slot)=>h.get('extraBandControls').children.find(x=>x.textContent.startsWith('เชื่อม '+slot));
 const r03=find('R03'),r04=find('R04');
 assert.ok(r03&&r04,'optional authorized slots must be visible as direct buttons');
 assert.match(r03.textContent,/1121/);assert.match(r04.textContent,/CD42/);
 h.select(device('physical-three','1121'));r03.click();await drain();
 assert.equal(h.api.live.get('R03')?.device.name,'Xiaomi Smart Band 10 1121');
 assert.equal(h.api.live.get('R03')?.assignment,'opaque-three');
 assert.equal(h.get('expected').value,'',"one-tap does not require advanced input");
 h.select(device('physical-four','CD42'));find('R04').click();await drain();
 assert.equal(h.api.live.get('R04')?.device.name,'Xiaomi Smart Band 10 CD42');
 assert.equal(h.api.live.get('R04')?.assignment,'opaque-four');
 assert.equal(h.calls.length,2,'each authorized button requires its own chooser tap');
 assert.equal(h.api.bindings.get('R03')?.expected,'1121');
 assert.equal(h.api.bindings.get('R04')?.expected,'CD42');
});

test('a fresh browser page retains configured R03/R04 button suffixes but not BLE handles',async()=>{
 const slots=[{id:'R03',device_id:'opaque-three'},{id:'R04',device_id:'opaque-four'}];
 for(const [slot,suffix] of [['R03','1121'],['R04','CD42']]){
  const h=harness(slots);await h.login();
  assert.equal(h.api.bindings.size,0,'BLE handles must never be persisted');
  const button=h.get('extraBandControls').children.find(x=>x.textContent==='เชื่อม '+slot+' · '+suffix);
  assert.ok(button,'correct suffix offered after reload without entering it');
  h.select(device('physical-'+slot,suffix));button.click();await drain();
  assert.equal(h.api.live.get(slot)?.expected,suffix);
  assert.equal(h.api.live.get(slot)?.ready,true);
 }
});

test('R03/R04 direct buttons reject wrong Band, unauthorised slot and duplicate watch',async()=>{
 const slots=[{id:'R01',device_id:'opaque-one'},
  {id:'R03',device_id:'opaque-three'},{id:'R04',device_id:'opaque-four'}];
 const h=harness(slots);await h.login();
 const button=slot=>h.get('extraBandControls').children.find(x=>x.textContent.includes(slot));
 h.select(device('wrong-four','CD42'));button('R03').click();await drain();
 assert.equal(h.api.live.has('R03'),false);
 assert.match(h.get('bleStatus').textContent,/ไม่ตรงรหัส/);
 h.select(device('real-three','1121'));button('R03').click();await drain();
 assert.equal(h.api.live.get('R03')?.ready,true);
 h.select(device('real-three','1121'));button('R04').click();await drain();
 assert.equal(h.api.live.has('R04'),false);
 assert.equal(h.get('expected').value,'');
 const unauthorized=harness([{id:'R01',device_id:'opaque-one'}]);await unauthorized.login();
 assert.equal(unauthorized.get('extraBandControls').children.length,0);
});

test('slow HTTPS failure remains visible after newer notifications and isolates the other band',async()=>{
 for(const failure of ['network','timeout','http','rejected']){
  const h=harness();await h.login();const a=device(),b=device('two','CD34');await h.connect(a);await h.connect(b,'R02','CD34');
  let resolve,reject;h.reply(()=>new Promise((ok,no)=>{resolve=ok;reject=no;}));a.emit([6,61]);await drain();
  h.reply({ok:true,json:async()=>({accepted:1})});b.emit([6,72]);await drain();
  h.tick(1001);a.emit([6,62]);await drain();
  if(failure==='network'||failure==='timeout')reject({name:failure==='timeout'?'AbortError':'TypeError'});
  else resolve(failure==='http'?{ok:false,status:503}:{ok:true,json:async()=>({accepted:0})});
  await drain();const s=h.api.live.get('R01');
  assert.equal(s.bpm,null);assert.match(s.state,/SERVER REJECTED/);assert.ok(s.error);
  assert.equal(h.api.live.get('R02').bpm,72);assert.equal(b.gatt.connected,true);
  h.tick(1001);a.emit([6,63]);await drain();assert.equal(s.bpm,63);assert.equal(s.error,'');assert.match(s.state,/Server acknowledged/);
 }
});

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
  assert.match(h.get('slots').children.at(-1).children[4].children[1].textContent,/Manual action required/);
 }
});
test('R01 auto failure leaves R02 restored; background cancels in-progress auto connect',async()=>{
 const h=harness();await h.login();const a=device(),b=device('two','CD34');await h.connect(a);await h.connect(b,'R02','CD34');h.hide();await drain();
 a.gatt.connect=async()=>{throw {name:'NetworkError'};};foreground(h);await drain();assert.equal(h.api.live.has('R01'),false);assert.equal(h.api.live.get('R02').ready,true);
 h.hide();await drain();let resolve;b.gatt.connect=()=>new Promise(r=>resolve=r);foreground(h);await drain();h.hide();await drain();b.gatt.connected=true;resolve(b.gatt);await drain();assert.equal(h.api.live.size,0);assert.equal(b.gatt.connected,false);
});

// Battery telemetry remains disabled: every scan must request HR only.
test('HR-only Gateway does not request battery service or display battery',async()=>{
 const h=harness();await h.login();const a=device(),b=device('two','CD34');
 await h.connect(a);await h.connect(b,'R02','CD34','broad');
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls)),[{filters:[{services:['heart_rate']}]},{acceptAllDevices:true,optionalServices:['heart_rate']}]);
 a.emit([6,62]);b.emit([6,58]);await flush();
 assert.equal(h.api.live.get('R01').bpm,62);assert.equal(h.api.live.get('R02').bpm,58);
 for(const payload of h.fetches.filter(x=>x.url==='/api/ingest').map(x=>JSON.parse(x.options.body))){assert.equal('battery' in payload.readings[0],false);}
 assert.equal(h.get('slots').children.some(tile=>tile.children.some(child=>/BATTERY/i.test(child.textContent))),false);
});

test('quick R01/R02 taps preserve gesture and verify physical suffix',async()=>{
 const h=harness();await h.login();h.select(device('one','47FD'));let p=h.get('quickR01').click();assert.equal(h.calls.length,1);await p;
 h.select(device('two','A746'));p=h.get('quickR02').click();assert.equal(h.calls.length,2);await p;assert.equal(h.api.live.size,2);
 h.get('resetBle').click();await drain();assert.equal(h.calls.length,2);assert.equal(h.api.live.size,2);
});
test('expiry stops both bands, clears BPM and offers login without opening chooser',async()=>{
 const h=harness();await h.login();const a=device(),b=device('two','CD34');await h.connect(a);await h.connect(b,'R02','CD34');a.emit();b.emit();await drain();
 h.tick(36000001);await drain();assert.equal(h.api.live.size,0);assert.equal(h.get('loginFields').hidden,false);assert.equal(h.get('quickR01').disabled,true);assert.equal(h.calls.length,2);
 assert.equal(a.gatt.connected,false);assert.equal(b.gatt.connected,false);
});
test('server-revoked cookie clears live sessions instead of presenting unauthorized readings',async()=>{
 const h=harness();await h.login();const a=device();await h.connect(a);h.reply({ok:false,status:401});a.emit();await drain();
 assert.equal(h.api.live.size,0);assert.equal(h.get('loginFields').hidden,false);assert.equal(h.get('connect').disabled,true);
});

test('opt-in lock screen trial keeps existing BLE handle while hidden, records only fresh hidden acknowledgements',async()=>{
 const h=harness();await h.login();const band=device();await h.connect(band);
 band.emit([6,65]);await flush();
 h.get('lockTrial').click();
 h.hide();await flush();
 assert.equal(h.api.live.has('R01'),true,'experimental hidden path must not stop BLE by JS');
 assert.equal(band.gatt.connected,true);
 assert.equal(h.api.live.get('R01').bpm,null,'entering trial must clear prior value');
 h.tick(1500);await flush(); // Allow the existing per-Band 1-second upload throttle to elapse.
 band.emit([6,71]);await flush();
 assert.equal(h.api.live.get('R01').bpm,71,'only a new BLE event can restore value');
 const fresh=h.fetches.filter(x=>x.url==='/api/ingest').map(x=>JSON.parse(x.options.body).readings[0]);
 assert.equal(fresh.at(-1).hr,71,'new hidden sample uses actual measurement timestamp');
 h.document.hidden=false;h.document.listeners.visibilitychange();await flush();
 assert.match(h.get('lockTrialStatus').textContent,/BPM ระหว่างซ่อน 1 ครั้ง/);
 assert.match(h.get('lockTrialStatus').textContent,/Server ACK ระหว่างซ่อน 1 ครั้ง/);
});
test('opt-in lock screen without fresh data stays NO DATA; dim fallback restores normal background stop',async()=>{
 const h=harness();await h.login();const band=device();await h.connect(band);
 band.emit();await flush();h.get('lockTrial').click();h.hide();await flush();
 h.tick(16000);await flush();
 assert.equal(h.api.live.get('R01').bpm,null);
 h.document.hidden=false;h.document.listeners.visibilitychange();await flush();
 assert.match(h.get('lockTrialStatus').textContent,/BPM ระหว่างซ่อน 0 ครั้ง/);
 assert.match(h.get('lockTrialStatus').textContent,/Server ACK ระหว่างซ่อน 0 ครั้ง/);
 let dimRequested=false;
 h.context.navigator.bluetooth.setScreenDimEnabled=async enabled=>{dimRequested=enabled;};
 await h.get('dimScreen').click();
 assert.equal(dimRequested,true);
 h.hide();await flush();
 assert.equal(h.api.live.size,0,'normal foreground-only safeguard restored by fallback');
 assert.equal(band.gatt.connected,false);
});

test('G01 can provision R03 and R04 on one Bluefy page and keep four physical sessions separate',async()=>{
 const h=harness([{id:'R01',device_id:'opaque-one'},{id:'R02',device_id:'opaque-two'},
  {id:'R03',device_id:'opaque-three'},{id:'R04',device_id:'opaque-four'}]);
 await h.login();
 assert.equal(h.get('extraBandControls').children.length,2,'only authorized additional slots have controls');
 assert.equal(h.get('reservedSlotCards').children.length,3,'unpaired R03–R05 begin as NO DATA');
 const list=[['R01','AB12',69],['R02','CD34',81],['R03','EF12',93],['R04','CD56',103]];
 for(const [slot,suffix] of list)await h.connect(device('physical-'+slot,suffix),slot,suffix);
 assert.equal(h.api.live.size,4,'G01 does not enforce a two-device cap in JavaScript');
 assert.equal(h.get('reservedSlotCards').children.length,1,'paired R03/R04 are not falsely listed as vacant');
 for(const [slot,suffix,bpm] of list)h.api.live.get(slot).device.emit([6,bpm]);
 await flush();
 const samples=h.fetches.filter(x=>x.url==='/api/ingest')
  .map(x=>JSON.parse(x.options.body)).filter(x=>Number.isInteger(x.readings[0].hr));
 assert.equal(samples.length,4);
 for(const [slot,suffix,bpm] of list){
  assert.equal(h.api.live.get(slot).bpm,bpm);
  assert.ok(samples.some(x=>x.gateway==='G01'&&x.readings[0].id===slot&&x.readings[0].hr===bpm));
 }
 assert.equal(new Set(samples.map(x=>x.readings[0].device_id)).size,4);
 await h.api.stopped(h.api.live.get('R03'));
 h.api.live.get('R04').device.emit([6,104]);await flush();
 assert.equal(h.api.live.get('R04').bpm,104,'disconnecting R03 does not disrupt R04');
});

test('four LIVE watches: stale R03 can be reconnected alone without disturbing other slots or opening chooser',async()=>{
 const h=harness([{id:'R01',device_id:'opaque-one'},{id:'R02',device_id:'opaque-two'},
  {id:'R03',device_id:'opaque-three'},{id:'R04',device_id:'opaque-four'}]);
 await h.login();
 const bands=[['R01','47FD',64],['R02','A746',71],['R03','1121',82],['R04','CD42',92]];
 const devices=new Map();
 for(const [slot,suffix] of bands){
  const band=device('band-'+slot,suffix);devices.set(slot,band);h.select(band);
  if(slot==='R01'||slot==='R02')await h.get('quick'+slot).click();
  else {h.get('extraBandControls').children.find(x=>x.textContent==='เชื่อม '+slot+' · '+suffix).click();await drain();}
 }
 assert.equal(h.api.live.size,4);
 for(const [slot,,bpm] of bands)devices.get(slot).emit([6,bpm]);
 await drain();h.tick(1); // Overview is refreshed by the one-second UI interval.
 assert.equal(h.get('gatewayDevices').textContent,'4 เรือน');
 const oldR03=h.api.live.get('R03');
 h.tick(16001);await drain(); // All initial measurements expire, none may be mislabeled LIVE.
 assert.equal(h.get('gatewayDevices').textContent,'0 เรือน');
 assert.equal(oldR03.bpm,null);
 assert.equal(oldR03.retry.disabled,false,'stale watch must offer single-slot recovery');
 assert.match(oldR03.indicator.textContent,/NO DATA/);
 for(const [slot,,bpm] of bands.filter(x=>x[0]!=='R03'))devices.get(slot).emit([6,bpm]);
 await drain();h.tick(1);
 assert.equal(h.get('gatewayDevices').textContent,'3 เรือน');
 const before=h.calls.length;
 await oldR03.retry.click();await drain();
 assert.equal(h.calls.length,before,'recovery uses previously authorized live-page handle');
 const newR03=h.api.live.get('R03');
 assert.notEqual(newR03,oldR03);
 assert.equal(newR03.ready,true);
 assert.equal(newR03.bpm,null,'reconnect cannot invent BPM');
 for(const slot of ['R01','R02','R04']){
  assert.equal(h.api.live.get(slot).ready,true,'R03 restart must not stop '+slot);
  assert.equal(h.api.live.get(slot).device.gatt.connected,true);
 }
 devices.get('R03').emit([6,79]);await drain();h.tick(1);
 assert.equal(h.api.live.get('R03').bpm,79);
 assert.equal(h.get('gatewayDevices').textContent,'4 เรือน');
 assert.equal(h.get('gatewayUpload').textContent,'รับแล้ว 4 เรือน');
});

test('failed A scan exposes one-tap B scan without entering suffix or affecting other watches',async()=>{
 const h=harness([{id:'R01',device_id:'opaque-one'},{id:'R03',device_id:'opaque-three'}]);
 await h.login();
 const first=device('stable','47FD');h.select(first);await h.get('quickR01').click();
 first.emit([6,72]);await drain();
 h.select(()=>Promise.reject({name:'NotFoundError'}));
 const b=h.get('extraBandControls').children.find(x=>x.textContent==='เชื่อม R03 · 1121');
 await b.click();await drain();
 const failed=h.get('slots').children.at(-1);
 const broad=failed.children[7];
 assert.match(broad.textContent,/สแกน B/);
 assert.equal(broad.hidden,false);
 assert.equal(broad.disabled,false);
 assert.equal(h.get('expected').value,'','no manual suffix entry is needed');
 h.select(device('new-three','1121'));await broad.click();await drain();
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[2])),{acceptAllDevices:true,optionalServices:['heart_rate']});
 assert.equal(h.api.live.get('R03')?.ready,true);
 assert.equal(h.api.live.get('R01')?.ready,true);
 assert.equal(h.api.live.get('R01').bpm,72);
});

test('gateway distinguishes received BLE pulse from acknowledged latest pulse',async()=>{
 const h=harness();await h.login();
 let respond;
 h.reply(()=>new Promise(resolve=>{respond=resolve;}));
 const a=device('band-01','47FD');h.select(a);await h.get('quickR01').click();
 a.emit([6,65]);await drain();
 const s=h.api.live.get('R01');
 assert.match(s.indicator.textContent,/รอ Server ACK/);
 h.tick(1); // Overview updates periodically rather than on each BLE notification.
 assert.equal(h.get('gatewayUpload').textContent,'กำลังส่งข้อมูล');
 respond({ok:true,json:async()=>({accepted:1})});await drain();
 assert.match(s.indicator.textContent,/Server acknowledged/);
 h.tick(1100);a.emit([6,67]);await drain();
 assert.match(s.indicator.textContent,/รอ Server ACK|Server acknowledged/);
 h.tick(16000);assert.equal(s.bpm,null);
 assert.match(s.indicator.textContent,/NO DATA/);
 assert.equal(s.retry.disabled,false);
});

test('unprovisioned R03/R04 cannot open BLE chooser or pretend to be connected',async()=>{
 const h=harness();await h.login();
 assert.equal(h.get('extraBandControls').children.length,0);
 assert.match(h.get('extraBandHelp').textContent,/STEVE_SLOT_MAP_JSON/);
 await h.api.connectBand('R03','EF12','standard');
 assert.equal(h.calls.length,0);
 assert.equal(h.api.live.size,0);
});

test('opaque picker identifier cannot supply physical suffix even as a whole token',async()=>{
 const h=harness();await h.login();
 const d=device('deadbeef-AB12-0000');d.name='';
 await h.connect(d);
 assert.equal(h.api.live.size,0);
 assert.deepEqual(d.calls,[]);
 assert.match(h.get('simpleStatus').textContent,/ชื่อ/);
});

test('only accepted heart rate enables unnamed same-page recovery',async()=>{
 const h=harness();await h.login();const d=device();
 await h.connect(d);const s=h.api.live.get('R01');
 assert.equal(h.api.bindings.get('R01').verified,false);
 d.emit();await drain();assert.equal(h.api.bindings.get('R01').verified,true);
 await h.api.stopped(s);d.name='';
 h.context.navigator.bluetooth.getDevices=async()=>[d];
 await h.connect(null,'R01','AB12','known');
 assert.equal(h.api.live.get('R01')?.device,d);
});
test('logout removes prior slot controls and stale device references',async()=>{
 const h=harness();await h.login();await h.connect(device());
 await h.get('clear').click();
 assert.equal(h.get('slots').children.length,0);
 assert.equal(h.api.bindings.size,0);
});

test('subscription without first notification offers a single-slot retry',async()=>{
 const h=harness();await h.login();await h.connect(device());
 h.tick(15001);
 const s=h.api.live.get('R01');
 assert.equal(s.retry.disabled,false);
 assert.equal(s.measure.textContent,'NO DATA');
});


test('supervised enrollment quarantines Xiaomi and UUID names through off/on and confirmation',async()=>{
 for(const name of ['Xiaomi','550e8400-e29b-41d4-a716-446655440000','']){
  const h=harness();await h.login();const d=device();d.name=name;
  await h.connect(d,'R01','AB12','supervised');
  const s=h.api.live.get('R01'), uploads=()=>h.fetches.filter(x=>x.url==='/api/ingest');
  d.emit();s.verify.click();h.tick(16000);d.emit();s.verify.click();
  assert.equal(s.probe.phase,'quiet');
  h.tick(16000);s.verify.click();d.emit();
  assert.equal(uploads().length,0);assert.equal(h.api.bindings.size,0);
  s.verify.click();assert.equal(uploads().length,0);d.emit();await drain();
  assert.equal(uploads().length,1);
  await h.api.stopped(s);
  h.context.navigator.bluetooth.getDevices=async()=>[d];
  await h.connect(null,'R01','AB12','known');assert.equal(h.api.live.get('R01').device,d);
  const fresh=harness();await fresh.login();fresh.context.navigator.bluetooth.getDevices=async()=>[d];
  await fresh.connect(null,'R01','AB12','known');assert.equal(fresh.api.live.size,0);
 }
});
test('supervised scan rejects conflicting named band and cancels provisional disconnect without writes',async()=>{
 const h=harness();await h.login();
 await h.connect(device('wrong','FFFF'),'R01','AB12','supervised');assert.equal(h.api.live.size,0);
 const d=device();d.name='Xiaomi';await h.connect(d,'R01','AB12','supervised');d.emit();
 await h.api.stopped(h.api.live.get('R01'));assert.equal(h.api.bindings.size,0);
 assert.equal(h.fetches.some(x=>x.url==='/api/ingest'),false);
});

test('Broad picker visibility pause preserves other bands and recovers only stale streams',async()=>{
 const h=harness();await h.login();const a=device('one','47FD');await h.connect(a,'R01','47FD');a.emit();await drain();
 const original=h.api.live.get('R01');let resolve;
 h.select(()=>new Promise(r=>resolve=r));
 const pending=h.api.connectBand('R02','A746','broad');
 h.hide();assert.equal(a.gatt.connected,true);assert.equal(h.api.live.get('R01'),original);
 h.tick(16000);foreground(h);const b=device('two','A746');resolve(b);await pending;
 assert.equal(h.api.live.get('R01'),original);assert.equal(original.bpm,null);
 b.emit();await drain();h.tick(3001);await drain();
 assert.notEqual(h.api.live.get('R01'),original);assert.equal(b.gatt.connected,true);
 assert.equal(h.calls.length,2);
 a.emit();await drain();assert.equal(h.api.live.get('R01').bpm,66);
});

test('top R01 uses Broad scan and cancelled picker keeps fresh R02 connected',async()=>{
 const h=harness();await h.login();const b=device('two','A746');await h.connect(b,'R02','A746');b.emit();await drain();
 let reject;h.select(()=>new Promise((r,j)=>reject=j));const p=h.get('quickR01').click();
 assert.equal(h.calls.at(-1).acceptAllDevices,true);
 h.hide();assert.equal(b.gatt.connected,true);foreground(h);reject({name:'NotFoundError'});await p;
 h.tick(3001);await drain();assert.equal(b.gatt.connected,true);assert.equal(h.api.live.get('R02').device,b);
});

test('silent verified stream recovers automatically twice, preserves peers, and rearms after fresh ACK',async()=>{
 const h=harness();await h.login();const a=device(),b=device('two','CD34');
 await h.connect(a);await h.connect(b,'R02','CD34');a.emit();b.emit();await drain();
 const peer=h.api.live.get('R02');
 for(let i=0;i<2;i++){
  b.emit();await drain();h.tick(14000);b.emit();await drain();h.tick(7001);await drain();
  assert.equal(h.api.live.get('R02'),peer);assert.equal(h.api.live.get('R01').ready,true);
 }
 const silent=h.api.live.get('R01');
 b.emit();await drain();h.tick(14000);b.emit();await drain();h.tick(7001);await drain();
 assert.equal(h.api.live.get('R01'),silent);assert.equal(silent.bpm,null);
 a.emit();await drain();assert.equal(h.api.bindings.get('R01').staleRetries,0);
 b.emit();await drain();h.tick(14000);b.emit();await drain();h.tick(7001);await drain();
 assert.notEqual(h.api.live.get('R01'),silent);assert.equal(h.calls.length,2);
});
