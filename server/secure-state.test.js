import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {DurableState} from "./durable-state.js";
import {PrivateProfiles,bmi} from "./private-profiles.js";
import {trainingSummary} from "./training-summary.js";
import {GatewaySessions,GATEWAY_SESSION_MS,EXTENDED_GATEWAY_SESSION_MS} from "./gateway-session.js";

const env={STEVE_SUPABASE_URL:"https://unit-pilot.supabase.co",
 STEVE_SUPABASE_SERVICE_ROLE_KEY:"test-service-secret-long-and-unique-token-123",
 STEVE_DATA_ENCRYPTION_KEY:randomBytes(32).toString("base64")};
test("Supabase encrypted-state roundtrip stores only authenticated ciphertext; no secret in plaintext DB",async()=>{
 let payload=null,headers=null;const fetcher=async(url,options)=>{
  assert.ok(url.startsWith("https://unit-pilot.supabase.co/rest/v1/steve_secure_state"));
  headers=options.headers;
  if(options.method==="GET")return {ok:true,json:async()=>payload?[{envelope:payload}]:[]};
  payload=JSON.parse(options.body).envelope;
  return {ok:true,status:201};
 };
 const store=new DurableState(env,fetcher);
 const object={schema:1,roster:{slots:{}},profiles:{R01:{conditions:"ทดลองข้อมูลสุขภาพที่ไม่ใช่บุคคลจริง",weightKg:70,heightCm:175}},
  history:{R01:[[1000,80]]},conditions:{}};
 await store.save(object);
 assert.ok(payload&&payload.length>100);
 assert.ok(!payload.includes("ทดลองข้อมูลสุขภาพ"),"stored content is ciphertext");
 assert.deepEqual(await store.load(),object);
 assert.equal(headers.Authorization,"Bearer "+env.STEVE_SUPABASE_SERVICE_ROLE_KEY);
 assert.throws(()=>store.decrypt(payload.slice(0,-8)+"xxxxxx"),/./,"tampered AEAD ciphertext rejected");
});
test("partial/unsafe storage config is rejected rather than pretending to persist",()=>{
 assert.equal(new DurableState({}).enabled,false);
 assert.throws(()=>new DurableState({STEVE_SUPABASE_URL:env.STEVE_SUPABASE_URL}),/incomplete/);
 assert.throws(()=>new DurableState({...env,STEVE_DATA_ENCRYPTION_KEY:"a"}),/32 random bytes/);
 assert.throws(()=>new DurableState({...env,STEVE_SUPABASE_URL:"http://unit-pilot.supabase.co"}),/HTTPS/);
});
test("private BMI is calculated from height and weight but not persisted as extra identifying metadata",()=>{
 const store=new PrivateProfiles();
 assert.equal(bmi(72,180),22.2);
 assert.equal(bmi(null,180),null);
 assert.equal(store.get("R01","demo01").bmi,null);
 const record=store.update("R01","demo01",{version:0,weightKg:72,heightCm:180,conditions:"ข้อควรระวังสมมติ",confirmed:true});
 assert.equal(record.bmi,22.2);
 assert.equal(record.version,1);
 assert.equal(store.export().R01.bmi,undefined,"BMI only derived on read");
 assert.throws(()=>store.update("R01","demo01",{version:0,weightKg:75,heightCm:180,conditions:"x",confirmed:true}),{status:409});
 assert.equal(store.get("R01","newPerson").conditions,"","old wearer health remains private");
 store.clear("R01");
 assert.equal(store.get("R01","newPerson").weightKg,null);
 assert.throws(()=>store.update("R01","newPerson",{version:0,weightKg:55,heightCm:170,conditions:"test",confirmed:false}),{status:422});
 assert.throws(()=>store.update("R01","newPerson",{version:0,weightKg:55,heightCm:170,conditions:"<script>",confirmed:true}),{status:422});
});
test("descriptive phase summary never invents NO DATA and leaves unmarked periods unclassified",()=>{
 const origin=1_000_000;
 const out=trainingSummary([[origin+1000,90],[origin+6000,110],
   [origin+11000,72],[origin+16000,74]],
   [{at:origin+4000,phase:"training"},{at:origin+10000,phase:"hourly_rest"}],
   origin,origin+20000);
 assert.equal(out.actualSamples,4);
 assert.equal(out.unclassifiedSamples,1);
 assert.deepEqual(out.training.samples,1);
 assert.equal(out.training.mean,110);
 assert.equal(out.hourly_rest.samples,2);
 assert.equal(out.hourly_rest.mean,73);
 assert.equal(trainingSummary([],[],origin,origin+20000).training.mean,null);
});
test("G01–G03 extend to ten hours; G04–G05 remain absolute two hours",()=>{
 const s=new GatewaySessions(),now=5000;
 for(const gateway of ["G01","G02","G03"]){
  const key=s.create({headers:{}},gateway,now);
  assert.equal(s.get({headers:{cookie:"steve_gateway="+key}},now+EXTENDED_GATEWAY_SESSION_MS-1).gateway,gateway);
  assert.equal(s.get({headers:{cookie:"steve_gateway="+key}},now+EXTENDED_GATEWAY_SESSION_MS),null);
  assert.match(s.cookie(key,gateway),/Max-Age=36000/);
 }
 for(const gateway of ["G04","G05"]){
  const key=s.create({headers:{}},gateway,now);
  assert.match(s.cookie(key,gateway),/Max-Age=7200/);
  assert.equal(s.get({headers:{cookie:"steve_gateway="+key}},now+GATEWAY_SESSION_MS),null);
 }
});
