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
async function internal(v,path,method='GET',body){const r=await v.fetch(new Request('https://cache.internal/c30-free-internal/'+path,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}));let j;try{j=await r.json()}catch{throw Error('C30 free cache malformed response')};if(!r.ok||j.ok===false){const e=new Error(j.error||'Cloud cache failure');e.status=r.status;e.retry_after_ms=j.retry_after_ms;throw e}return j}
async function finmind(token,dataset,code,start,end){const q=new URLSearchParams({dataset});if(code){q.set('data_id',code);q.set('start_date',start);q.set('end_date',tomorrow(end))}let r;try{r=await fetch('https://api.finmindtrade.com/api/v4/data?'+q.toString(),{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(25000),cache:'no-store'})}catch(e){throw Error('FinMind connection failed '+String(e.name||''))}if(!r.ok){const e=new Error('FinMind HTTP '+r.status);e.status=r.status;throw e}const x=await r.json().catch(()=>null);if(x?.status!==200||!Array.isArray(x.data))throw Error('FinMind Free rejected '+dataset+': '+String(x?.msg||x?.status||'schema'));return x.data}
async function reserve(v){try{return await internal(v,'reserve','POST')}catch(e){if(e.status===429)return {ok:false,retry_after_ms:e.retry_after_ms||8000,error:e.message};throw e}}
export async function c30FreeOfficialScheduled(env){
 if(!env.SCAN_JOBS)throw Error('SCAN_JOBS missing');
 const v=officialVault(env),old=await internal(v,'status'),through=cutoff();
 if(old.latest_price_date===through)return {ok:true,cached:true,as_of:through};
 const r=await c30FreeDailyRoute(new Request('https://worker.internal/api/c30/latest'));
 const j=await r.json();
 if(!j.ok||!j.same_trade_date||!validDate(j.as_of)||j.as_of>through)throw Error('TWSE/TPEx EOD dates not synchronized');
 const frozen=await pool(env),prices=[...(j.markets?.twse?.rows||[]),...(j.markets?.tpex?.rows||[])].filter(x=>frozen.get(x.code)===x.market);
 if(prices.length<200)throw Error('Official stocks below minimum '+prices.length+'/233');
 return internal(v,'official','POST',{date:j.as_of,rows:prices,expected:233,source:'TWSE/TPEx official scheduled EOD'});
}
export async function c30FreeSourceRoute(req,env){
 const u=new URL(req.url),route=u.pathname.replace(/^\/api\/c30\/free\//,''),allow=['status','calendar','official','chip','day','replay-input'];
 if(!u.pathname.startsWith('/api/c30/free/')||!allow.includes(route))return response({ok:false,error:'unknown endpoint'},404);
 const method=['status','day','replay-input'].includes(route)?'GET':'POST';if(req.method!==method)return response({ok:false,error:method+' required'},405);
 if(!sameOrigin(req))return response({ok:false,error:'cross-origin request rejected'},403);
 const token=tokenOf(req);if(!token)return response({ok:false,error:'FinMind Free device token required'},401);
 try{
  const v=await vault(env,token);
  if(route==='status'){
   const [own,shared]=await Promise.all([internal(v,'status'),internal(officialVault(env),'status')]);
   const byDate=new Map((own.days||[]).map(x=>[x.date,x]));
   for(const x of shared.days||[]){if(!x.price)continue;const old=byDate.get(x.date);
    if(old)old.price=x.price;else byDate.set(x.date,{date:x.date,price:x.price,chips:Object.fromEntries(CHIP.map(ds=>[ds,{saved_codes:[],available:0,empty:0}])),minute:{saved_codes:[],count:0}})
   }
   const days=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
   return response({...own,days,stored_days:days.length,latest_price_date:days.filter(x=>x.price?.state==='available').at(-1)?.date||null,complete_days:days.filter(x=>x.price?.state==='available'&&CHIP.every(ds=>x.chips?.[ds]?.saved_codes?.length===233)).length,model_replayed:false});
  }
  if(route==='day'||route==='replay-input'){
   const date=u.searchParams.get('date'),dataset=u.searchParams.get('dataset');if(!validDate(date)||date<START||dataset&&![...ALL,'minute'].includes(dataset))return response({ok:false,error:'invalid date/dataset'},400);
   const [data,shared]=await Promise.all([internal(v,'day?date='+date+(dataset?'&dataset='+dataset:'')+(route==='replay-input'?'&manifest=1':'')),internal(officialVault(env),'day?date='+date+'&dataset=TaiwanStockPrice')]);
   if(!dataset||dataset==='TaiwanStockPrice')data.datasets.TaiwanStockPrice=shared.datasets.TaiwanStockPrice;
   if(route==='replay-input'){
    const status=await internal(v,'status'),entry=status.days?.find(x=>x.date===date),prices=shared.datasets?.TaiwanStockPrice?.rows||[];
    const missing=Object.fromEntries(CHIP.map(ds=>[ds,233-(entry?.chips?.[ds]?.saved_codes?.length||0)]));
    const minute=entry?.minute?.count||0;
    data.replay_gate={source_date:date,anchor_date:'2026-11-20',expected_stocks:233,price_stocks:prices.length,chip_missing:missing,minute_stocks:minute,
     source_complete:prices.length>=225&&Object.values(missing).every(n=>n===0)&&minute===233,original_engine_attached:false,model_replayed:false,plan_ready:false,
     reason:'Original C30/A56 Python engine state is not deployed on Cloudflare and has not been replayed'};
   }
   return response(data);
  }
  if(route==='calendar'){
   const stored=await internal(v,'calendar');const through=cutoff();
   if(stored.as_of===through&&stored.dates?.length)return response({...stored,cached:true});
   const permit=await reserve(v);if(!permit.ok)return response({...permit,code:'FREE_RATE_LIMIT'},429);
   const rows=await finmind(token,'TaiwanStockTradingDate');
   const dates=[...new Set(rows.map(x=>x.date).filter(d=>validDate(d)&&d>=START&&d<=through))].sort();
   if(!dates.length)throw Error('FinMind Free calendar empty');
   return response({...await internal(v,'calendar','POST',{as_of:through,dates}),cached:false});
  }
  if(route==='official'){
   const old=await internal(officialVault(env),'status'),date=cutoff();
   if(old.latest_price_date===date)return response({ok:true,cached:true,as_of:date,stock_count:old.days?.find(x=>x.date===date)?.price?.stock_count||0});
   return response({...await c30FreeOfficialScheduled(env),cached:false});
  }
  if(route==='minute'){
   const q=await req.json().catch(()=>null),code=String(q?.code||''),market=q?.market,provider=q?.provider;
   if(!/^\d{4}$/.test(code)||!['TWSE','TPEx'].includes(market)||!['Fugle Free API','Yahoo chart fallback'].includes(provider)||!Array.isArray(q?.bars)||q.bars.length>10000)return response({ok:false,error:'invalid minute input'},400);
   if((await pool(env)).get(code)!==market)return response({ok:false,error:'minute code/market outside frozen pool'},400);
   const groups=new Map();for(const b of q.bars){if(!validDate(b.date)||b.date<START||b.date>cutoff()||b.stock_id!==code||!/^\d{2}:\d{2}:00$/.test(b.minute||'')||b.minute<'09:00:00'||b.minute>'14:30:00'||![b.open,b.high,b.low,b.close,b.volume_shares].every(Number.isFinite)||b.open<=0||b.low<=0||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close))return response({ok:false,error:'minute OHLCV validation failed'},422);const v=groups.get(b.date)||[];v.push(b);groups.set(b.date,v)}
   if(groups.size>35||!groups.size)return response({ok:false,error:'minute day count exceeds 35'},400);
   const out=[];for(const [date,bars] of groups){out.push(await internal(v,'minute','POST',{date,code,provider,market,bars}))}
   return response({ok:true,stored:out.length,days:out,model_replayed:false});
  }
  if(route==='chip'){
   const q=await req.json().catch(()=>null);const ds=q?.dataset,code=String(q?.code||''),from=q?.from,to=q?.to;
   if(!CHIP.includes(ds)||!/^\d{4}$/.test(code)||!validDate(from)||!validDate(to)||from<START||to>cutoff()||from>to||Date.parse(to)-Date.parse(from)>31*86400000)return response({ok:false,error:'invalid code/dataset/range'},400);
   if(!(await pool(env)).has(code))return response({ok:false,error:'code not in frozen 233'},400);
   const cal=await internal(v,'calendar');const dates=cal.dates?.filter(d=>d>=from&&d<=to)||[];
   if(!dates.length)return response({ok:false,error:'calendar has no verified sessions; request calendar first'},409);
   const state=await internal(v,'status');const need=dates.filter(d=>!state.days?.find(x=>x.date===d)?.chips?.[ds]?.saved_codes?.includes(code));
   if(!need.length)return response({ok:true,cached:true,code,dataset:ds,dates:dates.length,model_replayed:false});
   const permit=await reserve(v);if(!permit.ok)return response({...permit,code:'FREE_RATE_LIMIT'},429);
   const rows=await finmind(token,ds,code,from,to);
   const selected=rows.filter(x=>x&&x.stock_id===code&&validDate(x.date)&&dates.includes(x.date));
   if(selected.length>8000)throw Error('Unexpected FinMind row count');
   return response({...await internal(v,'chip','POST',{code,dataset:ds,dates:need,rows:selected,source:'FinMind Free per-stock data_id'}),cached:false,model_replayed:false});
  }
  return response({ok:false,error:'unknown'},404)
 }catch(e){const m=String(e.message||e).slice(0,280),status=e.status===429?429:e.status===401||e.status===403?403:e.status===409?409:502;return response({ok:false,error:m,model_replayed:false},status)}
}
export class C30FreeStore{
 constructor(ctx){this.ctx=ctx;this.s=ctx.storage}
 async fetch(req){const u=new URL(req.url),route=u.pathname.split('/').at(-1),method=req.method;
  try{
   if(route==='reserve'&&method==='POST'){
    const now=Date.now(),last=await this.s.get('rate:next')||0;
    if(now<last)return response({ok:false,error:'FinMind Free pacing',retry_after_ms:last-now+100},429);
    await this.s.put('rate:next',now+8000);return response({ok:true,next_at:now+8000});
   }
   if(route==='calendar'&&method==='GET')return response({ok:true,...await this.s.get('calendar')||{as_of:null,dates:[]}});
   if(route==='calendar'&&method==='POST'){
    const b=await req.json();if(!validDate(b.as_of)||!Array.isArray(b.dates)||b.dates.length>1000||b.dates.some(d=>!validDate(d)||d<START||d>b.as_of))return response({ok:false,error:'invalid calendar'},400);
    const obj={ok:true,as_of:b.as_of,dates:[...new Set(b.dates)].sort(),updated_at:new Date().toISOString()};await this.s.put('calendar',obj);return response(obj);
   }
   if(route==='official'&&method==='POST'){
    const b=await req.json(),date=b.date;if(!validDate(date)||date<START||!Array.isArray(b.rows)||b.rows.length>233||b.rows.length<200)return response({ok:false,error:'invalid official rows'},400);
    const ids=new Set();for(const x of b.rows){if(!/^\d{4}$/.test(x.code||'')||x.date!==date||ids.has(x.code)||![x.open,x.high,x.low,x.close,x.volume_shares].every(Number.isFinite)||x.low>Math.min(x.open,x.close)||x.high<Math.max(x.open,x.close))return response({ok:false,error:'invalid OHLCV or duplicate code'},422);ids.add(x.code)}
    const index=await this.s.get('index:'+date)||{chips:{}};index.price={state:ids.size>=225?'available':'partial',stock_count:ids.size,source:b.source,updated_at:new Date().toISOString()};
    await this.s.put({['price:'+date]:b.rows,['index:'+date]:index});return response({ok:true,stored:true,as_of:date,stock_count:ids.size,missing:233-ids.size,state:index.price.state});
   }
   if(route==='chip'&&method==='POST'){
    const b=await req.json(),dates=b.dates||[],ds=b.dataset,code=b.code;
    if(!CHIP.includes(ds)||!/\d{4}/.test(code)||!Array.isArray(dates)||!dates.length||dates.length>32||dates.some(x=>!validDate(x)||x<START)||!Array.isArray(b.rows)||b.rows.length>8000)return response({ok:false,error:'invalid chip input'},400);
    const by=new Map(dates.map(d=>[d,[]]));for(const x of b.rows){if(!by.has(x.date)||x.stock_id!==code)return response({ok:false,error:'FinMind symbol/date mismatch'},422);by.get(x.date).push(x)}
    let written=0,empty=0;for(const [date,rows] of by){
     const index=await this.s.get('index:'+date)||{chips:{}};index.chips??={};index.chips[ds]??={};
     const current=index.chips[ds][code];if(current?.state==='available'||current?.state==='empty_checked')continue;
     index.chips[ds][code]={state:rows.length?'available':'empty_checked',rows:rows.length,source:b.source,updated_at:new Date().toISOString()};
     await this.s.put({['chip:'+date+':'+ds+':'+code]:rows,['index:'+date]:index});written++;if(!rows.length)empty++;
    }
    return response({ok:true,stored:true,dataset:ds,code,days_saved:written,empty_days:empty});
   }
   if(route==='minute'&&method==='POST'){
    const q=await req.json(),{code,date,market,provider}=q;
    if(!validDate(date)||date<START||!/^\d{4}$/.test(code)||!['Fugle Free API','Yahoo chart fallback'].includes(provider)||!['TWSE','TPEx'].includes(market)||!Array.isArray(q.bars)||q.bars.length>340)return response({ok:false,error:'bad minute payload'},400);
    const key='minute:'+date+':'+code,old=await this.s.get(key);
    if(old?.provider==='Fugle Free API'&&provider!=='Fugle Free API')return response({ok:true,skipped:true,date,code});
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
    for(const [key,idx] of m){const date=key.slice(6),chips={};for(const ds of CHIP){const obj=idx.chips?.[ds]||{};chips[ds]={saved_codes:Object.keys(obj).filter(x=>['available','empty_checked'].includes(obj[x].state)),available:Object.values(obj).filter(x=>x.state==='available').length,empty:Object.values(obj).filter(x=>x.state==='empty_checked').length}}days.push({date,price:idx.price||null,chips,minute:{saved_codes:Object.keys(mins.get('minuteIndex:'+date)||{}),count:Object.keys(mins.get('minuteIndex:'+date)||{}).length}})}
    for(const [key,info] of mins){const date=key.slice('minuteIndex:'.length);if(!days.some(x=>x.date===date))days.push({date,price:null,chips:Object.fromEntries(CHIP.map(ds=>[ds,{saved_codes:[],available:0,empty:0}])),minute:{saved_codes:Object.keys(info),count:Object.keys(info).length}})}
    days.sort((a,b)=>a.date.localeCompare(b.date));return response({ok:true,days,stored_days:days.length,latest_price_date:days.filter(x=>x.price?.state==='available').at(-1)?.date||null,complete_days:days.filter(x=>x.price?.state==='available'&&CHIP.every(ds=>x.chips[ds].saved_codes.length===233)).length,model_replayed:false,freeze_end:'2026-11-20',source:'Free: official TWSE/TPEx + FinMind per-stock'});
   }
   if(route==='day'&&method==='GET'){
    const date=u.searchParams.get('date'),dataset=u.searchParams.get('dataset');if(!validDate(date)||date<START||dataset&&![...ALL,'minute'].includes(dataset))return response({ok:false,error:'invalid date/dataset'},400);
    if(dataset==='minute'){const index=await this.s.get('minuteIndex:'+date)||{},code=u.searchParams.get('code');if(code&&!/^\d{4}$/.test(code))return response({ok:false,error:'invalid code'},400);const ids=code?[code]:Object.keys(index);if(ids.length>12)return response({ok:false,error:'minute day export must be batched by code (max 12)'},413);const items=[];for(const id of ids){const item=await this.s.get('minute:'+date+':'+id);if(item)items.push(item)}return response({ok:true,date,items,model_replayed:false})}
    const idx=await this.s.get('index:'+date)||{},sets={};if(!dataset||dataset==='TaiwanStockPrice')sets.TaiwanStockPrice={meta:idx.price||null,rows:await this.s.get('price:'+date)||[]};
    for(const ds of dataset&&dataset!=='TaiwanStockPrice'?[dataset]:!dataset?CHIP:[]){const status=idx.chips?.[ds]||{},all=[];for(const code of Object.keys(status)){const value=await this.s.get('chip:'+date+':'+ds+':'+code);if(Array.isArray(value))all.push(...value)}sets[ds]={meta:{saved_count:Object.keys(status).length,complete:Object.keys(status).length===233},rows:all}}
    return response({ok:true,date,datasets:sets,price_ready:idx.price?.state==='available'||false,full_model_replay_ready:false,model_replayed:false});
   }
   return response({ok:false,error:'not found'},404)
  }catch(e){return response({ok:false,error:String(e.message||e).slice(0,240)},500)}
 }
}
export const C30_FREE_DATASETS=ALL;