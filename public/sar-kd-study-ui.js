(function(root){
'use strict';
const el=document.getElementById('sarKdStudy');if(!el)return;
const by=id=>document.getElementById(id);
const n=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('zh-TW',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const pct=v=>Number.isFinite(v)?n(v)+'%':'—';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let worker=null,busy=false,stockKey='',generation=0;
el.innerHTML=`<h2>SAR × KD × Action 歷史回測 <span class="pill">R36</span></h2>
 <p class="note" id="skStock">先完成個股分析，再使用上方 Action 回測係數與歷史資料。</p>
 <div class="bt-fields">
 <label>SAR 初翻多天數上限<input id="skEarly" type="number" min="1" max="20" step="1" value="3"></label>
 <label>KD 9,3,3 條件<select id="skKd"><option value="both">K＞D 且 (K-D) 擴大</option><option value="above">僅 K＞D</option><option value="widen">僅 (K-D) 擴大</option></select></label>
 </div>
 <p class="tiny">進場 Action 係數、門檻、進場模式、續抱離場及成本，沿用上方「個股 Action 門檻回測」欄位；SAR 初始加速、增加量及最大值，沿用 K 線圖設定（即使關閉圖上的 SAR 點，仍可回測）。KD 固定 9,3,3。依上方載入的 1～5 年歷史執行。</p>
 <div class="toolbar"><button id="skRun" type="button">回測 SAR／KD 條件</button><button id="skCancel" type="button" class="secondary" disabled>停止回測</button></div>
 <p class="note" id="skStatus" role="status">等待個股資料。</p>
 <div id="skResults"></div>`;
function busySet(flag){
  busy=flag;by('skRun').disabled=flag;by('skCancel').disabled=!flag;
}
function stop(message='已停止。'){
  generation++;worker?.terminate();worker=null;busySet(false);by('skStatus').textContent=message;
}
function refresh(){
  const c=root.TWStockBacktestContext?.();
  const key=c?.stock?.stock_id?(c.stock.type+':'+c.stock.stock_id):'';
  if(key!==stockKey){
    if(busy)stop('已切換個股，停止舊回測。');
    stockKey=key;by('skResults').replaceChildren();
    by('skStock').textContent=key?'目前：'+c.stock.stock_id+' '+c.stock.stock_name+'；上方 Action 參數與 K 線 SAR 參數會同步套用。':'先完成個股分析。';
  }
}
function render(res,coverage){
  const metrics=res.summaries;
  const title=s=>escape(s);
  by('skStatus').textContent='已回測 '+res.rows+' 個交易日（'+res.start+' ～ '+res.end+'）；歷史評分完整 '+coverage.scored+' 日，缺漏 '+coverage.missing+' 日。';
  const pl=metrics.map(g=>`<tr><td>${title(g.name)}</td><td>${g.qualifyingSignals}</td><td>${pct(g.portfolio.roi)}</td><td>${pct(g.portfolio.winRate)}</td><td>${pct(g.portfolio.maxDrawdown)}</td><td>${g.portfolio.trades}</td></tr>`).join('');
  const forward=metrics.map(g=>`<tr><td>${title(g.name)}</td>${[3,5,10].map(h=>{const v=g.forward[h];return `<td>${v.count}筆／${pct(v.avgReturn)}／${pct(v.winRate)}</td>`}).join('')}</tr>`).join('');
  by('skResults').innerHTML=`
    <p class="note">訊號：${title(res.entryMode)} ≥ ${n(res.enter,0)}；續抱離場 ≤ ${n(res.exit,0)}；SAR（初始 ${res.sarParams.start}、增加 ${res.sarParams.step}、最大 ${res.sarParams.max}）；KD 條件：${title(({above:'K＞D',widen:'K-D 擴大',both:'K＞D 且 K-D 擴大'})[res.settings.kdMode])}。</p>
    <h3>一、沿用原始續抱離場的完整策略回測</h3>
    <div class="bt-scroll"><table><thead><tr><th>進場篩選條件</th><th>符合訊號數</th><th>策略 ROI</th><th>正式離場勝率</th><th>最大回撤</th><th>正式離場筆數</th></tr></thead><tbody>${pl}</tbody></table></div>
    <h3>二、SAR 持續天數與後續漲幅</h3>
    <p class="tiny">每格依序：樣本數／平均報酬率／勝率；分別在隔日開盤買入，第 3、5、10 個交易日收盤賣出。同一分類與持有期的事件不重疊；三個持有期的樣本數可能不同。</p>
    <div class="bt-scroll"><table><thead><tr><th>收盤當日訊號條件</th><th>3 日</th><th>5 日</th><th>10 日</th></tr></thead><tbody>${forward}</tbody></table></div>
    <p class="tiny">${title(res.notes)} 策略 ROI／最大回撤屬於「Action 進場、續抱出場」的完整交易測試，不能與固定天數的事件報酬混為一談。多數訊號可能重複出現在同一趨勢，不同分類的事件也可能相關；小樣本勝率不能當成穩定預測力。上述使用歷史盤後完整資訊，未模擬盤中估量、盤中觸碰 SAR、滑價、除權息與資料公告時滯；應再做時間切分與樣本外驗證。</p>`;
}
function run(){
  if(busy)return;
  let ctx;
  try{
    ctx=root.TWStockBacktestStudyContext?.();
    if(!ctx)throw Error('請先開啟個股 Action 回測');
    const current=root.TWStockBacktestContext?.();
    if(ctx.stockKey!==stockKey||!current?.ready)throw Error('個股仍在更新，請完成分析後再試');
    const earlyDays=Number(by('skEarly').value),kdMode=by('skKd').value;
    root.TWSarKdStudy.validateOptions({earlyDays,kdMode});
    const sarParams=root.TWStockSARSettings?.()||root.TWParabolicSAR.defaults;
    root.TWParabolicSAR.validate(sarParams);
    busySet(true);by('skResults').replaceChildren();
    by('skStatus').textContent='計算歷史資料及 SAR／KD 訊號…';
    const id=++generation;
    worker=new Worker('/sar-kd-study-worker.js?r36');
    worker.onmessage=({data:m})=>{
      if(id!==generation)return;
      if(m.type==='progress')by('skStatus').textContent=m.message;
      if(m.type==='error'){busySet(false);by('skStatus').textContent='回測錯誤：'+m.message;}
      if(m.type==='result'){busySet(false);render(m.result,m.coverage);}
    };
    worker.onerror=e=>{if(id===generation){busySet(false);by('skStatus').textContent='計算失敗：'+(e.message||'背景程式載入失敗');}};
    worker.postMessage({data:ctx.data,params:ctx.params,sarParams,options:{earlyDays,kdMode}});
  }catch(e){busySet(false);by('skStatus').textContent=e.message;}
}
by('skRun').addEventListener('click',run);by('skCancel').addEventListener('click',()=>stop());
root.TWSarKdStudyRefresh=refresh;refresh();
})(globalThis);
