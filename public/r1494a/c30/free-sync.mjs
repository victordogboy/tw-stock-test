/* Shared 233-stock Free-plan source sync for C30 and A56.
 * FinMind stock datasets use data_id; official EOD snapshots do not use FinMind quota.
 * All records persisted server-side by date/dataset/stock, token never in GitHub.
 */
const API='/api/c30/free/';
const THREE=[['TaiwanStockInstitutionalInvestorsBuySell','三大法人'],['TaiwanStockMarginPurchaseShortSale','融資融券'],['TaiwanStockSecuritiesLending','借券成交']];
let cachedPool=null,active=null,stopped=false;
const INTERVAL_KEY='c30-a56-request-interval-ms-v2',SPONSOR_INTERVAL_KEY='c30-a56-sponsor-request-interval-ms-v1',TIER_KEY='c30-a56-source-tier-v1';
export function getC30FreeIntervalMs(tier=getC30SourceTier()){
 const isSponsor=tier==='sponsor',fallback=isSponsor?100:1000,min=isSponsor?50:1000,step=isSponsor?50:500;
 try{const raw=globalThis.localStorage?.getItem(isSponsor?SPONSOR_INTERVAL_KEY:INTERVAL_KEY);if(raw===null||raw===undefined||raw==='')return fallback;
 const v=Number(raw);return Number.isFinite(v)&&v>=min&&v<=30000&&v%step===0?v:fallback}catch{return fallback}
}
export function setC30FreeIntervalMs(value,tier=getC30SourceTier()){
 const isSponsor=tier==='sponsor',step=isSponsor?50:500,min=isSponsor?50:1000,ms=Math.round(Number(value)/step)*step;
 if(!Number.isFinite(ms)||ms<min||ms>30000)throw Error(isSponsor?'Sponsor S 間隔需介於 0.05～30 秒，調整單位 0.05 秒':'Free 間隔需介於 1～30 秒，調整單位 0.5 秒');
 globalThis.localStorage?.setItem(isSponsor?SPONSOR_INTERVAL_KEY:INTERVAL_KEY,String(ms));return ms
}
export function getC30SourceTier(){
 try{return globalThis.localStorage?.getItem(TIER_KEY)==='sponsor'?'sponsor':'free'}catch{return 'free'}
}
export function setC30SourceTier(tier){
 if(!['free','sponsor'].includes(tier))throw Error('請選 Free 或 Sponsor（S）');
 globalThis.localStorage?.setItem(TIER_KEY,tier);return tier
}
const ERROR_KEY='c30-a56-last-source-diagnostics-v1';
function scrubError(message){return String(message||'').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[TOKEN_HIDDEN]').slice(0,240)}
function persistErrors(errors){try{globalThis.localStorage?.setItem(ERROR_KEY,JSON.stringify({at:new Date().toISOString(),items:errors.slice(-30)}))}catch{}}
export function c30LastSourceErrors(){try{return JSON.parse(globalThis.localStorage?.getItem(ERROR_KEY)||'{"items":[]}')}catch{return {items:[]}}}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const today=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const fToken=x=>String(x||globalThis.C26DeviceFinMind?.activeToken?.()||globalThis.localStorage?.getItem('c26-finmind-device-token-v1')||globalThis.TWFinMindTokens?.activeToken?.()||'').trim().replace(/\\_/g,'_');
export function c30FreeToken(explicit=''){const t=fToken(explicit);return t.length>=30&&t.length<=4096&&!/\s/.test(t)?t:''}
async function call(token,path,method='GET',body,overrideTier=null){
 if(!token)throw Error('缺少 FinMind Free Token：請在 A56 原本的 Token 區儲存');
 const r=await fetch(API+path,{method,cache:'no-store',headers:{Authorization:'Bearer '+token,'x-c30-free-interval-ms':String(getC30FreeIntervalMs(overrideTier||getC30SourceTier())),'x-c30-source-tier':overrideTier||getC30SourceTier(),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 let out;try{out=await r.json()}catch{throw Error('C30 免費資料服務無效 HTTP '+r.status)}
 if(!r.ok||out.ok===false){const e=new Error(out.error||'HTTP '+r.status);e.status=r.status;e.retry_after_ms=out.retry_after_ms||0;e.code=out.code||'';throw e}
 return out;
}
async function pool(){if(cachedPool)return cachedPool;const r=await fetch('/c30/pool.json',{cache:'force-cache'}),p=await r.json();if(p.stocks?.length!==233)throw Error('原版 233 檔股票池驗收失敗');cachedPool=p.stocks.map(x=>x.code);return cachedPool}
export async function c30FreeStatus(token=c30FreeToken()){
 if(!token)return {ok:false,needs_token:true,days:[],stored_days:0,complete_days:0,latest_price_date:null,model_replayed:false};
 return call(token,'status');
}
export async function c30FreeDownloadDay(date,dataset,token=c30FreeToken()){return call(token,'day?date='+encodeURIComponent(date)+(dataset?'&dataset='+encodeURIComponent(dataset):''))}
export async function diagnoseC30Sponsor(token=c30FreeToken(),notify=()=>{},specifiedDate=''){
 if(!token)throw Error('請先在本機儲存 FinMind Token');
 if(getC30SourceTier()!=='sponsor')throw Error('請先將會員資料模式切到 Sponsor（S）');
 const cloud=await c30FreeStatus(token);
 const storedDates=(cloud.days||[]).map(x=>x.date).filter(x=>/^20\d\d-\d\d-\d\d$/.test(x)&&x>='2026-11-23').sort();
 const clock=new Date(Date.now()+8*3600000).toISOString(),through=clock.slice(11,16)>='20:00'?clock.slice(0,10):new Date(Date.parse(clock.slice(0,10)+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 const date=specifiedDate||storedDates.filter(d=>d<=through).at(-1)||'2026-11-23';
 if(!/^20\d\d-\d\d-\d\d$/.test(date)||date>through||date<'2026-11-23')throw Error('Sponsor 診斷日期必須是已完成的交易日');
 const results=[];
 for(const [dataset,code] of [['TaiwanStockPrice',null],['TaiwanStockKBar','2330']]){
  notify('正在單筆測試 '+dataset+'（'+date+'），不重抓整個 233 檔…');
  try{
   const answer=await call(token,'diagnose','POST',{dataset,date,...(code?{code}:{})},'sponsor');
   results.push({dataset,date,ok:answer.ok,rows:answer.total_rows||0,fields:answer.fields||[],message:answer.message||''});
  }catch(e){
   results.push({dataset,date,ok:false,http:e.status||null,code:e.code||null,message:scrubError(e.message),retry_after_ms:e.retry_after_ms||0});
   if(e.status===402||[401,403].includes(e.status)||e.code==='UPSTREAM_QUOTA')break;
  }
  if(dataset==='TaiwanStockPrice')await delay(Math.max(100,getC30FreeIntervalMs('sponsor')));
 }
 persistErrors(results.filter(x=>!x.ok).map(x=>({path:'diagnose',dataset:x.dataset,status:x.http,code:x.code,error:x.message})));
 notify('Sponsor 診斷 '+results.filter(x=>x.ok&&x.rows>0).length+'/'+results.length+' 項成功；'+results.map(x=>x.dataset+': '+(x.ok?x.rows+' 筆':x.message)).join('；'));
 return {ok:results.every(x=>x.ok&&x.rows>0),date,results};
}
export function stopC30FreeSync(){stopped=true}
export function c30FreeSummary(x){
 if(!x||x.needs_token)return '尚未輸入 FinMind Free Token';
 const pending=x.pending===undefined?'':('，剩餘 '+x.pending+' 組股票／資料集');
 return '官方日 K '+(x.latest_price_date||'尚無')+'；雲端 '+(x.stored_days||0)+' 個資料日；完整 '+(x.complete_days||0)+' 日'+pending;
}
export function remainingTasks(days,codes){const list=[];const slots=new Map();
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
export function batchJobs(days,stockCount=233){
 const list=[],datasets=['TaiwanStockPrice',...THREE.map(x=>x[0])];
 for(const d of days){
  for(const dataset of datasets){
   const c=dataset==='TaiwanStockPrice'?(d.price?.saved_codes?.length||0):(d.chips?.[dataset]?.saved_codes?.length||0);
   if(dataset==='TaiwanStockPrice'?!!d.market?.stored:(c>=stockCount||d.batch?.[dataset]?.done))continue;
   list.push({date:d.date,dataset,label:dataset==='TaiwanStockPrice'?'日K':THREE.find(x=>x[0]===dataset)?.[1]||dataset});
  }
 }
 return list;
}
export function minuteJobs(days,codes,upgradeSponsor=false){
 const jobs=[];
 for(const d of days){const have=new Set(d.minute?.saved_codes||[]),meta=d.minute?.meta||{};
  for(const code of codes){
   const cached=have.has(code),replace=upgradeSponsor&&cached&&meta[code]?.provider!=='FinMind Sponsor 1m';
   if(!cached||replace)jobs.push({date:d.date,code,force:replace})
  }
 }
 return jobs
}
function needsQuotaPause(e){
 return e.status===402||(e.status===429&&(['HOURLY_QUOTA','UPSTREAM_QUOTA'].includes(e.code)||e.retry_after_ms>60000));
}
async function quotaSafeRequest(token,path,body,notify,overrideTier){
 for(let retry=0;retry<4;retry++){
  try{return await call(token,path,'POST',body,overrideTier)}
  catch(e){
   if(needsQuotaPause(e))throw e;
   if(e.status===429&&retry<3){
    const wait=Math.max(50,Math.min(31000,e.retry_after_ms||getC30FreeIntervalMs(overrideTier)));
    notify('FinMind 請求間隔中，等待 '+(wait/1000).toFixed(1)+' 秒後繼續');
    await delay(wait);continue
   }
   throw e
  }
 }
}
export async function updateC30A56Free(token=c30FreeToken(),notify=()=>{},{auto=false,maxRequests,onlyPrices=false}={}){
 if(active)return active;
 if(!token)throw Error('請先填入 FinMind Token');
 stopped=false;
 active=(async()=>{
  let tier=getC30SourceTier(),pausedByQuota=null,permissionWarning='',fatalError=null,previousFailure='',repeatFailures=0;
  const interval=getC30FreeIntervalMs(tier),codes=await pool(),errors=[];
  notify((tier==='sponsor'?'Sponsor（S）批次':'Free 逐檔')+' 模式，每 '+(interval/1000).toFixed(1)+' 秒一筆；正在核對既有雲端資料…');
  let state=await c30FreeStatus(token),calendar;
  for(let retry=0;retry<4;retry++){
   try{calendar=await call(token,'calendar','POST',{},tier);break}
   catch(e){if(needsQuotaPause(e)){pausedByQuota=e;break}
    if(e.status===429&&retry<3){await delay(Math.min(31000,Math.max(50,e.retry_after_ms||interval)));continue}throw e}
  }
  if(!calendar){
   const result={...state,pending:0,paused_by_quota:true,retry_after_ms:pausedByQuota?.retry_after_ms||0,errors:[{error:pausedByQuota?.message||'交易日資料取得失敗'}],model_replayed:false};
   notify('已達 FinMind 額度，保留雲端資料；稍後可直接按續傳。');return result
  }
  try{await call(token,'official','POST',{},tier)}catch(e){notify('官方日 K 本次尚未更新：'+e.message+'；使用先前的封存內容。')}
  state=await c30FreeStatus(token);
  const dates=sessionDays(calendar,state).map(x=>({...x.stored,date:x.date})),
    cap=onlyPrices?0:Math.max(0,maxRequests??(auto?6:1000));
  let done=0,downloaded=0,skipped=0,emptyChecked=0;
  async function perform(path,body,label){
   if(stopped||done>=cap||pausedByQuota)return false;
   notify((tier==='sponsor'?'Sponsor（S）':'Free')+'　'+(done+1)+'/'+cap+'：'+label+'，已保存 '+downloaded+'，失敗 '+errors.length);
   try{
    const reply=await quotaSafeRequest(token,path,body,notify,tier);
    done++;if(reply.cached)skipped++;else downloaded++;emptyChecked+=reply.empty_days||0;
    if(!stopped&&done<cap)await delay(getC30FreeIntervalMs(tier)+10);
    return true
   }catch(e){
    if(needsQuotaPause(e)){pausedByQuota=e;notify('FinMind 額度不足，已保存進度；'+scrubError(e.message));return false}
    const item={path,label,http:e.status||null,code:e.code||null,error:scrubError(e.message),retry_after_ms:e.retry_after_ms||0};
    errors.push(item);persistErrors(errors);done++;
    notify('資料失敗 '+done+'/'+cap+'：'+label+'｜HTTP '+(item.http||'?')+'｜'+item.error);
    const signature=path+'|'+item.http+'|'+item.code+'|'+item.error;
    repeatFailures=signature===previousFailure?repeatFailures+1:1;previousFailure=signature;
    if([401,403].includes(e.status)&&path.startsWith('sponsor-')){
     fatalError='Sponsor 請求被拒絕：'+item.error+'。此錯誤不代表你沒有 Sponsor 資格，請先按單筆診斷。';
     notify(fatalError);return false
    }
    if(repeatFailures>=3||e.code==='MARKET_ROW_COUNT'){
     fatalError='連續 3 筆相同來源錯誤：'+item.error+'。已安全停止；請先執行 Sponsor 單筆診斷。';
     notify(fatalError);return false
    }
    if(!stopped&&done<cap)await delay(getC30FreeIntervalMs(tier)+10);
    return true
   }
  }
  if(tier==='sponsor'){
   for(const job of batchJobs(dates,codes.length)){
    if(stopped||pausedByQuota||fatalError||done>=cap)break;
    const ok=await perform('sponsor-batch',{date:job.date,dataset:job.dataset},job.date+' '+job.label+' 整市場批次');
    if(!ok&&tier!=='sponsor')break;
   }
  }
  state=await c30FreeStatus(token);
  let currentDays=sessionDays(calendar,state).map(x=>({...x.stored,date:x.date}));
  // Sponsor can fill missing one-minute candles; Free keeps Fugle/Yahoo instead.
  if(tier==='sponsor'&&!auto&&!pausedByQuota&&!stopped&&!fatalError&&done<cap){
   for(const job of minuteJobs(currentDays,codes,true)){
    if(stopped||pausedByQuota||fatalError||done>=cap)break;
    const ok=await perform('sponsor-minute',job,job.date+' '+job.code+' 現股1分K');
    if(!ok&&tier!=='sponsor')break;
   }
  }
  state=await c30FreeStatus(token);
  currentDays=sessionDays(calendar,state).map(x=>({...x.stored,date:x.date}));
  // Free per-symbol fallback ALSO repairs sparsely populated Sponsor batches.
  const queue=remainingTasks(currentDays,codes);
  for(const job of queue){
   if(stopped||pausedByQuota||fatalError||done>=cap)break;
   await perform('chip',job,job.code+' '+job.label+' '+job.from+'～'+job.to);
  }
  state=await c30FreeStatus(token);
  const updatedDays=sessionDays(calendar,state).map(x=>({...x.stored,date:x.date}));
  const pendingChips=remainingTasks(updatedDays,codes).length;
  const pendingMinutes=minuteJobs(updatedDays,codes,tier==='sponsor').length;
  const pendingSponsor=tier==='sponsor'?batchJobs(updatedDays,codes.length).length:0;
  const result={...state,downloaded,cached:skipped,empty_checked:emptyChecked,
    pending:pendingChips+(tier==='sponsor'?pendingMinutes+pendingSponsor:0),pending_chip:pendingChips,
    pending_minute:pendingMinutes,pending_sponsor:pendingSponsor,
    interrupted:stopped,paused_by_quota:!!pausedByQuota,blocked_by_error:!!fatalError,fatal_error:fatalError,
    retry_after_ms:pausedByQuota?.retry_after_ms||0,errors,
    warning:permissionWarning,calendar_as_of:calendar.as_of,tier_used:tier,
    model_replayed:false};
  persistErrors(errors);notify((fatalError?'已停止：'+fatalError+' ':pausedByQuota?'已達 FinMind 帳號／安全額度，請稍後按續傳。':stopped?'已暫停，資料保留。':'本輪資料更新完成。')+
   c30FreeSummary(result)+'；剩餘籌碼／日K '+pendingChips+
   (tier==='sponsor'?'，分 K '+pendingMinutes:'')+
   (permissionWarning?'；'+permissionWarning:'')+
   (errors.length?'；失敗 '+errors.length+' 組':'')+'。最新買賣仍需原引擎重播。');
  return result
 })().finally(()=>{active=null});
 return active
}
