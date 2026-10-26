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
 const nodes=new Map(), intervals=[];let clock=100000;
 const document={hidden:false,listeners:{},getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement(){return new Element();},addEventListener(n,f){this.listeners[n]=f;}};
 const window={isSecureContext:true,addEventListener(){}};
 const calls=[],fetches=[];let selection=null, uploadResponse={ok:true,status:200,json:async()=>({accepted:1})};
 const bluetooth={requestDevice(options){calls.push(options);return typeof selection==='function'?selection():Promise.resolve(selection);}};
 class Clock extends Date {static now(){return clock;}}
 const context={document,window,navigator:{bluetooth},Date:Clock,Map,Set,AbortController,setInterval(f){intervals.push(f);},setTimeout(){return 1;},clearTimeout(){},fetch:async(url,options)=>{
  fetches.push({url,options});
  if(url==='/api/gateway/provision')return {ok:true,json:async()=>({gateway:'G01',slots:[{id:'R01',device_id:'opaque-one'},{id:'R02',device_id:'opaque-two'}]})};
  return typeof uploadResponse==='function'?uploadResponse():uploadResponse;
 }};
 vm.createContext(context);
 vm.runInContext(script+'\nthis.api={connectBand,safeError,decodeHeartRate,live,bindings,stopped,upload};',context);
 const get=id=>document.getElementById(id);
 return {context,document,window,get,calls,fetches,api:context.api,select(d){selection=d;},reply(r){uploadResponse=r;},tick(ms){clock+=ms;intervals.forEach(f=>f());},async login(){get('gateway').value='G01';get('token').value='test-only-credential-with-32-characters';await get('load').click();},async connect(d,slot='R01',suffix='AB12',mode='standard'){selection=d;await context.api.connectBand(slot,suffix,mode);},hide(){document.hidden=true;document.listeners.visibilitychange();}};
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
