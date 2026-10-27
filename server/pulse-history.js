// Bounded, volatile, pseudonymous 4-hour heart-rate history for the STEVE pilot.
// Data is not a medical record. One sample per slot per five seconds.
// Never invent points when the sensor is silent; always expire old samples.
export const WINDOW_MS=4*60*60*1000;
export const STEP_MS=5000;
export const MAX_POINTS=Math.ceil(WINDOW_MS/STEP_MS);
export const SLOT_IDS=Array.from({length:15},(_,i)=>"R"+String(i+1).padStart(2,"0"));

export class PulseHistory {
 constructor(){this.bySlot=new Map();}
 clear(slot){this.bySlot.delete(slot);}
 record(slot,hr,timestamp,now=Date.now()){
  if(!SLOT_IDS.includes(slot)||!Number.isInteger(hr)||hr<25||hr>240||
     !Number.isSafeInteger(timestamp)||timestamp>now+1000||timestamp<now-15000)return false;
  let points=this.bySlot.get(slot);
  if(!points){points=[];this.bySlot.set(slot,points);}
  const cutoff=now-WINDOW_MS;
  while(points.length&&points[0][0]<cutoff)points.shift();
  const last=points[points.length-1];
  if(last&&timestamp<=last[0])return false;
  // Bucket by actual timestamp; do not fabricate/interpolate measurements.
  if(last&&Math.floor(timestamp/STEP_MS)===Math.floor(last[0]/STEP_MS))return false;
  points.push([timestamp,hr]);
  if(points.length>MAX_POINTS)points.splice(0,points.length-MAX_POINTS);
  return true;
 }
 get(slot,now=Date.now()){
  const points=this.bySlot.get(slot);
  if(!points)return [];
  const cutoff=now-WINDOW_MS;
  while(points.length&&points[0][0]<cutoff)points.shift();
  if(!points.length){this.bySlot.delete(slot);return [];}
  return points.map(p=>p.slice());
 }
 size(){return [...this.bySlot.values()].reduce((sum,points)=>sum+points.length,0);}
}
