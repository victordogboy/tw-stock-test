(function(root){
 'use strict';
 const C=root.TWStockBacktest,el=document.getElementById('stockBacktest');if(!el)return;
 const $=id=>document.getElementById('bt'+id),copy=x=>JSON.parse(JSON.stringify(x));
 const labels={setup:'Setup 結構',opportunity:'Opportunity 機會',entry:'Entry 進場',hold:'Hold 續抱'};
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const n=(v,d=2)=>v===Infinity?'∞':Number.isFinite(v)?v.toLocaleString('zh-TW',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
 const pct=v=>Number.isFinite(v)?n(v)+'%':'—';
 const delta=(day,days)=>new Date(Date.parse(day+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
 const todayTW=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 let stockKey='',worker=null,busy=false,loaded=null,report=null,runParams=null,controller=null,runId=0;
 const pieces=new Map();
 el.innerHTML=`<h2>個股 Action 門檻回測 <span class="pill">R32</span></h2>
  <p class="note" id="btStock">先完成上方個股分析</p>
  <div class="bt-weight-grid">${['buy','stay'].map(group=>`<fieldset><legend>${group==='buy'?'進場 Action 係數':'續抱 Action 係數（出場判斷）'}</legend><div class="bt-four">${C.keys.map(k=>`<label>${labels[k]} %<input id="bt${group}_${k}" type="number" min="0" max="100" step="1" value="${C.defaults[group][k]}"></label>`).join('')}</div></fieldset>`).join('')}</div>
  <div class="bt-fields">
    <label>進場分數 ≥<input id="btEnter" type="number" min="0" max="100" value="60"></label>
    <label>續抱分數 ≤ 離場<input id="btExit" type="number" min="0" max="100" value="45"></label>
    <label>每筆本金／起始資金（元）<input id="btCapital" type="number" min="1" step="10000" value="1000000"></label>
    <label>來回總成本（基點）<input id="btCost" type="number" min="0" max="1000" step="1" value="0"></label>
  </div>
  <p class="tiny">判斷 Action 本身的0～100分，不是分數日變化。兩組係數各合計100%。收盤訊號 → 下一交易日開盤成交；單一多單、不加碼。每次投入上限為原始本金，虧損後以剩餘資金投入；1基點＝0.01%，成本在買賣兩側各計一半。</p>
  <div class="bt-fields">
    <label>回測開始<input id="btStart" type="date"></label><label>回測結束<input id="btEnd" type="date"></label>
    <label>最佳化目標<select id="btGoal"><option value="balanced">報酬／回撤比</option><option value="roi">總報酬率最高</option><option value="winRate">勝率最高</option></select></label>
    <label>搜尋期最低交易筆數<input id="btMinTrades" type="number" min="1" max="100" value="5"></label>
  </div>
  <div class="toolbar"><button id="btRun" type="button">依設定回測</button><button id="btOptimize" type="button">一鍵找最佳參數</button><button id="btCancel" type="button" class="secondary" disabled>停止</button><button id="btImport" type="button" class="secondary">帶入上方 Action 係數</button></div>
  <p class="tiny" id="btSaved">回測設定依個股儲存在此瀏覽器。</p>
  <details><summary>載入較長歷史（1～5年）</summary><div class="toolbar" style="margin-top:10px"><label>期間 <select id="btYears"><option value="1">1年</option><option value="3">3年</option><option value="5" selected>5年</option></select></label><button id="btLoad" type="button" class="secondary">載入歷史行情與籌碼</button></div><p class="tiny">預設使用個股頁已載入資料；此按鈕優先讀快取，缺少的籌碼會使用 FinMind 查詢額度。歷史載入一次後，反覆回測／最佳化均在本機計算。結束日為昨日，另取180日暖機資料。</p></details>
  <p id="btStatus" role="status" aria-live="polite" class="note">等待個股資料</p><progress id="btProgress" max="1" value="0" style="width:100%;display:none"></progress>
  <div id="btResults"></div>`;
 function context(){return root.TWStockBacktestContext?.()}
 function storageKey(){return 'twq_stock_backtest_r32:'+stockKey}
 function params(){return C.validate({buy:Object.fromEntries(C.keys.map(k=>[k,readNumber('buy_'+k)])),stay:Object.fromEntries(C.keys.map(k=>[k,readNumber('stay_'+k)])),enter:readNumber('Enter'),exit:readNumber('Exit'),capital:readNumber('Capital'),costBps:readNumber('Cost'),minTrades:readNumber('MinTrades'),goal:$('Goal').value})}
 function readNumber(id){return $(id).value.trim()===''?NaN:Number($(id).value)}
 function fill(p){for(const group of ['buy','stay'])for(const k of C.keys)$(group+'_'+k).value=p[group][k];for(const [id,k] of [['Enter','enter'],['Exit','exit'],['Capital','capital'],['Cost','costBps'],['MinTrades','minTrades'],['Goal','goal']])$(id).value=p[k];}
 function save(){
  if(!stockKey)return;
  try{const p=params();localStorage.setItem(storageKey(),JSON.stringify(p));$('Saved').textContent='已儲存 '+stockKey+' 的回測設定；兩組權重各100%。';}
  catch(e){$('Saved').textContent=e.name==='QuotaExceededError'?'瀏覽器空間不足；設定本次仍有效，但無法保存。':e.message;}
 }
 function clearResults(){report=null;$('Results').replaceChildren();}
 function setBusy(value){busy=value;el.querySelectorAll('input,select,button').forEach(n=>n.disabled=value);$('Cancel').disabled=!value;$('Progress').style.display=value?'block':'none';}
 function stop(message='已停止；設定與已下載資料保留。'){
  runId++;worker?.terminate();worker=null;controller?.abort();controller=null;setBusy(false);$('Status').textContent=message;
 }
 function attach(){
  const c=context();if(!c?.stock?.stock_id)return;
  stop('個股資料已更新，可開始回測。');loaded=null;clearResults();
  const key=c.stock.type+':'+c.stock.stock_id,changed=key!==stockKey;stockKey=key;
  if(changed){let p=copy(C.defaults);try{const stored=JSON.parse(localStorage.getItem(storageKey()));if(stored)p=C.validate(stored);}catch{}fill(p);}
  const prices=c.prices.filter(r=>!r.intradayProjected&&r.date<=completedEnd());
  $('Start').value=prices[Math.min(64,prices.length-1)]?.date||'';$('End').value=prices.at(-1)?.date||'';
  $('Stock').textContent=c.stock.stock_id+' '+c.stock.stock_name+'｜回測專用係數，依股票保存';
  $('Saved').textContent='回測設定依個股儲存；上方分析與掃描器的權重可用按鈕帶入。';
 }
 function completedEnd(){const d=new Date(Date.now()+8*3600000);return d.getUTCHours()*60+d.getUTCMinutes()<810?delta(todayTW(),-1):todayTW()}
 function dataset(){
  const c=context();if(!c?.stock?.stock_id||!c.prices.length||!c.ready)throw Error('請先完成上方個股分析');
  if(c.stock.type+':'+c.stock.stock_id!==stockKey)throw Error('股票已切換，請等分析完成再回測');
  const start=$('Start').value,end=$('End').value;
  if(!start||!end||start>=end)throw Error('請設定有效的開始與結束日期');
  if(end>completedEnd())throw Error('回測結束日不能包含尚未收盤的交易日');
  const source=loaded||{prices:c.prices,chips:c.chips};
  const prices=source.prices.filter(r=>r.date<=end&&!r.intradayProjected);
  if(prices.length<65)throw Error('K線不足65日；請載入歷史資料');
  return {prices,chips:source.chips,start,end};
 }
 function run(mode){
  if(busy)return;
  try{
    const p=params(),data=dataset();save();clearResults();runParams=copy(p);setBusy(true);$('Progress').value=0;
    $('Status').textContent='計算歷史四項分數；相同資料後續會沿用計算結果…';
    if(!worker){
      worker=new Worker('/stock-backtest-worker.js?r32');
      worker.onerror=e=>{stop('計算失敗：'+(e.message||'背景計算無法載入'));};
      worker.onmessage=({data:m})=>{
        if(m.type==='progress'){$('Progress').value=m.done/m.total;$('Status').textContent=(m.phase==='score'?'重播歷史分數 ':'搜尋參數 ')+m.done.toLocaleString()+' / '+m.total.toLocaleString();}
        if(m.type==='error'){setBusy(false);$('Status').textContent=m.message;}
        if(m.type==='result'){setBusy(false);report=m;renderReport();}
      };
    }
    worker.postMessage({mode,params:p,data});
  }catch(e){setBusy(false);$('Status').textContent=e.message;}
 }
 function metrics(m){return `<div class="kpis">${[['總報酬率',pct(m.roi)],['勝率',pct(m.winRate)],['最大回撤',pct(m.maxDrawdown)],['交易筆數',m.trades],['平均每筆報酬',pct(m.avgReturn)],['獲利因子',n(m.profitFactor)],['年化報酬（滿一年）',pct(m.cagr)],['報酬／回撤比',n(m.returnDrawdown)]].map(([k,v])=>`<div class="mini"><span class="label">${k}</span><strong>${v}</strong></div>`).join('')}</div>`}
 function weights(p){return '進場 '+C.keys.map(k=>p.buy[k]).join('/')+'；續抱 '+C.keys.map(k=>p.stay[k]).join('/')+'（Setup／Opportunity／Entry／Hold）｜進場≥'+p.enter+'；離場≤'+p.exit}
 function equityChart(m){
  if(m.curve.length<2)return '';
  const vals=[runParams.capital,...m.curve.map(x=>x.equity)],min=Math.min(...vals),max=Math.max(...vals),span=max-min||1;
  const pts=m.curve.map((r,i)=>(35+i/(m.curve.length-1)*850).toFixed(1)+','+(170-(r.equity-min)/span*145).toFixed(1)).join(' ');
  return `<svg viewBox="0 0 920 200" role="img" aria-label="每日收盤帳戶權益曲線，包含持股浮動損益" style="width:100%;background:#091322;border-radius:10px"><text x="35" y="17" fill="#92a2bf" font-size="12">權益 ${n(min,0)} ～ ${n(max,0)}元</text><polyline points="${pts}" fill="none" stroke="${m.roi>=0?'#ff8585':'#65d99a'}" stroke-width="2"/><text x="35" y="190" fill="#92a2bf" font-size="12">${esc(m.start)}</text><text x="815" y="190" fill="#92a2bf" font-size="12">${esc(m.end)}</text></svg>`;
 }
 function renderReport(){
  const r=report.result,c=report.coverage,m=r.full;
  $('Status').textContent=(r.done?'搜尋完成 '+r.done.toLocaleString()+' 組，'+r.eligible.toLocaleString()+' 組符合最低交易筆數。':'回測完成。')+'有效評分 '+c.scored+' 日；資料缺漏 '+c.missing+' 日。';
  let html=`<h3>${r.done?'搜尋最佳組合｜全期間重跑':'自訂參數｜全期間'}</h3><p class="note">${esc(m.start)} ～ ${esc(m.end)}｜實際可用期間；請對照設定日期。<br>${esc(weights(r.best))}</p>${metrics(m)}${equityChart(m)}`;
  if(r.done){
    html+=`<h3>時間切分驗證</h3><div class="bt-scroll"><table><thead><tr><th>區段</th><th>日期</th><th>報酬率</th><th>最大回撤</th><th>勝率</th><th>筆數</th></tr></thead><tbody>${[['前70%：搜尋參數',r.train],['後30%：未參與搜尋',r.test]].map(([name,x])=>`<tr><td>${name}</td><td>${x.start} ～ ${x.end}</td><td>${pct(x.roi)}</td><td>${pct(x.maxDrawdown)}</td><td>${pct(x.winRate)}</td><td>${x.trades}</td></tr>`).join('')}</tbody></table></div>
    <p class="note">搜尋範圍：兩組係數以25%為間隔（另含目前係數），進場門檻40～80、離場20～60，各間隔5分，另含目前門檻。${r.best.goal==='balanced'?'排序使用報酬率÷max(最大回撤,1%)。':''}「最佳」只代表本次有限搜尋結果；後30%僅驗證，未用來挑選。兩段各自空手開始、期末結清，結果不可直接相加。${r.test.trades<5?'後段少於5筆交易，樣本偏少。':''}</p>
    <button id="btApply" type="button">套用並保存最佳參數</button><details style="margin-top:12px"><summary>搜尋期前10名</summary><div class="bt-scroll"><table><thead><tr><th>組合</th><th>報酬率</th><th>回撤</th><th>勝率</th><th>筆數</th></tr></thead><tbody>${r.top.map(x=>`<tr><td>${esc(weights(x.params))}</td><td>${pct(x.result.roi)}</td><td>${pct(x.result.maxDrawdown)}</td><td>${pct(x.result.winRate)}</td><td>${x.result.trades}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  html+=`<p class="tiny">買進持有價格報酬 ${pct(m.benchmark)}（未計成本／股息）；持股天數占比 ${pct(m.exposure)}。期末估值結清 ${m.forced} 筆，已包含於勝率與報酬；不表示可保證成交。跳過／延後不可成交日 ${m.unfilled} 次。最大回撤採每日收盤權益，包含浮虧，不代表盤中最大跌幅。</p>
  <p class="tiny">使用歷史收盤量與當日盤後籌碼。要求連續20個交易日三類籌碼完整才評分；缺漏日仍計算持股市值，但不產生新分數訊號。單一價位或零量日不假設能在開盤成交。原始股價未調整除權息／分割，也未加回股息；歷史籌碼修訂與公告時間差未建模。搜尋結果不保證未來績效。</p>
  <details><summary>逐筆交易明細（${m.trades}筆）</summary><div class="bt-scroll"><table><thead><tr><th>進場訊號</th><th>買進日／價</th><th>離場訊號</th><th>賣出日／價</th><th>持有日</th><th>損益</th><th>報酬</th><th>原因</th></tr></thead><tbody>${m.tradeLog.map(t=>`<tr><td>${t.signalDate}</td><td>${t.entryDate} / ${n(t.entry)}</td><td>${t.exitSignalDate||'—'}</td><td>${t.exitDate} / ${n(t.exit)}</td><td>${t.days}</td><td>${n(t.profit,0)}</td><td>${pct(t.returnPct)}</td><td>${esc(t.reason)}</td></tr>`).join('')||'<tr><td colspan="8">此條件沒有交易</td></tr>'}</tbody></table></div></details>`;
  $('Results').innerHTML=html;
  if($('Apply'))$('Apply').onclick=()=>{fill(r.best);save();$('Status').textContent='已套用並保存 '+stockKey+' 的最佳參數，可依設定再次回測。';};
 }
 async function cachedPiece(path,query,signal){
  const url=path+'?'+new URLSearchParams(query),headers=root.TWFinMindTokens?.headers?.()||{};
  if(pieces.has(url))return pieces.get(url);
  let res=await fetch(url,{headers,signal}),j=await res.json();
  if(res.status===404){res=await fetch(url,{method:'POST',headers,signal});j=await res.json();}
  if(!res.ok||!j.ok)throw Error(j.error||'歷史資料載入失敗');
  pieces.set(url,j);return j;
 }
 async function loadHistory(){
  if(busy)return;
  const c=context();if(!c?.stock?.stock_id){$('Status').textContent='請先完成上方個股分析';return;}
  const generation=++runId;controller=new AbortController();const signal=controller.signal;
  try{
    setBusy(true);$('Progress').value=0;clearResults();
    const end=delta(todayTW(),-1),years=Number($('Years').value),start=delta(end,-Math.round(years*365.25));
    const query={code:c.stock.stock_id,market:c.stock.type,start_date:delta(start,-180),end_date:end};
    if(!['twse','tpex'].includes(query.market))throw Error('無法辨識上市／上櫃市場；請從掃描器開啟此股票');
    $('Status').textContent='載入歷史K線…';
    const h=await cachedPiece('/api/research/stock-history',{...query,source:'auto'},signal),chips={};
    for(const [i,kind] of ['margin','inst','daytrade'].entries()){
      if(generation!==runId)return;
      $('Status').textContent='載入'+({margin:'融資',inst:'法人',daytrade:'當沖'}[kind])+'歷史；已完成資料會保留…';$('Progress').value=(i+1)/4;
      const j=await cachedPiece('/api/research/chip-piece',{...query,kind},signal);chips[kind]=j.data||[];
    }
    if(generation!==runId)return;
    loaded={prices:h.data,chips};$('Start').value=start;$('End').value=end;
    $('Status').textContent='歷史已載入：K線 '+h.data.length+' 日；融資 '+chips.margin.length+' 日、法人 '+chips.inst.length+' 日、當沖 '+chips.daytrade.length+' 日。可開始回測或最佳化。';
  }catch(e){if(generation===runId)$('Status').textContent=e.name==='AbortError'?'歷史下載已停止':e.message;}
  finally{if(generation===runId){controller=null;setBusy(false);}}
 }
 el.querySelectorAll('input,select').forEach(n=>n.addEventListener('change',()=>{save();clearResults();}));
 $('Run').onclick=()=>run('manual');$('Optimize').onclick=()=>run('optimize');$('Cancel').onclick=()=>stop();$('Load').onclick=loadHistory;
 $('Import').onclick=()=>{const w=context()?.weights;if(!w){$('Status').textContent='上方係數無效，請先調整合計100%';return;}for(const group of ['buy','stay'])for(const k of C.keys)$(group+'_'+k).value=w[group][k];save();clearResults();};
 root.TWStockBacktestRefresh=attach;attach();
})(globalThis);
