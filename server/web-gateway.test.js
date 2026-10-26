import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// Pure in-memory Bluefy gateway smoke tests: no BLE hardware, no HTTP, no secrets.
const html=await readFile(new URL("../dashboard/gateway.html",import.meta.url),"utf8");
const match=html.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
assert.ok(match,"gateway must have its own inline, same-origin script");
function decoderFromPage(){
 const element={addEventListener(){},textContent:"",value:"",replaceChildren(){},disabled:false};
 const context={document:{getElementById(){return element;},addEventListener(){}},
  window:{addEventListener(){}},navigator:{bluetooth:null},setInterval(){},
  Map,Set,Date,AbortController,fetch(){throw Error("not reached");}};
 vm.createContext(context);
 vm.runInContext(match[1]+"\nthis.__decode=decodeHeartRate;",context,{timeout:1000});
 return context.__decode;
}
const data=bytes=>new DataView(Uint8Array.from(bytes).buffer);

test("Bluefy pilot uses native Web BLE notifications and strictly same-origin Gateway API",()=>{
 assert.match(html,/navigator\.bluetooth\.requestDevice/);
 assert.match(html,/startNotifications\(\)/);
 assert.match(html,/characteristicvaluechanged/);
 assert.match(html,/\/api\/gateway\/provision/);
 assert.match(html,/\/api\/ingest/);
 assert.match(html,/visibilitychange/);
 assert.match(html,/pagehide/);
 assert.match(html,/BACKGROUND \/ NO DATA/);
 assert.doesNotMatch(html,/localStorage|sessionStorage|sendBeacon|https?:\/\/(?![^ ]*w3\.org)/i);
});
test("HR parser handles real Band 10 8-bit packets and uint16 format",()=>{
 const decode=decoderFromPage();
 assert.equal(decode(data([0x06,0x35])),53);
 assert.equal(decode(data([0x06,0x39])),57);
 assert.equal(decode(data([0x06,0x42])),66);
 assert.equal(decode(data([0x07,0x4b,0x00])),75);
 assert.equal(decode(data([0x04,0x42])),null,"supported but no sensor contact");
 assert.equal(decode(data([0x06])),null,"truncated packet");
 assert.equal(decode(data([0x01,0x2c,0x01])),null,"300 BPM rejected");
 assert.equal(decode(data([0x06,0x00])),null,"invalid BPM rejected");
});
