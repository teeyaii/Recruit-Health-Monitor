import {createHash, randomBytes, timingSafeEqual} from "node:crypto";

const WEEK_MS=7*24*60*60*1000;
const SESSION_MS=8*60*60*1000;
const sha=s=>createHash("sha256").update(s).digest("hex");
const safeSame=(a,b)=>typeof a==="string"&&typeof b==="string"&&
 /^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&
 timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));

// A single active operator-issued private URL. Only its SHA-256 digest is
// persisted inside the existing encrypted STEVE state; raw link is shown once.
// No commander request is authorized to use an operator or gateway endpoint.
export class CommanderAccess {
 constructor(){this.link=null;this.sessions=new Map();}
 export(){return this.link?{...this.link}:null;}
 load(value){
  if(value==null){this.link=null;this.sessions.clear();return;}
  if(!value||typeof value!=="object"||Array.isArray(value)||
   !/^[a-f0-9]{64}$/.test(value.hash)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<0)
   throw Error("Invalid encrypted commander link state");
  this.link={hash:value.hash,expiresAt:value.expiresAt};this.sessions.clear();
 }
 status(now=Date.now()){return {active:!!this.link&&this.link.expiresAt>now,expiresAt:this.link?.expiresAt??null};}
 issue(now=Date.now()){
  const token=randomBytes(32).toString("base64url");
  this.link={hash:sha(token),expiresAt:now+WEEK_MS};
  this.sessions.clear();return {token,expiresAt:this.link.expiresAt};
 }
 revoke(){this.link=null;this.sessions.clear();}
 authenticate(token,now=Date.now()){
  if(typeof token!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(token)||
   !this.link||this.link.expiresAt<=now||!safeSame(sha(token),this.link.hash))return null;
  for(const [key,record] of this.sessions)if(record.expiresAt<=now)this.sessions.delete(key);
  if(this.sessions.size>=256)return null;
  const key=randomBytes(32).toString("hex"),expiresAt=Math.min(this.link.expiresAt,now+SESSION_MS);
  this.sessions.set(key,{hash:this.link.hash,expiresAt});
  return {key,expiresAt};
 }
 authorized(cookie,now=Date.now()){
  if(!cookie||typeof cookie!=="string")return false;
  const record=this.sessions.get(cookie);
  if(!record)return false;
  if(record.expiresAt<=now||!this.link||this.link.expiresAt<=now||
   !safeSame(record.hash,this.link.hash)){this.sessions.delete(cookie);return false;}
  return true;
 }
 close(cookie){if(cookie)this.sessions.delete(cookie);}
}
