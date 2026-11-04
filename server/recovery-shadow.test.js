import test from "node:test";
import assert from "node:assert/strict";
import {describeRecoveryShadow} from "./recovery-shadow.js";

const start=1793100000000,now=start+4*60000+1000;
const events=[{at:start-10*60000,phase:"training"},{at:start,phase:"hourly_rest"}];
const points=(early=150,late=125)=>Array.from({length:35},(_,i)=>{
 const at=start+i*7000;return [at,at<start+120000?early:late];
});

test("Phase 2 shadow compares observed medians during explicit training to rest and never alerts",()=>{
 const result=describeRecoveryShadow(points(),events,now,72);
 assert.equal(result.status,"observed");
 assert.equal(result.mode,"shadow_research_only");
 assert.equal(result.phaseScope,"cohort");
 assert.equal(result.firstMedianBpm,150);
 assert.equal(result.lateMedianBpm,125);
 assert.equal(result.changeBpm,-25);
 assert.equal(result.baselineDifferenceBpm,53);
 assert.equal(result.clinicalAlert,false);
 assert.equal(result.startAt,start);
 assert.ok(result.firstWindowSamples>=3&&result.lateWindowSamples>=3);
});

test("baseline is optional: never invent a personalized baseline or risk verdict",()=>{
 const noBaseline=describeRecoveryShadow(points(),events,now);
 assert.equal(noBaseline.status,"observed");
 assert.equal(noBaseline.baselineDifferenceBpm,null);
 assert.equal(noBaseline.clinicalAlert,false);
 assert.equal(describeRecoveryShadow(points(),events,now,999).baselineDifferenceBpm,null);
});

test("missing or unconfirmed training to rest transition fails closed",()=>{
 for(const transitions of [[],[{at:start,phase:"hourly_rest"}],
  [{at:start-60000,phase:"no_training"},{at:start,phase:"hourly_rest"}],
  [...events,{at:start+2*60000,phase:"no_training"}],
  [{at:start-60000,phase:"training"},{at:start,phase:"no_training"}]]){
  const result=describeRecoveryShadow(points(),transitions,now);
  assert.equal(result.status,"not_applicable");
  assert.equal(result.changeBpm,null);
 }
});

test("before four minutes, Phase 2 never labels incomplete recovery as observed",()=>{
 const result=describeRecoveryShadow(points(),events,start+2*60000);
 assert.equal(result.status,"collecting");
 assert.equal(result.changeBpm,null);
});

test("insufficient samples never become a recovery claim",()=>{
 const result=describeRecoveryShadow([[start+10000,150],[start+90000,142],
  [start+200000,120]],events,now,80);
 assert.equal(result.status,"insufficient");
 assert.equal(result.firstMedianBpm,null);
 assert.equal(result.baselineDifferenceBpm,null);
});

test("signal interruption and implausible jumps prevent a comparison",()=>{
 const interrupted=points().filter(p=>p[0]<start+90000||p[0]>=start+170000);
 const gap=describeRecoveryShadow(interrupted,events,now,80);
 assert.equal(gap.status,"check_signal");
 assert.equal(gap.changeBpm,null);
 const spike=points().map((p,i)=>i===10?[p[0],210]:p);
 const sudden=describeRecoveryShadow(spike,events,now,80);
 assert.equal(sudden.status,"check_signal");
 assert.equal(sudden.changeBpm,null);
});

test("old measurements before a new rest phase cannot contaminate the new window",()=>{
 const earlier=Array.from({length:35},(_,i)=>[start-10*60000+i*7000,180]);
 const r=describeRecoveryShadow([...earlier,...points()],events,now,70);
 assert.equal(r.status,"observed");
 assert.equal(r.firstMedianBpm,150);
 assert.equal(r.lateMedianBpm,125);
 assert.equal(r.firstWindowSamples+r.lateWindowSamples,35);
});

test("no synthetic points and rest records older than research window expire",()=>{
 assert.equal(describeRecoveryShadow([],events,now).status,"insufficient");
 const old=describeRecoveryShadow(points(),events,start+31*60000);
 assert.equal(old.status,"window_expired");
 assert.equal(old.clinicalAlert,false);
});

test("repeated or invalid readings cannot increase sample counts or inject health context",()=>{
 const duplicate=[...points(),...points(),[start+100000,NaN],[start+110000,999]];
 const r=describeRecoveryShadow(duplicate,events,now);
 assert.equal(r.status,"observed");
 assert.equal(r.firstWindowSamples+r.lateWindowSamples,35);
 assert.equal("medications" in r,false);
 assert.equal("conditions" in r,false);
 assert.equal("risk" in r,false);
});
