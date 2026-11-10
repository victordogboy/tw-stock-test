/* FC23 latest PAPER status. Historical archive remains immutable. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (v,d=2) => Number(v).toLocaleString('zh-TW',{minimumFractionDigits:d,maximumFractionDigits:d});
  const pct = v => Number.isFinite(Number(v)) ? num(Number(v)*100,2)+'%' : '—';
  const reason = {risk_exit:'風控出場',rank_exit:'排名淘汰',replace:'領漲股換股',candidate:'新候選股',fc17_confirmed_reentry:'強勢股再進場',deferred_locked_exit:'先前跌停待賣'};
  const fmt = v => v ? esc(v) : '—';
  let refreshing=false;
  function risks(d) {
    const dec=d.plan?.decision || {};
    const market=[];
    if(dec.marketCold)market.push('三日急跌冷卻（曝險×0.15）');
    if(d.plan?.snapshot?.bear)market.push('空頭環境（曝險×0.35）');
    if(d.plan?.snapshot?.overlay)market.push('20日跌幅風控（曝險×0.7）');
    if(dec.portRisk)market.push('40日帳戶風控（禁止新增曝險）');
    if(dec.ddGate)market.push('最大回撤風控（曝險×0.1）');
    if(Number(dec.breadthDelta)<-.16)market.push('10日廣度急降（曝險×0.35）');
    else if(Number(dec.breadthDelta)<-.08)market.push('10日廣度轉弱（曝險×0.7）');
    if(!dec.rebalance&&!dec.riskRelease&&!dec.reentryCandidates)market.push('非主要調倉日，無風控解除與合格重新進場機會');
    return market;
  }
  function render(d) {
    const latest=(d.snapshots||[]).at(-1);
    const plan=d.plan||{};
    const state=d.sync_status||'unknown';
    const ready=state==='current'&&plan.readiness==='ready';
    const date=d.data_as_of||'—';
    const actions=plan.actions||[];
    const holdings=latest?.holdings||[];
    const risk=risks(d);
    const progress=d.progress?.phase||'';
    const lastErr=d.lastError?.message||plan.blockedReason||'';
    $('fc23-live-state').textContent=ready?'✅ 最新 FC23 紙上計畫已計算':'⚠️ FC23 最新計畫尚未就緒';
    $('fc23-live-updated').textContent='模型行情截至 '+date+'｜已檢查至 '+(d.checkedThrough||'—')+'｜下一交易日 '+(plan.trade_date||'未確認')+'｜狀態 '+state;
    $('fc23-live-explanation').innerHTML=ready
      ? '當期交易計畫狀態：<b>'+ (actions.some(a=>a.side==='BUY'||a.side==='SELL')?'有待執行的模型買賣訊號':holdings.length?'沒有新買賣指令，維持目前模型持股':'沒有買賣訊號，模型維持空手') +'</b>。這是FC23自己的模擬帳本，並非券商下單或實際庫存。'
      : '<b>未通過當期資料完整性驗收，不顯示可操作訊號。</b> '+esc(lastErr||progress||'更新資料待確認');
    $('fc23-live-numbers').innerHTML =
      '<div><small>目標總曝險</small><strong>'+pct(plan.decision?.target??plan.snapshot?.target)+'</strong></div>'+
      '<div><small>最新模型持股</small><strong>'+holdings.length+' 檔</strong></div>'+
      '<div><small>下一交易日買／賣</small><strong>'+actions.filter(a=>a.side==='BUY').length+'／'+actions.filter(a=>a.side==='SELL').length+'筆</strong></div>';
    const detail=actions.filter(a=>['BUY','SELL','HOLD'].includes(a.side));
    $('fc23-live-actions').innerHTML=ready
      ? detail.length
        ? '<table><thead><tr><th>股票</th><th>動作</th><th>執行方式</th><th>盤前價位</th><th>原因</th></tr></thead><tbody>'+detail.map(a=>'<tr><td>'+esc(a.code)+'</td><td>'+({'BUY':'買入','SELL':'賣出','HOLD':'持有'}[a.side])+'</td><td>'+esc(a.method||'—')+'</td><td>'+ (a.side==='BUY'?num(a.level):a.side==='SELL'?'隔日開盤價':'—')+'</td><td>'+esc(reason[a.reason]||a.reason||'—')+'</td></tr>').join('')+'</tbody></table>'
        : '<p>當期沒有個股交易指令；這是策略計算結果，不是資料凍結。</p>'
      : '<p>資料待補齊或同步異常，目前不應使用交易指令。</p>';
    $('fc23-live-risks').innerHTML='<b>為什麼目前沒有進出：</b> 市場廣度 '+pct(plan.decision?.breadth)+'，10日廣度變化 '+pct(plan.decision?.breadthDelta)+'，市場20日變動 '+pct(plan.decision?.market20)+'。'+
      (risk.length?'<ul>'+risk.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>':'<p>未發現已列出的風控條件，仍需依FC23選股訊號及持股檢查。</p>');
    if(ready){
      $('block').textContent='✅ FC23已更新到 '+date+'；模型交易計畫屬紙上模擬';
      $('warning').textContent='歷史研究封存仍截至2026/10/27；下方即時區塊顯示更新至'+date+'的獨立FC23模型。即使計畫就緒，也不代表券商已成交。';
    }else{
      $('block').textContent='⚠️ FC23 最新資料未驗證，暫停使用當期訊號';
      $('warning').textContent=lastErr||progress||'請查詢同步狀態；歷史封存不受影響。';
    }
    $('fc23-live-progress').textContent=progress ? '更新進度：'+progress : '';
  }
  async function snapshot() {
    const res=await fetch('/api/fc23/snapshot?ts='+Date.now(),{cache:'no-store'});
    if(!res.ok)throw new Error('最新FC23 API回應 HTTP '+res.status);
    const d=await res.json();
    if(!d||!Array.isArray(d.snapshots)||!d.plan)throw new Error('FC23 API尚未返回完整計畫');
    render(d);
    return d;
  }
  async function pollRefresh() {
    if(refreshing)return;
    refreshing=true;
    $('fc23-live-refresh').disabled=true;
    try{
      const response=await fetch('/api/fc23/refresh',{method:'POST',cache:'no-store'});
      if(!response.ok)throw new Error('背景刷新無法啟動 HTTP '+response.status);
      for(let i=0;i<24;i++){
        await new Promise(resolve=>setTimeout(resolve,i===0?2500:3500));
        const d=await snapshot();
        if(!d.running)break;
      }
    }catch(e){$('fc23-live-progress').textContent='更新失敗：'+e.message;}
    finally{refreshing=false;$('fc23-live-refresh').disabled=false;}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    if(!$('fc23-live-state'))return;
    $('fc23-live-refresh').addEventListener('click',pollRefresh);
    snapshot().catch(e=>{
      $('fc23-live-state').textContent='⚠️ 連線失敗，無法判定當期交易狀態';
      $('fc23-live-explanation').textContent=e.message+'。歷史回測資料仍可查閱，但不可當作最新訊號。';
      $('block').textContent='⚠️ FC23 最新狀態尚未驗證';
      $('warning').textContent='動態資料讀取失敗，不等於FC23引擎凍結。';
    });
  });
})();