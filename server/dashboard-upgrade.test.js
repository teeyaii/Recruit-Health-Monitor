import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const live=readFileSync(new URL("../dashboard/live.html",import.meta.url),"utf8");
const gateway=readFileSync(new URL("../dashboard/gateway.html",import.meta.url),"utf8");

test("commander chart shows all six requested ranges and uses private archive for long history",()=>{
 for(const [hours,label] of [["0.25","15 นาที"],["0.5","30 นาที"],["1","1 ชั่วโมง"],
  ["4","4 ชั่วโมง"],["8","8 ชั่วโมง"],["168","7 วัน"]]){
  assert.match(live,new RegExp('data-history-hours="'+hours.replace(".","\\.")+'"[^>]*>'+label));
 }
 assert.match(live,/\/api\/archive\/["']\+slot/);
 assert.match(live,/compact=1/);
 assert.match(live,/archiveAllowed\(\)/);
 assert.match(live,/historyIsLive/);
 assert.match(live,/ข้อมูลหัวใจจากเซนเซอร์จริง/);
});

test("training phase clock is based on operator-entered timestamps only",()=>{
 for(const id of ["phaseClock","trainingDuration","restDuration","trainingMetric","restMetric"]){
  assert.match(live,new RegExp('id="'+id+'"'));
 }
 assert.match(live,/groupPhaseData\?\.transitions/);
 assert.match(live,/groupPhaseData\?\.changedAt/);
 assert.match(live,/นับต่อเนื่องจนผู้ฝึก\/แพทย์เปลี่ยนสถานะ/);
});

test("gateway modern presentation retains all actual BLE and auth controls",()=>{
 for(const id of ["gatewayBadge","gatewayDevices","gatewayUpload","quickR01","quickR02",
   "presentation","resetBle","clear","slots","load","gateway","token"]){
  assert.match(gateway,new RegExp('id="'+id+'"'));
 }
 assert.match(gateway,/navigator\.bluetooth/);
 assert.match(gateway,/gatewayUpload/);
 assert.match(gateway,/paintGatewayOverview\(\)/);
 assert.match(gateway,/NO DATA/);
});
