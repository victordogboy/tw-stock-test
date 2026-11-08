import {initShared,sync1494,load1494,cutoff,nextDate,nextSession1494} from './shared.mjs';
import {contextFc23,ingestFc23Technical} from './features.mjs';
import {advanceFc23,planFc23} from './engine.mjs';
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
// Preserve arbitrary R2-like keys in the existing Durable Object namespace, atomically chunked.
export class ObjectBucket {
 constructor(storage){this.storage=storage}
 async get(key){const meta=await this.storage.get('blob:'+key);if(!meta)return null;const parts=await this.storage.get(meta.parts.map((_,i)=>meta.id+':'+i));const bytes=new Uint8Array(meta.length);let n=0;for(let i=0;i<meta.parts.length;i++){const part=parts.get(meta.id+':'+i);if(!part)throw Error('資料分塊缺漏');bytes.set(part,n);n+=part.length}const text=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();return {etag:meta.id,text:async()=>text,json:async()=>JSON.parse(text)}}
 async put(key,text,{onlyIf}={}){const old=await this.storage.get('blob:'+key);if(onlyIf?.etagMatches&&old?.id!==onlyIf.etagMatches||onlyIf?.etagDoesNotMatch==='*'&&old)return null;const compressed=new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()),id=crypto.randomUUID(),values={};for(let i=0;i<compressed.length;i+=90000)values[id+':'+i/90000]=compressed.slice(i,i+90000);const meta={id,length:compressed.length,parts:Object.keys(values)};await this.storage.transaction(async txn=>{await txn.put(values);await txn.put('blob:'+key,meta);if(old)await txn.delete(old.parts)});return {etag:id}}
}
async function asset(env,path,compressed=false){const r=await env.ASSETS.fetch(new Request('https://assets.internal/r1494a/fc23/'+path));if(!r.ok)throw Error('FC23原始狀態載入失敗 '+path);if(!compressed)return r.json();const bytes=Uint8Array.from(atob((await r.text()).trim()),c=>c.charCodeAt(0));return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json()}
export class Fc23Service {
 constructor(ctx,env){this.ctx=ctx;this.env=env;this.pending=null;this.bucket=new ObjectBucket(ctx.storage)}
 async setup(){if(!this.seed){const [seed,supplement]=await Promise.all([asset(this.env,'shared-seed.b64',true),asset(this.env,'supplement.b64',true)]);this.seed=seed;this.supplement=supplement;}
   if(!this.bootstrapCheckedAt||Date.now()-this.bootstrapCheckedAt>60000){this.bootstrapCheckedAt=Date.now();try{const bootstrap=await asset(this.env,'live-bootstrap.b64',true),stored=await this.bucket.get('r1494-a/state-v1.json');if(!stored||(await stored.json()).date<bootstrap.shared.date){await this.bucket.put('r1494-a/state-v1.json',JSON.stringify(bootstrap.shared));await this.bucket.put('fc23/bundle',JSON.stringify({account:bootstrap.account,delta:bootstrap.delta}))}}catch{}
  }initShared(this.seed,this.supplement,{context:contextFc23,ingest:ingestFc23Technical});return {...this.env,BUCKET:this.bucket}}
 async state(){const obj=await this.bucket.get('fc23/bundle');return obj?(await obj.json()).account:asset(this.env,'account-seed.json')}
 async delta(){const d=await this.bucket.get('fc23/bundle');return d?(await d.json()).delta:{snapshots:[],orders:[],planHistory:{},data_as_of:'2026-10-27',sync_status:'pending',lastError:null}}
 async progress(value){await this.ctx.storage.put('fc23-progress',{...value,updated_at:new Date().toISOString()})}
 async run(){
  let delta=await this.delta();
  try{
   await this.progress({state:'running',phase:'正在抓取官方日線、三大法人與融資券',data_as_of:delta.data_as_of});
   const env=await this.setup();delta=await this.delta();let report;
   for(let pass=0;pass<4;pass++){
    report=await sync1494(env,{maxDays:7});await this.progress({state:'running',phase:'共用行情已補至 '+report.to+'；正在接續 FC23 原規則',data_as_of:delta.data_as_of,market_as_of:report.to});
    if(report.lastError||!report.more)break;
   }
   const {st:shared}=await load1494(env),account=await this.state();
   let cursor=account.date;
   while(cursor<shared.date){const date=nextDate(cursor);cursor=date;if([0,6].includes(new Date(date+'T00:00:00Z').getUTCDay()))continue;const dayObj=await this.bucket.get('r1494-a/daily/'+date+'.json');if(!dayObj)continue;const day=await dayObj.json();if(day.closed)continue;
    const ctxObj=await this.bucket.get('fc23/context/'+account.date+'.json');if(!ctxObj)throw Error('缺少 '+account.date+' 原始FC23特徵狀態');const context=await ctxObj.json();
    delta.planHistory[account.date]=planFc23(account,context,date);
    const rows=new Map(day.rows.map(r=>[r.code,r])),mapped=account.codes.map((code,j)=>{const r=rows.get(code);const valid=!!r&&[r.open,r.high,r.low,r.close].every(v=>Number.isFinite(v)&&v>0)&&r.low<=Math.min(r.open,r.close)&&r.high>=Math.max(r.open,r.close),one=valid&&r.open===r.high&&r.high===r.low&&r.low===r.close;return {...r,code,valid,executable:valid&&r.volume>0,mark:r?.close>0?Math.fround(r.close):context.F[j].p,lockUp:one&&r.close/context.F[j].p>1.08,lockDown:one&&r.close/context.F[j].p<.92}});
    const result=advanceFc23(account,{date,rows:mapped},context);result.snapshot.dataGaps=day.suspensions||[];delta.snapshots.push(result.snapshot);delta.orders.push(...result.events);
   }
   // Own latest signal, own positions and own NAV; never reuse R1494's orders.
   const context=contextFc23(shared),plan=planFc23(account,context,nextSession1494(account.date));
   const complete=account.date===shared.date&&!shared.lastError&&shared.lastChecked>=cutoff();
   plan.readiness=complete?'ready':'blocked';plan.blockedReason=complete?null:shared.lastError?.message||'連續交易日資料尚未補齊';
   Object.assign(delta,{model_version:'FC23',data_as_of:account.date,signal_as_of:account.date,checkedThrough:shared.lastChecked,market_as_of:shared.date,price_updated_at:new Date().toISOString(),sync_status:complete?'current':'blocked',lastError:shared.lastError||null,plan,sources:shared.lastSources||[],revision:(delta.revision||0)+1});
   await this.bucket.put('fc23/bundle',JSON.stringify({account,delta}));await this.progress({state:complete?'current':'blocked',phase:complete?'FC23 已更新至最新完整交易日':plan.blockedReason,data_as_of:account.date,market_as_of:shared.date});
  }catch(error){const message=String(error.message||error);delta.sync_status='blocked';delta.lastError={message,at:new Date().toISOString()};await this.progress({state:'blocked',phase:message,data_as_of:delta.data_as_of})}
 }
 async fetch(request){const url=new URL(request.url);if(url.pathname.endsWith('/refresh')){if(!['POST','GET'].includes(request.method))return json({error:'Method not allowed'},405);if(!this.pending){this.pending=this.run().finally(()=>{this.pending=null});this.ctx.waitUntil(this.pending)}return json({state:'running',progress:await this.ctx.storage.get('fc23-progress')||null},202)}
  return json({...(await this.delta()),progress:await this.ctx.storage.get('fc23-progress')||null,running:!!this.pending});
 }
}
export function fc23Stub(env){return env.SCAN_JOBS.get(env.SCAN_JOBS.idFromName('system:fc23:original:v1'))}
export function fc23Route(request,env){const path=new URL(request.url).pathname;if(!['/api/fc23/snapshot','/api/fc23/refresh'].includes(path))return json({error:'Not found'},404);return fc23Stub(env).fetch(new Request('https://fc23.internal'+path.replace('/api/fc23','/fc23'),request))}
