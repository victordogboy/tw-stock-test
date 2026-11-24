/* Shared 233-stock Free-plan source sync for C30 and A56.
 * FinMind stock datasets use data_id; official EOD snapshots do not use FinMind quota.
 * All records persisted server-side by date/dataset/stock, token never in GitHub.
 */
const API='/api/c30/free/';
const THREE=[['TaiwanStockInstitutionalInvestorsBuySell','三大法人'],['TaiwanStockMarginPurchaseShortSale','融資融券'],['TaiwanStockSecuritiesLending','借券成交']];
let cachedPool=null,active=null,stopped=false;
const INTERVAL_KEY='c30-a56-free-request-interval-ms-v1';
export function getC30FreeIntervalMs(){
 try{const v=Number(globalThis.localStorage?.getItem(INTERVAL_KEY));return Number.isFinite(v)&&v>=6500&&v<=30000&&v%500===0?v:8000}catch{return 8000}
}
export function setC30FreeIntervalMs(value){
 const ms=Math.round(Number(value)/500)*500;
 if(!Number.isFinite(ms)||ms<6500||ms>30000)throw Error('FinMind Free 請求間隔必須介於 6.5～30 秒，並以 0.5 秒遞增');
 globalThis.localStorage?.setItem(INTERVAL_KEY,String(ms));return ms
}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const today=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const fToken=x=>String(x||globalThis.C26DeviceFinMind?.activeToken?.()||globalThis.localStorage?.getItem('c26-finmind-device-token-v1')||globalThis.TWFinMindTokens?.activeToken?.()||'').trim().replace(/\\_/g,'_');
export function c30FreeToken(explicit=''){const t=fToken(explicit);return t.length>=30&&t.length<=4096&&!/\s/.test(t)?t:''}
async function call(token,path,method='GET',body){
 if(!token)throw Error('缺少 FinMind Free Token：請在 A56 原本的 Token 區儲存');
 const r=await fetch(API+path,{method,cache:'no-store',headers:{Authorization:'Bearer '+token,'x-c30-free-interval-ms':String(getC30FreeIntervalMs()),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 let out;try{out=await r.json()}catch{throw Error('C30 免費資料服務無效 HTTP '+r.status)}
 if(!r.ok||out.ok===false){const e=new Error(out.error||'HTTP '+r.status);e.status=r.status;e.retry_after_ms=out.retry_after_ms||0;throw e}
 return out;
}
async function pool(){if(cachedPool)return cachedPool;const r=await fetch('/c30/pool.json',{cache:'force-cache'}),p=await r.json();if(p.stocks?.length!==233)throw Error('原版 233 檔股票池驗收失敗');cachedPool=p.stocks.map(x=>x.code);return cachedPool}
export async function c30FreeStatus(token=c30FreeToken()){
 if(!token)return {ok:false,needs_token:true,days:[],stored_days:0,complete_days:0,latest_price_date:null,model_replayed:false};
 return call(token,'status');
}
export async function c30FreeDownloadDay(date,dataset,token=c30FreeToken()){return call(token,'day?date='+encodeURIComponent(date)+(dataset?'&dataset='+encodeURIComponent(dataset):''))}
export function stopC30FreeSync(){stopped=true}
export function c30FreeSummary(x){
 if(!x||x.needs_token)return '尚未輸入 FinMind Free Token';
 const pending=x.pending===undefined?'':('，剩餘 '+x.pending+' 組股票／資料集');
 return '官方日 K '+(x.latest_price_date||'尚無')+'；雲端 '+(x.stored_days||0)+' 個資料日；完整 '+(x.complete_days||0)+' 日'+pending;
}
function remainingTasks(days,codes){const list=[];const slots=new Map();
 for(const d of days){const record=d.stored||null,st=record||{};
  // Official snapshots can be unavailable for older dates. Backfill ONLY missing price symbols via FinMind Free data_id.
  const priceSaved=new Set(st.price?.saved_codes||[]);
  if(priceSaved.size<codes.length){
   for(const code of codes)if(!priceSaved.has(code)){const k='TaiwanStockPrice|'+code,arr=slots.get(k)||[];arr.push(d.date);slots.set(k,arr)}
  }
  for(const [dataset,label] of THREE){const saved=new Set(st.chips?.[dataset]?.saved_codes||[]);
   for(const code of codes)if(!saved.has(code)){
    const k=dataset+'|'+code,arr=slots.get(k)||[];arr.push(d.date);slots.set(k,arr)
   }
  }
 }
 for(const [k,dates] of slots){const [dataset,code]=k.split('|'),label=dataset==='TaiwanStockPrice'?'官方缺漏日 K 回補':THREE.find(x=>x[0]===dataset)?.[1]||dataset;
  for(let i=0;i<dates.length;){let j=i;while(j+1<dates.length&&Date.parse(dates[j+1])-Date.parse(dates[i])<=31*86400000)j++;
   list.push({dataset,code,label,from:dates[i],to:dates[j],dates:j-i+1});i=j+1}
 }
 return list;
}
function sessionDays(calendar,status){return (calendar.dates||[]).map(date=>({date,stored:(status.days||[]).find(x=>x.date===date)}));}
export async function updateC30A56Free(token=c30FreeToken(),notify=()=>{},{auto=false,maxRequests,onlyPrices=false}={}){
 if(active)return active;
 if(!token)throw Error('請先填入 FinMind Free Token');
 stopped=false;
 active=(async()=>{
  notify('FinMind Free 請求間隔 '+(getC30FreeIntervalMs()/1000).toFixed(1)+' 秒；正在讀取雲端已保存的資料，不下載歷史整包…');
  const codes=await pool();let state=await c30FreeStatus(token);
  let calendar;
  for(let retry=0;retry<4;retry++){
   try{calendar=await call(token,'calendar','POST',{});break}catch(e){if(e.status!==429||retry===3)throw e;await delay(Math.min(35000,e.retry_after_ms||getC30FreeIntervalMs()))}
  }
  let priceResult=null;
  try{priceResult=await call(token,'official','POST',{});if(!priceResult.cached)notify('已保存官方上市／上櫃日K：'+priceResult.as_of+'，'+priceResult.stock_count+'/233 檔')}catch(e){notify('官方日K未完整：'+e.message+'；原有成功資料保留')}
  state=await c30FreeStatus(token);
  const dates=sessionDays(calendar,state),work=remainingTasks(dates,codes),max=onlyPrices?0:Math.min(work.length,maxRequests??(auto?6:80)),errors=[];
  let downloaded=0,checkedEmpty=0,skipped=0;
  for(let i=0;i<max&&!stopped;i++){
   const job=work[i];notify('FinMind Free：'+(i+1)+'/'+max+'　'+job.code+' '+job.label+'　'+job.from+'～'+job.to+'；成功 '+downloaded+'，失敗 '+errors.length);
   let pass=false;
   for(let tries=0;tries<3&&!pass&&!stopped;tries++){
    try{const x=await call(token,'chip','POST',job);pass=true;downloaded+=x.cached?0:1;skipped+=x.cached?1:0;checkedEmpty+=x.empty_days||0}
    catch(e){if(e.status===429&&tries<2){await delay(Math.min(35000,Math.max(1200,e.retry_after_ms||getC30FreeIntervalMs())));continue}
     errors.push({code:job.code,dataset:job.dataset,from:job.from,to:job.to,error:e.message});break}
   }
   // Server enforces the user-selected interval across multiple tabs for the same token (minimum 6.5 seconds).
   if(i<max-1&&!stopped)await delay(getC30FreeIntervalMs()+50);
  }
  state=await c30FreeStatus(token);const pending=remainingTasks(sessionDays(calendar,state),codes).length;
  const result={...state,downloaded,cached:skipped,empty_checked:checkedEmpty,pending,interrupted:stopped,errors,calendar_as_of:calendar.as_of,price:priceResult,model_replayed:false};
  notify('C30/A56 免費原始資料：'+c30FreeSummary(result)+(stopped?'（已中止，可續傳）':'')+(errors.length?'；錯誤 '+errors.length+' 項':'')+'。策略原引擎尚未重播。');
  return result;
 })().finally(()=>{active=null});
 return active;
}