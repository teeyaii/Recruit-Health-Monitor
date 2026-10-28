import test from "node:test";
import vm from "node:vm";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const page=readFileSync(new URL("../dashboard/live.html",import.meta.url),"utf8");

test("R03 and R04 seven-day preview is visibly simulated, hidden until requested",()=>{
 for(const id of ["trainingPreview","trainingPreviewToggle","trainingPreviewReset",
   "trainingPreviewR03","trainingPreviewR04","trainingPreviewDays"]){
  assert.match(page,new RegExp('id="'+id+'"'));
 }
 assert.match(page,/id="trainingPreview"[^>]* hidden>/);
 assert.match(page,/DEMO DATA.*SIMULATED/);
 assert.match(page,/trainingPreviewSamples=\{/);
 assert.match(page,/R03:\[[^\]]*\]/);
 assert.match(page,/R04:\[[^\]]*\]/);
 assert.match(page,/day<=7/);
 assert.match(page,/NORMAL · ตัวอย่าง/);
 assert.match(page,/WATCH · ตัวอย่าง/);
 assert.match(page,/BPM · SIMULATED/);
 assert.match(page,/ไม่ใช่เหตุเตือนจริง/);
 assert.match(page,/ไม่ได้สรุปว่าเสี่ยงจากค่า 132 BPM เพียงตัวเดียว/);
 assert.match(page,/ไม่มีการเพิ่ม R03\/R04 ลงทะเบียนจริง/);
});

test("clearing preview never calls medical or LIVE write endpoints",()=>{
 const start=page.indexOf("// Presentation preview is deliberately in-memory only;");
 const end=page.indexOf("let historyCode=null;",start);
 assert.ok(start>0&&end>start);
 const previewLogic=page.slice(start,end);
 assert.doesNotMatch(previewLogic,/\bfetch\s*\(|\blocalStorage\b|\bsessionStorage\b|\/api\//);
 assert.match(previewLogic,/function clearTrainingPreview\(\)/);
 assert.match(previewLogic,/function openTrainingPreview\(\)/);
 assert.match(page,/function disconnect\(\)\{clearTrainingPreview\(\)/);
 assert.match(page,/function connect\(\)\{byId\("trainingPreviewToggle"\)\.hidden=false/);
});

 test("schedule-driven synthetic series stays deterministic and labels missing timetable coverage",()=>{
 const start=page.indexOf("const previewWeekdays="),end=page.indexOf("function trainingPreviewSvg",start);
 const context=vm.createContext({});vm.runInContext(page.slice(start,end)+";this.api={previewPhase,previewDayPoints,previewDailySvg,trainingPreviewSamples};",context);
 const {api}=context;
 assert.equal(api.previewPhase(0,500),'training');
 assert.equal(api.previewPhase(0,535),'hourly_rest');
 assert.equal(api.previewPhase(5,800),'no_training');
 assert.equal(api.previewPhase(6,500),'no_training');
 for(const slot of ['R03','R04']){
  assert.equal(api.trainingPreviewSamples[slot].length,7);
  for(let day=0;day<7;day++){
   const points=api.previewDayPoints(slot,day);
   assert.equal(points.length,288);
   assert.ok(points.every(p=>p[1]>=40&&p[1]<=180));
   assert.equal(JSON.stringify(points),JSON.stringify(api.previewDayPoints(slot,day)));
  }
 }
 assert.match(api.previewDailySvg('R04',2),/14:20 WATCH/);
 assert.doesNotMatch(api.previewDailySvg('R03',2),/14:20 WATCH/);
 assert.match(page,/อาทิตย์เป็นสมมติฐาน/);
 });
