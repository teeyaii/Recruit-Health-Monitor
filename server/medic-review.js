// STEVE: clinician-in-the-loop review workflow. No autonomous diagnoses, risk
// scores, return-to-training decisions, or hard-coded BPM alert thresholds.
import {slotIDs} from "./roster.js";
const validSlots=new Set(slotIDs);
export const REVIEW_REASONS=new Set([
 "high_sustained","rest_recovery","sudden_change","medical_context",
 "heat_exposure","signal_missing","other"
]);
const err=(status,message)=>Object.assign(new Error(message),{status});
const blank=(slot,code)=>({slot,code,status:"none",reason:null,note:"",version:0,
 requestedAt:null,closedAt:null,openedBy:null,closedBy:null});
const noteValid=s=>typeof s==="string"&&s.length<=240&&!/[<>\u0000-\u001f]/.test(s);
export class MedicReviews{
 constructor(){this.records={};}
 export(){return structuredClone(this.records);}
 load(data){
  if(!data||typeof data!=="object"||Array.isArray(data))throw Error("Invalid medic review store");
  for(const [slot,p] of Object.entries(data)){
   if(!validSlots.has(slot)||p?.slot!==slot||typeof p.code!=="string"||
    !["pending","closed"].includes(p.status)||!REVIEW_REASONS.has(p.reason)||
    (p.autoPauseRequired!==undefined&&typeof p.autoPauseRequired!=="boolean")||
    !noteValid(p.note)||!Number.isSafeInteger(p.version)||p.version<1||
    !Number.isSafeInteger(p.requestedAt)||p.requestedAt<0||
    (p.closedAt!==null&&(!Number.isSafeInteger(p.closedAt)||p.closedAt<p.requestedAt))||
    !["trainer","medic","system"].includes(p.openedBy)|| (p.closedBy!==null&&!["trainer","medic"].includes(p.closedBy)))
    throw Error("Invalid medic review entry");
  }
  this.records=structuredClone(data);
 }
 clear(slot){delete this.records[slot];}
 rollback(slot,expected,previous){
  const current=this.records[slot];
  if(!current||current.code!==expected.code||current.version!==expected.version)return false;
  if(previous)this.records[slot]=structuredClone(previous);
  else delete this.records[slot];
  return true;
 }
 get(slot,code){
  if(!validSlots.has(slot)||!code)throw err(404,"registered slot required");
  const p=this.records[slot];
  return p?.code.toUpperCase()===code.toUpperCase()?structuredClone(p):blank(slot,code);
 }
 countPending(roster){
  return slotIDs.filter(slot=>{
   const p=this.records[slot],code=roster.get(slot).code;
   return !!code&&!!p&&p.status==="pending"&&p.code.toUpperCase()===code.toUpperCase();
  }).length;
 }
 autoRequest(slot,code,reason,now=Date.now()){
  if(!REVIEW_REASONS.has(reason))throw err(422,"Invalid automatic review reason");
  const prev=this.get(slot,code);
  if(prev.status==="pending"){
   if(prev.openedBy==="system"||prev.autoPauseRequired)return {created:false,review:prev};
   // Escalate the existing ticket without duplicating it or overwriting notes.
   const next={...prev,autoPauseRequired:true,version:prev.version+1};
   this.records[slot]=next;
   return {created:false,escalated:true,review:structuredClone(next)};
  }
  const next={slot,code,status:"pending",reason,note:"",version:prev.version+1,
   requestedAt:now,closedAt:null,openedBy:"system",closedBy:null};
  this.records[slot]=next;
  return {created:true,review:structuredClone(next)};
 }
 update(slot,code,input,actor,now=Date.now()){
  if(!["trainer","medic"].includes(actor))throw err(403,"authorized clinician/operator required");
  const prior=this.get(slot,code);
  if(input?.version!==prior.version)throw err(409,"review changed; refresh first");
  if(input.action==="request"){
   if(prior.status==="pending")throw err(409,"review already pending");
   if(!REVIEW_REASONS.has(input.reason)||!noteValid(input.note||""))
    throw err(422,"valid review reason and short note required");
   const next={slot,code,status:"pending",reason:input.reason,note:(input.note||"").trim(),
    version:prior.version+1,requestedAt:now,closedAt:null,openedBy:actor,closedBy:null};
   this.records[slot]=next;return structuredClone(next);
  }
  if(input.action==="close"){
   if(prior.status!=="pending")throw err(409,"no pending review to close");
   if(!noteValid(input.note||""))throw err(422,"invalid review note");
   const next={...prior,status:"closed",note:(input.note||prior.note).trim(),
    version:prior.version+1,closedAt:now,closedBy:actor};
   this.records[slot]=next;return structuredClone(next);
  }
  throw err(422,"invalid review action");
 }
}
// These are telemetry quality heuristics, NOT a validated PPG artefact detector.
export function describeSignal(points,now=Date.now(),baselineBpm=null){
 const recent=(Array.isArray(points)?points:[]).filter(p=>Array.isArray(p)&&
  Number.isSafeInteger(p[0])&&p[0]>=now-10*60000&&p[0]<=now&&
  Number.isInteger(p[1])&&p[1]>=25&&p[1]<=240).sort((a,b)=>a[0]-b[0]);
 let gaps=0,jumps=0;
 for(let i=1;i<recent.length;i++){
  const dt=recent[i][0]-recent[i-1][0];
  if(dt>20000)gaps++;
  if(dt>0&&dt<=15000&&Math.abs(recent[i][1]-recent[i-1][1])>=45)jumps++;
 }
 const newest=recent.at(-1),fresh=!!newest&&now-newest[0]<=15000;
 const sufficient=recent.length>=12&&recent.at(-1)[0]-recent[0][0]>=120000;
 const quality=!fresh?"no_live_data":!sufficient?"insufficient":(gaps||jumps)?"check_signal":"usable_for_description";
 const lastThree=recent.filter(p=>p[0]>=now-180000);
 const mean=lastThree.length>=8&&lastThree.at(-1)[0]-lastThree[0][0]>=90000?
  Math.round(lastThree.reduce((a,p)=>a+p[1],0)/lastThree.length):null;
 // Delta is contextual only, never a risk verdict or medical threshold.
 const deviation=quality==="usable_for_description"&&mean!==null&&Number.isInteger(baselineBpm)?
  mean-baselineBpm:null;
 return {quality,fresh,samples:recent.length,gaps,jumps,latestBpm:fresh?newest[1]:null,
  observedMeanBpm:mean,baselineBpm:Number.isInteger(baselineBpm)?baselineBpm:null,
  deltaBpm:deviation,clinicalThresholdApproved:false,
  note:"Signal screening only; optical motion artefacts cannot be ruled out without reference validation"};
}
