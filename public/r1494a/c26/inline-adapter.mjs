/**
 * Historical C26 adapter for the ORIGINAL R1494-A/FC23 monitor.
 * Only the pinned 2026-10-27 C26 replay is rendered. The adapter is
 * intentionally incapable of synthesizing 2026-11 signals from FC23 orders.
 * Every published asset is SHA-256 verified and the frozen 1407/1758 counts
 * are verified before a single historical position is displayed.
 */
const ROOT='/r1494a/c26/';
const LOCK='C26-EVENT-CORR-LOCK-20261112';
const EXPECTED={days:1407,orders:1758,buys:539,sells:1028,unfilled:191,newFills:309,
  nav:18.20495844396837,returnPct:1720.495844396837,mddPct:-17.989769234703846};
const $=s=>document.querySelector(s);
const finite=n=>Number.isFinite(Number(n));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt=(n,d=2)=>Number.isFinite(Number(n))?Number(n).toLocaleString('zh-TW',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
const pct=n=>Number.isFinite(Number(n))?`${n>=0?'+':''}${fmt(n*100)}%`:'—';
const isFill=v=>/^(True|true|1)$/.test(String(v));
const asArray=async(response)=>new Uint8Array(await response.arrayBuffer());
const hex=buffer=>Array.from(new Uint8Array(buffer),x=>x.toString(16).padStart(2,'0')).join('');
async function sha256(data){if(!globalThis.crypto?.subtle?.digest)throw Error('瀏覽器缺少SHA-256驗證能力');return hex(await crypto.subtle.digest('SHA-256',data));}
async function get(path,kind='json'){
 const res=await fetch(ROOT+path,{cache:'no-store'});
 if(!res.ok)throw Error(`C26 ${path} HTTP ${res.status}`);
 return kind==='text'?res.text():res.json();
}
export function parseCsv(raw){
 const lines=[],header=[],obj=[];let q=false,value='',line=[];
 for(let i=0;i<raw.length;i++){
  const c=raw[i];if(c==='"'){if(q&&raw[i+1]==='"'){value+='"';i++;}else q=!q;}
  else if(c===','&&!q){line.push(value);value='';}
  else if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&raw[i+1]==='\n')i++;line.push(value);value='';if(line.some(v=>v!==''))lines.push(line);line=[];}
  else value+=c;
 }
 if(q)throw Error('CSV 引號未關閉');if(value||line.length){line.push(value);lines.push(line)}
 const columns=lines.shift()||[];if(!columns.length)throw Error('C26 CSV 缺少標題');
 return lines.map((r,i)=>{if(r.length!==columns.length)throw Error('C26 CSV 第'+(i+2)+'行欄數不符');return Object.fromEntries(columns.map((k,j)=>[k,r[j]]));});
}
export function verifyHistorical(rows,orders){
 if(rows.length!==EXPECTED.days||orders.length!==EXPECTED.orders)throw Error('C26歷史筆數與封存不符');
 if(rows[0].date!=='2021-01-06'||rows.at(-1).date!=='2026-10-27')throw Error('C26時間範圍不符');
 let peak=1,mdd=0;
 for(let i=0;i<rows.length;i++){
  if(i>0&&rows[i].date<=rows[i-1].date)throw Error('C26日期順序錯誤');
  const nav=Number(rows[i].nav);if(!Number.isFinite(nav)||nav<=0)throw Error('C26歷史淨值非法');
  peak=Math.max(peak,nav);mdd=Math.min(mdd,nav/peak-1);
 }
 if(Math.abs(Number(rows.at(-1).nav)-EXPECTED.nav)>1e-8||Math.abs(mdd*100-EXPECTED.mddPct)>1e-6)throw Error('C26原始淨值回放不一致');
 let buys=0,sells=0,unfilled=0,newFills=0;
 for(const o of orders){
  if(o.signal_date>=o.execution_date)throw Error('C26訊號未早於成交日期');
  if(!['BUY','SELL'].includes(o.action))throw Error('C26委託方向異常');
  if(!isFill(o.filled)){if(o.action!=='BUY')throw Error('非買單未成交');unfilled++;}
  else if(o.action==='BUY'){
   buys++;
   if(['new_position','fc17_confirmed_reentry','previous_limit_missed'].includes(o.reason)){
    newFills++;
    if(Number(o.notional_proxy)*3000000<9999.99)throw Error('C26最低新建倉不符');
   }
  }else sells++;
 }
 if(buys!==539||sells!==1028||unfilled!==191||newFills!==309)throw Error('C26逐筆分類不符');
 return {days:rows.length,orders:orders.length,buys,sells,unfilled,newFills,lastNav:Number(rows.at(-1).nav),mddPct:mdd*100};
}
async function publishedCsv(mode,index){
 const meta=index.parts?.[mode];
 if(!meta||!Array.isArray(meta.base64_parts)||!meta.base64_parts.length)throw Error(`C26 ${mode} 缺少索引`);
 const chunks=await Promise.all(meta.base64_parts.map(async name=>{
  if(!new RegExp(`^${mode}-base64-\\d{2}\\.txt$`).test(name))throw Error('C26資料檔案名稱不合法');
  return (await get('data/'+name,'text')).trim();
 }));
 const bytes=Uint8Array.from(atob(chunks.join('')),c=>c.charCodeAt(0));
 if(bytes.length!==meta.bytes_gzip||await sha256(bytes)!==meta.sha256_gzip)throw Error(`C26 ${mode} 完整性SHA-256不符`);
 const uncompressed=new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')));
 return parseCsv(await uncompressed.text());
}
function makeHistoricalSnapshots(daily,orderRows){
 const orders=[];for(const o of orderRows){
  const price=Number(o.fill_price),lim=Number(o.limit_or_stop);
  orders.push({ledger:'C26_LOCK_20261112',date:o.execution_date,signal:o.signal_date,
   code:String(o.ticker).padStart(4,'0'),side:o.action,orderType:o.order_type,
   filled:isFill(o.filled),price:Number.isFinite(price)&&price>0?price:null,
   level:Number.isFinite(lim)&&lim>0?lim:null,quantity:Number(o.shares_proxy),
   notional:Number(o.notional_proxy),realizedPct:finite(o.realized_pct)&&o.realized_pct!==''?Number(o.realized_pct)/100:null,
   realizedNotional:null,reason:o.reason,executionTime:'歷史日K模擬'});
 }
 const fills=orders.filter(o=>o.filled).sort((a,b)=>a.date.localeCompare(b.date));
 const held=new Map(),snapshots=[],byDate=new Map();let cur=0;
 for(const d of daily){
  const todays=[];
  while(cur<fills.length&&fills[cur].date<=d.date){
   const o=fills[cur++],prior=held.get(o.code),qty=(prior?.quantity||0)+(o.side==='BUY'?o.quantity:-o.quantity);
   if(qty<-1e-8)throw Error('C26現股模型負持股 '+o.code);
   if(qty<1e-11)held.delete(o.code);else held.set(o.code,{code:o.code,quantity:qty,
     entryDate:prior?.entryDate||o.date,lastBuyDate:o.side==='BUY'?o.date:prior?.lastBuyDate||o.date});
   todays.push(o);
  }
  if(held.size>8)throw Error('C26模型持股數超過8');
  const snapshot={date:d.date,signal:d.date,nav:Number(d.nav),exposure:Number(d.exposure),target:null,
   holdings:[...held.values()].map(h=>({...h})),riskGate:Number(d.risk_gate),
   archived_only:true,basket:null,bear:null,overlay:null,gate:null,market20:null,breadthChange:null};
  snapshots.push(snapshot);byDate.set(d.date,todays);
 }
 return {snapshots,orders,byDate};
}
function benchmarkCurves(shared,dates){
 const index=new Map((shared?.dates||[]).map((d,i)=>[d,i]));
 const curves={};
 for(const k of ['old49','market']){
  const series=shared?.curves?.[k];
  curves[k]=dates.map(d=>{const i=index.get(d),v=series?.[i];return Number.isFinite(v)?v:null;});
 }
 return curves;
}
function statusDate(shared){return shared?.status?.data_as_of||null;}
/** Loads the exact original 1407-day C26 ledger; market status only is consulted separately. */
export async function loadC26MonitorSnapshot(shared,{refresh=false}={}){
 const [manifest,index]=await Promise.all([get('manifest.json'),get('data/historical-assets.json')]);
 if(manifest.lock_id!==LOCK||manifest.live_plan_readiness!=='blocked'||manifest.live_trading_enabled!==false||index.lock_id!==LOCK||index.asof!=='2026-10-27')throw Error('C26版本及安全鎖不符');
 const [daily,rawOrders]=await Promise.all([publishedCsv('nav',index),publishedCsv('orders',index)]);
 verifyHistorical(daily,rawOrders);
 const dates=daily.map(d=>d.date),history=makeHistoricalSnapshots(daily,rawOrders);
 let server={};
 try{
  if(refresh){const kick=await fetch('/api/c26/refresh',{method:'POST',cache:'no-store'});if(!kick.ok)throw Error('共用市場資料重整 HTTP '+kick.status);}
  const r=await fetch('/api/c26/status'+(refresh?'?refresh=1':''),{cache:'no-store'});
  if(!r.ok)throw Error('HTTP '+r.status);server=await r.json();
 }catch(e){server={source_status:'unknown',source_error:String(e?.message||e)}}
 const reason='C26正式最新訊號尚未通過凍結Python引擎逐日一致性驗證；不得沿用FC23或R1494-A買賣指令。';
 const status={model_version:'C26',data_as_of:'2026-10-27',signal_as_of:'2026-10-27',
  checkedThrough:server.latest_market_data_as_of||statusDate(shared)||'未核對',
  current_market_as_of:server.latest_market_data_as_of||statusDate(shared)||null,
  sync_status:'blocked',trade_status:'historical_only_broker_unconfirmed',
  universe_count:233,price_updated_at:server.updated_at||null,
  lastError:{date:'2026-10-28',message:reason},
  live_source_status:server.source_status||'unknown',live_source_error:server.source_error||null};
 return {model_version:'C26',ledger:'C26_LOCK_20261112',dates,snapshots:history.snapshots,
  orders:history.orders,byDate:history.byDate,curves:{strategy:history.snapshots.map(s=>s.nav),...benchmarkCurves(shared,dates)},
  names:shared?.names||{},status,benchmarkCarry:{},
  plan:{model_version:'C26',signal_as_of:null,trade_date:null,readiness:'blocked',blockedReason:reason,
   data_version:LOCK,actions:[]},planHistory:{},c26Meta:{verified:true,source:index,manifest,server,reason}};
}
const nodeText=(id,txt)=>{const e=$('#'+id);if(e)e.textContent=txt};
const nodeHtml=(id,html)=>{const e=$('#'+id);if(e)e.innerHTML=html};
/** Custom rendering explicitly avoids fictional per-stock market prices or brokerage P&L. */
export function renderC26Monitor(D,I){
 const s=D.snapshots[I],latest=I===D.snapshots.length-1,now='2026-10-27',historical='已封存歷史回放';
 nodeHtml('status',`<strong>C26 最新盤前計畫：BLOCKED（凍結版尚未接續2026/10/27以後資料）</strong>`+
  `已驗證的 C26 模型資料截至 ${now}，目前共用市場資料 ${esc(D.status.current_market_as_of||'未驗證')}。<br>`+
  `${esc(D.c26Meta.reason)}<br>共用資料來源：${esc(typeof D.status.live_source_error==='object'?(D.status.live_source_error?.message||'驗證未完成'):(D.status.live_source_error||'待驗證'))}<br>選取歷史日期只會顯示當時模擬，不代表今日持股或交易計畫。`);
 nodeText('ledgerLabel','C26 凍結歷史紙上持倉 · 非當日實盤');
 nodeText('count',`${s.holdings.length} / 8（歷史）`);
 nodeText('exposure',pct(s.exposure));nodeText('target','—（未發布）');nodeText('pnl','—（無逐股收盤估值）');
 nodeText('priceDate',s.date+' 歷史收盤');nodeText('holdingNote','C26歷史模擬持股；不是目前券商庫存、也不是最新C26交易計畫。');
 const cards=s.holdings.map(h=>`<article class="holding"><b>${esc(D.names[h.code]||h.code)} ${esc(h.code)}</b>`+
  `<div class="facts"><div>回測模型股數（初始300萬）<b>${fmt(h.quantity*3000000,4)}</b></div>`+
  `<div>首次建倉<b>${esc(h.entryDate)}</b></div><div>最近買入<b>${esc(h.lastBuyDate)}</b></div>`+
  `<div>當日股價／未實現損益<b>未附逐股日K，禁止猜測</b></div></div></article>`).join('');
 nodeHtml('holdingCards',cards||'<p class="empty">當日 C26 歷史模型空手</p>');
 nodeHtml('holdings',s.holdings.map(h=>`<tr><td><b>${esc(D.names[h.code]||h.code)} ${esc(h.code)}</b>`+
  `<span class="sub">首次 ${esc(h.entryDate)} · 最近買入 ${esc(h.lastBuyDate)}</span></td>`+
  `<td>—</td><td>—</td><td>—</td><td>—</td><td>${fmt(h.quantity*3000000,4)}股（回測）</td><td>—</td></tr>`).join('')||'<tr><td colspan="7" class="empty">C26 當日歷史模型空手</td></tr>');
 const recent=D.byDate.get(s.date)||[];
 nodeText('dailyWhy',`${s.date} · ${historical}\n前收訊號交易、隔日OHLC模擬成交。`+
  `\n當日模擬買入 ${recent.filter(o=>o.side==='BUY').length} 筆、賣出 ${recent.filter(o=>o.side==='SELL').length} 筆。`+
  `\n${recent.map(o=>`${o.code} ${o.side==='BUY'?'買入':'賣出'}｜${o.reason}｜${o.filled?'歷史成交 '+fmt(o.price):'當日未成交'}`).join('\n')||'當日無委託'}`+
  `\n歷史資產倍數 ${fmt(s.nav,4)}×，總曝險 ${pct(s.exposure)}，持股 ${s.holdings.length} 檔。`+
  (latest?'\n重要：封存最後日不是今天。2026/10/28以後的C26持倉變化尚未接續。':''));
 nodeHtml('risk',[['26交易日冷卻','保留','個股風控虧損完整離場後26交易日禁重入'],
  ['持股相關性','40日，Pearson ≥0.60','相似持股曝險≥30%限制新建倉'],
  ['固定日期換股','完全禁止','只有真正賣出與風控事件才換股'],
  ['模型即時資料',D.status.live_source_status||'尚未核實','最新行情可查，但未核對C26專屬完整因子與持股'],
  ['歷史模型曝險',pct(s.exposure),'僅 '+s.date+' 已封存回測'],
  ['成本','往返0.5855%','買0.14275%、賣0.44275%，已含指定滑價']].map(([a,b,c])=>
   `<div class="risk"><div class="row"><b>${esc(a)}</b><span class="pill">${esc(b)}</span></div><p class="sub">${esc(c)}</p></div>`).join(''));
 nodeText('planState','C26 最新計畫：資料／引擎驗證未通過');
 nodeText('planDate','歷史訊號截至 2026-10-27 · 最新交易日尚未接續');
 nodeText('planNote',D.c26Meta.reason);
 nodeHtml('planActions',`<p class="empty">沒有已驗證的 C26 最新買入、賣出或續抱指令。不能以歷史空手或持股直接推論今日動作。</p>`);
 nodeHtml('dataFacts',Object.entries({model_version:'C26',lock_id:LOCK,
  historical_as_of:'2026-10-27',historical_orders:'1,758',historical_days:'1,407',
  market_source_as_of:D.status.current_market_as_of||'未核對',
  signal_as_of:'未發布',live_state:'BLOCKED',transaction_cost:'0.5855% (含滑價)',
  benchmark_note:'2026現存股期名單回溯，樣本內研究'}).map(([k,v])=>`<div>${esc(k)}<b>${esc(v)}</b></div>`).join(''));
 nodeText('replay','C26 凍結源碼SHA-256驗證；1407日淨值與1758筆委託通過。最低新建倉1萬元、最多8檔。最新C26資料尚未接續。');
 const heading=document.querySelector('header .brand');if(heading)heading.innerHTML='<b>C26</b>策略監控台';
}
function plot(data){
 const vals=data.snapshots.map(x=>x.nav),dates=data.dates,width=960,height=260,lo=Math.min(0,...vals),hi=Math.max(1,...vals);
 const X=i=>55+880*i/(vals.length-1),Y=v=>220-196*(v-lo)/(hi-lo||1);
 const pts=vals.map((v,i)=>`${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
 return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="C26 凍結 1407交易日淨值"><polyline fill="none" stroke="#17694f" stroke-width="2" points="${pts}"/><text x="55" y="250">${dates[0]}</text><text x="910" y="250" text-anchor="end">${dates.at(-1)}</text></svg>`;
}
function periodStats(D,monthly=false,year=null){
 const groups=new Map();for(let i=0;i<D.dates.length;i++){
  const date=D.dates[i];if(year&&!date.startsWith(year))continue;
  const key=date.slice(0,monthly?7:4);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);
 }
 return [...groups].reverse().map(([k,idx])=>{
  const first=idx[0],last=idx.at(-1),series=D.curves.strategy,base=first?series[first-1]:1;
  let high=base,mdd=0;for(const i of idx){high=Math.max(high,series[i]);mdd=Math.min(mdd,series[i]/high-1)}
  return `<tr><td>${esc(k)}</td><td>${pct(series[last]/base-1)}</td><td class="negative">${pct(mdd)}</td>`+
    '<td colspan="4">基準同口徑資料未核對，不提供假績效</td></tr>';
 }).join('');
}
export function renderC26Performance(D){
 nodeHtml('chart',plot(D));
 nodeText('chartNote','C26 2021/01/06～2026/10/27 凍結淨值；不代表2026/11當日持股或最新績效。對照組需同期間核對後才顯示。');
 nodeHtml('annual',periodStats(D));
}
export function renderC26Monthly(D){nodeHtml('monthly',periodStats(D,true,$('#monthYear')?.value||null));}
export function decorateC26Monitor(){
 nodeHtml('performanceNotice','<strong>C26：已核對的2021～2026歷史回測</strong>往返0.5855%（含滑價）。歷史資料截止2026-10-27；最新盤前買賣計畫尚未驗證，禁止以FC23／R1494-A訊號替代。');
 nodeText('heroDescription','C26 無固定換倉日 · 26交易日虧損冷卻 · 40日相關性風控 · 最多8檔 · 回測截至2026/10/27');
 nodeText('rulesFoot','C26凍結策略用最新已完成盤後訊號。現階段只有歷史研究資料，2026/10/28後並未逐日驗證；不可自動下單。');
}
/** Historical orders in exact normalized model base (initial NTD 3 million). */
export function renderC26Orders(D,I,limit=120){
 const date=D.dates[I],query=($('#search')?.value||'').trim(),only=$('#fill')?.value||'';
 const current=D.orders.filter(o=>o.date<=date && (!query||o.code.includes(query)||(D.names?.[o.code]||'').includes(query)) && (!only||(only==='filled'?o.filled:!o.filled))).reverse();
 const rows=current.slice(0,limit).map(o=>`<tr><td>${esc(o.date)}<span class="sub">訊號 ${esc(o.signal)}</span></td>`+
  `<td>${esc(D.names[o.code]||o.code)} <small>${esc(o.code)}</small></td>`+
  `<td>${o.side==='BUY'?'買入':'賣出'}<span class="sub">${o.filled?'歷史模擬成交':'歷史未成交'}</span></td>`+
  `<td>${fmt(o.level)}</td><td>${fmt(o.price)}</td>`+
  `<td>${o.filled?fmt(o.notional*3000000)+' 元':'—'}</td>`+
  `<td>${o.side==='SELL'&&o.filled&&o.realizedPct!=null?pct(o.realizedPct):'—'}<span class="sub">未提供該筆實現淨額</span></td>`+
  `<td>${esc(o.reason)}</td></tr>`).join('');
 nodeHtml('orderRows',rows||'<tr><td colspan="8" class="empty">無符合的歷史委託</td></tr>');
 nodeText('orderCount',`顯示 ${Math.min(limit,current.length)} / ${current.length} 筆。僅 C26 凍結歷史，交易金額依原始300萬元本金計；非今日可下單數量。`);
 const more=$('#more');if(more)more.disabled=limit>=current.length;
}
export function exportC26Orders(D,I){
 const chosen=D.orders.filter(o=>o.date<=D.dates[I]);
 const cols=['歷史模擬','訊號日','成交日','股票代號','方向','成交狀態','訂單種類','觸發價','成交價','股數（原始300萬資金）','歷史成交名目額（原始300萬）','個股已實現報酬%','回測原因'];
 const data=chosen.map(o=>['C26_LOCK_20261112',o.signal,o.date,o.code,o.side,o.filled?'成交':'未成交',o.orderType,o.level??'',o.price??'',o.filled?o.quantity*3000000:0,o.filled?o.notional*3000000:0,o.realizedPct==null?'':o.realizedPct*100,o.reason]);
 const escapeCell=x=>'"'+String(x??'').replaceAll('"','""')+'"';
 const csv='\ufeff'+[cols,...data].map(row=>row.map(escapeCell).join(',')).join('\r\n');
 const link=document.createElement('a'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
 link.href=url;link.download='C26_LOCK_截至'+D.dates[I]+'_歷史模擬交易.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}