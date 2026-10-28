const {chromium}=require(process.env.STEVE_PLAYWRIGHT_PATH || 'playwright');
const fs=require('fs');
(async()=>{fs.mkdirSync('ui-artifacts',{recursive:true});const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',r=>r.fulfill({status:401,body:'{}'}));
await page.route('http://steve.test/live',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync('dashboard/live.html','utf8')}));await page.goto('http://steve.test/live');
await page.evaluate(()=>{transportUp=true;rosterData={slots:[{id:'R01',code:'DEMO-R01',restriction:'watch'},{id:'R02',code:'DEMO-R02',observation:'confusion_collapse_seizure',acknowledged:true}]};document.getElementById('login').hidden=true;draw({recruits:Array.from({length:15},(_,i)=>({id:'R'+String(i+1).padStart(2,'0'),hr:i<2?52+i*6:null,timestamp:i<2?Date.now():null,stale:i>=2,gateway:'G01'}))});});
await page.evaluate(()=>{groupPhaseData={phase:'hourly_rest',version:1,changedAt:Date.now(),ephemeral:true};paintGroupPhase();});
if(await page.locator('#rosterActivity').count())throw Error('obsolete per-person activity picker');
if(!await page.locator('#trainingPanel').isVisible())throw Error('group phase panel hidden');
if(!await page.locator('#groupPhaseLabel').textContent().then(t=>t.includes('พักประจำชั่วโมง')))throw Error('group phase label');
if(await page.locator('#startHourlyRest').getAttribute('aria-pressed')!=='true')throw Error('hourly rest action not pressed');
await page.evaluate(()=>{groupPhaseData={phase:'training',version:2,changedAt:Date.now(),ephemeral:true};paintGroupPhase();});
if(await page.locator('#groupPhaseLabel').textContent()!=='กำลังทำการฝึก')throw Error('requested active training label');
if(!await page.locator('#startTraining').textContent().then(t=>t.includes('กำลังทำการฝึก')))throw Error('training action wording');
// Off-training action spans the lower row; previous training clock stops.
await page.evaluate(()=>{const now=Date.now();groupPhaseData={phase:'no_training',version:3,changedAt:now-60000,
 transitions:[{phase:'training',at:now-180000},{phase:'no_training',at:now-60000}]};paintGroupPhase();});
if(await page.locator('#groupPhaseLabel').textContent()!=='ไม่มีการฝึก')throw Error('off-training label');
if(await page.locator('#trainingDuration').textContent()!=='2 นาที')throw Error('training timer continued through off-training');
if(await page.locator('#startNoTraining').getAttribute('aria-pressed')!=='true')throw Error('off-training button inactive');
for(const width of [390,1024,1440]){
 await page.setViewportSize({width,height:900});
 const a=await page.locator('#startTraining').boundingBox(),b=await page.locator('#startHourlyRest').boundingBox(),c=await page.locator('#startNoTraining').boundingBox();
 if(Math.abs(a.y-b.y)>1||c.y<a.y+a.height||Math.abs(c.x-a.x)>1||Math.abs(c.width-(b.x+b.width-a.x))>1)throw Error('off-training action must span below training/rest');
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('phase actions overflow');
}
if(!await page.locator('#emergencyAlerts').isVisible())throw Error('visible active EMERGENCY required');
if(await page.locator('#emergencyAlerts').getAttribute('role')!=='alert')throw Error('critical screenreader alert lost');
if(!await page.locator('.emergency-title').textContent().then(t=>t.includes('หยุดกิจกรรม')&&t.includes('เจ้าหน้าที่แพทย์')))throw Error('urgent clinical direction lost');
if(!await page.locator('#emergencyAlerts').textContent().then(t=>t.includes('ยังเป็น EMERGENCY')))throw Error('acknowledged emergency improperly cleared');

