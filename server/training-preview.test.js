import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const page=readFileSync(new URL("../dashboard/live.html",import.meta.url),"utf8");

test("R01 and R02 seven-day preview is visibly simulated, hidden until requested",()=>{
 for(const id of ["trainingPreview","trainingPreviewToggle","trainingPreviewReset",
   "trainingPreviewR01","trainingPreviewR02","trainingPreviewDays"]){
  assert.match(page,new RegExp('id="'+id+'"'));
 }
 assert.match(page,/id="trainingPreview"[^>]* hidden>/);
 assert.match(page,/DEMO DATA.*SIMULATED/);
 assert.match(page,/trainingPreviewSamples=\{/);
 assert.match(page,/R01:\[[^\]]+\]/);
 assert.match(page,/R02:\[[^\]]+\]/);
 assert.match(page,/day<=7/);
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
