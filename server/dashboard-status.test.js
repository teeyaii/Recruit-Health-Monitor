import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../dashboard/live.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function view(){
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',hidden:false});return nodes.get(id);};
 const context={document:{getElementById:node},Date,refreshMedicPending:()=>{}};vm.createContext(context);
 vm.runInContext(script.slice(0,script.indexOf('byId("emergencyAlerts").onclick'))+'\nthis.render=(data,profiles,up=true)=>{rosterData={slots:profiles};transportUp=up;draw(data);};',context);
 return {node,context};
}
test('WATCH and acknowledged EMERGENCY persist on signal loss without battery display',()=>{
 const {node,context}=view(),now=Date.now();const data={recruits:[{id:'R01',hr:52,timestamp:now,stale:false,gateway:'G01'},{id:'R02',hr:58,timestamp:now,stale:false,gateway:'G01'}]};
 const profiles=[{id:'R01',code:'DEMO-R01',restriction:'watch'},{id:'R02',code:'DEMO-R02',observation:'confusion_collapse_seizure',acknowledged:true}];
 context.render(data,profiles);assert.equal(node('statLive').textContent,2);assert.equal(node('statWatch').textContent,1);assert.equal(node('statPaused').textContent,1);assert.doesNotMatch(node('cards').innerHTML,/BATTERY|UNKNOWN|80%/i);
 context.render(data,profiles,false);assert.equal(node('statLive').textContent,0);assert.equal(node('statNoData').textContent,2);assert.equal(node('statWatch').textContent,1);assert.equal(node('statPaused').textContent,1);assert.match(node('emergencyAlerts').innerHTML,/ยังเป็น EMERGENCY/);assert.match(node('emergencyAlerts').innerHTML,/disabled/);
 data.recruits.forEach(r=>r.timestamp=now-16000);
 context.render(data,profiles,true);assert.equal(node('statLive').textContent,0);assert.equal(node('statWatch').textContent,1);assert.equal(node('statPaused').textContent,1);
 assert.match(node('emergencyAlerts').innerHTML,/ยังเป็น EMERGENCY/);
 assert.doesNotMatch(node('cards').innerHTML,/>52 | >58 /);
});

test('15-slot capacity is not 15 signal losses: only registered high-risk wearers enter KPI denominators',()=>{
 const {node,context}=view(),now=Date.now();
 const recruits=Array.from({length:15},(_,i)=>({id:'R'+String(i+1).padStart(2,'0'),hr:i<3?70+i:null,timestamp:i<3?now:null,stale:i>=3,gateway:'G01'}));
 const profiles=[{id:'R01',code:'DEMO-R01',restriction:'none',observation:'none'},{id:'R02',code:'DEMO-R02',restriction:'watch',observation:'none'}];
 context.render({recruits},profiles);
 assert.equal(node('statTotal').textContent,2);
 assert.equal(node('statLive').textContent,2);
 assert.equal(node('statNoData').textContent,0);
 assert.equal(node('statUnregistered').textContent,13);
 assert.match(node('cohortNotice').textContent,/1 ช่องที่ยังไม่ลงทะเบียน/);
 assert.match(node('cards').innerHTML,/R03/);
 assert.doesNotMatch(node('cards').innerHTML,/R04/);
 recruits[1].hr=null;recruits[1].stale=true;recruits[1].timestamp=now-16000;
 context.render({recruits},profiles);
 assert.equal(node('statLive').textContent,1);
 assert.equal(node('statNoData').textContent,1);
 assert.equal(node('statWatch').textContent,1,'WATCH persists despite missing HR');
});

