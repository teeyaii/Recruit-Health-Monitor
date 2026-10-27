import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const dashboard=readFileSync(new URL("../dashboard/live.html",import.meta.url),"utf8");
const gateway=readFileSync(new URL("../dashboard/gateway.html",import.meta.url),"utf8");

test("Gateway removes presentation-only pilot warnings but retains real telemetry",()=>{
 assert.equal(gateway.includes("ต้นแบบเพื่อทดสอบอุปกรณ์เท่านั้น"),false);
 assert.equal(gateway.includes("Web BLE Gateway Pilot"),false);
 assert.equal(gateway.includes('<div class="card warning"'),false);
 for(const id of ["gatewayBadge","gatewayDevices","gatewayUpload","quickR01","quickR02","slots","load"]){
  assert.ok(gateway.includes('id="'+id+'"'));
 }
 assert.ok(gateway.includes("NO DATA"));
 assert.ok(gateway.includes("navigator.bluetooth"));
});

test("Dashboard uses concise commander copy and keeps real emergency indicators",()=>{
 for(const phrase of ["PROTOTYPE —","ผู้ฝึกและแพทย์มีสิทธิ์เท่ากัน",
   "สถานะภาพรวม ไม่เปลี่ยนข้อจำกัดการฝึก","พักประจำชั่วโมงทั้งกลุ่ม",
   "เมื่อเปลี่ยนผู้สวม ให้ย้ายและตรวจสายรัด"]){
  assert.equal(dashboard.includes(phrase),false,phrase);
 }
 assert.ok(dashboard.includes("พักประจำชั่วโมง"));
 assert.ok(dashboard.includes("รหัสประจำตัว (หน่วยกำหนด)"));
 for(const id of ["trainingPanel","phaseClock","trainingDuration","restDuration",
   "statLive","statNoData","statWatch","statPaused","rosterBox","historyPanel"]){
  assert.ok(dashboard.includes('id="'+id+'"'),id);
 }
 assert.ok(dashboard.includes("data-ack-slot"));
 assert.ok(dashboard.includes("ยังเป็น EMERGENCY"));
 assert.ok(dashboard.includes("NO DATA"));
});
