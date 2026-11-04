import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";

const port=26000+Math.floor(Math.random()*1000),base="http://127.0.0.1:"+port;
const viewer="test-operator-viewer-secret-more-than-32-characters";
const gateway="test-command-g01-secret-more-than-32-characters";
async function wait(){
 for(let i=0;i<80;i++){try{if((await fetch(base+"/health")).ok)return;}catch{}await delay(100);}
 throw Error("Commander test backend did not boot");
}
async function request(path,{method="GET",cookie,token,body,origin}={}){
 const headers={...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:"Bearer "+token}:{}),
  ...(body!==undefined?{"Content-Type":"application/json"}:{}),...(origin?{Origin:origin}:{})};
 const r=await fetch(base+path,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const text=await r.text();let json;try{json=JSON.parse(text);}catch{}
 return {status:r.status,headers:r.headers,json,text};
}
test("Commander private read-only link has strict isolation, redacted data, rotation, revoke and CSRF protection",async()=>{
 const proc=spawn(process.execPath,["index.js"],{cwd:new URL(".",import.meta.url),
  env:{...process.env,PORT:String(port),NODE_ENV:"test",COOKIE_SECURE:"1",
   STEVE_TEST_EPHEMERAL_COMMANDER:"1",STEVE_DEMO_MODE:"",STEVE_SYNTHETIC_MODE:"",
   STEVE_VIEWER_TOKEN:viewer,STEVE_GATEWAY_TOKEN_G01:gateway,
   STEVE_SLOT_MAP_JSON:JSON.stringify({G01:{R01:"test-opaque-band-one"}}),
   STEVE_SUPABASE_URL:"",STEVE_SUPABASE_SERVICE_ROLE_KEY:"",STEVE_DATA_ENCRYPTION_KEY:""},
  stdio:"pipe"});
 try{
  await wait();
  let r=await request("/commander");
  assert.equal(r.status,200);assert.match(r.text,/สรุปการเฝ้าระวัง/);
  assert.ok(!r.text.includes("จอผู้บังคับบัญชา"));
  assert.match(r.headers.get("referrer-policy"),/no-referrer/);
  assert.equal((await request("/api/commander/snapshot")).status,401);
  assert.equal((await request("/api/commander/share",{method:"POST"})).status,403);

  r=await request("/api/login",{method:"POST",body:{token:viewer}});assert.equal(r.status,200);
  const operatorCookie=r.headers.get("set-cookie")?.split(";")[0];assert.ok(operatorCookie);
  r=await request("/api/roster/R01",{method:"PUT",cookie:operatorCookie,
   body:{version:0,code:"A001-PRIVATE-WEARER",restriction:"watch",observation:"none"}});
  assert.equal(r.status,200);
  r=await request("/api/ingest",{method:"POST",token:gateway,body:{gateway:"G01",readings:[
   {id:"R01",device_id:"test-opaque-band-one",hr:78,timestamp:Date.now()}]}});
  assert.equal(r.json.accepted,1);
  assert.equal((await request("/api/commander/snapshot",{cookie:operatorCookie})).status,401,
   "An operator cookie must not silently authorize the separate commander viewer endpoint");
  assert.equal((await request("/api/commander/share",{method:"POST",cookie:operatorCookie,origin:"https://evil.example"})).status,403);
  r=await request("/api/commander/share",{method:"POST",cookie:operatorCookie});
  assert.equal(r.status,200);
  const first=r.json.token;assert.match(first,/^[A-Za-z0-9_-]{43}$/);
  assert.ok(!JSON.stringify(r.json).includes("A001-PRIVATE-WEARER"));
  assert.equal((await request("/api/commander/auth",{method:"POST",body:{token:"wrong"}})).status,401);
  r=await request("/api/commander/auth",{method:"POST",body:{token:first}});
  assert.equal(r.status,200);
  assert.match(r.headers.get("set-cookie"),/HttpOnly/);
  assert.match(r.headers.get("set-cookie"),/SameSite=Strict/);
  assert.match(r.headers.get("set-cookie"),/Path=\/api\/commander\//);
  const commandCookie=r.headers.get("set-cookie").split(";")[0];
  r=await request("/api/commander/snapshot",{cookie:commandCookie});
  assert.equal(r.status,200);
  assert.equal(r.json.people.find(p=>p.id==="R01").risk,"WATCH");
  assert.equal(r.json.people.find(p=>p.id==="R01").hr,78);
  assert.equal(r.json.people.find(p=>p.id==="R01").registered,true);
  assert.equal(r.json.people.find(p=>p.id==="R01").displayCode,"A001-PRIVATE-WEARER",
   "authorized private view shows the assigned display identifier for each watch");
  assert.ok(!JSON.stringify(r.json).includes("test-opaque-band-one"));
  assert.ok(!JSON.stringify(r.json).includes("medications"));
  assert.ok(!JSON.stringify(r.json).includes("conditions"));
  assert.ok(!JSON.stringify(r.json).includes(first));
  for(const [path,method,body] of [
   ["/api/roster","GET",undefined],["/api/roster/R01","PUT",{version:1,code:"BAD",restriction:"none",observation:"none"}],
   ["/api/training","PUT",{phase:"training",version:0}],
   ["/api/context","POST",{wbgtC:25}],["/api/private-profile/R01","GET",undefined],
   ["/api/medic-reviews/R01","GET",undefined],
   ["/api/ingest","POST",{gateway:"G01",readings:[]}],
   ["/api/gateway/provision","GET",undefined]
  ]){
   const denied=await request(path,{method,cookie:commandCookie,body});
   assert.ok(denied.status===401||denied.status===403,path+" must reject commander cookie");
  }
  assert.equal((await request("/api/commander/status",{cookie:commandCookie})).status,403);
  assert.equal((await request("/api/commander/revoke",{method:"POST",cookie:commandCookie})).status,403);
  assert.equal((await request("/api/commander/revoke",{method:"POST",cookie:operatorCookie,origin:"https://evil.example"})).status,403);
  assert.equal((await request("/api/commander/share",{method:"POST",cookie:operatorCookie,origin:"https://evil.example"})).status,403);
  r=await request("/api/commander/share",{method:"POST",cookie:operatorCookie});
  const second=r.json.token;assert.notEqual(second,first);
  assert.equal((await request("/api/commander/snapshot",{cookie:commandCookie})).status,401);
  assert.equal((await request("/api/commander/auth",{method:"POST",body:{token:first}})).status,401);
  r=await request("/api/commander/auth",{method:"POST",body:{token:second}});
  assert.equal(r.status,200);
  const secondCookie=r.headers.get("set-cookie").split(";")[0];
  assert.equal((await request("/api/commander/snapshot",{cookie:secondCookie})).status,200);
  assert.equal((await request("/api/commander/revoke",{method:"POST",cookie:operatorCookie})).status,200);
  assert.equal((await request("/api/commander/snapshot",{cookie:secondCookie})).status,401);
  assert.equal((await request("/api/commander/auth",{method:"POST",body:{token:second}})).status,401);
  r=await request("/api/snapshot",{cookie:operatorCookie});assert.equal(r.status,200);
 }finally{proc.kill();}
});
