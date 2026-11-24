import {readC30StoredStatus,syncC30FinMind,c30DeviceToken,c30StatusSummary} from './data-sync.mjs?v=20261125-cache1';
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
  const r=await fetch('/api/c30/latest',{cache:'no-store',signal:AbortSignal.timeout(17000)});
  const j=await r.json();
  lastOfficial={ok:!!j.ok,as_of:j.as_of||null,twse:j.markets?.twse?.count||0,tpex:j.markets?.tpex?.count||0,errors:j.errors||[],at:new Date().toISOString()};
 }catch(e){lastOfficial={ok:false,error:String(e?.message||e),as_of:null,at:new Date().toISOString()}}
 return lastOfficial;
}
export async function loadC30MonitorSnapshot(_shared,{refresh=false}={}){
 const hist=await original();
 if(refresh||!lastOfficial)await checkOfficial();
 const token=c30DeviceToken();
 try{
  lastFinMind=await readC30StoredStatus(token);
  // Read cloud cache every visit; refresh only missing days, not historical 10 years.
  const auto=token&&Date.now()-autoLastAttemptAt>45*60000;
  if(refresh||auto){
   autoLastAttemptAt=Date.now();
   const progress=s=>{const ui=document.querySelector('#flash');if(ui)ui.textContent=s};
   lastFinMind=await syncC30FinMind(token,progress,{auto:!refresh});
  }
 }catch(e){
  lastFinMind={...(lastFinMind||{}),ok:false,sync_error:String(e.message||e),needs_token:!token,days:lastFinMind?.days||[],stored_days:lastFinMind?.stored_days||0};
 }
 return {...hist,model_version:'C30',ledger:'C30_RISK23_core_history',
  curves:{strategy:hist.snapshots.map(x=>x.nav),market:hist.benchmark},
  status:{model_version:'C30',data_as_of:hist.as_of,checkedThrough:hist.as_of,
   price_updated_at:lastOfficial?.at||null,signal_as_of:hist.as_of,sync_status:'frozen',
   trade_status:'historical_only',lastError:null,sources:[{type:'C30 原始引擎',kind:'凍結歷史'}]},
  plan:{readiness:'blocked',blockedReason:'目前只有原版 C30 2026/11/20 前的完整重播；免費行情更新不代表已產生新的正式交易訊號。'},
  official:lastOfficial,finmind:lastFinMind};
}
const reason={new_position:'核心新建倉',topup:'核心補倉',rank_exit:'核心排序退出',risk_exit:'核心風控退出',portfolio_reduce:'核心減少曝險',protective_stop:'核心保護停損',cap16:'單股配置調整',no_touch_no_buy:'未觸買入價',no_offer_no_fill:'鎖漲停、無法買入',no_bid_no_fill:'鎖跌停、無法賣出',bad_market_data:'資料未驗證',target_exposure_full:'曝險或現金已滿',replace:'選股換股'};
function htmlRows(rows){return rows.join('')}
function scale(D,s){const c=Number($('#capital')?.value)||3000000;return c/s.nav}
function held(h,f,s){const value=h.q*h.p*f,cost=h.q*h.entry*f,pnl=value-cost,profit=h.entry>0?h.p/h.entry-1:NaN;
 return {v:value,c:cost,pnl,profit,weight:h.q*h.p/s.nav}}
