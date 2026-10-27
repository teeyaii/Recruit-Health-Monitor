import {slotIDs} from "./roster.js";
const valid=new Set(slotIDs);
const blank=(slot,code)=>({slot,code,weightKg:null,heightCm:null,ageYears:null,medications:"",restingBaselineBpm:null,baselineConfirmed:false,conditions:"",version:0,updatedAt:null});
const reject=(status,message)=>{const e=new Error(message);e.status=status;throw e;};
export function bmi(weightKg,heightCm){
 if(!Number.isFinite(weightKg)||!Number.isFinite(heightCm)||heightCm<=0)return null;
 return Math.round((weightKg/((heightCm/100)**2))*10)/10;
}
const withBmi=p=>({ageYears:null,medications:"",restingBaselineBpm:null,baselineConfirmed:false,...p,bmi:bmi(p.weightKg,p.heightCm)});
export class PrivateProfiles {
 constructor(){this.records={};}
 export(){return structuredClone(this.records);}
 load(data){
  if(!data||typeof data!=="object"||Array.isArray(data))throw Error("Invalid clinical store");
  for(const [slot,p] of Object.entries(data)){
   if(!valid.has(slot)||p.slot!==slot||typeof p.code!=="string"||
      !Number.isSafeInteger(p.version)||p.version<0||
      (p.weightKg!==null&&(!Number.isFinite(p.weightKg)||p.weightKg<20||p.weightKg>300))||
      (p.heightCm!==null&&(!Number.isFinite(p.heightCm)||p.heightCm<80||p.heightCm>230))||
      typeof p.conditions!=="string"||p.conditions.length>300||
      (p.ageYears!==undefined&&p.ageYears!==null&&(!Number.isInteger(p.ageYears)||p.ageYears<16||p.ageYears>85))||
      (p.medications!==undefined&&(typeof p.medications!=="string"||p.medications.length>240))||
      (p.restingBaselineBpm!==undefined&&p.restingBaselineBpm!==null&&(!Number.isInteger(p.restingBaselineBpm)||p.restingBaselineBpm<25||p.restingBaselineBpm>240))||
      (p.baselineConfirmed!==undefined&&typeof p.baselineConfirmed!=="boolean"))throw Error("Invalid private clinical profile");
  }
  this.records=structuredClone(data);
 }
 get(slot,code){
  if(!valid.has(slot)||!code)reject(404,"slot not registered");
  const existing=this.records[slot];
  return withBmi(existing?.code.toUpperCase()===code.toUpperCase()?structuredClone(existing):blank(slot,code));
 }
 clear(slot){delete this.records[slot];}
 update(slot,code,input){
  const p=this.get(slot,code);
  if(input?.version!==p.version)reject(409,"Profile changed; reload before saving");
  if(input?.confirmed!==true)reject(422,"Operator confirmation is required");
  const weightKg=input.weightKg===null||input.weightKg===""?null:Number(input.weightKg);
  const heightCm=input.heightCm===null||input.heightCm===""?null:Number(input.heightCm);
  const conditions=input.conditions;
  const ageYears=input.ageYears===undefined?p.ageYears:input.ageYears===null||input.ageYears===""?null:Number(input.ageYears);
  const medications=input.medications===undefined?p.medications:input.medications;
  const restingBaselineBpm=input.restingBaselineBpm===undefined?p.restingBaselineBpm:input.restingBaselineBpm===null||input.restingBaselineBpm===""?null:Number(input.restingBaselineBpm);
  const baselineConfirmed=input.baselineConfirmed===undefined?p.baselineConfirmed:input.baselineConfirmed;
  if(weightKg!==null&&(!Number.isFinite(weightKg)||weightKg<20||weightKg>300))reject(422,"Weight must be between 20 and 300 kg");
  if(heightCm!==null&&(!Number.isFinite(heightCm)||heightCm<80||heightCm>230))reject(422,"Height must be between 80 and 230 cm");
  if(typeof conditions!=="string"||conditions.length>300||/[<>\u0000-\u001f]/.test(conditions))
   reject(422,"Invalid condition notes (max 300 characters)");
  if(ageYears!==null&&(!Number.isInteger(ageYears)||ageYears<16||ageYears>85))
   reject(422,"Age must be between 16 and 85 years");
  if(typeof medications!=="string"||medications.length>240||/[<>\u0000-\u001f]/.test(medications))
   reject(422,"Invalid medication notes");
  if(restingBaselineBpm!==null&&(!Number.isInteger(restingBaselineBpm)||restingBaselineBpm<25||restingBaselineBpm>240))
   reject(422,"Invalid individually measured resting baseline");
  if(typeof baselineConfirmed!=="boolean"||(restingBaselineBpm!==null&&!baselineConfirmed))
   reject(422,"Resting baseline requires operator verification");
  const next={slot,code,weightKg,heightCm,ageYears,medications:medications.trim(),
    restingBaselineBpm,baselineConfirmed:restingBaselineBpm!==null&&baselineConfirmed,
    conditions:conditions.trim(),version:p.version+1,updatedAt:Date.now()};
  this.records[slot]=next;return withBmi(structuredClone(next));
 }
}
