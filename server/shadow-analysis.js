// STEVE AI Shadow Analysis — deterministic foundation (research only).
//
// READ-ONLY with respect to clinical state: this module takes copies of data
// that STEVE already holds and returns a description. It never creates, closes
// or changes Medic Reviews, alerts, NORMAL/WATCH/EMERGENCY, thresholds or
// training permission, and it is not wired to any endpoint yet. It performs no
// I/O and calls no external service.
//
// It does NOT diagnose, estimate core temperature, infer HRV from BPM, or
// detect heat illness, dehydration or arrhythmia. Missing data is reported as
// missing: values are never imputed, interpolated or smoothed into "normal".
import {describeRecoveryShadow} from "./recovery-shadow.js";

export const SHADOW_VERSION="steve-shadow-0.1";
// Engineering/data-quality constants reused from existing modules
// (recovery-shadow.js / auto-hr-monitor.js / pulse-history.js). They describe
// data quality and presentation only; none is a medical threshold.
const BPM_MIN=25, BPM_MAX=240;           // existing accepted range
const FRESH_MS=15000;                    // existing LIVE freshness / TTL
const GAP_MS=45000;                      // existing recovery-shadow gap heuristic
const JUMP_BPM=45, JUMP_WINDOW_MS=15000; // existing sensor-plausibility heuristic
const BUCKET_MS=5000;                    // existing PulseHistory step
const WBGT_STALE_MS=30*60000;            // existing /api/context staleness rule
// Presentation rules for describing data (not clinical):
const MIN_SAMPLES=12, MIN_COVERAGE=0.5, MIN_TREND_SPAN_MS=3*60000, DESCRIBED_CHANGE_BPM=5;

const r1=x=>Math.round(x*10)/10;
const median=v=>{const s=v.slice().sort((a,b)=>a-b),i=Math.floor(s.length/2);return s.length%2?s[i]:(s[i-1]+s[i])/2;};
const quantile=(v,q)=>{const s=v.slice().sort((a,b)=>a-b),p=(s.length-1)*q,lo=Math.floor(p),hi=Math.ceil(p);return s[lo]+(s[hi]-s[lo])*(p-lo);};

// ---------- C1: data quality ----------
export function assessDataQuality(points,{now,from,to=now,wearerSince=null}={}){
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from>=to)
  throw Error("Invalid analysis window");
 const rejected={invalidShape:0,outOfRange:0,future:0,outsideWindow:0,previousWearer:0,duplicate:0,outOfOrder:0};
 const accepted=[];let lastSeen=-Infinity;
 for(const p of Array.isArray(points)?points:[]){
  if(!Array.isArray(p)||p.length!==2||!Number.isSafeInteger(p[0])||!Number.isInteger(p[1])){rejected.invalidShape++;continue;}
  const [t,bpm]=p;
  if(bpm<BPM_MIN||bpm>BPM_MAX){rejected.outOfRange++;continue;}
  if(t>now+1000){rejected.future++;continue;}
  if(Number.isSafeInteger(wearerSince)&&t<wearerSince){rejected.previousWearer++;continue;}
  if(t<from||t>to){rejected.outsideWindow++;continue;}
  if(t<lastSeen){rejected.outOfOrder++;continue;}       // never re-sorted into the series
  if(t===lastSeen){rejected.duplicate++;continue;}       // replayed / duplicate timestamp
  lastSeen=t;accepted.push([t,bpm]);
 }
 const windowMs=to-from;
 const buckets=new Set(accepted.map(([t])=>Math.floor(t/BUCKET_MS)));
 const coverage=Math.min(1,buckets.size*BUCKET_MS/windowMs);
 const gaps=[];
 const edges=[[from,null],...accepted,[to,null]];
 for(let i=1;i<edges.length;i++){const g=edges[i][0]-edges[i-1][0];if(g>GAP_MS)gaps.push({from:edges[i-1][0],to:edges[i][0],seconds:r1(g/1000)});}
 const jumps=[];
 for(let i=1;i<accepted.length;i++){
  const [t0,b0]=accepted[i-1],[t1,b1]=accepted[i];
  if(t1-t0<=JUMP_WINDOW_MS&&Math.abs(b1-b0)>=JUMP_BPM)jumps.push({at:t1,deltaBpm:b1-b0});
 }
 const lastAt=accepted.at(-1)?.[0]??null;
 const stale=lastAt===null||now-lastAt>FRESH_MS;
 const onlyPreviousWearer=!accepted.length&&rejected.previousWearer>0;
 const status=onlyPreviousWearer?"different_wearer":!accepted.length?"no_data":
  jumps.length?"suspicious":accepted.length<MIN_SAMPLES||coverage<MIN_COVERAGE?"insufficient":"valid";
 return {status,stale,from,to,lastAt,acceptedSamples:accepted.length,rejected,
  coveragePct:r1(coverage*100),gaps,missingSeconds:r1(gaps.reduce((a,g)=>a+g.seconds,0)),
  implausibleTransitions:jumps,series:accepted};
}

