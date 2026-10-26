import http from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import { gatewayForBearer, viewerRoleForToken, slotIsAuthorized, strictMode, provisionedGateway, provisionedDevicesForGateway } from "./contract.js";
import { RosterStore } from "./roster.js";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import path from "node:path";

const PORT=Number(process.env.PORT||8080);
const TTL_MS=15000;
const DEMO_ENABLED=process.env.STEVE_DEMO_MODE==="1" && process.env.NODE_ENV!=="production";
const MAX_AGE_MS=15000;
const SYNTHETIC=DEMO_ENABLED || (process.env.STEVE_SYNTHETIC_MODE==="1" && process.env.NODE_ENV!=="production");
const recruits=new Map();
const clients=new Set();
const sessions=new Map();
const failedLogins=new Map();
const roster=new RosterStore(process.env.STEVE_ROSTER_FILE||"");
let conditions={wbgtC:null,timestamp:null,source:"not recorded"};
let demoActive=false,demoDropR03=false,demoDropG03=false,demoRound=0,demoTimer=null;
const lastByGateway=new Map();
const SESSION_MS=8*60*60*1000;
const liveDashboard=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../dashboard/live.html");
const webGateway=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../dashboard/gateway.html");
const dashboard=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../dashboard/index.html");
function viewer(req){
 const cookie=req.headers.cookie?.match(/(?:^|;\s*)rhm_session=([a-f0-9]{64})(?:;|$)/)?.[1];
 if(!cookie)return null;
 const value=sessions.get(cookie);
 if(!value)return null;
 if(value.expiry<Date.now()){sessions.delete(cookie);return null;}
 return value.role;
}
function sameOrigin(req){
 const origin=req.headers.origin;
 if(!origin)return true; // Non-browser clients must still authenticate.
 try{
  const actual=new URL(origin);
  return actual.hostname===req.headers.host?.split(":")[0] &&
   (actual.protocol==="https:" || process.env.NODE_ENV!=="production");
 }catch{return false;}
}
async function readBody(req,max=2048){
 let raw="";
 for await(const chunk of req){raw+=chunk;if(raw.length>max)throw Object.assign(new Error("too large"),{status:413});}
 try{return JSON.parse(raw);}catch{throw Object.assign(new Error("invalid JSON"),{status:400});}
}
function send(res,code,data){res.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(data));}
function snapshot(){const now=Date.now();
 return Array.from({length:15},(_,i)=>{
  const id="R"+String(i+1).padStart(2,"0"),r=recruits.get(id),gateway=r?.gateway??provisionedGateway(id),paused=!roster.canIngest(id);
  const gatewayOnline=gateway!=null && now-(lastByGateway.get(gateway)??0)<=TTL_MS;
  const state=paused?"PAUSED":r?.state==="DISCONNECTED"?"DISCONNECTED":!r?.timestamp?"NO DATA":
    (!gatewayOnline||now-r.timestamp>TTL_MS)?"STALE":"CONNECTED";
  return {id,hr:state==="CONNECTED"?r.hr:null,timestamp:r?.timestamp??null,
   stale:state!=="CONNECTED",state,paused,gateway,gatewayOnline,source:r?.source??(SYNTHETIC?"SIMULATED":null)};
 });}
