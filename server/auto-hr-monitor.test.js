import test from "node:test";
import assert from "node:assert/strict";
import {AutoHRMonitor} from "./auto-hr-monitor.js";
import {MedicReviews} from "./medic-review.js";
import {PrivateProfiles} from "./private-profiles.js";

test("registered and clinically confirmed threshold is required; no default auto case",()=>{
 const p=new PrivateProfiles();
 let profile=p.get("R01","UNIT001");
 assert.equal(profile.reviewThresholdBpm,null);
 assert.equal(profile.reviewThresholdConfirmed,false);
 assert.throws(()=>p.update("R01","UNIT001",{version:0,confirmed:true,
  weightKg:null,heightCm:null,conditions:"",reviewThresholdBpm:150}),{status:422});
 profile=p.update("R01","UNIT001",{version:0,confirmed:true,
  weightKg:null,heightCm:null,conditions:"",reviewThresholdBpm:150,reviewThresholdConfirmed:true});
 assert.equal(profile.reviewThresholdBpm,150);
 const restored=new PrivateProfiles();restored.load(p.export());
 assert.equal(restored.get("R01","UNIT001").reviewThresholdBpm,150);
});

test("sustained accepted HR opens one automatic case, never claims medical diagnosis",()=>{
 const auto=new AutoHRMonitor(),reviews=new MedicReviews(),start=1793100000000;
 let fires=0;
 for(let i=0;i<15;i++){
  const result=auto.ingest("R01","UNIT001",160,start+i*7000,150,{training:true,real:true});
  if(result.trigger){
   fires++;
   const r=reviews.autoRequest("R01","UNIT001","high_sustained",start+i*7000);
   assert.equal(r.created,true);assert.equal(r.review.openedBy,"system");
   assert.equal(r.review.status,"pending");
   assert.match(result.advice,/พักกิจกรรมและตรวจผู้สวมทันที/);
  }
 }
 assert.equal(fires,1);
 assert.equal(reviews.autoRequest("R01","UNIT001","high_sustained").created,false);
 assert.equal(reviews.get("R01","UNIT001").status,"pending");
 const restored=new MedicReviews();restored.load(reviews.export());
 assert.equal(restored.get("R01","UNIT001").openedBy,"system");
});

test("no automatic medical review on simulation, rest, missing criteria or a PPG spike",()=>{
 const now=1793100000000;
 for(const props of [{training:false,real:true},{training:true,real:false},{training:true,real:true,limit:null}]){
  const auto=new AutoHRMonitor(),results=[];
  for(let i=0;i<12;i++)results.push(auto.ingest("R01","UNIT001",175,now+i*7000,props.limit??(Object.hasOwn(props,"limit")?null:150),props));
  assert.equal(results.some(r=>r.trigger),false);
 }
 const auto=new AutoHRMonitor();
 auto.ingest("R01","UNIT001",120,now,150,{training:true,real:true});
 const spike=auto.ingest("R01","UNIT001",175,now+7000,150,{training:true,real:true});
 assert.equal(spike.reason,"check_sensor");
 for(let i=0;i<4;i++)assert.equal(auto.ingest("R01","UNIT001",170,now+14000+i*7000,150,{training:true,real:true}).trigger,false);
});

test("outages and new wearer clear continuous-signal streak",()=>{
 const auto=new AutoHRMonitor(),start=1793100000000;
 for(let i=0;i<4;i++)assert.equal(auto.ingest("R01","OLD1",165,start+i*7000,150,{training:true,real:true}).trigger,false);
 assert.equal(auto.ingest("R01","OLD1",165,start+56000,150,{training:true,real:true}).trigger,false);
 assert.equal(auto.ingest("R01","NEW1",165,start+63000,150,{training:true,real:true}).trigger,false);
 auto.reset("R01");assert.equal(auto.status("R01"),null);
});

test("case can be closed by a human but active high HR will not spam another request",()=>{
 const auto=new AutoHRMonitor(),reviews=new MedicReviews(),start=1793100000000;
 for(let i=0;i<7;i++){const r=auto.ingest("R01","UNIT001",165,start+i*7000,150,{training:true,real:true});
  if(r.trigger)reviews.autoRequest("R01","UNIT001","high_sustained",start+i*7000);
 }
 const p=reviews.get("R01","UNIT001");
 reviews.update("R01","UNIT001",{action:"close",version:p.version,note:"Assessed; still supervising"},"medic");
 for(let i=7;i<22;i++)assert.equal(auto.ingest("R01","UNIT001",165,start+i*7000,150,{training:true,real:true}).trigger,false);
 assert.equal(reviews.get("R01","UNIT001").status,"closed");
});

test("TEST ONLY: replay cannot erase a sustained streak or rearm a latched alert",()=>{
 const monitor=new AutoHRMonitor(),start=1793100000000;
 const ingest=t=>monitor.ingest("R01","TEST001",160,start+t,150,{training:true,real:true});
 for(const t of [0,7000,14000,21000,28000])assert.equal(ingest(t).trigger,false);
 assert.equal(ingest(28000).reason,"duplicate_or_out_of_order");
 assert.equal(ingest(35000).trigger,true);
 assert.equal(ingest(7000).reason,"duplicate_or_out_of_order");
 assert.equal(ingest(42000).reason,"already_alerted");
 assert.equal(monitor.ingest("R02","TEST002",160,start+42000,150,{training:true,real:true}).trigger,false);
});


test("TEST ONLY: an existing manual case cannot mask automatic pause/check",()=>{
 const reviews=new MedicReviews();
 const first=reviews.update("R01","TEST001",{version:0,action:"request",reason:"other",note:"TEST ONLY"},"trainer");
 const result=reviews.autoRequest("R01","TEST001","high_sustained");
 assert.equal(result.created,false);assert.equal(result.escalated,true);
 assert.equal(result.review.autoPauseRequired,true);assert.equal(result.review.note,"TEST ONLY");
 assert.equal(result.review.requestedAt,first.requestedAt);
 assert.equal(reviews.autoRequest("R01","TEST001","high_sustained").escalated,undefined);
 const restored=new MedicReviews();restored.load(reviews.export());
 assert.equal(restored.get("R01","TEST001").autoPauseRequired,true);
 assert.throws(()=>restored.update("R01","TEST001",{version:first.version,action:"close"},"medic"),{status:409});
});
