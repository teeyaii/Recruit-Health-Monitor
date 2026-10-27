import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {RosterStore} from "./roster.js";

const safe=(version,code)=>({version,code,restriction:"none",observation:"none"});

test("recruit identifiers accept lowercase and mixed-case codes verbatim",()=>{
 const store=new RosterStore();
 let p=store.update("R01",safe(0,"a001"),"trainer");
 assert.equal(p.code,"a001");
 p=store.update("R01",safe(1,"A001"),"medic"); // Case-only correction, same wearer.
 assert.equal(p.code,"A001");
 assert.equal(p.version,2);
 const another=store.update("R02",safe(0,"aB-12"),"trainer");
 assert.equal(another.code,"aB-12");
 assert.equal(store.get("R01").code,"A001");
 assert.equal(store.get("R02").code,"aB-12");
});
test("case-insensitive duplicate/identity checks protect slot reassignment",()=>{
 const store=new RosterStore();
 store.update("R01",safe(0,"aB-12"),"trainer");
 assert.throws(()=>store.update("R02",safe(0,"AB-12"),"medic"),{status:409});
 assert.throws(()=>store.update("R02",safe(0,"ab-12"),"medic"),{status:409});
 const changedBySave=store.update("R01",safe(1,"q001"),"medic");
 assert.equal(changedBySave.code,"q001","new wearer is saved with one edit");
 assert.equal(changedBySave.paused,false);
 assert.equal(store.getAudit().at(-1).action,"reassign_via_save");
 assert.throws(()=>store.replace("R01",{version:2,code:"Q001"},"medic"),{status:422},"case-only change is not a replacement");
 const changed=store.replace("R01",{version:2,code:"p004"},"medic");
 assert.equal(changed.code,"p004");
 assert.equal(changed.paused,true,"legacy API still supports explicit PAUSED state");
 const saved=store.update("R01",safe(3,"p004"),"trainer");
 assert.equal(saved.paused,false,"Save reopens legacy paused slot without a second confirmation button");
});
test("malformed and reserved identifiers remain rejected",()=>{
 for(const code of ["abc","a".repeat(25),"ab c1","<img>","ส001","steve_secret","StEvE_TOKEN","ab😊x"]){
  const store=new RosterStore();
  assert.throws(()=>store.update("R01",safe(0,code),"trainer"),{status:422},code);
 }
});
test("mobile roster field explains mixed case and disables automatic capitalization",()=>{
 const html=readFileSync(new URL("../dashboard/live.html",import.meta.url),"utf8");
 assert.match(html,/รหัสประจำตัวทหารใหม่ \(4–24 ตัว ใช้ตัวเล็ก\/ตัวใหญ่\/ตัวเลขได้\)/);
 assert.match(html,/id="rosterCode"[^>]*autocapitalize="none"/);
 assert.doesNotMatch(html,/รหัสสมมติ \(4–24 ตัว พิมพ์ใหญ่\)/);
});

test("reassignment via Save clears the previous recruit's non-emergency observations and restrictions",()=>{
 const store=new RosterStore();
 let p=store.update("R01",{...safe(0,"old1"),restriction:"watch",observation:"dizzy_weak_nausea"},"trainer");
 p=store.acknowledge("R01",{version:p.version},"medic");
 assert.equal(p.acknowledged,true);
 p=store.update("R01",{...safe(p.version,"new2"),restriction:"watch",observation:"dizzy_weak_nausea"},"medic");
 assert.equal(p.code,"new2");assert.equal(p.observation,"none");
 assert.equal(p.restriction,"none");assert.equal(p.acknowledged,false);
 assert.equal(p.paused,false);
 assert.equal(store.getAudit().at(-1).action,"reassign_via_save");
});
test("active EMERGENCY cannot be erased by editing only the recruit identifier",()=>{
 const store=new RosterStore();
 let p=store.update("R01",{...safe(0,"old1"),observation:"confusion_collapse_seizure"},"trainer");
 assert.throws(()=>store.update("R01",safe(p.version,"new2"),"medic"),{status:409});
 assert.equal(store.get("R01").observation,"confusion_collapse_seizure");
 assert.equal(store.get("R01").code,"old1");
});
test("operator screen has one Save button for wearer changes and no resume/replace buttons",()=>{
 const html=readFileSync(new URL("../dashboard/live.html",import.meta.url),"utf8");
 assert.match(html,/id="rosterSave"[^>]*>บันทึกข้อมูลทหารใหม่/);
 assert.doesNotMatch(html,/id="rosterReplace"|id="rosterResume"|id="bandConfirmed"/);
 assert.match(html,/ระบบล้าง BPM และสถานะของผู้สวมเดิม/);
});
