import test from "node:test";
import assert from "node:assert/strict";
import {MedicReviews,describeSignal} from "./medic-review.js";
import {RosterStore} from "./roster.js";
import {PrivateProfiles} from "./private-profiles.js";
const register=(roster,slot,code)=>roster.update(slot,{version:0,code,restriction:"none",observation:"none"},"trainer");

test("Medic Review is human-owned, durable and shows aggregate count only",()=>{
 const r=new RosterStore();register(r,"R01","ALFA001");register(r,"R02","ALFA002");
 const q=new MedicReviews();
 const first=q.update("R01","ALFA001",{action:"request",reason:"rest_recovery",note:"Verify measured recovery",version:0},"medic",200);
 assert.equal(first.status,"pending");assert.equal(q.countPending(r),1);
 assert.throws(()=>q.update("R01","ALFA001",{action:"request",reason:"high_sustained",version:1},"trainer"),{status:409});
 const recovered=new MedicReviews();recovered.load(q.export());assert.equal(recovered.countPending(r),1);
 const closed=recovered.update("R01","ALFA001",{action:"close",note:"Evaluated by staff",version:1},"trainer",250);
 assert.equal(closed.status,"closed");assert.equal(recovered.countPending(r),0);
 assert.equal(recovered.get("R01","ALFA001").note,"Evaluated by staff");
});

test("No one can reuse a prior wearer's review and invalid notes cannot be injected",()=>{
 const r=new RosterStore();register(r,"R01","ALFA001");
 const q=new MedicReviews();q.update("R01","ALFA001",{action:"request",reason:"medical_context",version:0},"trainer");
 assert.equal(q.get("R01","ALFA002").status,"none");
 assert.equal(q.countPending(r),1);q.clear("R01");assert.equal(q.countPending(r),0);
 assert.throws(()=>q.update("R01","ALFA002",{action:"request",reason:"other",version:0,note:"<script>"},"medic"),{status:422});
 assert.throws(()=>q.update("R01","ALFA002",{action:"request",reason:"diagnosis",version:0},"medic"),{status:422});
 assert.throws(()=>q.update("R01","ALFA002",{action:"request",reason:"other",version:0},"legacy"),{status:403});
});

test("Quality screening never declares safe/unsafe from a single BPM or unknown baseline",()=>{
 const now=1793000000000;
 const few=[[now-10000,148]],no=describeSignal(few,now);
 assert.equal(no.quality,"insufficient");assert.equal(no.deltaBpm,null);
 const gap=Array.from({length:30},(_,i)=>[now-240000+i*7000,75+(i%4)]);
 const good=describeSignal(gap,now,65);
 assert.equal(good.quality,"usable_for_description");assert.equal(good.clinicalThresholdApproved,false);
 assert.equal(typeof good.deltaBpm,"number");
 const bad=describeSignal(gap.map((p,i)=>i===12?[p[0],200]:p),now,65);
 assert.equal(bad.quality,"check_signal");assert.equal(bad.deltaBpm,null);
 const disconnected=describeSignal(gap,now+120000,65);
 assert.equal(disconnected.fresh,false);assert.equal(disconnected.deltaBpm,null);
});

test("Private profile baseline is explicit, confirmed and backward compatible",()=>{
 const store=new PrivateProfiles();
 let p=store.get("R01","ALFA001");
 assert.equal(p.restingBaselineBpm,null);assert.equal(p.ageYears,null);
 assert.throws(()=>store.update("R01","ALFA001",{version:0,confirmed:true,weightKg:70,heightCm:170,conditions:"",
  restingBaselineBpm:62}),{status:422});
 p=store.update("R01","ALFA001",{version:0,confirmed:true,weightKg:70,heightCm:170,conditions:"",
  ageYears:22,medications:"none reported",restingBaselineBpm:62,baselineConfirmed:true});
 assert.equal(p.restingBaselineBpm,62);assert.equal(p.baselineConfirmed,true);
 const roundtrip=new PrivateProfiles();roundtrip.load(store.export());assert.equal(roundtrip.get("R01","ALFA001").ageYears,22);
 const legacy=new PrivateProfiles();legacy.load({R02:{slot:"R02",code:"OLDER1",version:1,updatedAt:100,
  weightKg:75,heightCm:175,conditions:""}});
 assert.equal(legacy.get("R02","OLDER1").restingBaselineBpm,null);
});