if(await page.locator('#statLive').textContent()!=='2')throw Error('live count');if(await page.locator('#statTotal').textContent()!=='2')throw Error('enrolled high-risk count');if(await page.locator('#statNoData').textContent()!=='0')throw Error('unassigned counted NO DATA');if(await page.locator('#statUnregistered').textContent()!=='13')throw Error('unregistered capacity count');if(await page.locator('#cards .card').count()!==2)throw Error('phantom unassigned cards');if(await page.locator('#cards').textContent().then(t=>/BATTERY|UNKNOWN|82%/i.test(t)))throw Error('battery should not render');
if(await page.locator('.card-personnel-code').allTextContents().then(a=>a.join('|'))!=='DEMO-R01|DEMO-R02')throw Error('recruit codes not shown first');
if(await page.locator('.card-slot-label').allTextContents().then(a=>a.join('|').includes('R01')&&a.join('|').includes('R02'))!==true)throw Error('R-slot label absent');
if(!await page.locator('#rosterBox').textContent().then(t=>t.includes('รหัสประจำตัว (หน่วยกำหนด)')))throw Error('roster form label not changed');

// TEST ONLY: monitoring state and automatic pause must survive stale HR.
await page.evaluate(()=>{const rows=last.recruits.map(r=>({...r}));rows[0].autoCheck=true;rows[0].monitoringStatus='MONITORING_NOT_CONFIGURED';draw({recruits:rows});});
if(!await page.locator('#autoPauseAlerts').isVisible())throw Error('automatic pause missing');
if(await page.locator('#cards').textContent().then(t=>/MONITORING NOT CONFIGURED|clinical approval/.test(t)))throw Error('configuration copy leaked onto cards');
await page.locator('#enableAlertSound').click();
if(await page.locator('#enableAlertSound').getAttribute('aria-pressed')!=='true')throw Error('foreground audio activation failed');
await page.evaluate(()=>{const rows=last.recruits.map(r=>({...r}));rows[0].autoCheck=false;draw({recruits:rows});});

// Browser-only presentation preview: separate from real sensor and alert state.
await page.evaluate(()=>openTrainingPreview());
if(await page.locator('#trainingPreviewR03 svg').count()!==1)throw Error('R03 demo graph missing');
if(await page.locator('#trainingPreviewR04 svg').count()!==1)throw Error('R04 demo graph missing');
if(await page.locator('#trainingPreviewDays input').count()!==7)throw Error('seven training activity fields missing');
if(!await page.locator('#trainingPreviewPeople').textContent().then(t=>t.includes('NORMAL')&&t.includes('WATCH')))throw Error('demo scenario labels missing');
if(await page.locator('#statTotal').textContent()!=='2')throw Error('simulated slots affected enrolled count');
if(await page.locator('#statWatch').textContent()!=='1')throw Error('simulated watch affected actual watch count');

