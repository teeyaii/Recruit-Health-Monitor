const {chromium}=require(process.env.STEVE_PLAYWRIGHT_PATH||"playwright");
const fs=require("fs"),assert=require("node:assert/strict");
(async()=>{
 fs.mkdirSync("ui-artifacts",{recursive:true});
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  const page=await browser.newPage(),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  const token="A".repeat(43),url="http://steve.test/commander#view="+token;
  let authCount=0,access=true;
  let state={serverTime:Date.now(),training:{phase:"training",changedAt:Date.now()},
   medicPending:1,gateways:[{id:"G01",online:true},{id:"G02",online:false}],
   people:[
    {id:"R10",displayCode:"Z010-LAST",registered:true,hr:null,timestamp:null,state:"DISCONNECTED",risk:"MONITOR",autoCheck:false},
    {id:"R04",displayCode:"B018-PEERAWIT",registered:true,hr:null,timestamp:null,state:"NO DATA",risk:"MONITOR",autoCheck:false},
    {id:"R03",displayCode:"A001-MAYTASIT",registered:true,hr:82,timestamp:Date.now(),state:"CONNECTED",risk:"MONITOR",autoCheck:false},
    {id:"R02",displayCode:"C015-KANCHAT",registered:true,hr:null,timestamp:null,state:"DISCONNECTED",risk:"EMERGENCY",autoCheck:false},
    {id:"R01",displayCode:"R001-TEST",registered:true,hr:76,timestamp:Date.now(),state:"CONNECTED",risk:"WATCH",autoCheck:false}
   ]};
  await page.route("http://steve.test/commander",r=>r.fulfill({contentType:"text/html",body:fs.readFileSync("dashboard/commander.html","utf8")}));
  await page.route("**/api/commander/auth",async r=>{
   const body=r.request().postDataJSON();assert.equal(body.token,token);authCount++;
   await r.fulfill({contentType:"application/json",body:JSON.stringify({ok:true,expiresAt:Date.now()+3600000})});
  });
  await page.route("**/api/commander/snapshot",r=>r.fulfill({status:access?200:401,contentType:"application/json",
   body:JSON.stringify(access?state:{error:"expired"})}));
  await page.route("**/api/commander/logout",r=>r.fulfill({contentType:"application/json",body:'{"ok":true}'}));
  await page.goto(url);await page.waitForFunction(()=>!document.getElementById("dashboard").hidden);
  assert.equal(authCount,1);assert.equal(await page.evaluate(()=>location.hash),"","link secret must leave address bar");
  assert.equal(await page.locator("#cards .person").count(),5);
  assert.deepEqual(await page.locator("#cards .slot").allTextContents(),["R01","R02","R03","R04","R10"],
   "all wearable slots appear by R-code, not risk order");
  assert.deepEqual(await page.locator("#cards .person-name").allTextContents(),
   ["R001-TEST","C015-KANCHAT","A001-MAYTASIT","B018-PEERAWIT","Z010-LAST"]);
  assert.equal(await page.locator("#enrolled").innerText(),"5");
  assert.equal(await page.locator("#itemCount").innerText(),"(5)");
  assert.ok(!(await page.locator("body").innerText()).includes("จอผู้บังคับบัญชา"));
  assert.equal(await page.locator("#emergency").innerText(),"1");
  assert.equal(await page.locator("#watch").innerText(),"1");
  assert.equal(await page.locator("#fresh").innerText(),"2");
  assert.equal(await page.locator("#missing").innerText(),"3");
  assert.ok((await page.locator("#cards").innerText()).includes("DISCONNECTED"));
  assert.equal(await page.locator("#cards .bpm").allInnerTexts().then(x=>x.includes("— BPM")),true);
  const bodyText=await page.locator("body").innerText();
  assert.ok(!/A001-PRIVATE|โรคประจำตัว:|รับทราบเหตุ|บันทึกข้อมูลทหารใหม่/.test(bodyText));
  assert.equal(await page.locator('input').count(),0,"commander UI must be free of input forms");
  assert.equal(await page.locator('button').count(),2,"only Refresh and Log out may be buttons");
  for(const width of [390,1024]){
   await page.setViewportSize({width,height:844});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:"ui-artifacts/steve-commander-"+width+".png",fullPage:true});
  }
  state={...state,serverTime:Date.now(),people:state.people.map(p=>({...p,hr:null,timestamp:Date.now()-20000,state:"STALE"}))};
  await page.locator("#refresh").click();
  await page.waitForFunction(()=>document.getElementById("fresh").textContent==="0");
  assert.equal(await page.locator("#missing").innerText(),"5");
  assert.ok(!(await page.locator("#cards").innerText()).includes("76 BPM"),"stale BPM must not remain live");
  access=false;await page.locator("#refresh").click();
  await page.waitForFunction(()=>document.getElementById("dashboard").hidden);
  assert.match(await page.locator("#accessMessage").innerText(),/ลิงก์หมดอายุ/);
  assert.deepEqual(errors,[]);
  // The QR generator is served locally; no external QR-hosting service sees the secret.
  const qrPage=await browser.newPage(),qrErrors=[];
  qrPage.on("pageerror",e=>qrErrors.push(e.message));
  await qrPage.route("http://steve.test/assets/qrcode.min.js",r=>r.fulfill({
   contentType:"text/javascript",body:fs.readFileSync("dashboard/qrcode.min.js","utf8")}));
  await qrPage.route("**/api/**",r=>r.fulfill({status:401,contentType:"application/json",body:"{}"}));
  await qrPage.route("http://steve.test/live",r=>r.fulfill({
   contentType:"text/html",body:fs.readFileSync("dashboard/live.html","utf8")}));
  await qrPage.goto("http://steve.test/live");
  await qrPage.evaluate(()=>{const box=document.getElementById("commanderQr");
   new QRCode(box,{text:"https://steve.example/commander#view="+"A".repeat(43),
    width:204,height:204,correctLevel:QRCode.CorrectLevel.M});});
  assert.ok(await qrPage.locator("#commanderQr img, #commanderQr canvas").count());
  assert.deepEqual(qrErrors,[]);
  console.log("PASS private commander rendering, read-only controls, stale handling, revoke and local QR");
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
