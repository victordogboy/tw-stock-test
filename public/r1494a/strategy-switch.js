/* Shared dashboard adapter. FC23 data comes only from the verified original engine. */
async function fetchGzipJson(path,base64=false){
 const response=await fetch(path,{cache:'no-store'});
 if(!response.ok)throw Error(path+' HTTP '+response.status);
 const stream=base64?new Blob([Uint8Array.from(atob((await response.text()).trim()),c=>c.charCodeAt(0))]).stream():response.body;
 return new Response(stream.pipeThrough(new DecompressionStream('gzip'))).json();
}
async function loadFc23Snapshot(shared,{refresh=false}={}){
 const d=await fetchGzipJson('./fc23/integrated-snapshot.b64',true);
 if(d.model_version!=='FC23'||d.snapshots.length!==1407||d.orders.length!==1773||Math.abs(d.snapshots.at(-1).nav-32.8528999624682)>1e-8)throw Error('FC23 原引擎驗證未通過');
 const api='/api/fc23/';let delta;
 try{
  if(refresh){
   $('#flash').textContent='FC23 正在排程補齊最新交易日…';
   const kick=await fetch(api+'refresh',{method:'POST',cache:'no-store'});
   if(!kick.ok)throw Error('更新啟動失敗 HTTP '+kick.status);
  }
  for(let attempt=0;attempt<(refresh?30:1);attempt++){
   const r=await fetch(api+'snapshot',{cache:'no-store'});if(!r.ok)throw Error('FC23資料讀取失敗 HTTP '+r.status);delta=await r.json();
   $('#flash').textContent=delta.progress?.phase||'FC23 正在重新計算持倉與隔日計畫…';
   if(!refresh||!delta.running)break;await new Promise(resolve=>setTimeout(resolve,2000));
  }
  if(delta?.snapshots?.length){
   const lastHistorical=d.dates.at(-1);for(const item of delta.snapshots){if(item.date<=lastHistorical)throw Error('FC23最新資料覆寫歷史封存');d.snapshots.push(item);d.dates.push(item.date)}
   d.orders.push(...delta.orders);Object.assign(d.planHistory,delta.planHistory);d.curves.strategy=d.snapshots.map(item=>item.nav);
  }
  if(delta?.plan)d.plan=delta.plan;
  if(delta?.progress)d.updateProgress=delta.progress;
  if(delta?.data_as_of){Object.assign(d.status,{data_as_of:delta.data_as_of,signal_as_of:delta.signal_as_of||delta.data_as_of,checkedThrough:delta.checkedThrough||delta.data_as_of,price_updated_at:delta.price_updated_at,sync_status:delta.running?'running':delta.sync_status,lastError:delta.lastError?{...delta.lastError,date:delta.lastError.date||delta.data_as_of}:null,sources:delta.sources||[]})}
 }catch(error){d.status.lastError={message:error.message,date:d.status.data_as_of};d.status.sync_status='blocked';d.plan.readiness='blocked';d.plan.blockedReason='FC23更新失敗：'+error.message}
 // Benchmarks share the original published data and align by date, never by array offset.
 const idx=new Map(shared.dates.map((date,i)=>[date,i]));
 for(const key of ['old49','market']){d.curves[key]=[];for(const date of d.dates){const i=idx.get(date),value=shared.curves[key][i];if(!Number.isFinite(value))break;d.curves[key].push(value)}}
 d.sharedStatus=shared.status;
 return d;
}
function fc23Why(d,i){
 const s=d.snapshots[i],orders=d.orders.filter(o=>o.date===s.date),p=i===d.snapshots.length-1?d.plan:d.planHistory[s.date];
 return [s.date+' FC23 原引擎'+(s.date>'2026-10-27'?'紙上':'歷史')+'執行，訊號截至 '+s.signal,
 '20交易日調倉；每5交易日檢查風控與配置；符合強勢同儕條件者可於離場後第3～35交易日重新進場。',
 ...orders.map(o=>o.code+' '+(o.side==='BUY'?'買入':'賣出')+'｜'+(reasons[o.reason]||o.reason)+(o.level!=null?'，觸發價 '+num(o.level,2):'')+(o.filled?'，成交價 '+num(o.price,2):'，未成交')),
 ...(p?.decision?[p.decision.rebalance?'下一交易日為20日調倉日。':'下一交易日未到20日調倉日。',p.decision.riskRelease?'風控解除，可依排名安排補股。':'沒有風控解除觸發的一般補股。',p.decision.target<.7?'目標曝險 '+pct(p.decision.target)+' 低於70%重進場門檻，不啟動強勢重進場。':'強勢重進場符合 '+p.decision.reentryCandidates+' 檔。','市場廣度 '+pct(p.decision.breadth)+'；10日變化 '+pct(p.decision.breadthDelta)+'。'+(p.decision.marketCold?'3日急跌與低廣度防守啟動，曝險乘0.15。':'')+(p.decision.portRisk?'帳戶40日風控啟動，暫停曝險。':'')+(p.decision.ddGate?'帳戶回撤與市場轉弱風控啟動，曝險乘0.1。':'')]:[]),
 '當日目標曝險 '+pct(s.target)+'；實際曝險 '+pct(s.exposure)+'；持有 '+s.holdings.length+' 檔。',
 p?.trade_date?p.trade_date+(i===d.snapshots.length-1?' 下一交易日計畫：買入 ':' 歷史計畫：買入 ')+p.actions.filter(a=>a.side==='BUY').length+'、賣出 '+p.actions.filter(a=>a.side==='SELL').length+'、續抱 '+p.actions.filter(a=>a.side==='HOLD').length+' 檔。':d.plan.blockedReason].join('\n');
}
function renderFc23Plan(){
 const p=I===D.snapshots.length-1?D.plan:D.planHistory[D.snapshots[I].date];
 const latest=I===D.snapshots.length-1,ready=latest&&p?.readiness==='ready';
 $('#planState').textContent=ready?'FC23 最新凍結計畫':latest?'FC23 資料待補':'FC23 原引擎歷史計畫';
 $('#planDate').textContent=p?.trade_date?(ready?'最新訊號 ':'歷史訊號 ')+p.signal_as_of+' → '+p.trade_date:'訊號計算資料截至 '+D.status.data_as_of;
 $('#planNote').textContent=latest&&!ready?(p?.blockedReason||'FC23資料更新中'):ready?'FC23已以最新完整日線、法人與動態同儕重算；價位於開盤前確定，實際金額仍依開盤與可用資金檢查。':p?.trade_date?'依原引擎已完成資料重播；此處不展示隔日實際高低價。FC23 沿用原始成交規則，回測已計入往返總成本0.5855%。':D.plan.blockedReason;
 $('#planActions').innerHTML=(p?.actions||[]).map(a=>'<article class="action"><div class="row"><b>'+esc(a.code?name(a.code)+' '+a.code:'組合配置')+'</b><span class="pill">'+({BUY:'突破買入',SELL:'開盤賣出',HOLD:'持續持有',REBALANCE:'開盤配置'}[a.side])+' · '+(ready?'尚未成交':'歷史計畫')+'</span></div><div class="price">'+(a.side==='BUY'?num(a.level,2):a.side==='SELL'?'次日現股開盤價':a.side==='REBALANCE'?'目標曝險 '+pct(a.target):'續抱')+'</div><p>前收 '+num(a.referencePrice,2)+(Number.isFinite(a.stop)?' · '+(a.stopActive===false?'停損條件未啟動，參考價 ':'保護停損 ')+num(a.stop,2):'')+'</p><p>'+esc(reasons[a.reason]||a.reason)+'</p><p class="sub">'+esc(({NO_FILL_NO_BUY:'未觸價不買',CONTINUE_HOLDING:'持續持有並檢查風控',OPEN_UNCONDITIONAL:'次日開盤模擬賣出'}[a.noFillPolicy])||a.noFillPolicy)+'</p></article>').join('');
}
let originalDashboardCopy;
function decorateStrategy(){
 const isFc=D.model_version==='FC23';
 const nodes=['#rulesMain','#performanceNotice','#performanceLegend','#execution-study-v29','#ledgerLabel','#rulesFoot','#heroDescription','#strategyFooter','#ordersNote'];
 if(!originalDashboardCopy)originalDashboardCopy=Object.fromEntries(nodes.map(id=>[id,$(id).innerHTML]));
 for(const id of nodes)$(id).innerHTML=originalDashboardCopy[id];
 $('.brand b').textContent=D.model_version;document.title=D.model_version+'｜策略監控台';
 $('#strategy').value=isFc?'FC23':'R1494-A';
 document.querySelectorAll('[data-strategy-title]').forEach(el=>el.textContent=D.model_version+' 報酬');
 $('#strategySummary').textContent=D.model_version+' 累積 '+pct(D.curves.strategy.at(-1)-1)+' · 最大回撤 '+pct(drawdown(D.curves.strategy))+' · '+D.dates[0]+'～'+D.dates.at(-1);
 if(!isFc)return;
 $('#ledgerLabel').textContent=(D.status.sync_status==='current'?'模型紙上持倉':'模型歷史持倉')+' · FC23_paper';
 $('#heroDescription').textContent='233檔研究池 · 最多8檔 · 20交易日調倉 · 5交易日風控 · 強勢同儕重新進場';
 $('#strategyFooter').textContent='FC23 · 原引擎歷史模擬 · 往返成本0.5855%';
 $('#ordersNote').textContent='依所選日期的試算總資產換算金額；數量為模型小數股。單筆賣出損益未扣費稅，策略淨值已計入往返總成本0.5855%。';
 $('#execution-study-v29').innerHTML='<details><summary><strong>FC23 原始執行規則與成本</strong></summary><p>沿用 FC23 封存原引擎的突破、跳空、停損與未成交假設；未套用 R1494-A 新版5%追價上限。淨值含往返總成本0.5855%；單筆賣出損益為原引擎費稅前損益。</p></details>';
 $('#performanceNotice').innerHTML='<strong>FC23 原引擎歷史模擬 · 往返總成本0.5855%</strong>原研究績效與參數保持不變；49檔長抱與200檔市場代理保留原站零成本計算口徑，並非同成本比較。';
 $('#performanceLegend').textContent='FC23／49檔長抱／200檔市場代理';
 $('#chartNote').textContent='FC23 原始回測2021/01/06～2026/10/27維持累積+3185.29%、最大回撤−16.85%；此後接續獨立紙上帳本，曲線更新至 '+D.dates.at(-1)+'。策略含往返成本0.5855%，對照維持原站成本口徑。';
 $('#rulesMain').innerHTML=fc23FullRulesHtml();
 $('#rulesFoot').textContent='FC23 紙上歷史帳本獨立於 R1494_A_paper。重新讀取最新資料會啟動FC23官方行情與指標更新，並顯示更新進度；資料齊全後重算本策略帳本及隔日計畫。';
 const st=D.sharedStatus;
 $('#status').innerHTML='<strong>'+(D.status.sync_status==='current'?'FC23 已更新至最新完整交易日':'FC23 更新狀態：'+D.status.sync_status)+'</strong>FC23 日線／訊號截至 '+esc(D.status.data_as_of)+' · '+tw(D.status.price_updated_at)+(D.plan.blockedReason?'<br>'+esc(D.plan.blockedReason):'<br>已重新計算 FC23 自己的持倉、風控與下一交易日計畫。')+'<br>R1494-A 共用行情截至 '+esc(st.data_as_of); 
 $('#replay').textContent='FC23 原引擎逐日重播驗證：1407日、1773筆委託、7638筆歷史計畫；累積+3185.289996%、最大回撤−16.845431%。';
 $('#risk').innerHTML=[['持股組合弱勢',D.snapshots[I].basket?'啟動':'未啟動'],['市場空頭',D.snapshots[I].bear?'啟動':'未啟動'],['20日急跌',D.snapshots[I].overlay?'啟動':'未啟動'],['配置檢查','每5交易日'],['主要調倉','每20交易日'],['單檔限制','配置目標16%／驗收上限30%']].map(([a,b])=>'<div class="risk"><b>'+a+'</b><p>'+b+'</p></div>').join('');
}

