import {createCipheriv,createDecipheriv,randomBytes} from "node:crypto";
import {gzipSync,gunzipSync} from "node:zlib";

// Optional externally durable state. Secrets must be provisioned inside Render,
// never entered in browser or checked into this repository.
const TABLE="steve_secure_state";
const ROW="primary";
const LIMIT_BYTES=8*1024*1024;
export class DurableState {
 constructor(env=process.env,fetcher=fetch){
  const fields=["STEVE_SUPABASE_URL","STEVE_SUPABASE_SERVICE_ROLE_KEY","STEVE_DATA_ENCRYPTION_KEY"];
  const present=fields.filter(key=>!!env[key]);
  if(present.length!==0&&present.length!==fields.length)throw Error("Durable state configuration incomplete: require all three Supabase settings");
  this.enabled=present.length===fields.length;
  this.lastReadAt=null;this.lastWriteAt=null;this.lastOperationFailed=false;
  this.fetcher=fetcher;
  if(!this.enabled)return;
  const parsed=new URL(env.STEVE_SUPABASE_URL);
  if(parsed.protocol!=="https:"||!parsed.hostname.endsWith(".supabase.co")||parsed.username||parsed.password||parsed.search||parsed.hash)
   throw Error("STEVE_SUPABASE_URL must be an HTTPS Supabase project URL");
  this.endpoint=parsed.origin+"/rest/v1/"+TABLE;
  this.token=env.STEVE_SUPABASE_SERVICE_ROLE_KEY;
  if(this.token.length<32)throw Error("Invalid Supabase service role credential");
  if(this.token.startsWith("sb_publishable_"))throw Error("Backend storage requires a secret service credential");
  if(this.token.split(".").length===3){
   let claims;try{claims=JSON.parse(Buffer.from(this.token.split(".")[1],"base64url").toString("utf8"));}catch{}
   if(claims?.role!=="service_role")throw Error("Backend storage requires a service_role credential");
  }
  const value=env.STEVE_DATA_ENCRYPTION_KEY;
  this.key=Buffer.from(value,"base64");
  if(this.key.length!==32||this.key.toString("base64").replace(/=+$/,"")!==value.replace(/=+$/,""))
   throw Error("STEVE_DATA_ENCRYPTION_KEY must be 32 random bytes encoded as base64");
 }
 encrypt(data){
  const clear=gzipSync(Buffer.from(JSON.stringify(data),"utf8"));
  if(clear.length>LIMIT_BYTES)throw Error("Durable data exceeds configured limit");
  const nonce=randomBytes(12),cipher=createCipheriv("aes-256-gcm",this.key,nonce);
  const encrypted=Buffer.concat([cipher.update(clear),cipher.final()]);
  return JSON.stringify({v:1,n:nonce.toString("base64"),t:cipher.getAuthTag().toString("base64"),c:encrypted.toString("base64")});
 }
 decrypt(raw){
  const e=JSON.parse(raw);
  if(e?.v!==1||!e.n||!e.t||!e.c)throw Error("Unknown durable data envelope");
  const decoder=createDecipheriv("aes-256-gcm",this.key,Buffer.from(e.n,"base64"));
  decoder.setAuthTag(Buffer.from(e.t,"base64"));
  const clear=Buffer.concat([decoder.update(Buffer.from(e.c,"base64")),decoder.final()]);
  if(clear.length>LIMIT_BYTES)throw Error("Encrypted state exceeds size limit");
  const bytes=gunzipSync(clear,{maxOutputLength:LIMIT_BYTES});
  const data=JSON.parse(bytes.toString("utf8"));
  if(data?.schema!==1||typeof data!=="object")throw Error("Invalid STEVE durable state schema");
  return data;
 }
 status(){
  return {configured:this.enabled,lastReadAt:this.lastReadAt,lastWriteAt:this.lastWriteAt,
   state:!this.enabled?"disabled":this.lastOperationFailed?"unavailable":this.lastWriteAt?"write-confirmed":this.lastReadAt?"read-confirmed":"unverified"};
 }
 async request(url,options,consume=response=>response){
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
  try{
   // New sb_secret_ keys are opaque API keys, NOT JWTs. Sending them as
   // Authorization: Bearer makes PostgREST try to parse an invalid JWT.
   // Legacy service_role JWT credentials still require Bearer authentication.
   const headers={
    "apikey":this.token,
    ...(this.token.startsWith("sb_secret_")?{}:{"Authorization":"Bearer "+this.token}),
    "Accept":"application/json",...(options?.headers||{})
   };
   const response=await this.fetcher(url,{...options,signal:controller.signal,headers,redirect:"error"});
   if(!response.ok)throw Error("Durable storage request failed: HTTP "+response.status);
   return await consume(response);
  }finally{clearTimeout(timeout);}
 }
 async load(){
  if(!this.enabled)return null;
  try{
  const rows=await this.request(this.endpoint+"?id=eq."+ROW+"&select=envelope",{method:"GET"},response=>response.json());
  if(!Array.isArray(rows)||rows.length>1)throw Error("Malformed durable storage response");
  const data=rows.length?this.decrypt(rows[0].envelope):null;
  this.lastReadAt=new Date().toISOString();this.lastOperationFailed=false;
  return data;
  }catch(error){this.lastOperationFailed=true;throw error;}
 }
 async save(state){
  if(!this.enabled)throw Error("Durable storage is not configured");
  try{
  const envelope=this.encrypt(state);
  await this.request(this.endpoint,{
   method:"POST",headers:{"Content-Type":"application/json","Prefer":"resolution=merge-duplicates,return=minimal"},
   body:JSON.stringify({id:ROW,envelope})
  });
  this.lastWriteAt=new Date().toISOString();this.lastOperationFailed=false;
  }catch(error){this.lastOperationFailed=true;throw error;}
 }
}
