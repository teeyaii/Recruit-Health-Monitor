// SIMULATED ONLY. Mandatory regression: valid-looking replay after process restart.
import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryLab,slots} from './backend-delivery-fixture.mjs';

test('SIMULATED: restart rejects preboot samples from both gateways, heartbeat cannot revive them, fresh ten-slot streams resume',{timeout:10000},async t=>{
 const h=await deliveryLab(t),oldPhones={G01:await h.phone('G01'),G02:await h.phone('G02')};
 const packets=slots.map(id=>h.sample(id));
 const upload=(phones,readings)=>Promise.all(readings.map(sample=>{
  const gateway=Number(sample.id.slice(1))<=5?'G01':'G02';return h.ingest(gateway,phones[gateway],[sample]);
 }));
 for(const r of await upload(oldPhones,packets)){assert.equal(r.status,200);assert.equal(r.data.accepted,1);}
 await h.restart();
 assert.equal((await h.ingest('G01',oldPhones.G01,[packets[0]])).status,401);
 const phones={G01:await h.phone('G01'),G02:await h.phone('G02')},viewer=await h.login('viewer');
 const replay=await upload(phones,packets);
 assert.ok(replay.every(r=>r.status===200));
 assert.deepEqual(replay.map(r=>r.data.accepted),Array(10).fill(0),'restart must not reset accepted-frame replay protection');
 for(const gateway of ['G01','G02'])assert.equal((await h.ingest(gateway,phones[gateway],[])).data.accepted,0);
 const afterHeartbeat=(await h.req('/api/snapshot',{cookie:viewer})).data.recruits.slice(0,10);
 assert.ok(afterHeartbeat.every(r=>r.hr===null&&r.state!=='CONNECTED'&&r.gatewayOnline),'online is transport liveness, not accepted measurement freshness');
 await h.advance(1000);
 for(const r of await upload(phones,slots.map(id=>h.sample(id))))assert.equal(r.data.accepted,0,'clock-lead boundary is inclusive');
 await h.advance(1);
 for(const r of await upload(phones,slots.map(id=>h.sample(id))))assert.equal(r.data.accepted,1,'new stream resumes without permanent quarantine');
 assert.ok((await h.req('/api/snapshot',{cookie:viewer})).data.recruits.slice(0,10).every(r=>r.state==='CONNECTED'&&r.timestamp===h.now()));
});
