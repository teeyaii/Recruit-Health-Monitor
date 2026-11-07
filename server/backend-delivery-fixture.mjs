// SIMULATED ONLY. Existing child-process/fake-clock/durable-transport test pattern.
// This fixture never reaches Supabase or any external service.
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

export const slots=Array.from({length:10},(_,i)=>'R'+String(i+1).padStart(2,'0'));
const map={G01:{},G02:{}};
slots.forEach((s,i)=>map[i<5?'G01':'G02'][s]='delivery-'+s);
export async function deliveryLab(t){
 const dir=await mkdtemp(join(tmpdir(),'steve-delivery-'));
 const clock=join(dir,'clock'),state=join(dir,'state'),fail=join(dir,'fail'),hook=join(dir,'hook.mjs');
 let now=1794000000000,child,base;
 const token=Object.fromEntries(['viewer','trainer','medic','G01','G02'].map(r=>[r,randomBytes(32).toString('hex')]));
 await writeFile(clock,String(now));await writeFile(fail,'0');
 await writeFile(hook,`
import {readFileSync} from 'node:fs';
import {readFile,writeFile,rename} from 'node:fs/promises';
Date.now=()=>Number(readFileSync(process.env.TEST_CLOCK,'utf8'));
const interval=setInterval;globalThis.setInterval=(fn,ms,...args)=>interval(fn,ms===5000?25:ms===30000?100:ms,...args);
globalThis.fetch=async(url,o)=>{
 if(!String(url).startsWith('https://delivery-test.supabase.co/rest/v1/steve_secure_state'))throw Error('External network forbidden');
 if(o.method==='GET'){let rows=[];try{rows=[JSON.parse(await readFile(process.env.TEST_STATE,'utf8'))];}catch(e){if(e.code!=='ENOENT')throw e;}return {ok:true,json:async()=>rows};}
 if(await readFile(process.env.TEST_FAIL,'utf8')==='1')return {ok:false,status:503};
 await writeFile(process.env.TEST_STATE+'.tmp',o.body);await rename(process.env.TEST_STATE+'.tmp',process.env.TEST_STATE);return {ok:true,status:201};
};`);
 const env={PATH:process.env.PATH,NODE_ENV:'test',COOKIE_SECURE:'1',
  STEVE_VIEWER_TOKEN:token.viewer,STEVE_TRAINER_TOKEN:token.trainer,STEVE_MEDIC_TOKEN:token.medic,
  STEVE_GATEWAY_TOKEN_G01:token.G01,STEVE_GATEWAY_TOKEN_G02:token.G02,STEVE_SLOT_MAP_JSON:JSON.stringify(map),
  STEVE_SUPABASE_URL:'https://delivery-test.supabase.co',STEVE_SUPABASE_SERVICE_ROLE_KEY:'sb_secret_'+randomBytes(32).toString('hex'),
  STEVE_DATA_ENCRYPTION_KEY:randomBytes(32).toString('base64'),STEVE_ARCHIVE_ENABLED:'0',TEST_CLOCK:clock,TEST_STATE:state,TEST_FAIL:fail};
 const codec=new DurableState(env),streams=[];
 const stop=async()=>{for(const s of streams)s.abort();if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}};
 t.after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});
 const boot=async()=>{const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));base='http://127.0.0.1:'+port;
  child=spawn(process.execPath,['--import',pathToFileURL(hook).href,'index.js'],{cwd:new URL('.',import.meta.url),env:{...env,PORT:String(port)},stdio:'ignore'});
  for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok)return;}catch{}await delay(25);}throw Error('backend did not boot');};
 const raw=(path,{method='GET',cookie,bearer,body,headers={},signal}={})=>fetch(base+path,{method,signal,headers:{'X-STEVE-Gateway':'1',...headers,...(cookie?{Cookie:cookie}:{}),...(bearer?{Authorization:'Bearer '+bearer}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const req=async(path,opts)=>{const r=await raw(path,opts);return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const login=async role=>{const r=await req('/api/login',{method:'POST',body:{token:token[role]}});assert.equal(r.status,200);return r.cookie;};
 const phone=async gateway=>{const r=await req('/api/gateway/session',{method:'POST',bearer:token[gateway]});assert.equal(r.status,200);return r.cookie;};
 const sample=(id,extra={})=>({id,device_id:'delivery-'+id,hr:70+slots.indexOf(id),timestamp:now,...extra});
 const ingest=(gateway,cookie,readings)=>req('/api/ingest',{method:'POST',cookie,body:{gateway,source:'GATEWAY',readings}});
 const advance=async ms=>{now+=ms;await writeFile(clock+'.tmp',String(now));await rename(clock+'.tmp',clock);};
 const stream=async cookie=>{
  const controller=new AbortController();streams.push(controller);
  const r=await raw('/api/events',{cookie,signal:controller.signal});assert.equal(r.status,200);
  assert.match(r.headers.get('content-type'),/^text\/event-stream/);
  const reader=r.body.getReader(),decoder=new TextDecoder();let buffered='';
  const next=async()=>{while(true){const boundary=buffered.indexOf('\n\n');if(boundary>=0){const frame=buffered.slice(0,boundary);buffered=buffered.slice(boundary+2);const data=frame.split('\n').find(l=>l.startsWith('data: '));if(data)return JSON.parse(data.slice(6));continue;}const chunk=await reader.read();if(chunk.done)return null;buffered+=decoder.decode(chunk.value,{stream:true});}};
  const until=async predicate=>{for(let i=0;i<150;i++){const message=await next();if(message===null||predicate(message))return message;}throw Error('SSE expected snapshot not delivered');};
  return {next,until,close:()=>controller.abort()};
 };
 await boot();await advance(1001); // normal traffic begins after the documented startup clock-lead guard
 return {req,raw,login,phone,sample,ingest,advance,stream,token,now:()=>now,
  storageOutage:enabled=>writeFile(fail,enabled?'1':'0'),
  stored:async()=>codec.decrypt(JSON.parse(await readFile(state,'utf8')).envelope),
  restart:async()=>{await stop();await boot();}};
}
