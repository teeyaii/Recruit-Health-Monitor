// SIMULATED ten-band / two-gateway integration and load test.
// This exercises the real HTTP backend with synthetic packets only. It is NOT
// evidence that one iPhone/Bluefy can hold five physical Band 10 links.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';

const G01=['R01','R02','R03','R04','R05'],G02=['R06','R07','R08','R09','R10'],G03=['R11','R12','R13','R14','R15'];
const map={G01:{},G02:{},G03:{}};
G01.forEach((r,i)=>map.G01[r]='sim-g01-'+i);G02.forEach((r,i)=>map.G02[r]='sim-g02-'+i);G03.forEach((r,i)=>map.G03[r]='sim-g03-'+i);
const device=slot=>Object.values(map).find(m=>m[slot])[slot];
const tokens={G01:'test-g01-gateway-credential-'+'a'.repeat(20),G02:'test-g02-gateway-credential-'+'b'.repeat(20),G03:'test-g03-gateway-credential-'+'c'.repeat(20)};
const viewerToken='test-viewer-credential-'+'v'.repeat(24);

async function boot(port){
 const proc=spawn(process.execPath,['index.js'],{cwd:new URL('.',import.meta.url),stdio:'ignore',env:{...process.env,
  NODE_ENV:'test',PORT:String(port),STEVE_VIEWER_TOKEN:viewerToken,
  STEVE_GATEWAY_TOKEN_G01:tokens.G01,STEVE_GATEWAY_TOKEN_G02:tokens.G02,STEVE_GATEWAY_TOKEN_G03:tokens.G03,
  STEVE_GATEWAY_TOKENS_JSON:'',STEVE_SLOT_MAP_JSON:JSON.stringify(map),STEVE_SLOT_LEASE_MS:'3000',
  STEVE_SUPABASE_URL:'',STEVE_ARCHIVE_ENABLED:'0'}});
 const base='http://127.0.0.1:'+port;
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)return {proc,base};}catch{}await delay(100);}
 proc.kill();throw Error('server did not start');
}
async function stop(proc){if(proc.exitCode===null){const e=once(proc,'exit');proc.kill();await e;}}
async function phone(base,gateway){
 const r=await fetch(base+'/api/gateway/session',{method:'POST',headers:{Authorization:'Bearer '+tokens[gateway],'X-STEVE-Gateway':'1'}});
 assert.equal(r.status,200);
 const cookie=r.headers.get('set-cookie').split(';')[0];
 return (readings)=>fetch(base+'/api/ingest',{method:'POST',headers:{Cookie:cookie,'X-STEVE-Gateway':'1','Content-Type':'application/json'},
  body:JSON.stringify({gateway,source:'GATEWAY',readings})});
}
async function viewer(base){
 const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:viewerToken})});
 assert.equal(r.status,200);const cookie=r.headers.get('set-cookie').split(';')[0];
 return async()=>{const s=await fetch(base+'/api/snapshot',{headers:{Cookie:cookie}});assert.equal(s.status,200);
  return new Map((await s.json()).recruits.map(x=>[x.id,x]));};
}
// The Bluefy page sends one reading per request, one request per watch per second.
const one=(send,slot,hr,timestamp,state)=>send([{id:slot,device_id:device(slot),hr,timestamp,...(state?{state}:{})}]);

