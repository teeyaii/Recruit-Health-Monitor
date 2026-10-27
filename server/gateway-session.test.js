import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {GatewaySessions,GATEWAY_SESSION_MS,EXTENDED_GATEWAY_SESSION_MS,gatewayBrowserRequest} from './gateway-session.js';

test('independent browser sessions retain absolute expiry and revoke only their own cookie',()=>{
 const sessions=new GatewaySessions(),req={headers:{}};
 const cookie=key=>({headers:{cookie:'steve_gateway='+key}});
 const first=cookie(sessions.create(req,'G01',1000));
 const second=cookie(sessions.create(req,'G01',2000));
 const other=cookie(sessions.create(req,'G02',3000));
 const short=cookie(sessions.create(req,'G04',5000));
 assert.equal(sessions.get(first,5000).expiry,1000+EXTENDED_GATEWAY_SESSION_MS);
 sessions.revoke(second);
 assert.equal(sessions.get(second,5000),null);
 assert.equal(sessions.get(first,5000).gateway,'G01');
 assert.equal(sessions.get(short,5000+GATEWAY_SESSION_MS),null,'G04 remains 2 hours');
 assert.equal(sessions.get(first,1000+EXTENDED_GATEWAY_SESSION_MS),null);
 assert.equal(sessions.get(other,3000+EXTENDED_GATEWAY_SESSION_MS-1).gateway,'G02');
});

test('gateway sessions expire absolutely, rotate, revoke, and store only hashed random keys',()=>{
 const sessions=new GatewaySessions(),req={headers:{}};
 const key=sessions.create(req,'G01',1000),cookie={headers:{cookie:'steve_gateway='+key}};
 assert.equal(sessions.records.has(key),false);assert.equal(key.length,64);
 assert.equal(sessions.get(cookie,1001).gateway,'G01');
 assert.equal(sessions.get(cookie,1000+EXTENDED_GATEWAY_SESSION_MS),null);
 const a=sessions.create(req,'G01'),request={headers:{cookie:'steve_gateway='+a}};
 const b=sessions.create(request,'G01');assert.equal(sessions.get(request),null);
 const fresh={headers:{cookie:'steve_gateway='+b}};sessions.revoke(fresh);assert.equal(sessions.get(fresh),null);
 assert.equal(gatewayBrowserRequest({headers:{'x-steve-gateway':'1',host:'steve.test',origin:'http://steve.test:99'}}),false);
 assert.equal(gatewayBrowserRequest({headers:{'x-steve-gateway':'1','sec-fetch-site':'cross-site'}}),false);
 const previous=process.env.NODE_ENV;try{process.env.NODE_ENV='production';assert.match(sessions.cookie('a'.repeat(64)),/; Secure$/);}finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});

test('HTTP session restores own provision, enforces slots and CSRF, cannot read dashboard, logout revokes',async()=>{
 const port=24000+Math.floor(Math.random()*1000),base='http://127.0.0.1:'+port;
 const token='test-gateway-only-credential-1234567890';
 const proc=spawn(process.execPath,['index.js'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:String(port),STEVE_VIEWER_TOKEN:'test-viewer-only-credential-1234567890',STEVE_GATEWAY_TOKEN_G01:token,STEVE_SLOT_MAP_JSON:JSON.stringify({G01:{R01:'opaque-one',R02:'opaque-two'}})},stdio:'pipe'});
 try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await delay(100);}assert.ok(ready);
  const login={method:'POST',headers:{Authorization:'Bearer '+token,'X-STEVE-Gateway':'1'}};
  let r=await fetch(base+'/api/gateway/session',{...login,headers:{...login.headers,Origin:'http://evil.test'}});assert.equal(r.status,403);
  r=await fetch(base+'/api/gateway/session',{method:'POST',headers:{'X-STEVE-Gateway':'1'}});assert.equal(r.status,401);
  r=await fetch(base+'/api/gateway/session',login);assert.equal(r.status,200);
  const setCookie=r.headers.get('set-cookie');assert.match(setCookie,/HttpOnly; SameSite=Strict; Path=\/api\/; Max-Age=36000/);assert.ok(!setCookie.includes(token));
  const headers={Cookie:setCookie.split(';')[0],'X-STEVE-Gateway':'1','Content-Type':'application/json'};
  r=await fetch(base+'/api/gateway/provision',{headers});assert.deepEqual((await r.json()).slots.map(x=>x.id),['R01','R02']);
  r=await fetch(base+'/api/gateway/provision',{headers:{Cookie:headers.Cookie}});assert.equal(r.status,401);
  r=await fetch(base+'/api/snapshot',{headers});assert.equal(r.status,401);
  r=await fetch(base+'/api/operator/me',{headers});assert.equal(r.status,401);
  const ingest=body=>fetch(base+'/api/ingest',{method:'POST',headers,body:JSON.stringify(body)});
  r=await ingest({gateway:'G02',readings:[]});assert.equal(r.status,403);
  r=await ingest({gateway:'G01',readings:[{id:'R01',device_id:'wrong',hr:65,timestamp:Date.now()}]});assert.equal((await r.json()).accepted,0);
  r=await ingest({gateway:'G01',readings:[{id:'R01',device_id:'opaque-one',hr:65,timestamp:Date.now()}]});assert.equal((await r.json()).accepted,1);
  r=await fetch(base+'/api/ingest',{method:'POST',headers:{...headers,Origin:'http://evil.test'},body:'{}'});assert.equal(r.status,401);
  r=await fetch(base+'/api/gateway/session',{method:'DELETE',headers});assert.equal(r.status,200);
  r=await fetch(base+'/api/gateway/provision',{headers});assert.equal(r.status,401);
 }finally{proc.kill();}
});
