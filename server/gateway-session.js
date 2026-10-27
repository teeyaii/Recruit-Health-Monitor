import { randomBytes, createHash } from 'node:crypto';

export const GATEWAY_SESSION_MS=2*60*60*1000;
export const EXTENDED_GATEWAY_SESSION_MS=10*60*60*1000;
export const sessionDuration=gateway=>["G01","G02","G03"].includes(gateway)?EXTENDED_GATEWAY_SESSION_MS:GATEWAY_SESSION_MS;
const digest=value=>createHash('sha256').update(value).digest('hex');
export class GatewaySessions {
 constructor(){this.records=new Map();}
 key(req){return req.headers.cookie?.match(/(?:^|;\s*)steve_gateway=([a-f0-9]{64})(?:;|$)/)?.[1];}
 revoke(req){const key=this.key(req);if(key)this.records.delete(digest(key));}
 create(req,gateway,now=Date.now()){
  this.revoke(req);
  for(const [key,value] of this.records)if(value.expiry<=now)this.records.delete(key);
  if(this.records.size>=256)return null;
  const key=randomBytes(32).toString('hex');
  this.records.set(digest(key),{gateway,expiry:now+sessionDuration(gateway)});
  return key;
 }
 get(req,now=Date.now()){
  const key=this.key(req);if(!key)return null;
  const value=this.records.get(digest(key));
  if(!value||value.expiry<=now){this.revoke(req);return null;}
  return value;
 }
 cookie(key,gateway){
  const duration=key?sessionDuration(gateway||this.records.get(digest(key))?.gateway)/1000:0;
  return `steve_gateway=${key}; HttpOnly; SameSite=Strict; Path=/api/; Max-Age=${duration}${process.env.NODE_ENV==='production'||process.env.COOKIE_SECURE==='1'?'; Secure':''}`;
 }
}

// Require a custom same-origin request header for cookie authority, including GET.
// Foreign origins cannot supply it without a preflight, which we do not allow.
export function gatewayBrowserRequest(req){
 if(req.headers['x-steve-gateway']!=='1')return false;
 if(req.headers['sec-fetch-site']==='cross-site')return false;
 if(!req.headers.origin)return true;
 try{const origin=new URL(req.headers.origin);return origin.host===req.headers.host && (origin.protocol==='https:'||process.env.NODE_ENV!=='production');}catch{return false;}
}
