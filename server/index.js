import http from "node:http";
import { randomUUID, timingSafeEqual, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import path from "node:path";

const PORT=Number(process.env.PORT||8080);
const TOKEN=process.env.RECRUIT_MONITOR_TOKEN;
if(!TOKEN || TOKEN.length<24) { console.error("Set RECRUIT_MONITOR_TOKEN (at least 24 characters)");process.exit(1); }
const TTL_MS=15000;
const MAX_AGE_MS=60000;
const recruits=new Map();
const clients=new Set();
const sessions=new Map();
const lastByGateway=new Map();
const SESSION_MS=8*60*60*1000;
const liveDashboard=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../dashboard/live.html");
const dashboard=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../dashboard/index.html");
function auth(req){const provided=req.headers.authorization?.replace(/^Bearer /,"")||"";
 const a=Buffer.from(provided),b=Buffer.from(TOKEN);
 return a.length===b.length&&timingSafeEqual(a,b);
}
function validToken(value){const a=Buffer.from(value||""),b=Buffer.from(TOKEN);return a.length===b.length&&timingSafeEqual(a,b);}
function viewer(req){const cookie=req.headers.cookie?.match(/(?:^|;\s*)rhm_session=([a-f0-9]{64})(?:;|$)/)?.[1];if(!cookie)return false;const expiry=sessions.get(cookie);if(!expiry)return false;if(expiry<Date.now()){sessions.delete(cookie);return false;}return true;}
function send(res,code,data){res.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(data));}
function snapshot(){const now=Date.now();return Array.from({length:15},(_,i)=>{const id="R"+String(i+1).padStart(2,"0");const r=recruits.get(id);
return {id,hr:r&&now-r.timestamp<=TTL_MS?r.hr:null,timestamp:r?.timestamp??null,stale:!r||now-r.timestamp>TTL_MS,gateway:r?.gateway??null};});}
function publish(){const msg="data: "+JSON.stringify({type:"snapshot",recruits:snapshot()})+"\n\n";for(const c of clients){try{c.write(msg)}catch{clients.delete(c)}}}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,"http://localhost");
 if(url.pathname==="/health"){send(res,200,{ok:true});return;}
 if(req.method==="POST"&&url.pathname==="/api/login"){
  let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>2048){send(res,413,{error:"too large"});return;}}
  let input;try{input=JSON.parse(raw)}catch{send(res,400,{error:"invalid JSON"});return;}
  if(!validToken(input?.token)){send(res,401,{error:"unauthorized"});return;}
  const session=randomBytes(32).toString("hex");sessions.set(session,Date.now()+SESSION_MS);
  res.setHeader("Set-Cookie",`rhm_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.COOKIE_SECURE==="1"?"; Secure":""}`);
  send(res,200,{ok:true});return;
 }
 if(req.method==="POST"&&url.pathname==="/api/logout"){
  const cookie=req.headers.cookie?.match(/(?:^|;\s*)rhm_session=([a-f0-9]{64})(?:;|$)/)?.[1];if(cookie)sessions.delete(cookie);
  res.setHeader("Set-Cookie","rhm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");send(res,200,{ok:true});return;
 }
 const isViewer=viewer(req),isGateway=auth(req);
 if(url.pathname==="/live"&&req.method==="GET"){
  res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Content-Security-Policy":"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'"});res.end(await readFile(liveDashboard));return;
 }
 if(!isViewer&&!isGateway){send(res,401,{error:"unauthorized"});return;}
 if(req.method==="GET"&&url.pathname==="/"){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","Content-Security-Policy":"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'"});res.end(await readFile(dashboard));return;}
 if(req.method==="GET"&&url.pathname==="/api/gateways"){const now=Date.now();send(res,200,{gateways:Array.from({length:5},(_,i)=>{const id="G0"+(i+1),last=lastByGateway.get(id)??null;return {id,lastSeen:last,online:last!==null&&now-last<=TTL_MS};})});return;}
 if(req.method==="GET"&&url.pathname==="/api/snapshot"){send(res,200,{type:"snapshot",recruits:snapshot()});return;}
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
  const now=Date.now();let accepted=0;
  const seen=new Set();
  for(const item of body.readings){
   if(!item||typeof item.id!=="string"||!/^R(0[1-9]|1[0-5])$/.test(item.id)||!Number.isInteger(item.hr)||item.hr<25||item.hr>240||!Number.isFinite(item.timestamp)||item.timestamp>now+5000||item.timestamp<now-MAX_AGE_MS)continue;
   if(seen.has(item.id))continue;
   seen.add(item.id);
   const prior=recruits.get(item.id);if(prior&&prior.timestamp>=item.timestamp)continue;
   if(prior && prior.gateway!==body.gateway && now-prior.timestamp<=TTL_MS)continue;
   recruits.set(item.id,{hr:item.hr,timestamp:item.timestamp,gateway:body.gateway});accepted++;
  }
  lastByGateway.set(body.gateway,now);
  if(accepted)publish();send(res,200,{accepted,received:body.readings.length,request_id:randomUUID()});return;
 }
 send(res,404,{error:"not found"});
});
setInterval(publish,5000).unref();
server.listen(PORT,()=>console.log("Recruit monitor listening on",PORT));
