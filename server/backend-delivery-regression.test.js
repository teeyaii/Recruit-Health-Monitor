// STEVE 2.0 independent backend delivery/security regression. SIMULATED ONLY.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {deliveryLab,slots} from './backend-delivery-fixture.mjs';

const snapshot=async(h,cookie)=>(await h.req('/api/snapshot',{cookie})).data.recruits.slice(0,10);
const streamTen=async(h,phones,ids=slots)=>Promise.all(ids.map(id=>h.ingest(Number(id.slice(1))<=5?'G01':'G02',phones[Number(id.slice(1))<=5?'G01':'G02'],[h.sample(id)])));
for(const silent of [slots.slice(0,5),slots.slice(5),['R08']])test('SIMULATED: silent '+silent.join(',')+' cannot corrupt peers; ten simultaneous reconnects recover independently',{timeout:10000},async t=>{
 const h=await deliveryLab(t),viewer=await h.login('viewer'),phones={G01:await h.phone('G01'),G02:await h.phone('G02')};
 for(const r of await streamTen(h,phones)){assert.equal(r.status,200);assert.equal(r.data.accepted,1);}
 const originals=await snapshot(h,viewer);await h.advance(15001);
 for(const r of await streamTen(h,phones,slots.filter(id=>!silent.includes(id))))assert.equal(r.data.accepted,1);
 // A valid heartbeat refreshes gateway liveness, never its silent peers' readings.
 for(const gateway of ['G01','G02'])assert.equal((await h.ingest(gateway,phones[gateway],[])).data.accepted,0);
 for(const row of await snapshot(h,viewer)){
  assert.equal(row.gatewayOnline,true);
  if(silent.includes(row.id)){assert.equal(row.state,'STALE');assert.equal(row.hr,null);assert.equal(row.timestamp,originals.find(r=>r.id===row.id).timestamp);}
  else{assert.equal(row.state,'CONNECTED');assert.equal(row.hr,70+slots.indexOf(row.id));}
 }
 await h.advance(120001);
 const replacements={G01:await h.phone('G01'),G02:await h.phone('G02')};
 for(const r of await streamTen(h,replacements))assert.equal(r.data.accepted,1);
 const recovered=await snapshot(h,viewer);assert.ok(recovered.every(r=>r.state==='CONNECTED'&&r.timestamp===h.now()));
 await h.advance(1);
 for(const r of await streamTen(h,phones))assert.equal(r.status,409,'old owners cannot reclaim replacement-owned slots');
});

async function configure(h,medic){
 assert.equal((await h.req('/api/roster/R01',{method:'PUT',cookie:medic,body:{version:0,code:'DELIVERY_QA',restriction:'none',observation:'none'}})).status,200);
 assert.equal((await h.req('/api/private-profile/R01',{method:'PUT',cookie:medic,body:{version:0,confirmed:true,weightKg:null,heightCm:null,conditions:'PRIVATE_TEST_MARKER',reviewThresholdBpm:150,reviewThresholdConfirmed:true}})).status,200);
 assert.equal((await h.req('/api/training',{method:'PUT',cookie:medic,body:{version:0,phase:'training'}})).status,200);
}

