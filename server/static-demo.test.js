import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

test("standalone mobile demo performs 15-slot / 5-gateway failure scenarios without networking",async()=>{
  const html=await readFile(new URL("../dashboard/index.html",import.meta.url),"utf8");
  assert.match(html,/<meta name="viewport"/);
  assert.match(html,/SIMULATED • DEMO ONLY/);
  assert.doesNotMatch(html,/<script\s+src=/i);
  assert.doesNotMatch(html,/\bfetch\s*\(/);
  assert.doesNotMatch(html,/Bearer |RECRUIT_MONITOR_TOKEN|STEVE_VIEWER_TOKEN/);
  const match=html.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(match,"expected inline script for single-file demo");
  const elements=new Map();
  let now=1792584000000,interval;
  const el=id=>{
    if(!elements.has(id)){
      const controls=new Map();
      elements.set(id,{id,value:"",textContent:"",innerHTML:"",
        addEventListener:(name,cb)=>controls.set(name,cb),
        click:()=>controls.get("click")?.()});
    }
    return elements.get(id);
  };
  class TestDate extends Date {static now(){return now;}}
  const ctx={
    document:{getElementById:el},
    Date:TestDate,
    Math,Number,Array,String,JSON,Set,Map,Boolean,Blob,
    URL:{createObjectURL:()=> "blob:test",revokeObjectURL:()=>{}},
    setInterval:fn=>{interval=fn;},
    setTimeout:()=>{},
  };
  vm.runInNewContext(match[1],ctx,{timeout:1000});
  assert.equal(el("fresh").textContent,"0/15");
  el("toggle").click();
  assert.equal(el("fresh").textContent,"15/15");
  assert.equal(el("gate-count").textContent,"5/5");
  assert.match(el("roster").innerHTML,/SIMULATED/);
  el("drop-one").click();
  now+=16000;interval();
  assert.equal(el("fresh").textContent,"14/15");
  el("drop-gateway").click();
  now+=16000;interval();
  assert.equal(el("fresh").textContent,"11/15");
  assert.equal(el("gate-count").textContent,"4/5");
  el("restore").click();
  assert.equal(el("fresh").textContent,"15/15");
  el("toggle").click();
  now+=16000;interval();
  assert.equal(el("fresh").textContent,"0/15");
  assert.match(el("roster").innerHTML,/ไม่ทราบค่า/);
  el("wbgt").value="29.5";el("save-wbgt").click();
  assert.match(el("wbgt-state").textContent,/29.5/);
  el("reset").click();
  assert.equal(el("fresh").textContent,"0/15");
  assert.match(el("wbgt-state").textContent,/ยังไม่มีค่า/);
});
