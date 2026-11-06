// Issue #71: SIMULATED ONLY. Real HTTP handlers, isolated child clock and
// encrypted persistence with a local transport double. No external service/BLE.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';

const slots=Array.from({length:10},(_,i)=>'R'+String(i+1).padStart(2,'0'));
const map={G01:{},G02:{}};
slots.forEach((s,i)=>map[i<5?'G01':'G02'][s]='qa-device-'+s);
const initial=1793900000000;
async function lab(t,{synthetic=false}={}){
 const dir=await mkdtemp(join(tmpdir(),'steve-independent-qa-'));
 const clock=join(dir,'clock'),state=join(dir,'state'),hook=join(dir,'hook.mjs');
 let now=initial,child,base;
 const tokens=Object.fromEntries(['viewer','trainer','medic','G01','G02'].map(r=>[r,randomBytes(32).toString('hex')]));
 await writeFile(clock,String(now));
 await writeFile(hook,`
import {readFileSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
Date.now=()=>Number(readFileSync(process.env.QA_CLOCK,'utf8'));
globalThis.fetch=async(url,options)=>{
 if(!String(url).startsWith('https://unit-independent-qa.supabase.co/rest/v1/steve_secure_state'))throw Error('External network forbidden');
 if(options.method==='GET'){
  let rows=[];try{rows=[JSON.parse(await readFile(process.env.QA_STATE,'utf8'))];}catch(e){if(e.code!=='ENOENT')throw e;}
  return {ok:true,json:async()=>rows};
 }
 await writeFile(process.env.QA_STATE,options.body);return {ok:true,status:201};
};`);
 const env={PATH:process.env.PATH,NODE_ENV:'test',COOKIE_SECURE:'1',
  STEVE_VIEWER_TOKEN:tokens.viewer,STEVE_TRAINER_TOKEN:tokens.trainer,STEVE_MEDIC_TOKEN:tokens.medic,
  STEVE_GATEWAY_TOKEN_G01:tokens.G01,STEVE_GATEWAY_TOKEN_G02:tokens.G02,
  STEVE_SLOT_MAP_JSON:JSON.stringify(map),STEVE_SYNTHETIC_MODE:synthetic?'1':'0',
  STEVE_SUPABASE_URL:'https://unit-independent-qa.supabase.co',STEVE_SUPABASE_SERVICE_ROLE_KEY:'sb_secret_'+randomBytes(32).toString('hex'),
  STEVE_DATA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),STEVE_ARCHIVE_ENABLED:'0',QA_CLOCK:clock,QA_STATE:state};
 const stop=async()=>{if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}};
 t.after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});
 const boot=async()=>{
  const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));base='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['--import',pathToFileURL(hook).href,'index.js'],{cwd:new URL('.',import.meta.url),env:{...env,PORT:String(port)},stdio:'ignore'});
  for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)return;}catch{}if(child.exitCode!==null)break;await delay(25);}
  throw Error('isolated backend failed to start');
 };
 const req=async(path,{method='GET',cookie,token,body,headers={}}={})=>{
  const response=await fetch(base+path,{method,headers:{'X-STEVE-Gateway':'1',...headers,...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 };
 const login=async(role)=>{const r=await req('/api/login',{method:'POST',body:{token:tokens[role]}});assert.equal(r.status,200);return r.cookie;};
 const phone=async(gateway)=>{const r=await req('/api/gateway/session',{method:'POST',token:tokens[gateway],headers:{'X-STEVE-Gateway':'1'}});assert.equal(r.status,200);return r.cookie;};
 const sample=(id,extra={})=>({id,device_id:'qa-device-'+id,hr:80+slots.indexOf(id),timestamp:now,...extra});
 const ingest=(gateway,cookie,readings,extra={})=>req('/api/ingest',{method:'POST',cookie,headers:{'X-STEVE-Gateway':'1'},body:{gateway,source:synthetic?'SIMULATED':'GATEWAY',readings,...extra}});
 const advance=async(ms)=>{now+=ms;await writeFile(clock+'.tmp',String(now));await rename(clock+'.tmp',clock);};
 const enroll=async(cookie,id,extra={})=>{const r=await req('/api/roster/'+id,{method:'PUT',cookie,body:{version:0,code:'QA_'+id,restriction:'none',observation:'none',...extra}});assert.equal(r.status,200);return r;};
 await boot();
 return {req,login,phone,sample,ingest,advance,enroll,now:()=>now,restart:async()=>{await stop();await boot();}};
}
const snapshot=async(h,cookie)=>(await h.req('/api/snapshot',{cookie})).data.recruits;

test('SIMULATED: ten slots reject wrong identity, replay, invalid time/state and unauthorized writers',async t=>{
 const h=await lab(t),viewer=await h.login('viewer'),a=await h.phone('G01'),b=await h.phone('G02');
 for(const [g,c,ids] of [['G01',a,slots.slice(0,5)],['G02',b,slots.slice(5)]]){
  const results=await Promise.all(ids.map(id=>h.ingest(g,c,[h.sample(id)])));
  for(const r of results){assert.equal(r.status,200);assert.equal(r.data.accepted,1);}
 }
 const before=await snapshot(h,viewer);
 await h.advance(1);
 for(const [g,c,id,extra] of [
  ['G01',a,'R06',{}],['G02',b,'R05',{}],['G01',a,'R01',{device_id:'qa-device-R02'}],
  ['G01',a,'R01',{timestamp:initial}],['G01',a,'R01',{timestamp:initial-1}],
  ['G01',a,'R01',{timestamp:h.now()-15001}],['G01',a,'R01',{timestamp:h.now()+1001}],
  ...['STALE','NO DATA',null,'UNKNOWN'].map(state=>['G01',a,'R01',{state}]),
  ...[null,0,241,80.5].map(hr=>['G01',a,'R01',{hr}])]){
  const r=await h.ingest(g,c,[h.sample(id,extra)]);assert.equal(r.status,200);assert.equal(r.data.accepted,0,JSON.stringify(extra));
 }
 assert.equal((await h.ingest('G02',a,[h.sample('R06')])).status,403);
 assert.equal((await h.ingest('G01',undefined,[h.sample('R01')])).status,401);
 assert.equal((await h.ingest('G01',viewer,[h.sample('R01')])).status,403);
 assert.deepEqual((await snapshot(h,viewer)).map(r=>[r.id,r.hr,r.timestamp]),before.map(r=>[r.id,r.hr,r.timestamp]));
 const duplicate=await h.ingest('G01',a,[h.sample('R01'),h.sample('R01',{hr:99,timestamp:h.now()+1})]);
 assert.equal(duplicate.data.accepted,1);assert.equal((await snapshot(h,viewer))[0].hr,80);
});

test('SIMULATED: 15 s TTL boundary, disappearing G02, and online heartbeat is not per-slot LIVE',async t=>{
 const h=await lab(t),v=await h.login('viewer'),a=await h.phone('G01'),b=await h.phone('G02');
 assert.equal((await h.ingest('G01',a,slots.slice(0,5).map(id=>h.sample(id)))).data.accepted,5);
 assert.equal((await h.ingest('G02',b,slots.slice(5).map(id=>h.sample(id)))).data.accepted,5);
 await h.advance(15000);
 assert.ok((await snapshot(h,v)).slice(0,10).every(r=>r.state==='CONNECTED'));
 await h.advance(1);
 await h.ingest('G01',a,slots.slice(0,5).map(id=>h.sample(id)));
 let rows=await snapshot(h,v);
 assert.ok(rows.slice(0,5).every(r=>r.state==='CONNECTED'));
 assert.ok(rows.slice(5,10).every(r=>r.state==='STALE'&&r.hr===null&&!r.gatewayOnline));
 // CODE REVIEW finding: an authenticated empty/rejected batch updates gateway liveness.
 assert.equal((await h.ingest('G02',b,[])).data.accepted,0);
 rows=await snapshot(h,v);
 assert.ok(rows.slice(5,10).every(r=>r.gatewayOnline&&r.state==='STALE'&&r.hr===null));
 assert.equal((await h.req('/api/gateways',{cookie:v})).data.gateways.find(g=>g.id==='G02').online,true);
 await h.advance(1);
 await h.ingest('G02',b,[h.sample('R06')]);
 rows=await snapshot(h,v);assert.equal(rows[5].state,'CONNECTED');
 assert.ok(rows.slice(6,10).every(r=>r.hr===null),'one recovered slot cannot revive peers');
});

test('SIMULATED: default 120 s owner lease rejects at boundary, permits takeover after it, logout releases ownership',async t=>{
 const h=await lab(t),a=await h.phone('G01'),replacement=await h.phone('G01'),b=await h.phone('G02');
 await h.ingest('G01',a,[h.sample('R01')]);
 await h.advance(120000);
 assert.equal((await h.ingest('G01',replacement,[h.sample('R01')])).status,409);
 assert.equal((await h.ingest('G02',b,[h.sample('R06')])).data.accepted,1);
 await h.advance(1);
 assert.equal((await h.ingest('G01',replacement,[h.sample('R01')])).data.accepted,1);
 await h.advance(1);
 assert.equal((await h.ingest('G01',a,[h.sample('R01')])).status,409);
 assert.equal((await h.req('/api/gateway/session',{method:'DELETE',cookie:replacement,headers:{'X-STEVE-Gateway':'1'}})).status,200);
 assert.equal((await h.ingest('G01',a,[h.sample('R01')])).data.accepted,1);
});

test('SIMULATED: EMERGENCY and pending case survive disconnect, stale timeout and encrypted restart; access stays private',async t=>{
 const h=await lab(t),medic=await h.login('medic'),trainer=await h.login('trainer'),viewer=await h.login('viewer'),a=await h.phone('G01');
 await h.enroll(medic,'R01',{observation:'confusion_collapse_seizure'});
 await h.enroll(medic,'R02');
 assert.equal((await h.req('/api/medic-reviews/R01',{method:'PUT',cookie:medic,body:{version:0,action:'request',reason:'other',note:'QA synthetic case'}})).status,200);
 assert.equal((await h.req('/api/private-profile/R01',{method:'PUT',cookie:medic,body:{version:0,confirmed:true,weightKg:null,heightCm:null,conditions:'QA_PRIVATE_MARKER'}})).status,200);
 for(const route of ['/api/private-profile/R01','/api/medic-reviews/R01']){
  assert.equal((await h.req(route)).status,401);
  for(const cookie of [viewer,a]){
   assert.equal((await h.req(route,{cookie})).status,cookie===a?401:403);
   assert.equal((await h.req(route,{method:'PUT',cookie,body:{version:1,action:'close'}})).status,cookie===a?401:403);
  }
  assert.equal((await h.req(route,{cookie:trainer})).status,200,'current contract intentionally permits trainer and medic');
 }
 const share=await h.req('/api/commander/share',{method:'POST',cookie:trainer});
 const commander=(await h.req('/api/commander/auth',{method:'POST',body:{token:share.data.token}})).cookie;
 await h.ingest('G01',a,[h.sample('R01')]);await h.advance(1);
 await h.ingest('G01',a,[h.sample('R01',{hr:null,state:'DISCONNECTED'})]);
 await h.advance(15001);
 let view=(await h.req('/api/commander/snapshot',{cookie:commander})).data;
 assert.equal(view.people.find(p=>p.id==='R01').risk,'EMERGENCY');
 assert.equal(view.people.find(p=>p.id==='R01').hr,null);
 assert.equal(view.people.find(p=>p.id==='R02').state,'NO DATA');
 assert.notEqual(view.people.find(p=>p.id==='R02').risk,'NORMAL');
 assert.equal(view.medicPending,1);assert.doesNotMatch(JSON.stringify(view),/QA_PRIVATE_MARKER|conditions|medications/);
 assert.equal((await h.req('/api/private-profile/R01',{cookie:commander})).status,401);
 await h.restart();
 assert.equal((await h.ingest('G01',a,[h.sample('R01')])).status,401);
 assert.equal((await h.req('/api/snapshot',{cookie:viewer})).status,401);
 const again=await h.login('medic');
 assert.equal((await h.req('/api/roster',{cookie:again})).data.slots[0].observation,'confusion_collapse_seizure');
 assert.equal((await h.req('/api/medic-reviews/R01',{cookie:again})).data.review.status,'pending');
 assert.ok((await snapshot(h,again)).every(r=>r.hr===null));
 const reconnect=await h.phone('G01');await h.advance(1);
 assert.equal((await h.ingest('G01',reconnect,[h.sample('R01')])).data.accepted,1);
});

test('SIMULATED: synthetic ten-watch training never creates automatic medical cases',async t=>{
 const h=await lab(t,{synthetic:true}),m=await h.login('medic'),a=await h.phone('G01'),b=await h.phone('G02');
 for(const id of slots){
  await h.enroll(m,id);
  assert.equal((await h.req('/api/private-profile/'+id,{method:'PUT',cookie:m,body:{version:0,confirmed:true,weightKg:null,heightCm:null,conditions:'',reviewThresholdBpm:150,reviewThresholdConfirmed:true}})).status,200);
 }
 await h.req('/api/training',{method:'PUT',cookie:m,body:{version:0,phase:'training'}});
 for(let i=0;i<6;i++){
  await h.advance(7000);
  for(const [g,c,ids] of [['G01',a,slots.slice(0,5)],['G02',b,slots.slice(5)]])assert.equal((await h.ingest(g,c,ids.map(id=>h.sample(id,{hr:160})))).data.accepted,5);
 }
 assert.deepEqual((await h.req('/api/medic-reviews/summary',{cookie:m})).data,{pending:0});
 assert.ok((await snapshot(h,m)).slice(0,10).every(r=>r.source==='SIMULATED'&&!r.autoCheck&&r.autoAlert===null));
 assert.equal((await h.ingest('G01',a,[h.sample('R01')],{source:'GATEWAY'})).status,422);
});

test('SIMULATED: reassignment clears previous BPM and rejects queued old samples before restart',async t=>{
 const h=await lab(t),m=await h.login('medic'),a=await h.phone('G01');
 await h.enroll(m,'R01');await h.advance(1);const old=h.sample('R01');
 await h.ingest('G01',a,[old]);await h.advance(1);
 assert.equal((await h.req('/api/roster/R01',{method:'PUT',cookie:m,body:{version:1,code:'QA_NEW',restriction:'none',observation:'none'}})).status,200);
 assert.equal((await snapshot(h,m))[0].hr,null);
 assert.equal((await h.ingest('G01',a,[old])).data.accepted,0);
 await h.advance(1);assert.equal((await h.ingest('G01',a,[h.sample('R01')])).data.accepted,1);
});

test('SIMULATED: reproduce previous-wearer replay across encrypted restart',async t=>{
 const h=await lab(t),m=await h.login('medic'),a=await h.phone('G01');
 await h.enroll(m,'R01');await h.advance(1);const old=h.sample('R01');
 await h.ingest('G01',a,[old]);await h.advance(1);
 assert.equal((await h.req('/api/roster/R01',{method:'PUT',cookie:m,body:{version:1,code:'QA_NEW',restriction:'none',observation:'none'}})).status,200);
 assert.equal((await h.ingest('G01',a,[old])).data.accepted,0);
 await h.restart();const newPhone=await h.phone('G01');
 const replay=await h.ingest('G01',newPhone,[old]);
 assert.equal(replay.status,200);
 await t.test('P1: previous wearer packet must not be attached to QA_NEW after restart',{todo:process.env.STEVE_QA_ENFORCE_KNOWN_DEFECTS==='1'?false:'Issue #71: persist reassignment cutoff before accepting queued frames'},()=>{
  assert.equal(replay.data.accepted,0);
 });
});

test('SIMULATED: disconnect refreshes ownership; source spoofing and cross-origin cookie writes fail closed',async t=>{
 const h=await lab(t),a=await h.phone('G01'),other=await h.phone('G01');
 await h.ingest('G01',a,[h.sample('R01')]);await h.advance(119999);
 assert.equal((await h.ingest('G01',a,[h.sample('R01',{state:'DISCONNECTED',hr:null})])).data.accepted,1);
 await h.advance(2);
 assert.equal((await h.ingest('G01',other,[h.sample('R01')])).status,409,'disconnect is not a relinquishment');
 assert.equal((await h.ingest('G01',a,[h.sample('R01')],{source:'SIMULATED'})).status,422);
 assert.equal((await h.req('/api/ingest',{method:'POST',cookie:a,headers:{Origin:'https://foreign.invalid'},body:{gateway:'G01',readings:[h.sample('R01')]}})).status,401);
 assert.equal((await h.ingest('G01',a,[h.sample('R01')])).data.accepted,1,'same owner reconnects');
 await h.advance(10*60*60*1000);
 assert.equal((await h.ingest('G01',a,[h.sample('R01')])).status,401,'expired browser session cannot write');
 });
