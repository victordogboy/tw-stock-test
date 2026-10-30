import {mergeRecords,physicalSessions} from './r26-engine/live.mjs?v=20261031-status';
import {referenceTxMonth,taipeiParts} from './r26-data-sync.mjs';
// r26-data-sync's DOM initializer is disabled on this replacement view.
const $=id=>document.getElementById(id),fmt=x=>Number.isFinite(x)?x.toLocaleString('zh-TW',{maximumFractionDigits:2}):'—';
const text=(id,x)=>{if($(id))$(id).textContent=x};
const worker=new Worker('/r26-engine/monitor-worker.mjs?v=20261031-status',{type:'module'});
let serial=0,rows=[],calendar=[],contract='',state=null,working=false,historyWorking=false,lastHistory=0,seedLoaded=false,fetchError='';
const pending=new Map();
worker.onmessage=({data:m})=>{const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);if(m.type==='error')p.reject(Error(m.error));else p.resolve(m)};
worker.onerror=e=>{invalidatePosition('引擎啟動失敗：'+e.message);for(const p of pending.values())p.reject(Error(e.message));pending.clear()};
function ask(type,payload={},transfer=[]){return new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error('引擎運算逾時，請重新整理'))},60000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,type,...payload},transfer)})}
function token(){try{
 const explicit=localStorage.getItem('R26_FinMind_Token');if(explicit)return explicit;
 if(localStorage.getItem('R26_token_disabled')==='1')return '';
 const j=JSON.parse(localStorage.getItem('twq_finmind_tokens_v2')||'null');return j?.tokens?.[Number(j.active)===1?1:0]||localStorage.getItem('twq_finmind_token_v1')||'';
}catch{return ''}}
async function database(){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('快取不可用')),1500),req=indexedDB.open('r26-verified-TX',1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('bars'))req.result.createObjectStore('bars',{keyPath:'key'})};req.onsuccess=()=>{clearTimeout(timer);resolve(req.result)};req.onerror=()=>{clearTimeout(timer);reject(req.error)}})}
async function cached(){try{const db=await database();return await new Promise(resolve=>{const r=db.transaction('bars').objectStore('bars').getAll();r.onsuccess=()=>{db.close();resolve(r.result)};r.onerror=()=>{db.close();resolve([])}})}catch{return []}}
async function save(added){try{const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction('bars','readwrite');for(const r of added)tx.objectStore('bars').put({...r,key:r.contract_date+'|'+r.timestamp_tpe});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)}})}catch{/* memory remains usable on restricted mobile browsers */}}
function add(added){rows=mergeRecords(rows,added)}
function planName(side){return side===1?'多單':side===-1?'空單':'空手'}
function draw(m){
 state=m.result;const r=state,s=r.session,p=r.row,ready=r.ready;
 text('r26NowDate','臺灣日期 '+taipeiParts().date+' · R26 狀態分離版 20261031');
 text('r26FreezeLabel','原始 2,428 盤金標逐盤零差異；以相同凍結規則接續重播。');
 const states=r.sessionStates||[],active=states.find(x=>x.marketState==='trading'),missing=states.filter(x=>x.historicalMissing),unverified=states.filter(x=>x.complete&&!x.dataReady&&!x.historicalMissing);
 text('r26MarketState',active?('正在交易：'+active.start.slice(0,10)+' '+(active.sid?'日盤':'夜盤')+' → 交易日 '+active.date+'，'+active.endsAt+' 收盤'):'目前無進行中的盤次；最近盤次已收盤');
 text('r26PositionState',r.positionConfirmed?'策略持倉已確認（截至 '+r.as_of+'）':'策略持倉無法確認；不發布確定的進出場指令');
 text('r26DataHealth',ready?(active?'✓ 正在交易，分鐘資料持續更新；策略已接續':'✓ 已完成交易盤次；策略已重播'):
  (missing.length?'已收盤的歷史資料缺失：'+missing.map(x=>x.date+' '+(x.sid?'日盤':'夜盤')).join('、'):
   unverified.length?'已收盤資料完整性待核對':active?.label||'資料核對中')+'；策略持倉無法確認。'+r.issues.join('；'));
 const latestData=states.map(x=>x.last).filter(Boolean).sort().at(-1);
 text('r26DataLatest',(latestData||'—')+'（台灣時間，分鐘起點）');
 text('r26DataCount',fmt(rows.length)+' 根／已接續 '+r.added+' 盤');
 text('r26DataMissing','已收盤缺資料 '+missing.length+' 盤；完整性待核對 '+unverified.length+' 盤；交易中 '+(active?1:0)+' 盤');
 text('r26DataProgress',(fetchError?'最近來源檢查：'+fetchError+'；':'')+'官方歷史＋Yahoo 指定月 '+contract+'；報價每 5 秒、分鐘資料每 30 秒檢查，自動重播。');
 text('r26DataGap','完成盤使用期交所整包逐筆並驗證 CRC，無成交分鐘不補造；當盤使用 Yahoo 指定月份 '+contract+'，分鐘結束標籤轉為起點（−60 秒）。重新開頁會補抓整盤，背景或休眠時暫停。');
 const table=$('r26DataTable');table.replaceChildren();
 for(const t of [...states].slice(-9).reverse()){
  const tr=document.createElement('tr');
  const timing=t.complete?'已收盤 '+t.endsAt.slice(11,16):'收盤 '+t.endsAt;
  for(const val of [t.start.slice(0,10)+' '+(t.sid?'日盤':'夜盤'),t.date,t.contracts.join('/')||contract,
   t.count+' 根',t.last?.slice(11)||'—',t.label+'｜'+timing]){const td=document.createElement('td');td.textContent=val;tr.append(td)}table.append(tr);
 }
 text('mainSignalHeading',ready?('R26 '+s.start.slice(0,10)+' '+(s.sid?'日盤':'夜盤')+'｜模型'+planName(p.held)):'R26 策略持倉無法確認｜不發布進出場指令');
 const entries=r.events.filter(e=>/進場/.test(e.type)),exit=r.events.filter(e=>/停損|停利|平倉/.test(e.type));
 let detail=ready?('交易日 '+s.date+'，TX'+s.contract+'。開盤 '+fmt(s.op)+'，原始方向 '+(s.signal===1?'多':s.signal===-1?'空':'中性')+'；'+(s.blocked?'風控停機。':'風控允許交易。')+'模型目前'+planName(p.held)+'，保護停損 '+(p.held?fmt(r.stop):'無持倉')+'。本盤模型損益 '+fmt(p.pnl)+' 點（含每邊 2.5 點成本）。'):'目前未完成當盤計算：'+r.issues.join('；')+'。下方僅列已取得資料的重播，不代表此刻可進場。';
 if(ready&&entries.length)detail+=' 進場紀錄：'+entries.map(e=>e.time+' '+e.type+' '+fmt(e.price)).join('；')+'。';
 if(ready)detail+=' 出場紀錄：'+(exit.length?exit.map(e=>e.time+' '+e.type+' '+fmt(e.price)).join('；'):'截至所列分鐘尚無出場')+'。';
 const fixedTarget=Number.isFinite(p.target)&&p.target>0;
 const tpLabel=!ready?'尚未確認':!p.held?'無持倉':fixedTarget?fmt(p.target):'未設固定停利（核心趨勢單）';
 const tradeType=!ready?'尚未確認':!p.held?'空手':fixedTarget?'關鍵價輔助單':p.recovered?'核心再進場單':'核心趨勢單';
 const exitRule=!ready?'資料接齊後自動顯示。':!p.held?'目前無持倉，沒有正在生效的停損或停利委託。':fixedTarget?
  '觸及固定停利或保護停損即出場；關鍵價輔助單於該盤尾盤平倉。':
  '觸及保護停損即出場；下一盤開盤若方向轉為空手、反向或風控要求空手，則平倉；同向可跨盤續抱。停損依當盤規則重設，原版核心單不以固定目標價停利。';
 text('signalTradeType',tradeType);text('signalStopPrice',!ready?'尚未確認':p.held?fmt(r.stop):'無持倉');
 text('signalTakeProfit',tpLabel);text('signalExitRule',exitRule);
 if(ready&&p.held)detail+=' 停利設定：'+tpLabel+'。';
 text('signalStatus',detail);
 text('signalAsOf',r.as_of||'—');text('signalAudit',m.gold.compared+' 盤零差異');text('signalPosition',ready?planName(p.held):'尚未確認');
 text('signalNext',r.nextSession?.start||'日曆待更新');
 text('signalReason',ready?('影子策略前兩盤合計 '+fmt(r.shadowPreviousTwo)+' 點；門檻 −750 點，觸發後涵蓋三盤，每一新盤重新檢查，並非永久空手。模型狀態是歷史分鐘路徑推算，未連接券商持倉；開盤進場紀錄不等於現在仍能取得開盤價。'):'等待來源資料恢復後自動重算，不沿用舊方向。');
 text('r26ReplayStatus',(ready?'':'持倉未確認，以下僅供歷史核對｜')+'金標通過；接續 '+r.added+' 盤；最新來源 '+s.source+'；更新於 '+r.as_of);
 text('recentPnl',fmt(r.newPnl)+' 點');text('replayHold',ready?planName(p.held):'待確認');text('replayHoldTime',(ready?'已確認模型計算至 ':'僅供歷史核對，重播截至 ')+(r.as_of||'—'));
 text('provisionalTotal',fmt(r.total)+' 點');
 const tbody=$('replayTable');tbody.replaceChildren();
 for(const x of [...r.recent].reverse()){
  const tr=document.createElement('tr');for(const v of [x.date+' '+(x.sid?'日盤':'夜盤'),x.blocked?'風控停機／空手':(x.signal===1?'多':x.signal===-1?'空':'中性')+' → '+planName(x.held),fmt(x.op),x.startPos?fmt(x.stop):'—',fmt(x.pnl)]){const td=document.createElement('td');td.textContent=v;tr.append(td)}tbody.append(tr);
 }
 text('preopenAction',ready?(s.blocked?'風控停機':p.held?'模型'+planName(p.held)+' · 停損 '+fmt(r.stop):'模型空手'):'策略持倉無法確認');
 text('preopenDetails',ready?(r.events.length?r.events.map(e=>e.time+'｜'+e.type+'｜'+fmt(e.price)).join('；'):'本盤尚無交易事件。'):'持倉未確認，不提供確定的進場、停損或停利指令。最近可重播資料截至 '+(r.as_of||'未知')+'，僅供歷史核對。');
}
function invalidatePosition(reason){
 state=state?{...state,ready:false,positionConfirmed:false,confirmedPosition:null,signalAllowed:false,stop:null}:null;
 text('r26DataHealth','策略持倉無法確認：'+reason);
 text('r26PositionState','策略持倉無法確認；不發布確定的進出場指令');
 text('mainSignalHeading','R26 策略持倉無法確認｜不發布進出場指令');
 text('signalStatus','未取得本次已驗證的重播結果：'+reason+'。不能沿用上次持倉或出場價位。');
 for(const id of ['signalPosition','signalTradeType','signalStopPrice','signalTakeProfit','replayHold'])text(id,'尚未確認');
 text('signalExitRule','持倉尚未確認，不發布進出場指令。');text('preopenAction','策略持倉無法確認');
 text('preopenDetails','重播恢復並核對連續資料後，才會重新顯示本盤進出場結果。');
 text('signalReason','上一次重播僅供歷史核對，不能代表現在持倉。');
}
async function replay(){const m=await ask('replay',{rows,calendar});draw(m)}
async function json(url,options={}){const rsp=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(25000),...options});const x=await rsp.json();if(!rsp.ok||x.ok===false)throw Error(x.error||x.reason||'HTTP '+rsp.status);return x}
async function check(){
 if(working||document.visibilityState==='hidden'||!seedLoaded)return;
 if(state?.positionConfirmed&&state.session?.partial&&Date.now()-Date.parse(state.as_of.replace(' ','T')+'+08:00')>4*60000)invalidatePosition('當盤分鐘資料已逾時，正在重新核對');
 working=true;
 try{const x=await json('/api/r26/intraday?contract='+contract);add(x.data);await save(x.data);fetchError=''}catch(e){fetchError=e.message}
 try{await replay()}catch(e){invalidatePosition('重播失敗：'+e.message)}finally{working=false}
}
async function history(manual=false){
 if(historyWorking||!seedLoaded||(!manual&&Date.now()-lastHistory<600000))return;historyWorking=true;lastHistory=Date.now();
 try{
  const sessions=physicalSessions(calendar,'2026-10-22'),dates=[...new Set(sessions.filter(s=>s.complete&&!rows.some(x=>x.session_key===s.key&&/TAIFEX/.test(x.source))).map(s=>s.date))];
  for(const date of dates){
   text('r26DataProgress','正在從期交所補抓 '+date+' 完整逐筆…');
   try{const rsp=await fetch('/api/r26/official-zip?date='+date+'&contract='+contract,{signal:AbortSignal.timeout(25000)});if(!rsp.ok)throw Error('官方逐筆尚未公布');const buffer=await rsp.arrayBuffer();const result=await ask('official',{buffer,date,contract},[buffer]);add(result.rows);await save(result.rows)}
   catch(e){fetchError=date+' '+e.message;
    const bearer=$('r26DataToken').value.trim()||token();
    if(bearer)for(const d of [date,new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10)])try{const x=await json('/api/r26/kbar?date='+d+'&contract='+contract,{headers:{Authorization:'Bearer '+bearer}});add(x.data);await save(x.data)}catch{}
   }
  }
  await check();
 }finally{historyWorking=false}
}
$('r26DataRefresh').addEventListener('click',()=>{history(true);check()});
$('r26DataToken').addEventListener('change',()=>{try{const value=$('r26DataToken').value.trim();if(value){localStorage.setItem('R26_FinMind_Token',value);localStorage.removeItem('R26_token_disabled')}}catch{}history(true)});
$('r26DataClearToken').addEventListener('click',()=>{try{localStorage.removeItem('R26_FinMind_Token');localStorage.setItem('R26_token_disabled','1')}catch{}$('r26DataToken').value='';$('r26DataToken').placeholder='已停用此頁 Token；官方與 Yahoo 仍自動運作'});
$('r26DataExport').addEventListener('click',()=>{const u=URL.createObjectURL(new Blob([JSON.stringify({version:'20261031-status',generated_at:new Date().toISOString(),contract,state,records:rows,calendar},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='R26_replay_diagnostic.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),2000)});
async function init(){
 try{
  text('r26DataProgress','載入官方歷史分K並在背景驗證原始 2,428 盤…');
  const sr=await fetch('/r26-engine/data/recent.json.gz');if(!sr.ok)throw Error('官方歷史下載失敗');const seed=await new Response(sr.body.pipeThrough(new DecompressionStream('gzip'))).json();calendar=seed.calendar;
  const now=taipeiParts();contract=referenceTxMonth(now.date);$('r26DataContract').value=contract;
  add(await cached());add(seed.rows);seedLoaded=true;
  $('r26DataToken').placeholder=token()?'已沿用儲存的 Token；資料可免 Token 更新':'選填；官方逐筆與 Yahoo 指定月可免 Token 更新';
  await check();history();
 }catch(e){invalidatePosition('初始化失敗：'+e.message)}
}
setInterval(()=>{check();history()},30000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){invalidatePosition('恢復頁面，正在核對最新資料與持倉');check();history()}});
window.addEventListener('online',()=>{check();history(true)});
init();
