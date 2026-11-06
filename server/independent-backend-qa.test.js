// Issues #71 / #74: SIMULATED ONLY. Real HTTP handlers, isolated child clock and
// encrypted persistence with a local transport double. No external service/BLE.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,writeFile,readFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {DurableState} from './durable-state.js';

const slots=Array.from({length:10},(_,i)=>'R'+String(i+1).padStart(2,'0'));
const map={G01:{},G02:{}};
slots.forEach((s,i)=>map[i<5?'G01':'G02'][s]='qa-device-'+s);
const initial=1793900000000;
async function lab(t,{synthetic=false,archive=false}={}){
 const dir=await mkdtemp(join(tmpdir(),'steve-independent-qa-'));
 const clock=join(dir,'clock'),state=join(dir,'state'),hook=join(dir,'hook.mjs');
 const control=join(dir,'control'),entered=join(dir,'entered'),release=join(dir,'release'),archiveFile=join(dir,'archive');
 let now=initial,child,base;
 const tokens=Object.fromEntries(['viewer','trainer','medic','G01','G02'].map(r=>[r,randomBytes(32).toString('hex')]));
 await writeFile(clock,String(now));
 await writeFile(hook,`
import {readFileSync} from 'node:fs';
import {readFile,writeFile,rename} from 'node:fs/promises';
Date.now=()=>Number(readFileSync(process.env.QA_CLOCK,'utf8'));
if(process.env.QA_FAST_ARCHIVE==='1'){
 const interval=globalThis.setInterval;globalThis.setInterval=(fn,ms,...args)=>interval(fn,ms===30000?50:ms,...args);
}
const atomic=async(file,value)=>{await writeFile(file+'.tmp',value);await rename(file+'.tmp',file);};
globalThis.fetch=async(url,options)=>{
 if(String(url).startsWith('https://unit-independent-qa.supabase.co/rest/v1/steve_hr_archive')){
  const q=new URL(url).searchParams;
  let rows=[];try{rows=JSON.parse(await readFile(process.env.QA_ARCHIVE,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(options.method==='POST')for(const row of JSON.parse(options.body)){
   rows=rows.filter(r=>!(r.slot===row.slot&&r.owner===row.owner&&r.minute_ms===row.minute_ms));rows.push(row);
  }
  if(options.method==='DELETE')rows=rows.filter(r=>q.has('slot')?r.slot!==q.get('slot').slice(3):r.minute_ms>=Number(q.get('minute_ms').slice(3)));
  if(options.method==='GET'){
   if(q.get('limit')==='0')return {ok:true,json:async()=>[]};
   const selected=rows.filter(r=>(!q.has('slot')||r.slot===q.get('slot').slice(3))&&(!q.has('owner')||r.owner===q.get('owner').slice(3)));
   return {ok:true,json:async()=>selected};
  }
  await atomic(process.env.QA_ARCHIVE,JSON.stringify(rows));return {ok:true,status:201};
 }
 if(!String(url).startsWith('https://unit-independent-qa.supabase.co/rest/v1/steve_secure_state'))throw Error('External network forbidden');
 if(options.method==='GET'){
  let rows=[];try{rows=[JSON.parse(await readFile(process.env.QA_STATE,'utf8'))];}catch(e){if(e.code!=='ENOENT')throw e;}
  return {ok:true,json:async()=>rows};
 }
 let mode='';try{mode=await readFile(process.env.QA_CONTROL,'utf8');}catch{}
 if(mode!=='fail-always')await writeFile(process.env.QA_CONTROL,'');
 if(mode.startsWith('hold')){
  await writeFile(process.env.QA_ENTERED,'1');
  while(true){try{await readFile(process.env.QA_RELEASE);break;}catch{}await new Promise(r=>setTimeout(r,10));}
 }
 if(mode==='fail-before'||mode==='fail-always'||mode==='hold-fail')return {ok:false,status:503};
 await atomic(process.env.QA_STATE,options.body);
 if(mode==='fail-after-rollback-fails'){await writeFile(process.env.QA_CONTROL,'fail-always');return {ok:false,status:503};}
 if(mode==='fail-after')return {ok:false,status:503};
 return {ok:true,status:201};
};`);
 const env={PATH:process.env.PATH,NODE_ENV:'test',COOKIE_SECURE:'1',
  STEVE_VIEWER_TOKEN:tokens.viewer,STEVE_TRAINER_TOKEN:tokens.trainer,STEVE_MEDIC_TOKEN:tokens.medic,
  STEVE_GATEWAY_TOKEN_G01:tokens.G01,STEVE_GATEWAY_TOKEN_G02:tokens.G02,
  STEVE_SLOT_MAP_JSON:JSON.stringify(map),STEVE_SYNTHETIC_MODE:synthetic?'1':'0',
  STEVE_SUPABASE_URL:'https://unit-independent-qa.supabase.co',STEVE_SUPABASE_SERVICE_ROLE_KEY:'sb_secret_'+randomBytes(32).toString('hex'),
  STEVE_DATA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),STEVE_ARCHIVE_ENABLED:archive?'1':'0',QA_FAST_ARCHIVE:archive?'1':'0',QA_ARCHIVE:archiveFile,QA_CLOCK:clock,QA_STATE:state,QA_CONTROL:control,QA_ENTERED:entered,QA_RELEASE:release};
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
 const codec=new DurableState(env);
 const stored=async()=>codec.decrypt(JSON.parse(await readFile(state,'utf8')).envelope);
 const rewrite=async(fn)=>{const data=await stored();fn(data);await writeFile(state,JSON.stringify({id:'primary',envelope:codec.encrypt(data)}));};
 const controlSave=async mode=>{await rm(entered,{force:true});await rm(release,{force:true});await writeFile(control,mode);};
 const waitHeld=async()=>{for(let i=0;i<200;i++){try{await readFile(entered);return;}catch{}await delay(10);}throw Error('save did not reach hold');};
 await boot();
 return {archiveRows:async()=>{try{return JSON.parse(await readFile(archiveFile,'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw e;}},stored,rewrite,controlSave,waitHeld,releaseSave:()=>writeFile(release,'1'),req,login,phone,sample,ingest,advance,enroll,now:()=>now,restart:async()=>{await stop();await boot();}};
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
 await t.test('P1: previous wearer packet must not be attached to QA_NEW after restart',()=>{
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

const change=(h,cookie,code,version=1,slot='R01')=>h.req('/api/roster/'+slot,{method:'PUT',cookie,body:{version,code,restriction:'none',observation:'none'}});
for(const failure of ['fail-before','fail-after'])test('SIMULATED: '+failure+' rolls back wearer, cutoff, profile and pending case durably',async t=>{
 const h=await lab(t),m=await h.login('medic'),a=await h.phone('G01');
 await h.enroll(m,'R01');await h.advance(1);
 const old=h.sample('R01');assert.equal((await h.ingest('G01',a,[old])).data.accepted,1);
 assert.equal((await h.req('/api/private-profile/R01',{method:'PUT',cookie:m,body:{version:0,confirmed:true,weightKg:null,heightCm:null,conditions:'QA_OLD_PROFILE'}})).status,200);
 assert.equal((await h.req('/api/medic-reviews/R01',{method:'PUT',cookie:m,body:{version:0,action:'request',reason:'other',note:'QA_OLD_CASE'}})).status,200);
 const before=await h.stored();await h.advance(1);await h.controlSave(failure);
 const result=await change(h,m,'QA_NEW');assert.equal(result.status,503);assert.equal(result.data.ok,undefined);
 assert.deepEqual(await h.stored(),before,'compensating write restores the confirmed state even after lost ACK');
 assert.equal((await h.req('/api/roster',{cookie:m})).data.slots[0].code,'QA_R01');
 assert.equal((await h.req('/api/private-profile/R01',{cookie:m})).data.profile.conditions,'QA_OLD_PROFILE');
 assert.equal((await h.req('/api/medic-reviews/R01',{cookie:m})).data.review.status,'pending');
 await h.restart();const again=await h.login('medic');
 assert.equal((await h.req('/api/roster',{cookie:again})).data.slots[0].version,1);
 await h.advance(1);assert.equal((await change(h,again,'QA_NEW')).status,200);
 const phone=await h.phone('G01');assert.equal((await h.ingest('G01',phone,[old])).data.accepted,0);
 const fresh=await h.stored();assert.equal(fresh.roster.slots.R01.code,'QA_NEW');assert.equal(fresh.reassignmentCutoffs.R01,h.now());
 assert.equal(fresh.history.R01,undefined);assert.equal(fresh.profiles.R01,undefined);assert.equal(fresh.medicReviews.R01,undefined);
});

test('SIMULATED: unconfirmed rollback blocks only its slot until explicit successful retry',async t=>{
 const h=await lab(t),m=await h.login('medic'),a=await h.phone('G01'),b=await h.phone('G02');
 await h.enroll(m,'R01');await h.advance(1);await h.controlSave('fail-always');
 assert.equal((await change(h,m,'QA_NEW')).status,503);
 assert.equal((await h.req('/api/roster',{cookie:m})).data.slots[0].code,'QA_R01');
 assert.equal((await snapshot(h,m))[0].state,'PAUSED');
 assert.equal((await h.ingest('G01',a,[h.sample('R01')])).data.accepted,0);
 assert.equal((await h.ingest('G02',b,[h.sample('R06')])).data.accepted,1);
 await h.controlSave('');await h.advance(1);
 assert.equal((await change(h,m,'QA_NEW')).status,200);
 await h.advance(1);assert.equal((await h.ingest('G01',a,[h.sample('R01')])).data.accepted,1);
});

test('SIMULATED: held save never publishes uncommitted wearer; blocks same-slot writes while peers and group updates survive',async t=>{
 const h=await lab(t),m=await h.login('medic'),a=await h.phone('G01'),b=await h.phone('G02');
 await h.enroll(m,'R01');await h.enroll(m,'R06');await h.advance(1);const old=h.sample('R01');
 await h.ingest('G01',a,[old]);await h.advance(1);const cutoff=h.now();
 await h.controlSave('hold');const changing=change(h,m,'QA_NEW');await h.waitHeld();
 assert.equal((await h.req('/api/roster',{cookie:m})).data.slots[0].code,'QA_R01');
 assert.equal((await h.stored()).roster.slots.R01.code,'QA_R01');
 assert.equal((await snapshot(h,m))[0].hr,null);
 assert.equal((await h.ingest('G01',a,[old])).data.accepted,0);
 assert.equal((await change(h,m,'QA_RACE')).status,409);
 assert.equal((await h.req('/api/private-profile/R01',{method:'PUT',cookie:m,body:{version:0,confirmed:true,weightKg:null,heightCm:null,conditions:'QA_RACE'}})).status,409);
 assert.equal((await h.req('/api/medic-reviews/R01',{method:'PUT',cookie:m,body:{version:0,action:'request',reason:'other'}})).status,409);
 assert.equal((await h.ingest('G02',b,[h.sample('R06')])).data.accepted,1);
 const peerChange=change(h,m,'QA_PEER',1,'R06');
 const phase=h.req('/api/training',{method:'PUT',cookie:m,body:{version:0,phase:'training'}});
 await h.releaseSave();assert.equal((await changing).status,200);assert.equal((await peerChange).status,200);assert.equal((await phase).status,200);
 const persisted=await h.stored();assert.equal(persisted.roster.slots.R01.code,'QA_NEW');assert.equal(persisted.roster.slots.R06.code,'QA_PEER');
 assert.equal(persisted.roster.groupPhase.phase,'training');assert.equal(persisted.reassignmentCutoffs.R01,cutoff);
 await h.restart();const again=await h.phone('G01');
 assert.equal((await h.ingest('G01',again,[old])).data.accepted,0);
 assert.equal((await h.ingest('G01',again,[h.sample('R01',{timestamp:cutoff})])).data.accepted,0,'boundary is inclusive');
 await h.advance(1);assert.equal((await h.ingest('G01',again,[h.sample('R01')])).data.accepted,1);
});

test('SIMULATED: serialized roster saves cannot assign one code to two slots',async t=>{
 const h=await lab(t),m=await h.login('medic');await h.enroll(m,'R01');await h.enroll(m,'R06');await h.advance(1);
 await h.controlSave('hold');const first=change(h,m,'QA_UNIQUE');await h.waitHeld();
 const second=change(h,m,'QA_UNIQUE',1,'R06');await delay(30);await h.releaseSave();
 assert.equal((await first).status,200);assert.equal((await second).status,409);
 const roster=(await h.req('/api/roster',{cookie:m})).data.slots;
 assert.equal(roster.filter(r=>r.code==='QA_UNIQUE').length,1);
});

for(const partial of [false,true])test('SIMULATED: legacy '+(partial?'partial':'missing')+' cutoff migration rejects ambiguous old packets then resumes',async t=>{
 const h=await lab(t),m=await h.login('medic');await h.enroll(m,'R01');await h.enroll(m,'R06');
 const retained=(await h.stored()).reassignmentCutoffs.R06;
 await h.rewrite(state=>{if(partial)delete state.reassignmentCutoffs.R01;else delete state.reassignmentCutoffs;});
 await h.advance(2);const bootAt=h.now();await h.restart();
 const a=await h.phone('G01');
 assert.equal((await h.ingest('G01',a,[h.sample('R01',{timestamp:initial})])).data.accepted,0);
 assert.equal((await h.ingest('G01',a,[h.sample('R01',{timestamp:bootAt+1000})])).data.accepted,0);
 const migrated=await h.stored();assert.equal(migrated.reassignmentCutoffs.R01,bootAt+1000);
 if(partial)assert.equal(migrated.reassignmentCutoffs.R06,retained);
 await h.advance(1001);assert.equal((await h.ingest('G01',a,[h.sample('R01')])).data.accepted,1);
 await h.restart();assert.equal((await h.stored()).reassignmentCutoffs.R01,bootAt+1000,'migration must not extend every restart');
});

test('SIMULATED: reconnect cannot restore previous wearer history/profile/automatic alert after restart',async t=>{
 const h=await lab(t),m=await h.login('medic'),a=await h.phone('G01');await h.enroll(m,'R01');
 assert.equal((await h.req('/api/private-profile/R01',{method:'PUT',cookie:m,body:{version:0,confirmed:true,weightKg:null,heightCm:null,conditions:'QA_OLD',reviewThresholdBpm:150,reviewThresholdConfirmed:true}})).status,200);
 assert.equal((await h.req('/api/training',{method:'PUT',cookie:m,body:{version:0,phase:'training'}})).status,200);
 let old;
 for(let i=0;i<6;i++){await h.advance(7000);old=h.sample('R01',{hr:160});assert.equal((await h.ingest('G01',a,[old])).data.accepted,1);}
 assert.equal((await snapshot(h,m))[0].autoCheck,true);
 await h.advance(1);assert.equal((await change(h,m,'QA_NEW')).status,200);await h.restart();
 const again=await h.login('medic'),phone=await h.phone('G01');
 assert.equal((await h.ingest('G01',phone,[old])).data.accepted,0);
 let detail=(await h.req('/api/medic-reviews/R01',{cookie:again})).data;
 assert.deepEqual(detail.points,[]);assert.equal(detail.review.status,'none');
 assert.equal((await snapshot(h,again))[0].autoCheck,false);
 await h.advance(1);assert.equal((await h.ingest('G01',phone,[h.sample('R01',{hr:75})])).data.accepted,1);
 detail=(await h.req('/api/medic-reviews/R01',{cookie:again})).data;
 assert.deepEqual(detail.points,[[h.now(),75]]);assert.equal(detail.review.status,'none');
});

test('SIMULATED: commit ACK lost and compensation fails; restart restores matching new wearer and cutoff safely',async t=>{
 const h=await lab(t),m=await h.login('medic'),a=await h.phone('G01');await h.enroll(m,'R01');await h.advance(1);
 const old=h.sample('R01');await h.ingest('G01',a,[old]);await h.advance(1);
 await h.controlSave('fail-after-rollback-fails');assert.equal((await change(h,m,'QA_NEW')).status,503);
 assert.equal((await snapshot(h,m))[0].state,'PAUSED');assert.equal((await h.ingest('G01',a,[old])).data.accepted,0);
 assert.equal((await h.stored()).roster.slots.R01.code,'QA_NEW','remote commit succeeded although response was lost');
 await h.controlSave('');await h.restart();const again=await h.phone('G01'),viewer=await h.login('medic');
 assert.equal((await h.req('/api/roster',{cookie:viewer})).data.slots[0].code,'QA_NEW');
 assert.equal((await h.ingest('G01',again,[old])).data.accepted,0);
 await h.advance(1);assert.equal((await h.ingest('G01',again,[h.sample('R01')])).data.accepted,1);
});

test('SIMULATED: legacy migration write failure prevents listening; a healthy retry resumes',async t=>{
 const h=await lab(t),m=await h.login('medic');await h.enroll(m,'R01');
 await h.rewrite(s=>{delete s.reassignmentCutoffs;});await h.controlSave('fail-before');
 await assert.rejects(h.restart(),/failed to start/);
 await h.controlSave('');await h.restart();
 assert.equal((await h.stored()).reassignmentCutoffs.R01,h.now()+1000);
});

for(const invalid of [null,{R01:-1},{R01:Number.MAX_SAFE_INTEGER},{R99:1}])test('SIMULATED: malformed durable cutoff fails closed: '+JSON.stringify(invalid),async t=>{
 const h=await lab(t),m=await h.login('medic');await h.enroll(m,'R01');
 await h.rewrite(s=>{s.reassignmentCutoffs=invalid;});
 await assert.rejects(h.restart(),/failed to start/);
});

test('SIMULATED: archived and pending old-wearer samples cannot enter the new archive after restart',async t=>{
 const h=await lab(t,{archive:true}),m=await h.login('medic'),a=await h.phone('G01');await h.enroll(m,'R01');await h.advance(1);
 const flush=async()=>{await h.advance(90000);for(let i=0;i<200;i++){if((await h.archiveRows()).length)return;await delay(10);}throw Error('archive did not flush');};
 assert.equal((await h.ingest('G01',a,[h.sample('R01',{hr:160})])).data.accepted,1);await flush();
 assert.ok((await h.archiveRows()).length>0,'old history was durably archived');
 const old=h.sample('R01',{hr:160});assert.equal((await h.ingest('G01',a,[old])).data.accepted,1);
 await h.advance(1);assert.equal((await change(h,m,'QA_NEW')).status,200);
 assert.equal((await h.archiveRows()).length,0,'existing archive clear semantics preserved');
 await h.restart();const phone=await h.phone('G01'),medic=await h.login('medic');
 assert.equal((await h.ingest('G01',phone,[old])).data.accepted,0);
 assert.deepEqual((await h.req('/api/archive/R01?hours=4',{cookie:medic})).data.points,[]);
 await h.advance(1);const freshAt=h.now();assert.equal((await h.ingest('G01',phone,[h.sample('R01',{hr:75})])).data.accepted,1);
 await flush();
 assert.deepEqual((await h.req('/api/archive/R01?hours=4',{cookie:medic})).data.points,[[freshAt,75]]);
});

// Issue #76: a remote write may commit even though its acknowledgement is lost.
test('SIMULATED #76: failed case close with lost ACK must preserve pending after restart',async t=>{
 const h=await lab(t),m=await h.login('medic');await h.enroll(m,'R06');
 const path='/api/medic-reviews/R06';
 assert.equal((await h.req(path,{method:'PUT',cookie:m,body:{version:0,action:'request',reason:'other',note:'synthetic pending'}})).status,200);
 await h.controlSave('fail-after');
 assert.equal((await h.req(path,{method:'PUT',cookie:m,body:{version:1,action:'close',note:'synthetic assessment'}})).status,503);
 assert.equal((await h.req(path,{cookie:m})).data.review.status,'pending');
 await h.restart();const again=await h.login('medic');
 assert.equal((await h.req(path,{cookie:again})).data.review.status,'pending');
});

for(const action of ['request','close'])for(const failure of ['fail-before','fail-after'])
test(`SIMULATED #76: ${action} ${failure} restores durable version and permits retry`,async t=>{
 const h=await lab(t),m=await h.login('medic');await h.enroll(m,'R06');
 const path='/api/medic-reviews/R06';
 if(action==='close')assert.equal((await h.req(path,{method:'PUT',cookie:m,body:{version:0,action:'request',reason:'other'}})).status,200);
 const version=action==='close'?1:0,body={version,action,reason:'other',note:'synthetic assessment'};
 await h.controlSave(failure);
 assert.equal((await h.req(path,{method:'PUT',cookie:m,body})).status,503);
 await h.restart();const again=await h.login('medic');
 let review=(await h.req(path,{cookie:again})).data.review;
 assert.equal(review.status,action==='close'?'pending':'none');assert.equal(review.version,version);
 assert.equal((await h.req(path,{method:'PUT',cookie:again,body})).status,200);
 assert.equal((await h.req(path,{method:'PUT',cookie:again,body})).status,409,'duplicate command cannot overwrite newer version');
 await h.restart();const last=await h.login('medic');
 review=(await h.req(path,{cookie:last})).data.review;
 assert.equal(review.status,action==='close'?'closed':'pending');assert.equal(review.version,version+1);
});

test('SIMULATED #76: automatic case close, dedup, rearm, acknowledgement and EMERGENCY remain separate',async t=>{
 const h=await lab(t),m=await h.login('medic'),a=await h.phone('G02');await h.enroll(m,'R06');
 const path='/api/medic-reviews/R06';
 assert.equal((await h.req('/api/private-profile/R06',{method:'PUT',cookie:m,body:{version:0,confirmed:true,weightKg:null,heightCm:null,conditions:'',reviewThresholdBpm:150,reviewThresholdConfirmed:true}})).status,200);
 assert.equal((await h.req('/api/training',{method:'PUT',cookie:m,body:{version:0,phase:'training'}})).status,200);
 const send=async(hr)=>{await h.advance(7000);assert.equal((await h.ingest('G02',a,[h.sample('R06',{hr})])).data.accepted,1);};
 for(let i=0;i<6;i++)await send(160);
 let review=(await h.req(path,{cookie:m})).data.review;
 assert.equal(review.openedBy,'system');assert.equal(review.status,'pending');const firstVersion=review.version;
 for(let i=0;i<3;i++)await send(160);
 assert.equal((await h.req(path,{cookie:m})).data.review.version,firstVersion,'sustained signal does not duplicate case');
 // Roster acknowledgement concerns the observed symptom; it cannot close the medical case.
 assert.equal((await h.req('/api/roster/R06',{method:'PUT',cookie:m,body:{version:1,code:'QA_R06',restriction:'none',observation:'confusion_collapse_seizure'}})).status,200);
 assert.equal((await h.req('/api/roster/R06/acknowledge',{method:'POST',cookie:m,body:{version:2}})).status,200);
 assert.equal((await h.req(path,{cookie:m})).data.review.status,'pending');
 assert.equal((await h.req(path,{method:'PUT',cookie:m,body:{version:firstVersion,action:'close'}})).status,200);
 assert.equal((await h.req('/api/roster',{cookie:m})).data.slots[5].observation,'confusion_collapse_seizure','case close does not clear unresolved observed emergency');
 for(let i=0;i<3;i++)await send(160);
 assert.equal((await h.req(path,{cookie:m})).data.review.status,'closed','close does not reset monitor latch');
 // Existing monitor contract: >=60 s below limit rearms; gradual changes avoid signal-jump filter.
 await send(130);for(let i=0;i<10;i++)await send(120);
 for(let i=0;i<6;i++)await send(160);
 review=(await h.req(path,{cookie:m})).data.review;
 assert.equal(review.status,'pending');assert.ok(review.version>firstVersion+1);
 await h.ingest('G02',a,[h.sample('R06',{hr:null,state:'DISCONNECTED',timestamp:h.now()+1})]);
 await h.advance(15001);assert.equal((await h.req(path,{cookie:m})).data.review.status,'pending');
 await h.restart();const again=await h.login('medic');
 assert.equal((await h.req(path,{cookie:again})).data.review.status,'pending');
 assert.equal((await snapshot(h,again))[5].hr,null);
});
