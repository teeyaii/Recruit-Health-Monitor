// STEVE automatic precautionary pause-and-check advisory.
// Requires an explicit, clinician-verified, wearer-specific monitoring limit.
// This is NOT a medical diagnosis, heat-stroke detector or medical clearance.
export class AutoHRMonitor {
 constructor(){this.records=new Map();}
 reset(slot){this.records.delete(slot);}
 status(slot){return this.records.get(slot)||null;}
 ingest(slot,code,bpm,at,limit,{training=false,real=true}={}){
  const valid=real&&training&&Number.isInteger(bpm)&&bpm>=25&&bpm<=240&&
   Number.isInteger(limit)&&limit>=60&&limit<=220&&Number.isSafeInteger(at);
  let old=this.records.get(slot);
  if(!valid){this.reset(slot);return {trigger:false,reason:"not_configured_or_training"};}
  if(!old||old.code!==code||old.limitBpm!==limit||at<=old.lastAt||at-old.lastAt>15000)
   old={code,limitBpm:limit,lastAt:at,samples:[],latched:false,belowSince:null};
  const prior=old.samples.at(-1);
  const plausible=!(prior&&at-prior.at<=15000&&Math.abs(bpm-prior.bpm)>=45);
  old.lastAt=at;
  if(!plausible){old.samples=[];old.belowSince=null;this.records.set(slot,old);
   return {trigger:false,reason:"check_sensor",limitBpm:limit};}
  if(bpm<limit){
   old.samples=[];
   if(old.belowSince===null)old.belowSince=at;
   if(at-old.belowSince>=60000)old.latched=false;
   this.records.set(slot,old);
   return {trigger:false,reason:"below_limit",limitBpm:limit};
  }
  old.belowSince=null;
  old.samples.push({at,bpm});
  old.samples=old.samples.filter(p=>p.at>=at-60000);
  this.records.set(slot,old);
  const sustained=old.samples.length>=5&&at-old.samples[0].at>=30000;
  if(!sustained||old.latched)return {trigger:false,reason:old.latched?"already_alerted":"confirming",limitBpm:limit};
  old.latched=true;
  return {trigger:true,reason:"sustained_personal_limit",at,limitBpm:limit,latestBpm:bpm,
   advice:"พักกิจกรรมและตรวจผู้สวมทันที • ยืนยันชีพจร/อาการและตรวจสายรัดก่อนประเมิน"};
 }
}
