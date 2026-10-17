(function(){
'use strict';
const $=id=>document.getElementById(id),A=TWTaiexAction,key='twq_taiex_action_r37',names=['趨勢','動能','SAR','量價'];
const f=(v,n=1)=>Number.isFinite(v)?v.toLocaleString('zh-TW',{maximumFractionDigits:n}):'—';
let config=A.validate(),context=null,dirty=false,lastSignature='',lastRaw=null;
try{config=A.validate(JSON.parse(localStorage.getItem(key)||'{}'));}catch{}
const fields={direction:'actDirection',delta:'actDelta',minEntry:'actMinimum',exit:'actExit',maxAge:'actAge',cost:'actCost'};
function fill(){for(const [k,id]of Object.entries(fields))$(id).value=config[k];for(const group of ['entryWeights','holdWeights'])config[group].forEach((v,i)=>$(group+i).value=v);}
function clearResult(){ $('actResult').textContent='參數、SAR、合約、時段或審計日變更後，請重新執行回測。';$('actTrades').replaceChildren();}
function render(ctx){
 const signature=JSON.stringify({index:ctx.index,session:ctx.session,contract:ctx.contract,sar:ctx.sar,config});
 if(signature!==lastSignature||ctx.raw!==lastRaw)clearResult();lastSignature=signature;lastRaw=ctx.raw;
 context=ctx;$('actSignal').textContent='';$('actScope').textContent='';
 const b=ctx.rows[ctx.index];
 if(!b){$('actScores').textContent='所選時段或合約沒有資料';$('actParts').textContent='';$('actRun').disabled=true;return;}
 // Score only the current contract's own observed history; never splice prices at a roll.
 const history=TWTaiexFutures.series(ctx.raw,{session:ctx.session,contract:b.contract}).filter(r=>r.date<=b.date);
 const s=A.analyze(history,config,ctx.sar).at(-1);
 $('actRun').disabled=dirty||ctx.contract==='near';
 $('actScope').textContent=ctx.contract==='near'?'分數使用 '+b.contract+' 合約自身歷史；回測請在上方「合約」選指定月份，避免跨月價差。':'回測範圍：'+(history[0]?.date||'—')+' ～ '+b.date+'，合約 '+b.contract+'，截至審計日。';
 if(!s){$('actScores').textContent='同月份合約需至少 61 根有效 K 線才能計分';$('actParts').textContent='';return;}
 $('actScores').textContent=(config.direction==='long'?'做多':'做空')+'｜進場 Action '+f(s.entry)+'｜變化 '+(s.delta>0?'+':'')+f(s.delta)+'｜續抱 Action '+f(s.hold);
 $('actParts').textContent=names.map((name,i)=>name+'：進場 '+f(s.entryParts[i])+'／續抱 '+f(s.holdParts[i])).join('；')+'。追價扣分 '+f(s.penalty)+'；SAR 同方向 '+(s.aligned?'是':'否')+'；距最近翻向 '+(s.age===null?'尚未觀察到':s.age+' 根')+'。';
 $('actSignal').textContent='空手：'+(s.enter?'符合進場條件，下一根開盤模擬進場':'等待')+'；持倉：'+(s.leave?'續抱低於門檻，下一根開盤模擬離場':'續抱分數尚未低於門檻')+'。';
}
fill();
$('actApply').addEventListener('click',()=>{try{const p={};for(const [k,id]of Object.entries(fields))p[k]=$(id).value;for(const group of ['entryWeights','holdWeights'])p[group]=[0,1,2,3].map(i=>$(group+i).value);config=A.validate(p);dirty=false;try{localStorage.setItem(key,JSON.stringify(config));}catch{}fill();$('actError').textContent='已套用參數；下方分數與回測使用此組設定。';if(context)render(context);}catch(e){$('actError').textContent=e.message+'；沿用上次有效參數。';}});
for(const id of [...Object.values(fields),...['entryWeights','holdWeights'].flatMap(k=>[0,1,2,3].map(i=>k+i))])$(id).addEventListener('input',()=>{dirty=true;$('actError').textContent='參數尚未套用，請按「套用參數」。';$('actRun').disabled=true;});
$('actReset').addEventListener('click',()=>{config=A.validate();dirty=false;fill();try{localStorage.setItem(key,JSON.stringify(config));}catch{}$('actError').textContent='已恢復試驗預設；並非最佳參數。';if(context)render(context);});
$('actRun').addEventListener('click',()=>{
 if(dirty||!context||context.contract==='near')return;
 try{const rows=context.rows.slice(0,context.index+1),result=A.backtest(rows,config,context.sar);
 $('actResult').textContent=result.validBars<2?'有效樣本不足，請選擇有較長歷史的月份或增加載入年數。':'已平倉 '+result.trades.length+' 筆｜淨損益 '+f(result.net)+' 點｜勝率 '+f(result.winRate)+'%｜收盤權益最大回撤 '+f(result.maxDrawdown)+' 點｜獲利因子 '+(result.noLoss?'無虧損交易，無法估計':f(result.profitFactor,2))+'｜每筆來回成本 '+f(config.cost)+' 點'+(config.cost===0?'（未扣交易成本）':'')+'。';
 $('actTrades').replaceChildren();for(const t of result.trades){const tr=document.createElement('tr');for(const value of [t.signalDate,t.entryDate,f(t.entry),t.exitDate,f(t.exit),f(t.net),t.reason]){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('actTrades').append(tr);}
 }catch(e){$('actResult').textContent=e.message;}
});
window.TWTaiexActionUI={render};
})();
