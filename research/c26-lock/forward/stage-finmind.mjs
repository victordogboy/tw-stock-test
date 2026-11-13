/** C26 forward EOD ingestion; source audit only, never creates trade signals.
 * Uses private FINMIND_TOKEN on GitHub Actions. Never prints, persists or embeds token.
 * No data_id means full-market only when FinMind subscription permits it.
 */
import fs from 'node:fs';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import crypto from 'node:crypto';
const root=process.cwd();
const refs=JSON.parse(fs.readFileSync(path.join(root,'research/c26-lock/forward/archive-feature-reference.json'),'utf8'));
const pool=refs.codes;const poolSet=new Set(pool);
// Immutable forward boundary: original C26 portfolio's last five held closes
// must agree with independently ingested FinMind raw daily close.
const checkpoint=JSON.parse(fs.readFileSync(path.join(root,'research/c26-lock/forward/model_checkpoint_20261027.json'),'utf8'));
if(checkpoint.date!=='2026-10-27'||Object.keys(checkpoint.mark_close_by_code).length!==5)throw Error('C26 checkpoint boundary invalid');
function checkBoundary(day){
 const marks=checkpoint.mark_close_by_code;
 const map=new Map((day?.price||[]).map(r=>[r.stock_id,r]));
 const rows=Object.entries(marks).map(([code,original])=>{
   const current=map.get(code)?.close;
   const difference=Number.isFinite(current)?Math.abs(current-original):null;
   const ok=difference!==null&&difference<=Math.max(0.0005,Math.abs(original)*1e-6);
   return {code,match:ok,abs_difference:difference};
 });
 return {date:checkpoint.date,matched:rows.filter(x=>x.match).length,total:rows.length,pass:rows.every(x=>x.match),rows};
}
const basename=path.join(root,'public/r1494a/c26/data');
// FinMind forbids redistribution of raw subscription data. Keep EOD only in this private job workspace.
const outPath=path.join(root,'.c26-private/forward-eod.json.gz');
const statusPath=path.join(basename,'forward-status.json');
const token=process.env.FINMIND_TOKEN?.trim();
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const dateYmd=ms=>new Date(ms+8*3600000).toISOString().slice(0,10);
const addDate=(d,days)=>new Date(Date.parse(d+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const now=new Date();const tpeClock=new Date(Date.now()+8*3600000).toISOString();
// Institutionals typically publish after exchange close; do not treat a partial current day as final.
const to=tpeClock.slice(11,16)>='20:00'?tpeClock.slice(0,10):addDate(tpeClock.slice(0,10),-1);
const baseSince='2026-10-16';const inputSince=process.argv.find(x=>x.startsWith('--since='))?.slice(8)||baseSince;
const endAt=process.argv.find(x=>x.startsWith('--through='))?.slice(10)||to;
if(!/^2026-\d\d-\d\d$/.test(inputSince)||!/^2026-\d\d-\d\d$/.test(endAt)||endAt<baseSince||endAt>to){throw Error('Invalid C26 date boundary; cannot ingest future or unclosed data')}
if(!token)throw Error('FINMIND_TOKEN secret missing; no credentials logged');
const DAY=86400000;const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
const DATASETS={price:'TaiwanStockPrice',institutional:'TaiwanStockInstitutionalInvestorsBuySell',margin:'TaiwanStockMarginPurchaseShortSale',lending:'TaiwanStockSecuritiesLending'};
async function pull(dataset,date,{allowEmpty=false}={}){
 const query=new URLSearchParams({dataset,start_date:date,end_date:addDate(date,1)});
 const url='https://api.finmindtrade.com/api/v4/data?'+query.toString();
 let last='';
 for(let attempt=1;attempt<=3;attempt++){
  try{
   const r=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(28000)});
   if(!r.ok)throw Error('HTTP '+r.status);
   const data=await r.json();
   if(data.status!==200||!Array.isArray(data.data))throw Error('invalid FinMind status '+data.status);
   const all=data.data.filter(x=>x.date===date);
   if(!allowEmpty&&all.length===0)throw Error('no rows for requested date');
   return {all:all.length,records:all.filter(x=>poolSet.has(String(x.stock_id)))};
  }catch(e){last=String(e.message||e).replace(/eyJ[A-Za-z0-9._-]+/g,'[redacted]');await sleep(500*attempt)}
 }
 throw Error(dataset+' '+date+' '+last);
}
async function tradingDays(){
 try{
  const url='https://api.finmindtrade.com/api/v4/data?'+new URLSearchParams({dataset:'TaiwanStockTradingDate'});
  const r=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
  const raw=await r.json();
  const ds=new Set(raw.data?.map(x=>x.date).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x))||[]);
  if(raw.status!==200||ds.size<500||!ds.has('2026-10-27'))throw Error('calendar incomplete');
  return ds;
 }catch(e){throw Error('FinMind official trading date calendar unavailable: '+String(e.message||e))}
}
function validPrice(r){return Number.isFinite(r.open)&&Number.isFinite(r.high)&&Number.isFinite(r.low)&&Number.isFinite(r.close)&&r.open>0&&r.low>0&&r.high>=r.low&&r.open>=r.low-.001&&r.open<=r.high+.001&&r.close>=r.low-.001&&r.close<=r.high+.001&&r.volume>=0}
function normalizePrice(v){const r={stock_id:String(v.stock_id),open:Number(v.open),high:Number(v.max),low:Number(v.min),close:Number(v.close),volume:Number(v.Trading_Volume),value:Number(v.Trading_money)};return {...r,valid:validPrice(r)}}
let earlier=null,earlierBytes=null;
if(fs.existsSync(outPath)){
 try{
  const bytes=fs.readFileSync(outPath);
  const previous=JSON.parse(gunzipSync(bytes).toString('utf8'));
  if(previous.lock_id===refs.lock_id&&previous.pool_sha256===refs.pool_sha256){earlier=previous;earlierBytes=bytes}
 }catch{}
}
const payload={lock_id:refs.lock_id,source:'FinMind private Actions secret',reference_end:'2026-10-27',pool_sha256:refs.pool_sha256,
 generated_at:now.toISOString(),through_requested:endAt,days:earlier?.days||{}};