// ---------- C2: features (only where the data supports them) ----------
function theilSenPerMinute(series){
 // Robust slope; O(n^2) is fine for a 4-hour 5-second series subsample.
 const s=series.length>400?series.filter((_,i)=>i%Math.ceil(series.length/400)===0):series;
 const slopes=[];
 for(let i=0;i<s.length;i++)for(let j=i+1;j<s.length;j++){const dt=s[j][0]-s[i][0];if(dt>0)slopes.push((s[j][1]-s[i][1])/(dt/60000));}
 return slopes.length?median(slopes):null;
}
function phaseAt(transitions,t){let p=null;for(const e of transitions){if(e.at<=t)p=e.phase;else break;}return p;}
function longestRunAtOrAbove(series,limit){
 // Continuous = consecutive accepted samples with no gap over GAP_MS.
 let best=0,start=null,prev=null;
 for(const [t,b] of series){
  if(b>=limit&&start!==null&&prev!==null&&t-prev<=GAP_MS){best=Math.max(best,t-start);}
  else if(b>=limit){start=t;}
  else start=null;
  prev=t;
 }
 return best;
}
export function describeFeatures(quality,{transitions=[],confirmedBaselineBpm=null,confirmedPersonalLimitBpm=null}={}){
 const s=quality.series,limits=[];
 const phases=(Array.isArray(transitions)?transitions:[])
  .filter(e=>e&&Number.isSafeInteger(e.at)&&["training","hourly_rest","no_training"].includes(e.phase))
  .sort((a,b)=>a.at-b.at);
 const byPhase={training:[],hourly_rest:[],no_training:[],unrecorded:[]};
 for(const [t,b] of s)byPhase[phaseAt(phases,t)||"unrecorded"].push(b);
 const phaseSummary=Object.fromEntries(Object.entries(byPhase).map(([k,v])=>[k,{samples:v.length,medianBpm:v.length?r1(median(v)):null}]));
 const out={medianBpm:null,iqrBpm:null,trendBpmPerMin:null,trendDirection:null,spanMinutes:null,
  phaseAtEnd:phaseAt(phases,quality.to)||"unrecorded",phaseSummary,
  baselineDifferenceBpm:null,atOrAbovePersonalLimitMinutes:null,limitations:limits};
 if(quality.status==="no_data"||quality.status==="different_wearer"){limits.push("no_samples");return out;}
 const values=s.map(p=>p[1]);
 out.medianBpm=r1(median(values));
 out.iqrBpm=values.length>=4?r1(quantile(values,0.75)-quantile(values,0.25)):null;
 out.spanMinutes=r1((s.at(-1)[0]-s[0][0])/60000);
 if(quality.status!=="valid")limits.push("trend_not_described_quality_"+quality.status);
 else if(s.at(-1)[0]-s[0][0]<MIN_TREND_SPAN_MS)limits.push("trend_span_too_short");
 else{
  out.trendBpmPerMin=r1(theilSenPerMinute(s));
  const change=out.trendBpmPerMin*out.spanMinutes;
  out.trendDirection=Math.abs(change)<DESCRIBED_CHANGE_BPM?"flat":change>0?"rising":"falling";
 }
 // Within-session spread (IQR of BPM) is NOT heart-rate variability.
 limits.push("hrv_not_available_from_bpm");
 if(Number.isInteger(confirmedBaselineBpm)&&confirmedBaselineBpm>=BPM_MIN&&confirmedBaselineBpm<=BPM_MAX)
  out.baselineDifferenceBpm=r1(out.medianBpm-confirmedBaselineBpm);
 else limits.push("no_confirmed_baseline");
 // Uses only the clinician-configured, confirmed personal limit that already exists.
 if(Number.isInteger(confirmedPersonalLimitBpm)&&confirmedPersonalLimitBpm>=60&&confirmedPersonalLimitBpm<=220)
  out.atOrAbovePersonalLimitMinutes=r1(longestRunAtOrAbove(s,confirmedPersonalLimitBpm)/60000);
 else limits.push("no_confirmed_personal_limit");
 return out;
}

