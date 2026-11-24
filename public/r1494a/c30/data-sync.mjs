/* C30 device-local FinMind token + Cloudflare private incremental daily data.
 * Never stores token on server and NEVER calculates new C30 trade signals.
 */
const BASE='/api/c30/daily/',LOCK_DATE='2026-11-20';
export const C30_DAILY_DATASETS=[
 ['TaiwanStockPrice','日 K'],
 ['TaiwanStockInstitutionalInvestorsBuySell','三大法人'],
 ['TaiwanStockMarginPurchaseShortSale','融資融券'],
 ['TaiwanStockSecuritiesLending','借券']
];
export const C30_FREEZE_DATE=LOCK_DATE;
export function c30DeviceToken(explicit=''){
 const x=String(explicit||globalThis.C26DeviceFinMind?.activeToken?.()||globalThis.localStorage?.getItem('c26-finmind-device-token-v1')||globalThis.TWFinMindTokens?.activeToken?.()||'').trim().replace(/\\_/g,'_');
 return x.length>=30&&!/\s/.test(x)?x:'';
}
function headers(token){return {Authorization:'Bearer '+token}}
async function call(token,path,method='GET',body){
 const r=await fetch(BASE+path,{method,headers:{...headers(token),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
 let obj={};try{obj=await r.json()}catch{}
 if(!r.ok||obj.ok===false)throw Error(obj.error||'C30 雲端 API HTTP '+r.status);
 return obj;
}
export async function readC30StoredStatus(token=c30DeviceToken()){
 if(!token)return {ok:false,needs_token:true,model_replayed:false,days:[],stored_days:0,complete_days:0,as_of:null,latest_price_date:null};
 return call(token,'status');
}
export async function readC30StoredDay(date,dataset=null,token=c30DeviceToken()){
 if(!token)throw Error('請先設定 FinMind Token');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('日期格式不正確');
 return call(token,'day?date='+encodeURIComponent(date)+(dataset?'&dataset='+encodeURIComponent(dataset):''));
}
export async function syncC30FinMind(token=c30DeviceToken(),progress=()=>{},opts={}){
 if(!token)throw Error('請先在 A56 共用監控台的 FinMind 欄位輸入 Token');
 progress('檢查雲端已封存的 C30 資料，不重下載歷史…');
 let state=await readC30StoredStatus(token);
 progress('查詢已封存交易日清單；只補 2026/11/20 以後的新資料…');
 const calendar=await call(token,'calendar','POST',{});
 const days=calendar.dates||[];
 const missing=[];
 for(const day of days){
  const rec=state.days?.find(x=>x.date===day)?.datasets||{};
  for(const [dataset,label] of C30_DAILY_DATASETS)if(rec[dataset]?.state!=='available')missing.push({date:day,dataset,label});
 }
 const max=opts.auto?16:Math.max(1,missing.length),queue=missing.slice(0,max),errors=[];let saved=0,cacheHits=0;
 if(!missing.length){progress('C30 所有已完成交易日都已封存，直接沿用雲端，不消耗 FinMind 下載額度。');return {...state,checked_at:new Date().toISOString(),calendar_as_of:calendar.as_of,missing:0,downloaded:0,cache_hits:0,errors:[],all_current:true}}
 for(let i=0;i<queue.length;i++){
  const x=queue[i];progress('C30 增量 '+(i+1)+'/'+queue.length+'：'+x.date+' '+x.label);
  try{
   const reply=await call(token,'refresh','POST',{date:x.date,dataset:x.dataset});
   if(reply.cache_hit)cacheHits++;else saved++;
  }catch(e){
   errors.push({date:x.date,dataset:x.dataset,reason:String(e?.message||e)});
   // Do not turn failed FinMind responses into complete trading records.
  }
  if(i<queue.length-1)await new Promise(r=>setTimeout(r,280));
 }
 state=await readC30StoredStatus(token);
 const remaining=days.reduce((n,date)=>{
  const rec=state.days?.find(x=>x.date===date)?.datasets||{};
  return n+C30_DAILY_DATASETS.filter(([ds])=>rec[ds]?.state!=='available').length;
 },0);
 progress('C30 雲端增量已保存 '+saved+' 個資料集，尚缺 '+remaining+' 個日期／資料集'+(errors.length?'；失敗 '+errors.length+' 項，原有成功資料未覆蓋':'')+'。');
 return {...state,checked_at:new Date().toISOString(),calendar_as_of:calendar.as_of,downloaded:saved,cache_hits:cacheHits,missing:remaining,pending_not_started:Math.max(0,missing.length-queue.length),errors,all_current:remaining===0};
}
export function c30StatusSummary(x){
 if(!x||x.needs_token)return '尚未設定 FinMind Token，無法讀取私人雲端日K／籌碼';
 return '雲端封存 '+(x.stored_days||0)+' 個交易日；日K至 '+(x.latest_price_date||'尚無')+'；全部四類資料完成 '+(x.complete_days||0)+' 日'+(x.missing?'；尚缺 '+x.missing+' 項':'');
}
