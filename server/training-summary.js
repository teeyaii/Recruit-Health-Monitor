// Descriptive sample-only 4-hour summary, not a medical assessment.
// Never impute missing HR, phase, safety thresholds or exercise readiness.
export function trainingSummary(points,events,since,now){
 if(!Number.isFinite(since)||!Number.isFinite(now)||now<=since)throw Error("Invalid summary interval");
 const phases=(events||[]).filter(e=>e&&["training","hourly_rest","no_training"].includes(e.phase)&&Number.isFinite(e.at)&&e.at<=now)
  .sort((a,b)=>a.at-b.at);
 const buckets={training:[],hourly_rest:[],no_training:[]};
 const all=(points||[]).filter(p=>Array.isArray(p)&&Number.isSafeInteger(p[0])&&
  p[0]>=since&&p[0]<=now&&Number.isInteger(p[1])&&p[1]>=25&&p[1]<=240);
 let k=0,current=null;
 for(const [ts,hr] of all){
  while(k<phases.length&&phases[k].at<=ts){current=phases[k].phase;k++;}
  if(current)buckets[current].push(hr);
 }
 const pack=v=>{
  if(!v.length)return {samples:0,min:null,mean:null,max:null,observedSecondsApprox:0};
  const avg=v.reduce((a,b)=>a+b,0)/v.length;
  return {samples:v.length,min:Math.min(...v),mean:Math.round(avg*10)/10,max:Math.max(...v),
   observedSecondsApprox:v.length*5};
 };
 return {from:since,to:now,actualSamples:all.length,unclassifiedSamples:all.length-buckets.training.length-buckets.hourly_rest.length-buckets.no_training.length,
  training:pack(buckets.training),hourly_rest:pack(buckets.hourly_rest),no_training:pack(buckets.no_training),
  note:"Sample statistics only. 5-second observation is approximate, not full training duration or medical clearance."};
}