// ---------- WBGT / training context (Workstream E, validation only) ----------
// "measured" requires an instrument reading; weather estimates are never authoritative.
export function validateWbgtContext(ctx,now){
 if(!ctx||ctx.wbgtC==null)return {status:"missing",authoritative:false};
 const {wbgtC,measuredAt,source}=ctx;
 if(typeof wbgtC!=="number"||!Number.isFinite(wbgtC)||wbgtC<0||wbgtC>60||!Number.isSafeInteger(measuredAt)||measuredAt>now+1000)
  return {status:"invalid",authoritative:false};
 const kind=source==="measured_device"||source==="manual entry"?"measured":source==="weather_estimate"?"estimate":"unknown_source";
 if(kind!=="measured")return {status:kind==="estimate"?"estimated_not_authoritative":"unknown_source",authoritative:false,wbgtC,measuredAt};
 if(now-measuredAt>WBGT_STALE_MS)return {status:"stale",authoritative:false,wbgtC,measuredAt};
 return {status:"measured",authoritative:true,wbgtC,measuredAt,location:typeof ctx.location==="string"?ctx.location.slice(0,40):null};
}

// ---------- C3: explainable shadow analysis ----------
const QUALITY_TH={valid:"ข้อมูลต่อเนื่องเพียงพอสำหรับอธิบายแนวโน้ม",insufficient:"ข้อมูลไม่เพียงพอสำหรับอธิบายแนวโน้ม",
 suspicious:"พบการเปลี่ยนแปลงของค่าที่อาจมาจากสัญญาณ/การสวม ควรตรวจสายรัดก่อนใช้ข้อมูล",no_data:"ไม่มีข้อมูลชีพจรในช่วงนี้",
 different_wearer:"ข้อมูลในช่วงนี้เป็นของผู้สวมคนก่อน ไม่นำมาวิเคราะห์"};
const MISSING_TH={hrv_not_available_from_bpm:"ไม่มี HRV (BPM เฉลี่ยใช้คำนวณไม่ได้)",no_confirmed_baseline:"ยังไม่มี baseline ที่ยืนยัน",
 no_confirmed_personal_limit:"ยังไม่มีเกณฑ์ส่วนบุคคลที่ยืนยัน",trend_span_too_short:"ช่วงข้อมูลสั้นเกินอธิบายแนวโน้ม",no_samples:"ไม่มีค่าที่ใช้ได้",
 training_phase_unrecorded:"ไม่ได้บันทึกสถานะฝึก/พัก",no_fresh_sample:"ไม่มีค่าใหม่ใน 15 วินาที",wbgt_missing:"ไม่มี WBGT",wbgt_stale:"WBGT เก่ากว่า 30 นาที",
 wbgt_estimated_not_authoritative:"WBGT เป็นค่าประมาณ ไม่ใช่ค่าวัด",wbgt_unknown_source:"ไม่ทราบแหล่งที่มา WBGT",wbgt_invalid:"ค่า WBGT ไม่ถูกต้อง"};
