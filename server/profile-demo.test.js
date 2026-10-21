import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

test("demo-only profiles support editable measurements, manual alerts and safe occupant replacement",async()=>{
 const html=await readFile(new URL("../dashboard/index.html",import.meta.url),"utf8");
 assert.match(html,/ข้อมูลสมมติเท่านั้น/);
 assert.doesNotMatch(html,/\bfetch\s*\(|\blocalStorage\b|\bsessionStorage\b/);
 const js=html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
 assert.ok(js);
 let now=1792584000000,interval;
 const nodes=new Map();
 const el=id=>{
  if(!nodes.has(id)){
   const handlers=new Map();
   nodes.set(id,{value:"",textContent:"",innerHTML:"",className:"",
    addEventListener:(name,cb)=>handlers.set(name,cb),
    click:()=>handlers.get("click")?.(),
    change:()=>handlers.get("change")?.()});
  }
  return nodes.get(id);
 };
 class Clock extends Date {static now(){return now;}}
 const context={document:{getElementById:el},Date:Clock,Math,Number,Array,JSON,String,Set,Map,Boolean,Blob,
  URL:{createObjectURL:()=> "blob:demo",revokeObjectURL:()=>{}},setInterval:fn=>{interval=fn;},setTimeout:()=>{}};
 vm.runInNewContext(js,context,{timeout:1500});
 el("toggle").click();
 assert.equal(el("fresh").textContent,"15/15");
 assert.match(el("roster").innerHTML,/DEMO-R01/);

 // New occupant (different code) must never inherit observations from the previous occupant.
 el("profile-code").value="DEMO-PERSON-A";
 el("profile-weight").value="71.5";
 el("profile-height").value="174";
 el("profile-condition").value="asthma";
 el("profile-observation").value="dizzy";
 el("profile-save").click();
 assert.match(el("roster").innerHTML,/DEMO-PERSON-A/);
 assert.doesNotMatch(el("alert-summary").textContent,/หยุดกิจกรรม/,"new occupant cannot inherit a selected previous-person event");
 assert.equal(el("fresh").textContent,"14/15","reassignment must invalidate the old recruit reading");
 assert.match(el("roster").innerHTML,/71.5 กก./);
 interval();
 assert.equal(el("fresh").textContent,"15/15","next fake measurement belongs to new occupant");

 // The operator can now report an observed symptom for the new occupant.
 el("profile-observation").value="dizzy";
 el("profile-condition").value="asthma";
 el("profile-save").click();
 assert.match(el("alert-summary").textContent,/R01.*หยุดกิจกรรม/);
 assert.match(el("roster").innerHTML,/เวียน|หยุดกิจกรรม|ประเมิน/);
 assert.doesNotMatch(el("roster").innerHTML,/ปลอดภัยต่อการฝึก/);

 // A distinct slot can be marked as an urgent manual observation.
 el("profile-slot").value="R02";el("profile-slot").change();
 el("profile-observation").value="confused";
 el("profile-save").click();
 assert.match(el("alert-summary").textContent,/R02.*ฉุกเฉิน/);
 assert.match(el("roster").innerHTML,/1669/);

 // Switching an occupant clears their BPM and the previous person's alert.
 el("profile-replace").click();
 assert.equal(el("fresh").textContent,"14/15");
 assert.doesNotMatch(el("alert-summary").textContent,/R02.*ฉุกเฉิน/);
 assert.match(el("profile-code").value,/^DEMO-NEW-R02$/);

 // No ordinary height, weight or mock diagnosis can trigger emergency by itself.
 el("profile-code").value="DEMO-PERSON-B";
 el("profile-weight").value="95";
 el("profile-height").value="160";
 el("profile-condition").value="heart";
 el("profile-save").click();
 assert.doesNotMatch(el("alert-summary").textContent,/R02.*ฉุกเฉิน/);
 el("profile-caution").value="watch";el("profile-save").click();
 assert.match(el("alert-summary").textContent,/R02.*เฝ้าระวัง/);

 // Invalid free-text identifiers are rejected rather than rendered.
 el("profile-code").value="<img src=x onerror=alert(1)>";
 el("profile-save").click();
 assert.match(el("profile-message").textContent,/กรอกเฉพาะรหัสสมมติ/);
 assert.doesNotMatch(el("roster").innerHTML,/<img/);

 el("reset").click();
 assert.match(el("roster").innerHTML,/DEMO-R01/);
 assert.equal(el("fresh").textContent,"0/15");
 assert.doesNotMatch(el("alert-summary").textContent,/R01.*หยุดกิจกรรม/);
});
