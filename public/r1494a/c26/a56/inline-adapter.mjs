import {syncA56Quotes} from './quotes.mjs?v=20261118-close1';
/* A56 combined account inside the original four-tab monitoring dashboard. */
const ROOT='/r1494a/c26/a56/',LOCK='A56-LOCK-20261116';
const $=id=>document.querySelector('#'+id),esc=x=>String(x??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(x,d=2)=>Number.isFinite(x)?x.toLocaleString('zh-TW',{maximumFractionDigits:d}):'—',pct=x=>Number.isFinite(x)?(x>=0?'+':'')+num(x*100)+'%':'—';
const text=(id,v)=>{if($(id))$(id).textContent=v},html=(id,v)=>{if($(id))$(id).innerHTML=v};
const reason={A_open:'A：前日急跌後收復，開盤限價',B_reclaim:'B：跨日收復',C_intraday:'C：今日急跌後收復',
 core_recovery:'核心曝險恢復／核心有新買',warning_ended:'大盤警戒解除',cycle_expiry:'首次成交起第5交易日',
 pending_cycle:'前次反轉賣單待成交',new_position:'核心突破新進場',topup:'核心開盤補足配置',portfolio_reduce:'核心降低曝險',
 cap16:'核心單檔上限減碼',risk_exit:'核心風控出場',protective_stop:'核心保護停損',CONTINUE_HOLDING:'續抱並檢查風控',
 no_touch_no_buy:'全天未達觸發價',target_exposure_full:'資金／目標曝險不足',no_offer_no_fill:'鎖漲停，未買',
 no_bid_no_fill:'鎖跌停，延後賣出',bad_market_data:'行情未通過成交檢查',reversal_exit:'反轉部位開盤退出'};
const explain=x=>reason[x]||x||'—';
const table=(heads,rows)=>'<div class="scroll"><table><thead><tr>'+heads.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
async function get(path){const r=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(path+' HTTP '+r.status);return r.json()}
async function readFrozenHistory(){
 const [index,r]=await Promise.all([get(ROOT+'dashboard-history-index.json'),fetch(ROOT+'dashboard-history.b64',{cache:'no-store'})]);
 if(!r.ok)throw Error('A56歷史帳本 HTTP '+r.status);
 const compressed=Uint8Array.from(atob((await r.text()).trim()),c=>c.charCodeAt(0));
 const bytes=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 if(index.version!==LOCK||index.days!==1419||index.orders!==1759||await hash(bytes)!==index.sha256)throw Error('A56歷史帳本指紋不符');
 const d=JSON.parse(new TextDecoder().decode(bytes));verifyAccount(d.snapshots,d.orders);
 if(d.lock_id!==LOCK||d.source_sha256!==index.source_sha256||d.snapshots.length!==1419||d.orders.length!==1759||d.as_of!=='2026-11-12'||Math.abs(d.snapshots.at(-1).nav-21.707790980649124)>1e-8)throw Error('A56原始封存不符');
 return d;
}
let frozenHistoryPromise=null;
async function history(){
 if(!frozenHistoryPromise)frozenHistoryPromise=readFrozenHistory().catch(e=>{frozenHistoryPromise=null;throw e});
 return frozenHistoryPromise;
}
export function verifyAccount(snapshots,orders){
 if(!Array.isArray(snapshots)||!snapshots.length||!Array.isArray(orders))throw Error('A56帳本空白');
 let cash=1,oi=0,previous='',held=new Map();const sorted=[...orders].sort((a,b)=>a.date.localeCompare(b.date));
 for(const s of snapshots){
  if(s.date<=previous||s.signal>=s.date||!Number.isFinite(s.nav)||s.nav<=0||!Number.isFinite(s.cash)||!Array.isArray(s.holdings)||s.holdings.length>8)throw Error('A56日期／淨值／持倉不符');previous=s.date;
  while(oi<sorted.length&&sorted[oi].date<=s.date){const o=sorted[oi++];
   if(o.signal>=o.date||!['BUY','SELL'].includes(o.side))throw Error('A56委託日期不符');
   if(!o.filled)continue;
   if(!Number.isFinite(o.quantity)||o.quantity<=0||!Number.isFinite(o.price)||o.price<=0)throw Error('A56委託價格或股數不符');
   const sign=o.side==='BUY'?1:-1;cash-=sign===1?o.quantity*o.price*1.0014275:-o.quantity*o.price*.9955725;
   held.set(o.code,(held.get(o.code)||0)+sign*o.quantity);if(Math.abs(held.get(o.code))<1e-10)held.delete(o.code);
  }
  const hs=new Map(s.holdings.map(h=>[h.code,h]));let nav=cash;
  if(hs.size!==held.size||hs.size!==s.holdings.length)throw Error('A56持倉代號／數量不一致');
  for(const [code,q] of held){const h=hs.get(code);if(!h||!Number.isFinite(h.price)||h.price<=0||Math.abs(h.quantity-q)>1e-9)throw Error('A56持股對帳不符');nav+=q*h.price;}
  if(cash< -1e-8||Math.abs(nav-s.nav)>1e-8||Math.abs(cash-s.cash)>1e-8)throw Error('A56現金／淨值對帳不符');
 }
 if(oi!==sorted.length)throw Error('A56存在超出帳本日期的委託');
 return true;
}
let requested=false;
let freeStatus=null,freeLastCheck=0;
let historicalConditions;
async function conditions(){
 if(!historicalConditions)historicalConditions=Promise.all([2021,2022,2023,2024,2025,2026].map(async y=>{
  const r=await fetch(ROOT+y+'.json.gz.b64',{cache:'no-store'});if(!r.ok)throw Error('歷史盤前條件缺失');
  const b=Uint8Array.from(atob((await r.text()).trim()),c=>c.charCodeAt(0));
  return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
 })).then(xs=>xs.flat()).catch(e=>{historicalConditions=null;throw e});
 return historicalConditions;
}
export async function loadA56MonitorSnapshot(shared,{refresh=false}={}){
 let queue={state:'free_source_only',phase:'免費資料更新；原 A56 Python 引擎尚未接續'},error=null;
 // Free mode: NEVER enqueue the legacy Sponsor/bulk-data workflow.
 try{
  const f=await import('../../c30/free-sync.mjs?v=20261125-sponsor-diagnose-v5'),token=f.c30FreeToken();
  freeStatus=await f.c30FreeStatus(token);
  const shouldAuto=token&&(refresh||!requested||Date.now()-freeLastCheck>40*60000);
  if(shouldAuto){freeLastCheck=Date.now();
   Promise.resolve().then(()=>f.updateC30A56Free(token,msg=>{const ui=$('flash');if(ui&&$('strategy')?.value==='A56')ui.textContent=msg},{auto:true,maxRequests:refresh?10:4}))
   .then(status=>{freeStatus=status;if($('strategy')?.value==='A56')setTimeout(()=>globalThis.poll?.(false),0)})
   .catch(e=>{if($('strategy')?.value==='A56')$('flash').textContent='A56 Free 更新失敗：'+e.message});
  }
  requested=true;
 }catch(e){error=e.message;freeStatus={ok:false,latest_price_date:null,model_replayed:false}}
 const base=await history();const legacy=await conditions();
 if(legacy.length!==1419||legacy.some((p,i)=>p.date!==base.snapshots[i].date||p.signal>=p.date))throw Error('歷史盤前條件日期未對齊');
 let server={},delta=null;
 try{
  server=await get('/api/c26/a56/status'); // Read frozen model; do not enqueue paid workflow in Free mode.
  if(server.model_version!=='A56'||server.lock_id!==LOCK)throw Error('A56狀態版本不符');
  if(server.model_archive){
   const r=await fetch(ROOT+'forward.json',{cache:'no-store'});if(!r.ok)throw Error('A56接續資料尚未發布');
   const bytes=await r.arrayBuffer();if(await hash(bytes)!==server.model_archive.asset_sha256)throw Error('A56接續資料SHA-256不符');
   delta=JSON.parse(new TextDecoder().decode(bytes));
   if(delta.lock_id!==LOCK||delta.anchor_as_of!==base.as_of||delta.as_of!==server.model_archive.as_of||delta.snapshots.some(s=>s.date<=base.as_of)||JSON.stringify(delta.snapshots.map(s=>s.date))!==JSON.stringify(server.model_archive.verified_dates))throw Error('A56接續日期不符');
  }
 }catch(e){error=e.message;delta=null;server.plan={readiness:'blocked',actions:[],reason:error};}
 const snapshots=[...base.snapshots,...(delta?.snapshots||[])],orders=[...base.orders,...(delta?.orders||[])];
 verifyAccount(snapshots,orders);
 const ready=!!delta&&server.plan?.readiness==='ready_for_manual_review';
 const plan=ready?server.plan:{readiness:'blocked',actions:[],signal_as_of:snapshots.at(-1).date,trade_date:server.source?.next_trade_date||null,
    reason:error||server.plan?.reason||'等待 A56 原合併帳本更新與盤前驗收'};
 const dates=snapshots.map(s=>s.date),byDate=new Map(dates.map(d=>[d,[]]));for(const o of orders)byDate.get(o.date)?.push(o);
 const ix=new Map(shared.dates.map((d,i)=>[d,i])),curves={strategy:snapshots.map(s=>s.nav)};
 for(const k of ['old49','market'])curves[k]=dates.map(d=>{const v=shared.curves[k]?.[ix.get(d)];return Number.isFinite(v)?v:null});
 const pending=['queued','running'].includes(queue?.state);
 return {model_version:'A56',ledger:LOCK,names:shared.names||{},dates,snapshots,orders,byDate,curves,plan,
  planHistory:{},benchmarkCarry:{},status:{data_as_of:dates.at(-1),checkedThrough:server.source?.as_of||base.as_of,
    sync_status:pending?'running':ready?'current':'model_pending',price_updated_at:server.updated_at,
    lastError:error?{message:error}:null},a56:{base,server,queue,ready,free:freeStatus,historyPlans:base.core_plans||[],legacy,planHistory:delta?.plan_history||{},reviewPlans:delta?[...Object.values(delta.plan_history||{}),delta.plan]:[]}};
}
const factor=(D,I)=>(Number($('capital')?.value)||0)/D.snapshots[I].nav;
function activePlan(D,I){
 if(I===D.snapshots.length-1)return D.plan;
 const recorded=D.a56.planHistory[D.dates[I]]||D.a56.base.anchor_next_plan;
 if(recorded?.signal_as_of===D.dates[I]&&recorded.trade_date===D.dates[I+1])return {...recorded,readiness:'historical'};
 const next=D.dates[I+1];const rows=D.a56.historyPlans.filter(p=>p[2]===next);
 const old=D.a56.legacy.find(p=>p.date===next),actions=rows.map(p=>({code:p[3],side:p[4]==='NEW_ENTRY'?'BUY':p[5]==='HOLD'?'HOLD':'SELL',referencePrice:p[6],level:p[7],stop:p[8],orderType:p[5],reason:p[11],sleeve:'C26'}));
 if(old){
  for(const code of old.sleeve){const h=D.snapshots[I].holdings.find(h=>h.code===code);if(h)actions.push({code,sleeve:'REVERSAL',side:old.sell_reason?'SELL':'HOLD',quantity:h.sideQuantity,referencePrice:h.price,reason:old.sell_reason||'CONTINUE_HOLDING'});}
  const a=old.A_open?.order;if(a)actions.push({code:a.code,sleeve:'REVERSAL',side:'BUY',route:'A_open',level:a.cap,maxShares:a.shares,referencePrice:old.candidates.find(c=>c.code===a.code)?.prior,orderType:'A_OPEN_LIMIT',reason:'A_open'});
 }
 return {readiness:'historical',signal_as_of:D.dates[I],trade_date:next,target:old?.target??D.snapshots[I+1].target,actions,
  warning:old?.warning,side_used:old?.used,exit_reason:old?.sell_reason,
  candidates:(old?.candidates||[]).map(c=>({code:c.code,b_floor:c.B?.floor,b_cap:c.B?.cap,c_arm:c.C.arm,c_floor:c.C.floor,c_cap:c.C.cap})),
  conditions:'歷史盤前重建；只使用該訊號收盤前已知的條件，不讀取隔日實際成交。'};
}
export function renderA56Monitor(D,I){
 const s=D.snapshots[I],p=activePlan(D,I),latest=I===D.dates.length-1,ready=latest&&D.a56.ready,scale=factor(D,I);
 syncA56Quotes(D,I,p);
 const name=c=>c?(D.names[c]||c)+' '+c:'核心組合配置';
 $('date').value=I;text('count',s.holdings.length+' / 8');text('exposure',pct(s.exposure));text('target',pct(s.target));
 const pnl=s.holdings.reduce((v,h)=>v+h.unrealizedNotional,0)*scale;text('pnl',(pnl>=0?'+':'')+num(pnl,0)+' 元');
 text('priceDate',s.date+' 收盤');text('holdingNote','A56 自己的 C26＋反轉合併帳本；依所選日期試算資產同比例換算，非券商實際庫存。');
 const taipeiNow=new Date(Date.now()+8*3600000).toISOString(),today=taipeiNow.slice(0,10);
 const nextDue=D.a56.server?.source?.next_trade_date;
 const sourceLate=taipeiNow.slice(11,16)>='20:00'&&nextDue&&nextDue<=today&&D.status.checkedThrough<nextDue;
 const ledgerLate=D.dates.at(-1)<D.status.checkedThrough;
 const pending=sourceLate||ledgerLate;
 const runner='https://github.com/victordogboy/tw-stock-test/actions/workflows/c26-forward-eod.yml';
 html('status','<strong>'+(pending?'⚠ A56 資料尚未同步，暫停發布新交易指示':'A56 合併帳本已核對至 '+esc(D.dates.at(-1)))+'</strong>'+
  '<br>免費共用資料：官方日K '+esc(D.a56.free?.latest_price_date||'尚無')+'；完整股票日 '+esc(D.a56.free?.complete_days||0)+' 日（原引擎未重播）'+
  '<br>已驗證帳本：'+esc(D.dates.at(-1))+'；已驗證市場資料：'+esc(D.status.checkedThrough)+
  (sourceLate?'；待補交易日：'+esc(nextDue):'')+
  '<br>'+(ready?'盤前計畫已核對：'+esc(D.plan.trade_date):'最新盤前計畫未驗證，僅供查閱舊帳本：'+esc(D.plan.reason||''))+
  (D.a56.queue?'<br>更新佇列：'+esc(D.a56.queue.state||'unknown')+'；'+esc(D.a56.queue.phase||'狀態待核對'):'<br>更新佇列：無法取得')+
  (D.a56.queue?.delayed?'<br><b>更新逾時：原始引擎尚未接手或尚未完成，反覆按重新整理不會產生新帳本。</b>':'')+
  '<br><a href="'+runner+'" target="_blank" rel="noopener noreferrer">開啟 GitHub 原始引擎排程／手動 Run workflow</a>（需登入有權限的 GitHub 帳號）'+
  '<br>開頁或按重新整理只會提出更新請求；必須等原引擎完成、驗證並發布，才可使用最新交易計畫。');
 const rows=s.holdings.map(h=>'<tr><td><b>'+esc(name(h.code))+'</b><span class="sub">'+(h.sideQuantity>0?'反轉部位':'C26 核心')+' · 首次 '+esc(h.entryDate)+' · 最近買入 '+esc(h.lastBuyDate)+'</span></td><td>'+num(h.avgEntryPrice)+'</td><td>'+num(h.price)+'</td><td>'+pct(h.unrealizedPct)+'</td><td>'+num(h.unrealizedNotional*scale,0)+' 元</td><td>'+num(h.costNotional*scale,0)+'／'+num(h.marketNotional*scale,0)+' 元<span class="sub">'+num(h.quantity*scale,3)+'股（比例試算）</span></td><td>'+pct(h.weight)+'</td></tr>');
 html('holdings',rows.join('')||'<tr><td colspan="7" class="empty">A56 模型空手</td></tr>');
 html('holdingCards',s.holdings.map(h=>'<article class="holding"><div class="row"><b>'+esc(name(h.code))+'</b><b>'+pct(h.unrealizedPct)+'</b></div><p>'+(h.sideQuantity>0?'反轉':'核心')+' · 均價 '+num(h.avgEntryPrice)+'／收盤 '+num(h.price)+'</p><div class="facts">'+[['剩餘成本',num(h.costNotional*scale,0)+' 元'],['市值',num(h.marketNotional*scale,0)+' 元'],['未實現損益',num(h.unrealizedNotional*scale,0)+' 元'],['權重',pct(h.weight)],['首次買入',h.entryDate],['最近買入',h.lastBuyDate]].map(([k,v])=>'<div>'+esc(k)+'<b>'+esc(v)+'</b></div>').join('')+'</div></article>').join('')||'<p class="empty">A56 模型空手</p>');
 text('planState',ready?'A56 已驗證盤前計畫':latest?'A56 等待最新計畫':'A56 歷史盤前重建');
 text('planDate','訊號 '+(p.signal_as_of||'—')+' → 交易 '+(p.trade_date||'—'));
 text('planNote',latest&&!ready?p.reason:'C26 核心與三路徑反轉共同管理現金及名額；條件價於盤前凍結，未觸價不買。股期合約、基差與口數另行確認。');
 const planRows=latest&&!ready?[]:p.actions;
 html('planActions',planRows.map(a=>a.side==='REBALANCE'?'<article class="action"><div class="row"><b>核心組合開盤配置</b><span class="pill">條件調整</span></div><div class="price">目標曝險 '+pct(a.target)+'</div><p>單股目標上限 '+pct(a.stockCap)+'；'+(a.allowTopup?'允許原規則補足既有部位，單次加碼須達帳戶權益 '+pct(a.minimumTopupNav):'本盤不啟用既有部位加碼')+'。</p><p class="sub">'+esc(a.details)+' 最終股數與金額待開盤核對，鎖單不假設成交。</p></article>':'<article class="action"><div class="row"><b>'+esc(name(a.code))+'</b><span class="pill">'+esc(a.sleeve==='REVERSAL'?'反轉':'核心')+' · '+esc({BUY:'條件買入',SELL:'開盤賣出',HOLD:'續抱'}[a.side])+'</span></div><div class="price">'+(a.side==='HOLD'?'續抱':a.side==='SELL'?'現股開盤，鎖跌停則順延':(a.orderType==='A_OPEN_LIMIT'?'開盤最高 ':'突破觸發 ')+num(a.level))+'</div><p>前收 '+num(a.referencePrice)+' · '+esc(explain(a.reason))+'</p><p class="sub">'+(a.side==='SELL'?'前收參考金額 '+num(a.quantity*a.referencePrice*scale,0)+' 元':a.maxShares?'數量上限 '+num(Math.floor(Math.min(a.maxShares,a.maxShares/3e6*scale)),0)+' 股（容量與現金另核對）':a.budgetCap?'參考預算上限 '+num(a.budgetCap*scale,0)+' 元':a.stopActive===true?'保護停損啟用 '+num(a.stop):a.stopActive===false?'保護停損未啟用':a.stop!=null?'歷史參考停損 '+num(a.stop)+'（啟用狀態未附）':'依核心風控檢查')+'</p></article>').join('')||'<p class="empty">'+(latest&&!ready?'最新策略仍待原引擎驗收；保留已驗證持倉。':'本盤無新買賣委託，按規則續抱或維持空手。')+'</p>');
 if(p.candidates?.length)html('planActions',$('planActions').innerHTML+'<div class="panel"><h3>盤前 B／C 條件價（尚未觸發）</h3>'+table(['股票','B 收復／上限','C 先跌至','C 再收復','最高買價'],p.candidates.map(c=>[name(c.code),c.b_floor?num(c.b_floor)+'／'+num(c.b_cap):'無跨日資格',num(c.c_arm),num(c.c_floor),num(c.c_cap)]))+'<p>'+esc(p.conditions)+'</p></div>');
 const recent=D.byDate.get(s.date)||[];
 text('dailyWhy',s.date+'：依 '+s.signal+' 已完成資料執行。\n'+recent.map(o=>o.code+' '+(o.sleeve==='REVERSAL'?'反轉':'核心')+' '+(o.side==='BUY'?'買入':'賣出')+'｜'+explain(o.reason)+'｜'+(o.filled?'模擬成交 '+num(o.price):'未成交')).join('\n')+
  (!recent.length?'當日無委託。':'')+'\n收盤持股 '+s.holdings.length+' 檔、曝險 '+pct(s.exposure)+'。\n'+(latest&&ready?(D.plan.warning?'大盤急跌警戒啟動；只有符合 A/B/C 及資金／輪次限制才買入。':'未達大盤急跌警戒，因此不開新增反轉部位，照核心規則管理現有部位。'):'')+
  (latest&&ready&&p.core_entry_explanation?'\n'+p.core_entry_explanation:'')+(latest&&!ready?'\n最新計畫未核對，不能把歷史持倉直接當成今日指令。':''));
 html('risk',[['核心目標曝險',pct(p.target??s.target)],['大盤反轉警戒',p.warning?'啟動':'未啟動／歷史詳見重播'],['核心空頭',s.bear?'啟動':'未啟動'],['20日急跌',s.overlay?'啟動':'未啟動'],['反轉輪次',p.side_used?'本輪已使用':'依警戒與成交日核對'],['退出條件',p.exit_reason?explain(p.exit_reason):'警戒解除／核心恢復／首次成交+5日'],['核心冷卻／相關性','26日／40日'],['交易成本','往返0.5855%']].map(([a,b])=>'<div class="risk"><b>'+esc(a)+'</b><p>'+esc(b)+'</p></div>').join(''));
 html('dataFacts',Object.entries({策略:'A56 合併獨立帳本',版本:LOCK,帳本日期:D.dates.at(-1),行情日期:D.status.checkedThrough,交易日:p.trade_date||'待核對',委託筆數:D.orders.length,Free雲端日K:D.a56.free?.latest_price_date||'未取得',Free四類完整日:D.a56.free?.complete_days||0,Free已保存日:D.a56.free?.stored_days||0,資料接續:'原Python引擎尚未使用Free資料驗證',歷史基準:'1419日／1759筆',新增交易日:D.dates.length-1419,盤前計畫:ready?'已驗證（紙上模型）':'歷史／待更新',更新進度:D.a56.queue?.phase||'狀態待讀取',券商:'未串接',來源:'免費 TWSE／TPEx 日K、FinMind Free 逐檔籌碼、Fugle/Yahoo 1分K；歷史引擎不變'}).map(([k,v])=>'<div>'+esc(k)+'<b>'+esc(v)+'</b></div>').join(''));
 text('replay','A56 1,419日、1,759筆核心＋反轉委託獨立對帳；原反轉38筆／19次交易一致。接續使用原C26因子，保留A56自己的資金與風控路徑。');
}
function periodRows(D,monthly,year){
 const groups=new Map();D.dates.forEach((d,i)=>{if(year&&!d.startsWith(year))return;const k=d.slice(0,monthly?7:4);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(i)});
 const stat=(series,a,b)=>{if(series.slice(Math.max(0,a-1),b+1).some(x=>!Number.isFinite(x)))return null;const base=a?series[a-1]:1;let high=base,dd=0;for(let i=a;i<=b;i++){high=Math.max(high,series[i]);dd=Math.min(dd,series[i]/high-1)}return [series[b]/base-1,dd]};
 return [...groups].reverse().map(([k,is])=>'<tr><td>'+esc(k)+'</td>'+['strategy','old49','market'].map(key=>{const s=stat(D.curves[key],is[0],is.at(-1));return s?'<td>'+pct(s[0])+'</td><td class="negative">'+pct(s[1])+'</td>':'<td colspan="2">待補同期間資料</td>'}).join('')+'</tr>').join('');
}
export function renderA56Performance(D){
 const all=D.curves.strategy,lo=0,hi=Math.max(...all)*1.05,X=i=>50+i/(all.length-1)*920,Y=v=>250-v/hi*225;
 let svg='<svg viewBox="0 0 1000 290" role="img" aria-label="A56合併帳本與對照資金曲線">';
 ['strategy','old49','market'].forEach((key,k)=>{let segment=[];const flush=()=>{if(segment.length)svg+='<polyline fill="none" stroke="'+['#18694f','#97a99a','#c6a568'][k]+'" stroke-width="'+(k===0?2.5:1.5)+'" points="'+segment.join(' ')+'"/>';segment=[]};D.curves[key].forEach((v,i)=>{if(Number.isFinite(v))segment.push(X(i).toFixed(1)+','+Y(v).toFixed(1));else flush()});flush()});
 svg+='<text x="50" y="280">'+D.dates[0]+'</text><text x="970" y="280" text-anchor="end">'+D.dates.at(-1)+'</text></svg>';
 html('chart',svg);html('annual',periodRows(D,false));
 text('chartNote','A56 曲線、逐年與逐月報酬皆來自同一個 C26＋反轉合併帳本，往返成本0.5855%；49檔長抱與200檔市場代理保留原站成本口徑，缺日期不補造。最新 '+D.dates.at(-1)+'。');
}
export function renderA56Monthly(D){html('monthly',periodRows(D,true,$('monthYear')?.value));}
export function renderA56Orders(D,I,limit=120){
 const q=($('search')?.value||'').trim(),f=$('fill')?.value||'';
 const orders=D.orders.filter(o=>o.date<=D.dates[I]&&(!q||(o.code+' '+(D.names[o.code]||'')+' '+explain(o.reason)).includes(q))&&(!f||(f==='filled'?o.filled:!o.filled))).toReversed(),scale=factor(D,I);
 html('orderRows',orders.slice(0,limit).map(o=>'<tr><td>'+esc(o.date)+'<span class="sub">訊號 '+esc(o.signal)+' · '+esc(o.executionTime)+'</span></td><td>'+esc(D.names[o.code]||o.code)+' '+esc(o.code)+'<span class="sub">'+(o.sleeve==='REVERSAL'?'反轉':'核心')+'</span></td><td>'+(o.side==='BUY'?'買入':'賣出')+'<span class="sub">'+(o.filled?'模型成交':'未成交')+'</span></td><td>'+num(o.level)+'</td><td>'+num(o.price)+'</td><td>'+num((o.notional||0)*scale,0)+' 元</td><td>'+pct(o.realizedPct)+(o.realizedNotional!=null?'<span class="sub">'+num(o.realizedNotional*scale,0)+' 元（含費稅）</span>':'')+'</td><td>'+esc(explain(o.reason))+'</td></tr>').join('')||'<tr><td colspan="8">無符合紀錄</td></tr>');
 text('orderCount','顯示 '+Math.min(limit,orders.length)+'／'+orders.length+' 筆；未成交金額為0，不建立模型持股。B/C尚未觸發的條件候選不冒充委託。');if($('more'))$('more').disabled=limit>=orders.length;
}
export function exportA56Orders(D,I){
 const rows=[['帳本','訊號日','交易日','股票','子策略','方向','成交','觸發價','成交價','模型股數（初始300萬）','模型金額（初始300萬）','已實現淨報酬%','原因'],...D.orders.filter(o=>o.date<=D.dates[I]).map(o=>[LOCK,o.signal,o.date,o.code,o.sleeve,o.side,o.filled,o.level,o.price,o.quantity*3e6,o.notional*3e6,o.realizedPct==null?'':o.realizedPct*100,explain(o.reason)])];
 const blob=new Blob(['\ufeff'+rows.map(r=>r.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='A56_'+D.dates[I]+'_交易與未成交.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function decorateA56Monitor(D){
 const brand=document.querySelector('header .brand');if(brand)brand.innerHTML='<b>A56</b>策略監控台';
 text('heroDescription','A56：原 C26 核心＋三路徑崩跌反轉 · 獨立合併帳本 · 最多8檔 · 資料至 '+D.dates.at(-1));
 text('ledgerLabel','A56 合併模型 · 券商成交未確認');
 text('performanceLegend','A56／49檔長抱／200檔市場代理');
 html('performanceNotice','<strong>A56 原合併帳本 · 往返成本0.5855%</strong>原始 '+D.a56.base.snapshots.length+' 日歷史封存與 '+(D.snapshots.length-1419)+' 日接續均以同一策略帳本對帳。全期研究資料並非獨立樣本外績效。');
 text('ordersNote','完整核心與反轉委託一起顯示；單筆已實現損益含買賣費稅，金額按所選日期的試算資產縮放；非券商成交。');
 text('rulesFoot','A56／C30 共用 233 檔 Free 原始資料：TWSE/TPEx 官方日K，FinMind Free 逐檔籌碼，Fugle/Yahoo 分K，按日期＋股票＋資料集永久封存。免費模式不再觸發原來假設 Sponsor 資料的 A56 工作流；仍須原 Python 引擎驗收才會顯示最新正式交易計畫。');
 text('strategyFooter',LOCK+'｜帳本至 '+D.dates.at(-1)+'｜核心與反轉共用資金｜券商未串接');
 html('execution-study-v29','<details><summary><strong>A56 三路徑成交與未成交處理</strong></summary><p>A盤前只預選一檔，開盤超過昨收103%就放棄。B/C使用已完成分鐘確認收復，下一分鐘價格必須在區間內；沒有有效成交價、資料不足或超出容量均不得假設成交。最晚12:30；持倉不能以未成交賣單提早釋放資金。</p></details>');
 html('rulesMain','<h2>A56 完整策略與資料</h2><ol><li><b>原C26核心不變：</b>事件換股；原趨勢、RS、EMA、ATR、法人與動態同儕評分；虧損完整離場冷卻26交易日，40日Pearson相關性≥0.60且相似群組曝險≥30%限制新建倉。最多8檔、核心單股16%目標、新核心建倉至少1萬元。保護停損依原啟用條件，非固定每日掛單。</li><li><b>大盤警戒：</b>前五個完成交易日，最差單日跌幅至少6%或累計跌幅至少10%。個股五日跌幅至少3%，依急跌前60日強度取前四；不使用當天尚未完成日K選股。</li><li><b>A隔日開盤：</b>昨低≤前收92.5%，昨收較昨低反彈≥1%；盤前最多預選一檔，買價最高昨收103%，股數不超過昨量0.1%。開盤不符則放棄，不換下一檔。</li><li><b>B跨日收復：</b>前1～2日曾跌至原參考價92.5%，尚未收復94%；已完成分K收復94%後，下一分鐘價格須在94%～96.5%，數量上限最近三根完成分K量中位數2.5%。</li><li><b>C盤中反轉：</b>今日先跌至昨收92.5%，後續另一根完成分K收復94%，下一分鐘價格在94%～96.5%；容量中位數5%。B/C同時成立先C，同分鐘跨股票依代號順序；最晚12:30。</li><li><b>資金：</b>核心目標曝險≥40%或有新核心進場時不開反轉新單。首批最多4檔，首次成交次日最多3檔，每批名義配置前日淨值40%；扣除核心預留，並受現金、容量和全帳戶8檔限制。連續一段警戒只開一輪。</li><li><b>反轉出場：</b>首次成交後第5交易日開盤，或警戒解除、核心恢復提前開盤賣出。鎖跌停或無有效開盤價則遞延；未另設固定停損停利。</li><li><b>資料與驗收：</b>FinMind日K與法人、原普通股市場代理；反轉執行需要時抓取Tick並與完整日K和成交量核對，再聚合分K。歷史委託、持股、現金與每日淨值獨立對帳；最新計畫在讀取下一盤成交資料前擷取。成本買0.14275%＋賣0.44275%，總0.5855%。</li></ol><p><a href="./c26/a56/">A56逐分鐘歷史核對頁</a> · <a href="https://github.com/victordogboy/tw-stock-test/tree/main/research/a56-live">原引擎與驗收程式</a></p>');
}

