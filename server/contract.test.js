import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const gatewayTokens={
 G01:"ci-gateway-one-secret-longer-than-thirty-two-characters",
 G02:"ci-gateway-two-secret-longer-than-thirty-two-characters"
};
const viewerSecret="ci-viewer-different-secret-longer-than-thirty-two";
const slotMap={G01:{R01:"synthetic-device-01",R02:"synthetic-device-02"},G02:{R03:"synthetic-device-03"}};
const port=21000+Math.floor(Math.random()*1000);
const base="http://127.0.0.1:"+port;
const headers=(gateway)=>({Authorization:"Bearer "+gatewayTokens[gateway],"Content-Type":"application/json"});
async function post(url,body,headers={}) {
 return fetch(base+url,{method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(body)});
}
async function waitForReady(){
 for(let i=0;i<60;i++){try{const r=await fetch(base+"/health");if(r.status===200)return;}catch{}await delay(100);}
 throw Error("strict-mode server failed to start");
}
test("strict gateway isolation, mapping, viewer permissions, manual WBGT and stale safety", async () => {
 const proc=spawn(process.execPath,["index.js"],{
  cwd:new URL(".",import.meta.url),
  env:{...process.env,PORT:String(port),RECRUIT_MONITOR_TOKEN:"",
   STEVE_VIEWER_TOKEN:viewerSecret,STEVE_GATEWAY_TOKENS_JSON:JSON.stringify(gatewayTokens),
   STEVE_SLOT_MAP_JSON:JSON.stringify(slotMap),
   STEVE_SLOT_MAP_EXTRA_JSON:JSON.stringify({G01:{R04:"pilot-additive-04",R05:"pilot-additive-05"}}),
   NODE_ENV:"test"},stdio:"pipe"
 });
 try {
  await waitForReady();
  let extra=await fetch(base+"/api/gateway/provision",{headers:{Authorization:"Bearer "+gatewayTokens.G01}});
  assert.equal(extra.status,200);
  let provision=await extra.json();
  assert.deepEqual(provision.slots.map(x=>x.id),["R01","R02","R04","R05"],"additive map must preserve every existing G01 slot");
  extra=await fetch(base+"/api/gateway/provision",{headers:{Authorization:"Bearer "+gatewayTokens.G02}});
  assert.equal(extra.status,200);
  provision=await extra.json();
  assert.deepEqual(provision.slots.map(x=>x.id),["R03"],"other gateway remains isolated");
  let r=await post("/api/ingest",{gateway:"G01",readings:[]},headers("G02"));
  assert.equal(r.status,403,"gateway G02 cannot impersonate G01");
  r=await post("/api/ingest",{gateway:"G01",readings:[]},{Authorization:"Bearer "+viewerSecret});
  assert.equal(r.status,401,"viewer token cannot be used as a gateway credential");
  r=await post("/api/ingest",{gateway:"G01",readings:[
   {id:"R01",device_id:"wrong-device",hr:88,timestamp:Date.now()},
   {id:"R02",device_id:"synthetic-device-02",hr:75,timestamp:Date.now()}
  ]},headers("G01"));
  assert.equal(r.status,200);assert.equal((await r.json()).accepted,1,"reject wrong device assignment");
  r=await post("/api/ingest",{gateway:"G01",readings:[
   {id:"R04",device_id:"pilot-additive-04",hr:74,timestamp:Date.now()}]},headers("G01"));
  assert.equal((await r.json()).accepted,1,"newly authorized R04 accepts real fresh G01 measurement");
  r=await post("/api/ingest",{gateway:"G02",readings:[
   {id:"R01",device_id:"synthetic-device-01",hr:90,timestamp:Date.now()},
   {id:"R03",device_id:"synthetic-device-03",hr:91,timestamp:Date.now()}
  ]},headers("G02"));
  assert.equal((await r.json()).accepted,1,"reject slot owned by another gateway");
  r=await fetch(base+"/api/snapshot",{headers:{Authorization:"Bearer "+gatewayTokens.G02}});
  assert.equal(r.status,403,"gateway cannot read other wearers or medical workflow state");
  r=await post("/api/context",{wbgtC:28},headers("G01"));
  assert.equal(r.status,403,"gateway cannot edit operator context");
  r=await post("/api/login",{token:viewerSecret});
  assert.equal(r.status,200);
  const cookie=r.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  r=await fetch(base+"/api/snapshot",{headers:{Cookie:cookie}});
  assert.equal(r.status,200);
  let slots=(await r.json()).recruits;
  assert.equal(slots.find(x=>x.id==="R01").hr,null,"missing readings must remain unknown");
  assert.equal(slots.find(x=>x.id==="R02").hr,75);
  assert.equal(slots.find(x=>x.id==="R03").gateway,"G02");

  r=await post("/api/ingest",{gateway:"G01",readings:[]},{Cookie:cookie});
  assert.equal(r.status,403,"logged-in viewer cannot inject measurements");
  r=await post("/api/context",{wbgtC:29.5},{Cookie:cookie});
  assert.equal(r.status,200);
  r=await fetch(base+"/api/context",{headers:{Cookie:cookie}});
  const context=await r.json();assert.equal(context.wbgtC,29.5);
  assert.equal(context.source,"manual entry");
  assert.equal(context.stale,false);
  r=await post("/api/context",{wbgtC:"unsafe"},{Cookie:cookie});
  assert.equal(r.status,422);
  for(let i=0;i<8;i++) {r=await post("/api/login",{token:"wrong"});assert.equal(r.status,401);}
  r=await post("/api/login",{token:"wrong"});assert.equal(r.status,429);
 } finally {proc.kill();}
});
test("reject conflicting device assignments at startup",async()=>{
 const proc=spawn(process.execPath,["index.js"],{cwd:new URL(".",import.meta.url),
  env:{...process.env,PORT:String(port+1),STEVE_VIEWER_TOKEN:viewerSecret,
   STEVE_GATEWAY_TOKENS_JSON:JSON.stringify(gatewayTokens),
   STEVE_SLOT_MAP_JSON:JSON.stringify({G01:{R01:"same-device"},G02:{R03:"same-device"}}),
   RECRUIT_MONITOR_TOKEN:"",NODE_ENV:"test"},stdio:"ignore"});
 const exit=await new Promise(resolve=>proc.once("exit",code=>resolve(code)));
 assert.notEqual(exit,0);
});

