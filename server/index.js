import http from "node:http";
import { GatewaySessions, gatewayBrowserRequest } from './gateway-session.js';
import { randomUUID, randomBytes } from "node:crypto";
import { gatewayForBearer, viewerRoleForToken, slotIsAuthorized, strictMode, provisionedGateway, provisionedDevicesForGateway } from "./contract.js";
import { RosterStore } from "./roster.js";
import { PulseHistory, WINDOW_MS } from "./pulse-history.js";
import { DurableState } from "./durable-state.js";
import { RollingArchive, HISTORY_HOURS } from "./rolling-archive.js";
import { PrivateProfiles } from "./private-profiles.js";
import { MedicReviews, describeSignal } from "./medic-review.js";
import { AutoHRMonitor } from "./auto-hr-monitor.js";
import { trainingSummary } from "./training-summary.js";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import path from "node:path";

const PORT=Number(process.env.PORT||8080);
const TTL_MS=15000;
const DEMO_ENABLED=process.env.STEVE_DEMO_MODE==="1" && process.env.NODE_ENV!=="production";
const MAX_AGE_MS=15000;
const SYNTHETIC=DEMO_ENABLED || (process.env.STEVE_SYNTHETIC_MODE==="1" && process.env.NODE_ENV!=="production");
const recruits=new Map();
const pulseHistory=new PulseHistory();
const durable=new DurableState();
const archive=new RollingArchive(durable);
const privateProfiles=new PrivateProfiles();
const medicReviews=new MedicReviews();
const autoHR=new AutoHRMonitor();
let writeQueue=Promise.resolve(),historyDirty=false;
function stateSnapshot(){return {schema:1,roster:roster.exportData(),history:pulseHistory.export(),
 profiles:privateProfiles.export(),medicReviews:medicReviews.export(),conditions};}
function persistState(){
 if(!durable.enabled)return Promise.resolve();
 writeQueue=writeQueue.catch(()=>{}).then(()=>durable.save(stateSnapshot()));
 return writeQueue;
}
// Reject queued measurements recorded before a wearer changed.
const reassignmentCutoff=new Map();
const clients=new Map();
const sessions=new Map();
const gatewaySessions=new GatewaySessions();
const failedLogins=new Map();
const roster=new RosterStore(durable.enabled?"":process.env.STEVE_ROSTER_FILE||"");
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
  const code=roster.get(id).code,rev=code?medicReviews.get(id,code):null;
  const autoCheck=!!(rev?.status==="pending"&&(rev?.openedBy==="system"||rev?.autoPauseRequired));
  const profile=code?privateProfiles.get(id,code):null;
  const monitoringStatus=profile?.reviewThresholdConfirmed&&profile?.reviewThresholdBpm!==null?"OPERATOR_CONFIGURED_UNVERIFIED":"MONITORING_NOT_CONFIGURED";
  return {id,autoCheck,monitoringStatus,hr:state==="CONNECTED"?r.hr:null,timestamp:r?.timestamp??null,
   stale:state!=="CONNECTED",state,paused,gateway,gatewayOnline,source:r?.source??(SYNTHETIC?"SIMULATED":null)};
 });}