function fc23FullRulesHtml(){
return `
<h2>FC23 完整進出場規則（原始執行引擎）</h2>
<p class="sub">依目前部署的 <code>src/fc23/features.mjs</code>、<code>src/fc23/engine.mjs</code> 逐項整理，不是把 FC23 簡化成六條交易公式。所有訊號以前一個已完成交易日的行情和盤後法人資料決定。</p>
<details open><summary><b>一、233 檔的多因子選股與動態同儕</b></summary>
<p>保留 FC15／R1489_H 基礎趨勢、RS、EMA、ATR 等因子；依綜合排名選前 40 名，主要調倉候選前 30 名，最多持有 8 檔。分數還疊加近 5 日自營商買賣超比例（最多 ±0.085 分）、短期過熱扣 0.10 分、產業共振加 0.10 分、近 60 日高點及量能候選加 0.008 分，部分加分僅對排名第 9～30 名評估。</p>
<p>動態同儕：用 60 日報酬扣除全市場每日中位數，計算個股間相關係數，挑出相關最高且相關係數 &gt;0.40 的最多 6 檔；同儕中「20 日 RS &gt;7%、5 日 RS &gt;0、站上 EMA20」的股票比例，作為強勢同儕條件。</p></details>
<details><summary><b>二、雙層強勢股重新進場條件</b></summary>
<p>基礎條件：RS20 &gt;8%、RS5 &gt;1.5%、RS5－RS20/4 &gt;0.7%、站上 EMA20、股價高於 60 日高點的 87%、同儕強勢比例 ≥50%、投信近 5 日淨買賣量／成交量 ≥−2%（缺值中性）。第一層：RS5 ≤18%；第二層：RS5 ≤25%，且同儕 ≥70%、外資近 5 日買賣量／成交量 ≥0。</p>
<p>重新進場只針對已因風控離場的觀察股票；第 3～35 個交易日、分數排名前 8、價格不得低於先前離場價，且組合仍有持股席位、目標曝險 ≥70%、沒有帳戶急跌等風控阻擋，才可能下單。</p></details>
<details><summary><b>三、買進與 20 日調倉</b></summary>
<p>每 20 個交易日主要調倉；當市場風控解除或強勢股符合重新進場條件時，可以提前補倉。突破價＝前收 ×（1＋動態 buyLevel × ATR%），向上取合法股價檔位；buyLevel 隨量比、20 日強度與長黑 K 棒變動，不是每檔固定價格。</p>
<p>隔日開盤高於突破價，按開盤價模擬買進；開盤低於突破價但日內最高價達標，按突破價模擬；未觸價不買。鎖漲停或無有效 OHLC 不當成交。<b>FC23 沒有套用 R1494-A 的「開盤超過 +5% 就等回落」執行規則。</b></p>
<p>20 日調倉時，持有至少 20 日而名次跌出前 24 名可退出；新候選綜合分數領先現有持股 ≥0.25 可換股。</p></details>
<details><summary><b>四、每日出場、量能反轉與保護停損</b></summary>
<p>每日檢查趨勢失效、20 日個股跌幅超過 15%、持倉最高收盤回落超過 15%、籌碼退出訊號。持有 ≥5 日且 RS20 &lt;−20% 且跌破 EMA20，或持有 ≥15 日且 RS20 &lt;−7% 且跌破 EMA20，亦會出場。</p>
<p>量能反轉提前出場：持有 ≥15 日、RS5 &lt;−3%、成交量比 ≥1.5、過去 5 日下跌量占比 ≥65%、收黑且市場廣度 &lt;80%。市場 3 日跌幅 ≤−6%、廣度 &lt;35% 時，跌破 EMA20 且 RS5 &lt;−6% 也可能緊急退出。</p>
<p>保護停損只在「持有 ≥5 日、持倉獲利 ≥10%、量比 ≥2、RS5 &lt;−2%」時啟動，停損價＝max(最高收盤×90%，最高收盤－2.8×max(ATR%,0.5%)×前收)，向下取合法檔位。若隔日跳空跌破停損，依開盤價模擬；跌停無買盤或停牌，待賣不能視為已成交。</p></details>
<details><summary><b>五、多層市場與帳戶動態風控</b></summary>
<p>10 日市場廣度變化 &lt;−16 個百分點，目標曝險 35%；&lt;−8 個百分點，70%；否則 100%。以下因子依條件<strong>累乘</strong>，因此也可能只剩 1% 左右的目標曝險：</p>
<ul><li>持倉加權 RS10 &lt;−3.5%：乘 0.5；RS5 &gt;−0.5% 時解除。</li>
<li>市場空頭判斷：乘 0.35；市場 20 日跌幅 &gt;15%：乘 0.7。</li>
<li>帳戶 40 日淨值跌幅超過 9%：曝險設為 0；恢復到跌幅低於 7.4% 才解除。</li>
<li>市場 3 日跌幅超過 7% 且廣度 &lt;35%：乘 0.15。</li>
<li>帳戶高點回撤超過 12% 且市場低於 60 日均值、廣度 &lt;60%：乘 0.1。</li>
<li>還有原共用特徵引擎的 40 日市場跌幅與廣度 gate 係數。</li></ul>
<p>「每 5 日」是配置檢查週期之一；<strong>個股出場與急跌風控仍然逐日判斷</strong>。</p></details>
<details><summary><b>六、配置、成交與成本假設</b></summary>
<p>最多 8 檔、總曝險≤100%；主要單檔配置目標 16%，研究驗收上限 30%。新買入金額受現金、可用曝險、帳戶淨值 1/8 及單檔 16% 限額約束；既有持股補倉另需達 1.6% 淨值門檻。一般風控賣出冷卻 10 日，特定提前退出冷卻 5 日；獲利與剩餘資金繼續複利。</p>
<p>買進費用 0.14275%、賣出費稅 0.44275%，往返 0.5855% 逐筆從資金扣除。成交按日 OHLC 觸價模擬，不代表券商真的成交，也不能靠日 K 判斷所有盤中順序。</p></details>
<details><summary><b>七、版本沿革、封存績效與驗證限制</b></summary>
<p>FC23 沿用 FC15、FC17、FC20、FC22 的引擎與特徵，最後六階段研究測試 1,089 組參數，不含此前多輪研究。2021/01/06～2026/10/27 原始 FC23 歷史回測：1,407 個交易日、1,773 筆委託、7,638 筆歷史計畫，累積淨報酬 +3,185.289996%，最大收盤回撤 −16.845431%。此後資料接續 FC23 自己的紙上持倉，不混用 R1494-A 交易紀錄。</p>
<p>上列績效屬反覆調參的樣本內最佳化，非真正未碰觸的樣本外或實盤獲利保證。網站顯示的「規則」是原引擎說明，交易決策仍由原 FC23 引擎計算；未新增、刪除或改寫任何交易門檻。</p></details>
`;
}

function drawdown(curve){let peak=1,dd=0;for(const v of curve){peak=Math.max(peak,v);dd=Math.min(dd,v/peak-1)}return dd;}
