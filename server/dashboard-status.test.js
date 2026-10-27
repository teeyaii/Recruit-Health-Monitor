import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../dashboard/live.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function view(){
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',hidden:false});return nodes.get(id);};
 const context={document:{getElementById:node},Date};vm.createContext(context);
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
