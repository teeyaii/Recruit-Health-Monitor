import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { readFile } from "node:fs/promises";

const viewer="render-synthetic-viewer-secret-32-characters-minimum";
const gateway="render-synthetic-g01-secret-32-characters-minimum";
const gateway2="render-synthetic-g02-secret-32-characters-minimum";
const map={G01:{R01:"demo-opaque-device-01"},G02:{R04:"demo-opaque-device-04"}};
const port=26000+Math.floor(Math.random()*900);
const base="http://127.0.0.1:"+port;
const config={...process.env,PORT:String(port),NODE_ENV:"production",COOKIE_SECURE:"1",
 RECRUIT_MONITOR_TOKEN:"",STEVE_GATEWAY_TOKENS_JSON:"",
 STEVE_VIEWER_TOKEN:viewer,STEVE_GATEWAY_TOKEN_G01:gateway,STEVE_GATEWAY_TOKEN_G02:gateway2,
 STEVE_SLOT_MAP_JSON:JSON.stringify(map),STEVE_DEMO_MODE:"1",STEVE_SYNTHETIC_MODE:"1"};
async function ready(){
 for(let i=0;i<60;i++){try{if((await fetch(base+"/health")).ok)return;}catch{}await delay(100);}
 throw Error("production-mode test server did not become ready");
}
async function post(path,payload,token){
 return fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},body:JSON.stringify(payload)});
}
test("Render-style generated environment secrets start LIVE backend without JSON token bundle",async()=>{
 const proc=spawn(process.execPath,["index.js"],{cwd:new URL(".",import.meta.url),env:config,stdio:"ignore"});
 try{
  await ready();
  let r=await post("/api/login",{token:viewer});assert.equal(r.status,200);
  const cookie=r.headers.get("set-cookie")?.split(";")[0];assert.ok(cookie);
  assert.match(r.headers.get("set-cookie")||"",/Secure/);
  r=await fetch(base+"/api/snapshot",{headers:{Cookie:cookie}});assert.equal(r.status,200);
  let data=await r.json();assert.equal(data.recruits.length,15);
  assert.equal(data.recruits[0].gateway,"G01");assert.equal(data.recruits[0].hr,null);
  assert.equal(data.recruits[0].state,"NO DATA");
  r=await post("/api/ingest",{gateway:"G01",readings:[{id:"R01",device_id:"demo-opaque-device-01",hr:86,timestamp:Date.now()}]},gateway);
  assert.equal(r.status,200);assert.equal((await r.json()).accepted,1);
  r=await fetch(base+"/api/snapshot",{headers:{Cookie:cookie}});
  data=await r.json();assert.equal(data.recruits[0].hr,86);assert.equal(data.recruits[0].source,"GATEWAY");
  r=await post("/api/ingest",{gateway:"G01",readings:[]},gateway2);assert.equal(r.status,403);
  r=await post("/api/ingest",{gateway:"G01",source:"SIMULATED",readings:[]},gateway);assert.equal(r.status,422);
  r=await fetch(base+"/api/demo",{headers:{Cookie:cookie}});assert.equal(r.status,404);
 }finally{proc.kill();}
});
test("reject duplicate individual gateway credentials and conflicting JSON configuration",async()=>{
 const cases=[
  {...config,PORT:String(port+1),STEVE_GATEWAY_TOKEN_G02:gateway},
  {...config,PORT:String(port+2),STEVE_GATEWAY_TOKENS_JSON:JSON.stringify({G01:gateway})}
 ];
 for(const env of cases){
  const proc=spawn(process.execPath,["index.js"],{cwd:new URL(".",import.meta.url),env,stdio:"ignore"});
  const exit=await new Promise(resolve=>proc.once("exit",resolve));
  assert.notEqual(exit,0);
 }
});
test("Render blueprint is opt-in free Docker with generated secrets and no personal data",async()=>{
 const yaml=await readFile(new URL("../render.yaml",import.meta.url),"utf8");
 assert.match(yaml,/plan: free/);
 assert.match(yaml,/runtime: docker/);
 assert.match(yaml,/autoDeployTrigger: off/);
 assert.match(yaml,/healthCheckPath: \/health/);
 assert.equal((yaml.match(/generateValue: true/g)||[]).length,6);
 assert.match(yaml,/STEVE_SLOT_MAP_JSON\s*\n\s*sync: false/);
 assert.doesNotMatch(yaml,/RECRUIT_MONITOR_TOKEN|demo-opaque-device-01|real-person/i);
});
