/* C26 source preflight: read-only, browser-only. No broker orders; no plan inference.
 * FinMind credentials are only read from THIS browser and sent directly to FinMind.
 * Licensed raw prices and institutional records are neither uploaded to the site
 * nor persisted; only aggregate diagnostics are displayed.
 */
const $ = id => document.getElementById(id);
const LOCK = 'C26-EVENT-CORR-LOCK-20261112';
let server=null, universe=null;
const stage=$('c26-forward-stage'), results=$('c26-device-audit-results');
function say(target,message){if(target)target.textContent=message;}
const fmt=(v)=>Number.isFinite(+v)?Number(v).toLocaleString('zh-TW'):'—';
const dateLike=v=>/^20\d\d-\d\d-\d\d$/.test(String(v||''));
function nextDay(date){const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
async function getJson(url){
 const r=await fetch(url,{cache:'no-store',credentials:'same-origin'});
 if(!r.ok)throw Error('HTTP '+r.status);
 return r.json();
}
function serverText(status,coverage){
 const states=[
  '凍結 C26 歷史：2026/10/27（1,407 日、1,758 筆委託）',
  '完整行情來源：'+(coverage?.source_as_of||'未核對')+
    '，向前補齊 '+fmt(coverage?.available_trade_dates)+'／'+fmt(coverage?.staged_trade_dates)+' 個交易日',
  '最近交易日日K：'+fmt(coverage?.latest_price_valid)+'／233；法人代碼：'+fmt(coverage?.latest_institutional_codes)+'／233',
  '最新缺漏代碼：'+(coverage?.latest_missing_codes?.join(', ')||'無（仍須確認其他驗證）'),
  '已知OHLC封存邊界：'+(coverage?.checkpoint_ohlc_parity?.pass?'已通過':'未通過'),
  'C26 原始特徵一致性：'+(coverage?.feature_parity||'尚未驗證'),
  'C26 最新持倉、現金與逐筆交易重播：'+(coverage?.portfolio_replay||'尚未重播'),
  '隔日指令：'+(status?.plan?.readiness||'BLOCKED')+
    (status?.plan?.trade_date?'（目標交易日 '+status.plan.trade_date+'）':'')
 ];
 if(status?.plan?.readiness==='blocked'){
  states.push('禁止出單原因：'+(status.plan.plan_gate_error||status.plan.reason||'尚未通過重播'));
 }
 return states.join('\n');
}
async function refreshState(){
 say(stage,'正在核對 C26 伺服器資料與凍結條件…');
 try{
  const [status,pool]=await Promise.all([
   getJson('/api/c26/status?device_audit='+Date.now()),
   getJson('./data/universe.json')
  ]);
  if(status.lock_id!==LOCK||pool.lock_id!==LOCK||pool.count!==233||pool.codes?.length!==233||new Set(pool.codes).size!==233)
   throw Error('C26 策略鎖或 233 檔研究池不一致');
  server=status;universe=pool;
  say(stage,serverText(status,status.forward_coverage));
 }catch(e){
  server=null;universe=null;
  say(stage,'C26 來源狀態讀取失敗：'+(e?.message||'未知原因')+'。不可視為交易可執行。');
 }
}
function valPrice(v){
 const p=[v.open,v.max,v.min,v.close,v.Trading_Volume].map(Number);
 const [o,h,l,c,vol]=p;
 return p.every(Number.isFinite)&&o>0&&l>0&&h>=l&&o>=l-1e-7&&o<=h+1e-7&&c>=l-1e-7&&c<=h+1e-7&&vol>=0;
}
async function fetchFinMind(dataset,date,token,signal){
 const qs=new URLSearchParams({dataset,start_date:date,end_date:nextDay(date)});
 const r=await fetch('https://api.finmindtrade.com/api/v4/data?'+qs.toString(),{
  method:'GET',
  headers:{Authorization:'Bearer '+token,Accept:'application/json'},
  cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal
 });
 if(r.status===401||r.status===403)throw Error('FinMind 授權拒絕，檢查 Token 或方案權限');
 if(r.status===429)throw Error('FinMind 請求次數已達上限');
 if(!r.ok)throw Error('FinMind HTTP '+r.status);
 const payload=await r.json();
 if(Number(payload.status)!==200||!Array.isArray(payload.data)){
  throw Error('FinMind 資料集 '+dataset+' 不可用（status '+String(payload.status??'unknown').slice(0,12)+'）');
 }
 return payload.data.filter(row=>row.date===date);
}
function countCoverage(price,chip,date){
 const pool=new Set(universe.codes);
 const px=new Map(), invalid=new Set(), duplicate=new Set(), chips=new Set();
 for(const v of price){
  const code=String(v.stock_id);
  if(!pool.has(code))continue;
  if(px.has(code)){duplicate.add(code);continue;}
  px.set(code,v);
  if(!valPrice(v))invalid.add(code);
 }
 for(const v of chip){
  const code=String(v.stock_id);
  if(pool.has(code))chips.add(code);
 }
 const good=[...pool].filter(code=>px.has(code)&&!invalid.has(code)&&!duplicate.has(code));
 const missing=[...pool].filter(code=>!px.has(code));
 const absentChip=[...pool].filter(code=>!chips.has(code));
 return {
  day:date,priceValid:good.length,chipCodes:chips.size,missing,
  invalid:[...invalid],duplicate:[...duplicate],absentChip,sourcePriceRows:price.length,sourceChipRows:chip.length
 };
}
async function localAudit(){
 const button=$('c26-device-audit');
 if(!button||button.disabled)return;
 const token=window.C26DeviceFinMind?.activeToken?.();
 if(!token){say(results,'請先在上方輸入並儲存此裝置的 FinMind Token。');return;}
 if(!server?.forward_coverage?.source_as_of||!universe){
  await refreshState();
  if(!server?.forward_coverage?.source_as_of||!universe){say(results,'尚未取得可信的資料日期或 233 檔名單，禁止進行核對。');return;}
 }
 const date=server.forward_coverage.source_as_of;
 if(!dateLike(date)){say(results,'來源日期無效，停止測試。');return;}
 button.disabled=true;
 say(results,'正在直接向 FinMind 查詢 '+date+' 已完成日 K 與法人資料（Token 不會傳到本站）…');
 const ctl=new AbortController(), timeout=setTimeout(()=>ctl.abort(),25000);
 try{
  const [price,chip]=await Promise.all([
   fetchFinMind('TaiwanStockPrice',date,token,ctl.signal),
   fetchFinMind('TaiwanStockInstitutionalInvestorsBuySell',date,token,ctl.signal)
  ]);
  const report=countCoverage(price,chip,date);
  const backend=server.forward_coverage;
  const match=report.priceValid===backend.latest_price_valid &&
   report.chipCodes===backend.latest_institutional_codes;
  const verifiedBoundary=backend.checkpoint_ohlc_parity?.pass===true;
  say(results,[
   '本機 FinMind 即時核對：'+date,
   '有效日 K：'+report.priceValid+'/233；法人涵蓋：'+report.chipCodes+'/233',
   '缺少日 K：'+(report.missing.join('、')||'無')+
    '；異常日 K：'+(report.invalid.join('、')||'無')+
    '；重複代碼：'+(report.duplicate.join('、')||'無'),
   '缺少法人代碼：'+(report.absentChip.join('、')||'無'),
   '與伺服器來源計數：'+(match?'一致':'不一致，須人工檢查來源版本與時間'),
   '封存邊界：'+(verifiedBoundary?'伺服器報告通過':'尚未核對'),
   '原始策略因子、2026/10/28 後持倉與隔日委託：尚未完成驗證，不會產生交易訊號。',
   '本機查詢取得 '+fmt(report.sourcePriceRows)+' 筆日 K、'+fmt(report.sourceChipRows)+' 筆法人原始列；未儲存或上傳這些原始資料。'
  ].join('\n'));
 }catch(e){
  const msg=e?.name==='AbortError'?'FinMind 連線逾時':(e instanceof TypeError?'跨來源讀取失敗：可能是瀏覽器 CORS／網路限制':String(e?.message||e));
  say(results,'本機 FinMind 核對未完成：'+msg+'。不代表策略已準備上線，原有凍結資料不受影響。');
 }finally{clearTimeout(timeout);button.disabled=false;}
}
$('c26-device-audit')?.addEventListener('click',localAudit);
$('c26-forward-state-refresh')?.addEventListener('click',refreshState);
refreshState();
export {valPrice,countCoverage,serverText};