await page.setViewportSize({width:390,height:844});
if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('training preview overflows iPhone');
await page.evaluate(()=>clearTrainingPreview());
if(await page.locator('#trainingPreview').isVisible())throw Error('training preview reset failed');
// Per-recruit graph must only be created on demand for registered LIVE slots.
if(await page.locator('.history-open').count()!==2)throw Error('LIVE wearers should have exactly two graph buttons');
if(await page.locator('#historyPanel').isVisible())throw Error('chart should not render before click');
await page.route('**/api/history/R01**',route=>{
 const now=Date.now(),windowStart=now-4*3600000;
 return route.fulfill({contentType:'application/json',body:JSON.stringify({
  slot:'R01',windowStart,windowEnd:now,windowHours:4,ephemeral:true,
  points:[[now-75000,70],[now-70000,73],[now-40000,96],[now-35000,99],[now-10000,86]],
  phases:[{at:now-95000,phase:'training'},{at:now-50000,phase:'hourly_rest'}]
 })});
});
await page.locator('[data-history-slot="R01"]').click();
await page.locator('#historyChart svg').waitFor();
if(await page.locator('#historyChart polyline').count()!==2)throw Error('missing-data intervals incorrectly connected');
if(await page.locator('#historyChart rect').count()!==2)throw Error('training/rest activity bars absent');
if(!await page.locator('#historyStats').textContent().then(t=>t.includes('ต่ำสุด')&&t.includes('สูงสุด')))throw Error('min/max graph stats absent');
// Archive charts retain the same recorded cohort phase bands as live history.
for(const hours of [0.25,4,8,168]){
 await page.evaluate(hours=>{historyHours=hours;const now=Date.now();renderHistory({
  source:'actual accepted HR only',windowEnd:now,compacted:hours>=8,
  points:[[now-75000,70],[now-70000,73],[now-10000,86]],
  phases:[{at:now-95000,phase:'training'},{at:now-50000,phase:'hourly_rest'},{at:now-20000,phase:'no_training'}]
 });},hours);
 if(!await page.locator('#historyLegend').isVisible())throw Error('archive phase legend hidden');
 if(await page.locator('#historyChart rect[data-phase="training"]').count()!==1||await page.locator('#historyChart rect[data-phase="hourly_rest"]').count()!==1)throw Error('archive training/rest bands missing');
 if(await page.locator('#historyChart rect[data-phase="no_training"]').count()!==1)throw Error('off-training archive band missing');
}
await page.evaluate(()=>{renderHistory({source:'actual accepted HR only',windowEnd:Date.now(),points:[[Date.now()-1000,80]],phases:[]});historyHours=4;});
if(await page.locator('#historyChart rect[data-phase]').count())throw Error('invented phase without recorded events');
if(!await page.locator('#historyNote').textContent().then(t=>t.includes('ไม่มีบันทึก')))throw Error('missing phase history not explained');
await page.evaluate(()=>{const copy=last.recruits.map(r=>({...r}));copy[1].stale=true;copy[1].hr=null;draw({recruits:copy});});
if(await page.locator('[data-history-slot="R02"]').count()!==0)throw Error('NO DATA recruit should not render a graph button');
if(await page.locator('[data-history-slot="R01"]').count()!==1)throw Error('other LIVE recruit button disappeared');
await page.evaluate(()=>{const copy=last.recruits.map(r=>({...r}));copy[0].stale=true;copy[0].hr=null;draw({recruits:copy});});
if(await page.locator('#historyPanel').isVisible())throw Error('open graph was not dismissed when its wearer became NO DATA');
await page.evaluate(()=>{const copy=last.recruits.map(r=>({...r}));copy[0].stale=false;copy[0].hr=52;copy[0].timestamp=Date.now();copy[1].stale=false;copy[1].hr=58;copy[1].timestamp=Date.now();draw({recruits:copy});});

/* Private medical review remains behind authorized account and never leaks
   medications/conditions into commander KPIs or ordinary wearer cards. */
await page.route('**/api/medic-reviews/R01',route=>{
 const now=Date.now();return route.fulfill({contentType:'application/json',body:JSON.stringify({
  slot:'R01',review:{status:'pending',version:1,reason:'rest_recovery',note:'Test reviewed by medic'},
  signal:{quality:'usable_for_description',latestBpm:78,observedMeanBpm:82,baselineBpm:65,deltaBpm:17},
  context:{ageYears:21,bmi:24.5,wbgtC:29,medications:'PRIVATE-TEST-MEDS',conditions:'PRIVATE-TEST-CONTEXT'},
  points:[[now-14000,78],[now-7000,81],[now,78]]
 })});
});
await page.evaluate(()=>{operatorRole='medic';byId('rosterBox').hidden=false;byId('medicPanel').hidden=false;byId('medicPanel').open=true;});
await page.waitForFunction(()=>document.getElementById('medicReviewState').textContent.includes('รอเจ้าหน้าที่ประเมิน'));
if(!await page.locator('#medicClinicalContext').textContent().then(t=>t.includes('PRIVATE-TEST-MEDS')))throw Error('private medic context missing');
if(await page.locator('#commandStats').textContent().then(t=>t.includes('PRIVATE-TEST')))throw Error('medical context leaked to commander');
if(await page.locator('#cards').textContent().then(t=>t.includes('PRIVATE-TEST')))throw Error('medical context leaked to wearer cards');
if(!await page.locator('#medicChart svg').count())throw Error('measured medic trend chart missing');
await page.setViewportSize({width:390,height:844});
if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('medic panel overflows iPhone viewport');
await page.screenshot({path:'ui-artifacts/steve-medic-review-390.png',fullPage:true});
await page.evaluate(()=>{byId('medicPanel').open=false;byId('medicPanel').hidden=true;byId('rosterBox').hidden=true;operatorRole=null;});
for(const width of [390,1024,1440]){await page.setViewportSize({width,height:900});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('horizontal overflow '+width);
const dims=await page.evaluate(()=>{const a=document.getElementById('emergencyAlerts').getBoundingClientRect();const b=document.getElementById('trainingPanel').getBoundingClientRect();return {emergencyWidth:a.width,trainingWidth:b.width,emergencyHeight:a.height,trainingHeight:b.height};});
if(dims.emergencyWidth>760.5)throw Error('alert wider than compact limit '+width);
if(width===1440&&dims.emergencyWidth>=dims.trainingWidth*.8)throw Error('alert competes with group training banner');
if(width===390&&dims.emergencyHeight>=dims.trainingHeight)throw Error('mobile alert not shorter than group banner');
if(dims.emergencyWidth>width-20)throw Error('alert overflows viewport');
await page.screenshot({path:'ui-artifacts/steve-'+width+'.png',fullPage:true});}
// Risk rails remain visible at mobile, tablet and commander widths, including loss of data.
await page.evaluate(()=>{operatorRole='medic';transportUp=false;rosterData={slots:[
 {id:'R01',code:'A001',restriction:'none'},
 {id:'R02',code:'A002',restriction:'watch'},
 {id:'R03',code:'A003',observation:'confusion_collapse_seizure'}]};
 draw({recruits:rosterData.slots.map(p=>({id:p.id,hr:null,stale:true,timestamp:null}))});});