const statuses=[];const tradeDates=await tradingDays();
const nextTradeDate=[...tradeDates].filter(d=>d>endAt).sort()[0]||null;
let goodDays=0,errors=0;
for(let d=inputSince;d<=endAt;d=addDate(d,1)){
 if(!tradeDates.has(d))continue;
 // Recheck last 2 trading dates daily for late correction; preserve older already validated rows.
 const canReuse=d<addDate(endAt,-4)&&payload.days[d]?.source_state==='available';
 if(canReuse){statuses.push({date:d,state:'cached',price_valid:payload.days[d].price_valid,missing_count:payload.days[d].missing.length});continue}
 const day={date:d,source_state:'partial',datasets:{},price:[],institutional:[],margin:[],lending:[],missing:[],invalid:[],source_errors:[],price_valid:0,
  institutional_codes:0};
 for(const [k,dataset] of Object.entries(DATASETS)){
  try{
   const {all,records}=await pull(dataset,d,{allowEmpty:k==='margin'||k==='lending'});
   day.datasets[k]={total_rows:all,pool_rows:records.length,state:'received'};
   if(k==='price'){
    const map=new Map();for(const q of records){const row=normalizePrice(q);if(map.has(row.stock_id))throw Error('duplicate day/stock OHLC for '+row.stock_id);map.set(row.stock_id,row)}
    day.price=[...map.values()].sort((a,b)=>a.stock_id.localeCompare(b.stock_id));day.invalid=day.price.filter(x=>!x.valid).map(x=>x.stock_id);
    day.price_valid=day.price.length-day.invalid.length;day.missing=pool.filter(x=>!map.has(x));
   }else{
    day[k]=records.sort((a,b)=>String(a.stock_id).localeCompare(String(b.stock_id))).map(x=>Object.fromEntries(Object.entries(x).filter(([key])=>key!=='date')));
    if(k==='institutional')day.institutional_codes=new Set(records.map(x=>String(x.stock_id))).size;
   }
  }catch(e){errors++;day.datasets[k]={state:'unavailable'};day.source_errors.push(String(e.message||e))}
 }
 // Reference universe includes halted/illiquid stocks, so do not fabricate their OHLC.
 // 'available' describes raw feed only; never means C26 signal/portfolio ready.
 day.source_state=day.price_valid>=210&&day.institutional_codes>=190&&day.source_errors.length===0?'available':'partial';
 if(day.source_state==='available')goodDays++;
 payload.days[d]=day;
 statuses.push({date:d,state:day.source_state,price_valid:day.price_valid,missing_count:day.missing.length,invalid_count:day.invalid.length,
  institutional_codes:day.institutional_codes,source_errors:day.source_errors});
 console.log('C26_EOD_STAGE',JSON.stringify(statuses.at(-1)));
}
const closeDates=Object.keys(payload.days).filter(x=>x>='2026-10-28').sort();
const availableDates=closeDates.filter(x=>payload.days[x].source_state==='available');
const checkpointOverlap=checkBoundary(payload.days[checkpoint.date]);
console.log('C26_CHECKPOINT_OHLC_PARITY',JSON.stringify({date:checkpointOverlap.date,pass:checkpointOverlap.pass,matched:checkpointOverlap.matched,total:checkpointOverlap.total,failed_codes:checkpointOverlap.rows.filter(x=>!x.match).map(x=>x.code)}));
// Preserve byte-identical canonical source when the verified data did not change.
 // Do not churn the private DO every time only generated_at advances.
