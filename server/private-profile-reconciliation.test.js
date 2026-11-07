import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {randomBytes} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";

for(const mode of ["before_commit","lost_ack","compensation_fails","queued_writers"])test("private profile persistence reconciliation: "+mode,async()=>{
 const dir=await mkdtemp(join(tmpdir(),"steve-storage-test-"));
 const file=join(dir,"snapshot.json"),hook=join(dir,"fetch-mock.mjs");
 // Only this child process replaces fetch. Production has no mock/storage bypass.
 await writeFile(hook,`import {readFile,writeFile} from 'node:fs/promises';
 globalThis.fetch=async(url,options)=>{
  if(url.startsWith('https://unit-pilot.supabase.co/rest/v1/steve_hr_archive'))return {ok:true,status:200,json:async()=>[]};
  if(!url.startsWith('https://unit-pilot.supabase.co/rest/v1/steve_secure_state'))throw Error('unexpected target');
  if(options.method==='GET'){
   let rows=[];try{rows=[JSON.parse(await readFile(process.env.TEST_SNAPSHOT,'utf8'))];}catch(e){if(e.code!=='ENOENT')throw e;}
   return {ok:true,json:async()=>rows};
  }
  let mode=null;try{mode=await readFile(process.env.TEST_FAIL_ACK,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(mode==='queued_writers'){
   await writeFile(process.env.TEST_FAIL_ACK+'.entered','1');
   while(await readFile(process.env.TEST_FAIL_ACK,'utf8')==='queued_writers')await new Promise(r=>setTimeout(r,10));
  }
  if(mode==='before_commit'||mode==='block_compensation')throw Error('simulated before commit failure');
  await writeFile(process.env.TEST_SNAPSHOT,options.body);
  if(mode==='lost_ack'){await writeFile(process.env.TEST_FAIL_ACK,'ok');throw Error('ACK lost');}
  if(mode==='compensation_fails'){await writeFile(process.env.TEST_FAIL_ACK,'block_compensation');throw Error('ACK lost');}
  return {ok:true,status:201};
 };`);
 const port=41000+Math.floor(Math.random()*1000),base="http://127.0.0.1:"+port;
 const trainer="test-only-trainer-"+"t".repeat(32),medic="test-only-medic-"+"m".repeat(32);
 const viewer="test-only-viewer-"+"v".repeat(32),gateway="test-only-gateway-"+"g".repeat(32);
 const env={...process.env,PORT:String(port),NODE_ENV:"production",COOKIE_SECURE:"1",
  STEVE_VIEWER_TOKEN:viewer,STEVE_TRAINER_TOKEN:trainer,STEVE_MEDIC_TOKEN:medic,
  STEVE_GATEWAY_TOKENS_JSON:"",STEVE_GATEWAY_TOKEN_G01:gateway,
  STEVE_GATEWAY_TOKEN_G02:"",STEVE_GATEWAY_TOKEN_G03:"",STEVE_GATEWAY_TOKEN_G04:"",STEVE_GATEWAY_TOKEN_G05:"",
  STEVE_SLOT_MAP_JSON:JSON.stringify({G01:{R01:"test-device"}}),
  STEVE_SUPABASE_URL:"https://unit-pilot.supabase.co",
  STEVE_SUPABASE_SERVICE_ROLE_KEY:"sb_secret_test_only_"+"s".repeat(32),
  STEVE_DATA_ENCRYPTION_KEY:randomBytes(32).toString("base64"),TEST_SNAPSHOT:file,TEST_FAIL_ACK:join(dir,"fail-ack"),STEVE_ARCHIVE_ENABLED:"1"};
 let child;
 async function start(){
  child=spawn(process.execPath,["--import",pathToFileURL(hook).href,"index.js"],{cwd:new URL(".",import.meta.url),env,stdio:"ignore"});
  for(let i=0;i<80;i++){try{if((await fetch(base+"/health")).ok)return;}catch{}await delay(100);}
  throw Error("storage test server did not start");
 }
 async function stop(){if(child&&child.exitCode===null){const exited=once(child,"exit");child.kill();await exited;}}
 async function req(path,{method="GET",cookie,token,json}={}){
  return fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:"Bearer "+token}:{}),
   ...(json?{"Content-Type":"application/json"}:{})},...(json?{body:JSON.stringify(json)}:{})});
 }
 async function login(token){const r=await req('/api/login',{method:'POST',json:{token}});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
 try{
  await start();
  let cookie=await login(trainer);
  assert.equal((await req('/api/storage/status')).status,401);
  assert.equal((await req('/api/storage/status',{token:gateway})).status,403);
  let status=await (await req('/api/storage/status',{cookie})).json();
  assert.equal(status.state,'read-confirmed');assert.equal(status.lastWriteAt,null);
  assert.equal((await req('/api/roster/R01',{method:'PUT',cookie,json:{version:0,code:'test01',restriction:'none',observation:'none'}})).status,200);
  for(const [version,phase] of [[0,'training'],[1,'hourly_rest']]){
   assert.equal((await req('/api/training',{method:'PUT',cookie,json:{version,phase}})).status,200);
   await delay(5);
  }
  const notes='synthetic private test note';
  assert.equal((await req('/api/private-profile/R01',{method:'PUT',cookie,json:{version:0,weightKg:72,heightCm:180,conditions:notes,confirmed:true}})).status,200);
  await writeFile(join(dir,"fail-ack"),mode);
  if(mode==='queued_writers'){
   const first=req('/api/private-profile/R01',{method:'PUT',cookie,json:{version:1,weightKg:80,heightCm:180,conditions:notes,confirmed:true}});
   let entered=false;for(let i=0;i<100;i++){try{await readFile(join(dir,'fail-ack.entered'));entered=true;break;}catch{}await delay(10);}
   assert.ok(entered,'first proposal must be awaiting durable persistence');
   const during=await req('/api/private-profile/R01',{cookie});assert.equal(during.status,503);
   assert.equal((await during.json()).persistence.state,'saving');
   assert.equal((await req('/api/medic-reviews/R01',{cookie})).status,503,'private clinical context must not imply a confirmed profile while saving');
   const second=req('/api/private-profile/R01',{method:'PUT',cookie,json:{version:1,weightKg:81,heightCm:180,conditions:notes,confirmed:true}});
   await writeFile(join(dir,'fail-ack'),'ok');
   assert.equal((await first).status,200);
   assert.equal((await second).status,409,'queued writer rechecks profile version before staging');
   const live=await (await req('/api/private-profile/R01',{cookie})).json();assert.equal(live.profile.weightKg,80);assert.equal(live.profile.version,2);
   await stop();await start();cookie=await login(medic);
   const restored=await (await req('/api/private-profile/R01',{cookie})).json();
   assert.equal(restored.profile.weightKg,80);assert.equal(restored.persistence.state,'readback_confirmed');
   assert.equal(restored.persistence.operationId,live.persistence.operationId);
   return;
  }
  const failed=await req('/api/private-profile/R01',{method:'PUT',cookie,json:{version:1,weightKg:80,heightCm:180,conditions:'unconfirmed changed note',confirmed:true}});
  assert.equal(failed.status,503);
  const failedBody=await failed.json();
  assert.equal(failedBody.persistence.state,mode==='lost_ack'?'write_confirmed':'reconciliation_needed');
  const operationId=failedBody.persistence.operationId;
  assert.match(operationId,/^[0-9a-f-]{36}$/);
  const beforeResponse=await req('/api/private-profile/R01',{cookie});
  if(mode==='lost_ack'){
   assert.equal(beforeResponse.status,200);
   const before=await beforeResponse.json();assert.equal(before.profile.weightKg,72);assert.equal(before.profile.version,1);
   assert.equal(before.persistence.outcome,'rolled_back');
  }else{
   assert.equal(beforeResponse.status,503,'uncertain profile is not returned as confirmed');
   const blocked=await req('/api/private-profile/R01',{method:'PUT',cookie,json:{version:1,weightKg:81,heightCm:180,conditions:notes,confirmed:true}});
   assert.equal(blocked.status,503,'retry cannot silently overwrite an unresolved operation');
  }
  await stop(); await rm(join(dir,"fail-ack")); await start(); cookie=await login(medic);
  const afterResponse=await req('/api/private-profile/R01',{cookie});assert.equal(afterResponse.status,200);
  const after=await afterResponse.json();
  assert.equal(after.persistence.state,'readback_confirmed');
  if(mode==='compensation_fails'){
   assert.equal(after.profile.weightKg,80);
   assert.equal(after.profile.version,2);
   assert.equal(after.persistence.outcome,'applied','readback explicitly reconciles the ambiguous operation');
   assert.equal(after.persistence.operationId,operationId);
  }else{
   assert.equal(after.profile.weightKg,72,'failed save must not silently replace confirmed profile');
   assert.equal(after.profile.conditions,notes);assert.equal(after.profile.version,1);
   if(mode==='lost_ack')assert.equal(after.persistence.outcome,'rolled_back');
  }
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