test("additive map rejects duplicate existing slot, duplicate device, unknown gateway and missing base",async()=>{
 const bad=[
  {base:slotMap,extra:{G01:{R01:"collision-slot"}}},
  {base:slotMap,extra:{G01:{R04:"synthetic-device-01"}}},
  {base:slotMap,extra:{G03:{R04:"extra-device-04"}}},
  {base:null,extra:{G01:{R04:"extra-device-04"}}}
 ];
 for(const [i,caseData] of bad.entries()){
  const env={...process.env,PORT:String(port+10+i),RECRUIT_MONITOR_TOKEN:"",
   STEVE_VIEWER_TOKEN:viewerSecret,STEVE_GATEWAY_TOKENS_JSON:JSON.stringify(gatewayTokens),
   NODE_ENV:"test",STEVE_SLOT_MAP_EXTRA_JSON:JSON.stringify(caseData.extra)};
  if(caseData.base!==null)env.STEVE_SLOT_MAP_JSON=JSON.stringify(caseData.base);
  else delete env.STEVE_SLOT_MAP_JSON;
  const proc=spawn(process.execPath,["index.js"],{cwd:new URL(".",import.meta.url),env,stdio:"ignore"});
  const exit=await new Promise(resolve=>proc.once("exit",code=>resolve(code)));
  assert.notEqual(exit,0,"invalid additive case "+i+" must fail at startup");
 }
});

test("named additive key adds R05 without touching existing EXTRA map; collisions across keys fail startup",async()=>{
 const baseEnv={...process.env,RECRUIT_MONITOR_TOKEN:"",STEVE_VIEWER_TOKEN:viewerSecret,
  STEVE_GATEWAY_TOKENS_JSON:JSON.stringify(gatewayTokens),NODE_ENV:"test",
  STEVE_SLOT_MAP_JSON:JSON.stringify(slotMap),
  STEVE_SLOT_MAP_EXTRA_JSON:JSON.stringify({G01:{R04:"pilot-additive-04"}})};
 const okPort=port+40;
 const proc=spawn(process.execPath,["index.js"],{cwd:new URL(".",import.meta.url),stdio:"ignore",
  env:{...baseEnv,PORT:String(okPort),STEVE_SLOT_MAP_EXTRA_R05_JSON:JSON.stringify({G01:{R05:"trial_g01_r05_20261105"}})}});
 try{
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch("http://127.0.0.1:"+okPort+"/health")).ok){ready=true;break;}}catch{}await delay(100);}
  assert.ok(ready);
  const g01=await (await fetch("http://127.0.0.1:"+okPort+"/api/gateway/provision",{headers:{Authorization:"Bearer "+gatewayTokens.G01}})).json();
  assert.deepEqual(g01.slots,[{id:"R01",device_id:"synthetic-device-01"},{id:"R02",device_id:"synthetic-device-02"},
   {id:"R04",device_id:"pilot-additive-04"},{id:"R05",device_id:"trial_g01_r05_20261105"}],"existing aliases unchanged, R05 appended");
  const g02=await (await fetch("http://127.0.0.1:"+okPort+"/api/gateway/provision",{headers:{Authorization:"Bearer "+gatewayTokens.G02}})).json();
  assert.deepEqual(g02.slots.map(x=>x.id),["R03"],"G02 never receives R05");
 }finally{proc.kill();}
 const bad=[{G01:{R04:"other-alias"}},{G01:{R05:"pilot-additive-04"}},{G03:{R05:"x-alias-05"}},{G01:{R05:"synthetic-device-01"}}];
 for(const [i,extra] of bad.entries()){
  const p=spawn(process.execPath,["index.js"],{cwd:new URL(".",import.meta.url),stdio:"ignore",
   env:{...baseEnv,PORT:String(port+50+i),STEVE_SLOT_MAP_EXTRA_R05_JSON:JSON.stringify(extra)}});
  const exit=await new Promise(resolve=>p.once("exit",code=>resolve(code)));
  assert.notEqual(exit,0,"cross-key collision case "+i+" must fail at startup");
 }
});
