import {verifyC26GitHubOIDC} from './github-oidc.mjs';
/** Private, authenticated FinMind daily-source data cache for C26.
 * Never routes licensed full-market prices/chips to public static assets.
 * Stored only in existing Cloudflare SCAN_JOBS Durable Object storage.
 * Exact C26 trading plan remains BLOCKED and requires frozen engine parity.
 */
const LOCK='C26-EVENT-CORR-LOCK-20261112';
const POOL='2bbeada91a53d219a1f6815f84ac567db8182affca586537c199290d73c8c7fe';
const MAX_BYTES=12*1024*1024; // max gzip request bytes
// Owner credential fingerprint only. The token itself is supplied per request
// from this owner's browser and is never saved to Worker storage or source.
const OWNER_TOKEN_SHA256='f023cdf875ffd734ef213d2061ca11b03b78aa959d703444865a57f9759e61c7';
const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-c26-live-trading':'blocked'}});
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
async function sha256(bytes){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))}
function secureEqual(a,b){
 if(typeof a!=='string'||typeof b!=='string')return false;
 const aa=new TextEncoder().encode(a),bb=new TextEncoder().encode(b);
 let diff=aa.length^bb.length;
 for(let i=0;i<Math.max(aa.length,bb.length);i++)diff|=(aa[i]||0)^(bb[i]||0);
 return diff===0;
}
async function validateGzip(body){
 if(body.byteLength<50||body.byteLength>MAX_BYTES)throw Error('gzip bytes outside C26 size limits');
 let raw;
 try{raw=await new Response(new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip'))).text()}catch{throw Error('C26 invalid gzip or truncated input')}
 if(raw.length>70*1024*1024)throw Error('uncompressed C26 data too large');
 let parsed;
 try{parsed=JSON.parse(raw)}catch{throw Error('invalid C26 source JSON')}
 if(parsed.lock_id!==LOCK||parsed.pool_sha256!==POOL||!parsed.days||typeof parsed.days!=='object')throw Error('C26 source lock/pool mismatch');
 const dates=Object.keys(parsed.days).sort();
 if(parsed.source!=='FinMind private Actions secret')throw Error('C26 source marker unexpected');
 if(dates.length<1||dates.length>550||dates.some(x=>!/^20\d\d-\d\d-\d\d$/.test(x)||x<'2026-10-16'))throw Error('C26 source dates invalid');
 const latest=dates.filter(d=>d>='2026-10-28'&&parsed.days[d]?.source_state==='available').at(-1)||null;
 const valid=dates.filter(d=>d>='2026-10-28'&&parsed.days[d]?.source_state==='available').length;
 if(!latest)throw Error('No post-freeze valid source data');
 for(const d of dates){const v=parsed.days[d];if(!v||!Array.isArray(v.price)||v.price.length>233||!Array.isArray(v.institutional)||!Array.isArray(v.source_errors)||typeof v.price_valid!=='number')throw Error('C26 source schema incomplete '+d)}
 return {lock_id:LOCK,pool_sha256:POOL,source_as_of:latest,available_days:valid,staged_days:dates.filter(d=>d>='2026-10-28').length,first_date:dates[0],last_date:dates.at(-1),size_bytes:body.byteLength,sha256:await sha256(body),generated_at:parsed.generated_at||null,stored_at:new Date().toISOString(),model_ready:false};
}
export async function c26PrivateFeedRoute(request,env){
 const path=new URL(request.url).pathname;
 const m=/^\/api\/c26\/private-feed(?:\/(status|finmind))?$/.exec(path);
 if(!m)return json({error:'Not found'},404);
 const allowed=new Set(m[1]==='finmind'?['POST']:m[1]?['GET']:['GET','POST']);
 if(!allowed.has(request.method))return json({error:'Method not allowed'},405);
 // GitHub Actions OIDC is scoped to ONE workflow and branch and verified
 // against GitHub JWKS. This avoids copying a licensed FinMind token into
 // Cloudflare Worker environment variables. Legacy Worker secret auth remains
 // available for previously provisioned deployments.
 const key=env?.FINMIND_TOKEN;
 const secretReady=typeof key==='string'&&key.length>=30;
 const header=request.headers.get('authorization')||'';
 const bearer=header.startsWith('Bearer ')?header.slice(7).trim():'';
 const secretValid=secretReady&&secureEqual(bearer,key);
 const deviceValid=bearer.length>=30&&secureEqual(await sha256(new TextEncoder().encode(bearer)),OWNER_TOKEN_SHA256);
 const oidcValid=!secretValid&&!deviceValid&&bearer.split('.').length===3?await verifyC26GitHubOIDC(bearer):false;
 if(!secretValid&&!deviceValid&&!oidcValid)return json({error:!secretReady&&bearer.split('.').length!==3?
   'C26 private authentication unavailable':'Not authorized'},!secretReady&&bearer.split('.').length!==3?503:401);
 if(m[1]==='finmind'){
  // OIDC credentials authorize storage only and must never be sent to FinMind.
  if(!deviceValid&&!secretValid)return json({error:'FinMind user credential required'},403);
  let query;try{query=await request.json()}catch{return json({error:'Invalid request'},400)}
  const datasets=new Set(['TaiwanStockTradingDate','TaiwanStockPrice','TaiwanStockInstitutionalInvestorsBuySell','TaiwanStockMarginPurchaseShortSale','TaiwanStockSecuritiesLending']);
  if(!datasets.has(query.dataset))return json({error:'Unsupported dataset'},400);
  const q=new URLSearchParams({dataset:query.dataset});
  if(query.dataset!=='TaiwanStockTradingDate'){
   const clock=new Date(Date.now()+8*3600000).toISOString();
   const cutoff=clock.slice(11,16)>='20:00'?clock.slice(0,10):new Date(Date.parse(clock.slice(0,10)) - 86400000).toISOString().slice(0,10);
   if(!/^20\d\d-\d\d-\d\d$/.test(query.date||'')||query.date<'2026-10-16'||query.date>cutoff)return json({error:'Only completed source dates are allowed'},400);
   q.set('start_date',query.date);q.set('end_date',query.date);
  }
  let upstream;try{upstream=await fetch('https://api.finmindtrade.com/api/v4/data?'+q,{headers:{Authorization:'Bearer '+bearer},signal:AbortSignal.timeout(28000),cache:'no-store'})}catch{return json({error:'FinMind connection failed; retry later'},502)}
  if(!upstream.ok)return json({error:'FinMind HTTP '+upstream.status},502);
  let data;try{data=await upstream.json()}catch{return json({error:'Invalid FinMind response'},502)}
  if(data.status!==200||!Array.isArray(data.data))return json({error:'FinMind rejected request',upstream_status:data.status},502);
  return json({status:200,data:data.data});
 }
 if(!env.SCAN_JOBS)return json({error:'C26 private DO unavailable'},503);
 const stub=env.SCAN_JOBS.get(env.SCAN_JOBS.idFromName('system:c26:licensed-eod:v1'));
 if(request.method==='GET'){
  const status=m[1]==='status';
  const r=await stub.fetch(new Request('https://c26-private.local/c26-internal/'+(status?'status':'download')));
  return new Response(r.body,{status:r.status,headers:{'content-type':r.headers.get('content-type')||'application/octet-stream','cache-control':'no-store','x-c26-live-trading':'blocked'}});
 }
 const incoming=Number(request.headers.get('content-length')||0);
 if(incoming>MAX_BYTES)return json({error:'C26 private payload too large'},413);
 const bytes=new Uint8Array(await request.arrayBuffer());
 let meta;
 try{meta=await validateGzip(bytes)}catch(e){return json({error:String(e.message||e)},422)}
 const r=await stub.fetch(new Request('https://c26-private.local/c26-internal/upload',{method:'POST',headers:{'content-type':'application/gzip','x-c26-source-metadata':JSON.stringify(meta)},body:bytes}));
 if(!r.ok)return json({error:'C26 private persistence rejected',status:r.status},r.status);
 return json({...meta,stored:true,raw_public:false,trading_plan:'BLOCKED'},201);
}

/** Direct Durable Object handler. Private routes only accessible from Worker code. */
export class C26PrivateStore {
 constructor(ctx){this.ctx=ctx}
 async fetch(request){
  const path=new URL(request.url).pathname;
  if(path==='/c26-internal/upload'&&request.method==='POST'){
   let meta;try{meta=JSON.parse(request.headers.get('x-c26-source-metadata')||'null')}catch{return json({error:'Invalid metadata'},422)}
   if(meta?.lock_id!==LOCK||meta.pool_sha256!==POOL||!/^2026-\d\d-\d\d$/.test(meta.source_as_of))return json({error:'Mismatched C26 source metadata'},422);
   const body=new Uint8Array(await request.arrayBuffer());
   if(body.length!==meta.size_bytes||body.length>MAX_BYTES||hex(new Uint8Array(await crypto.subtle.digest('SHA-256',body)))!==meta.sha256)return json({error:'C26 source integrity failure'},422);
   const old=await this.ctx.storage.get('c26:private:latest_meta');
   if(old?.source_as_of>meta.source_as_of)return json({error:'Refusing C26 source timestamp rollback'},409);
   const id=crypto.randomUUID(),chunks=[];const size=90000;
   for(let k=0;k<body.length;k+=size)chunks.push(body.slice(k,k+size));
   await this.ctx.storage.transaction(async tx=>{
    for(let k=0;k<chunks.length;k++)await tx.put('c26:private:'+id+':'+k,chunks[k]);
    await tx.put('c26:private:latest_meta',{...meta,id,chunks:chunks.length});
    if(old?.id){for(let k=0;k<(old.chunks||0);k++)await tx.delete('c26:private:'+old.id+':'+k)}
   });
   return json({stored:true,source_as_of:meta.source_as_of,available_days:meta.available_days,raw_public:false},201);
  }
  if(path==='/c26-internal/status'&&request.method==='GET'){
   const meta=await this.ctx.storage.get('c26:private:latest_meta');
   if(!meta)return json({exists:false,model_ready:false},404);
   const {id,chunks,...safe}=meta;
   return json({...safe,exists:true,model_ready:false,raw_public:false},200);
  }
  if(path==='/c26-internal/download'&&request.method==='GET'){
   const meta=await this.ctx.storage.get('c26:private:latest_meta');if(!meta)return json({error:'No private C26 source data'},404);
   const parts=await this.ctx.storage.get(Array.from({length:meta.chunks},(_,k)=>'c26:private:'+meta.id+':'+k));
   const body=new Uint8Array(meta.size_bytes);let offset=0;
   for(let k=0;k<meta.chunks;k++){
    const v=parts.get('c26:private:'+meta.id+':'+k);
    if(!(v instanceof Uint8Array))return json({error:'C26 private chunk incomplete'},503);
    body.set(v,offset);offset+=v.length;
   }
   if(offset!==meta.size_bytes||await sha256(body)!==meta.sha256)return json({error:'C26 private checksum mismatch'},503);
   return new Response(body,{headers:{'content-type':'application/gzip','cache-control':'no-store','x-c26-live-trading':'blocked'}});
  }
  return json({error:'C26 internal route missing'},404);
 }
}
