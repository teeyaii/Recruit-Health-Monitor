// Phase 2 shadow research: sample-only comparison of an explicitly recorded
// training -> hourly_rest transition. Not a clinical alert, diagnosis,
// validated recovery test, or clearance to resume training.
// Only called by the authenticated trainer/medic review endpoint.
// Never fills missing samples or invents a personal baseline.
const REST_MS=4*60000;
const SHADOW_MAX_AGE_MS=30*60000;
const GAP_MS=45000; // Research data-quality heuristic, not a medical threshold.
const JUMP_BPM=45; // Sensor-quality heuristic, not a medical threshold.
const ok=(p,now)=>Array.isArray(p)&&p.length===2&&
 Number.isSafeInteger(p[0])&&p[0]<=now&&Number.isInteger(p[1])&&p[1]>=25&&p[1]<=240;
const median=values=>{
 const v=values.slice().sort((a,b)=>a-b),i=Math.floor(v.length/2);
 return v.length%2?v[i]:(v[i-1]+v[i])/2;
};
export function describeRecoveryShadow(points,transitions,now=Date.now(),confirmedBaseline=null){
 const empty={mode:"shadow_research_only",status:"not_applicable",phaseScope:"cohort",
  startAt:null,lastObservedAt:null,firstWindowSamples:0,lateWindowSamples:0,
  firstMedianBpm:null,lateMedianBpm:null,changeBpm:null,
  baselineDifferenceBpm:null,clinicalAlert:false,
  note:"สถิติเชิงพรรณนาเท่านั้น ไม่ใช่เกณฑ์ทางการแพทย์หรือการอนุญาตให้ฝึก"};
 if(!Number.isSafeInteger(now))return empty;
 const events=(Array.isArray(transitions)?transitions:[])
  .filter(e=>e&&Number.isSafeInteger(e.at)&&e.at<=now&&
   ["training","hourly_rest","no_training"].includes(e.phase))
  .sort((a,b)=>a.at-b.at);
 const last=events.at(-1),previous=events.at(-2);
 if(!last||last.phase!=="hourly_rest"||previous?.phase!=="training")return empty;
 const start=last.at,result={...empty,startAt:start};
 if(start<now-SHADOW_MAX_AGE_MS)return {...result,status:"window_expired"};
 if(now<start+REST_MS)return {...result,status:"collecting"};
 const measurements=(Array.isArray(points)?points:[]).filter(p=>
  ok(p,now)&&p[0]>=start&&p[0]<=start+REST_MS).sort((a,b)=>a[0]-b[0]);
 const unique=[];
 for(const p of measurements)if(!unique.length||unique.at(-1)[0]!==p[0])unique.push(p);
 const first=unique.filter(p=>p[0]<start+2*60000);
 const late=unique.filter(p=>p[0]>=start+2*60000);
 const counts={...result,firstWindowSamples:first.length,lateWindowSamples:late.length,
  lastObservedAt:unique.at(-1)?.[0]??null};
 // Engineering availability gates; no inference about what the wearer
 // physically did during the cohort-wide rest phase.
 if(first.length<3||late.length<3||first.at(-1)[0]-first[0][0]<30000||
    late.at(-1)[0]-late[0][0]<30000||
    first[0][0]>start+90000||late.at(-1)[0]<start+210000)
  return {...counts,status:"insufficient"};
 for(let i=1;i<unique.length;i++){
  const gap=unique[i][0]-unique[i-1][0];
  if(gap>GAP_MS||(gap<=15000&&Math.abs(unique[i][1]-unique[i-1][1])>=JUMP_BPM))
   return {...counts,status:"check_signal"};
 }
 const early=Math.round(median(first.map(p=>p[1]))*10)/10;
 const later=Math.round(median(late.map(p=>p[1]))*10)/10;
 const baseline=Number.isInteger(confirmedBaseline)&&confirmedBaseline>=25&&confirmedBaseline<=240?
  confirmedBaseline:null;
 return {...counts,status:"observed",firstMedianBpm:early,lateMedianBpm:later,
  changeBpm:Math.round((later-early)*10)/10,
  baselineDifferenceBpm:baseline===null?null:Math.round((later-baseline)*10)/10};
}
