import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {randomBytes} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";

for(const failSave of [false,true])test(`TEST ONLY: automatic review survives restart, persistence failure=${failSave}`,async()=>{
 const dir=await mkdtemp(join(tmpdir(),"steve-auto-test-")),clock=join(dir,"clock.txt"),state=join(dir,"state.json"),hook=join(dir,"hook.mjs");
 const failFlag=join(dir,"fail.txt");
 const baseTime=1793100000000;
 await writeFile(clock,String(baseTime));
 await writeFile(hook,[
  "import {readFileSync} from 'node:fs';",
  "import {readFile,writeFile} from 'node:fs/promises';",
  "Date.now=()=>Number(readFileSync(process.env.TEST_CLOCK,'utf8'));",
  "const originalInterval=globalThis.setInterval;globalThis.setInterval=(fn,ms,...args)=>originalInterval(fn,ms===30000?250:ms,...args);",
  "globalThis.fetch=async(url,options)=>{",
  " if(!String(url).startsWith('https://unit-pilot.supabase.co/rest/v1/steve_secure_state'))throw Error('unknown mock URL');",
  " if(options.method==='GET'){let rows=[];try{rows=[JSON.parse(await readFile(process.env.TEST_STATE,'utf8'))];}catch(e){if(e.code!=='ENOENT')throw e;}return {ok:true,json:async()=>rows};}",
  " try{if(await readFile(process.env.TEST_FAIL,'utf8')==='1'){await writeFile(process.env.TEST_FAIL,'0');return {ok:false,status:503};}}catch{}",
  " await writeFile(process.env.TEST_STATE,options.body);return {ok:true,status:201};",
  "};"
 ].join("\n"));
 const port=38000+Math.floor(Math.random()*1500),base="http://127.0.0.1:"+port;
 const t="test-trainer-"+randomBytes(30).toString("hex"),
  m="test-medic-"+randomBytes(30).toString("hex"),
  v="test-viewer-"+randomBytes(30).toString("hex"),
  g="test-gateway-"+randomBytes(30).toString("hex");
 const env={...process.env,PORT:String(port),NODE_ENV:"production",COOKIE_SECURE:"1",
  STEVE_VIEWER_TOKEN:v,STEVE_TRAINER_TOKEN:t,STEVE_MEDIC_TOKEN:m,
  STEVE_GATEWAY_TOKEN_G01:g,STEVE_GATEWAY_TOKENS_JSON:"",
  STEVE_SLOT_MAP_JSON:JSON.stringify({G01:{R01:"device_001",R02:"device_002"}}),
  STEVE_SUPABASE_URL:"https://unit-pilot.supabase.co",
  STEVE_SUPABASE_SERVICE_ROLE_KEY:"sb_secret_testing_"+"s".repeat(36),
  STEVE_DATA_ENCRYPTION_KEY:randomBytes(32).toString("base64"),
  STEVE_ARCHIVE_ENABLED:"0",TEST_CLOCK:clock,TEST_STATE:state,TEST_FAIL:failFlag};
 let child=null;
 const req=(p,{method="GET",cookie,token,json}={})=>fetch(base+p,{
  method,headers:{...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:"Bearer "+token}:{}),
   ...(json!==undefined?{"Content-Type":"application/json"}:{})},
  ...(json!==undefined?{body:JSON.stringify(json)}:{})});
 const login=async token=>{
  const r=await req("/api/login",{method:"POST",json:{token}});
  assert.equal(r.status,200);return r.headers.get("set-cookie").split(";")[0];
 };
 const stop=async()=>{if(child&&child.exitCode===null){const exited=once(child,"exit");child.kill();await exited;}};
 const boot=async()=>{
  child=spawn(process.execPath,["--import",pathToFileURL(hook).href,"index.js"],{cwd:new URL(".",import.meta.url),env,stdio:"ignore"});
  for(let i=0;i<90;i++){try{if((await req("/health")).ok)return;}catch{}await delay(100);}
  throw Error("storage-backed test server unavailable");
 };
 try{
  await boot();
  const trainer=await login(t),medic=await login(m),viewer=await login(v);
  let r=await req("/api/roster/R01",{method:"PUT",cookie:trainer,json:{version:0,code:"TEST001",restriction:"none",observation:"none"}});
  assert.equal(r.status,200);
  r=await req("/api/roster/R02",{method:"PUT",cookie:trainer,json:{version:0,code:"TEST002",restriction:"none",observation:"none"}});
  assert.equal(r.status,200);
  r=await req("/api/private-profile/R01",{method:"PUT",cookie:medic,json:{
   version:0,confirmed:true,weightKg:null,heightCm:null,conditions:"",
   reviewThresholdBpm:150,reviewThresholdConfirmed:true}});
  assert.equal(r.status,200);
  r=await req("/api/training",{method:"PUT",cookie:trainer,json:{version:0,phase:"training"}});
  assert.equal(r.status,200);
  for(const route of ["/api/snapshot","/api/events","/api/gateways","/api/context"])
   assert.equal((await req(route,{token:g})).status,403,"Gateway must not read viewer data: "+route);
  const unconfigured=await (await req("/api/snapshot",{cookie:viewer})).json();
  assert.equal(unconfigured.recruits[1].monitoringStatus,"MONITORING_NOT_CONFIGURED");
  assert.equal(unconfigured.recruits[0].monitoringStatus,"OPERATOR_CONFIGURED_UNVERIFIED");
  for(let i=0;i<6;i++){
   const ts=baseTime+(i+1)*7000;await writeFile(clock,String(ts));
   if(failSave&&i===5)await writeFile(failFlag,"1");
   r=await req("/api/ingest",{method:"POST",token:g,json:{
    gateway:"G01",readings:[{id:"R01",device_id:"device_001",hr:160,timestamp:ts},{id:"R02",device_id:"device_002",hr:80,timestamp:ts}]}});
   const body=await r.json();
   assert.equal(r.status,failSave&&i===5?503:200);assert.equal(body.accepted,2);assert.equal(Object.hasOwn(body,"autoCreated"),false);
  }

  const snap=await (await req("/api/snapshot",{cookie:viewer})).json();
  assert.equal(snap.recruits[0].autoCheck,true);
  assert.equal(snap.recruits[1].autoCheck,false);
  assert.equal(snap.recruits[1].hr,80);
  assert.equal(JSON.stringify(snap).includes("reviewThresholdBpm"),false);
  const summary=await (await req("/api/medic-reviews/summary",{cookie:viewer})).json();
  assert.deepEqual(summary,{pending:1});
  assert.equal((await req("/api/medic-reviews/R01",{cookie:viewer})).status,403);
  const detail=await (await req("/api/medic-reviews/R01",{cookie:medic})).json();
  assert.equal(detail.review.openedBy,"system");
  await delay(600); // isolated 250ms retry timer; no more measurements
  await stop();await boot();
  const medicAgain=await login(m);
  const stream=await req("/api/events",{cookie:medicAgain});
  const reader=stream.body.getReader();await reader.read();
  if(failSave)await writeFile(clock,String(baseTime+9*60*60*1000));
  else await req("/api/logout",{method:"POST",cookie:medicAgain});
  // Advancing the isolated clock cannot revive a revoked stream. The regular
  // five-second publication must close it without another health snapshot.
  let ended=false;
  for(let i=0;i<3;i++){const chunk=await reader.read();if(chunk.done){ended=true;break;}}
  assert.equal(ended,true,"logout revokes existing SSE");
  const currentMedic=await login(m);
  const reopened=await (await req("/api/medic-reviews/R01",{cookie:currentMedic})).json();
  assert.equal(reopened.review.status,"pending","case survives encrypted state reload");
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
