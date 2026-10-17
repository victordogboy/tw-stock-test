(function(root){
'use strict';
const $=id=>document.getElementById(id),E=root.TWTaiexR47;
if(!E)throw Error('R47 歸因引擎未載入');
const fmt=(x,places=1)=>Number.isFinite(x)?Number(x).toLocaleString('zh-TW',{maximumFractionDigits:places}):'—';
const signed=x=>(x>0?'+':'')+fmt(x);
const desc={flat:'空手時沒有參與同基準的市場走勢；負數代表成功避開下跌',short:'持有空單時，與基準多單方向相反；上漲時落後、下跌時可超越',cost:'策略合約結算段數相對基準較多而多付的總成本'};
const addCell=(tr,v)=>{const td=document.createElement('td');td.textContent=String(v);tr.append(td)};
function appendRow(id,values){
 const tr=document.createElement('tr');values.forEach(x=>addCell(tr,x));$(id).append(tr);
}
function clear(){
 for(const id of ['r47Parts','r47Months','r47Exits'])$(id).replaceChildren();
 $('r47FoldCards').replaceChildren();
 for(const id of ['r47Summary','r47Side','r47Costs','r47FoldSummary'])$(id).textContent='';
 $('r47Status').textContent='回測條件已變動，請重新執行 R46。';
}
function showError(err){$('r47Status').textContent='R47 損益歸因未完成：'+err.message;}
function renderReport(r,label){
 $('r47Status').textContent=label+' 歸因完成，損益對帳誤差 '+fmt(r.reconciliation.unexplained,5)+' 點。';
 $('r47Summary').textContent=r.start+' ～ '+r.end+
  '｜同期買進持有 '+signed(r.benchmarkNet)+' 點；策略 '+signed(r.strategyNet)+' 點；基準－策略差額 '+signed(r.benchmarkLag)+' 點（正值落後、負值超越）。'+
  '【對帳：空手 '+signed(r.lost.flatNet)+'＋空單 '+signed(r.lost.shortNet)+'＋成本差 '+signed(r.costs.excess)+'＝'+signed(r.benchmarkLag)+' 點】';
 $('r47Parts').replaceChildren();
 for(const [name,val,description] of [
  ['空手期間',r.lost.flatNet,desc.flat],['持有空單',r.lost.shortNet,desc.short],
  ['額外合約成本',r.costs.excess,desc.cost]
 ])appendRow('r47Parts',[name,signed(val),description]);
 $('r47Side').textContent='多單：毛損益 '+signed(r.long.gross)+' 點、淨 '+signed(r.long.net)+' 點／'+r.long.independentTrades+
  ' 筆獨立交易；空單：毛損益 '+signed(r.short.gross)+' 點、淨 '+signed(r.short.net)+' 點／'+r.short.independentTrades+
  ' 筆獨立交易。空手錯失上漲 '+fmt(r.lost.flatPositive)+' 點，避開的下跌 '+fmt(-r.lost.flatNegative)+
  ' 點；做空遇到市場上漲的相對損失 '+fmt(r.lost.shortRisePenalty)+' 點，做空受惠於下跌的相對優勢 '+fmt(-r.lost.shortFallBenefit)+' 點。';
 $('r47Costs').textContent='成本每合約段 '+fmt(r.costs.perLeg)+' 點；策略 '+r.costs.strategyLegs+' 段、共 '+
  fmt(r.costs.strategy)+' 點；買進持有 '+r.costs.benchmarkLegs+' 段、共 '+fmt(r.costs.benchmark)+
  ' 點；換月當日結算之策略成本 '+fmt(r.costs.rollSettlementStrategy)+
  ' 點／基準 '+fmt(r.costs.rollSettlementBenchmark)+' 點（已包含在各自總成本內，勿重複扣除）。'+
  (r.costs.perLeg===0?' 成本設為 0，回測偏樂觀。':'');
 $('r47Months').replaceChildren();
 for(const month of r.worstMonths)appendRow('r47Months',
  [month.month,signed(month.strategyNet),signed(month.benchmarkNet),signed(month.lag),signed(month.flatGap),
    signed(month.shortGap),fmt(month.strategyCosts)]);
 $('r47Exits').replaceChildren();
 for(const cause of r.exits)appendRow('r47Exits',[cause.reason,cause.count,cause.wins,signed(cause.net)]);
}
function showRun(prep,result){
 $('r47FoldCards').replaceChildren();$('r47FoldSummary').textContent='';
 try{
  const report=E.analyze(prep,result);renderReport(report,'R46 單組');
 }catch(err){showError(err);}
}
function showFolds(prep,walk){
 try{
  const r=E.folds(prep,walk),s=r.summary;
  $('r47FoldSummary').textContent='三段驗證基準－策略差額 '+signed(s.benchmarkLag)+' 點（正值落後、負值超越）＝空手 '+signed(s.flatNet)+
   ' 點＋做空 '+signed(s.shortNet)+' 點＋成本差 '+signed(s.costExcess)+' 點；策略 '+signed(s.strategyNet)+
   ' 點、基準 '+signed(s.benchmarkNet)+' 點。這些是分段回測的加總，並非持續持倉的實際資金曲線。';
  $('r47FoldCards').replaceChildren();
  for(const fold of r.reports){
   const card=document.createElement('article'),heading=document.createElement('h3'),p=document.createElement('p');
   heading.textContent='第 '+fold.fold+' 折歸因';card.append(heading);
   if(fold.unavailable)p.textContent='此折訓練期無符合最低筆數的候選，不做推論。';
   else{
    p.textContent=fold.start+' ～ '+fold.end+'：策略 '+signed(fold.strategyNet)+' 點／基準 '+signed(fold.benchmarkNet)+
     ' 點；基準－策略差額 '+signed(fold.benchmarkLag)+' 點＝空手 '+signed(fold.lost.flatNet)+
     '＋空單 '+signed(fold.lost.shortNet)+'＋成本差 '+signed(fold.costs.excess)+
     '。多單淨 '+signed(fold.long.net)+'、空單淨 '+signed(fold.short.net)+
     '；空手錯失上漲 '+fmt(fold.lost.flatPositive)+
     '、成功避跌 '+fmt(-fold.lost.flatNegative)+'；最差月份 '+
     (fold.worstMonths[0]?.month||'無')+'（落後 '+signed(fold.worstMonths[0]?.lag||0)+' 點）。';
   }
   card.append(p);$('r47FoldCards').append(card);
  }
  $('r47Status').textContent='R47 已完成三折樣本外損益對帳（所有折均通過對帳）。';
 }catch(err){showError(err);}
}
root.TWTaiexR47UI={clear,showRun,showFolds,showError};
})(typeof window==='object'?window:globalThis);