function publish(){const msg="data: "+JSON.stringify({type:"snapshot",recruits:snapshot()})+"\n\n";for(const [c,req] of clients){if(!viewer(req)){clients.delete(c);c.end();continue;}try{c.write(msg)}catch{clients.delete(c)}}}
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
  if(roster.get(id).code&&pulseHistory.record(id,hr,now,now))historyDirty=true;
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
 if(url.pathname==='/api/gateway/session' && req.method==='POST'){
  if(!gatewayBrowserRequest(req)){send(res,403,{error:'origin mismatch'});return;}
  const gateway=gatewayForBearer(req);
  if(!gateway || !/^G0[1-5]$/.test(gateway)){send(res,401,{error:'gateway credential required'});return;}
  const key=gatewaySessions.create(req,gateway);
  if(!key){send(res,503,{error:'session capacity reached'});return;}
  res.setHeader('Set-Cookie',gatewaySessions.cookie(key,gateway));
  send(res,200,{ok:true,gateway,expiresAt:gatewaySessions.get({headers:{cookie:'steve_gateway='+key}}).expiry});return;
 }
 if(url.pathname==='/api/gateway/session' && req.method==='DELETE'){
  if(!gatewayBrowserRequest(req)){send(res,403,{error:'origin mismatch'});return;}
  gatewaySessions.revoke(req);res.setHeader('Set-Cookie',gatewaySessions.cookie(''));send(res,200,{ok:true});return;
 }
 // Browser sessions grant only provision/ingest, never viewer or operator access.
 const browserGateway=['/api/gateway/provision','/api/ingest'].includes(url.pathname)&&gatewayBrowserRequest(req)?gatewaySessions.get(req):null;
 const isViewer=viewer(req),gatewayId=gatewayForBearer(req)||browserGateway?.gateway,isGateway=Boolean(gatewayId);
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
 if(url.pathname==="/api/storage/status" && req.method==="GET"){
  if(!isViewer){send(res,403,{error:"operator authorization required"});return;}
  send(res,200,durable.status());return;
 }
 if(url.pathname==="/api/archive/status" && req.method==="GET"){
  if(!isViewer){send(res,403,{error:"operator authorization required"});return;}
  send(res,200,archive.status());return;
 }
 if(url.pathname==="/api/operator/me" && req.method==="GET"){
  if(!isViewer){send(res,403,{error:"operator authorization required"});return;}
  send(res,200,{role:isViewer,permissions:["roster:read","roster:write","audit:read","context:write","training:read","training:write",...(["trainer","medic"].includes(isViewer)&&durable.enabled?["private-profile:read","private-profile:write"]:[])],
 durable:durable.enabled,privateProfilesEnabled:durable.enabled&&["trainer","medic"].includes(isViewer)});return;
 }
 if(url.pathname==="/api/roster" && req.method==="GET"){
  if(!isViewer){send(res,403,{error:"operator authorization required"});return;}
  send(res,200,{slots:roster.all(),ephemeral:!durable.enabled&&!roster.filename,
   purpose:"pseudonymous operational information only — no diagnoses or real identifiers"});return;
 }
 if(url.pathname==="/api/roster/audit" && req.method==="GET"){
  if(!isViewer){send(res,403,{error:"operator authorization required"});return;}
  send(res,200,{events:roster.getAudit()});return;
 }
 // The commander and legacy viewer receive only the aggregate review count.
 // Notes, reasons, identity and medical context stay behind trainer/medic access.
 if(url.pathname==="/api/medic-reviews/summary"&&req.method==="GET"){
  if(!isViewer){send(res,403,{error:"viewer session required"});return;}
  send(res,200,{pending:medicReviews.countPending(roster)});return;
 }
 const medicRoute=url.pathname.match(/^\/api\/medic-reviews\/(R(?:0[1-9]|1[0-5]))$/);
 if(medicRoute){
  if(!["trainer","medic"].includes(isViewer)){send(res,403,{error:"trainer/medic session required"});return;}
  if(!durable.enabled){send(res,503,{error:"encrypted durable store required"});return;}
  const slot=medicRoute[1],code=roster.get(slot).code,rosterVersion=roster.get(slot).version;
  if(!code){send(res,409,{error:"register wearer before medical review"});return;}
  if(req.method==="GET"){
   try{
    const profile=privateProfiles.get(slot,code),review=medicReviews.get(slot,code);
    const phase=roster.getGroupPhase();
    let archiveUnavailable=false,points=pulseHistory.get(slot,Date.now());
    if(archive.enabled){try{points=await archive.get(slot,code,4);}catch{archiveUnavailable=true;}}
    if(roster.get(slot).version!==rosterVersion){send(res,409,{error:"wearer changed; reload before continuing"});return;}
    // Comparison is descriptive only; rest phase must be recorded by a human.
    const baseline=profile.baselineConfirmed&&phase.phase==="hourly_rest"?
     profile.restingBaselineBpm:null;
    const signal=describeSignal(pulseHistory.get(slot,Date.now()),Date.now(),baseline);
    const restVerified=phase.phase==="hourly_rest"&&Number.isSafeInteger(phase.changedAt)&&
     Date.now()-phase.changedAt>=3*60000;
    if(!restVerified)signal.deltaBpm=null;
    send(res,200,{slot,review,signal,archiveUnavailable,phase:phase.phase,
     restPhaseRecorded:restVerified,baselineConfigured:profile.baselineConfirmed,
     context:{ageYears:profile.ageYears,bmi:profile.bmi,medications:profile.medications,
      conditions:profile.conditions,wbgtC:conditions.timestamp&&Date.now()-conditions.timestamp<=1800000?conditions.wbgtC:null},
     // Actual accepted measurements only; never synthesize missing points.
     points:points.slice(-200),medicalDisclaimer:"Signal/context only; requires human clinical assessment"});
   }catch{send(res,503,{error:"private medical review unavailable"});}
   return;
  }
  if(req.method!=="PUT"){send(res,405,{error:"method not allowed"});return;}
  if(!sameOrigin(req)){send(res,403,{error:"origin mismatch"});return;}
  if(!req.headers["content-type"]?.toLowerCase().startsWith("application/json")){send(res,415,{error:"JSON required"});return;}
  try{
   const body=await readBody(req,900);
   if(roster.get(slot).version!==rosterVersion){send(res,409,{error:"wearer changed; reload before continuing"});return;}
   const backup=medicReviews.export()[slot];
   const review=medicReviews.update(slot,code,body,isViewer);
   try{await persistState();}
   catch{if(roster.get(slot).version===rosterVersion)medicReviews.rollback(slot,review,backup);historyDirty=true;send(res,503,{error:"review not confirmed; durable storage unavailable"});return;}
   if(roster.get(slot).version!==rosterVersion){send(res,409,{error:"wearer changed; reload before continuing"});return;}
   send(res,200,{review});
  }catch(e){send(res,e.status||500,{error:e.status?e.message:"review request unavailable"});}
  return;
 }
 const privateRoute=url.pathname.match(/^\/api\/private-profile\/(R(?:0[1-9]|1[0-5]))$/);
 if(privateRoute){
  if(!["trainer","medic"].includes(isViewer)){send(res,403,{error:"trainer/medic session required"});return;}
  if(!durable.enabled){send(res,503,{error:"secure external storage not yet configured"});return;}
  const slot=privateRoute[1],code=roster.get(slot).code,rosterVersion=roster.get(slot).version;
  if(!code){send(res,409,{error:"register recruit before storing private information"});return;}
  if(req.method==="GET"){send(res,200,{profile:privateProfiles.get(slot,code),sensitive:true});return;}
  if(req.method!=="PUT"){send(res,405,{error:"method not allowed"});return;}
  if(!sameOrigin(req)){send(res,403,{error:"origin mismatch"});return;}
  if(!req.headers["content-type"]?.toLowerCase().startsWith("application/json")){send(res,415,{error:"JSON required"});return;}
  try{
   const body=await readBody(req,1024);
   if(roster.get(slot).version!==rosterVersion){send(res,409,{error:"wearer changed; reload before continuing"});return;}
   const backup=privateProfiles.export()[slot];
   const profile=privateProfiles.update(slot,code,body);
   try{await persistState();}
   catch{if(roster.get(slot).version===rosterVersion)privateProfiles.rollback(slot,profile,backup);historyDirty=true;send(res,503,{error:"secure storage unavailable; changes not confirmed"});return;}
   if(roster.get(slot).version!==rosterVersion){send(res,409,{error:"wearer changed; reload before continuing"});return;}
   send(res,200,{profile,sensitive:true});
  }catch(e){send(res,e.status||500,{error:e.status?e.message:"private profile unavailable"});}
  return;
 }
 const archiveRoute=url.pathname.match(/^\/api\/archive\/(R(?:0[1-9]|1[0-5]))$/);
 if(archiveRoute&&req.method==="GET"){
  if(!["trainer","medic"].includes(isViewer)){send(res,403,{error:"trainer/medic session required"});return;}
  if(!archive.enabled){send(res,503,{error:"seven-day archive not enabled"});return;}
  const hours=Number(url.searchParams.get("hours")||24);
  if(![...HISTORY_HOURS,24].includes(hours)){send(res,422,{error:"invalid archive window"});return;}
  const slot=archiveRoute[1],code=roster.get(slot).code,rosterVersion=roster.get(slot).version;
  if(!code){send(res,409,{error:"recruit not registered"});return;}
  try{
   const compact=url.searchParams.get("compact")==="1";
   const now=Date.now(),start=now-hours*3600000;
   const points=await archive.get(slot,code,hours,now,compact);
   if(roster.get(slot).version!==rosterVersion){send(res,409,{error:"wearer changed; reload before continuing"});return;}
   const phases=roster.getTrainingTimeline(start,now);
   send(res,200,{slot,windowStart:start,windowEnd:now,phases,phaseScope:"cohort",windowHours:hours,retentionDays:7,sampleIntervalSeconds:7,points,compacted:compact&&(hours===8||hours===168),source:"actual accepted HR only"});
  }catch{send(res,503,{error:"encrypted archive unavailable"});}
  return;
 }
 const historyRoute=url.pathname.match(/^\/api\/history\/(R(?:0[1-9]|1[0-5]))$/);
 if(historyRoute&&req.method==="GET"){
  if(!isViewer){send(res,403,{error:"operator authorization required"});return;}
  const slot=historyRoute[1],item=snapshot().find(p=>p.id===slot);
  if(!roster.get(slot).code||item?.state!=="CONNECTED"){
   send(res,409,{error:"NO DATA: กราฟใช้ได้เฉพาะทหารที่มี BPM สด"});return;
  }
  const now=Date.now(),start=now-WINDOW_MS;
  const hours=Number(url.searchParams.get("hours")||4);
  if(![0.25,0.5,1,2,4].includes(hours)){send(res,422,{error:"invalid history window"});return;}
  const points=pulseHistory.get(slot,now),phases=roster.getTrainingTimeline(start,now);
  send(res,200,{slot,windowStart:start,windowEnd:now,windowHours:4,
   sampleIntervalSeconds:5,ephemeral:!durable.enabled,points,phases,
   summaryHours:hours,summary:trainingSummary(points,phases,now-hours*3600000,now)});
  return;
 }
 if(url.pathname==="/api/training"&&req.method==="GET"){
  if(!isViewer){send(res,403,{error:"operator authorization required"});return;}
  send(res,200,{...roster.getGroupPhase(),transitions:roster.getTrainingTimeline(Date.now()-48*3600000),ephemeral:!durable.enabled&&!roster.filename});return;
 }
 if(url.pathname==="/api/training"&&req.method==="PUT"){
  if(!isViewer){send(res,403,{error:"operator authorization required"});return;}
  if(!sameOrigin(req)){send(res,403,{error:"origin mismatch"});return;}
  if(!req.headers["content-type"]?.toLowerCase().startsWith("application/json")){send(res,415,{error:"JSON required"});return;}
  try{const body=await readBody(req,512);const result=roster.setGroupPhase(body,isViewer);
   await persistState();send(res,200,{ok:true,...result,transitions:roster.getTrainingTimeline(Date.now()-48*3600000),ephemeral:!durable.enabled&&!roster.filename});}
  catch(e){send(res,e.status||500,{error:e.status?e.message:"training phase update unavailable"});}
  return;
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
   const previous=roster.get(slot);
   const current=action==="replace"?roster.replace(slot,body,isViewer):
      action==="resume"?roster.resume(slot,body,isViewer):
      action==="acknowledge"?roster.acknowledge(slot,body,isViewer):
      roster.update(slot,body,isViewer);
   const wearerChanged=previous.code!==null&&current.code!==null&&
     previous.code.toUpperCase()!==current.code.toUpperCase();
   const firstAssignment=previous.code===null&&current.code!==null;
   if(action==="replace"||wearerChanged||firstAssignment){
    // Never attribute a previously measured BPM to a new wearer.
    recruits.delete(slot);pulseHistory.clear(slot);privateProfiles.clear(slot);medicReviews.clear(slot);autoHR.reset(slot);
    reassignmentCutoff.set(slot,Number.MAX_SAFE_INTEGER);
    try{await archive.forget(slot);}
    finally{if(roster.get(slot).version===current.version)reassignmentCutoff.set(slot,Date.now());publish();}
   }else if(action==="resume")publish();
   await persistState();send(res,200,{ok:true,slot:current});
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
  send(res,200,{gateway:gatewayId,slots,kind:"anonymous_device_ids",sensor_verified:false,...(browserGateway?{expiresAt:browserGateway.expiry}:{})});return;
 }
 if(strictMode&&!isViewer&&["/api/snapshot","/api/events","/api/gateways","/api/context"].includes(url.pathname)){send(res,403,{error:"viewer session required"});return;}
 if(req.method==="GET"&&url.pathname==="/api/gateways"){const now=Date.now();send(res,200,{gateways:Array.from({length:5},(_,i)=>{const id="G0"+(i+1),last=lastByGateway.get(id)??null;return {id,lastSeen:last,online:last!==null&&now-last<=TTL_MS};})});return;}
 if(req.method==="GET"&&url.pathname==="/api/snapshot"){send(res,200,{type:"snapshot",recruits:snapshot()});return;}
 if(req.method==="GET"&&url.pathname==="/api/context"){send(res,200,{...conditions,stale:!conditions.timestamp||Date.now()-conditions.timestamp>1800000});return;}
 if(req.method==="POST"&&url.pathname==="/api/context"){
  if(!isViewer){send(res,403,{error:"viewer authorization required"});return;}
  let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>1024){send(res,413,{error:"payload too large"});return;}}
  let body;try{body=JSON.parse(raw)}catch{send(res,400,{error:"invalid JSON"});return;}
  if(!body||typeof body.wbgtC!=="number"||!Number.isFinite(body.wbgtC)||body.wbgtC<0||body.wbgtC>60){send(res,422,{error:"invalid WBGT reading"});return;}
  conditions={wbgtC:body.wbgtC,timestamp:Date.now(),source:"manual entry"};
  try{await persistState();send(res,200,{ok:true,...conditions});}
  catch{send(res,503,{error:"durable storage unavailable"});}return;
 }
 if(req.method==="GET"&&url.pathname==="/api/events"){
  res.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-store","Connection":"keep-alive","X-Accel-Buffering":"no"});
  res.write("retry: 3000\n\n");clients.set(res,req);res.write("data: "+JSON.stringify({type:"snapshot",recruits:snapshot()})+"\n\n");
  req.on("close",()=>clients.delete(res));return;
 }
 if(req.method==="POST"&&url.pathname==="/api/ingest"){
  if(!isGateway){send(res,403,{error:"gateway authorization required"});return;}
  let raw="";try{for await(const chunk of req){raw+=chunk;if(raw.length>16384){send(res,413,{error:"payload too large"});return;}}}catch{send(res,400,{error:"invalid body"});return;}
  let body;try{body=JSON.parse(raw)}catch{send(res,400,{error:"invalid JSON"});return;}
  if(!body||typeof body.gateway!=="string"||!/^G0[1-5]$/.test(body.gateway)||!Array.isArray(body.readings)||body.readings.length>15){send(res,422,{error:"invalid gateway or batch"});return;}
  if(strictMode&&gatewayId!==body.gateway){send(res,403,{error:"gateway identity mismatch"});return;}
  if(SYNTHETIC ? body.source!=="SIMULATED" : body.source!=null && body.source!=="GATEWAY"){send(res,422,{error:"source does not match server mode"});return;}
  const now=Date.now();let accepted=0,autoCreated=0;
  const seen=new Set();
  for(const item of body.readings){
   if(!item||typeof item.id!=="string"||!/^R(0[1-9]|1[0-5])$/.test(item.id)|| (item.state!=="DISCONNECTED" && (!Number.isInteger(item.hr)||item.hr<25||item.hr>240))||!Number.isSafeInteger(item.timestamp)||item.timestamp>now+1000||item.timestamp<now-MAX_AGE_MS)continue;
   if(!slotIsAuthorized(body.gateway,item)||!roster.canIngest(item.id))continue;
   if(item.timestamp<=(reassignmentCutoff.get(item.id)??0))continue;
   if(seen.has(item.id))continue;
   seen.add(item.id);
   const prior=recruits.get(item.id);if(prior&&(prior.eventAt??prior.timestamp)>=item.timestamp)continue;
   if(prior && prior.gateway!==body.gateway && now-prior.timestamp<=TTL_MS)continue;
   const disconnected=item.state==="DISCONNECTED";
   recruits.set(item.id,{device_id:item.device_id,hr:disconnected?null:item.hr,timestamp:disconnected?(prior?.timestamp??null):item.timestamp,
    eventAt:item.timestamp,state:disconnected?"DISCONNECTED":"CONNECTED",gateway:body.gateway,source:SYNTHETIC?"SIMULATED":"GATEWAY"});
   // Only enrolled recruits with genuine accepted HR measurements create history.
   // NO DATA/disconnect and unregistered slots produce no history points.
   if(disconnected)autoHR.reset(item.id);
   if(!disconnected&&roster.get(item.id).code){
    const code=roster.get(item.id).code;
    if(pulseHistory.record(item.id,item.hr,item.timestamp,now))historyDirty=true;
    archive.record(item.id,code,item.hr,item.timestamp,now);
    // Never run automated medical claims on synthetic data or guessed thresholds.
    const profile=privateProfiles.get(item.id,code);
    const limit=profile.reviewThresholdConfirmed?profile.reviewThresholdBpm:null;
    const decision=autoHR.ingest(item.id,code,item.hr,item.timestamp,limit,
     {training:roster.getGroupPhase().phase==="training",real:!SYNTHETIC});
    if(decision.trigger){
     const outcome=medicReviews.autoRequest(item.id,code,"high_sustained",now);
     if(outcome.created||outcome.escalated)autoCreated++;
    }
   }
   accepted++;
  }
  lastByGateway.set(body.gateway,now);
  if(accepted)publish();
  if(autoCreated){
   // Alert is surfaced immediately even if archive persistence fails; never
   // claim durable confirmation on storage failure.
   try{await persistState();}catch{
    historyDirty=true; // Retry the pending case even if no further readings arrive.
    send(res,503,{error:"storage unavailable",accepted});
    return;
   }
  }
  send(res,200,{accepted,received:body.readings.length,request_id:randomUUID()});return;
 }
 send(res,404,{error:"not found"});
});
setInterval(publish,5000).unref();
setInterval(()=>{
 if(!durable.enabled||!historyDirty)return;
 historyDirty=false;persistState().catch(()=>{historyDirty=true;});
},30000).unref();
// Closed 1-minute encrypted HR buckets are checkpointed separately from the small operational snapshot.
setInterval(()=>archive.flush().catch(()=>{}),30000).unref();
setInterval(()=>archive.cleanup().catch(()=>{}),3600000).unref();
async function boot(){
 await archive.verify();
 if(archive.enabled)await archive.cleanup();
 if(durable.enabled){
  const state=await durable.load();
  if(state){
   if(!state.roster||!state.profiles||!state.history)throw Error("Incomplete encrypted STEVE snapshot");
   roster.loadData(state.roster);privateProfiles.load(state.profiles);pulseHistory.load(state.history);
   if(state.medicReviews)medicReviews.load(state.medicReviews);
   if(state.conditions&&typeof state.conditions==="object")conditions=state.conditions;
  }
 }
 server.listen(PORT,"0.0.0.0",()=>console.log("STEVE prototype listening on",PORT,strictMode?"(strict mode)":"(development credentials)"));
}
boot().catch(()=>{console.error("STEVE secure storage startup failed; check remote store configuration");process.exitCode=1;});

