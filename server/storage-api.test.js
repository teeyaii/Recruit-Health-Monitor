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

test("API encrypts private profiles, restores after restart, and restricts access",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"steve-storage-test-"));
 const file=join(dir,"snapshot.json"),hook=join(dir,"fetch-mock.mjs");
 // Only this child process replaces fetch. Production has no mock/storage bypass.
 await writeFile(hook,`import {readFile,writeFile} from 'node:fs/promises';
 globalThis.fetch=async(url,options)=>{
  if(!url.startsWith('https://unit-pilot.supabase.co/rest/v1/steve_secure_state'))throw Error('unexpected target');
  if(options.method==='GET'){
   let rows=[];try{rows=[JSON.parse(await readFile(process.env.TEST_SNAPSHOT,'utf8'))];}catch(e){if(e.code!=='ENOENT')throw e;}
   return {ok:true,json:async()=>rows};
  }
  await writeFile(process.env.TEST_SNAPSHOT,options.body);return {ok:true,status:201};
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
  STEVE_DATA_ENCRYPTION_KEY:randomBytes(32).toString("base64"),TEST_SNAPSHOT:file};
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
  const notes='synthetic private test note';
  assert.equal((await req('/api/private-profile/R01',{method:'PUT',cookie,json:{version:0,weightKg:72,heightCm:180,conditions:notes,confirmed:true}})).status,200);
  status=await (await req('/api/storage/status',{cookie})).json();assert.equal(status.state,'write-confirmed');
  const stored=await readFile(file,'utf8');assert.ok(!stored.includes(notes));assert.ok(!stored.includes('test01'));
  const legacy=await login(viewer);
  assert.equal((await req('/api/private-profile/R01',{cookie:legacy})).status,403);
  assert.equal((await req('/api/private-profile/R01',{token:gateway})).status,403);
  for(const path of ['/api/roster','/api/snapshot','/api/roster/audit','/api/storage/status']){
   const r=await req(path,{cookie});assert.equal(r.status,200);assert.ok(!(await r.text()).includes(notes));
  }
  await stop();await start();cookie=await login(medic);
  const profile=await (await req('/api/private-profile/R01',{cookie})).json();
  assert.equal(profile.profile.conditions,notes);assert.equal(profile.profile.bmi,22.2);
  status=await (await req('/api/storage/status',{cookie})).json();
  assert.equal(status.state,'read-confirmed');assert.equal(status.lastWriteAt,null,'previous-process write is not claimed as a new write');
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
