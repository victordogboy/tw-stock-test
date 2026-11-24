/* C30/A56 FREE source collector and durable incremental cache.
   - FinMind Free: per-symbol data_id, no all-market chip calls.
   - TWSE/TPEx: public all-stock snapshot immediately reduced to the frozen 233 symbols.
   - All source records are separate from the frozen C30/A56 trading engines.
   - Token is supplied per HTTPS request; the server stores only its SHA-256 bucket name.
*/
import {c30FreeDailyRoute} from './free-daily.mjs';
const START='2026-11-23';
const CHIP=['TaiwanStockInstitutionalInvestorsBuySell','TaiwanStockMarginPurchaseShortSale','TaiwanStockSecuritiesLending'];
const ALL=['TaiwanStockPrice',...CHIP];
const HASH_BYTES=new TextEncoder();
const response=(o,status=200)=>Response.json(o,{status,headers:{'cache-control':'no-store','x-c30-replay-state':'frozen_not_replayed'}});
const hash=async str=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',HASH_BYTES.encode(str)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const validDate=d=>typeof d==='string'&&/^20\d\d-\d\d-\d\d$/.test(d)&&!Number.isNaN(Date.parse(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const tomorrow=d=>new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const clock=()=>new Date(Date.now()+8*3600000).toISOString();
const cutoff=()=>{const t=clock(),d=t.slice(0,10);return t.slice(11,16)>='20:00'?d:new Date(Date.parse(d+'T00:00:00Z')-86400000).toISOString().slice(0,10)};
const tokenOf=req=>{const h=req.headers.get('authorization')||'',t=h.startsWith('Bearer ')?h.slice(7).trim():'';return t.length>=30&&t.length<=4096&&!/\s/.test(t)?t:null};
const sameOrigin=req=>{const origin=req.headers.get('origin');return !origin||origin===new URL(req.url).origin};
let poolPromise;
async function pool(env){if(!poolPromise)poolPromise=(async()=>{const r=await env.ASSETS.fetch(new Request('https://assets.internal/c30/pool.json'));if(!r.ok)throw Error('233-stock frozen pool missing');const j=await r.json();if(j.stocks?.length!==233||new Set(j.stocks.map(x=>x.code)).size!==233)throw Error('233-stock pool mismatch');return new Map(j.stocks.map(x=>[x.code,x.market]))})().catch(e=>{poolPromise=null;throw e});return poolPromise}
async function vault(env,token){if(!env.SCAN_JOBS)throw Error('SCAN_JOBS Durable Object unavailable');const digest=await hash(token);return env.SCAN_JOBS.get(env.SCAN_JOBS.idFromName('private:c30:a56:free:v2:'+digest))}
function officialVault(env){return env.SCAN_JOBS.get(env.SCAN_JOBS.idFromName('system:c30:a56:official:v1'))}
async function internal(v,path,method='GET',body){const r=await v.fetch(new Request('https://cache.internal/c30-free-internal/'+path,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}));let j;try{j=await r.json()}catch{throw Error('C30 free cache malformed response')};if(!r.ok||j.ok===false){const e=new Error(j.error||'Cloud cache failure');e.status=r.status;e.retry_after_ms=j.retry_after_ms;e.code=j.code||null;throw e}return j}
async function finmind(token,dataset,code,start,end){const q=new URLSearchParams({dataset});if(code)q.set('data_id',code);if(start&&end){q.set('start_date',start);if(code&&dataset!=='TaiwanStockKBar')q.set('end_date',tomorrow(end))}let r;try{r=await fetch('https://api.finmindtrade.com/api/v4/data?'+q.toString(),{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(code?40000:65000),cache:'no-store'})}catch(e){throw Error('FinMind connection failed '+String(e.name||''))}if(!r.ok){const fault=await r.json().catch(()=>null),detail=String(fault?.msg||fault?.detail||fault?.message||'').slice(0,160).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[TOKEN_HIDDEN]');const e=new Error('FinMind 上游 HTTP '+r.status+(detail?'：'+detail:r.status===402||r.status===429?'（限流或額度不足）':''));e.status=r.status;e.code=[402,429].includes(r.status)?'UPSTREAM_QUOTA':'FINMIND_HTTP_ERROR';throw e}const x=await r.json().catch(()=>null);if(x?.status!==200||!Array.isArray(x.data)){const e=new Error('FinMind '+dataset+': '+String(x?.msg||x?.status||'schema').slice(0,160));e.status=Number(x?.status)||502;e.code=[402,429].includes(e.status)?'UPSTREAM_QUOTA':'FINMIND_DATA_ERROR';throw e}return x.data}
async function reserve(v,intervalMs=1000,tier='free'){try{return await internal(v,'reserve','POST',{interval_ms:intervalMs,tier})}catch(e){if(e.status===429)return {ok:false,retry_after_ms:e.retry_after_ms||1000,error:e.message,code:e.code||'REQUEST_PACING'};throw e}}
export async function c30FreeOfficialScheduled(env){
 if(!env.SCAN_JOBS)throw Error('SCAN_JOBS missing');
 const v=officialVault(env),previous=await internal(v,'status'),through=cutoff();
 if(previous.latest_price_date===through&&previous.days?.find(x=>x.date===through)?.price?.saved_codes?.length)return {ok:true,cached:true,as_of:through};
 const r=await c30FreeDailyRoute(new Request('https://internal/api/c30/latest'));
 const j=await r.json();if(!j.ok||!j.same_trade_date||!validDate(j.as_of)||j.as_of>through)throw Error('Official TWSE/TPEx not synchronized');
 const frozen=await pool(env),price=[...(j.markets?.twse?.rows||[]),...(j.markets?.tpex?.rows||[])].filter(x=>frozen.get(x.code)===x.market);
 if(price.length<200)throw Error('Only '+price.length+' / 233 official prices');
 return internal(v,'official','POST',{date:j.as_of,rows:price,expected:233,source:'Scheduled TWSE/TPEx official EOD'});
}
export async function c30FreeSourceRoute(req,env){
 const u=new URL(req.url),route=u.pathname.replace(/^\/api\/c30\/free\//,''),allow=['status','calendar','official','chip','minute','sponsor-batch','sponsor-minute','diagnose','market-day','day','replay-input'];
 if(!u.pathname.startsWith('/api/c30/free/')||!allow.includes(route))return response({ok:false,error:'unknown endpoint'},404);
 const method=['status','market-day','day','replay-input'].includes(route)?'GET':'POST';if(req.method!==method)return response({ok:false,error:method+' required'},405);
 if(!sameOrigin(req))return response({ok:false,error:'cross-origin request rejected'},403);
 const token=tokenOf(req);if(!token)return response({ok:false,error:'FinMind Free device token required'},401);
 const tier=req.headers.get('x-c30-source-tier')==='sponsor'?'sponsor':'free';
 const intervalHeader=Number(req.headers.get('x-c30-free-interval-ms')),minMs=tier==='sponsor'?50:1000,defaultMs=tier==='sponsor'?100:1000,stepMs=tier==='sponsor'?50:500;
 const intervalMs=Number.isFinite(intervalHeader)&&intervalHeader>=minMs&&intervalHeader<=30000?Math.round(intervalHeader/stepMs)*stepMs:defaultMs;
 try{
  const v=await vault(env,token);
  if(route==='status'){
   const [own,shared]=await Promise.all([internal(v,'status'),internal(officialVault(env),'status')]);
   const byDate=new Map((own.days||[]).map(x=>[x.date,x]));
   for(const x of shared.days||[]){if(!x.price)continue;const old=byDate.get(x.date);
    if(old){const available=new Set([...(x.price.saved_codes||[]),...(old.price?.saved_codes||[])]);old.price={...x.price,stock_count:available.size,saved_codes:[...available],state:available.size>=225?'available':'partial'}}else byDate.set(x.date,{date:x.date,price:x.price,chips:Object.fromEntries(CHIP.map(ds=>[ds,{saved_codes:[],available:0,empty:0}])),minute:{saved_codes:[],count:0,meta:{}}})
   }
   const days=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
   return response({...own,days,stored_days:days.length,latest_price_date:days.filter(x=>x.price?.state==='available').at(-1)?.date||null,complete_days:days.filter(x=>x.price?.state==='available'&&CHIP.every(ds=>x.chips?.[ds]?.saved_codes?.length===233)).length,model_replayed:false});
  }
  if(route==='day'||route==='replay-input'){
   const date=u.searchParams.get('date'),dataset=u.searchParams.get('dataset');if(!validDate(date)||date<START||dataset&&![...ALL,'minute'].includes(dataset))return response({ok:false,error:'invalid date/dataset'},400);
   const [privateData,sharedData]=await Promise.all([internal(v,'day?date='+date+(dataset?'&dataset='+dataset:'')+(route==='replay-input'?'&manifest=1':'')),
      internal(officialVault(env),'day?date='+date+'&dataset=TaiwanStockPrice')]);
   if(!dataset||dataset==='TaiwanStockPrice'){const a=sharedData.datasets?.TaiwanStockPrice?.rows||[],seen=new Set(a.map(x=>x.code)),tail=(privateData.datasets?.TaiwanStockPrice?.rows||[]).filter(x=>!seen.has(x.code));privateData.datasets.TaiwanStockPrice={meta:sharedData.datasets?.TaiwanStockPrice?.meta||privateData.datasets?.TaiwanStockPrice?.meta,rows:[...a,...tail]}}
   if(route==='replay-input'){
    const status=await internal(v,'status'),entry=status.days?.find(x=>x.date===date),prices=privateData.datasets?.TaiwanStockPrice?.rows||[];
    const missing=Object.fromEntries(CHIP.map(ds=>[ds,233-(entry?.chips?.[ds]?.saved_codes?.length||0)]));
    const minute=entry?.minute?.count||0,empty_checked=Object.fromEntries(CHIP.map(ds=>[ds,entry?.chips?.[ds]?.empty||0]));
    privateData.replay_gate={source_date:date,anchor_date:'2026-11-20',expected_stocks:233,price_stocks:prices.length,
      chip_missing:missing,chip_empty_unverified:empty_checked,minute_stocks:minute,source_complete:prices.length===233&&Object.values(missing).every(n=>n===0)&&Object.values(empty_checked).every(n=>n===0)&&minute===233,
      original_engine_attached:false,model_replayed:false,plan_ready:false,reason:'Full original C30/A56 Python engine and 2026-11-20 state have not been verified on Cloudflare'};
   }
   return response(privateData);
  }
  if(route==='market-day'){
   const date=u.searchParams.get('date');
   if(!validDate(date)||date<START||date>cutoff())return response({ok:false,error:'invalid market date'},400);
   return response(await internal(v,'market-day?date='+date));
  }
  if(route==='calendar'){
   const stored=await internal(v,'calendar');const through=cutoff();
   if(stored.as_of===through&&stored.dates?.length)return response({...stored,cached:true});
   const permit=await reserve(v,intervalMs,tier);if(!permit.ok)return response({...permit,code:permit.code||'FREE_RATE_LIMIT'},429);
   const rows=await finmind(token,'TaiwanStockTradingDate');
   const dates=[...new Set(rows.map(x=>x.date).filter(d=>validDate(d)&&d>=START&&d<=through))].sort();
   if(!dates.length)throw Error('FinMind Free calendar empty');
   return response({...await internal(v,'calendar','POST',{as_of:through,dates}),cached:false});
  }
  if(route==='official'){
   const done=await internal(officialVault(env),'status'),date=cutoff();
   if(done.latest_price_date===date&&done.days?.find(x=>x.date===date)?.price?.saved_codes?.length)return response({ok:true,cached:true,as_of:date,stock_count:done.days?.find(x=>x.date===date)?.price?.stock_count||0});
   return response({...await c30FreeOfficialScheduled(env),cached:false});
  }
  if(route==='minute'){
   const q=await req.json().catch(()=>null),code=String(q?.code||''),market=q?.market,provider=q?.provider;
   if(!/^\d{4}$/.test(code)||!['TWSE','TPEx'].includes(market)||!['Fugle Free API','Yahoo chart fallback','FinMind Sponsor 1m'].includes(provider)||!Array.isArray(q?.bars)||q.bars.length>10000)return response({ok:false,error:'invalid minute input'},400);
   if((await pool(env)).get(code)!==market)return response({ok:false,error:'minute code/market outside frozen pool'},400);
   const groups=new Map();for(const b of q.bars){if(!validDate(b.date)||b.date<START||b.date>cutoff()||b.stock_id!==code||!/^\d{2}:\d{2}:00$/.test(b.minute||'')||b.minute<'09:00:00'||b.minute>'14:30:00'||![b.open,b.high,b.low,b.close,b.volume_shares].every(Number.isFinite)||b.open<=0||b.low<=0||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close))return response({ok:false,error:'minute OHLCV validation failed'},422);const v=groups.get(b.date)||[];v.push(b);groups.set(b.date,v)}
   if(groups.size>35||!groups.size)return response({ok:false,error:'minute day count exceeds 35'},400);
   const out=[];for(const [date,bars] of groups){out.push(await internal(v,'minute','POST',{date,code,provider,market,bars}))}
   return response({ok:true,stored:out.length,days:out,model_replayed:false});
  }
  if(route==='diagnose'){
   // Exactly one upstream FinMind API request; caller must explicitly invoke via UI.
   const q=await req.json().catch(()=>null),dataset=q?.dataset,code=String(q?.code||''),date=q?.date;
   if(tier!=='sponsor')return response({ok:false,code:'SPONSOR_MODE_REQUIRED',error:'請先切換 Sponsor S 模式'},400);
   if(!validDate(date)||date<START||date>cutoff()||!['TaiwanStockPrice','TaiwanStockKBar'].includes(dataset))return response({ok:false,code:'BAD_DIAGNOSTIC_INPUT',error:'請選擇有效的歷史交易日與資料集'},400);
   if(dataset==='TaiwanStockKBar'&&(!(await pool(env)).has(code)))return response({ok:false,error:'診斷股票不在 233 檔固定研究池'},400);
   const permit=await reserve(v,intervalMs,tier);
   if(!permit.ok)return response({...permit,code:permit.code||'SPONSOR_QUOTA'},429);
   const rows=await finmind(token,dataset,dataset==='TaiwanStockKBar'?code:null,date,date);
   const matched=dataset==='TaiwanStockKBar'?rows.filter(x=>String(x.stock_id)===code&&x.date===date):rows.filter(x=>x.date===date&&(String(x.stock_id||'')==='2330'));
   return response({ok:true,dataset,date,requested_stock:dataset==='TaiwanStockKBar'?code:'整日全市場',total_rows:rows.length,sample_stock_rows:matched.length,
     fields:Object.keys(rows[0]||{}).slice(0,25),api_request_format:'Sponsor single-day start_date only',
     message:rows.length?'Sponsor 來源已回傳資料；仍須檢查雲端保存格式':'API 成功但此日回傳 0 筆，請改選有交易的日期',
     model_replayed:false});
  }
  if(route==='sponsor-batch'){
   if(tier!=='sponsor')return response({ok:false,error:'請在介面選 Sponsor（S）模式；FinMind 會驗證實際會員權限'},403);
   const q=await req.json().catch(()=>null),date=q?.date,ds=q?.dataset;
   if(!validDate(date)||date<START||date>cutoff()||!ALL.includes(ds))return response({ok:false,error:'Sponsor dataset or date invalid'},400);
   const batchInfo=await internal(v,'batch-state?date='+date+'&dataset='+ds);
   const marketMeta=ds==='TaiwanStockPrice'?await internal(v,'market-meta?date='+date):null;
   if(batchInfo.done&&(ds!=='TaiwanStockPrice'||marketMeta?.stored)&&!q.force)return response({ok:true,cached:true,date,dataset:ds,selected_rows:batchInfo.rows||0,all_market_rows:marketMeta?.rows||0,model_replayed:false});
   const permit=await reserve(v,intervalMs,tier);
   if(!permit.ok)return response({...permit,code:permit.code||'SPONSOR_QUOTA'},429);
   const allRows=await finmind(token,ds,null,date,date),fixed=await pool(env);
   const matched=allRows.filter(x=>x?.date===date&&fixed.has(String(x.stock_id||'')));
   if(allRows.length===0)throw Error('Sponsor 整日回傳空資料，不會封存為完成');
   if(allRows.length>100000||matched.length>22000)throw Error('FinMind 回傳筆數異常，不保存');
   // Retain the entire day's unfiltered market OHLCV for breadth and historical membership research.
   // Do not substitute 233-stock breadth into the original frozen strategy.
   let marketSaved=null;
   if(ds==='TaiwanStockPrice')marketSaved=await internal(v,'market-store','POST',{date,rows:allRows,source:'FinMind Sponsor TaiwanStockPrice all instruments'});
   const saved=await internal(v,'batch','POST',{date,dataset:ds,rows:matched,source:'FinMind Sponsor whole-market by date'});
   return response({...saved,cached:false,market_rows:allRows.length,all_market_saved:marketSaved?.stored||false,selected_rows:matched.length,model_replayed:false});
  }
  if(route==='sponsor-minute'){
   if(tier!=='sponsor')return response({ok:false,error:'僅 Sponsor（S）模式允許 FinMind TaiwanStockKBar'},403);
   const q=await req.json().catch(()=>null),code=String(q?.code||''),date=q?.date;
   if(!validDate(date)||date<START||date>cutoff()||!/^\d{4}$/.test(code))return response({ok:false,error:'Sponsor minute code/date invalid'},400);
   const market=(await pool(env)).get(code);
   if(!market)return response({ok:false,error:'非 C30 固定 233 檔'},400);
   const current=await internal(v,'status'),day=current.days?.find(x=>x.date===date);
   if(day?.minute?.saved_codes?.includes(code)&&!q.force)return response({ok:true,cached:true,code,date,model_replayed:false});
   const permit=await reserve(v,intervalMs,tier);
   if(!permit.ok)return response({...permit,code:permit.code||'SPONSOR_QUOTA'},429);
   const rows=await finmind(token,'TaiwanStockKBar',code,date,date),bars=[];
   for(const x of rows){
     if(x?.date!==date||String(x.stock_id||'')!==code)continue;
     const minute=String(x.minute||'').slice(-8);
     const bar={date,minute,stock_id:code,open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume_shares:Number(x.volume)};
     if(!/^\d{2}:\d{2}:00$/.test(minute)||minute<'09:00:00'||minute>'14:30:00'||![bar.open,bar.high,bar.low,bar.close,bar.volume_shares].every(Number.isFinite)||bar.low<=0||bar.low>Math.min(bar.open,bar.close)||bar.high<Math.max(bar.open,bar.close)||bar.volume_shares<0)throw Error('Sponsor KBar validation failed');
     bars.push(bar);
   }
   if(!bars.length||bars.length>340)throw Error('Sponsor 此日沒有有效 1 分 K；原雲端保留');
   const done=await internal(v,'minute','POST',{date,code,market,provider:'FinMind Sponsor 1m',bars});
   return response({...done,ok:true,cached:false,date,code,model_replayed:false});
  }
  if(route==='chip'){
   const q=await req.json().catch(()=>null);const ds=q?.dataset,code=String(q?.code||''),from=q?.from,to=q?.to;
   if(!ALL.includes(ds)||!/^\d{4}$/.test(code)||!validDate(from)||!validDate(to)||from<START||to>cutoff()||from>to||Date.parse(to)-Date.parse(from)>31*86400000)return response({ok:false,error:'invalid code/dataset/range'},400);
   if(!(await pool(env)).has(code))return response({ok:false,error:'code not in frozen 233'},400);
   const cal=await internal(v,'calendar');const dates=cal.dates?.filter(d=>d>=from&&d<=to)||[];
   if(!dates.length)return response({ok:false,error:'calendar has no verified sessions; request calendar first'},409);
   const state=await internal(v,'status');const need=dates.filter(d=>!state.days?.find(x=>x.date===d)?.chips?.[ds]?.saved_codes?.includes(code));
   if(!need.length)return response({ok:true,cached:true,code,dataset:ds,dates:dates.length,model_replayed:false});
   const permit=await reserve(v,intervalMs,tier);if(!permit.ok)return response({...permit,code:permit.code||'FREE_RATE_LIMIT'},429);
   const rows=await finmind(token,ds,code,from,to);
   const selected=rows.filter(x=>x&&x.stock_id===code&&validDate(x.date)&&dates.includes(x.date));
   if(selected.length>8000)throw Error('Unexpected FinMind row count');
   return response({...await internal(v,'chip','POST',{code,dataset:ds,dates:need,rows:selected,source:'FinMind Free per-stock data_id'}),cached:false,model_replayed:false});
  }
  return response({ok:false,error:'unknown'},404)
 }catch(e){const m=String(e.message||e).slice(0,260).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[TOKEN_REDACTED]'),status=e.status===429?429:e.status===402?402:e.status===401||e.status===403?403:e.status===400?400:e.status===409?409:502;return response({ok:false,error:m,code:e.code||'SOURCE_ERROR',upstream_status:e.status||null,retry_after_ms:e.retry_after_ms||null,model_replayed:false},status)}
}
export class C30FreeStore{
 constructor(ctx){this.ctx=ctx;this.s=ctx.storage}
 async fetch(req){const u=new URL(req.url),route=u.pathname.split('/').at(-1),method=req.method;
  try{
   if(route==='reserve'&&method==='POST'){
    const body=await req.json().catch(()=>({})),tier=body.tier==='sponsor'?'sponsor':'free',requested=Number(body.interval_ms),minMs=tier==='sponsor'?50:1000,stepMs=tier==='sponsor'?50:500,defaultMs=tier==='sponsor'?100:1000;
    const ms=Number.isFinite(requested)&&requested>=minMs&&requested<=30000?Math.round(requested/stepMs)*stepMs:defaultMs;
    const hourlyCap=tier==='sponsor'?5600:540,now=Date.now(),windowMs=3600000;
    let retry=0,reason='REQUEST_PACING',count=0;
    const granted=await this.s.transaction(async tx=>{
      const last=await tx.get('rate:next')||0;
      const history=(await tx.get('rate:history')||[]).filter(t=>t>now-windowMs);
      count=history.length;
      if(count>=hourlyCap){retry=Math.max(1000,history[0]+windowMs-now+1000);reason='HOURLY_QUOTA';return false}
      if(now<last){retry=last-now+15;reason='REQUEST_PACING';return false}
      history.push(now);await tx.put('rate:history',history);await tx.put('rate:next',now+ms);count=history.length;return true
    });
    return granted?response({ok:true,next_at:now+ms,interval_ms:ms,tier,used_last_hour:count,hourly_safe_cap:hourlyCap}):response({ok:false,error:reason==='HOURLY_QUOTA'?'已達安全額度，請稍後續傳':'請求間隔尚未結束',code:reason,retry_after_ms:retry,used_last_hour:count,hourly_safe_cap:hourlyCap},429);
   }
   if(route==='calendar'&&method==='GET')return response({ok:true,...await this.s.get('calendar')||{as_of:null,dates:[]}});
   if(route==='calendar'&&method==='POST'){
    const b=await req.json();if(!validDate(b.as_of)||!Array.isArray(b.dates)||b.dates.length>1000||b.dates.some(d=>!validDate(d)||d<START||d>b.as_of))return response({ok:false,error:'invalid calendar'},400);
    const obj={ok:true,as_of:b.as_of,dates:[...new Set(b.dates)].sort(),updated_at:new Date().toISOString()};await this.s.put('calendar',obj);return response(obj);
   }
   if(route==='official'&&method==='POST'){
    const b=await req.json(),date=b.date;if(!validDate(date)||date<START||!Array.isArray(b.rows)||b.rows.length>233||b.rows.length<200)return response({ok:false,error:'invalid official rows'},400);
    const ids=new Set();for(const x of b.rows){if(!/^\d{4}$/.test(x.code||'')||x.date!==date||ids.has(x.code)||![x.open,x.high,x.low,x.close,x.volume_shares].every(Number.isFinite)||x.low>Math.min(x.open,x.close)||x.high<Math.max(x.open,x.close))return response({ok:false,error:'invalid OHLCV or duplicate code'},422);ids.add(x.code)}
    const index=await this.s.get('index:'+date)||{chips:{}};index.price={state:ids.size>=225?'available':'partial',stock_count:ids.size,saved_codes:[...ids],source:b.source,updated_at:new Date().toISOString()};
    await this.s.put({['price:'+date]:b.rows,['index:'+date]:index});return response({ok:true,stored:true,as_of:date,stock_count:ids.size,missing:233-ids.size,state:index.price.state});
   }
   if(route==='market-meta'&&method==='GET'){
    const date=u.searchParams.get('date');
    if(!validDate(date)||date<START)return response({ok:false,error:'invalid date'},400);
    const meta=await this.s.get('market-meta:'+date);
    return response({ok:true,stored:!!meta,...meta});
   }
   if(route==='market-store'&&method==='POST'){
    const q=await req.json(),date=q.date,rows=q.rows;
    if(!validDate(date)||date<START||!Array.isArray(rows)||!rows.length||rows.length>12000)return response({ok:false,error:'invalid all-market OHLCV payload'},400);
    // Keep all returned stock_ids, including nonstandard IDs. Filter ordinary listed/OTC stocks only at the breadth calculation stage.
    const symbols=new Set(),data=[];
    for(const x of rows){
     const code=String(x.stock_id||'');
     if(x.date!==date||!code||code.length>16||symbols.has(code))return response({ok:false,error:'duplicate or invalid market symbol/date'},422);
     symbols.add(code);
     const numeric=k=>x[k]===null||x[k]===undefined?null:Number.isFinite(Number(x[k]))?Number(x[k]):null;
     data.push([code,numeric('open'),numeric('max'),numeric('min'),numeric('close'),numeric('Trading_Volume'),numeric('Trading_money')])
    }
    const columns=['stock_id','open','max','min','close','Trading_Volume','Trading_money'],batch=180;
    for(let i=0;i<data.length;i+=batch)await this.s.put('market-chunk:'+date+':'+String(i/batch).padStart(4,'0'),data.slice(i,i+batch));
    // Publish manifest only after every data chunk is safely stored.
    const meta={date,stored:true,rows:data.length,positive_closes:data.filter(x=>x[4]>0).length,
      chunks:Math.ceil(data.length/batch),columns,source:q.source||'FinMind Sponsor daily all-market',
      universe:'unfiltered TWSE/TPEx/ESB/ETF/etc; requires as-of ordinary-share classification before breadth',
      updated_at:new Date().toISOString()};
    await this.s.put('market-meta:'+date,meta);
    return response({ok:true,...meta});
   }
   if(route==='market-day'&&method==='GET'){
    const date=u.searchParams.get('date');
    if(!validDate(date)||date<START)return response({ok:false,error:'invalid date'},400);
    const meta=await this.s.get('market-meta:'+date);
    if(!meta)return response({ok:false,error:'此日尚無 Sponsor 全市場收盤價封存',date},404);
    const rows=[];
    for(let i=0;i<meta.chunks;i++){
     const chunk=await this.s.get('market-chunk:'+date+':'+String(i).padStart(4,'0'));
     if(!Array.isArray(chunk))return response({ok:false,error:'全市場日K封存缺少第 '+i+' 段，拒絕輸出不完整資料'},409);
     rows.push(...chunk)
    }
    if(rows.length!==meta.rows)return response({ok:false,error:'全市場日K封存行數不符'},409);
    return response({ok:true,meta,columns:meta.columns,rows});
   }
   if(route==='batch-state'&&method==='GET'){
    const date=u.searchParams.get('date'),dataset=u.searchParams.get('dataset');
    if(!validDate(date)||!ALL.includes(dataset))return response({ok:false,error:'invalid date/dataset'},400);
    return response({ok:true,...await this.s.get('batch:'+date+':'+dataset)||{done:false}});
   }
   if(route==='batch'&&method==='POST'){
    const q=await req.json(),ds=q.dataset,date=q.date,source=q.source;
    if(!ALL.includes(ds)||!validDate(date)||date<START||!Array.isArray(q.rows)||q.rows.length>22000)return response({ok:false,error:'invalid Sponsor batch'},400);
    const grouped=new Map();
    for(const x of q.rows){
     const code=String(x.stock_id||'');
     if(x.date!==date||!/^\d{4}$/.test(code))return response({ok:false,error:'Sponsor row symbol/date invalid'},422);
     const arr=grouped.get(code)||[];arr.push(x);grouped.set(code,arr)
    }
    let written=0,skipped=0;
    const idx=await this.s.get('index:'+date)||{chips:{}};idx.chips??={};
    idx.chips[ds]??={};const values={};
    for(const [code,rows] of grouped){
     const prior=idx.chips[ds][code];
     if(prior?.state==='available'){skipped++;continue}
     if(ds==='TaiwanStockPrice'&&rows.some(x=>[x.open,x.max,x.min,x.close,x.Trading_Volume].some(v=>!Number.isFinite(Number(v)))||Number(x.open)<=0||Number(x.max)<Number(x.min)))return response({ok:false,error:'Sponsor price invalid'},422);
     idx.chips[ds][code]={state:'available',rows:rows.length,source,updated_at:new Date().toISOString()};
     values['chip:'+date+':'+ds+':'+code]=rows;written++;
     if(Object.keys(values).length>=25){await this.s.put(values);for(const key of Object.keys(values))delete values[key]}
    }
    if(Object.keys(values).length)await this.s.put(values);
    await this.s.put('index:'+date,idx);
    const meta={done:true,date,dataset:ds,rows:q.rows.length,stock_count:grouped.size,written,skipped,source,updated_at:new Date().toISOString()};
    idx.batch??={};idx.batch[ds]={done:true,rows:q.rows.length,stock_count:grouped.size};await this.s.put('index:'+date,idx);await this.s.put('batch:'+date+':'+ds,meta);
    return response({ok:true,stored:true,...meta});
   }
   if(route==='chip'&&method==='POST'){
    const b=await req.json(),dates=b.dates||[],ds=b.dataset,code=b.code;
    if(!ALL.includes(ds)||!/^\d{4}$/.test(code)||!Array.isArray(dates)||!dates.length||dates.length>32||dates.some(x=>!validDate(x)||x<START)||!Array.isArray(b.rows)||b.rows.length>8000)return response({ok:false,error:'invalid chip input'},400);
    const by=new Map(dates.map(d=>[d,[]]));for(const x of b.rows){if(!by.has(x.date)||x.stock_id!==code)return response({ok:false,error:'FinMind symbol/date mismatch'},422);by.get(x.date).push(x)}
    let written=0,empty=0;for(const [date,rows] of by){
     if(ds==='TaiwanStockPrice'&&rows.some(x=>![x.open,x.max,x.min,x.close,x.Trading_Volume].every(v=>Number.isFinite(Number(v)))||Number(x.open)<=0||Number(x.close)<=0||Number(x.max)<Number(x.min)))return response({ok:false,error:'invalid FinMind price OHLCV'},422);
     const index=await this.s.get('index:'+date)||{chips:{}};index.chips??={};index.chips[ds]??={};
     const current=index.chips[ds][code];if(current?.state==='available'||current?.state==='empty_checked')continue;
     index.chips[ds][code]={state:rows.length?'available':'empty_checked',rows:rows.length,source:b.source,updated_at:new Date().toISOString()};
     await this.s.put({['chip:'+date+':'+ds+':'+code]:rows,['index:'+date]:index});written++;if(!rows.length)empty++;
    }
    return response({ok:true,stored:true,dataset:ds,code,days_saved:written,empty_days:empty});
   }
   if(route==='minute'&&method==='POST'){
    const q=await req.json(),{code,date,market,provider}=q;
    if(!validDate(date)||date<START||!/^\d{4}$/.test(code)||!['Fugle Free API','Yahoo chart fallback','FinMind Sponsor 1m'].includes(provider)||!['TWSE','TPEx'].includes(market)||!Array.isArray(q.bars)||q.bars.length>340)return response({ok:false,error:'bad minute payload'},400);
    const key='minute:'+date+':'+code,old=await this.s.get(key);
    const rank=p=>p==='FinMind Sponsor 1m'?3:p==='Fugle Free API'?2:1;if(old&&rank(old.provider)>rank(provider))return response({ok:true,skipped:true,date,code});
    const combined=new Map(old?.provider===provider?(old.bars||[]).map(b=>[b.minute,b]):[]);
    for(const bar of q.bars)combined.set(bar.minute,bar);
    const bars=[...combined.values()].sort((a,b)=>a.minute.localeCompare(b.minute));
    const meta=await this.s.get('minuteIndex:'+date)||{};
    meta[code]={bars:bars.length,provider,updated_at:new Date().toISOString()};
    await this.s.put({[key]:{code,date,market,provider,bars},['minuteIndex:'+date]:meta});
    return response({ok:true,stored:true,date,code,bars:bars.length});
   }
   if(route==='status'&&method==='GET'){
    const m=await this.s.list({prefix:'index:'}),mins=await this.s.list({prefix:'minuteIndex:'}),days=[];
    for(const [key,idx] of m){const date=key.slice(6),chips={};for(const ds of CHIP){const obj=idx.chips?.[ds]||{};chips[ds]={saved_codes:Object.keys(obj).filter(x=>['available','empty_checked'].includes(obj[x].state)),available:Object.values(obj).filter(x=>x.state==='available').length,empty:Object.values(obj).filter(x=>x.state==='empty_checked').length}}const priceObject=idx.chips?.TaiwanStockPrice||{},checked=Object.keys(priceObject).filter(x=>['available','empty_checked'].includes(priceObject[x].state)),valid=Object.keys(priceObject).filter(x=>priceObject[x].state==='available');days.push({date,price:idx.price||{state:valid.length>=225?'available':'partial',stock_count:valid.length,saved_codes:checked,source:'FinMind per-stock backfill'},chips,batch:idx.batch||{},market:await this.s.get('market-meta:'+date)||null,minute:{saved_codes:Object.keys(mins.get('minuteIndex:'+date)||{}),count:Object.keys(mins.get('minuteIndex:'+date)||{}).length,meta:mins.get('minuteIndex:'+date)||{}}})}
    for(const [key,info] of mins){const date=key.slice('minuteIndex:'.length);if(!days.some(x=>x.date===date))days.push({date,price:null,chips:Object.fromEntries(CHIP.map(ds=>[ds,{saved_codes:[],available:0,empty:0}])),minute:{saved_codes:Object.keys(info),count:Object.keys(info).length,meta:info}})}
    days.sort((a,b)=>a.date.localeCompare(b.date));return response({ok:true,days,stored_days:days.length,latest_price_date:days.filter(x=>x.price?.state==='available').at(-1)?.date||null,complete_days:days.filter(x=>x.price?.state==='available'&&CHIP.every(ds=>x.chips[ds].saved_codes.length===233)).length,model_replayed:false,freeze_end:'2026-11-20',source:'Free: official TWSE/TPEx + FinMind per-stock'});
   }
   if(route==='day'&&method==='GET'){
    const date=u.searchParams.get('date'),dataset=u.searchParams.get('dataset');if(!validDate(date)||date<START||dataset&&![...ALL,'minute'].includes(dataset))return response({ok:false,error:'invalid date/dataset'},400);
    if(dataset==='minute'){const index=await this.s.get('minuteIndex:'+date)||{},code=u.searchParams.get('code'),codes=u.searchParams.get('codes');if(code&&codes)return response({ok:false,error:'use code or codes'},400);if(code&&!/^\d{4}$/.test(code))return response({ok:false,error:'invalid code'},400);const ids=code?[code]:codes?codes.split(','):Object.keys(index);if(ids.length>12||ids.some(id=>!/^\d{4}$/.test(id)))return response({ok:false,error:'minute batch must contain 1–12 four-digit stock codes'},413);const items=[];for(const id of ids){const item=await this.s.get('minute:'+date+':'+id);if(item)items.push(item)}return response({ok:true,date,items,model_replayed:false})}
    const idx=await this.s.get('index:'+date)||{},sets={};if(!dataset||dataset==='TaiwanStockPrice'){const out=[...await this.s.get('price:'+date)||[]],marks=idx.chips?.TaiwanStockPrice||{};for(const code of Object.keys(marks)){const rs=await this.s.get('chip:'+date+':TaiwanStockPrice:'+code)||[];for(const r of rs)out.push({date,code,market:null,open:Number(r.open),high:Number(r.max),low:Number(r.min),close:Number(r.close),volume_shares:Number(r.Trading_Volume),source:'FinMind Free per-stock backfill'})}sets.TaiwanStockPrice={meta:idx.price||null,rows:out}};
    for(const ds of dataset&&dataset!=='TaiwanStockPrice'?[dataset]:!dataset?CHIP:[]){const status=idx.chips?.[ds]||{},all=[];for(const code of Object.keys(status)){const value=await this.s.get('chip:'+date+':'+ds+':'+code);if(Array.isArray(value))all.push(...value)}sets[ds]={meta:{saved_count:Object.keys(status).length,complete:Object.keys(status).length===233},rows:all}}
    return response({ok:true,date,datasets:sets,price_ready:idx.price?.state==='available'||false,full_model_replay_ready:false,model_replayed:false});
   }
   return response({ok:false,error:'not found'},404)
  }catch(e){return response({ok:false,error:String(e.message||e).slice(0,240)},500)}
 }
}
export const C30_FREE_DATASETS=ALL;