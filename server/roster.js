import {readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync} from "node:fs";
import path from "node:path";
import {randomBytes} from "node:crypto";

// Operational and pseudonymous metadata ONLY. Never store names, diagnoses,
// service numbers or other detailed health records in this MVP store.
export const slotIDs=Array.from({length:15},(_,i)=>"R"+String(i+1).padStart(2,"0"));
const slotSet=new Set(slotIDs);
const observations=new Set(["none","dizzy_weak_nausea","confusion_collapse_seizure"]);
const restrictions=new Set(["none","watch","no_training"]);
const activities=new Set(["not_reported","training","resting","assessment"]); // Legacy per-person field is read-only in the current operator UI.
const groupPhases=new Set(["not_started","training","hourly_rest"]);
// Preserve the recruit's chosen letter case. Compare case-insensitively only
// when verifying slot identity and duplicate assignments.
const shortCode=/^[A-Za-z0-9][A-Za-z0-9_-]{3,23}$/;
const sameCode=(a,b)=>typeof a==="string"&&typeof b==="string"&&a.toUpperCase()===b.toUpperCase();
function problem(status,message){const err=new Error(message);err.status=status;throw err;}
function blank(id){return {id,code:null,restriction:"none",observation:"none",activity:"not_reported",acknowledged:false,paused:false,version:0,updatedAt:null};}
function verifyShape(d){
 if(!d || typeof d!=="object" || Array.isArray(d))throw Error("Invalid persisted STEVE roster file");
 if(d.schema!==1||!d.slots||!Array.isArray(d.audit))throw Error("Unsupported STEVE roster file format");
 if(d.groupPhase!==undefined && (typeof d.groupPhase!=="object"||!d.groupPhase||
   !groupPhases.has(d.groupPhase.phase)||!Number.isSafeInteger(d.groupPhase.version)||d.groupPhase.version<0||
   (d.groupPhase.changedAt!==null && (!Number.isSafeInteger(d.groupPhase.changedAt)||d.groupPhase.changedAt<0))))throw Error("Invalid STEVE group phase");
 for(const id of slotIDs){
  const p=d.slots[id];
  if(!p||p.id!==id||!Number.isSafeInteger(p.version)||p.version<0||
      (p.code!==null&&typeof p.code!=="string")||
      !restrictions.has(p.restriction)||!observations.has(p.observation)||
      (p.activity!==undefined&&!activities.has(p.activity))||
      typeof p.acknowledged!=="boolean"||typeof p.paused!=="boolean")throw Error("Invalid STEVE roster slot "+id);
 }
}
function validateVersion(input,p){
 if(!Number.isSafeInteger(input?.version)||input.version!==p.version)problem(409,"stale version; reload roster");
}
function validateCode(value){
 if(typeof value!=="string"||!shortCode.test(value)||/^STEVE_/i.test(value))
  problem(422,"use an anonymous 4–24 character code: A–Z, a–z, digits, underscore or hyphen");
 return value;
}
export class RosterStore {
 constructor(filename=""){
  this.filename=filename;
  this.data={schema:1,slots:Object.fromEntries(slotIDs.map(id=>[id,blank(id)])),audit:[]};
  if(filename){
   try{
    const loaded=JSON.parse(readFileSync(filename,"utf8"));
    verifyShape(loaded);
    this.data=loaded;
   }catch(e){if(e.code!=="ENOENT")throw e;}
  }
 }
 all(){return slotIDs.map(id=>this.get(id));}
 get(id){if(!slotSet.has(id))problem(404,"unknown slot");return {activity:"not_reported",...this.data.slots[id]};}
 getAudit(){return this.data.audit.slice(-100).map(item=>({...item}));}
 // One operational training/rest phase applies to the whole supervised cohort.
 // It never overwrites a member's medical restriction, WATCH or EMERGENCY.
 getGroupPhase(){return {...{phase:"not_started",version:0,changedAt:null,changedBy:null},...(this.data.groupPhase||{})};}
 setGroupPhase(input,actor){
  const old=this.getGroupPhase();
  if(!Number.isSafeInteger(input?.version)||input.version!==old.version)problem(409,"stale group phase; refresh before changing");
  if(!groupPhases.has(input?.phase)||input.phase==="not_started")problem(422,"select training or hourly_rest");
  if(old.phase===input.phase)return old;
  const saved=this.data.groupPhase,history=this.data.audit.slice();
  const now=Date.now();
  this.data.groupPhase={phase:input.phase,version:old.version+1,changedAt:now,changedBy:actor};
  this.data.audit.push({id:"GROUP",action:"phase_"+input.phase,actor,at:now,version:old.version+1});
  if(this.data.audit.length>250)this.data.audit.splice(0,this.data.audit.length-250);
  try{this.persist();}catch(e){if(saved===undefined)delete this.data.groupPhase;else this.data.groupPhase=saved;this.data.audit=history;throw e;}
  return this.getGroupPhase();
 }
 canIngest(id){return slotSet.has(id)&&!this.data.slots[id].paused;}
 persist(){
  if(!this.filename)return;
  const file=path.resolve(this.filename),dir=path.dirname(file);
  mkdirSync(dir,{recursive:true,mode:0o700});
  const tmp=file+"."+randomBytes(8).toString("hex")+".tmp";
  try{
   writeFileSync(tmp,JSON.stringify(this.data),{encoding:"utf8",mode:0o600,flag:"wx"});
   renameSync(tmp,file);
  }catch(e){try{unlinkSync(tmp);}catch{};throw e;}
 }
 commit(id,old,next,actor,action){
  this.data.slots[id]={...next,version:old.version+1,updatedAt:Date.now()};
  this.data.audit.push({id,action,actor,at:Date.now(),version:old.version+1});
  if(this.data.audit.length>250)this.data.audit.splice(0,this.data.audit.length-250);
  try{this.persist();}catch(e){
   this.data.slots[id]=old;this.data.audit.pop();
   throw e;
  }
  return this.get(id);
 }
 update(id,input,actor){
  const p=this.get(id);validateVersion(input,p);
  const code=validateCode(input?.code);
  const reassigned=p.code!==null&&!sameCode(p.code,code);
  // Changing the wearer in a single Save clears old observations and BPM at
  // the API layer. Never allow a code edit to silently dismiss an emergency.
  if(reassigned&&p.observation==="confusion_collapse_seizure")
   problem(409,"active EMERGENCY: resolve and document the event before reassigning a wearer");
  if(slotIDs.some(other=>other!==id&&sameCode(this.data.slots[other].code,code)))
   problem(409,"anonymous code already active on another slot");
  if(!restrictions.has(input?.restriction)||!observations.has(input?.observation)||!activities.has(input?.activity??p.activity))problem(422,"invalid restriction, observation or activity");
  const observation=reassigned?"none":input.observation;
  const next={...p,code,paused:false,
    restriction:reassigned?"none":input.restriction,observation,
    activity:reassigned?"not_reported":input.activity??p.activity,
    acknowledged:reassigned?false:observation===p.observation?p.acknowledged:false};
  return this.commit(id,p,next,actor,reassigned?"reassign_via_save":p.paused?"resume_via_save":"update");
 }
 replace(id,input,actor){
  const p=this.get(id);validateVersion(input,p);
  const code=validateCode(input?.code);
  if(sameCode(code,p.code))problem(422,"replacement requires a different anonymous code");
  if(slotIDs.some(other=>other!==id&&sameCode(this.data.slots[other].code,code)))
   problem(409,"anonymous code already active on another slot");
  // PAUSED rejects all new BLE readings until a human verifies the physical reassignment.
  const next={...p,code,paused:true,restriction:"none",observation:"none",activity:"not_reported",acknowledged:false};
  return this.commit(id,p,next,actor,"replace_paused");
 }
 resume(id,input,actor){
  const p=this.get(id);validateVersion(input,p);
  if(!p.paused||!p.code)problem(409,"slot is not paused or has no occupant");
  if(input?.confirmed!==true)problem(422,"physical band reassignment confirmation required");
  return this.commit(id,p,{...p,paused:false},""+actor,"resume_confirmed");
 }
 acknowledge(id,input,actor){
  const p=this.get(id);validateVersion(input,p);
  if(p.observation==="none")problem(409,"nothing to acknowledge");
  return this.commit(id,p,{...p,acknowledged:true},actor,"acknowledge");
 }
}
