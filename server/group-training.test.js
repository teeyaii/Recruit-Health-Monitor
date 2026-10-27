import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from "node:fs";
import path from "node:path";
import os from "node:os";
import {RosterStore} from "./roster.js";

const trainer="trainer-test-group-credential-000000000001";
const medic="medic-test-group-credential-000000000001";
const viewer="viewer-test-group-credential-000000000001";
const gateway="gateway-test-group-credential-00000000001";
test("one group activity version is shared without overwriting individual WATCH, EMERGENCY, or slot assignments",()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),"steve-group-")),file=path.join(dir,"roster.json");
 try{
  const store=new RosterStore(file);
  const r=store.update("R01",{version:0,code:"DEMO-R01",restriction:"watch",observation:"confusion_collapse_seizure"},"medic");
  const start=store.getGroupPhase();
  assert.deepEqual([start.phase,start.version,start.changedAt],["not_started",0,null]);
  let p=store.setGroupPhase({version:0,phase:"training"},"trainer");
  assert.equal(p.phase,"training");assert.equal(p.version,1);assert.ok(p.changedAt);
  assert.equal(store.setGroupPhase({version:1,phase:"training"},"trainer").version,1,"duplicate tap must not create history");
  assert.throws(()=>store.setGroupPhase({version:0,phase:"hourly_rest"},"medic"),{status:409},"stale second screen rejected");
  assert.throws(()=>store.setGroupPhase({version:1,phase:"not_started"},"medic"),{status:422});
  assert.throws(()=>store.setGroupPhase({version:1,phase:"unverified"},"medic"),{status:422});
  p=store.setGroupPhase({version:1,phase:"hourly_rest"},"medic");
  assert.equal(p.phase,"hourly_rest");assert.equal(p.version,2);
  assert.equal(store.get("R01").observation,r.observation);
  assert.equal(store.get("R01").restriction,r.restriction);
  assert.equal(store.get("R01").version,r.version);
  assert.equal(store.getAudit().filter(e=>e.id==="GROUP").length,2);
  assert.equal(new RosterStore(file).getGroupPhase().phase,"hourly_rest","optional file survives restart");
  const old=JSON.parse(readFileSync(file,"utf8"));delete old.groupPhase;
  writeFileSync(file,JSON.stringify(old));
  assert.equal(new RosterStore(file).getGroupPhase().phase,"not_started","legacy roster file loads");
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("trainer and medic share protected group buttons; gateway forbidden; stale versions rejected",async()=>{
 const port=31000+Math.floor(Math.random()*1000),host="http://127.0.0.1:"+port;
 const cfg={...process.env,PORT:String(port),NODE_ENV:"production",COOKIE_SECURE:"1",
 STEVE_VIEWER_TOKEN:viewer,STEVE_TRAINER_TOKEN:trainer,STEVE_MEDIC_TOKEN:medic,
 STEVE_GATEWAY_TOKEN_G01:gateway,STEVE_GATEWAY_TOKENS_JSON:"",
 STEVE_SLOT_MAP_JSON:JSON.stringify({G01:{R01:"opaque-device-a",R02:"opaque-device-b"}})};
 const child=spawn(process.execPath,["index.js"],{cwd:new URL(".",import.meta.url),env:cfg,stdio:"ignore"});
 const req=async(route,{method="GET",json,cookie,token,origin}={})=>{
  const headers={...(json!==undefined?{"Content-Type":"application/json"}:{}),...(cookie?{Cookie:cookie}:{}),
   ...(token?{Authorization:"Bearer "+token}:{}),...(origin?{Origin:origin}:{})};
  const r=await fetch(host+route,{method,headers,...(json!==undefined?{body:JSON.stringify(json)}:{})});
  return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")?.split(";")[0]};
 };
 try{
  let ready=false;
  for(let i=0;i<90;i++){try{const r=await fetch(host+"/health");if(r.ok){ready=true;break;}}catch{}await delay(100);}
  assert.equal(ready,true);
  const t=await req("/api/login",{method:"POST",json:{token:trainer}});
  const m=await req("/api/login",{method:"POST",json:{token:medic}});
  assert.equal(t.status,200);assert.equal(m.status,200);
  assert.equal((await req("/api/training")).status,401);
  assert.equal((await req("/api/training",{token:gateway})).status,403);
  assert.equal((await req("/api/training",{method:"PUT",cookie:t.cookie,origin:"https://wrong.example",json:{phase:"training",version:0}})).status,403);
  let r=await req("/api/training",{cookie:t.cookie});assert.equal(r.data.phase,"not_started");
  r=await req("/api/training",{method:"PUT",cookie:t.cookie,json:{phase:"training",version:0}});
  assert.equal(r.status,200);assert.equal(r.data.phase,"training");assert.equal(r.data.version,1);
  r=await req("/api/training",{method:"PUT",cookie:m.cookie,json:{phase:"hourly_rest",version:0}});
  assert.equal(r.status,409);
  r=await req("/api/training",{method:"PUT",cookie:m.cookie,json:{phase:"hourly_rest",version:1}});
  assert.equal(r.status,200);assert.equal(r.data.phase,"hourly_rest");
  r=await req("/api/training",{cookie:t.cookie});assert.equal(r.data.version,2);
  assert.equal(r.data.ephemeral,true,"Render Free RAM-only limitation visible");
  r=await req("/api/roster/audit",{cookie:t.cookie});
  assert.equal(r.data.events.filter(e=>e.id==="GROUP").length,2);
  const one=await req("/api/snapshot",{cookie:m.cookie});
  assert.equal(one.data.recruits.length,15,"group action does not change sensor slots");
 }finally{child.kill();}
});
