import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {freshBattery,BATTERY_TTL_MS} from './battery.js';
test('battery validation and expiration reject invalid metadata only',()=>{
 const now=2000000;
 for(const percent of [0,100])assert.equal(freshBattery({percent,timestamp:now},now).percent,percent);
 for(const b of [null,{}, {percent:-1,timestamp:now},{percent:101,timestamp:now},{percent:'50',timestamp:now},{percent:1.5,timestamp:now},{percent:50,timestamp:now+1},{percent:50,timestamp:now-BATTERY_TTL_MS-1}])assert.equal(freshBattery(b,now),null);
});
test('HTTP battery contract preserves legacy HR and rejects cross-slot metadata',async()=>{
 const port=30000+Math.floor(Math.random()*1000),base='http://127.0.0.1:'+port;
 const token='ci-battery-gateway-token-long-enough-123456';
 const proc=spawn(process.execPath,['index.js'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:String(port),STEVE_VIEWER_TOKEN:'ci-battery-viewer-token-long-enough-123456',STEVE_GATEWAY_TOKEN_G01:token,STEVE_SLOT_MAP_JSON:JSON.stringify({G01:{R01:'device-one',R02:'device-two'}})},stdio:'pipe'});
 const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
 try{
  let ready=false;for(let i=0;i<50;i++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await delay(50);}assert.ok(ready);
  const send=async readings=>(await fetch(base+'/api/ingest',{method:'POST',headers,body:JSON.stringify({gateway:'G01',readings})})).json();
  let now=Date.now();let r=await send([{id:'R01',device_id:'device-one',hr:52,timestamp:now,battery:{percent:82,timestamp:now}},{id:'R02',device_id:'device-two',hr:58,timestamp:now,battery:{percent:200,timestamp:now}}]);assert.equal(r.accepted,2);
  let snapshot=async()=> (await (await fetch(base+'/api/snapshot',{headers})).json()).recruits;
  let rows=await snapshot();assert.equal(rows[0].battery.percent,82);assert.equal(rows[1].battery,null);assert.equal(rows[1].hr,58);
  await delay(5);now=Date.now();r=await send([{id:'R01',device_id:'device-two',hr:90,timestamp:now,battery:{percent:7,timestamp:now}}]);assert.equal(r.accepted,0);
  r=await send([{id:'R01',device_id:'device-one',hr:53,timestamp:now},{id:'R02',device_id:'device-two',hr:59,timestamp:now,battery:{percent:20,timestamp:now-BATTERY_TTL_MS-1}}]);assert.equal(r.accepted,2);
  rows=await snapshot();assert.equal(rows[0].battery.percent,82);assert.equal(rows[0].hr,53);assert.equal(rows[1].battery,null);
 }finally{proc.kill();}
});
