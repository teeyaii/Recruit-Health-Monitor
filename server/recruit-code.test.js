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
 assert.throws(()=>store.update("R01",safe(1,"q001"),"medic"),{status:409},"different person requires Replace");
 assert.throws(()=>store.replace("R01",{version:1,code:"AB-12"},"medic"),{status:422},"case-only change is not a replacement");
 const changed=store.replace("R01",{version:1,code:"p004"},"medic");
 assert.equal(changed.code,"p004");
 assert.equal(changed.paused,true,"replacement still requires a physical band check");
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
