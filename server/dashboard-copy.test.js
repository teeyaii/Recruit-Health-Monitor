import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const dashboard=readFileSync(new URL("../dashboard/live.html",import.meta.url),"utf8");
const gateway=readFileSync(new URL("../dashboard/gateway.html",import.meta.url),"utf8");

test("Gateway removes presentation-only pilot warnings but retains real telemetry",()=>{
 assert.doesNotMatch(gateway,/ต้นแบบเพื่อทดสอบอุปกรณ์เท่านั้น/);
 assert.doesNotMatch(gateway,/Web BLE Gateway Pilot/);
 assert.doesNotMatch(gateway,/<div class="card warning"/);
 for(const id of ["gatewayBadge","gatewayDevices","gatewayUpload","quickR01","quickR02","slots","load"]){
  assert.match(gateway,new RegExp('id="'+id+'"'));
 }
 assert.match(gateway,/NO DATA/);
 assert.match(gateway,/navigator\\.bluetooth/);
});

test("Dashboard uses lean commander copy and keeps essential risk status intact",()=>{
 assert.doesNotMatch(dashboard,/>PROTOTYPE —/);
 assert.doesNotMatch(dashboard,/ผู้ฝึกและแพทย์มีสิทธิ์เท่ากัน/);
 assert.doesNotMatch(dashboard,/สถานะภาพรวม ไม่เปลี่ยนข้อจำกัดการฝึก/);
 assert.doesNotMatch(dashboard,/พักประจำชั่วโมงทั้งกลุ่ม/);
 assert.doesNotMatch(dashboard,/เมื่อเปลี่ยนผู้สวม ให้ย้ายและตรวจสายรัด/);
 assert.match(dashboard,/พักประจำชั่วโมง/);
 assert.match(dashboard,/รหัสประจำตัว \\(หน่วยกำหนด\\)/);
 for(const id of ["trainingPanel","phaseClock","trainingDuration","restDuration","statLive","statNoData","statWatch","statPaused","rosterBox","historyPanel"]){
  assert.match(dashboard,new RegExp('id="'+id+'"'));
 }
 assert.match(dashboard,/data-ack-slot/);
 assert.match(dashboard,/ยังเป็น EMERGENCY/);
 assert.match(dashboard,/NO DATA/);
});