function historicalOrders(D,date){return D.orders.filter(o=>o.date===date)}
function finalMsg(D){return 'C30 凍結引擎已驗證至 2026/11/20；'+c30StatusSummary(D.finmind)+'；'+(D.official?.ok?'免費行情最新一致交易日 '+D.official.as_of+'（不等於完成原引擎接續）':'免費行情未完成兩市場同日核對')+'；隔日買賣指令暫不發布。'}
export function renderC30Monitor(D,I,limit=120){
 const s=D.snapshots[I],f=scale(D,s),isLast=I===D.snapshots.length-1;
 const exposure=(s.core+s.side)/s.nav;
 $('#date').value=I;
 set('#count',(s.coreCount+s.sideCount)+' / 8');set('#exposure',pct(exposure));set('#target',pct(s.target));
 const pnl=s.holdings.reduce((p,h)=>p+held(h,f,s).pnl,0);
 set('#pnl',(pnl>=0?'+':'')+money(pnl)+' 元');$('#pnl').className='value '+(pnl>=0?'positive':'negative');
 $('#status').innerHTML='<strong>C30 原版 · '+(isLast?'最後完整驗證交易日':'歷史回放')+'</strong> '+esc(s.date)+'｜原版 C30 目前不是最新即時交易訊號。<div class="sub">'+esc(finalMsg(D))+'</div>';
 set('#planState',isLast?'BLOCKED · 尚無今日正式委託':'歷史回放 · 非即時委託');
 set('#planDate','原引擎資料日 '+s.date+'；最新完整原版重播：2026-11-20');
 set('#planNote',isLast?'11/20 收盤風控已封鎖新交易。11/23 以後即使免費行情已取得，也必須先完成原版 C30 逐日引擎重播。':'這是 '+s.date+' 的原始歷史持股與成交回放；當天交易依前一交易日資訊決定。以下資料不可當作現在的委託。');
 const o=historicalOrders(D,s.date),filled=o.filter(x=>x.filled);
 $('#planActions').innerHTML=(o.length?'<p class="sub">'+esc(s.date)+' 原版歷史交易（不是下一交易日計畫）：'+filled.filter(x=>x.side==='BUY').length+' 筆核心買入、'+filled.filter(x=>x.side==='SELL').length+' 筆核心賣出。</p>':'<p class="empty">此日沒有核心部位委託。'+(s.sideCount?'反轉部位明細未包含在核心成交封存檔。':'')+'</p>')+
 (isLast?'<div class="notice"><strong>次日買賣計畫：尚未經原版 C30 引擎重算</strong>不會用最新股價事後補出買單；請先完成 11/23 起的完整狀態接續。</div>':'');
 set('#priceDate',s.date+' 收盤');
 set('#holdingNote','核心 '+s.coreCount+' 檔、反轉 '+s.sideCount+' 檔；歷史凍結模型（不代表券商實際持倉）。'+(s.sideCount?'反轉部位目前僅有已驗證合計市值，無法展示逐股買價。':''));
 $('#holdings').innerHTML=htmlRows(s.holdings.map(h=>{const p=held(h,f,s);return '<tr><td><b>'+esc(D.names?.[h.code]||h.code)+'</b> <small>'+esc(h.code)+'</small><span class="sub">首次 '+esc(h.start)+'／最近買入 '+esc(h.last)+'</span></td><td>'+money(h.entry,2)+'</td><td>'+money(h.p,2)+'</td><td class="'+(p.profit>=0?'positive':'negative')+'">'+pct(p.profit)+'</td><td>'+money(p.pnl)+'元</td><td>'+money(p.c)+'／'+money(p.v)+'元</td><td>'+pct(p.weight)+'</td></tr>';}))+
 (s.sideCount?'<tr><td><b>反轉部位合計（'+s.sideCount+' 檔）</b><span class="sub">缺逐股明細，僅列實際引擎合計市值</span></td><td>—</td><td>—</td><td>—</td><td>—</td><td>—／'+money(s.side*f)+'元</td><td>'+pct(s.side/s.nav)+'</td></tr>':'')||'<tr><td colspan="7" class="empty">原版模型此日空手，未持有任何核心或反轉部位。</td></tr>';
 $('#holdingCards').innerHTML=htmlRows(s.holdings.map(h=>{const p=held(h,f,s);return '<article class="holding"><div class="row"><b>'+esc(D.names?.[h.code]||h.code)+' <small>'+esc(h.code)+'</small></b><b class="'+(p.profit>=0?'positive':'negative')+'">'+pct(p.profit)+'</b></div><div class="facts">'+[['買入均價',money(h.entry,2)],['最新收盤',money(h.p,2)],['剩餘成本',money(p.c)+' 元'],['市值',money(p.v)+' 元'],['未實現損益',money(p.pnl)+' 元'],['權重',pct(p.weight)],['首次買入',h.start],['最近買入',h.last]].map(([a,b])=>'<div>'+a+'<b>'+esc(b)+'</b></div>').join('')+'</div><p class="sub">歷史紙上模擬，未實現損益不含未實現賣出費稅</p></article>';}))||(s.sideCount?'<p class="empty">本日無核心部位個股明細；反轉部位合計 '+money(s.side*f)+' 元（'+s.sideCount+'檔）。</p>':'<p class="empty">原版模型空手，沒有核心或反轉持倉。</p>');
 const risk=s.risk||{},flag=x=>x===true?'啟動':x===false?'未啟動':'未記錄';
 $('#risk').innerHTML=[['危機模式',flag(risk.crisis),'原引擎盤前風控'],['新單封鎖',flag(risk.block),'不可將未完成計畫當已成交'],['冷市場',flag(risk.market_cold),'反彈警戒'],['帳戶高水位防禦',flag(risk.dd_gate),'原引擎帳戶記憶'],['市場廣度',Number.isFinite(risk.breadth)?pct(risk.breadth):'—','原封存當時訊號'],['核心／反轉',s.coreCount+'／'+s.sideCount+' 檔','同帳戶最多 8 檔']].map(([a,b,c])=>'<div class="risk"><div class="row"><b>'+a+'</b><span class="pill">'+esc(b)+'</span></div><p class="sub">'+esc(c)+'</p></div>').join('');
 set('#dailyWhy',s.date+' C30 原始歷史重播｜核心委託 '+o.length+' 筆（成交 '+filled.length+' 筆）。\n'+'當日淨值倍率 '+money(s.nav,5)+'，現金倍率 '+money(s.cash,5)+'，核心曝險 '+pct(s.core/s.nav)+'，反轉曝險 '+pct(s.side/s.nav)+'。\n'+'下一交易日之正式委託：未產生。最新行情不得直接取代原引擎風控與倉位記憶。');
 renderC30Orders(D,I,limit);
}
export function renderC30Orders(D,I,limit=120){
 const date=D.dates[I],q=($('#search')?.value||'').trim(),filter=$('#fill')?.value||'';
 const arr=D.orders.filter(o=>o.date<=date&&(!q||o.code.includes(q)||String(D.names?.[o.code]||'').includes(q))&&(!filter||(filter==='filled'?o.filled:!o.filled))).reverse();
 const f=3000000; // 原始300萬本金口徑，固定模型成交金額
 $('#orderRows').innerHTML=arr.slice(0,limit).map(o=>'<tr><td>'+esc(o.date)+'<span class="sub">訊號日 '+esc(o.signal)+'</span></td><td>'+esc(D.names?.[o.code]||o.code)+' <small>'+esc(o.code)+'</small></td><td>'+(o.side==='BUY'?'買入':'賣出')+'<span class="sub">'+(o.filled?'歷史模擬成交':'歷史未成交')+'</span></td><td>'+money(o.level,2)+'</td><td>'+money(o.price,2)+'</td><td>'+money(o.notional*f)+'</td><td>'+money(o.realized,2)+'</td><td>'+esc(reason[o.reason]||o.reason)+'</td></tr>').join('')||'<tr><td colspan="8">此範圍沒有符合條件的核心委託。</td></tr>';
 set('#orderCount','C30 原版核心委託：顯示 '+Math.min(limit,arr.length)+' / '+arr.length+' 筆（反轉部位逐筆帳本未隨此檔案封存）。');
}
const dd=values=>{let peak=1,lowest=0;for(const v of values){peak=Math.max(peak,v);lowest=Math.min(lowest,v/peak-1)}return lowest};
function annualOrMonthly(D,monthly){const dates=D.dates,levels=monthly?dates.map(s=>s.slice(0,7)):dates.map(s=>s.slice(0,4));const groups=[];for(let i=0;i<levels.length;i++){const prev=groups.at(-1);if(prev?.id===levels[i])prev.end=i;else groups.push({id:levels[i],start:i,end:i})}return groups.map(g=>{const base=g.start?D.curves.strategy[g.start-1]:1,bBase=g.start?D.curves.market[g.start-1]:1;return {period:g.id,until:g.end===dates.length-1?' 至'+dates[g.end].slice(5):'',yr:g.id.slice(0,4),return:D.curves.strategy[g.end]/base-1,market:D.curves.market[g.end]/bBase-1,dd:dd([base,...D.curves.strategy.slice(g.start,g.end+1)]),marketDD:dd([bBase,...D.curves.market.slice(g.start,g.end+1)])}})}
function rowsPeriod(data){return data.map(x=>'<tr><td>'+esc(x.period+x.until)+'</td><td class="'+(x.return>=0?'positive':'negative')+'">'+pct(x.return)+'</td><td class="negative">'+pct(x.dd)+'</td><td>'+pct(x.market)+'</td><td class="negative">'+pct(x.marketDD)+'</td></tr>').join('')}
export function renderC30Performance(D){
 const nav=D.curves.strategy,market=D.curves.market,min=1,max=Math.max(...nav,...market),w=1080,h=300,left=55,right=1020,top=22,bottom=260;
 const y=v=>bottom-(v-min)/(max-min||1)*(bottom-top),x=i=>left+i/(nav.length-1)*(right-left);
 function poly(series,color){const points=series.filter((_,i)=>i===0||i===series.length-1||i%3===0).map((v,k)=>{const i=k===0?0:k*3;return x(Math.min(i,series.length-1)).toFixed(2)+','+y(v).toFixed(2)}).join(' ');return '<polyline points="'+points+'" stroke="'+color+'" stroke-width="2.5" fill="none"/>'}
 $('#chart').innerHTML='<svg viewBox="0 0 1080 300" role="img" aria-label="C30 與加權指數歷史資金曲線" style="width:100%;height:auto">'+[0,.25,.5,.75,1].map(t=>{const v=min+(max-min)*t;return '<line x1="'+left+'" y1="'+y(v)+'" x2="'+right+'" y2="'+y(v)+'" stroke="#e1e6de"/><text x="45" y="'+(y(v)+4)+'" fill="#738078" text-anchor="end" font-size="12">'+money(v,1)+'×</text>'}).join('')+poly(market,'#97a99a')+poly(nav,'#18694f')+'<text x="55" y="285" fill="#738078" font-size="12">2021/01/06</text><text x="1020" y="285" fill="#738078" text-anchor="end" font-size="12">2026/11/20</text></svg>';
 const monthly=annualOrMonthly(D,true),wins=monthly.filter(x=>x.return>x.market).length;
 set('#strategySummary','C30 累積 '+pct(nav.at(-1)-1)+' · 最大回撤 '+pct(dd([1,...nav]))+' · 勝大盤 '+wins+'/'+monthly.length+' 月');
 set('#performanceLegend','C30 原版（深綠）／加權指數（灰綠）｜相同日期同一起點');
 set('#chartNote','完整原版研究區間：2021/01/06～2026/11/20，初始300萬元，成本往返0.5855%。已重建 1,425 日日淨值；2026/11/23 起尚未原引擎重播。');
 $('#annual').innerHTML=rowsPeriod(annualOrMonthly(D,false));
}
export function renderC30Monthly(D){const yr=$('#monthYear')?.value;$('#monthly').innerHTML=rowsPeriod(annualOrMonthly(D,true).filter(x=>x.yr===yr))}
export function decorateC30Monitor(D){
 $('#finmind-device-panel').style.display='none';
 set('#heroDescription','C30 RISK23 原版 · 233 檔股期現股研究池 · 核心與反轉雙模組 · 最多 8 檔 · 0.5855% 往返成本');
 set('#ledgerLabel','C30 原版 · 凍結歷史紙上持倉（非目前實盤）');
 set('#ordersNote','原版核心 2,082 筆委託，含 163 筆未成交；表列金額依原始300萬元本金計，realized 欄保留原始值不擅自改單位；反轉部位只有每日總市值。');
 $('#execution-study-v29').innerHTML='<details><summary><b>C30 原版執行條件與歷史限制</b></summary><p>本頁保留 2026/11/20 前 RISK23 的真實歷史結果；買進／賣出依原引擎 OHLC 觸價、盤前凍結條件、核心／反轉持股配置與風控記憶。未將 A56 的反彈三路徑或 R1494-A 的固定5%買點加入 C30。</p><p>原始核心交易、逐日部位與加權指數已對帳；反轉個股逐筆明細缺於本次封存，無法補造。</p></details>';
 $('#performanceNotice').innerHTML='<strong>C30 原版凍結回測｜現股模擬｜往返成本0.5855%</strong>僅驗證截至2026/11/20的歷史策略，尚未上線每日原引擎重播。這不是現在的買賣指令，也不是券商實際績效。';
 $('#orderRows').closest('table').querySelector('thead').innerHTML='<tr><th>日期／訊號日</th><th>股票</th><th>動作／歷史狀態</th><th>核心觸發價</th><th>原始成交價</th><th>300萬原始模型金額</th><th>原始 realized</th><th>原因</th></tr>';
 $('#annual').closest('table').querySelector('thead').innerHTML='<tr><th>年度</th><th>C30 累積報酬</th><th>最大回撤</th><th>加權指數</th><th>最大回撤</th></tr>';
 $('#monthly').closest('table').querySelector('thead').innerHTML='<tr><th>月份</th><th>C30 報酬</th><th>最大回撤</th><th>加權指數</th><th>最大回撤</th></tr>';
 document.querySelectorAll('[data-strategy-title]').forEach(x=>x.textContent='C30 報酬');
 $('#rulesMain').innerHTML='<h2>C30 原版｜固定規則與封存資料</h2><ol><li><strong>原版凍結：</strong>buffer250_partial_2019，2021/01/06～2026/11/20，1,425 個交易日，累積淨報酬 +2,328.07%、最大回撤 −18.50%、勝大盤 46/71 月。</li><li>交易池採原研究的 233 檔股期現股，當年航運／金融仍包含於原研究，不能將排除產業的實驗版當正式原版。</li><li>初始300萬元、小數股複利模擬，最多8檔、單檔上限30%；原本的核心與反轉部位、動態選股排序、帳戶高水位、危機風控及現金銜接規則皆不變。</li><li>核心日線成交依原引擎觸價與開盤執行假設，買入費0.14275%、賣出費稅0.44275%（往返0.5855%）；實際下單不保證成交。</li><li>原版最後交易日2026/11/20；最新免費日K或分K僅代表行情更新，尚須完成原Python引擎的逐日狀態接續才能發布隔日委託。</li></ol><p><a href="/c30/minute/">免費233檔分K下載</a>　·　<a href="/c30/archive/">C30 雲端永久封存</a>　·　<a href="/c30/">獨立來源／診斷</a></p>';
 $('#dataFacts').innerHTML=[['策略','C30 RISK23 原版'],['版本',D.lock_id],['最後原引擎日',D.as_of],['已核對日數',D.dates.length],['已核對核心委託',D.orders.length],['FinMind 雲端已儲存日數',D.finmind?.stored_days||0],['FinMind 日K最新資料日',D.finmind?.latest_price_date||'尚無'],['FinMind 四類資料完整日數',D.finmind?.complete_days||0],['FinMind 最近更新',D.finmind?.updated_at||'尚未保存'],['雲端更新錯誤',D.finmind?.sync_error||((D.finmind?.errors||[]).length?'有 '+D.finmind.errors.length+' 項缺漏／權限錯誤':'無')],['雲端最新免費日K',D.official?.ok?D.official.as_of:'未完整核對'],['每日委託狀態','原引擎待增量重播'],['券商成交','未串接／未確認']].map(([a,b])=>'<div>'+esc(a)+'<b>'+esc(b)+'</b></div>').join('');
 set('#replay','C30 原始封存 SHA-256：'+HASH+'；每日持股價值與原始流水帳對帳誤差小於 0.000001 淨值單位。反轉個股明細及2026/11/23以後重播仍待補。');
 set('#rulesFoot','C30 FinMind Token 的日K、三大法人、融資融券、借券資料按日期保存在 Cloudflare 私人資料庫；同一 Token 日後直接沿用成功資料，不需重抓。'+(D.finmind?.sync_error?' 最近失敗：'+D.finmind.sync_error:'')+' 原版買賣仍須原 Python 引擎重播。');
 set('#strategyFooter','C30 RISK23 原版｜2021/01/06～2026/11/20｜原始凍結績效 +2328.07%／−18.50%｜未發布今日買賣');
}
export function exportC30Orders(D,I){
 const maxDate=D.dates[I],q=($('#search')?.value||'').trim(),f=$('#fill')?.value||'';
 const rows=D.orders.filter(o=>o.date<=maxDate&&(!q||o.code.includes(q))&&(!f||(f==='filled'?o.filled:!o.filled))).reverse();
 const csv=[['成交日','訊號日','股票','買賣','狀態','委託觸發價','模擬成交價','模型股數','模型金額倍率','已實現損益','理由'],...rows.map(x=>[x.date,x.signal,x.code,x.side,x.filled?'成交':'未成交',x.level,x.price,x.quantity,x.notional,x.realized,x.reason])].map(row=>row.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='C30_RISK23_original_core_orders_'+maxDate+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}