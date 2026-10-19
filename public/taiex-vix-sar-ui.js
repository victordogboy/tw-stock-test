(function(root){
'use strict';const $=id=>document.getElementById(id);let context=null,generation=0;
function render(c){
 const changed=!context||context.raw!==c.raw||context.session!==c.session||JSON.stringify(context.sar)!==JSON.stringify(c.sar);
 context={...c,sar:{...c.sar}};
 if(changed){generation++;$('vsResults').replaceChildren();$('vsSummary').textContent='參數或行情已改變，請重新回測。';
 if(c.rows.length){$('vsStart').value=c.rows[0].date;$('vsEnd').value=c.rows.at(-1).date;}}
 $('vsRun').disabled=!c.raw.length||c.session!=='position';
 if(c.session!=='position')$('vsSummary').textContent='本模型使用日盤收盤訊號；請將交易時段切至日盤。';
}
function fmt(n){return Number.isFinite(n)?n.toLocaleString('zh-TW',{maximumFractionDigits:2}):'—';}
async function run(){
 const owner=++generation,c=context;if(!c?.raw.length)return;
 $('vsRun').disabled=true;$('vsResults').replaceChildren();$('vsSummary').textContent='取得美國 VIX 並計算 SAR 組合策略…';
 try{
  const start=$('vsStart').value,end=$('vsEnd').value;
  if(!start||!end||start>end)throw Error('請選擇有效的回測日期');
  const contracts=[...new Set(c.raw.map(b=>b.contract))],rows=contracts.flatMap(contract=>TWTaiexFutures.series(c.raw,{session:'position',contract}));
  const from=new Date(Date.parse(rows[0].date)-7*86400000).toISOString().slice(0,10);
  const response=await fetch('/api/futures/taiex/vix?'+new URLSearchParams({market:'us',start_date:from,end_date:end}),{cache:'no-store',signal:AbortSignal.timeout(45000)});
  const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'VIX 資料失敗');
  if(owner!==generation)return;
  const result=TWTaiexVixSar.backtest(rows,data.data,{entry:Number($('vsEntry').value),exit:Number($('vsExit').value),exitDirection:$('vsDirection').value,cost:Number($('vsCost').value)},c.sar,{start,end});
  $('vsSummary').textContent='勝率 '+(result.winRate===null?'—（尚無完整策略出場）':fmt(result.winRate)+'%')+'｜完整交易 '+result.tradeCount+' 筆（勝 '+result.wins+'／負 '+result.losses+'／平 '+result.flats+'）｜總淨損益 '+fmt(result.net)+' 點｜最大回撤 '+fmt(result.maxDrawdown)+' 點｜期末強制平倉 '+result.forcedCount+' 筆（不列勝率）｜有效配對 '+result.validDays+'/'+result.totalDays+' 日｜進場訊號 '+result.entrySignals+' 次｜出場訊號 '+result.exitSignals+' 次｜實際期間 '+result.start+'～'+result.end+'｜'+data.source+'｜VIX 最新 '+(data.data.at(-1)?.date||'無')+(result.tradeCount<20?'｜樣本少於 20 筆，勝率參考性有限':'');
  for(const t of result.trades){const tr=document.createElement('tr');for(const value of [t.signalDate,t.entryDate,fmt(t.entryVix),t.exitSignalDate||'—',t.exitDate,t.exitVix===undefined?'—':fmt(t.exitVix),fmt(t.net),t.reason]){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('vsResults').append(tr);}
 }catch(e){if(owner===generation)$('vsSummary').textContent='回測未完成：'+e.message;}
 finally{if(owner===generation)$('vsRun').disabled=false;}
}
$('vsRun').addEventListener('click',run);
for(const id of ['vsStart','vsEnd','vsEntry','vsExit','vsDirection','vsCost'])$(id).addEventListener('change',()=>{generation++;$('vsResults').replaceChildren();$('vsSummary').textContent='條件已修改，請重新回測。';$('vsRun').disabled=!context?.raw.length||context.session!=='position';});
root.TWTaiexVixSarUI={render};
})(window);
