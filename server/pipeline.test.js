import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
import vm from "node:vm";

test("15 slots / 5 authenticated gateways → HTTP ingest → SSE → live dashboard, loss and recovery",
 {timeout:45000}, async()=>{
 const port=28000+Math.floor(Math.random()*1000),base="http://127.0.0.1:"+port;
 const tokens=Object.fromEntries(Array.from({length:5},(_,i)=>["G0"+(i+1),"synthetic-ci-gateway-"+i+"-not-a-real-secret-123456789"]));
 const viewer="synthetic-viewer-only-not-a-real-secret-123456789";
 const mapping=Object.fromEntries(Object.keys(tokens).map((g,i)=>[g,Object.fromEntries(Array.from({length:3},(_,j)=>["R"+String(i*3+j+1).padStart(2,"0"),"synthetic-"+(i*3+j+1)]))]));
 const proc=spawn(process.execPath,["index.js"],{cwd:new URL(".",import.meta.url),env:{...process.env,
  NODE_ENV:"test",PORT:String(port),STEVE_VIEWER_TOKEN:viewer,STEVE_GATEWAY_TOKENS_JSON:JSON.stringify(tokens),
  STEVE_SLOT_MAP_JSON:JSON.stringify(mapping),STEVE_SYNTHETIC_MODE:"1",STEVE_DEMO_MODE:""},stdio:"ignore"});
 const timers=[],streams=[];let cookie="",lastEvent,events=0;
 try {
  for(let i=0;i<80;i++){try{if((await fetch(base+"/health")).ok)break;}catch{}await delay(100);}
  const login=await fetch(base+"/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:viewer})});
  assert.equal(login.status,200);cookie=login.headers.get("set-cookie").split(";")[0];
  const elements=new Map();
  const el=id=>{if(!elements.has(id))elements.set(id,{hidden:false,value:"",textContent:"",innerHTML:"",setAttribute(name,value){this[name]=value;}});return elements.get(id);};
  class EventSource {
   constructor(path){
    this.controller=new AbortController();streams.push(this);
    (async()=>{
     try{
      const response=await fetch(base+path,{headers:{Cookie:cookie},signal:this.controller.signal});
      assert.equal(response.status,200);
      this.onopen?.();
      let buffer="";
      for await(const chunk of response.body){
       buffer+=Buffer.from(chunk).toString();
       let boundary;
       while((boundary=buffer.indexOf("\n\n"))>=0){
        const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
        if(frame.startsWith("data: ")){
         lastEvent=JSON.parse(frame.slice(6));events++;
         this.onmessage?.({data:frame.slice(6)});
        }
       }
      }
     }catch(error){if(error.name!=="AbortError")this.onerror?.(error);}
    })();
   }
   close(){this.controller.abort();}
  }
  const html=await (await fetch(base+"/live")).text();
  const context=vm.createContext({
   document:{getElementById:el},EventSource,Date,Math,Number,String,Array,JSON,
   fetch:(path,options={})=>fetch(base+path,{...options,headers:{...options.headers,Cookie:cookie}}),
   setInterval:(fn,ms)=>{const t=setInterval(fn,ms);timers.push(t);return t;}
  });
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await delay(50);}assert.fail("condition timed out");}
  await until(()=>streams.length===1 && lastEvent);
  // SSE can open before the separately authorized roster request completes; wait for the
  // enrolled/synthetic cards instead of asserting against the temporary loading placeholder.
  await until(()=>el("cards").innerHTML.includes("NO DATA"));
  assert.ok(lastEvent.recruits.every(r=>r.source==="SIMULATED"),"empty synthetic slots retain mode labels");
  assert.ok(lastEvent.recruits.some(r=>r.gateway==="G05"),"provisioned ownership retained in telemetry before first measurement");
  assert.doesNotMatch(el("cards").innerHTML,/Gateway:/,"technical routing omitted from commander cards");
  const packet=(g,ts=Date.now())=>Object.entries(mapping[g]).map(([id,device_id])=>({id,device_id,hr:70+Number(id.slice(1)),timestamp:ts}));
  async function ingest(g,readings,source="SIMULATED"){
   const r=await fetch(base+"/api/ingest",{method:"POST",headers:{Authorization:"Bearer "+tokens[g],"Content-Type":"application/json"},
    body:JSON.stringify({gateway:g,source,readings})});
   return {status:r.status,...await r.json()};
  }
  for(const g of Object.keys(tokens))assert.equal((await ingest(g,packet(g))).accepted,3);
  await until(()=>lastEvent.recruits.every(r=>!r.stale));
  assert.equal(lastEvent.recruits.length,15);
  for(const r of lastEvent.recruits){
   assert.equal(r.hr,70+Number(r.id.slice(1)));
   assert.equal(r.gateway,"G0"+(Math.floor((Number(r.id.slice(1))-1)/3)+1));
   assert.equal(r.source,"SIMULATED");
  }
  assert.equal((el("cards").innerHTML.match(/SIMULATED/g)||[]).length,15);
  const replay=packet("G01",lastEvent.recruits[0].timestamp);
  assert.equal((await ingest("G01",replay)).accepted,0,"identical timestamps cannot refresh data");
  assert.equal((await ingest("G01",packet("G01",Date.now()-60000))).accepted,0);
  assert.equal((await ingest("G01",packet("G01",Date.now()+10000))).accepted,0);
  assert.equal((await ingest("G01",packet("G02"))).accepted,0,"wrong slot owner rejected");
  assert.equal((await ingest("G01",[{...packet("G01")[0],device_id:"wrong-device"}])).accepted,0);
  assert.equal((await ingest("G01",packet("G01"),"GATEWAY")).status,422,"demo/live sources cannot mix");
  await delay(2);
  const duplicates=[packet("G01")[0],packet("G01")[0]];
  assert.equal((await ingest("G01",duplicates)).accepted,1,"duplicate slot in one batch ignored");
  await delay(2);
  const lost={id:"R03",device_id:"synthetic-3",state:"DISCONNECTED",timestamp:Date.now()};
  assert.equal((await ingest("G01",[lost])).accepted,1);
  await until(()=>lastEvent.recruits[2].state==="DISCONNECTED");
  assert.equal(lastEvent.recruits[2].hr,null);
  assert.match(el("cards").innerHTML,/DISCONNECTED/);
  // Stop G03 entirely; keep other gateways live, but R03 remains disconnected.
  const deadline=Date.now()+16500;
  while(Date.now()<deadline){
   for(const g of ["G01","G02","G04","G05"])await ingest(g,packet(g).filter(r=>r.id!=="R03"));
   await delay(1000);
  }
  await until(()=>lastEvent.recruits.filter(r=>!r.stale).length===11);
  for(const r of lastEvent.recruits.slice(6,9)){assert.equal(r.state,"STALE");assert.equal(r.hr,null);}
  assert.equal(lastEvent.recruits[0].hr,71,"other slots remain independent");
  const gateways=await (await fetch(base+"/api/gateways",{headers:{Cookie:cookie}})).json();
  assert.equal(gateways.gateways[2].online,false);
  assert.equal(gateways.gateways[0].online,true);
  for(const g of Object.keys(tokens))assert.equal((await ingest(g,packet(g))).accepted,3);
  await until(()=>lastEvent.recruits.every(r=>!r.stale));
  assert.ok(events>10,"dashboard received automatic SSE updates");
  // Logout must clear cached rows and never redraw them on the next timer.
  await el("logout").onclick();
  await delay(1100);
  assert.equal(el("cards").innerHTML,"");
 } finally {
  timers.forEach(clearInterval);streams.forEach(s=>s.close());proc.kill();
 }
});
