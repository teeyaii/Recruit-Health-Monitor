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
 vm.runInContext(script+'\nthis.api={snapshot,disconnect,draw};',context);
 return {node,context,reply:f=>{reply=f;},timers};
}
test('dashboard handles offline login without retaining the entered credential',async()=>{
 const h=harness();await drain();h.node('token').value='test-credential';h.reply(async()=>{throw Error('offline');});
 await h.node('login').onsubmit({preventDefault(){}});
 assert.equal(h.node('token').value,'');assert.match(h.node('summary').textContent,/ไม่สำเร็จ/);
});
test('offline logout clears cached alerts and counters; late snapshot cannot restore them',async()=>{
 const h=harness();await drain();
 vm.runInContext(`transportUp=true;rosterData={slots:[{id:'R01',observation:'confusion_collapse_seizure'}]};draw({recruits:[{id:'R01',hr:70,timestamp:Date.now(),stale:false}]});`,h.context);
 let resolve;h.reply(()=>new Promise(r=>resolve=r));const pending=h.context.api.snapshot();
 h.reply(async()=>{throw Error('offline');});await h.node('logout').onclick();
 resolve({ok:true,json:async()=>({recruits:[{id:'R01',hr:70,timestamp:Date.now(),stale:false}]})});await pending;
 h.timers[0]();assert.equal(h.node('cards').innerHTML,'');assert.equal(h.node('emergencyAlerts').hidden,true);
 assert.equal(h.node('emergencyAlerts').innerHTML,'');assert.equal(h.node('statLive').textContent,'—');
 assert.match(h.node('summary').textContent,/session/);
});
