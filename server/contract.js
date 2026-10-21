import { timingSafeEqual } from "node:crypto";

// All secrets and device assignments are provided at runtime, never checked into Git.
const env=process.env;
// Render Blueprint supports a generated secret for each G01–G05 without a JSON secret bundle.
// Existing STEVE_GATEWAY_TOKENS_JSON deployments continue to work unchanged.
const separateTokenEntries=Array.from({length:5},(_,i)=>{
  const id="G0"+(i+1);
  return [id,env["STEVE_GATEWAY_TOKEN_"+id]];
}).filter(([,token])=>token!==undefined && token!=="");
const separateTokens=Object.fromEntries(separateTokenEntries);
const usesSeparateTokens=separateTokenEntries.length>0;
if(usesSeparateTokens && env.STEVE_GATEWAY_TOKENS_JSON)
  throw Error("Configure either STEVE_GATEWAY_TOKENS_JSON or individual gateway tokens, not both");
export const strictMode=Boolean(env.STEVE_GATEWAY_TOKENS_JSON || env.STEVE_VIEWER_TOKEN || usesSeparateTokens);
function parseObject(value, name) {
  let parsed;
  try { parsed=JSON.parse(value); } catch { throw Error(name+" must contain valid JSON"); }
  if (!parsed || Array.isArray(parsed) || typeof parsed!=="object") throw Error(name+" must be a JSON object");
  return parsed;
}
function secureEquals(a,b) {
  if (typeof a!=="string" || typeof b!=="string") return false;
  const x=Buffer.from(a), y=Buffer.from(b);
  return x.length===y.length && timingSafeEqual(x,y);
}
const gatewayTokens=new Map();
let viewerToken;
if (strictMode) {
  viewerToken=env.STEVE_VIEWER_TOKEN;
  if (!viewerToken || viewerToken.length<32 || (!env.STEVE_GATEWAY_TOKENS_JSON && !usesSeparateTokens))
    throw Error("Strict mode requires STEVE_VIEWER_TOKEN (32+ chars) and gateway credentials");
  const tokens=usesSeparateTokens ? separateTokens : parseObject(env.STEVE_GATEWAY_TOKENS_JSON,"STEVE_GATEWAY_TOKENS_JSON");
  if (Object.keys(tokens).length===0) throw Error("Configure at least one gateway");
  const all=new Set([viewerToken]);
  for (const [id, token] of Object.entries(tokens)) {
    if (!/^G0[1-5]$/.test(id) || typeof token!=="string" || token.length<32 || all.has(token))
      throw Error("Invalid or repeated gateway credential for "+id);
    gatewayTokens.set(id,token);
    all.add(token);
  }
} else {
  viewerToken=env.RECRUIT_MONITOR_TOKEN;
  if (!viewerToken || viewerToken.length<24) throw Error("Set RECRUIT_MONITOR_TOKEN for isolated development");
  if (env.NODE_ENV==="production") throw Error("Production deployment requires separate viewer and gateway credentials");
}
if (env.NODE_ENV==="production" && env.COOKIE_SECURE!=="1")
  throw Error("Production requires COOKIE_SECURE=1 and TLS termination");
export function validViewerToken(value) {return secureEquals(value,viewerToken);}
export function gatewayForBearer(req) {
  const raw=req.headers.authorization || "";
  if (!raw.startsWith("Bearer ")) return null;
  const provided=raw.slice(7);
  if (!provided || provided.includes(" ")) return null;
  if (!strictMode) return secureEquals(provided,viewerToken) ? "LEGACY" : null;
  let match=null;
  for (const [id,token] of gatewayTokens) if (secureEquals(provided,token)) match=id;
  return match;
}

// Optional explicit provisioning contract. When present it is fail-closed:
// unassigned R-slots, device-ID mismatches and cross-gateway handoffs are rejected.
let assignments=null;
if (env.STEVE_SLOT_MAP_JSON) {
  const supplied=parseObject(env.STEVE_SLOT_MAP_JSON,"STEVE_SLOT_MAP_JSON");
  const seenSlots=new Set(), seenDevices=new Set();
  assignments=new Map();
  for (const [gateway, slots] of Object.entries(supplied)) {
    if (!/^G0[1-5]$/.test(gateway) || !slots || Array.isArray(slots) || typeof slots!=="object")
      throw Error("Invalid gateway in STEVE_SLOT_MAP_JSON");
    if (strictMode && !gatewayTokens.has(gateway)) throw Error("Provisioned gateway has no credential: "+gateway);
    const assigned=new Map();
    for (const [slot, device] of Object.entries(slots)) {
      if (!/^R(0[1-9]|1[0-5])$/.test(slot) || typeof device!=="string" || !/^[a-zA-Z0-9_-]{4,64}$/.test(device)
          || seenSlots.has(slot) || seenDevices.has(device)) throw Error("Duplicate/invalid slot or device assignment");
      seenSlots.add(slot); seenDevices.add(device); assigned.set(slot,device);
    }
    assignments.set(gateway,assigned);
  }
}
if (strictMode && !assignments) throw Error("Strict mode requires STEVE_SLOT_MAP_JSON");
export function slotIsAuthorized(gateway, item) {
  if (!assignments) return true; // synthetic-only, not fit for live operational use
  return assignments.get(gateway)?.get(item.id)===item.device_id;
}
export function provisionedSlots(gateway) {
  return assignments ? Array.from(assignments.get(gateway)?.keys()||[]) : null;
}
export function provisionedGateway(slot) {
  if (assignments) for (const [gateway, slots] of assignments) if (slots.has(slot)) return gateway;
  return null;
}

