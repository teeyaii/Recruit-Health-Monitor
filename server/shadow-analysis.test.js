// STEVE AI Shadow foundation tests. All inputs are SYNTHETIC fixtures; they are
// not recruit data and not evidence of clinical validity.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assessDataQuality,describeFeatures,validateWbgtContext,analyzeShadow,SHADOW_VERSION} from './shadow-analysis.js';
import {AutoHRMonitor} from './auto-hr-monitor.js';
import {MedicReviews} from './medic-review.js';

const NOW=1_794_000_000_000, MIN=60000;
const series=(fromMs,toMs,stepMs,bpmAt)=>{const p=[];for(let t=fromMs;t<=toMs;t+=stepMs)p.push([t,bpmAt(t)]);return p;};
const steady=(minutes,bpm=80,step=5000)=>series(NOW-minutes*MIN,NOW-1000,step,()=>bpm);
const FORBIDDEN=/\b(NORMAL|WATCH|EMERGENCY)\b|heat ?stroke|ลมแดด|ขาดน้ำ|dehydrat|arrhythm|หัวใจเต้นผิดจังหวะ|อุณหภูมิแกนกลาง|core temperature|ปลอดภัย(?!\s*ไม่)|อนุญาตให้กลับ/i;

test('quality: duplicates, out-of-order, out-of-range, future and outside-window samples are counted, never re-inserted',()=>{
 const p=[[NOW-60000,80],[NOW-55000,81],[NOW-55000,81],[NOW-58000,79],[NOW-50000,300],[NOW-45000,'x'],[NOW+5000,82],[NOW-40*MIN,70],[NOW-50000,82]];
 const q=assessDataQuality(p,{now:NOW,from:NOW-30*MIN});
 assert.deepEqual(q.rejected,{invalidShape:1,outOfRange:1,future:1,outsideWindow:1,previousWearer:0,duplicate:1,outOfOrder:1});
 assert.deepEqual(q.series,[[NOW-60000,80],[NOW-55000,81],[NOW-50000,82]]);
 assert.equal(q.acceptedSamples,3,'no imputed values');
 assert.equal(q.status,'insufficient');
});
test('quality: gaps and coverage are measured; missing time is reported, not filled',()=>{
 const p=[...series(NOW-30*MIN,NOW-20*MIN,5000,()=>90),...series(NOW-10*MIN,NOW-1000,5000,()=>92)];
 const q=assessDataQuality(p,{now:NOW,from:NOW-30*MIN});
 assert.equal(q.gaps.length,1);assert.ok(q.gaps[0].seconds>=595&&q.gaps[0].seconds<=601);
 assert.ok(q.coveragePct>60&&q.coveragePct<70,'coverage '+q.coveragePct);
 assert.equal(q.series.length,p.length);
 assert.equal(q.status,'valid');assert.equal(q.stale,false);
});
test('quality: stale data is flagged; previous-wearer samples are excluded at the wearer boundary',()=>{
 const old=steady(30).map(([t,b])=>[t-60000,b]);
 assert.equal(assessDataQuality(old,{now:NOW,from:NOW-30*MIN}).stale,true);
 const boundary=NOW-10*MIN;
 const mixed=[...series(NOW-30*MIN,boundary,5000,()=>150),...series(boundary+5000,NOW-1000,5000,()=>72)];
 const q=assessDataQuality(mixed,{now:NOW,from:NOW-30*MIN,wearerSince:boundary});
 assert.ok(q.rejected.previousWearer>200);assert.ok(q.series.every(([t,b])=>t>boundary&&b===72));
 const onlyOld=assessDataQuality(series(NOW-30*MIN,boundary-5000,5000,()=>150),{now:NOW,from:NOW-30*MIN,wearerSince:boundary});
 assert.equal(onlyOld.status,'different_wearer');
 const a=analyzeShadow({points:mixed,now:NOW,wearerSince:boundary});
 assert.equal(a.features.medianBpm,72,'old wearer BPM never contributes');
});
test('quality: implausible transitions mark data suspicious and suppress the trend description',()=>{
 const p=steady(30,80).map(([t,b],i)=>i===200?[t,140]:[t,b]);
 const a=analyzeShadow({points:p,now:NOW});
 assert.equal(a.quality.status,'suspicious');assert.equal(a.quality.implausibleTransitions.length,2);
 assert.equal(a.features.trendDirection,null);assert.match(a.explanationTh,/ตรวจสายรัด/);
});
test('sparse or missing data: insufficient / no_data, never described as stable or normal',()=>{
 const sparse=analyzeShadow({points:[[NOW-20*MIN,80],[NOW-10*MIN,82],[NOW-2000,81]],now:NOW});
 assert.equal(sparse.quality.status,'insufficient');assert.equal(sparse.features.trendDirection,null);
 assert.match(sparse.explanationTh,/ข้อมูลไม่เพียงพอ/);assert.doesNotMatch(sparse.explanationTh,/คงที่|ปกติ/);
 const none=analyzeShadow({points:[],now:NOW});
 assert.equal(none.quality.status,'no_data');assert.equal(none.features.medianBpm,null);
 assert.match(none.explanationTh,/ไม่มีข้อมูลชีพจร/);assert.doesNotMatch(none.explanationTh,/ปกติ/);
});
test('trend: rising during recorded training, personal-limit duration uses only the confirmed existing limit',()=>{
 const start=NOW-30*MIN;
 const p=series(start,NOW-1000,5000,t=>Math.round(110+(t-start)/MIN*1.5));
 const transitions=[{at:start-MIN,phase:'training'}];
 const a=analyzeShadow({points:p,now:NOW,transitions,confirmedPersonalLimitBpm:140});
 assert.equal(a.features.trendDirection,'rising');assert.ok(a.features.trendBpmPerMin>1.3&&a.features.trendBpmPerMin<1.7);
 assert.equal(a.features.phaseAtEnd,'training');
 assert.ok(a.features.atOrAbovePersonalLimitMinutes>8&&a.features.atOrAbovePersonalLimitMinutes<11);
 assert.match(a.explanationTh,/แนวโน้มชีพจรสูงขึ้นต่อเนื่อง.*ระหว่างฝึก/);
 assert.match(a.explanationTh,/ยังไม่สามารถสรุปภาวะทางการแพทย์จากชีพจรอย่างเดียวได้/);
 const noLimit=analyzeShadow({points:p,now:NOW,transitions});
 assert.equal(noLimit.features.atOrAbovePersonalLimitMinutes,null);
 assert.ok(noLimit.missingInformation.includes('no_confirmed_personal_limit'),'no limit invented');
});
test('training / rest / no-training boundaries split samples by recorded phase; unrecorded stays unrecorded',()=>{
 const start=NOW-30*MIN,p=steady(30,90);
 const transitions=[{at:start+10*MIN,phase:'training'},{at:start+20*MIN,phase:'hourly_rest'},{at:start+25*MIN,phase:'no_training'}];
 const f=analyzeShadow({points:p,now:NOW,transitions}).features.phaseSummary;
 assert.equal(f.unrecorded.samples,120);assert.equal(f.training.samples,120);assert.equal(f.hourly_rest.samples,60);
 assert.equal(f.no_training.samples,p.length-300);
});
test('recovery reuses Phase 2 shadow: incomplete rest interval is collecting/insufficient, never invented',()=>{
 const restAt=NOW-3*MIN,transitions=[{at:NOW-30*MIN,phase:'training'},{at:restAt,phase:'hourly_rest'}];
 assert.equal(analyzeShadow({points:steady(30,120),now:NOW,transitions}).recovery.status,'collecting');
 const restAt2=NOW-5*MIN,t2=[{at:NOW-30*MIN,phase:'training'},{at:restAt2,phase:'hourly_rest'}];
 const sparseRest=steady(30,120).filter(([t])=>t<restAt2+60000);
 assert.equal(analyzeShadow({points:sparseRest,now:NOW,transitions:t2}).recovery.status,'insufficient');
 const full=series(NOW-30*MIN,NOW-1000,5000,t=>t<restAt2?140:Math.round(140-(t-restAt2)/MIN*6));
 const r=analyzeShadow({points:full,now:NOW,transitions:t2}).recovery;
 assert.equal(r.status,'observed');assert.ok(r.lateMedianBpm<r.firstMedianBpm);assert.equal(r.clinicalAlert,false);
});
test('safety: pure, deterministic, no input mutation, no clinical effect, no risk class or diagnosis wording',()=>{
 const start=NOW-30*MIN,p=series(start,NOW-1000,5000,t=>Math.round(110+(t-start)/MIN));
 const transitions=[{at:start,phase:'training'}],review={status:'pending',openedBy:'system',version:3,
  autoEvidence:{rule:'sustained_personal_limit',firstAt:NOW-60000,lastAt:NOW-25000,sampleCount:6,latestBpm:150}};
 const input={points:p,now:NOW,transitions,confirmedPersonalLimitBpm:130,existingReview:review,confirmedBaselineBpm:70};
 const snapshot=JSON.stringify(input);
 const a=analyzeShadow(input),b=analyzeShadow(input);
 assert.equal(JSON.stringify(input),snapshot,'inputs not mutated');
 assert.deepEqual(a,b,'deterministic');assert.ok(Object.isFrozen(a));
 assert.equal(a.clinicalEffect,'none');assert.equal(a.mode,'shadow_research_only');assert.equal(a.version,SHADOW_VERSION);
 const text=JSON.stringify(a);
 assert.doesNotMatch(text,FORBIDDEN);assert.doesNotMatch(a.explanationTh,FORBIDDEN);
 assert.equal(review.status,'pending','existing review untouched');
});
test('safety: shadow analysis never changes existing automatic alert decisions',()=>{
 const run=withShadow=>{
  const m=new AutoHRMonitor(),decisions=[],pts=[];
  for(let i=0;i<20;i++){
   const at=NOW-20*7000+i*7000,bpm=i<12?160:120;pts.push([at,bpm]);
   decisions.push(m.ingest('R06','SYN006',bpm,at,150,{training:true,real:true}));
   if(withShadow)analyzeShadow({points:pts,now:at,confirmedPersonalLimitBpm:150,transitions:[{at:NOW-MIN*60,phase:'training'}]});
  }
  return JSON.stringify(decisions);
 };
 assert.equal(run(true),run(false));
});
test('privacy: review notes, reasons, wearer codes and profile fields are never echoed; synthetic data is labelled',()=>{
 const review={status:'pending',openedBy:'medic',note:'PRIVATE NOTE xyz',reason:'other',code:'SYN-SECRET-CODE',profile:{medications:'drugX'},
  autoEvidence:{rule:'sustained_personal_limit',firstAt:1000,lastAt:41000,sampleCount:6,latestBpm:150,extra:'leak'}};
 const a=analyzeShadow({points:steady(30),now:NOW,existingReview:review,source:'SIMULATED'});
 const text=JSON.stringify(a);
 for(const leak of ['PRIVATE NOTE','SYN-SECRET-CODE','drugX','leak','medications'])assert.ok(!text.includes(leak),leak);
 assert.equal(a.evidenceClass,'SIMULATED');assert.match(a.explanationTh,/^ข้อมูลจำลอง \(SIMULATED\)/);
 assert.equal(analyzeShadow({points:steady(30),now:NOW}).evidenceClass,'OBSERVED');
 assert.equal('series' in a.quality,false,'raw samples are not part of the output');
});
test('WBGT context: only a fresh instrument/manual reading is authoritative; weather estimates never are',()=>{
 assert.deepEqual(validateWbgtContext(null,NOW),{status:'missing',authoritative:false});
 assert.equal(validateWbgtContext({wbgtC:29.5,measuredAt:NOW-60000,source:'measured_device',location:'Field A'},NOW).status,'measured');
 assert.equal(validateWbgtContext({wbgtC:29.5,measuredAt:NOW-60000,source:'manual entry'},NOW).authoritative,true);
 const est=validateWbgtContext({wbgtC:31,measuredAt:NOW-60000,source:'weather_estimate'},NOW);
 assert.equal(est.status,'estimated_not_authoritative');assert.equal(est.authoritative,false);
 assert.equal(validateWbgtContext({wbgtC:29,measuredAt:NOW-31*MIN,source:'measured_device'},NOW).status,'stale');
 assert.equal(validateWbgtContext({wbgtC:75,measuredAt:NOW,source:'measured_device'},NOW).status,'invalid');
 assert.equal(validateWbgtContext({wbgtC:28,measuredAt:NOW,source:'phone'},NOW).status,'unknown_source');
 const a=analyzeShadow({points:steady(30),now:NOW,wbgt:{wbgtC:31,measuredAt:NOW,source:'weather_estimate'}});
 assert.ok(a.missingInformation.includes('wbgt_estimated_not_authoritative'));
});
test('isolation: module performs no I/O, has no external calls and is not wired into the server',async()=>{
 const src=await readFile(new URL('./shadow-analysis.js',import.meta.url),'utf8');
 assert.doesNotMatch(src,/\bfetch\(|require\(|process\.env|https?:\/\/|writeFile|createServer|medicReviews|autoRequest/);
 assert.deepEqual([...src.matchAll(/^import .* from "(.*)";$/gm)].map(m=>m[1]),['./recovery-shadow.js','./medic-review.js'],'pure local helpers only');
 const index=await readFile(new URL('./index.js',import.meta.url),'utf8');
 assert.doesNotMatch(index,/shadow-analysis/,'not connected to any endpoint or alert path');
});

// ---- Review #81 (Codex) regressions ----
test('review P2: wearer boundary is strictly after the cutoff, matching ingestion (exact cutoff rejected, +1 accepted)',()=>{
 const cutoff=NOW-10*MIN,opts={now:cutoff+1000,from:cutoff-30*MIN,wearerSince:cutoff};
 const atCutoff=assessDataQuality([[cutoff,180]],opts);
 assert.equal(atCutoff.acceptedSamples,0);assert.equal(atCutoff.rejected.previousWearer,1);assert.equal(atCutoff.status,'different_wearer');
 const after=assessDataQuality([[cutoff+1,72]],opts);
 assert.equal(after.acceptedSamples,1);assert.equal(after.rejected.previousWearer,0);
});
test('review P2: training rise then rest fall is described for the current rest segment, never "rising during rest"',()=>{
 const start=NOW-30*MIN,restAt=start+25*MIN;
 const p=series(start,NOW-1000,5000,t=>t<restAt?Math.round(80+(t-start)/(25*MIN)*60):Math.round(140-(t-restAt)/(5*MIN)*30));
 const transitions=[{at:start-MIN,phase:'training'},{at:restAt,phase:'hourly_rest'}];
 const a=analyzeShadow({points:p,now:NOW,transitions});
 assert.equal(a.features.trendScope.phase,'hourly_rest');assert.equal(a.features.trendScope.wholeWindow,false);
 assert.equal(a.features.trendDirection,'falling');
 assert.doesNotMatch(a.explanationTh,/สูงขึ้นต่อเนื่อง[^•]*ระหว่างพัก/);
 assert.match(a.explanationTh,/แนวโน้มชีพจรลดลงต่อเนื่อง[^•]*ระหว่างพักประจำชั่วโมง \(นับเฉพาะช่วงปัจจุบัน\)/);
 // Just entered rest: too short to describe the current segment, so no trend at all.
 const early=analyzeShadow({points:p.filter(([t])=>t<restAt+MIN),now:restAt+MIN,transitions});
 assert.equal(early.features.trendDirection,null);
 assert.ok(early.missingInformation.includes('trend_current_phase_too_short'));
 assert.match(early.explanationTh,/ช่วงกิจกรรมปัจจุบันยังสั้นเกินอธิบายแนวโน้ม/);
});
test('review P2: evidence comes from a real MedicReviews system record (autoEvidence); invented fields ignored',()=>{
 const reviews=new MedicReviews(),now=NOW-5*MIN;
 const ev={rule:'sustained_personal_limit',firstAt:now-35000,lastAt:now,sampleCount:6,latestBpm:162};
 const created=reviews.autoRequest('R06','SYN006','high_sustained',now,ev);
 assert.equal(created.created,true);
 const record=reviews.get('R06','SYN006');assert.ok(record.autoEvidence);assert.equal('evidence' in record,false);
 const a=analyzeShadow({points:steady(30),now:NOW,existingReview:record});
 assert.deepEqual(a.alertContext,{status:'pending',openedBy:'system',autoPauseRequired:false,
  evidence:{rule:'sustained_personal_limit',firstAt:ev.firstAt,lastAt:ev.lastAt,sampleCount:6}});
 assert.equal(reviews.get('R06','SYN006').version,record.version,'existing case untouched');
 const forged=analyzeShadow({points:steady(30),now:NOW,existingReview:{...record,autoEvidence:{rule:'made_up',firstAt:1,lastAt:2,sampleCount:1,latestBpm:999}}});
 assert.equal(forged.alertContext.evidence,null,'invalid evidence is not trusted');
});
