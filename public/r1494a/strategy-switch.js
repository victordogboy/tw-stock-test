/* Shared dashboard adapter. FC23 data comes only from the verified original engine. */
async function fetchGzipJson(path,base64=false){
 const response=await fetch(path,{cache:'no-store'});
 if(!response.ok)throw Error(path+' HTTP '+response.status);
 const stream=base64?new Blob([Uint8Array.from(atob((await response.text()).trim()),c=>c.charCodeAt(0))]).stream():response.body;
 return new Response(stream.pipeThrough(new DecompressionStream('gzip'))).json();
}
async function loadFc23Snapshot(shared){
 const d=await fetchGzipJson('./fc23/integrated-snapshot.b64',true);
 if(d.model_version!=='FC23'||d.snapshots.length!==1407||d.orders.length!==1773||Math.abs(d.snapshots.at(-1).nav-32.8528999624682)>1e-8)throw Error('FC23 原引擎驗證未通過');
 // Benchmarks share the original published data and align by date, never by array offset.
 const idx=new Map(shared.dates.map((date,i)=>[date,i]));
 for(const key of ['old49','market'])d.curves[key]=d.dates.map(date=>shared.curves[key][idx.get(date)]);
 d.sharedStatus=shared.status;
 return d;
}
function fc23Why(d,i){
 const s=d.snapshots[i],orders=d.orders.filter(o=>o.date===s.date),p=d.planHistory[s.date];
 return [s.date+' FC23 原引擎歷史執行，訊號截至 '+s.signal,
 '20交易日調倉；每5交易日檢查風控與配置；符合強勢同儕條件者可於離場後第3～35交易日重新進場。',
 ...orders.map(o=>o.code+' '+(o.side==='BUY'?'買入':'賣出')+'｜'+(reasons[o.reason]||o.reason)+(o.level!=null?'，觸發價 '+num(o.level,2):'')+(o.filled?'，成交價 '+num(o.price,2):'，未成交')),
 '當日目標曝險 '+pct(s.target)+'；實際曝險 '+pct(s.exposure)+'；持有 '+s.holdings.length+' 檔。',
 p?p.trade_date+' 歷史計畫：買入 '+p.actions.filter(a=>a.side==='BUY').length+'、賣出 '+p.actions.filter(a=>a.side==='SELL').length+'、續抱 '+p.actions.filter(a=>a.side==='HOLD').length+' 檔。':d.plan.blockedReason].join('\n');
}
function renderFc23Plan(){
 const p=I===D.snapshots.length-1?D.plan:D.planHistory[D.snapshots[I].date];
 $('#planState').textContent=p?.trade_date?'FC23 原引擎歷史計畫':'FC23 資料待補';
 $('#planDate').textContent=p?.trade_date?'歷史訊號 '+p.signal_as_of+' → '+p.trade_date:'訊號計算資料截至 '+D.status.data_as_of;
 $('#planNote').textContent=p?.trade_date?'依原引擎已完成資料重播；此處不展示隔日實際高低價。FC23 沿用原始成交規則，回測已計入往返總成本0.5855%。':D.plan.blockedReason;
 $('#planActions').innerHTML=(p?.actions||[]).map(a=>'<article class="action"><div class="row"><b>'+esc(name(a.code))+' '+esc(a.code)+'</b><span class="pill">'+({BUY:'突破買入',SELL:'開盤賣出',HOLD:'持續持有'}[a.side])+' · 歷史計畫</span></div><div class="price">'+(a.side==='BUY'?num(a.level,2):a.side==='SELL'?'次日現股開盤價':'續抱')+'</div><p>前收 '+num(a.referencePrice,2)+(Number.isFinite(a.stop)?' · 保護停損 '+num(a.stop,2):'')+'</p><p>'+esc(reasons[a.reason]||a.reason)+'</p><p class="sub">'+esc(({NO_FILL_NO_BUY:'未觸價不買',CONTINUE_HOLDING:'持續持有並檢查風控',OPEN_UNCONDITIONAL:'次日開盤模擬賣出'}[a.noFillPolicy])||a.noFillPolicy)+'</p></article>').join('');
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
 $('#ledgerLabel').textContent='模型歷史持倉 · FC23_paper';
 $('#heroDescription').textContent='233檔研究池 · 最多8檔 · 20交易日調倉 · 5交易日風控 · 強勢同儕重新進場';
 $('#strategyFooter').textContent='FC23 · 原引擎歷史模擬 · 往返成本0.5855%';
 $('#ordersNote').textContent='依所選日期的試算總資產換算金額；數量為模型小數股。單筆賣出損益未扣費稅，策略淨值已計入往返總成本0.5855%。';
 $('#execution-study-v29').innerHTML='<details><summary><strong>FC23 原始執行規則與成本</strong></summary><p>沿用 FC23 封存原引擎的突破、跳空、停損與未成交假設；未套用 R1494-A 新版5%追價上限。淨值含往返總成本0.5855%；單筆賣出損益為原引擎費稅前損益。</p></details>';
 $('#performanceNotice').innerHTML='<strong>FC23 原引擎歷史模擬 · 往返總成本0.5855%</strong>原研究績效與參數保持不變；49檔長抱與200檔市場代理保留原站零成本計算口徑，並非同成本比較。';
 $('#performanceLegend').textContent='FC23／49檔長抱／200檔市場代理';
 $('#chartNote').textContent='FC23 每日淨值、年度與月份績效均由原引擎計算，截止 '+D.dates.at(-1)+'；累積+3185.29%、最大回撤−16.85%。策略含往返成本0.5855%，對照維持原站成本口徑。';
 $('#rulesMain').innerHTML='<h2>FC23 鎖定規則</h2><ol><li>沿用233檔研究池、最多8檔、總曝險不超過100%，每20交易日調倉、每5交易日檢查風控與配置。</li><li>RS20 &gt; 8%、RS5 &gt; 1.5%、RS5−RS20/4 &gt; 0.7%、距60日高點 &gt; 87%、動態同儕強勢比例 ≥ 50%。</li><li>投信5日條件T5 ≥ −2%（缺值中性）；RS5 ≤18%，或RS5 ≤25%且同儕 ≥70%、外資F5 ≥0。</li><li>風控出場第3～35交易日、排名前8、價格恢復至原出場價、目標曝險 ≥70%且帳戶風控允許，才可重新進場。</li><li>原始配置目標單檔16%；30%為研究驗收上限。買賣、減碼、停損、跳空與漲跌停全部保留原引擎。</li><li>往返總成本0.5855%，封存期間2021/01/06～2026/10/27；固定20日調倉相位敏感，歷史結果不代表未來報酬。</li></ol>';
 $('#rulesFoot').textContent='FC23 紙上歷史帳本獨立於 R1494_A_paper。共用行情更新不代表 FC23 指標或新交易計畫已更新。';
 const st=D.sharedStatus;
 $('#status').innerHTML='<strong>FC23 歷史資料截至 '+D.status.data_as_of+'</strong>'+esc(D.plan.blockedReason)+'<br>共用 R1494-A 行情截至 '+esc(st.data_as_of)+'；FC23 尚無此期間之後的已驗證計畫。';
 $('#replay').textContent='FC23 原引擎逐日重播驗證：1407日、1773筆委託、7638筆歷史計畫；累積+3185.289996%、最大回撤−16.845431%。';
 $('#risk').innerHTML=[['持股組合弱勢',D.snapshots[I].basket?'啟動':'未啟動'],['市場空頭',D.snapshots[I].bear?'啟動':'未啟動'],['20日急跌',D.snapshots[I].overlay?'啟動':'未啟動'],['配置檢查','每5交易日'],['主要調倉','每20交易日'],['單檔限制','配置目標16%／驗收上限30%']].map(([a,b])=>'<div class="risk"><b>'+a+'</b><p>'+b+'</p></div>').join('');
}
function drawdown(curve){let peak=1,dd=0;for(const v of curve){peak=Math.max(peak,v);dd=Math.min(dd,v/peak-1)}return dd;}
