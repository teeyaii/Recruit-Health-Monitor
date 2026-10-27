import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {DurableState} from "./durable-state.js";
import {RollingArchive,ARCHIVE_RETENTION_MS,ARCHIVE_STEP_MS} from "./rolling-archive.js";

function fixture(){
 const durable=new DurableState({
  STEVE_SUPABASE_URL:"https://unit-test.supabase.co",
  STEVE_SUPABASE_SERVICE_ROLE_KEY:"sb_secret_test_for_rolling_archive_unit_001",
  STEVE_DATA_ENCRYPTION_KEY:randomBytes(32).toString("base64")
 });
 const rows=new Map();let failWrite=false;
 durable.request=async(url,options={},consume){
  const u=new URL(url),method=options.method||"GET";
  if(method==="POST"){
   if(failWrite)throw Error("mock storage down");
   for(const x of JSON.parse(options.body))rows.set([x.slot,x.owner,x.minute_ms].join("|"),x);
   return;
  }
  if(method==="DELETE"){
   for(const [key,row] of rows){
    if(u.searchParams.has("slot")&&u.searchParams.get("slot")!=="eq."+row.slot)continue;
    if(u.searchParams.has("minute_ms")&&!(row.minute_ms<Number(u.searchParams.get("minute_ms").slice(3))))continue;
    rows.delete(key);
   }
   return;
  }
  const filtered=[...rows.values()].filter(x=>
   (!u.searchParams.has("slot")||u.searchParams.get("slot")==="eq."+x.slot)&&
   (!u.searchParams.has("owner")||u.searchParams.get("owner")==="eq."+x.owner)&&
   (!u.searchParams.has("minute_ms")||
    u.searchParams.getAll("minute_ms").every(v=>v.startsWith("gte.")?x.minute_ms>=Number(v.slice(4)):v.startsWith("lte.")?x.minute_ms<=Number(v.slice(4)):true))
  ).sort((a,b)=>a.minute_ms-b.minute_ms);
  const offset=Number(u.searchParams.get("offset")||0),limit=Number(u.searchParams.get("limit")||1000);
  return consume?consume({json:async()=>filtered.slice(offset,offset+limit)}):filtered;
 };
 const archive=new RollingArchive(durable,{STEVE_ARCHIVE_ENABLED:"1"});
 return {archive,rows,setFailure:v=>{failWrite=v;}};
}

test("archive captures only real 7-second buckets, encrypts minutes and expires stale buckets",async()=>{
 const {archive,rows}=fixture();
 const now=Math.floor(Date.now()/60000)*60000+20000;
 assert.equal(ARCHIVE_STEP_MS,7000);
 const base=now-150000;
 assert.equal(archive.record("R01","DEMO-R01",87,base,base),true);
 assert.equal(archive.record("R01","DEMO-R01",89,base+1,base+1),false);
 assert.equal(archive.record("R01","DEMO-R01",88,base+8000,base+8000),true);
 assert.equal(archive.record("R02","DEMO-R02",70,base+8000,base+8000),true);
 assert.equal(archive.record("R01","DEMO-R01",null,base+10000,base+10000),false);
 assert.equal(archive.record("R01","DEMO-R01",70,base-20000,base),false);
 await archive.flush(now);
 assert.ok(rows.size>=2);
 for(const row of rows.values()){
  assert.equal(row.envelope.includes('"points"'),false,"never store plaintext medical samples");
  assert.deepEqual(archive.durable.decrypt(row.envelope).kind,"hr-minute-v1");
 }
 const p=await archive.get("R01","DEMO-R01",4,now);
 assert.deepEqual(p.map(x=>x[1]),[87,88]);
 assert.deepEqual(await archive.get("R01","OTHER-WEARER",4,now),[]);
 const previous=rows.size;
 await archive.cleanup(now+ARCHIVE_RETENTION_MS+120000);
 assert.ok(rows.size<previous,"archive removes old time buckets");
});

test("reassignment clears pending, deletes stored history and isolates the new wearer",async()=>{
 const {archive,rows}=fixture();
 const now=Math.floor(Date.now()/60000)*60000+20000,base=now-180000;
 archive.record("R01","PILOT-A",100,base,base);
 await archive.flush(now);
 assert.ok(rows.size);
 await archive.forget("R01");
 assert.equal(rows.size,0);
 archive.record("R01","PILOT-B",76,now,now);
 await archive.flush(now+90000);
 assert.deepEqual((await archive.get("R01","PILOT-B",4,now+90000)).map(p=>p[1]),[76]);
 assert.deepEqual(await archive.get("R01","PILOT-A",4,now+90000),[]);
});

test("failed batch keeps real points queued, no silent durable confirmation",async()=>{
 const {archive,rows,setFailure}=fixture();
 const now=Math.floor(Date.now()/60000)*60000+20000,old=now-150000;
 archive.record("R03","TEST-C",81,old,old);
 setFailure(true);
 await assert.rejects(archive.flush(now));
 assert.equal(rows.size,0);
 assert.equal(archive.status().state,"unavailable");
 assert.equal(archive.status().pendingMinutes,1);
 setFailure(false);await archive.flush(now);
 assert.equal(rows.size,1);
 assert.equal(archive.status().state,"write-confirmed");
});

test("archive is opt-in and never runs on an unconfigured store",()=>{
 const disabled=new RollingArchive({enabled:false},{});
 assert.equal(disabled.status().state,"disabled");
 assert.throws(()=>new RollingArchive({enabled:false},{STEVE_ARCHIVE_ENABLED:"1"}),/requires configured/);
});
