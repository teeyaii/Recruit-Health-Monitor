import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";

test("history API serves only registered LIVE wearer, separates reassignment and rejects gateway-only access",async()=>{
 const port=34000+Math.floor(Math.random()*1000),base="http://127.0.0.1:"+port;
 const trainer="test-history-trainer-long-credential-001",medic="test-history-medic-long-credential-002",gateway="test-history-gateway-long-credential-003";
 const env={...process.env,PORT:String(port),NODE_ENV:"production",COOKIE_SECURE:"1",
  STEVE_VIEWER_TOKEN:"test-history-viewer-long-credential-004",
  STEVE_TRAINER_TOKEN:trainer,STEVE_MEDIC_TOKEN:medic,STEVE_GATEWAY_TOKEN_G01:gateway,
  STEVE_GATEWAY_TOKENS_JSON:"",STEVE_SLOT_MAP_JSON:JSON.stringify({G01:{R01:"device-a",R02:"device-b"}})};
 const child=spawn(process.execPath,["index.js"],{cwd:new URL(".",import.meta.url),env,stdio:"ignore"});
 async function req(path,{method="GET",cookie,token,json}={}){
  const headers={...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:"Bearer "+token}:{}),
   ...(json!==undefined?{"Content-Type":"application/json"}:{})};
  const r=await fetch(base+path,{method,headers,...(json!==undefined?{body:JSON.stringify(json)}:{})});
  return {status:r.status,data:await r.json(),cookie:r.headers.get("set-cookie")?.split(";")[0]};
 }
 const input=(slot,device,hr,ts,state)=>({gateway:"G01",readings:[{id:slot,device_id:device,hr,timestamp:ts,...(state?{state}:{})}]});
 try{
  let ok=false;
  for(let i=0;i<80;i++){try{if((await fetch(base+"/health")).ok){ok=true;break;}}catch{}await delay(100);}
  assert.ok(ok);
  const t=await req("/api/login",{method:"POST",json:{token:trainer}});
  const m=await req("/api/login",{method:"POST",json:{token:medic}});
  assert.equal(t.status,200);assert.equal(m.status,200);
  assert.equal((await req("/api/history/R01")).status,401);
  assert.equal((await req("/api/history/R01",{token:gateway})).status,403);
  assert.equal((await req("/api/history/R01",{cookie:t.cookie})).status,409,"NO DATA returns no chart");
  let r=await req("/api/ingest",{method:"POST",token:gateway,json:input("R02","device-b",74,Date.now())});
  assert.equal(r.data.accepted,1);
  assert.equal((await req("/api/history/R02",{cookie:t.cookie})).status,409,"unregistered slot never exposes graph");
  r=await req("/api/roster/R01",{method:"PUT",cookie:t.cookie,json:{version:0,code:"pilot01",restriction:"none",observation:"none"}});
  assert.equal(r.status,200);
  r=await req("/api/training",{method:"PUT",cookie:t.cookie,json:{version:0,phase:"training"}});
  assert.equal(r.status,200);
  await delay(6);
  r=await req("/api/ingest",{method:"POST",token:gateway,json:input("R01","device-a",91,Date.now())});
  assert.equal(r.data.accepted,1);
  r=await req("/api/history/R01",{cookie:m.cookie});
  assert.equal(r.status,200);assert.equal(r.data.windowHours,4);
  assert.equal(r.data.sampleIntervalSeconds,5);assert.equal(r.data.ephemeral,true);
  assert.equal(r.data.points.length,1);assert.equal(r.data.points[0][1],91);
  assert.equal(r.data.phases.at(-1).phase,"training");
  const priorStamp=Date.now()-10;
  r=await req("/api/roster/R01",{method:"PUT",cookie:m.cookie,json:{version:1,code:"pilot02",restriction:"none",observation:"none"}});
  assert.equal(r.status,200);
  r=await req("/api/history/R01",{cookie:t.cookie});assert.equal(r.status,409,"new wearer starts NO DATA");
  r=await req("/api/ingest",{method:"POST",token:gateway,json:input("R01","device-a",90,priorStamp)});
  assert.equal(r.data.accepted,0,"old queued pulse cannot populate new recruit history");
  await delay(8);
  r=await req("/api/ingest",{method:"POST",token:gateway,json:input("R01","device-a",68,Date.now())});
  assert.equal(r.data.accepted,1);
  r=await req("/api/history/R01",{cookie:t.cookie});
  assert.equal(r.status,200);assert.deepEqual(r.data.points.map(x=>x[1]),[68],"old 91 BPM is never mixed with new wearer");
  await delay(5);
  r=await req("/api/ingest",{method:"POST",token:gateway,json:input("R01","device-a",null,Date.now(),"DISCONNECTED")});
  assert.equal(r.data.accepted,1);
  assert.equal((await req("/api/history/R01",{cookie:t.cookie})).status,409,"disconnect never displays chart");
 }finally{child.kill();}
});