for(const width of [390,1024,1440]){
 await page.setViewportSize({width,height:900});
 const rails=await page.locator('#cards .card').evaluateAll(cards=>cards.map(c=>({
  color:getComputedStyle(c).borderLeftColor,width:getComputedStyle(c).borderLeftWidth,
  background:getComputedStyle(c).backgroundImage,overflow:c.scrollWidth>c.clientWidth,text:c.textContent})));
 if(rails.map(r=>r.color).join('|')!=='rgb(131, 149, 139)|rgb(244, 183, 64)|rgb(239, 68, 68)')throw Error('incorrect disconnected risk rails');
 if(!rails[2].background.includes('rgb(59, 39, 40)')||rails.slice(0,2).some(r=>r.background===rails[2].background))throw Error('emergency tint missing or applied to non-emergency');
 if(rails.some(r=>r.width!=='6px'||r.overflow))throw Error('card rail width or overflow');
 if(!rails[2].text.includes('EMERGENCY')||!rails[2].text.includes('DISCONNECTED'))throw Error('emergency lost on disconnect');
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('disconnected layout overflow');
 await page.screenshot({path:'ui-artifacts/personnel-disconnected-'+width+'.png',fullPage:true});
}
await page.locator('#presentationToggle').click();if(!await page.locator('body').evaluate(el=>el.classList.contains('presentation')))throw Error('presentation failed');if(await page.locator('#trainingActions').isVisible())throw Error('presentation shows buttons');if(!await page.locator('#trainingPanel').isVisible())throw Error('presentation must retain group status');await page.setViewportSize({width:390,height:844});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('presentation overflow');await page.route('**/api/login',r=>r.abort());await page.evaluate(async()=>{document.getElementById('token').value='test-only';await document.getElementById('login').onsubmit({preventDefault(){}});});if(await page.locator('#token').inputValue()!=='')throw Error('credential retained after network failure');
await page.route('**/api/logout',r=>r.abort());await page.evaluate(()=>document.getElementById('logout').onclick());if(await page.locator('#cards').innerHTML()!=='')throw Error('offline logout retained readings');if(await page.locator('#emergencyAlerts').isVisible())throw Error('offline logout retained alert');if(!await page.locator('#summary').textContent().then(t=>t.includes('session')))throw Error('offline revocation not explained');if(errors.length)throw Error(errors.join('\n'));console.log('PASS: 390px/1440px render, presentation toggle, no horizontal overflow, no script errors');await browser.close();})().catch(e=>{console.error(e);process.exit(1)});