test('SIMULATED: two gateways x five bands publish concurrently with correct identity, latest BPM, no duplicates, stale isolation and restart recovery',{timeout:90000},async()=>{
 const port=26000+Math.floor(Math.random()*2000);
 let {proc,base}=await boot(port);
 try{
  const g01=await phone(base,'G01'),g02=await phone(base,'G02'),snap=await viewer(base);
  // 1. Concurrent load: 10 bands, 20 rounds, both gateways in parallel (200 requests).
  const expected=new Map();let accepted=0,requests=0;const started=Date.now();
  for(let round=0;round<20;round++){
   const ts=Date.now();
   const batch=[...G01.map((slot,i)=>[g01,slot,60+i+round]),...G02.map((slot,i)=>[g02,slot,100+i+round])];
   const results=await Promise.all(batch.map(async([send,slot,hr])=>{
    expected.set(slot,hr);const r=await one(send,slot,hr,ts+1);requests++;assert.equal(r.status,200);return (await r.json()).accepted;}));
   accepted+=results.reduce((a,b)=>a+b,0);
   await delay(5);
  }
  assert.equal(accepted,200,'every fresh unique sample acknowledged exactly once');
  assert.ok(Date.now()-started<15000,'200 ingest requests complete well under the 15 s freshness budget');
  let view=await snap();
  for(const slot of [...G01,...G02]){
   const r=view.get(slot);
   assert.equal(r.state,'CONNECTED',slot);assert.equal(r.hr,expected.get(slot),slot+' shows latest BPM');
   assert.equal(r.gateway,G01.includes(slot)?'G01':'G02',slot+' attributed to its own gateway');
  }
  for(const slot of G03)assert.equal(view.get(slot).hr,null,'R11–R15 remain NO DATA, never inferred');
  // 2. Duplicate / older / replayed timestamp is dropped.
  const last=view.get('R01').timestamp;
  assert.equal((await (await one(g01,'R01',150,last)).json()).accepted,0,'duplicate timestamp rejected');
  assert.equal((await (await one(g01,'R01',150,last-500)).json()).accepted,0,'older sample rejected');
  assert.equal((await snap()).get('R01').hr,expected.get('R01'));
  // 3. Cross-gateway: G02 can never write a G01 slot, even with the right opaque id.
  assert.equal((await (await one(g02,'R01',140,Date.now())).json()).accepted,0);
  assert.equal((await (await one(g01,'R06',140,Date.now())).json()).accepted,0);
  // 4. Wrong device id for own slot is rejected (no wrong-wearer association).
  assert.equal((await (await g01([{id:'R02',device_id:'sim-g02-1',hr:99,timestamp:Date.now()}])).json()).accepted,0);
  // 5. A second live phone for G01 cannot steal a slot while the owner is active.
  const g01b=await phone(base,'G01');
  assert.equal((await one(g01b,'R01',90,Date.now())).status,409);
  // 6. Explicit disconnect clears current BPM; nothing shows LIVE.
  assert.equal((await (await one(g01,'R03',null,Date.now(),'DISCONNECTED')).json()).accepted,1);
  view=await snap();assert.equal(view.get('R03').state,'DISCONNECTED');assert.equal(view.get('R03').hr,null);
  // 7. G02 goes silent (phone lost). G01 keeps streaming. After 15 s G02 slots are STALE, G01 stay LIVE.
  const keepAlive=(async()=>{for(let i=0;i<17;i++){const ts=Date.now();await Promise.all(['R01','R02','R04','R05'].map((s,k)=>one(g01,s,70+k,ts)));await delay(1000);}})();
  await delay(4000);
  // Replacement G02 phone takes over after the owner lease (3 s in this test, 120 s default).
  const g02b=await phone(base,'G02');
  assert.equal((await (await one(g02b,'R06',111,Date.now())).json()).accepted,1,'replacement phone can resume a silent gateway');
  await delay(13000);await keepAlive;
  view=await snap();
  for(const slot of ['R07','R08','R09','R10']){assert.equal(view.get(slot).stale,true,slot);assert.equal(view.get(slot).hr,null,slot+' stale value never LIVE');}
  for(const slot of ['R01','R02','R04','R05'])assert.equal(view.get(slot).state,'CONNECTED',slot+' unaffected by G02 loss');
  // 8. Backend restart (Render redeploy): cookies become invalid -> 401, re-login recovers.
  await stop(proc);({proc,base}=await boot(port));
  assert.equal((await one(g01,'R01',72,Date.now())).status,401,'old browser session rejected after restart');
  const again=await phone(base,'G01');
  assert.equal((await (await one(again,'R01',73,Date.now())).json()).accepted,1);
  assert.equal((await (await viewer(base))()).get('R01').hr,73);
 }finally{await stop(proc);}
});
