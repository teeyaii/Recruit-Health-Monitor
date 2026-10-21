import http from "node:http";
const url=process.env.MONITOR_URL||"http://127.0.0.1:8080";
const token=process.env.RECRUIT_MONITOR_TOKEN;
if(!token){console.error("Set RECRUIT_MONITOR_TOKEN");process.exit(1);}
const ids=Array.from({length:15},(_,i)=>"R"+String(i+1).padStart(2,"0"));
async function post(gateway,readings){
 const res=await fetch(url+"/api/ingest",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},body:JSON.stringify({gateway,readings})});
 if(!res.ok)throw Error(gateway+": "+res.status+" "+await res.text());
 return res.json();
}
for(let round=0;round<3;round++){
 const now=Date.now();
 const results=await Promise.all(Array.from({length:5},(_,i)=>post("G0"+(i+1),ids.slice(i*3,i*3+3).map((id,j)=>({id,hr:75+i*7+j+round,timestamp:now})))));
 console.log("round",round+1,results.map(x=>x.accepted));
 await new Promise(r=>setTimeout(r,1100));
}
const res=await fetch(url+"/api/snapshot",{headers:{"Authorization":"Bearer "+token}});
if(!res.ok)throw Error("Snapshot request failed: "+res.status);
const data=await res.json();
const fresh=data.recruits.filter(x=>!x.stale).length;
console.log("fresh slots",fresh,"/15");
if(fresh!==15)process.exitCode=1;