test('cards show recruit code above its R-slot and preserve R01–R15 numerical ordering',()=>{
 const {node,context}=view(),now=Date.now();
 const profiles=[{id:'R10',code:'UNIT010',restriction:'none',observation:'none'},
                 {id:'R02',code:'B015',restriction:'watch',observation:'none'},
                 {id:'R01',code:'A001',restriction:'none',observation:'none'}];
 const data={recruits:[{id:'R10',hr:82,timestamp:now,stale:false},
                      {id:'R02',hr:68,timestamp:now,stale:false},
                      {id:'R01',hr:63,timestamp:now,stale:false}]};
 context.render(data,profiles);
 const cards=node('cards').innerHTML;
 assert.match(cards,/ผู้สวม/);
 const a=cards.indexOf('card-personnel-code">A001'),b=cards.indexOf('card-personnel-code">B015'),c=cards.indexOf('card-personnel-code">UNIT010');
 assert.ok(a>=0&&b>a&&c>b,'cards sorted by R01, R02, R10 regardless of incoming order');
 assert.ok(cards.indexOf('ช่อง R01',a)>a);
 assert.ok(cards.indexOf('ช่อง R01',a)<b,'R01 slot shown directly below A001 before next card');
 assert.ok(cards.indexOf('ช่อง R02',b)>b);
 assert.equal(node('statTotal').textContent,3);
 assert.equal(node('statLive').textContent,3);
 assert.equal(node('statWatch').textContent,1,'code presentation does not change clinical urgency');
});

test('compact alert retains urgent instruction, count, R-slot and acknowledgement controls',()=>{
 const {node,context}=view(),now=Date.now();
 const profiles=[{id:'R01',code:'a001',observation:'confusion_collapse_seizure',acknowledged:false},
                 {id:'R02',code:'a002',observation:'confusion_collapse_seizure',acknowledged:true}];
 context.render({recruits:[{id:'R01',hr:null,timestamp:now-20000,stale:true},
                           {id:'R02',hr:66,timestamp:now,stale:false}]},profiles);
 const alert=node('emergencyAlerts');
 assert.equal(alert.hidden,false);
 assert.match(alert.innerHTML,/class="emergency-title">EMERGENCY \(2\)/);
 assert.match(alert.innerHTML,/หยุดกิจกรรมและแจ้งเจ้าหน้าที่แพทย์ทันที/);
 assert.match(alert.innerHTML,/class="emergency-row">R01/);
 assert.match(alert.innerHTML,/class="emergency-row">R02/);
 assert.match(alert.innerHTML,/data-ack-slot="R01"/);
 assert.match(alert.innerHTML,/ยังเป็น EMERGENCY/);
 assert.match(alert.innerHTML,/disabled/);
 assert.equal(node('statPaused').textContent,2);
 assert.equal(node('statNoData').textContent,1);
});

test('compact cards keep risk separate from live, missing and disconnected telemetry',()=>{
 const {node,context}=view();
 for(const up of [true,false])for(const missing of [false,true]){
  const profiles=[{id:'R01',code:'NORMAL',restriction:'none'},
   {id:'R02',code:'WATCH',restriction:'watch'},
   {id:'R03',code:'EMERGENCY',restriction:'watch',observation:'confusion_collapse_seizure'}];
  const data={recruits:profiles.map(p=>({id:p.id,hr:missing?null:75,timestamp:missing?null:Date.now(),stale:missing}))};
  context.render(data,profiles,up);
  const cards=node('cards').innerHTML.match(/<article[\s\S]*?<\/article>/g);
  assert.match(cards[0],new RegExp('data-risk="'+(up&&!missing?'normal':'unavailable')+'"'));
  assert.match(cards[1],/data-risk="watch"/);
  assert.match(cards[2],/data-risk="emergency"/);
  assert.match(cards[2],/หยุดกิจกรรมและเรียกทีมแพทย์/);
  for(const card of cards){
   assert.doesNotMatch(card,/MONITORING NOT CONFIGURED|clinical approval|Gateway:|วินาทีที่แล้ว/);
   const signal=!up?'DISCONNECTED':missing?'NO DATA':'LIVE';
   assert.equal(card.split(signal).length-1,1,'one connectivity label');
   assert.match(card,up&&!missing?/75 <small>BPM/:/— <small>BPM/);
  }
 }
});

test('WATCH stays primary alongside automatic pause and no BPM creates no emergency',()=>{
 const {node,context}=view();
 context.render({recruits:[{id:'R01',hr:null,stale:true,autoCheck:true}]},[{id:'R01',code:'A001',restriction:'watch'}]);
 assert.match(node('cards').innerHTML,/data-risk="watch"/);
 assert.match(node('cards').innerHTML,/status-chip">WATCH/);
 assert.match(node('cards').innerHTML,/PAUSE \/ CHECK/);
 assert.equal(node('emergencyAlerts').hidden,true);
});