test('SIMULATED: pending automatic case reaches simultaneous viewers during outage and reconciles after SSE reconnect/restart',{timeout:15000},async t=>{
 const h=await deliveryLab(t),medic=await h.login('medic'),v1=await h.login('viewer'),v2=await h.login('viewer'),phone=await h.phone('G01');
 await configure(h,medic);const a=await h.stream(v1),b=await h.stream(v2);
 assert.equal((await a.next()).recruits[0].autoCheck,false);assert.equal((await b.next()).recruits[0].autoCheck,false);
 await h.storageOutage(true);
 for(let i=0;i<6;i++){await h.advance(7000);const r=await h.ingest('G01',phone,[h.sample('R01',{hr:160})]);assert.equal(r.status,i===5?503:200);assert.equal(r.data.accepted,1);}
 const alert=m=>m.recruits[0].autoCheck;
 const [first,second]=await Promise.all([a.until(alert),b.until(alert)]);
 assert.ok(first&&second);assert.deepEqual(first.recruits[0].autoAlert,second.recruits[0].autoAlert);
 assert.doesNotMatch(JSON.stringify(first),/PRIVATE_TEST_MARKER|reviewThresholdBpm|medications|device_id/);
 assert.equal((await h.req('/api/medic-reviews/summary',{cookie:v1})).data.pending,1);
 const before=(await h.req('/api/medic-reviews/R01',{cookie:medic})).data.review;
 assert.equal(before.status,'pending');assert.equal(before.autoEvidence.sampleCount,6);
 const duplicate=await h.ingest('G01',phone,[h.sample('R01',{hr:160})]);assert.equal(duplicate.data.accepted,0);
 assert.equal((await h.req('/api/medic-reviews/R01',{cookie:medic})).data.review.version,before.version);
 a.close();await h.advance(15001);
 const reconnect=await h.stream(v1),resumed=await reconnect.next();
 assert.equal(resumed.recruits[0].hr,null);assert.equal(resumed.recruits[0].state,'STALE');assert.equal(resumed.recruits[0].autoCheck,true);
 assert.deepEqual(resumed.recruits[0].autoAlert,first.recruits[0].autoAlert,'snapshot replay preserves the authoritative case evidence');
 await h.storageOutage(false);
 let persisted=false;for(let i=0;i<100;i++){if((await h.stored()).medicReviews.R01?.status==='pending'){persisted=true;break;}await delay(20);}
 assert.equal(persisted,true,'background retry confirms case durability');
 await h.restart();assert.equal((await h.req('/api/snapshot',{cookie:v1})).status,401);
 const after=await h.login('viewer'),newStream=await h.stream(after),restored=await newStream.next();
 assert.equal(restored.recruits[0].hr,null);assert.equal(restored.recruits[0].autoCheck,true);assert.deepEqual(restored.recruits[0].autoAlert,first.recruits[0].autoAlert);
 assert.equal((await h.req('/api/medic-reviews/summary',{cookie:after})).data.pending,1);
});

test('SIMULATED: unauthorized SSE and private APIs denied; logout and absolute expiry terminate only affected subscriptions',{timeout:10000},async t=>{
 const h=await deliveryLab(t),v1=await h.login('viewer'),v2=await h.login('viewer'),medic=await h.login('medic'),phone=await h.phone('G01');
 assert.equal((await h.req('/api/events')).status,401);
 assert.equal((await h.req('/api/events',{bearer:h.token.G01})).status,403);
 assert.equal((await h.req('/api/events',{cookie:phone})).status,401);
 const share=await h.req('/api/commander/share',{method:'POST',cookie:medic});assert.equal(share.status,200);
 const commander=(await h.req('/api/commander/auth',{method:'POST',body:{token:share.data.token}})).cookie;
 assert.equal((await h.req('/api/events',{cookie:commander})).status,401);
 for(const path of ['/api/private-profile/R01','/api/medic-reviews/R01','/api/archive/R01?hours=4']){
  for(const options of [{cookie:v1},{bearer:h.token.G01},{cookie:phone},{cookie:commander}]){
   const r=await h.req(path,options);assert.ok([401,403].includes(r.status));assert.doesNotMatch(JSON.stringify(r.data),/reviewThresholdBpm|medications|conditions|device_id/);
  }
 }
 const a=await h.stream(v1),b=await h.stream(v2);await a.next();await b.next();
 assert.equal((await h.req('/api/logout',{method:'POST',cookie:v1})).status,200);
 assert.equal(await a.until(()=>false),null,'revoked session closes its existing SSE');
 assert.equal((await h.req('/api/events',{cookie:v1})).status,401);
 await h.advance(1);assert.equal((await h.ingest('G01',phone,[h.sample('R01')])).data.accepted,1);
 assert.equal((await b.until(m=>m.recruits[0].timestamp===h.now())).recruits[0].hr,70,'other viewer remains subscribed');
 await h.advance(8*60*60*1000+1);
 assert.equal(await b.until(()=>false),null,'expired session closes without sending another health snapshot');
 assert.equal((await h.req('/api/events',{cookie:v2})).status,401);
});
