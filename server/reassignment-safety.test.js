import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";

test("one-step wearer Save clears old BPM and refuses queued old samples while keeping Gateway unchanged",async()=>{
 const port=32600+Math.floor(Math.random()*1200),host="http://127.0.0.1:"+port;
 const trainer="test-trainer-reassign-credential-00000000001";
 const medic="test-medic-reassign-credential-00000000001";
 const gateway="test-gateway-reassign-credential-0000000001";
 const env={...process.env,PORT:String(port),NODE_ENV:"production",COOKIE_SECURE:"1",
  STEVE_VIEWER_TOKEN:"test-viewer-reassign-credential-0000000001",
  STEVE_TRAINER_TOKEN:trainer,STEVE_MEDIC_TOKEN:medic,
  STEVE_GATEWAY_TOKEN_G01:gateway,STEVE_GATEWAY_TOKENS_JSON:"",
  STEVE_SLOT_MAP_JSON:JSON.stringify({G01:{R01:"device-1",R02:"device-2"}})};
 const processUnderTest=spawn(process.execPath,["index.js"],{cwd:new URL(".",import.meta.url),env,stdio:"ignore"});
 const req=async(route,{method="GET",body,cookie,token}={})=>{
  const headers={...(body!==undefined?{"Content-Type":"application/json"}:{}),
   ...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:"Bearer "+token}:{})};
  const r=await fetch(host+route,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
  return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")?.split(";")[0]};
 };
 const readings=(hr,timestamp)=>({gateway:"G01",readings:[{id:"R01",device_id:"device-1",hr,timestamp}]});
 try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(host+"/health")).ok){ready=true;break;}}catch{}await delay(100);}
  assert.ok(ready);
  const login=await req("/api/login",{method:"POST",body:{token:trainer}});
  const loginMedic=await req("/api/login",{method:"POST",body:{token:medic}});
  assert.equal(login.status,200);assert.equal(loginMedic.status,200);
  const auth=login.cookie;
  let r=await req("/api/roster/R01",{method:"PUT",cookie:auth,body:{version:0,code:"old1",restriction:"watch",observation:"dizzy_weak_nausea"}});
  assert.equal(r.status,200);
  r=await req("/api/ingest",{method:"POST",token:gateway,body:readings(82,Date.now())});
  assert.equal(r.data.accepted,1);
  r=await req("/api/snapshot",{cookie:auth});assert.equal(r.data.recruits[0].hr,82);
  const oldTimestamp=Date.now()-50;
  r=await req("/api/roster/R01",{method:"PUT",cookie:loginMedic.cookie,
   body:{version:1,code:"new2",restriction:"watch",observation:"dizzy_weak_nausea"}});
  assert.equal(r.status,200);assert.equal(r.data.slot.paused,false);
  assert.equal(r.data.slot.restriction,"none");assert.equal(r.data.slot.observation,"none");
  r=await req("/api/snapshot",{cookie:auth});
  assert.equal(r.data.recruits[0].hr,null,"new wearer must not inherit old HR");
  r=await req("/api/ingest",{method:"POST",token:gateway,body:readings(92,oldTimestamp)});
  assert.equal(r.data.accepted,0,"in-flight previous recruit sample is discarded");
  await delay(5);
  r=await req("/api/ingest",{method:"POST",token:gateway,body:readings(76,Date.now())});
  assert.equal(r.data.accepted,1,"fresh HR is ingested without another Resume tap");
  r=await req("/api/snapshot",{cookie:auth});
  assert.equal(r.data.recruits[0].hr,76);
  r=await req("/api/roster/audit",{cookie:auth});
  assert.ok(r.data.events.some(e=>e.id==="R01"&&e.action==="reassign_via_save"));
  assert.equal(r.data.events.some(e=>JSON.stringify(e).includes("old1")),false,"no real identity in audit");
 }finally{processUnderTest.kill();}
});
