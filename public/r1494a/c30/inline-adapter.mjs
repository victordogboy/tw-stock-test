import {c30PlanMode,verifiedC30Forward} from './forward.mjs';
import {readC30StoredStatus,syncC30FinMind,c30DeviceToken,c30StatusSummary} from './data-sync.mjs?v=20261125-sponsor-diagnose-v5';
/* C30 original strategy: native renderer for the existing A56/R1494-A FOUR tabs.
 * FROZEN until 2026-11-20. Never infer live orders from newly downloaded OHLCV.
 * C30 original engine unchanged; this module only adapts verified archived records.
 */
const ROOT='/r1494a/c30/';
const LOCK='A89_C30_RISK23_buffer250_partial_2019';
const HASH='92accfeea01ff2baf929ad8572aea5ad6b2856d3cffb2b66c6017af16e330904';
const $=x=>document.querySelector(x);
const esc=s=>String(s??'—').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const money=(v,d=0)=>Number.isFinite(v)?v.toLocaleString('zh-TW',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
const pct=(v,dec=2)=>Number.isFinite(v)?(v>=0?'+':'')+money(v*100,dec)+'%':'—';
const set=(sel,value)=>{const e=$(sel);if(e)e.textContent=String(value)};
let frozen;
let stockNames;
let reversalLedger;
function loadReversalLedger(history){
 return reversalLedger??=fetch(ROOT+'reversal-history.json',{signal:AbortSignal.timeout(5000)}).then(async response=>{
  if(!response.ok)throw Error('C30 reversal history unavailable');
  const report=await response.json(),dates=new Set(history.dates);
  if(report.lock_id!==LOCK||report.core_history_sha256!==HASH||report.through!==history.as_of
    ||!Array.isArray(report.orders)||report.orders.length!==report.order_count||!report.orders.length
    ||report.orders.some((o,i)=>!dates.has(o.date)||!dates.has(o.signal)||o.signal>=o.date
      ||o.date<(report.orders[i-1]?.date||'')||o.sleeve!=='reversal'||o.filled!==true
      ||!/^\d{4}$/.test(o.code)||!['BUY','SELL'].includes(o.side)
      ||![o.price,o.quantity,o.notional].every(v=>Number.isFinite(v)&&v>0)
      ||Math.abs(o.price*o.quantity-o.notional)>1e-9))throw Error('C30 reversal history invalid');
  const lots=new Map();
  for(const o of report.orders){
   const lot=lots.get(o.code);
   if(o.side==='BUY'){if(lot)throw Error('C30 reversal duplicate lot');lots.set(o.code,o);}
   else {if(!lot||Math.abs(lot.quantity-o.quantity)>1e-12||lot.date>o.date||(lot.date===o.date&&o.minute>=0&&lot.minute>=0&&lot.minute>o.minute))throw Error('C30 reversal trade sequence invalid');lots.delete(o.code);}
  }
  return report;
 }).catch(()=>{reversalLedger=null;return null});
}
function loadStockNames(){
 return stockNames??=fetch(ROOT+'stock-names.json',{signal:AbortSignal.timeout(5000)}).then(response=>{
  if(!response.ok)throw Error('C30 stock names unavailable');
  return response.json();
 }).catch(()=>{stockNames=null;return {}});
}
async function original(){
 if(frozen)return frozen;
 frozen=(async()=>{
  const r=await fetch(ROOT+'history.b64',{cache:'force-cache'});
  if(!r.ok)throw Error('C30 原始壓縮帳本 HTTP '+r.status);
  const bytes=Uint8Array.from(atob((await r.text()).trim()),c=>c.charCodeAt(0));
  const raw=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(hash!==HASH)throw Error('C30 凍結帳本 SHA-256 不一致，拒絕載入');
  const d=JSON.parse(new TextDecoder().decode(raw));
  if(d.lock_id!==LOCK||d.dates.length!==1425||d.snapshots.length!==1425||d.orders.length!==2082||
     d.dates.at(-1)!=='2026-11-20'||Math.abs(d.snapshots.at(-1).nav-24.28066123)>1e-7||d.benchmark.length!==1425)
     throw Error('C30 原始引擎凍結基準不符');
  if(d.snapshots.some((s,i)=>s.date!==d.dates[i]||!Number.isFinite(s.nav)||s.nav<=0||s.coreCount+s.sideCount>8))throw Error('C30 日期／持股資料驗證失敗');
  return d;
 })().catch(e=>{frozen=null;throw e});
 return frozen;
}
let lastFinMind=null;
let autoLastAttemptAt=0;
let lastOfficial=null;
async function checkOfficial(){
 try{
  const r=await fetch('/api/c30/latest',{cache:'no-store',signal:AbortSignal.timeout(65000)});
  const j=await r.json();
  lastOfficial={ok:!!j.ok,as_of:j.as_of||null,twse:j.markets?.twse?.count||0,tpex:j.markets?.tpex?.count||0,errors:j.errors||[],at:new Date().toISOString()};
 }catch(e){lastOfficial={ok:false,error:String(e?.message||e),as_of:null,at:new Date().toISOString()}}
 return lastOfficial;
}
export async function loadC30MonitorSnapshot(_shared,{refresh=false}={}){
 const [history,names]=await Promise.all([original(),loadStockNames()]);
 const sideRequest=loadReversalLedger(history);
 let forward=null;
 try{
  const response=await fetch(ROOT+'verified-forward.json',{cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(response.ok){const report=await response.json();if(verifiedC30Forward(report,history))forward=report;}
 }catch{}
 const hist=forward?{...history,as_of:forward.signal_date,dates:[...history.dates,...forward.replayed_dates],
  snapshots:[...history.snapshots,...forward.snapshots],orders:[...history.orders,...forward.orders],
  benchmark:[...history.benchmark,...forward.snapshots.map(row=>row.benchmark)]}:history;
 const side=await sideRequest;
 const token=c30DeviceToken();
 try{
  lastFinMind=await readC30StoredStatus(token);
  // Read cloud cache every visit; refresh only missing days, not historical 10 years.
  const auto=token&&Date.now()-autoLastAttemptAt>45*60000;
  if(refresh||auto){
   autoLastAttemptAt=Date.now();
   const progress=s=>{const ui=document.querySelector('#flash');if(ui&&document.querySelector('#strategy')?.value==='C30')ui.textContent=s};
   // Never block historical holdings/UI while a free-rate-limited refresh runs.
   Promise.resolve().then(()=>syncC30FinMind(token,progress,{auto:true,maxRequests:refresh?12:4}))
    .then(updated=>{lastFinMind=updated;if(document.querySelector('#strategy')?.value==='C30')setTimeout(()=>globalThis.poll?.(false),0)})
    .catch(e=>{progress('C30 免費增量遇到錯誤：'+e.message+'；雲端原有資料未清除')});
  }
 }catch(e){
  lastFinMind={...(lastFinMind||{}),ok:false,sync_error:String(e.message||e),needs_token:!token,days:lastFinMind?.days||[],stored_days:lastFinMind?.stored_days||0};
 }
 if(lastFinMind?.latest_price_date){lastOfficial={ok:true,as_of:lastFinMind.latest_price_date,source:'TWSE／TPEx 官方行情已封存',at:lastFinMind.updated_at||lastFinMind.checked_at||null}}
 else if((refresh||!lastOfficial)&&!forward)await checkOfficial();
 return {...hist,orders:mergeOrders(hist.orders,side?.orders||[]),reversalHistory:side,names:{...names,...hist.names},model_version:'C30',ledger:'C30_RISK23_core_history',
  curves:{strategy:hist.snapshots.map(x=>x.nav),market:hist.benchmark},
  status:{model_version:'C30',data_as_of:hist.as_of,checkedThrough:hist.as_of,
   price_updated_at:lastOfficial?.at||null,signal_as_of:hist.as_of,sync_status:forward?'current':'frozen',
   trade_status:c30PlanMode(forward),lastError:null,sources:[{type:'C30 原始引擎',kind:'凍結歷史'}]},
  forward,plan:forward||{readiness:'blocked',blockedReason:'目前只有原版 C30 2026/11/20 前的完整重播；免費行情更新不代表已產生新的正式交易訊號。'},
  official:lastOfficial,finmind:lastFinMind};
}
const reason={new_position:'核心新建倉',topup:'核心補倉',rank_exit:'核心排序退出',risk_exit:'核心風控退出',portfolio_reduce:'核心減少曝險',protective_stop:'核心保護停損',cap16:'單股配置調整',no_touch_no_buy:'未觸買入價',no_offer_no_fill:'鎖漲停、無法買入',no_bid_no_fill:'鎖跌停、無法賣出',bad_market_data:'資料未驗證',target_exposure_full:'曝險或現金已滿',replace:'選股換股',reversal_entry:'反轉進場',reversal_exit:'反轉離場',reversal:'反轉成交',
 core_recovery:'核心恢復',warning_ended:'反轉警戒解除',cycle_expiry:'反轉週期到期',
 individual_expiry:'反轉持有期到期',pending_cycle:'反轉延後出場',a87_intraday_stop:'反轉盤中停損',
 a62_weak:'反轉轉弱出場',dynamic_weak:'反轉動態出場',a73_stop:'反轉保護停損',a87_stop_deferred:'反轉停損延後出場'};
function htmlRows(rows){return rows.join('')}
function scale(s){return Math.max(0,Number($('#capital')?.value??3000000)||0)/s.nav}
function held(h,f,s){const value=h.q*h.p*f,cost=h.q*h.entry*f,pnl=value-cost,profit=h.entry>0?h.p/h.entry-1:NaN;
 return {v:value,c:cost,pnl,profit,weight:h.q*h.p/s.nav}}
function historicalOrders(D,date){return D.orders.filter(o=>o.date===date)}
function finalMsg(D){return 'C30 凍結引擎已驗證至 2026/11/20；'+c30StatusSummary(D.finmind)+'；'+(D.official?.ok?'資料來源 '+(D.official.source||'官方雙市場')+' 最新資料日 '+D.official.as_of+'（不代表策略已重播）':'沒有取得可核對的最新行情')+'；隔日買賣指令暫不發布。'}
export function renderC30Monitor(D,I,limit=120){
 const s=D.snapshots[I],f=scale(s),isLast=I===D.snapshots.length-1;
 const plan=isLast?D.forward:null,planMode=c30PlanMode(plan);
 const sideSummary=s.sideCount&&!s.holdings.some(row=>row.sleeve==='reversal');
 const exposure=(s.core+s.side)/s.nav;
 $('#date').value=I;
 set('#count',(s.coreCount+s.sideCount)+' / 8');set('#exposure',pct(exposure));set('#target',pct(s.target));
 const pnl=s.holdings.reduce((p,h)=>p+held(h,f,s).pnl,0);
 set('#pnl',(pnl>=0?'+':'')+money(pnl)+' 元');$('#pnl').className='value '+(pnl>=0?'positive':'negative');
 $('#status').innerHTML='<strong>C30 原版 · '+(isLast?'最後完整驗證交易日':'歷史回放')+'</strong> '+esc(s.date)+'｜原版 C30 目前不是最新即時交易訊號。<div class="sub">'+esc(finalMsg(D))+'</div>';
 set('#planState',isLast?'BLOCKED · 尚無今日正式委託':'歷史回放 · 非即時委託');
 set('#planDate','原引擎資料日 '+s.date+'；最新完整原版重播：2026-11-20');
 set('#planNote',isLast?'11/20 收盤風控已封鎖新交易。11/23 以後即使免費行情已取得，也必須先完成原版 C30 逐日引擎重播。':'這是 '+s.date+' 的原始歷史持股與成交回放；當天交易依前一交易日資訊決定。以下資料不可當作現在的委託。');
 const o=historicalOrders(D,s.date).filter(x=>x.sleeve!=='reversal'),filled=o.filter(x=>x.filled);
 $('#planActions').innerHTML=(o.length?'<p class="sub">'+esc(s.date)+' 原版歷史交易（不是下一交易日計畫）：'+filled.filter(x=>x.side==='BUY').length+' 筆核心買入、'+filled.filter(x=>x.side==='SELL').length+' 筆核心賣出。</p>':'<p class="empty">此日沒有核心部位委託。'+(s.sideCount?'反轉成交請見交易紀錄。':'')+'</p>')+
 (isLast?'<div class="notice"><strong>次日買賣計畫：尚未經原版 C30 引擎重算</strong>不會用最新股價事後補出買單；請先完成 11/23 起的完整狀態接續。</div>':'');
 if(plan){
  const historical=planMode==='historical';
  $('#status').innerHTML='<strong>C30 帳本資料至 '+esc(plan.signal_date)+'</strong><div class="sub negative">紙上模型；已核對封存成交價格，完整因果重播及兩筆缺分K的歷史停損仍待確認，非實盤成交。</div>';
  set('#planState',historical?'已驗證 · 盤前計畫回看':'C30 已驗證盤前計畫');
  set('#planDate','訊號 '+plan.signal_date+' → 交易 '+plan.trade_date);
  set('#planNote',(historical?'本交易日已結束。':'')+'計畫只使用訊號日收盤前已知資料，核心目標曝險 '+pct(plan.target)+'。');
  const action=plan.engine_plan.map(row=>'<li>'+esc(D.names?.[row.code]||row.code)+' '+esc(row.code)+' · '+esc(row.method)+
    (Number.isFinite(row.level)?' '+money(row.level,2):'')+'</li>').join('');
  const extra=[
   plan.reversal_watch?'反轉路徑須等開盤與分 K 條件。':null,
   plan.reversal?.used?'反轉警戒本輪額度已使用。':null,
   plan.execution?.pending_limit_buys?'原引擎保留 '+plan.execution.pending_limit_buys+' 筆待處理限價。':null,
   plan.execution?.rebalance&&plan.position_count?'開盤依實際價格核對風控調倉。':null
  ].filter(Boolean).join(' ');
  $('#planActions').innerHTML=(action?'<ul>'+action+'</ul>':'<p class="empty">盤前無新增固定買賣委託。</p>')+(extra?'<p>'+esc(extra)+'</p>':'');
 }
 set('#priceDate',s.date+' 收盤');
 set('#holdingNote','核心 '+s.coreCount+' 檔、反轉 '+s.sideCount+' 檔；歷史凍結模型（不代表券商實際持倉）。'+(sideSummary?'反轉部位僅列合計市值。':''));
 $('#holdings').innerHTML=htmlRows(s.holdings.map(h=>{const p=held(h,f,s);return '<tr><td><b>'+esc(D.names?.[h.code]||h.code)+'</b> <small>'+esc(h.code)+'</small><span class="sub">首次 '+esc(h.start)+'／最近買入 '+esc(h.last)+'</span></td><td>'+money(h.entry,2)+'</td><td>'+money(h.p,2)+'</td><td class="'+(p.profit>=0?'positive':'negative')+'">'+pct(p.profit)+'</td><td>'+money(p.pnl)+'元</td><td>'+money(p.c)+'／'+money(p.v)+'元</td><td>'+pct(p.weight)+'</td></tr>';}))+
 (sideSummary?'<tr><td><b>反轉部位合計（'+s.sideCount+' 檔）</b><span class="sub">缺逐股明細，僅列實際引擎合計市值</span></td><td>—</td><td>—</td><td>—</td><td>—</td><td>—／'+money(s.side*f)+'元</td><td>'+pct(s.side/s.nav)+'</td></tr>':'')||'<tr><td colspan="7" class="empty">原版模型此日空手，未持有任何核心或反轉部位。</td></tr>';
 $('#holdingCards').innerHTML=htmlRows(s.holdings.map(h=>{const p=held(h,f,s);return '<article class="holding"><div class="row"><b>'+esc(D.names?.[h.code]||h.code)+' <small>'+esc(h.code)+'</small></b><b class="'+(p.profit>=0?'positive':'negative')+'">'+pct(p.profit)+'</b></div><div class="facts">'+[['買入均價',money(h.entry,2)],['最新收盤',money(h.p,2)],['剩餘成本',money(p.c)+' 元'],['市值',money(p.v)+' 元'],['未實現損益',money(p.pnl)+' 元'],['權重',pct(p.weight)],['首次買入',h.start],['最近買入',h.last]].map(([a,b])=>'<div>'+a+'<b>'+esc(b)+'</b></div>').join('')+'</div><p class="sub">歷史紙上模擬，未實現損益不含未實現賣出費稅</p></article>';}))||(sideSummary?'<p class="empty">本日無核心部位個股明細；反轉部位合計 '+money(s.side*f)+' 元（'+s.sideCount+'檔）。</p>':'<p class="empty">原版模型空手，沒有核心或反轉持倉。</p>');
 const risk=s.risk||{},flag=x=>x===true?'啟動':x===false?'未啟動':'未記錄';
 $('#risk').innerHTML=[['危機模式',flag(risk.crisis),'原引擎盤前風控'],['新單封鎖',flag(risk.block),'不可將未完成計畫當已成交'],['冷市場',flag(risk.market_cold),'反彈警戒'],['帳戶高水位防禦',flag(risk.dd_gate),'原引擎帳戶記憶'],['市場廣度',Number.isFinite(risk.breadth)?pct(risk.breadth):'—','原封存當時訊號'],['核心／反轉',s.coreCount+'／'+s.sideCount+' 檔','同帳戶最多 8 檔']].map(([a,b,c])=>'<div class="risk"><div class="row"><b>'+a+'</b><span class="pill">'+esc(b)+'</span></div><p class="sub">'+esc(c)+'</p></div>').join('');
 set('#dailyWhy',s.date+' C30 原始歷史重播｜核心委託 '+o.length+' 筆（成交 '+filled.length+' 筆）。\n'+'當日淨值倍率 '+money(s.nav,5)+'，現金倍率 '+money(s.cash,5)+'，核心曝險 '+pct(s.core/s.nav)+'，反轉曝險 '+pct(s.side/s.nav)+'。\n'+(plan?'下一交易日計畫已核對至 '+plan.trade_date+'。':'請查看最新模型日期的盤前計畫。'));
 set('#chartNote','績效採原引擎含費稅淨值。'+assessment(D,I));
 renderC30Orders(D,I,limit);
}
const BUY_COST=0.0014275,SELL_COST=0.0044275;

function mergeOrders(orders,historicalReversal){
 const basis=new Map();
 return [...historicalReversal,...orders].sort((a,b)=>a.date.localeCompare(b.date)).map(o=>{
  if(o.sleeve!=='reversal'||!o.filled)return o;
  const lot=basis.get(o.code);
  if(o.side==='BUY'){
   basis.set(o.code,{quantity:(lot?.quantity||0)+o.quantity,cost:(lot?.cost||0)+o.notional*(1+BUY_COST)});
   return o;
  }
  if(!lot||o.quantity>lot.quantity+1e-12)return o;
  const cost=lot.cost*o.quantity/lot.quantity;
  if(lot.quantity-o.quantity<=1e-12)basis.delete(o.code);
  else basis.set(o.code,{quantity:lot.quantity-o.quantity,cost:lot.cost-cost});
  return {...o,realized:(o.notional/cost-1)*100};
 });
}

function assessment(D,I){
 const current=D.snapshots[I],month=current.date.slice(0,7),f=scale(current);
 const previous=D.snapshots.slice(0,I).findLast(s=>s.date.slice(0,7)<month);
 const base=previous?.nav??1,change=current.nav-base;
 const signed=v=>(v>=0?'+':'')+money(v*f)+' 元';
 let detail='';
 if(D.reversalHistory){
  const sideCash=D.orders.reduce((sum,o)=>{
   if(o.sleeve!=='reversal'||!o.filled||o.date.slice(0,7)!==month||o.date>current.date)return sum;
   return sum+(o.side==='BUY'?-o.notional*(1+BUY_COST):o.notional*(1-SELL_COST));
  },0);
  const sideChange=current.side-(previous?.side??0)+sideCash;
  detail='，核心 '+signed(change-sideChange)+'、反轉 '+signed(sideChange);
 }
 return month+' 至 '+current.date.slice(5)+' 試算淨值 '+money(base*f)+' → '+money(current.nav*f)
   +' 元，變動 '+signed(change)+'（'+pct(current.nav/base-1)+'）'+detail+'。';
}
function sellNet(order){
 if(!order.filled||order.side!=='SELL'
    ||!Number.isFinite(order.realized)||!Number.isFinite(order.notional)||order.notional<=0)return null;
 // Engine realized is 100 × (price / average cost − 1). The cost already includes buy fees.
 const grossFactor=1+order.realized/100;
 if(grossFactor<=0)return null;
 const basis=order.notional/grossFactor;
 return {pct:grossFactor*(1-SELL_COST)-1, amount:order.notional*(1-SELL_COST)-basis};
}
function filteredOrders(D,I){
 const date=D.dates[I],q=($('#search')?.value||'').trim(),filter=$('#fill')?.value||'';
 return D.orders.filter(o=>o.date<=date&&(!q||o.code.includes(q)||String(D.names?.[o.code]||'').includes(q))
   &&(!filter||(filter==='filled'?o.filled:!o.filled))).reverse().sort((a,b)=>b.date.localeCompare(a.date)||((Number.isInteger(b.minute)&&b.minute>=0?b.minute:-1)-(Number.isInteger(a.minute)&&a.minute>=0?a.minute:-1)));
}
const orderSleeve=o=>o.sleeve==='reversal'?'反轉':'核心';
const orderSide=o=>o.side==='BUY'?'買入':'賣出';
const orderStatus=o=>o.filled?'模型成交':'未成交';
function executionTime(o){
 if(Number.isInteger(o.minute)&&o.minute>=0&&o.minute<=270)return String(9+Math.floor(o.minute/60)).padStart(2,'0')+':'+String(o.minute%60).padStart(2,'0');
 if(['MARKET_OPEN','OPEN'].includes(o.type)&&o.minute==null)return '開盤價模擬';
 return null;
}
// 2026-11-28 source-price reconciliation of the 64 frozen reversal fills.
const archivedPriceEvidence=new Map([["2021-05-18|2609|BUY|1|70.4","minute"],["2021-05-18|1905|BUY|2|20.7","minute"],["2021-05-18|2603|BUY|5|66.4","minute"],["2021-05-18|1440|BUY|22|22.95","minute"],["2021-05-21|1440|SELL|0|24.2","minute"],["2021-05-21|1905|SELL|0|21.85","minute"],["2021-05-25|2603|SELL|0|89.5","daily"],["2021-05-25|2609|SELL|0|96.9","daily"],["2024-08-06|2312|BUY|1|21.6","minute"],["2024-08-06|3374|BUY|1|210.5","minute"],["2024-08-06|2392|BUY|63|57.9","minute"],["2024-08-06|2486|BUY|149|89.5","minute"],["2024-08-07|4123|BUY|0|44.25","minute"],["2024-08-07|8069|BUY|9|247.5","minute"],["2024-08-09|2392|SELL|0|66","minute"],["2024-08-12|2486|SELL|0|98","minute"],["2024-08-12|3374|SELL|0|212.5","minute"],["2024-08-12|4123|SELL|0|45.25","minute"],["2024-08-13|2312|SELL|0|24.05","daily"],["2024-08-13|8069|SELL|0|280","daily"],["2025-04-08|4904|BUY|0|88","minute"],["2025-04-08|1210|BUY|1|54.5","minute"],["2025-04-08|6547|BUY|24|40.2","minute"],["2025-04-08|3264|BUY|28|61.6","minute"],["2025-04-09|1314|BUY|0|6.5","minute"],["2025-04-09|2027|BUY|1|46.7","minute"],["2025-04-09|2105|BUY|74|46.85","minute"],["2025-04-14|4904|SELL|0|89.3","daily"],["2025-04-15|1210|SELL|0|56.3","daily"],["2025-04-15|1314|SELL|0|6.93","daily"],["2025-04-15|2027|SELL|0|47.9","daily"],["2025-04-15|2105|SELL|0|48.4","daily"],["2025-04-15|3264|SELL|0|69.9","daily"],["2025-04-15|6547|SELL|0|42.95","daily"],["2026-07-20|6443|BUY|0|30.3","minute"],["2026-07-20|6182|BUY|2|138","minute"],["2026-07-20|6443|SELL|17|29.3","minute"],["2026-07-21|2377|BUY|0|143","minute"],["2026-07-21|2383|BUY|2|4650","minute"],["2026-07-21|2455|BUY|51|289.5","minute"],["2026-07-21|6182|SELL|1|134.5","minute"],["2026-07-24|2377|SELL|0|149","daily"],["2026-07-24|2383|SELL|-1|4940","range"],["2026-07-24|2455|SELL|-1|334.5","range"],["2026-11-06|3406|BUY|35|785","minute"],["2026-11-06|2881|BUY|43|143.5","minute"],["2026-11-06|2882|BUY|47|103.5","minute"],["2026-11-06|3443|BUY|49|5930","minute"],["2026-11-09|2891|BUY|0|73.4","minute"],["2026-11-10|2881|SELL|0|153.5","minute"],["2026-11-10|2882|SELL|0|111.5","daily"],["2026-11-10|2891|SELL|0|74.7","daily"],["2026-11-10|3406|SELL|0|879","minute"],["2026-11-13|3443|SELL|0|8645","daily"],["2026-11-17|3324|BUY|6|951","minute"],["2026-11-17|6213|BUY|6|443","minute"],["2026-11-17|3691|BUY|8|114","minute"],["2026-11-18|3406|BUY|2|844","minute"],["2026-11-18|3653|BUY|18|4475","minute"],["2026-11-18|3324|SELL|60|921","minute"],["2026-11-18|3406|SELL|7|819","minute"],["2026-11-18|3653|SELL|23|4350","minute"],["2026-11-18|3691|SELL|7|110.5","minute"],["2026-11-18|6213|SELL|22|430","minute"]]);
function executionAudit(o){
 if(!o.filled)return '未成交';
 if(o.sleeve==='reversal'){
  const evidence=archivedPriceEvidence.get([o.date,o.code,o.side,o.minute,o.price].join('|'));
  if(evidence==='minute')return '原始分K開盤價吻合・非實盤';
  if(evidence==='daily')return '日K開盤價吻合・非實盤';
  if(evidence==='range')return '僅日K範圍吻合・缺成交時間';
  return '新紀錄・尚未獨立核對分K';
 }
 return '核心日K模型・非盤中逐筆驗證';
}
function orderName(D,o){return [D.names?.[o.code],o.code].filter(Boolean).join(' ')}
export function renderC30Orders(D,I,limit=120){
 const orders=filteredOrders(D,I),f=scale(D.snapshots[I]);
 $('#orderRows').innerHTML=orders.slice(0,limit).map(o=>{
  const net=sellNet(o),time=executionTime(o);
  return '<tr><td>'+esc(o.date)+(time?' '+esc(time):'')+'<span class="sub">訊號日 '+esc(o.signal)+'</span>'+(o.filled&&o.sleeve==='reversal'&&!time?'<span class="sub negative">成交時間缺漏・待核對</span>':'')+'</td>'
   +'<td>'+esc(orderName(D,o))+'<span class="sub">'+orderSleeve(o)+'</span></td>'
   +'<td>'+orderSide(o)+'<span class="sub">'+orderStatus(o)+'</span><span class="sub">'+esc(reason[o.reason]||o.reason)+'</span></td>'
   +'<td>'+money(o.level,2)+'</td><td>'+money(o.price,2)+'</td><td>'+money(o.notional*f)+' 元<span class="sub">試算 '+money(o.quantity*f,3)+' 股</span><span class="sub">原始模型 '+money(o.quantity*3000000,3)+' 股</span></td>'
   +'<td>'+(net?'<span class="'+(net.pct<0?'negative':'positive')+'">'+pct(net.pct)+'</span>'
      +'<span class="sub">'+money(net.amount*f)+' 元（含費稅）</span>':'—')+'</td>'
   +'<td>'+esc(reason[o.reason]||o.reason)+'<span class="sub">'+esc(executionAudit(o))+'</span></td></tr>';
 }).join('')||'<tr><td colspan="8" class="empty">無符合紀錄</td></tr>';
 set('#orderCount','顯示 '+Math.min(limit,orders.length)+'／'+orders.length+' 筆');
 $('#more').disabled=limit>=orders.length;
}
const dd=values=>{let peak=1,lowest=0;for(const v of values){peak=Math.max(peak,v);lowest=Math.min(lowest,v/peak-1)}return lowest};
function annualOrMonthly(D,monthly){const dates=D.dates,levels=monthly?dates.map(s=>s.slice(0,7)):dates.map(s=>s.slice(0,4));const groups=[];for(let i=0;i<levels.length;i++){const prev=groups.at(-1);if(prev?.id===levels[i])prev.end=i;else groups.push({id:levels[i],start:i,end:i})}return groups.map(g=>{const base=g.start?D.curves.strategy[g.start-1]:1,bBase=g.start?D.curves.market[g.start-1]:1;return {period:g.id,until:g.end===dates.length-1?' 至'+dates[g.end].slice(5):'',yr:g.id.slice(0,4),return:D.curves.strategy[g.end]/base-1,market:D.curves.market[g.end]/bBase-1,dd:dd([base,...D.curves.strategy.slice(g.start,g.end+1)]),marketDD:dd([bBase,...D.curves.market.slice(g.start,g.end+1)])}})}
function rowsPeriod(data){return data.map(x=>'<tr><td>'+esc(x.period+x.until)+'</td><td class="'+(x.return>=0?'positive':'negative')+'">'+pct(x.return)+'</td><td class="negative">'+pct(x.dd)+'</td><td>'+pct(x.market)+'</td><td class="negative">'+pct(x.marketDD)+'</td></tr>').join('')}
export function renderC30Performance(D){
 const nav=D.curves.strategy,market=D.curves.market,min=1,max=Math.max(...nav,...market),w=1080,h=300,left=55,right=1020,top=22,bottom=260;
 const y=v=>bottom-(v-min)/(max-min||1)*(bottom-top),x=i=>left+i/(nav.length-1)*(right-left);
 function poly(series,color){const points=series.filter((_,i)=>i===0||i===series.length-1||i%3===0).map((v,k)=>{const i=k===0?0:k*3;return x(Math.min(i,series.length-1)).toFixed(2)+','+y(v).toFixed(2)}).join(' ');return '<polyline points="'+points+'" stroke="'+color+'" stroke-width="2.5" fill="none"/>'}
 $('#chart').innerHTML='<svg viewBox="0 0 1080 300" role="img" aria-label="C30 與加權指數歷史資金曲線" style="width:100%;height:auto">'+[0,.25,.5,.75,1].map(t=>{const v=min+(max-min)*t;return '<line x1="'+left+'" y1="'+y(v)+'" x2="'+right+'" y2="'+y(v)+'" stroke="#e1e6de"/><text x="45" y="'+(y(v)+4)+'" fill="#738078" text-anchor="end" font-size="12">'+money(v,1)+'×</text>'}).join('')+poly(market,'#97a99a')+poly(nav,'#18694f')+'<text x="55" y="285" fill="#738078" font-size="12">2021/01/06</text><text x="1020" y="285" fill="#738078" text-anchor="end" font-size="12">'+esc(D.as_of.replaceAll('-','/'))+'</text></svg>';
 const monthly=annualOrMonthly(D,true),wins=monthly.filter(x=>x.return>x.market).length;
 set('#strategySummary','C30 累積 '+pct(nav.at(-1)-1)+' · 最大回撤 '+pct(dd([1,...nav]))+' · 勝大盤 '+wins+'/'+monthly.length+' 月');
 set('#performanceLegend','C30 原版（深綠）／加權指數（灰綠）｜相同日期同一起點');
 $('#annual').innerHTML=rowsPeriod(annualOrMonthly(D,false));
}
export function renderC30Monthly(D){const yr=$('#monthYear')?.value;$('#monthly').innerHTML=rowsPeriod(annualOrMonthly(D,true).filter(x=>x.yr===yr))}
function freeCoverageHtml(status){
 const ds=['TaiwanStockInstitutionalInvestorsBuySell','TaiwanStockMarginPurchaseShortSale','TaiwanStockSecuritiesLending'];
 const days=(status?.days||[]).slice(-15).reverse(),n=x=>Number(x||0);
 if(!days.length)return '<p class="sub">Free 雲端目前沒有 2026/11/23 後的資料；請先填入 Token 並執行增量更新。</p>';
 const rows=days.map(d=>{
  const cols=[d.price?.stock_count||0,...ds.map(k=>d.chips?.[k]?.saved_codes?.length||0),d.minute?.count||0];
  return '<tr><td>'+esc(d.date)+'</td>'+cols.map((x,i)=>'<td class="'+(x===233?'positive':x<225?'negative':'')+'">'+x+'/233</td>').join('')+'<td>'+(d.market?.stored?d.market.rows+' 筆'+(d.market.quality?.conflicting_symbols?'（隔離 '+d.market.quality.conflicting_symbols+' 個衝突代號）':''):'尚未封存')+'</td><td>'+(cols.every(v=>v===233)?'<span class="pill">原始資料已覆蓋</span>':'<span class="pill amber">尚有缺漏／停牌</span>')+'</td></tr>'
 }).join('');
 return '<div class="scroll"><table><thead><tr><th>日期</th><th>日K（233）</th><th>法人</th><th>融資券</th><th>借券</th><th>現股1分K</th><th>全市場日K（原始筆數）</th><th>資料完整性</th></tr></thead><tbody>'+rows+'</tbody></table></div><p class="sub">數字代表成功取得或查核過的股票數，法人等資料可能是空值已檢查，不等於每根分 K 都完整。原 Python C30 引擎尚未逐日接續，因此不發布最新買賣單。</p>';
}
export function decorateC30Monitor(D){
 // C30 shares A56's existing FinMind Token panel; never hide it.
 set('#heroDescription','C30 RISK23 原版 · 233 檔股期現股研究池 · 核心與反轉雙模組 · 最多 8 檔 · 0.5855% 往返成本');
 set('#ordersNote',(D.reversalHistory?'核心與反轉成交同表。':'反轉歷史暫時無法讀取。')
   +' 成交日與訊號日分開。金額與股數依所選日期總資產等比例試算（可含小數股），非原始300萬元複利帳戶成交金額；成交金額不含費稅，賣出損益含買賣費稅。封存反轉64筆：47筆符合分K開盤、15筆符合日K開盤、2筆僅日K範圍吻合且缺成交時間；價格核對不等於完整因果重播。'+assessment(D,Number($('#date').value)));
 set('#ledgerLabel','C30 原版 · 凍結歷史紙上持倉（非目前實盤）');
 $('#execution-study-v29').innerHTML='<details><summary><b>C30 原版執行條件與歷史限制</b></summary><p>本頁保留 2026/11/20 前 RISK23 的真實歷史結果；買進／賣出依原引擎 OHLC 觸價、盤前凍結條件、核心／反轉持股配置與風控記憶。未將 A56 的反彈三路徑或 R1494-A 的固定5%買點加入 C30。</p><p>2026/11/28 封存帳本稽核：2082筆核心委託的原始日K OHLC一致、1919筆成交價位於日K範圍；64筆反轉成交中47筆分K開盤吻合、15筆日K開盤吻合、2筆缺分K時間（2026/07/24 台光電、全新）。1425日資產平衡、現金非負且持股最多8檔。這些是價格及帳本驗證，不是完整因果重播、零股實盤成交或無前視偏差的證明。</p></details>';
 $('#performanceNotice').innerHTML='<strong>C30 原版凍結回測｜現股模擬｜往返成本0.5855%</strong>逐日核對至 '+esc(D.as_of)+'。此區顯示紙上模型績效。';
 $('#orderRows').closest('table').querySelector('thead').innerHTML='<tr><th>模型成交日／時間<br>訊號日</th><th>標的</th><th>動作／原因</th><th>觸發價</th><th>模擬成交價</th><th>試算金額／股數</th><th>賣出損益</th><th>原因／驗證狀態</th></tr>';
 $('#annual').closest('table').querySelector('thead').innerHTML='<tr><th>年度</th><th>C30 累積報酬</th><th>最大回撤</th><th>加權指數</th><th>最大回撤</th></tr>';
 $('#monthly').closest('table').querySelector('thead').innerHTML='<tr><th>月份</th><th>C30 報酬</th><th>最大回撤</th><th>加權指數</th><th>最大回撤</th></tr>';
 document.querySelectorAll('[data-strategy-title]').forEach(x=>x.textContent='C30 報酬');
 $('#rulesMain').innerHTML='<h2>C30 原版｜固定規則與封存資料</h2><ol><li><strong>原版凍結：</strong>buffer250_partial_2019，2021/01/06～2026/11/20，1,425 個交易日，累積淨報酬 +2,328.07%、最大回撤 −18.50%、勝大盤 46/71 月。</li><li>交易池採原研究的 233 檔股期現股，當年航運／金融仍包含於原研究，不能將排除產業的實驗版當正式原版。</li><li>初始300萬元、小數股複利模擬，最多8檔、單檔上限30%；原本的核心與反轉部位、動態選股排序、帳戶高水位、危機風控及現金銜接規則皆不變。</li><li>核心日線成交依原引擎觸價與開盤執行假設，買入費0.14275%、賣出費稅0.44275%（往返0.5855%）；實際下單不保證成交。</li><li>原版最後交易日2026/11/20；最新免費日K或分K僅代表行情更新，尚須完成原Python引擎的逐日狀態接續才能發布隔日委託。</li></ol><p><a href="/api/c30/latest?download=csv">下載最新上市＋上櫃四碼標的日K（CSV）</a>　·　<a href="/c30/minute/">免費233檔分K下載</a>　·　<a href="/c30/archive/">C30 雲端永久封存</a>　·　<a href="/c30/">獨立來源／診斷</a></p>';
 const controls=document.createElement('div');
 controls.innerHTML='<label>FinMind S 全市場日K資料日 <input type="date"></label> <button type="button">一次下載全市場日K</button> <span role="status"></span>';
 $('#rulesMain').prepend(controls);
 const dateInput=controls.querySelector('input'),button=controls.querySelector('button'),message=controls.querySelector('span');
 dateInput.value=D.finmind?.calendar_as_of||D.official?.as_of||'';
 button.onclick=async()=>{
  const date=dateInput.value,token=c30DeviceToken();
  if(!date||!token){message.textContent='請選擇交易日並儲存本機 FinMind Token';return}
  button.disabled=true;message.textContent='正在取得 '+date+' 全市場資料…';
  const headers={Authorization:'Bearer '+token,'x-c30-source-tier':'sponsor','content-type':'application/json'};
  try{
   const batch=await fetch('/api/c30/free/sponsor-batch',{method:'POST',headers,body:JSON.stringify({date,dataset:'TaiwanStockPrice'})});
   const status=await batch.json();if(!batch.ok||!status.ok)throw Error(status.error||'整市場查詢失敗');
   const response=await fetch('/api/c30/free/market-day?date='+date,{headers,cache:'no-store'});
   const data=await response.json();if(!response.ok||!data.ok||data.meta?.date!==date||!data.rows?.length)throw Error(data.error||'全市場封存驗證失敗');
   const lines=[['date',...data.columns],...data.rows.map(row=>[date,...row])];
   const csv=lines.map(row=>row.map(value=>'"'+String(value??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
   const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
   const link=document.createElement('a');link.href=url;link.download='FinMind_market_'+date+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
   const quality=data.meta.quality;
   const details=quality?'｜異日 '+quality.other_date+' 筆、無效代號 '+quality.invalid_symbol+' 筆、重複 '+quality.duplicates+' 筆、衝突隔離 '+quality.conflicting_symbols+' 個代號':'';
   message.textContent=date+' 全市場 '+data.rows.length+' 筆，已匯出 CSV'+details;
  }catch(error){message.textContent=error.message}finally{button.disabled=false}
 };
 $('#rulesMain').insertAdjacentHTML('beforeend','<h3>Free 雲端逐日完整性（固定 233 檔）</h3>'+freeCoverageHtml(D.finmind));
 $('#dataFacts').innerHTML=[['策略','C30 RISK23 原版'],['版本',D.lock_id],['最後原引擎日',D.as_of],['已核對日數',D.dates.length],['已核對核心委託',D.orders.filter(o=>o.sleeve!=='reversal').length],['已核對反轉成交',D.reversalHistory?D.orders.filter(o=>o.sleeve==='reversal').length:'歷史明細未載入'],['C30／A56 免費雲端已儲存日數',D.finmind?.stored_days||0],['全市場日K封存日數',(D.finmind?.days||[]).filter(x=>x.market?.stored).length],['官方日K最後保存日',D.finmind?.latest_price_date||'尚無'],['四類資料完整日數（233檔）',D.finmind?.complete_days||0],['資料完整性',D.finmind?.complete_days?'已有至少一日完整':'仍需逐檔續傳，空資料另行審查'],['雲端更新錯誤',D.finmind?.sync_error||((D.finmind?.errors||[]).length?'有 '+D.finmind.errors.length+' 項缺漏／權限錯誤':'無')],['目前可讀取行情',D.official?.ok?(D.official.source||'TWSE/TPEx')+' '+D.official.as_of:'尚無可驗證行情'],['每日委託狀態',D.forward?'原引擎已核對 '+D.forward.trade_date:'原引擎待增量重播'],['券商成交','未串接／未確認']].map(([a,b])=>'<div>'+esc(a)+'<b>'+esc(b)+'</b></div>').join('');
 set('#replay','C30 原始封存 SHA-256：'+HASH+'；每日持股價值與原始流水帳對帳誤差小於 0.000001 淨值單位。'+(D.forward?'原引擎接續核對至 '+D.as_of+'。':'等待原引擎接續。'));
 set('#rulesFoot','交易池固定 233 檔；Sponsor 整日全市場收盤價另行完整保存，供日後核對市場廣度（含 ETF／興櫃原始資料，計算時須過濾）。三大法人、融資券、借券與分K只做 233 檔。原版 C30 市場廣度不可未經原引擎對帳就替換。'+(D.finmind?.sync_error?' 最近失敗：'+D.finmind.sync_error:'')+' 盤前計畫由原 Python 引擎重播產生。');
 set('#strategyFooter','C30 RISK23 原版｜帳本至 '+D.as_of+'｜紙上模型');
}
export function exportC30Orders(D,I){
 const date=D.dates[I],f=scale(D.snapshots[I]);
 const header=['交易日','模型成交時間','訊號日','驗證狀態','股票代號','股票名稱','部位','買賣','狀態','觸發價','模擬成交價',
  '模型股數倍率','原始300萬元模型股數','試算股數','模型金額倍率','賣出報酬率（未扣賣出費稅，%）','試算成交金額（元）',
  '賣出淨報酬率（%）','賣出淨損益（元）','原因'];
 const rows=filteredOrders(D,I).map(o=>{
  const net=sellNet(o);
  return [o.date,executionTime(o)||'',o.signal,executionAudit(o),o.code,D.names?.[o.code],orderSleeve(o),orderSide(o),orderStatus(o),o.level,o.price,
   o.quantity,Number.isFinite(o.quantity)?o.quantity*3000000:null,Number.isFinite(o.quantity)?o.quantity*f:null,o.notional,o.realized,Number.isFinite(o.notional)?Math.round(o.notional*f):null,
   net?.pct==null?'':(net.pct*100).toFixed(2),net?Math.round(net.amount*f):null,reason[o.reason]||o.reason];
 });
 const csv=[header,...rows].map(row=>row.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');
 a.href=url;a.download='C30_'+date+'_交易與未成交.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
