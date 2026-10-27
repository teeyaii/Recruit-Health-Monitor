import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {RosterStore} from "./roster.js";

const port=29500+Math.floor(Math.random()*1000);
const host="http://127.0.0.1:"+port;
const trainer="trainer-test-very-long-credential-000000000001";
const medic="medic-test-very-long-credential-000000000001";
const viewer="viewer-test-very-long-credential-000000000001";
const gateway="gateway-test-very-long-credential-00000000001";
const cfg={...process.env,PORT:String(port),NODE_ENV:"production",COOKIE_SECURE:"1",
 STEVE_VIEWER_TOKEN:viewer,STEVE_TRAINER_TOKEN:trainer,STEVE_MEDIC_TOKEN:medic,
 STEVE_GATEWAY_TOKEN_G01:gateway,STEVE_GATEWAY_TOKENS_JSON:"",
 STEVE_SLOT_MAP_JSON:JSON.stringify({G01:{R01:"opaque-device-a",R02:"opaque-device-b"}})};
async function waitReady(){
 for(let n=0;n<90;n++){try{const r=await fetch(host+"/health");if(r.ok)return;}catch{}await delay(100);}
 throw Error("Test server unavailable");
}
async function request(route,{method="GET",json,cookie,token,origin}={}){
 const headers={...(json!==undefined?{"Content-Type":"application/json"}:{}),
  ...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:"Bearer "+token}:{}),
  ...(origin?{Origin:origin}:{})};
 const r=await fetch(host+route,{method,headers,...(json!==undefined?{body:JSON.stringify(json)}:{})});
 return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")?.split(";")[0]};
}
async function login(token){
 const r=await request("/api/login",{method:"POST",json:{token}});
 assert.equal(r.status,200);assert.ok(r.cookie);return r.cookie;
}
test("trainer and medical operator get identical write/acknowledge/replace/resume authority with an audit trail",async()=>{
 const child=spawn(process.execPath,["index.js"],{cwd:new URL(".",import.meta.url),env:cfg,stdio:"ignore"});
 try{
  await waitReady();
  const trainerCookie=await login(trainer),medicCookie=await login(medic);
  const legacyCookie=await login(viewer);
  let r=await request("/api/operator/me",{cookie:trainerCookie});assert.equal(r.data.role,"trainer");
  const trainerPermissions=r.data.permissions;
  r=await request("/api/operator/me",{cookie:medicCookie});assert.equal(r.data.role,"medic");
  assert.deepEqual(r.data.permissions,trainerPermissions);
  r=await request("/api/operator/me",{cookie:legacyCookie});assert.equal(r.data.role,"legacy");
  assert.deepEqual(r.data.permissions,trainerPermissions);
  r=await request("/api/roster",{token:gateway});assert.equal(r.status,403);
  r=await request("/api/roster",{cookie:trainerCookie});assert.equal(r.data.slots.length,15);
  assert.equal(r.data.ephemeral,true);

  r=await request("/api/roster/R01",{method:"PUT",cookie:trainerCookie,
   json:{version:0,code:"DEMO-R01",restriction:"watch",observation:"dizzy_weak_nausea"}});
  assert.equal(r.status,200);assert.equal(r.data.slot.version,1);
  r=await request("/api/roster/R01/acknowledge",{method:"POST",cookie:medicCookie,json:{version:1}});
  assert.equal(r.status,200);assert.equal(r.data.slot.acknowledged,true);
  r=await request("/api/roster/R01",{method:"PUT",cookie:trainerCookie,
   json:{version:2,code:"DEMO-R01",restriction:"no_training",observation:"confusion_collapse_seizure"}});
  assert.equal(r.status,200);assert.equal(r.data.slot.acknowledged,false);
  r=await request("/api/roster/R01",{method:"PUT",cookie:medicCookie,
   json:{version:2,code:"DEMO-R01",restriction:"none",observation:"none"}});
  assert.equal(r.status,409,"stale revision rejected");
  r=await request("/api/roster/R02",{method:"PUT",cookie:trainerCookie,
   json:{version:0,code:"DEMO-R01",restriction:"none",observation:"none"}});
  assert.equal(r.status,409,"duplicate code across slots rejected");
  r=await request("/api/roster/R01",{method:"PUT",cookie:trainerCookie,
   json:{version:3,code:"<script>",restriction:"none",observation:"none"}});
  assert.equal(r.status,422,"injection-like identifiers rejected");

  // A live BLE packet is initially accepted.
  const measure=(hr,time)=>request("/api/ingest",{method:"POST",token:gateway,
   json:{gateway:"G01",readings:[{id:"R01",device_id:"opaque-device-a",hr,timestamp:time}]}});
  r=await measure(91,Date.now());assert.equal(r.data.accepted,1);
  r=await request("/api/snapshot",{cookie:trainerCookie});
  assert.equal(r.data.recruits[0].hr,91);

  // Medical operator can replace exactly as trainer can.
  r=await request("/api/roster/R01/replace",{method:"POST",cookie:medicCookie,
   json:{version:3,code:"DEMO-R01B"}});
  assert.equal(r.status,200);assert.equal(r.data.slot.paused,true);
  assert.equal(r.data.slot.observation,"none");assert.equal(r.data.slot.restriction,"none");
  r=await request("/api/snapshot",{cookie:trainerCookie});
  assert.equal(r.data.recruits[0].hr,null);assert.equal(r.data.recruits[0].state,"PAUSED");
  r=await measure(109,Date.now());assert.equal(r.data.accepted,0,"old band must not populate new occupant");

  r=await request("/api/roster/R01/resume",{method:"POST",cookie:trainerCookie,
   json:{version:4,confirmed:false}});
  assert.equal(r.status,422,"physical check is mandatory");
  r=await request("/api/roster/R01/resume",{method:"POST",cookie:trainerCookie,
   json:{version:4,confirmed:true}});
  assert.equal(r.status,200);assert.equal(r.data.slot.paused,false);
  r=await measure(77,Date.now()+1);assert.equal(r.data.accepted,1);
  r=await request("/api/roster/audit",{cookie:medicCookie});
  assert.deepEqual(r.data.events.map(e=>e.actor),["trainer","medic","trainer","medic","trainer"]);
  assert.ok(r.data.events.every(e=>!JSON.stringify(e).includes("DEMO-R01")));
  r=await request("/api/roster/R01",{method:"PUT",cookie:trainerCookie,
   origin:"https://evil.invalid",json:{version:5,code:"DEMO-R01B",restriction:"none",observation:"none"}});
  assert.equal(r.status,403);
  r=await request("/api/roster/R01",{method:"PUT",cookie:medicCookie,
   json:{version:5,code:"DEMO-R01B",restriction:"none",observation:"none"}});
  assert.equal(r.status,200,"medic may edit all the same fields as trainer");
  r=await request("/api/roster",{cookie:trainerCookie});
  assert.equal(r.data.slots[0].code,"DEMO-R01B");
 }finally{child.kill();}
});
test("optional private roster file is atomic across restarts; default remains RAM-only",()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),"steve-anonymous-roster-"));
 const file=path.join(dir,"roster.json");
 try{
  const s=new RosterStore(file);
  const saved=s.update("R05",{version:0,code:"DEMO-R05",restriction:"none",observation:"none"},"trainer");
  assert.equal(saved.version,1);
  const savedAgain=new RosterStore(file).get("R05");
  assert.equal(savedAgain.code,"DEMO-R05");
  assert.equal(savedAgain.version,1);
  assert.equal(JSON.parse(readFileSync(file,"utf8")).audit[0].actor,"trainer");
  assert.throws(()=>new RosterStore(path.join(dir,"missing-a", "..", "roster-invalid.json")).replace("R05",{version:0,code:"bad"}, "medic"));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("bad duplicate or incomplete trainer/medic tokens fail server startup",async()=>{
 const cases=[
  {...cfg,PORT:String(port+1),STEVE_MEDIC_TOKEN:trainer},
  {...cfg,PORT:String(port+2),STEVE_MEDIC_TOKEN:""},
  {...cfg,PORT:String(port+3),STEVE_TRAINER_TOKEN:gateway}
 ];
 for(const env of cases){
  const child=spawn(process.execPath,["index.js"],{cwd:new URL(".",import.meta.url),env,stdio:"ignore"});
  const exit=await new Promise(r=>child.on("exit",r));
  assert.notEqual(exit,0);
 }
});

test("operator-confirmed activity survives updates, replacement resets it, and legacy roster files remain readable",()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),"steve-activity-"));
 const file=path.join(dir,"roster.json");
 try{
  const store=new RosterStore(file);
  let p=store.update("R01",{version:0,code:"TEST-R01",restriction:"watch",observation:"none",activity:"training"},"medic");
  assert.equal(p.activity,"training");
  p=store.update("R01",{version:1,code:"TEST-R01",restriction:"watch",observation:"none",activity:"resting"},"trainer");
  assert.equal(new RosterStore(file).get("R01").activity,"resting");
  assert.throws(()=>store.update("R01",{version:2,code:"TEST-R01",restriction:"none",observation:"none",activity:"unverified"},"medic"),{status:422});
  p=store.replace("R01",{version:2,code:"TEST-R01B"},"medic");
  assert.equal(p.activity,"not_reported");
  assert.equal(p.paused,true);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
