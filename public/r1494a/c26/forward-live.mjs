/* C26 verified forward paper plan for dedicated page.
 * Never derive an order from FC23, R1494-A, historical positions or raw FinMind bars.
 * Trust only the Worker-validated plan; independently SHA-256-check the C26 replay asset.
 */
const LOCK='C26-EVENT-CORR-LOCK-20261112';
const ENGINE_SHA='741862f102438f8f10fcf40cf2f9b47edb8fece004e0175ae3f1be7e94bd4ad5';
const $=id=>document.getElementById(id);
const amount=(v,decimals=2)=>Number.isFinite(v)?Number(v).toLocaleString('zh-TW',{maximumFractionDigits:decimals}):'—';
const pct=v=>Number.isFinite(v)?(v>=0?'+':'')+amount(v*100,2)+'%':'—';
const set=(id,value)=>{const node=$(id);if(node)node.textContent=String(value)};
const heading=$('c26-current-heading');
const summary=$('c26-current-summary');
const holdings=$('c26-current-holdings');
const orders=$('c26-current-actions');
function textRow(body,values){
 const tr=document.createElement('tr');
 for(const v of values){const td=document.createElement('td');td.textContent=String(v);tr.append(td)}
 body.append(tr);
}
async function jsonResponse(url){
 const response=await fetch(url,{cache:'no-store',credentials:'same-origin'});
 if(!response.ok)throw Error('HTTP '+response.status+' '+url);
 return response.json();
}
async function verifiedReplay(plan){
 if(!crypto?.subtle?.digest)throw Error('瀏覽器不支援必要的 SHA-256 資料檢查');
 if(!/^[a-f0-9]{64}$/.test(plan.forward_asset_sha256||''))throw Error('缺少有效 C26 接續帳本指紋');
 const r=await fetch('./data/forward-replay.json',{cache:'no-store',credentials:'same-origin'});
 if(!r.ok)throw Error('尚未部署 C26 接續帳本（HTTP '+r.status+'）');
 const bytes=await r.arrayBuffer();
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 if(hash!==plan.forward_asset_sha256)throw Error('C26 接續帳本 SHA-256 與已驗證計畫不一致');
 const doc=JSON.parse(new TextDecoder().decode(bytes));
 const days=plan.forward_replay?.verified_dates||[];
 if(doc.lock_id!==LOCK||doc.simulator_sha256!==ENGINE_SHA||doc.audited!==true
  ||doc.last_date!==plan.signal_as_of||doc.verified_dates?.length!==days.length
  ||JSON.stringify(doc.verified_dates)!==JSON.stringify(days)
  ||doc.snapshots?.length!==days.length||!days.length
  ||doc.snapshots.at(-1).date!==plan.signal_as_of)throw Error('接續帳本版本或交易日不一致');
 let prev='2026-10-27';
 for(const s of doc.snapshots){
  if(s.date<=prev||!Number.isFinite(s.nav)||s.nav<=0||!Array.isArray(s.holdings)||s.holdings.length>8)
   throw Error('C26 接續帳本持倉不合法');
  prev=s.date;
 }
 const last=doc.snapshots.at(-1);
 if(Math.abs(last.nav*3000000-plan.positions.equity_ntd)>0.02)
  throw Error('最後模型淨值與盤前計畫未對齊');
 if(!Array.isArray(plan.positions?.holdings)||plan.positions.holdings.length!==last.holdings.length)
  throw Error('盤前計畫持倉與接續帳本不相符');
 const holdingsMap=new Map(last.holdings.map(x=>[String(x.code),x]));
 for(const h of plan.positions.holdings){
  const x=holdingsMap.get(String(h.stock_id));
  if(!x||Math.abs(x.quantity*3000000-h.quantity)>Math.max(.001,Math.abs(h.quantity)*1e-8))
   throw Error('盤前計畫持股股數與接續帳本不相符');
 }
 return {last,days:days.length,orderCount:doc.orders.length};
}
async function refreshPaperPlan(){
 if(!heading||!summary||!holdings||!orders)return;
 set('c26-current-heading','C26 最新模型：正在核對...');
 set('c26-current-summary','從正式 API 核對凍結版本、前向重播與資料 SHA-256...');
 holdings.replaceChildren();orders.replaceChildren();
 const status=await jsonResponse('/api/c26/status?paper='+Date.now());
 const plan=status.plan;
 if(status.model_version!=='C26'||status.lock_id!==LOCK||status.no_broker_orders!==true)
  throw Error('正式 C26 版本或券商送單安全旗標不符');
 if(plan?.readiness!=='ready_for_manual_review'){
  set('c26-current-heading','C26 最新交易計畫：暫停發布');
  set('c26-current-summary','FinMind盤後來源：'+(status.forward_coverage?.source_as_of||'未核對')+
   '。尚未驗證當日完整 C26 模型接續。'+(plan?.plan_gate_error?' 原因：'+plan.plan_gate_error:'')+
   '。10/27 歷史持股不是目前模型持股。');
  set('c26-live-readiness','C26 最新交易計畫：尚未核准，不能作為下單依據');
  return {ready:false};
 }
 if(plan.model_version!=='C26'||plan.lock_id!==LOCK||plan.simulator_sha256!==ENGINE_SHA
  ||plan.engine!=='frozen_python_c26'||plan.factors?.full_parity!==true
  ||plan.positions?.inventory_parity!==true||plan.positions?.cash_parity!==true
  ||plan.orders_frozen_same_day_check!==true||plan.transaction_cost_roundtrip_pct!==.5855
  ||status.forward_coverage?.source_as_of!==plan.signal_as_of)
  throw Error('C26 策略引擎、成本或資料截止日未核對');
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 if(plan.trade_date<today)throw Error('C26 計畫已過期，禁止繼續顯示舊買賣單');
 const replay=await verifiedReplay(plan);
 set('c26-current-heading','C26 '+plan.trade_date+' 盤前計畫｜已驗證，僅供人工核對');
 set('c26-live-readiness','C26 '+plan.trade_date+' 盤前紙上計畫：已驗證（尚未券商下單）');
 set('c26-live-detail','原 C26 凍結 Python 引擎 + '+replay.days+' 個前向交易日獨立持股、現金與因子對帳。模型數量不是券商真實持倉。');
 set('c26-current-summary',
  '訊號來源：'+plan.signal_as_of+' 完整收盤資料；交易日：'+plan.trade_date+
  '。接續 '+replay.days+' 日、新委託歷史 '+replay.orderCount+' 筆。模型持股 '+plan.positions.holdings.length+
  '/8，模型權益 '+amount(plan.positions.equity_ntd,0)+' 元（以300萬元原始本金及再投入計算）。'+
  ' 目標曝險 '+pct(plan.target_exposure)+'，往返成本0.5855%；不會自動下單。');
 for(const h of plan.positions.holdings)
  textRow(holdings,[h.stock_id,amount(h.quantity,3)+' 股（模型）',amount(h.price)+' 元',amount(h.market_value_ntd,0)+' 元',pct(h.unrealized_pct)]);
 for(const a of plan.actions||[])
  textRow(orders,[a.stock_id||'—',({HOLD:'續抱',BUY:'買入',SELL:'賣出',NO_ACTION:'無新委託',TOPUP:'加碼',TRIM:'減碼'})[a.action]||a.action,
   a.action==='HOLD'?'無新增委託':a.order_type||'—',
   Number.isFinite(a.limit_or_stop_ntd)?amount(a.limit_or_stop_ntd)+' 元':'—',
   a.stop_active?'啟用 '+amount(a.protective_stop)+' 元':'未啟用',
   a.reason||'—']);
 if(!plan.actions?.length)textRow(orders,['—','沒有新委託','—','—','—','—']);
 return {ready:true,day:plan.signal_as_of,tradeDate:plan.trade_date};
}
let pending=null;
export async function refreshForwardPanel(){
 if(pending)return pending;
 pending=refreshPaperPlan().catch(e=>{
  set('c26-current-heading','C26 最新交易計畫：完整性驗證未通過');
  set('c26-current-summary','目前不能發布可執行指令：'+String(e?.message||e));
  set('c26-live-readiness','C26 最新交易計畫：資料校驗失敗，請勿據此下單');
  return {ready:false,error:String(e?.message||e)};
 }).finally(()=>{pending=null});
 return pending;
}
if(typeof document!=='undefined'){
 $('c26-current-refresh')?.addEventListener('click',refreshForwardPanel);
 refreshForwardPanel();
}
