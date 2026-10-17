(function(root){
'use strict';
const $=id=>document.getElementById(id),E=root.TWTaiexR46;
if(!E)throw Error('R46 engine missing');
const fmt=(x,n=1)=>Number.isFinite(x)?Number(x).toLocaleString('zh-TW',{maximumFractionDigits:n}):'—';
const filterNames={adx:'ADX 趨勢強度',momentum:'MACD＋ROC 動能',breakout:'20／55 根突破',sar:'SAR 起漲限制',volume:'突破量能確認'};
let context=null,market=null,job=0;
function cancel(message){
 job++;$('r46Stop').disabled=true;
 if(message)$('r46Status').textContent=message;
}
function clear(){
 cancel('行情或條件已改變，請重新執行 R46。');
 $('r46Folds').replaceChildren();$('r46Ablation').replaceChildren();$('r46Legs').replaceChildren();
 $('r46Current').textContent='';$('r46Summary').textContent='';
}
function render(c){
 const signature=c.raw===context?.raw&&c.contract===context?.contract&&c.session===context?.session&&JSON.stringify(c.sar)===JSON.stringify(context?.sar);
 context=c;
 if(!signature)clear();
 const ready=c.contract==='near'&&!!c.rows?.length;
 $('r46Run').disabled=!ready;$('r46Walk').disabled=!ready;
 if(!ready)$('r46Status').textContent=c.rows?.length?'R46 需選擇「近月連續」合約。':'請先載入至少一個近月合約行情。';
 else if(!market||market!==c.raw){market=c.raw;$('r46Status').textContent='近月連續行情已載入，可執行 R46。';}
}
function data(){
 if(!context?.rows?.length)throw Error('請先載入完整台指期資料');
 if(context.contract!=='near')throw Error('R46 需選擇近月連續合約');
 const start=$('actStart').value,end=$('actEnd').value;
 if(!start||!end||start>end)throw Error('請設定有效回測日期');
 const contracts=[...new Set(context.raw.map(b=>b.contract))];
 const rows=contracts.flatMap(contract=>TWTaiexFutures.series(context.raw,{session:context.session,contract}));
 const numeric=(id)=>Number($(id).value);
 const p=E.validate({
  sideMode:$('r46Side').value,entryType:$('r46Entry').value,exitType:$('r46Exit').value,
  adxMin:numeric('r46Adx'),breakoutDays:numeric('r46Breakout'),atrMultiple:numeric('r46Atr'),cost:numeric('r46Cost'),
  trendBars:numeric('actTrendBars'),breakBars:numeric('actBreakBars'),
  delta:numeric('actDelta'),minEntry:numeric('actMinimum'),exit:numeric('actExit'),maxAge:numeric('actAge'),
  preFlipGap:numeric('actPreGap'),preFlipMin:numeric('actPreMin'),sarMode:$('actSarMode').value,
  entryWeights:[0,1,2,3].map(i=>numeric('entryWeights'+i)),
  holdWeights:[0,1,2,3].map(i=>numeric('holdWeights'+i))
 });
 return {rows,p,range:{start,end}};
}
const line=r=>'策略 '+fmt(r.net)+' 點｜基準 '+fmt(r.benchmarkNet)+' 點｜超額 '+fmt(r.excessNet)+
 ' 點｜基準倍數 '+(r.ratio===null?'不適用':fmt(r.ratio,2)+' 倍')+
 '｜2 倍 '+(r.target2x===null?'不適用':r.target2x?'達成':'未達成')+
 '｜回撤 '+fmt(r.maxDrawdown)+' 點｜'+r.signalTradeCount+' 筆獨立交易／'+r.legCount+' 合約段'+
 '｜勝率 '+fmt(r.winRate)+'%｜持倉 '+fmt(r.coverage)+'%（'+r.coveredBars+' 日）'+
 '｜空手絕對波動合計 '+fmt(r.flatAbsMotion)+' 點';
$('r46Run').addEventListener('click',()=>{
 if(!context)return;
 try{
  const {rows,p,range}=data(),r=E.backtest(rows,p,context.sar,range);
  $('r46Current').textContent=r.start+' ～ '+r.end+'｜'+line(r)+
    '｜實際多單 '+r.counts.long+' 次／空單 '+r.counts.short+' 次'+
    '｜ADX 多頭 '+r.regimes.bull+' 日、空頭 '+r.regimes.bear+' 日、盤整 '+r.regimes.range+' 日'+
    '｜起漲 '+r.counts.sar+' 次、趨勢續進 '+r.counts.trend+' 次、通道突破 '+r.counts.breakout+' 次'+
    '｜成本 '+fmt(p.cost)+' 點／合約段'+(p.cost===0?'（未扣成本，偏樂觀）':'');
  $('r46Status').textContent='R46 單組雙向回測完成；此結果尚未進行滾動驗證。';
  $('r46Legs').replaceChildren();
  for(const leg of r.legs){
   const tr=document.createElement('tr');
   for(const value of [leg.contract,leg.side==='long'?'做多':'做空',leg.entryDate,fmt(leg.entry,2),
    leg.exitDate,fmt(leg.exit,2),fmt(leg.net),leg.reason]){
    const td=document.createElement('td');td.textContent=value;tr.append(td);
   }
   $('r46Legs').append(tr);
  }
 }catch(e){$('r46Status').textContent='R46 回測失敗：'+e.message;}
});
$('r46Stop').addEventListener('click',()=>cancel('R46 搜尋已停止；未更新結果。'));
for(const id of ['r46Side','r46Entry','r46Exit','r46Adx','r46Breakout','r46Atr','r46Cost','r46Minimum'])
 $(id).addEventListener('change',clear);
$('r46Walk').addEventListener('click',async()=>{
 if(!context)return;
 cancel('開始逐折滾動驗證…');
 const owner=job;$('r46Stop').disabled=false;
 $('r46Folds').replaceChildren();$('r46Ablation').replaceChildren();
 try{
  const {rows,p,range}=data(),minimum=Number($('r46Minimum').value);
  let final;
  for(const progress of E.walkForward(rows,p,context.sar,range,minimum)){
   if(owner!==job)return;
   if(progress.complete)final=progress;
   else $('r46Status').textContent='逐折搜尋 '+progress.done+'／'+progress.total+
    '；第 '+progress.fold+' 折目前符合最少交易 '+progress.eligible+' 組';
   await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(owner!==job)return;
  const sum=final.summary;
  $('r46Status').textContent='R46 三段滾動驗證完成；候選 '+final.gridSize+' 組／折，'+sum.foldCount+'／3 折符合條件。'+final.warning;
  $('r46Summary').textContent='各折樣本外合計：策略 '+fmt(sum.net)+' 點，1 口台指期買進持有 '+fmt(sum.benchmarkNet)+
    ' 點，超額 '+fmt(sum.excessNet)+' 點，倍數 '+(sum.ratio===null?'基準非正值':fmt(sum.ratio,2)+' 倍')+
    '，兩倍目標 '+(sum.target2x===null?'不適用':sum.target2x?'達成':'未達成')+
    '；累計獨立交易 '+sum.tradeCount+' 筆；相同測試段固定參數 R45 混合做多比較 '+fmt(sum.legacyR45Net)+' 點。'+
    '注意：各折重新選參數、空手起算，不是持續實盤淨值曲線，且樣本外筆數可能很少。';
  for(const fold of final.folds){
   const card=document.createElement('article'),h=document.createElement('h3'),txt=document.createElement('p');
   h.textContent='第 '+fold.fold+' 折：訓練至 '+fold.trainEnd+'／驗證 '+fold.testStart+'～'+fold.testEnd;card.append(h);
   if(fold.unavailable){
    txt.textContent='訓練期無策略達最低獨立交易；最多 '+fold.maxTrades+' 筆。沒有偽造績效。';
   }else{
    const p=fold.config;
    txt.textContent='只在訓練期選出：'+({long:'僅多',short:'僅空',both:'多空雙向'}[p.sideMode])+
     '／'+({early:'SAR 起漲',trend:'趨勢／突破',hybrid:'混合'}[p.entryType])+
     '／出場 '+p.exitType+'；ADX ≥ '+p.adxMin+'；通道 '+p.breakoutDays+'；ATR ×'+p.atrMultiple+
     '。訓練：'+line(fold.train)+'。真正下一段驗證：'+line(fold.validation)+
     '。R45 固定混合做多同段 '+fmt(fold.legacy.net)+' 點。';
   }
   card.append(txt);$('r46Folds').append(card);
  }
  for(const [key,label] of Object.entries(filterNames)){
   const tr=document.createElement('tr'),values=final.folds.map(f=>f.ablation?.[key]?.deltaNet??null),total=values.reduce((v,x)=>v+(x||0),0);
   for(const v of [label,...values.map(x=>x===null?'—':(x>=0?'+':'')+fmt(x)),values.every(x=>x===null)?'—':(total>=0?'+':'')+fmt(total)]){
    const td=document.createElement('td');td.textContent=v;tr.append(td);
   }
   $('r46Ablation').append(tr);
  }
 }catch(e){if(owner===job)$('r46Status').textContent='R46 滾動驗證失敗：'+e.message;}
 finally{if(owner===job)$('r46Stop').disabled=true;}
});
root.TWTaiexR46UI={render};
})(typeof window==='object'?window:globalThis);
