const {chromium}=require(process.env.STEVE_PLAYWRIGHT_PATH||'playwright');
const {spawn}=require('child_process');
const fs=require('fs');
const assert=require('assert/strict');
(async()=>{
 const token='browser-test-only-gateway-token-1234567890',port=25000+Math.floor(Math.random()*1000),base='http://127.0.0.1:'+port;
 const proc=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:String(port),STEVE_VIEWER_TOKEN:'browser-test-only-viewer-token-1234567890',STEVE_GATEWAY_TOKEN_G01:token,STEVE_SLOT_MAP_JSON:JSON.stringify({G01:{R01:'opaque-one',R02:'opaque-two'}})},stdio:'pipe'});
 let browser;
 try{
  for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({headless:true,...(process.env.STEVE_BROWSER_EXECUTABLE?{executablePath:process.env.STEVE_BROWSER_EXECUTABLE}:{}),args:['--no-sandbox']});
  const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.choices=[];window.bands=[];
   Object.defineProperty(navigator,'bluetooth',{value:{requestDevice(options){
    window.choices.push({options,active:navigator.userActivation.isActive});
    const suffix=window.bands.length?'A746':'47FD',d=new EventTarget(),c=new EventTarget();d.id=suffix;d.name='Band 10 '+suffix;
    c.startNotifications=async()=>c;
    d.gatt={connected:false,async connect(){this.connected=true;return this;},async getPrimaryService(){return {getCharacteristic:async()=>c};},disconnect(){this.connected=false;d.dispatchEvent(new Event('gattserverdisconnected'));}};
    d.emit=()=>{const e=new Event('characteristicvaluechanged');c.value=new DataView(Uint8Array.from([6,65]).buffer);c.dispatchEvent(e);};window.bands.push(d);return Promise.resolve(d);
   }}});
  });
  await page.goto(base+'/gateway');await page.locator('#token').fill(token);await page.locator('#load').click();await page.waitForFunction(()=>document.getElementById('loginFields').hidden);
  assert.equal(await page.locator('#token').inputValue(),'');
  const cookies=await context.cookies();const cookie=cookies.find(c=>c.name==='steve_gateway');assert.ok(cookie.httpOnly);assert.equal(cookie.sameSite,'Strict');assert.ok(cookie.expires-Date.now()/1000<=36000&&cookie.expires-Date.now()/1000>=35990);
  assert.equal(await page.evaluate(()=>document.cookie.includes('steve_gateway')),false);
  await page.reload();await page.waitForFunction(()=>!document.getElementById('quickR01').disabled);
  assert.equal(await page.evaluate(()=>window.choices.length),0);
  await page.locator('#quickR01').click();await page.waitForFunction(()=>live.get('R01')?.ready);
  await page.locator('#quickR02').click();await page.waitForFunction(()=>live.get('R02')?.ready);
  assert.deepEqual(await page.evaluate(()=>window.choices.map(c=>c.active)),[true,true]);
  await page.evaluate(()=>window.bands.forEach(d=>d.emit()));await page.waitForFunction(()=>Array.from(live.values()).every(s=>s.ackAt));
  for(const width of [390,1440]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);fs.mkdirSync('ui-artifacts',{recursive:true});await page.screenshot({path:'ui-artifacts/gateway-'+width+'.png',fullPage:true});}
  const text=await page.locator('body').innerText();assert.ok(!/Notifications:|Backend:|GATT|BATTERY/i.test(text));
  await page.locator('#presentation').click();assert.equal(await page.locator('#loginFields').isVisible(),false);assert.equal(await page.locator('.warning').isVisible(),true);
  await page.locator('#resetBle').click();await page.waitForFunction(()=>live.size===2&&Array.from(live.values()).every(s=>s.ready));
  assert.equal(await page.evaluate(()=>window.choices.length),2);assert.deepEqual(await page.evaluate(()=>Array.from(live.values()).map(s=>s.bpm)),[null,null]);
  await page.evaluate(()=>{for(const s of live.values()){s.lastAt=Date.now()-16000;s.bpm=65;}});await page.waitForFunction(()=>Array.from(live.values()).every(s=>s.bpm===null));
  await page.locator('#presentation').click();await page.locator('#clear').click();await page.waitForFunction(()=>document.getElementById('serverStatus').textContent==='ออกจากระบบแล้ว');
  await page.reload();assert.equal(await page.locator('#quickR01').isDisabled(),true);assert.equal(await page.locator('#token').inputValue(),'');
  assert.deepEqual(errors,[]);console.log('PASS Gateway: real cookie login/reload/logout, two user-gesture bands, soft reset, stale NO DATA, mobile/presentation, no battery or exposed credentials');
 }finally{await browser?.close();proc.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
