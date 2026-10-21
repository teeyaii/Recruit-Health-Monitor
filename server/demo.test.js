import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const token="demo-only-not-personnel-data-secret-123456789";
const port=24000+Math.floor(Math.random()*1000);
const base="http://127.0.0.1:"+port;
async function ready(){
 for(let i=0;i<70;i++){try{if((await fetch(base+"/health")).ok)return;}catch{}await delay(100);}
 throw Error("demo server not ready");
}
async function command(cookie,action) {
 return fetch(base+"/api/demo",{method:"POST",headers:{"Content-Type":"application/json",Cookie:cookie},body:JSON.stringify({action})});
}
test("operator-controlled synthetic 15-slot demo is gated, labeled and supports dropout", async()=>{
 const proc=spawn(process.execPath,["index.js"],{cwd:new URL(".",import.meta.url),env:{
  ...process.env,PORT:String(port),NODE_ENV:"test",RECRUIT_MONITOR_TOKEN:token,
  STEVE_VIEWER_TOKEN:"",STEVE_GATEWAY_TOKENS_JSON:"",STEVE_SLOT_MAP_JSON:"",
  STEVE_DEMO_MODE:"1"},stdio:"ignore"});
 try {
  await ready();
  let response=await fetch(base+"/api/demo");assert.equal(response.status,401);
  response=await fetch(base+"/api/login",{method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({token})});
  assert.equal(response.status,200);
  const cookie=response.headers.get("set-cookie")?.split(";")[0];assert.ok(cookie);
  response=await command(cookie,"start");assert.equal(response.status,200);
  response=await fetch(base+"/api/snapshot",{headers:{Cookie:cookie}});
  let rows=(await response.json()).recruits;
  assert.equal(rows.length,15);
  assert.equal(rows.filter(x=>!x.stale).length,15);
  assert.ok(rows.every(x=>x.source==="SIMULATED"));
  const previousR03=rows.find(x=>x.id==="R03").timestamp;
  response=await command(cookie,"drop");assert.equal(response.status,200);
  await delay(3150);
  response=await fetch(base+"/api/snapshot",{headers:{Cookie:cookie}});
  rows=(await response.json()).recruits;
  assert.equal(rows.find(x=>x.id==="R03").timestamp,previousR03);
  assert.ok(rows.find(x=>x.id==="R04").timestamp>previousR03);
  response=await command(cookie,"restore");assert.equal(response.status,200);
  response=await fetch(base+"/api/snapshot",{headers:{Cookie:cookie}});
  rows=(await response.json()).recruits;
  assert.ok(rows.find(x=>x.id==="R03").timestamp>previousR03);
  response=await command(cookie,"stop");assert.equal(response.status,200);
  response=await fetch(base+"/api/demo",{headers:{Cookie:cookie}});
  assert.equal((await response.json()).active,false);
  response=await command(cookie,"invented-action");assert.equal(response.status,422);
 }finally{proc.kill();}
});
test("production server never enables synthetic demo",async()=>{
 const proc=spawn(process.execPath,["index.js"],{cwd:new URL(".",import.meta.url),env:{
  ...process.env,NODE_ENV:"production",PORT:String(port+1),RECRUIT_MONITOR_TOKEN:token,
  STEVE_DEMO_MODE:"1",COOKIE_SECURE:"1"},stdio:"ignore"});
 const exit=await new Promise(resolve=>proc.once("exit",resolve));
 assert.notEqual(exit,0);
});
