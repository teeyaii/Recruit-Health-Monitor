import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../dashboard/live.html',import.meta.url),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const drain=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function harness(){
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,value:'',textContent:'',innerHTML:''});return nodes.get(id);};
 let reply=async()=>({ok:false,status:401});const timers=[];
 const context=vm.createContext({document:{getElementById:node},Date,fetch:(...args)=>reply(...args),setInterval:f=>timers.push(f)});
 vm.runInContext(script+'\nthis.api={snapshot,disconnect,draw,syncRoster};',context);
 return {node,context,reply:f=>{reply=f;},timers};
}
test('dashboard handles offline login without retaining the entered credential',async()=>{
 const h=harness();await drain();h.node('token').value='test-credential';h.reply(async()=>{throw Error('offline');});
 await h.node('login').onsubmit({preventDefault(){}});
 assert.equal(h.node('token').value,'');assert.match(h.node('summary').textContent,/ไม่สำเร็จ/);
});
test('offline logout clears cached alerts and counters; late snapshot cannot restore them',async()=>{
 const h=harness();await drain();
 vm.runInContext(`transportUp=true;rosterData={slots:[{id:'R01',code:'DEMO-R01',observation:'confusion_collapse_seizure'}]};draw({recruits:[{id:'R01',hr:70,timestamp:Date.now(),stale:false}]});`,h.context);
 let resolve;h.reply(()=>new Promise(r=>resolve=r));const pending=h.context.api.snapshot();
 h.reply(async()=>{throw Error('offline');});await h.node('logout').onclick();
 resolve({ok:true,json:async()=>({recruits:[{id:'R01',hr:70,timestamp:Date.now(),stale:false}]})});await pending;
 h.timers[0]();assert.equal(h.node('cards').innerHTML,'');assert.equal(h.node('emergencyAlerts').hidden,true);
 assert.equal(h.node('emergencyAlerts').innerHTML,'');assert.equal(h.node('statLive').textContent,'—');
 assert.match(h.node('summary').textContent,/session/);
});

test('cross-display roster sync updates urgency without rewriting operator draft',async()=>{
 const h=harness();await drain();
 vm.runInContext("rosterData={slots:[{id:'R01',code:'DEMO-R01',restriction:'none',observation:'none'}]};transportUp=true;draw({recruits:[{id:'R01',hr:70,timestamp:Date.now(),stale:false}]});",h.context);
 h.node('rosterCode').value='UNSAVED-DRAFT';
 h.reply(async()=>({ok:true,status:200,json:async()=>({slots:[{id:'R01',code:'DEMO-R01',restriction:'none',observation:'confusion_collapse_seizure',acknowledged:true}],ephemeral:true})}));
 await h.context.api.syncRoster();
 assert.equal(h.node('statPaused').textContent,1);
 assert.match(h.node('emergencyAlerts').innerHTML,/ยังเป็น EMERGENCY/);
 assert.equal(h.node('rosterCode').value,'UNSAVED-DRAFT');
});
