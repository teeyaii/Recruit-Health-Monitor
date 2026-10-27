export const BATTERY_TTL_MS=15*60*1000;
// Optional metadata: discard bad battery fields without rejecting valid HR.
export function freshBattery(b,now=Date.now()){
 if(!b||!Number.isInteger(b.percent)||b.percent<0||b.percent>100||
    !Number.isSafeInteger(b.timestamp)||b.timestamp>now||now-b.timestamp>BATTERY_TTL_MS)return null;
 return {percent:b.percent,timestamp:b.timestamp};
}
