import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const token="test-token-that-is-long-enough-1234567890";
const port=19000+Math.floor(Math.random()*1000);
const base="http://127.0.0.1:"+port;
let proc;
async function wait(){for(let i=0;i<80;i++){try{const r=await fetch(base+"/health");if(r.ok)return;}catch{}await delay(100);}throw Error("server failed to start");}
test("authenticated five-gateway ingest and stale-safe snapshot",async()=>{
 proc=spawn(process.execPath,["index.js"],{cwd:new URL(".",import.meta.url),env:{...process.env,PORT:String(port),RECRUIT_MONITOR_TOKEN:token},stdio:"pipe"});
 try{
 await wait();
 let r=await fetch(base+"/api/snapshot");assert.equal(r.status,401);
 r=await fetch(base+"/api/ingest",{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({gateway:"G05",readings:[{id:"R15",hr:99,timestamp:Date.now()}]})});
 assert.equal(r.status,200);assert.equal((await r.json()).accepted,1);
 r=await fetch(base+"/api/snapshot",{headers:{"Authorization":"Bearer "+token}});
 const data=await r.json();assert.equal(data.recruits.length,15);assert.equal(data.recruits[14].hr,99);assert.equal(data.recruits[14].gateway,"G05");assert.equal(data.recruits[0].hr,null);
 r=await fetch(base+"/api/ingest",{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({gateway:"G06",readings:[]})});assert.equal(r.status,422);
 r=await fetch(base+"/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});assert.equal(r.status,200);
 const cookie=r.headers.get("set-cookie")?.split(";")[0];assert.ok(cookie);
 r=await fetch(base+"/api/snapshot",{headers:{"Cookie":cookie}});assert.equal(r.status,200);
 r=await fetch(base+"/api/gateways",{headers:{"Cookie":cookie}});assert.equal(r.status,200);const gateways=(await r.json()).gateways;assert.equal(gateways.length,5);assert.equal(gateways[4].online,true);
 r=await fetch(base+"/api/ingest",{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify({gateway:"G01",readings:[{id:"R15",hr:101,timestamp:Date.now()+1}]})});assert.equal((await r.json()).accepted,0);
 r=await fetch(base+"/live");assert.equal(r.status,200);assert.match(await r.text(),/EventSource/);
 r=await fetch(base+"/api/ingest",{method:"POST",headers:{"Cookie":cookie,"Content-Type":"application/json"},body:JSON.stringify({gateway:"G01",readings:[]})});assert.equal(r.status,403);
 }finally{proc?.kill();}
});