const sameSource=!!(earlier&&earlierBytes&&earlier.through_requested===payload.through_requested
  &&JSON.stringify(earlier.days)===JSON.stringify(payload.days));
const file=sameSource?earlierBytes:gzipSync(Buffer.from(JSON.stringify(payload)),{level:9});
if(sameSource)console.log('C26_SOURCE_UNCHANGED_REUSE_PRIVATE_BYTES',{source_as_of:endAt,bytes:file.length});
fs.mkdirSync(path.dirname(outPath),{recursive:true,mode:0o700});fs.mkdirSync(basename,{recursive:true});fs.writeFileSync(outPath,file,{mode:0o600});
const status={lock_id:refs.lock_id,archive_as_of:'2026-10-27',checked_at:now.toISOString(),requested_through:endAt,
 next_exchange_trade_date:nextTradeDate,
 full_market_last_verified:availableDates.at(-1)||null,
 staged_trade_dates:closeDates.length,available_trade_dates:availableDates.length,
 days:statuses,universe_count:pool.length,sha256_gzip:sha(file),bytes_gzip:file.length,
 source:'FinMind TaiwanStockPrice + Institutional + Margin + SecuritiesLending',secret_exposed:false,public_raw_data:false,raw_storage:'private CI workspace (ephemeral)',
 checkpoint_ohlc_parity:{date:checkpointOverlap.date,pass:checkpointOverlap.pass,matched:checkpointOverlap.matched,total:checkpointOverlap.total,failed_codes:checkpointOverlap.rows.filter(x=>!x.match).map(x=>x.code)},
 latest_missing_codes:payload.days[endAt]?.missing||[],
 state:checkpointOverlap.pass&&availableDates.length===closeDates.length&&closeDates.length>0?'source_staged':'source_partial',
 exact_c26_feature_parity:'NOT_VERIFIED',frozen_c26_portfolio_replay:'NOT_IMPLEMENTED',live_plan_readiness:'BLOCKED',
 warning:'僅公開FinMind資料涵蓋率；原始日K與法人資料不公開。C26最新訊號尚未通過凍結引擎重播。'};
fs.writeFileSync(statusPath,JSON.stringify(status,null,2)+'\n');
console.log('C26_EOD_STAGE_SUMMARY',JSON.stringify({requested:endAt,staged:closeDates.length,available:availableDates.length,
 last_available:status.full_market_last_verified,error_count:errors,compressed_bytes:file.length,lock_id:status.lock_id,checkpoint_parity:checkpointOverlap.pass}));
// Allow partial availability to be published for diagnostics. Never call it a signal-ready state.