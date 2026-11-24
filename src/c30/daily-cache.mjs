/* C30 daily FinMind incremental cache: bearer token stays in request memory.
 * Each token has a separate durable namespace, derived from SHA-256 digest.
 * Only C30 original research universe (233 symbols); no C30 trading signal generation.
 */
const DS=['TaiwanStockPrice','TaiwanStockInstitutionalInvestorsBuySell','TaiwanStockMarginPurchaseShortSale','TaiwanStockSecuritiesLending'];
const START='2026-11-23',ROOT='/api/c30/daily/';
const j=(o,status=200)=>Response.json(o,{status,headers:{'cache-control':'no-store','x-c30-signal':'not-replayed'}});
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const sha=async bytes=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
const dateOK=d=>{if(!/^20\d{2}-\d{2}-\d{2}$/.test(d||''))return false;try{return new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d}catch{return false}};
const nextDay=d=>new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10);
const clock=()=>new Date(Date.now()+8*3600000).toISOString();
function cutoff(){const n=clock(),d=n.slice(0,10);return n.slice(11,16)>='20:00'?d:new Date(Date.parse(d+'T00:00:00Z')-86400000).toISOString().slice(0,10)}
const tokenFrom=req=>{const h=req.headers.get('authorization')||'',t=h.startsWith('Bearer ')?h.slice(7).trim():'';return t.length>=30&&t.length<=4096&&!/\s/.test(t)?t:null};
async function finmind(token,dataset,start,end){const q=new URLSearchParams({dataset,start_date:start,end_date:end});let r;try{r=await fetch('https://api.finmindtrade.com/api/v4/data?'+q.toString(),{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(24000),cache:'no-store'})}catch(e){throw Error('FinMind 連線失敗（'+String(e?.name||'Error')+'）')}
 if(!r.ok)throw Error('FinMind HTTP '+r.status);
 const x=await r.json().catch(()=>null);
 if(x?.status!==200||!Array.isArray(x.data))throw Error('FinMind '+(x?.msg||'回傳格式或權限異常'));
 return x.data;
}
let poolPromise=null;
async function universe(env){if(!poolPromise)poolPromise=(async()=>{const r=await env.ASSETS.fetch(new Request('https://assets.local/c30/pool.json'));if(!r.ok)throw Error('C30 固定股池檔案不存在');const j=await r.json();if(j.stocks?.length!==233||new Set(j.stocks.map(x=>x.code)).size!==233)throw Error('C30 233 股池核對未通過');return new Set(j.stocks.map(x=>x.code))})().catch(e=>{poolPromise=null;throw e});return poolPromise;}
async function stub(env,token){if(!env.SCAN_JOBS)throw Error('Cloudflare SCAN_JOBS 儲存綁定不存在');const digest=await sha(new TextEncoder().encode(token));return env.SCAN_JOBS.get(env.SCAN_JOBS.idFromName('private:c30:finmind:'+digest));}
async function inside(stub,method,path,data){const r=await stub.fetch(new Request('https://c30-daily.internal/c30-daily-internal/'+path,{method,headers:{'content-type':'application/json'},...(data!==undefined?{body:JSON.stringify(data)}:{})}));if(!r.ok)throw Error('C30 雲端儲存 HTTP '+r.status);return r.json();}
export async function c30DailyRoute(req,env){
 const url=new URL(req.url),path=url.pathname.slice(ROOT.length);
 if(!url.pathname.startsWith(ROOT)||!['status','calendar','refresh','day'].includes(path))return j({ok:false,error:'C30 API not found'},404);
 if(req.method!==(path==='status'||path==='day'?'GET':'POST'))return j({ok:false,error:'Method not allowed'},405);
 const origin=req.headers.get('origin');if(origin&&origin!==url.origin)return j({ok:false,error:'Invalid origin'},403);
 const token=tokenFrom(req);if(!token)return j({ok:false,error:'請先在此裝置輸入有效 FinMind Token'},401);
 try{
  const vault=await stub(env,token);
  if(path==='status')return j(await inside(vault,'GET','status'));
  if(path==='day'){
   const date=url.searchParams.get('date'),dataset=url.searchParams.get('dataset');
   if(!dateOK(date)||dataset&&!DS.includes(dataset))return j({ok:false,error:'Invalid day or dataset'},400);
   return j(await inside(vault,'GET','day?date='+date+(dataset?'&dataset='+dataset:'')));
  }
  const x=await req.json().catch(()=>({})),through=cutoff();
  if(path==='calendar'){
   const cache=await inside(vault,'GET','calendar');
   if(cache.as_of===through&&Array.isArray(cache.dates)&&cache.dates.length)return j({...cache,cache_hit:true});
   const data=await finmind(token,'TaiwanStockTradingDate',START,nextDay(through));
   const dates=[...new Set(data.map(r=>r.date).filter(d=>dateOK(d)&&d>=START&&d<=through))].sort();
   // Some account tiers return only an older partial calendar. Do not pretend it is current.
   if(!dates.length)throw Error('FinMind 無法提供 '+START+' 以後的交易日清單');
   const out=await inside(vault,'POST','calendar',{as_of:through,dates,updated_at:new Date().toISOString()});
   return j({...out,cache_hit:false});
  }
  if(!dateOK(x.date)||x.date<START||x.date>through||!DS.includes(x.dataset))return j({ok:false,error:'資料日期或資料集不合法；僅更新已完成盤後資料'},400);
  const existing=await inside(vault,'GET','state?date='+x.date+'&dataset='+x.dataset);
  if(existing.saved&&existing.state==='available'&&!x.force)return j({...existing,ok:true,cache_hit:true,model_replayed:false});
  const data=await finmind(token,x.dataset,x.date,nextDay(x.date));
  const codes=await universe(env);
  const selected=data.filter(row=>row?.date===x.date&&codes.has(String(row.stock_id||'')));
  // Daily price prices may omit suspended shares. Do not accept 0 or tiny feeds as complete.
  const stockCount=new Set(selected.map(r=>String(r.stock_id))).size;
  let validPrice=0;
  if(x.dataset==='TaiwanStockPrice'){
   validPrice=selected.filter(row=>[row.open,row.max,row.min,row.close,row.Trading_Volume].every(v=>Number.isFinite(Number(v)))&&Number(row.open)>0&&Number(row.max)>=Number(row.min)&&Number(row.close)>0&&Number(row.Trading_Volume)>=0).length;
  }
  const available=x.dataset==='TaiwanStockPrice'?validPrice>=185:selected.length>0;
  if(!available)return j({ok:false,source:'FinMind',date:x.date,dataset:x.dataset,state:'partial',rows:selected.length,stock_count:stockCount,error:'FinMind 資料筆數不足，未標記為完整。資料仍保留之前成功的雲端版本。'},409);
  const save=await inside(vault,'POST','save',{date:x.date,dataset:x.dataset,rows:selected,stock_count:stockCount,price_valid:validPrice,source:'FinMind v4 (device token)',updated_at:new Date().toISOString()});
  return j({...save,ok:true,cache_hit:false,model_replayed:false});
 }catch(e){const m=String(e?.message||e);return j({ok:false,error:m.slice(0,240),model_replayed:false},m.includes('HTTP 429')?429:m.includes('HTTP 403')||m.includes('HTTP 401')?403:502)}
}
const safeDate=(d)=>dateOK(d)&&d>=START;
export class C30DailyStore{
 constructor(ctx){this.storage=ctx.storage}
 async fetch(req){
  const url=new URL(req.url),path=url.pathname.split('/').at(-1);
  try{
   const index=await this.storage.get('c30:index')||{dates:{},last_saved:null};
   if(path==='status'&&req.method==='GET'){
    const dates=Object.entries(index.dates).map(([date,datasets])=>({date,datasets})).sort((a,b)=>a.date.localeCompare(b.date));
    const complete=dates.filter(x=>DS.every(ds=>x.datasets[ds]?.state==='available'));
    return j({ok:true,source:'FinMind (private cloud cache)',as_of:complete.at(-1)?.date||null,latest_price_date:dates.filter(x=>x.datasets.TaiwanStockPrice?.state==='available').at(-1)?.date||null,days:dates,complete_days:complete.length,stored_days:dates.length,model_replayed:false,freeze_end:'2026-11-20',updated_at:index.last_saved});
   }
   if(path==='calendar'&&req.method==='GET')return j(await this.storage.get('c30:calendar')||{ok:true,dates:[],as_of:null});
   if(path==='calendar'&&req.method==='POST'){
    const x=await req.json();if(!safeDate(x.as_of)||!Array.isArray(x.dates)||x.dates.length>400||x.dates.some(d=>!safeDate(d)||d>x.as_of))return j({ok:false,error:'Invalid calendar'},400);
    const data={ok:true,as_of:x.as_of,dates:x.dates,updated_at:x.updated_at};await this.storage.put('c30:calendar',data);return j(data);
   }
   if(path==='state'&&req.method==='GET'){
    const date=url.searchParams.get('date'),dataset=url.searchParams.get('dataset');
    if(!safeDate(date)||!DS.includes(dataset))return j({ok:false,error:'Invalid state query'},400);
    const meta=index.dates[date]?.[dataset];return j({ok:true,saved:!!meta,...meta});
   }
   if(path==='save'&&req.method==='POST'){
    const x=await req.json(),date=x.date,ds=x.dataset;
    if(!safeDate(date)||!DS.includes(ds)||!Array.isArray(x.rows)||x.rows.length>6500||x.rows.some(r=>r.date!==date||!/^(\d{4})$/.test(String(r.stock_id||''))))return j({ok:false,error:'Invalid C30 dataset'},400);
    const record=JSON.stringify(x.rows),step=85000,parts=[];
    for(let i=0;i<record.length;i+=step)parts.push(record.slice(i,i+step));
    if(!parts.length||parts.length>75)return j({ok:false,error:'C30 dataset too large'},413);
    const old=index.dates[date]?.[ds];
    // Versioned parts prevent active readers from observing overwritten partial content.
    const id=crypto.randomUUID();for(let i=0;i<parts.length;i++)await this.storage.put('c30:blob:'+date+':'+ds+':'+id+':'+i,parts[i]);
    const meta={state:'available',rows:x.rows.length,stock_count:x.stock_count,price_valid:x.price_valid||0,source:x.source,updated_at:x.updated_at,parts:parts.length,id};
    index.dates[date]??={};index.dates[date][ds]=meta;index.last_saved=x.updated_at;
    await this.storage.put('c30:index',index);
    if(old?.id){for(let i=0;i<old.parts;i++)await this.storage.delete('c30:blob:'+date+':'+ds+':'+old.id+':'+i)}
    return j({ok:true,stored:true,date,dataset:ds,rows:x.rows.length,stock_count:x.stock_count,price_valid:x.price_valid,updated_at:x.updated_at});
   }
   if(path==='day'&&req.method==='GET'){
    const date=url.searchParams.get('date'),ds=url.searchParams.get('dataset');
    if(!safeDate(date)||ds&&!DS.includes(ds))return j({ok:false,error:'Bad day'},400);
    const out={ok:true,date,model_replayed:false,datasets:{}};
    for(const name of ds?[ds]:DS){
     const m=index.dates[date]?.[name];if(!m)continue;
     const chunks=[];for(let i=0;i<m.parts;i++){const part=await this.storage.get('c30:blob:'+date+':'+name+':'+m.id+':'+i);if(typeof part!=='string')return j({ok:false,error:'Cloud chunk missing '+name},503);chunks.push(part)}
     let rows;try{rows=JSON.parse(chunks.join(''))}catch{return j({ok:false,error:'Cloud data damaged '+name},503)}
     out.datasets[name]={meta:m,rows};
    }
    return j(out);
   }
   return j({ok:false,error:'C30 internal route not found'},404)
  }catch(e){return j({ok:false,error:String(e?.message||e).slice(0,160)},500)}
 }
}
export const C30_DAILY_DATASETS=DS;
