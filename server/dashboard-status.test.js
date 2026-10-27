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
 const profiles=[{id:'R01',restriction:'watch'},{id:'R02',observation:'confusion_collapse_seizure',acknowledged:true}];
 context.render(data,profiles);assert.equal(node('statLive').textContent,2);assert.equal(node('statWatch').textContent,1);assert.equal(node('statPaused').textContent,1);assert.doesNotMatch(node('cards').innerHTML,/BATTERY|UNKNOWN|80%/i);
 context.render(data,profiles,false);assert.equal(node('statLive').textContent,0);assert.equal(node('statNoData').textContent,2);assert.equal(node('statWatch').textContent,1);assert.equal(node('statPaused').textContent,1);assert.match(node('emergencyAlerts').innerHTML,/ยังเป็น EMERGENCY/);assert.match(node('emergencyAlerts').innerHTML,/disabled/);
 data.recruits.forEach(r=>r.timestamp=now-16000);
 context.render(data,profiles,true);assert.equal(node('statLive').textContent,0);assert.equal(node('statWatch').textContent,1);assert.equal(node('statPaused').textContent,1);
 assert.match(node('emergencyAlerts').innerHTML,/ยังเป็น EMERGENCY/);
 assert.doesNotMatch(node('cards').innerHTML,/>52 | >58 /);
});