const missingTh=code=>MISSING_TH[code]||(code.startsWith("trend_not_described_quality_")?"ไม่อธิบายแนวโน้มเพราะคุณภาพข้อมูล":code);
const PHASE_TH={training:"ระหว่างฝึก",hourly_rest:"ระหว่างพักประจำชั่วโมง",no_training:"ช่วงไม่มีการฝึก",unrecorded:"ช่วงที่ไม่ได้บันทึกสถานะการฝึก"};
export function analyzeShadow({points,now,windowMinutes=30,wearerSince=null,transitions=[],confirmedBaselineBpm=null,
 confirmedPersonalLimitBpm=null,existingReview=null,wbgt=null,source="GATEWAY"}={}){
 const from=now-Math.round(windowMinutes*60000);
 const quality=assessDataQuality(points,{now,from,to:now,wearerSince});
 const features=describeFeatures(quality,{transitions,confirmedBaselineBpm,confirmedPersonalLimitBpm});
 const recovery=describeRecoveryShadow(quality.series,transitions,now,confirmedBaselineBpm); // reuse Phase 2
 const context=validateWbgtContext(wbgt,now);
 const missing=[...features.limitations];
 if(context.status!=="measured")missing.push("wbgt_"+context.status);
 if(features.phaseAtEnd==="unrecorded")missing.push("training_phase_unrecorded");
 if(quality.stale)missing.push("no_fresh_sample");
 // Existing alert evidence is echoed for context only; it is never changed or re-scored.
 const alertContext=existingReview?{status:existingReview.status??null,openedBy:existingReview.openedBy??null,
  evidence:existingReview.evidence?{rule:existingReview.evidence.rule??null,firstAt:existingReview.evidence.firstAt??null,lastAt:existingReview.evidence.lastAt??null,sampleCount:existingReview.evidence.sampleCount??null}:null}:null;
 const sentences=[];
 if(source==="SIMULATED")sentences.push("ข้อมูลจำลอง (SIMULATED) ไม่ใช่การวัดจริง");
 sentences.push(QUALITY_TH[quality.status]+" (ครอบคลุม "+quality.coveragePct+"% ของ "+windowMinutes+" นาที, "+quality.acceptedSamples+" ค่า)");
 if(quality.stale&&quality.acceptedSamples)sentences.push("ไม่มีค่าใหม่ใน 15 วินาทีล่าสุด จึงไม่ใช่สถานะ LIVE");
 if(features.trendDirection){
  const dir={rising:"สูงขึ้นต่อเนื่อง",falling:"ลดลงต่อเนื่อง",flat:"ค่อนข้างคงที่"}[features.trendDirection];
  sentences.push("แนวโน้มชีพจร"+dir+" ("+features.trendBpmPerMin+" BPM/นาที ตลอด "+features.spanMinutes+" นาที, median "+features.medianBpm+" BPM) "+PHASE_TH[features.phaseAtEnd]);
 }else if(features.medianBpm!==null)sentences.push("median "+features.medianBpm+" BPM แต่ยังไม่อธิบายแนวโน้ม");
 if(features.atOrAbovePersonalLimitMinutes)sentences.push("อยู่ที่หรือสูงกว่าเกณฑ์ส่วนบุคคลที่เจ้าหน้าที่ตั้งไว้ต่อเนื่องนานสุด "+features.atOrAbovePersonalLimitMinutes+" นาที");
 if(features.baselineDifferenceBpm!==null)sentences.push("ต่างจาก baseline ที่ยืนยันแล้ว "+(features.baselineDifferenceBpm>0?"+":"")+features.baselineDifferenceBpm+" BPM");
 if(recovery.status==="observed")sentences.push("ช่วงพักที่บันทึก: median ช่วงแรก "+recovery.firstMedianBpm+" → ช่วงหลัง "+recovery.lateMedianBpm+" BPM");
 if(alertContext?.status==="pending")sentences.push("มีรายการรอประเมินจากระบบเดิมอยู่แล้ว");
 if(missing.length)sentences.push("ข้อมูลที่ยังขาด: "+missing.map(missingTh).join(", "));
 sentences.push("ยังไม่สามารถสรุปภาวะทางการแพทย์จากชีพจรอย่างเดียวได้ • ข้อมูลประกอบการพิจารณาของเจ้าหน้าที่เท่านั้น ไม่ใช่การวินิจฉัยหรือการอนุญาตให้ฝึก");
 const {series,...qualitySummary}=quality; // raw series is not part of the output
 return Object.freeze({version:SHADOW_VERSION,mode:"shadow_research_only",clinicalEffect:"none",evidenceClass:source==="SIMULATED"?"SIMULATED":"OBSERVED",
  window:{from,to:now,minutes:windowMinutes},quality:qualitySummary,features,recovery,context,alertContext,missingInformation:missing,
  explanationTh:sentences.join(" • ")});
}
