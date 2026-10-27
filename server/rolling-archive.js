// Encrypted seven-day archive independent of the 4-hour live chart.
// Capture at most one genuine HR sample per ~7-second time bucket per slot.
// One ciphertext row per slot/wearer/minute keeps the database bounded and
// avoids storing a week of medical observations in the 8 MiB state snapshot.
import {createHmac} from "node:crypto";
export const ARCHIVE_STEP_MS=7000;
export const ARCHIVE_RETENTION_MS=7*24*60*60*1000;
const MINUTE_MS=60000;
const CLOSED_GRACE_MS=15000;
const SLOTS=new Set(Array.from({length:15},(_,i)=>"R"+String(i+1).padStart(2,"0")));

export class RollingArchive {
 constructor(durable,env=process.env){
  this.durable=durable;
  this.enabled=env.STEVE_ARCHIVE_ENABLED==="1";
  if(this.enabled&&!durable.enabled)throw Error("STEVE_ARCHIVE_ENABLED requires configured encrypted Supabase storage");
  this.endpoint=this.enabled?durable.endpoint.replace(/steve_secure_state$/,"steve_hr_archive"):null;
  this.pending=new Map();this.queue=Promise.resolve();
  this.lastWriteAt=null;this.lastReadAt=null;this.lastCleanupAt=null;this.failed=false;
 }
 status(){return {enabled:this.enabled,state:!this.enabled?"disabled":this.failed?"unavailable":this.lastWriteAt?"write-confirmed":this.lastReadAt?"read-confirmed":"unverified",lastWriteAt:this.lastWriteAt,lastReadAt:this.lastReadAt,lastCleanupAt:this.lastCleanupAt,pendingMinutes:this.pending.size,intervalSeconds:7,retentionDays:7};}
 owner(slot,code){
  // Keyed pseudonym: neither the recruit code nor the service-side secret is stored in plaintext.
  return createHmac("sha256",this.durable.key).update(slot+"\0"+code.toUpperCase()).digest("hex");
 }
 record(slot,code,hr,timestamp,now=Date.now()){
  if(!this.enabled||!SLOTS.has(slot)||!code||!Number.isInteger(hr)||hr<25||hr>240||
    !Number.isSafeInteger(timestamp)||timestamp>now+1000||timestamp<now-15000)return false;
  const minute=Math.floor(timestamp/MINUTE_MS)*MINUTE_MS;
  const owner=this.owner(slot,code),key=slot+"|"+owner+"|"+minute;
  const entry=this.pending.get(key)||{slot,owner,minute_ms:minute,points:[]};
  const bucket=Math.floor(timestamp/ARCHIVE_STEP_MS);
  if(entry.points.some(p=>Math.floor(p[0]/ARCHIVE_STEP_MS)===bucket))return false;
  entry.points.push([timestamp,hr]);entry.points.sort((a,b)=>a[0]-b[0]);
  this.pending.set(key,entry);
  return true;
 }
 forget(slot){
  for(const key of this.pending.keys())if(key.startsWith(slot+"|"))this.pending.delete(key);
  if(!this.enabled)return Promise.resolve();
  // Serialize after earlier archive writes so an old wearer cannot reappear.
  const job=async()=>{
   try{
    await this.durable.request(this.endpoint+"?slot=eq."+slot,{method:"DELETE",headers:{"Prefer":"return=minimal"}});
    this.failed=false;
   }catch(e){this.failed=true;throw e;}
  };
  this.queue=this.queue.catch(()=>{}).then(job);
  return this.queue;
 }
 async verify(){
  if(!this.enabled)return;
  try{
   await this.durable.request(this.endpoint+"?select=slot&limit=0",{method:"GET"},r=>r.json());
   this.lastReadAt=new Date().toISOString();this.failed=false;
  }catch(e){this.failed=true;throw e;}
 }
 async flush(now=Date.now()){
  if(!this.enabled)return;
  const ready=[];
  for(const [key,item] of this.pending){
   if(item.minute_ms+MINUTE_MS+CLOSED_GRACE_MS<=now){
    this.pending.delete(key);ready.push({key,item});
   }
  }
  if(!ready.length)return this.queue;
  const job=async()=>{
   const rows=ready.map(({item})=>({
    slot:item.slot,owner:item.owner,minute_ms:item.minute_ms,
    envelope:this.durable.encrypt({schema:1,kind:"hr-minute-v1",slot:item.slot,owner:item.owner,minute_ms:item.minute_ms,points:item.points})
   }));
   try{
    await this.durable.request(this.endpoint+"?on_conflict=slot,owner,minute_ms",{
     method:"POST",headers:{"Content-Type":"application/json","Prefer":"resolution=merge-duplicates,return=minimal"},
     body:JSON.stringify(rows)
    });
    this.lastWriteAt=new Date().toISOString();this.failed=false;
   }catch(e){
    for(const {key,item} of ready)if(!this.pending.has(key))this.pending.set(key,item);
    this.failed=true;throw e;
   }
  };
  this.queue=this.queue.catch(()=>{}).then(job);
  return this.queue;
 }
 async cleanup(now=Date.now()){
  if(!this.enabled)return;
  const cutoff=now-ARCHIVE_RETENTION_MS;
  const job=async()=>{
   try{
    await this.durable.request(this.endpoint+"?minute_ms=lt."+cutoff,{
     method:"DELETE",headers:{"Prefer":"return=minimal"}
    });
    this.lastCleanupAt=new Date().toISOString();this.failed=false;
   }catch(e){this.failed=true;throw e;}
  };
  this.queue=this.queue.catch(()=>{}).then(job);
  return this.queue;
 }
 async get(slot,code,hours=24,now=Date.now()){
  if(!this.enabled)throw Error("Archive not enabled");
  if(!SLOTS.has(slot)||!code||![4,24,168].includes(hours))throw Error("Invalid archive query");
  const owner=this.owner(slot,code),since=now-hours*3600000,from=Math.floor(since/MINUTE_MS)*MINUTE_MS;
  const cutoff=Math.max(since,now-ARCHIVE_RETENTION_MS);
  const result=[];
  // Supabase/PostgREST defaults to 1,000 rows/page. Always paginate.
  for(let offset=0;offset<=11000;offset+=1000){
   const u=this.endpoint+"?slot=eq."+slot+"&owner=eq."+owner+
    "&minute_ms=gte."+from+"&minute_ms=lte."+now+
    "&select=slot,owner,minute_ms,envelope&order=minute_ms.asc&limit=1000&offset="+offset;
   const rows=await this.durable.request(u,{method:"GET"},r=>r.json());
   if(!Array.isArray(rows)||rows.length>1000)throw Error("Invalid archived HR response");
   for(const row of rows){
    const data=this.durable.decrypt(row.envelope);
    if(data.kind!=="hr-minute-v1"||data.slot!==slot||data.owner!==owner||
       data.minute_ms!==Number(row.minute_ms)||!Array.isArray(data.points)||data.points.length>10)
     throw Error("Archive integrity mismatch");
    for(const p of data.points){
     if(!Array.isArray(p)||p.length!==2||!Number.isSafeInteger(p[0])||!Number.isInteger(p[1])||
        p[1]<25||p[1]>240||p[0]<data.minute_ms||p[0]>=data.minute_ms+MINUTE_MS)
      throw Error("Invalid archive sample");
     if(p[0]>=cutoff&&p[0]<=now)result.push(p);
    }
   }
   if(rows.length<1000)break;
   if(offset===11000)throw Error("Archive page safety limit exceeded");
  }
  this.lastReadAt=new Date().toISOString();this.failed=false;
  return result.sort((a,b)=>a[0]-b[0]);
 }
}
