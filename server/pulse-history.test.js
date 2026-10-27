import test from "node:test";
import assert from "node:assert/strict";
import {PulseHistory,MAX_POINTS,WINDOW_MS,STEP_MS} from "./pulse-history.js";
import {RosterStore} from "./roster.js";
test("live sample history keeps at most 4h at 5s resolution, with sparse gaps",()=>{
 const h=new PulseHistory(),now=Date.now(),start=now-WINDOW_MS;
 assert.equal(h.record("R01",70,start-1,now),false,"too-old packet");
 for(let i=0;i<MAX_POINTS;i++)h.record("R01",60+i%25,start+i*STEP_MS,now);
 assert.ok(h.size()<=MAX_POINTS);
 const points=h.get("R01",now);
 assert.equal(points.length,MAX_POINTS);
 assert.deepEqual(points[0],[start,60]);
 assert.deepEqual(points.at(-1),[start+(MAX_POINTS-1)*STEP_MS,60+(MAX_POINTS-1)%25]);
 assert.equal(h.get("R02").length,0,"NO DATA does not allocate an empty slot");
 assert.equal(h.record("R02",null,now,now),false);
 h.clear("R01");assert.equal(h.size(),0);
});
test("duplicate and invalid readings never create points or fake intervals",()=>{
 const h=new PulseHistory(),now=Date.now(),start=now-20000;
 assert.equal(h.record("R01",70,start,now),false,"stale packet");
 assert.equal(h.record("R01",70,now-10000,now),true);
 assert.equal(h.record("R01",71,now-9999,now),false,"same five-second bucket");
 assert.equal(h.record("R01",250,now,now),false);
 assert.equal(h.record("R01",80,now,now),true);
 assert.equal(h.get("R01",now).length,2);
 assert.equal(h.record("R20",78,now,now),false);
 assert.deepEqual(h.get("R20",now),[]);
});
test("training timeline returns actual operator-entered phases, not inferred training or resting",()=>{
 const store=new RosterStore();
 const now=Date.now(),since=now-WINDOW_MS;
 assert.deepEqual(store.getTrainingTimeline(since,now),[]);
 store.setGroupPhase({phase:"training",version:0},"trainer");
 store.setGroupPhase({phase:"hourly_rest",version:1},"medic");
 const events=store.getTrainingTimeline(since,Date.now());
 assert.equal(events.length,2);
 assert.deepEqual(events.map(e=>e.phase),["training","hourly_rest"]);
 assert.ok(events.every(e=>e.at>=since));
});
