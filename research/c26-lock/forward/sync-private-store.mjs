/** Persist/recover licensed C26 FinMind daily source in Cloudflare private DO.
 * No raw feed in repository or static assets. GitHub's short-lived OIDC identity
 * authorizes only the c26-forward-eod.yml workflow without duplicating the
 * FINMIND_TOKEN in Cloudflare. Never log either credential.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const mode=process.argv[2];
if(!['restore','publish','status'].includes(mode))throw Error('Usage: node sync-private-store.mjs restore|publish|status');
const oidcUrl=process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
const oidcAccessToken=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
if(!oidcUrl||!oidcAccessToken)throw Error('GitHub Actions OIDC permission unavailable for private C26 source sync');
const OIDC_AUDIENCE='https://tw-stock-api.victordogboy.workers.dev/api/c26/private-feed';
async function requestOidc(){
 const url=new URL(oidcUrl);url.searchParams.set('audience',OIDC_AUDIENCE);
 const res=await fetch(url,{headers:{authorization:'Bearer '+oidcAccessToken},
  signal:AbortSignal.timeout(15000),cache:'no-store'});
 if(!res.ok)throw Error('GitHub OIDC issuance failed HTTP '+res.status);
 const payload=await res.json();
 if(typeof payload?.value!=='string'||payload.value.split('.').length!==3)
  throw Error('GitHub OIDC JWT unavailable');
 return payload.value;
}
const token=await requestOidc();
const root=process.cwd();
const rawpath=path.join(root,'.c26-private/forward-eod.json.gz');
const endpoint='https://tw-stock-api.victordogboy.workers.dev/api/c26/private-feed';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const locked='C26-EVENT-CORR-LOCK-20261112';
const pool='2bbeada91a53d219a1f6815f84ac567db8182affca586537c199290d73c8c7fe';
function check(bytes){
 if(bytes.length<50||bytes.length>12*1024*1024)throw Error('C26 private source size outside limits');
 const a=JSON.parse(gunzipSync(bytes).toString('utf8'));
 if(a.lock_id!==locked||a.pool_sha256!==pool||!a.days)throw Error('C26 private source lock mismatch');
 const dates=Object.keys(a.days).sort();
 if(!dates.some(d=>d>='2026-10-28'))throw Error('C26 source does not include forward days');
 return {sha256:sha(bytes),date:dates.at(-1),n_dates:dates.length,bytes:bytes.length};
}
async function call(method,body=undefined){
 let response;
 for(let attempt=1;attempt<=8;attempt++){
  response=await fetch(endpoint+(mode==='status'?'/status':''),{
   method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/gzip'}:{})},
   body,signal:AbortSignal.timeout(55000),cache:'no-store'
  });
  if(![502,503,504].includes(response.status)||attempt===8)break;
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
 return response;
}
if(mode==='restore'){
 const r=await call('GET');
 if(r.status===404){console.log('C26_PRIVATE_RESTORE_INITIAL_SEED_REQUIRED');process.exit(0)}
 if(!r.ok)throw Error('C26 private restore failed HTTP '+r.status);
 const bytes=Buffer.from(await r.arrayBuffer());
 const a=check(bytes);fs.mkdirSync(path.dirname(rawpath),{recursive:true,mode:0o700});
 fs.writeFileSync(rawpath,bytes,{mode:0o600});
 console.log('C26_PRIVATE_SOURCE_RESTORED',JSON.stringify(a));
}else if(mode==='publish'){
 const bytes=fs.readFileSync(rawpath);const a=check(bytes);
 const r=await call('POST',bytes);
 if(!r.ok)throw Error('C26 private publish failed HTTP '+r.status);
 const ack=await r.json();
 if(ack.stored!==true||ack.sha256!==a.sha256||ack.source_as_of<a.date)throw Error('C26 private store acknowledgement mismatch');
 const statusPath=path.join(root,'public/r1494a/c26/data/forward-status.json');
 const status=JSON.parse(fs.readFileSync(statusPath,'utf8'));
 if(status.sha256_gzip!==a.sha256)throw Error('Coverage report refers to different private data');
 status.raw_storage='Cloudflare private Durable Object';
 status.private_storage_verified=true;
 status.private_storage_as_of=ack.source_as_of;
 fs.writeFileSync(statusPath,JSON.stringify(status,null,2)+'\n');
 console.log('C26_PRIVATE_SOURCE_PERSISTED',JSON.stringify({source_as_of:ack.source_as_of,n_dates:a.n_dates,bytes:a.bytes,raw_public:false,live_plan:'BLOCKED'}));
}else{
 const r=await call('GET');
 if(!r.ok)throw Error('C26 private store status failed HTTP '+r.status);
 const v=await r.json();console.log('C26_PRIVATE_SOURCE_STATUS',JSON.stringify({exists:v.exists,source_as_of:v.source_as_of,available_days:v.available_days,raw_public:v.raw_public,model_ready:v.model_ready}));
}