function publish(){const msg="data: "+JSON.stringify({type:"snapshot",recruits:snapshot()})+"\n\n";for(const c of clients){try{c.write(msg)}catch{clients.delete(c)}}}
// Deliberately synthetic only. Demo cannot run when NODE_ENV=production.
function demoTick(){
 if(!demoActive)return;
 const now=Date.now();
 for(let i=0;i<15;i++){
  const id="R"+String(i+1).padStart(2,"0");
  if(demoDropR03&&id==="R03")continue;
  if(!roster.canIngest(id))continue;
  if(demoDropG03&&Math.floor(i/3)===2)continue;
  const gateway="G0"+(Math.floor(i/3)+1);
  const hr=72+((i*11+demoRound*3)%41);
  recruits.set(id,{hr,timestamp:now,gateway,source:"SIMULATED",state:"CONNECTED",eventAt:now});
  lastByGateway.set(gateway,now);
 }
 demoRound++;publish();
}
function demoControl(action){
 if(action==="start"){
  demoActive=true;demoDropR03=false;demoDropG03=false;demoTick();
  if(!demoTimer)demoTimer=setInterval(demoTick,3000);
 }else if(action==="stop"){
  demoActive=false;if(demoTimer)clearInterval(demoTimer);demoTimer=null;publish();
 }else if(action==="drop" && demoActive){demoDropR03=true;}
 else if(action==="drop-gateway" && demoActive){demoDropG03=true;}
 else if(action==="restore" && demoActive){demoDropR03=false;demoDropG03=false;demoTick();}
 else return false;
 return true;
}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,"http://localhost");
 if(url.pathname==="/health"){send(res,200,{ok:true});return;}
 if(req.method==="POST"&&url.pathname==="/api/login"){
  let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>2048){send(res,413,{error:"too large"});return;}}
  let input;try{input=JSON.parse(raw)}catch{send(res,400,{error:"invalid JSON"});return;}
  const ip=req.socket.remoteAddress||"unknown", now=Date.now();
  for(const [key,record] of failedLogins) if(now-record.since>60000)failedLogins.delete(key);
  const record=failedLogins.get(ip)||{since:now,count:0};
  if(record.count>=8){send(res,429,{error:"try again later"});return;}
  const role=viewerRoleForToken(input?.token);
  if(!role){
    failedLogins.set(ip,{since:record.since,count:record.count+1});
    if(failedLogins.size>256)failedLogins.delete(failedLogins.keys().next().value);
    send(res,401,{error:"unauthorized"});return;
  }
  failedLogins.delete(ip);
  for(const [key,value] of sessions) if(value.expiry<now)sessions.delete(key);
  if(sessions.size>=256){send(res,503,{error:"session capacity reached"});return;}
  const session=randomBytes(32).toString("hex");sessions.set(session,{expiry:now+SESSION_MS,role});
  res.setHeader("Set-Cookie",`rhm_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE==="1"?"; Secure":""}`);
  send(res,200,{ok:true});return;
 }
 if(req.method==="POST"&&url.pathname==="/api/logout"){
  const cookie=req.headers.cookie?.match(/(?:^|;\s*)rhm_session=([a-f0-9]{64})(?:;|$)/)?.[1];if(cookie)sessions.delete(cookie);
  res.setHeader("Set-Cookie","rhm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");send(res,200,{ok:true});return;
 }
 const isViewer=viewer(req),gatewayId=gatewayForBearer(req),isGateway=Boolean(gatewayId);
 // Public HTML shell only: provisioned slots, secrets and BPM still require a Gateway bearer token.
 if(url.pathname==="/gateway"&&req.method==="GET"){
  res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
  res.end(await readFile(webGateway));return;
 }
 if(url.pathname==="/live"&&req.method==="GET"){
  res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Content-Security-Policy":"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'"});res.end(await readFile(liveDashboard));return;
 }
 if(!isViewer&&!isGateway){send(res,401,{error:"unauthorized"});return;}
 if(req.method==="GET"&&url.pathname==="/"){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Content-Security-Policy":"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'"});res.end(await readFile(dashboard));return;}
 // Trainer and medical accounts have identical capabilities. Legacy operator token is
 // retained for existing Render dashboards, not a substitute for individual attribution.
 if(url.pathname==="/api/operator/me" && req.method==="GET"){
  if(!isViewer){send(res,403,{error:"operator authorization required"});return;}
  send(res,200,{role:isViewer,permissions:["roster:read","roster:write","audit:read","context:write"]});return;
 }
 if(url.pathname==="/api/roster" && req.method==="GET"){
  if(!isViewer){send(res,403,{error:"operator authorization required"});return;}
  send(res,200,{slots:roster.all(),ephemeral:!roster.filename,
   purpose:"pseudonymous operational information only — no diagnoses or real identifiers"});return;
 }
 if(url.pathname==="/api/roster/audit" && req.method==="GET"){
  if(!isViewer){send(res,403,{error:"operator authorization required"});return;}
  send(res,200,{events:roster.getAudit()});return;
 }
 const rosterRoute=url.pathname.match(/^\/api\/roster\/(R(?:0[1-9]|1[0-5]))(?:\/(replace|resume|acknowledge))?$/);
 if(rosterRoute && (req.method==="PUT"||req.method==="POST")){
  if(!isViewer){send(res,403,{error:"operator authorization required"});return;}
  if(!sameOrigin(req)){send(res,403,{error:"origin mismatch"});return;}
  if(!req.headers["content-type"]?.toLowerCase().startsWith("application/json")){send(res,415,{error:"JSON required"});return;}
  const [,slot,action]=rosterRoute;
  if((action && req.method!=="POST")||(!action && req.method!=="PUT")){send(res,405,{error:"method not allowed"});return;}
  try{
   const body=await readBody(req);
   const current=action==="replace"?roster.replace(slot,body,isViewer):
      action==="resume"?roster.resume(slot,body,isViewer):
      action==="acknowledge"?roster.acknowledge(slot,body,isViewer):
      roster.update(slot,body,isViewer);
   if(action==="replace")recruits.delete(slot); // Never reuse the last person's BPM.
   if(action==="replace"||action==="resume")publish();
   send(res,200,{ok:true,slot:current});
  }catch(e){send(res,e.status||500,{error:e.status?e.message:"roster update unavailable"});}
  return;
 }
 if(DEMO_ENABLED && url.pathname==="/api/demo" && req.method==="GET"){
  if(!isViewer){send(res,403,{error:"viewer authorization required"});return;}
  send(res,200,{enabled:true,active:demoActive,droppedR03:demoDropR03,droppedG03:demoDropG03,source:"SIMULATED"});return;
 }
 if(DEMO_ENABLED && url.pathname==="/api/demo" && req.method==="POST"){
  if(!isViewer){send(res,403,{error:"viewer authorization required"});return;}
  let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>512){send(res,413,{error:"too large"});return;}}
  let data;try{data=JSON.parse(raw)}catch{send(res,400,{error:"invalid JSON"});return;}
  if(!demoControl(data?.action)){send(res,422,{error:"invalid demo action"});return;}
  send(res,200,{ok:true,active:demoActive,droppedR03:demoDropR03,droppedG03:demoDropG03,source:"SIMULATED"});return;
 }
 // Gateway-only provisioning preflight: an HTTPS/Bearer-authenticated Android phone
 // sees only its OWN anonymous slots. This is not a sensor or wearer verification.
 if(req.method==="GET" && url.pathname==="/api/gateway/provision"){
  if(!isGateway){send(res,403,{error:"gateway credential required"});return;}
  const slots=provisionedDevicesForGateway(gatewayId);
  if(slots===null){send(res,503,{error:"provisioning unavailable; configure STEVE_SLOT_MAP_JSON"});return;}
  send(res,200,{gateway:gatewayId,slots,kind:"anonymous_device_ids",sensor_verified:false});return;
 }
 if(req.method==="GET"&&url.pathname==="/api/gateways"){const now=Date.now();send(res,200,{gateways:Array.from({length:5},(_,i)=>{const id="G0"+(i+1),last=lastByGateway.get(id)??null;return {id,lastSeen:last,online:last!==null&&now-last<=TTL_MS};})});return;}
 if(req.method==="GET"&&url.pathname==="/api/snapshot"){send(res,200,{type:"snapshot",recruits:snapshot()});return;}
 if(req.method==="GET"&&url.pathname==="/api/context"){send(res,200,{...conditions,stale:!conditions.timestamp||Date.now()-conditions.timestamp>1800000});return;}
 if(req.method==="POST"&&url.pathname==="/api/context"){
  if(!isViewer){send(res,403,{error:"viewer authorization required"});return;}
  let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>1024){send(res,413,{error:"payload too large"});return;}}
  let body;try{body=JSON.parse(raw)}catch{send(res,400,{error:"invalid JSON"});return;}
  if(!body||typeof body.wbgtC!=="number"||!Number.isFinite(body.wbgtC)||body.wbgtC<0||body.wbgtC>60){send(res,422,{error:"invalid WBGT reading"});return;}
  conditions={wbgtC:body.wbgtC,timestamp:Date.now(),source:"manual entry"};
  send(res,200,{ok:true,...conditions});return;
 }
 if(req.method==="GET"&&url.pathname==="/api/events"){
  res.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-store","Connection":"keep-alive","X-Accel-Buffering":"no"});
  res.write("retry: 3000\n\n");clients.add(res);res.write("data: "+JSON.stringify({type:"snapshot",recruits:snapshot()})+"\n\n");
  req.on("close",()=>clients.delete(res));return;
 }
 if(req.method==="POST"&&url.pathname==="/api/ingest"){
  if(!isGateway){send(res,403,{error:"gateway authorization required"});return;}
  let raw="";try{for await(const chunk of req){raw+=chunk;if(raw.length>16384){send(res,413,{error:"payload too large"});return;}}}catch{send(res,400,{error:"invalid body"});return;}
  let body;try{body=JSON.parse(raw)}catch{send(res,400,{error:"invalid JSON"});return;}
  if(!body||typeof body.gateway!=="string"||!/^G0[1-5]$/.test(body.gateway)||!Array.isArray(body.readings)||body.readings.length>15){send(res,422,{error:"invalid gateway or batch"});return;}
  if(strictMode&&gatewayId!==body.gateway){send(res,403,{error:"gateway identity mismatch"});return;}
  if(SYNTHETIC ? body.source!=="SIMULATED" : body.source!=null && body.source!=="GATEWAY"){send(res,422,{error:"source does not match server mode"});return;}
  const now=Date.now();let accepted=0;
  const seen=new Set();
  for(const item of body.readings){
   if(!item||typeof item.id!=="string"||!/^R(0[1-9]|1[0-5])$/.test(item.id)|| (item.state!=="DISCONNECTED" && (!Number.isInteger(item.hr)||item.hr<25||item.hr>240))||!Number.isSafeInteger(item.timestamp)||item.timestamp>now+1000||item.timestamp<now-MAX_AGE_MS)continue;
   if(!slotIsAuthorized(body.gateway,item)||!roster.canIngest(item.id))continue;
   if(seen.has(item.id))continue;
   seen.add(item.id);
   const prior=recruits.get(item.id);if(prior&&(prior.eventAt??prior.timestamp)>=item.timestamp)continue;
   if(prior && prior.gateway!==body.gateway && now-prior.timestamp<=TTL_MS)continue;
   const disconnected=item.state==="DISCONNECTED";
   recruits.set(item.id,{hr:disconnected?null:item.hr,timestamp:disconnected?(prior?.timestamp??null):item.timestamp,
    eventAt:item.timestamp,state:disconnected?"DISCONNECTED":"CONNECTED",gateway:body.gateway,source:SYNTHETIC?"SIMULATED":"GATEWAY"});accepted++;
  }
  lastByGateway.set(body.gateway,now);
  if(accepted)publish();send(res,200,{accepted,received:body.readings.length,request_id:randomUUID()});return;
 }
 send(res,404,{error:"not found"});
});
setInterval(publish,5000).unref();
server.listen(PORT,()=>console.log("STEVE prototype listening on",PORT,strictMode?"(strict mode)":"(development credentials)"));

