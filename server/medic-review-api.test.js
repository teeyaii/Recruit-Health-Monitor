import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {setTimeout as sleep} from "node:timers/promises";

test("Medic Review API has count-only legacy access and private trainer/medic gate",async()=>{
 const port=32000+Math.floor(Math.random()*3000),host="http://127.0.0.1:"+port;
 const viewer="medic-review-viewer-test-long-token-000001";
 const trainer="medic-review-trainer-test-long-token-000001";
 const medic="medic-review-medic-test-long-token-000001";
 const gateway="medic-review-gateway-test-long-token-000001";
 const env={...process.env,PORT:String(port),NODE_ENV:"production",COOKIE_SECURE:"1",
  STEVE_VIEWER_TOKEN:viewer,STEVE_TRAINER_TOKEN:trainer,STEVE_MEDIC_TOKEN:medic,
  STEVE_GATEWAY_TOKEN_G01:gateway,STEVE_GATEWAY_TOKENS_JSON:"",
  STEVE_SLOT_MAP_JSON:JSON.stringify({G01:{R01:"opaque-device-a"}}),
  STEVE_SUPABASE_URL:"",STEVE_SUPABASE_SERVICE_ROLE_KEY:"",STEVE_DATA_ENCRYPTION_KEY:"",
  STEVE_ARCHIVE_ENABLED:"0"};
 const proc=spawn(process.execPath,["index.js"],{cwd:new URL(".",import.meta.url),env,stdio:"ignore"});
 try{
  let ready=false;
  for(let i=0;i<80;i++){try{if((await fetch(host+"/health")).ok){ready=true;break;}}catch{}await sleep(100);}
  assert.equal(ready,true);
  const login=async token=>{
   const r=await fetch(host+"/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});
   assert.equal(r.status,200);return r.headers.get("set-cookie").split(";")[0];
  };
  const legacy=await login(viewer),clinician=await login(medic);
  const req=async(p,cookie,opts={})=>fetch(host+p,{headers:{Cookie:cookie,...(opts.headers||{})},...opts});
  const count=await req("/api/medic-reviews/summary",legacy);
  assert.equal(count.status,200);
  assert.deepEqual(await count.json(),{pending:0},"legacy receives count only, never reason/notes");
  assert.equal((await req("/api/medic-reviews/R01",legacy)).status,403);
  assert.equal((await req("/api/medic-reviews/R01",clinician)).status,503,"encrypted storage must be configured");
  assert.equal((await fetch(host+"/api/medic-reviews/summary",{headers:{Authorization:"Bearer "+gateway}})).status,403);
  assert.equal((await fetch(host+"/api/medic-reviews/R01",{headers:{Authorization:"Bearer "+gateway}})).status,403);
 }finally{proc.kill();await sleep(100);}
});
