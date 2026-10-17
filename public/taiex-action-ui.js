(function(){
'use strict';
const $=id=>document.getElementById(id),A=TWTaiexAction,key='twq_taiex_action_r37',names=['趨勢','動能','SAR','量價'];
const f=(v,n=1)=>Number.isFinite(v)?v.toLocaleString('zh-TW',{maximumFractionDigits:n}):'—';
let config=A.validate(),context=null,dirty=false,lastSignature='',lastRaw=null,job=0;
try{config=A.validate(JSON.parse(localStorage.getItem(key)||'{}'));}catch{}
const fields={direction:'actDirection',delta:'actDelta',minEntry:'actMinimum',exit:'actExit',maxAge:'actAge',cost:'actCost'};
function fill(){for(const [k,id]of Object.entries(fields))$(id).value=config[k];for(const group of ['entryWeights','holdWeights'])config[group].forEach((v,i)=>$(group+i).value=v);}
function cancel(message='條件已變更，請重新搜尋。'){job++;$('actCancel').disabled=true;$('actOptStatus').textContent=message;$('actOptResults').replaceChildren();}
function clearResult(){cancel(); $('actResult').textContent='參數、SAR、合約或時段變更後，請重新執行回測。';$('actTrades').replaceChildren();}
function render(ctx){
 const signature=JSON.stringify({session:ctx.session,contract:ctx.contract,sar:ctx.sar,config});
 if(signature!==lastSignature||ctx.raw!==lastRaw)clearResult();lastSignature=signature;lastRaw=ctx.raw;
 context=ctx;$('actComposition').replaceChildren();$('actSignal').textContent='';$('actScope').textContent='';
 const b=ctx.rows[ctx.index];
 if(!b){$('actScores').textContent='所選時段或合約沒有資料';$('actParts').textContent='';$('actRun').disabled=true;$('actOptimize').disabled=true;return;}
 // Score only the current contract's own observed history; never splice prices at a roll.
 const history=TWTaiexFutures.series(ctx.raw,{session:ctx.session,contract:b.contract}).filter(r=>r.date<=b.date);
 const s=A.analyze(history,config,ctx.sar).at(-1);
 $('actRun').disabled=dirty;$('actOptimize').disabled=$('actRun').disabled;
 if(!$('actStart').value)$('actStart').value=ctx.rows[0].date;if(!$('actEnd').value)$('actEnd').value=ctx.rows.at(-1).date;
 updateScope();
 if(!s){$('actScores').textContent='審計日 '+b.date+'：同月份目前 '+history.length+' 根，需至少 61 根才能計分。可按「查看最新分數」；下方回測仍使用自訂日期。';$('actParts').textContent='';return;}
 $('actScores').textContent=(config.direction==='long'?'做多':'做空')+'｜進場 Action '+f(s.entry)+'｜變化 '+(s.delta>0?'+':'')+f(s.delta)+'｜續抱 Action '+f(s.hold);
 $('actParts').textContent=names.map((name,i)=>name+'：進場 '+f(s.entryParts[i])+'／續抱 '+f(s.holdParts[i])).join('；')+'。追價扣分 '+f(s.penalty)+'；SAR 同方向 '+(s.aligned?'是':'否')+'；距最近翻向 '+(s.age===null?'尚未觀察到':s.age+' 根')+'。';
 composition(s);
 $('actSignal').textContent='空手：'+(s.enter?'符合進場條件，下一根開盤模擬進場':'等待')+'；持倉：'+(s.leave?'續抱低於門檻，下一根開盤模擬離場':'續抱分數尚未低於門檻')+'。';
}
function composition(s){
 const e=s.evidence,pass=e.trend.map(v=>v?'符合 +25':'不符合 +0'),dir=config.direction==='long'?'大於':'小於';
 const details=[
 ['收盤 '+dir+' MA20：'+pass[0],'MA5 '+dir+' MA20：'+pass[1],'MA20 '+dir+' MA60：'+pass[2],'MA20 '+(config.direction==='long'?'上升':'下降')+'：'+pass[3]],
 ['14 根平均真實波幅：'+f(s.atr)+' 點','最近 3 根方向速度 v：'+f(e.velocity,3)+'；前段 vp：'+f(e.previous,3),'進場＝限制至 0～100 的 [50＋50×(v−vp)]','續抱＝限制至 0～100 的 [50＋35×v]；速度以波幅標準化'],
 ['SAR 與交易方向：'+(s.aligned?'相同':'不同'),'距最近翻向：'+(s.age===null?'尚未觀察到':s.age+' 根')+'；限制 '+(config.maxAge===0?'不限':config.maxAge+' 根'),'進場同向時隨根數遞減：100−根數×100/(限制+1)，最低 0；不限且已觀察到翻向為 100','續抱同向 100／反向 0；未觀察到翻向不給初期加分'],
 ['當根量／前 20 根均量：'+f(e.ratio,2)+' 倍（均量不含當根）','方向漲跌／平均真實波幅：'+f(e.move,3),'進場與續抱＝限制至 0～100 的 [50＋25×方向漲跌/波幅×min(2,量比)]','不以總未平倉增加判斷偏多或偏空']
 ];
 details.forEach((lines,i)=>{const card=document.createElement('article'),title=document.createElement('h3');title.textContent=names[i]+'｜進場 '+f(s.entryParts[i])+'／續抱 '+f(s.holdParts[i]);card.append(title);const ew=config.entryWeights[i]/config.entryWeights.reduce((a,b)=>a+b,0),hw=config.holdWeights[i]/config.holdWeights.reduce((a,b)=>a+b,0);lines.push('權重換算：進場 '+f(ew*100)+'% → '+f(s.entryParts[i]*ew)+' 分；續抱 '+f(hw*100)+'% → '+f(s.holdParts[i]*hw)+' 分');for(const line of lines){const p=document.createElement('p');p.textContent=line;card.append(p);}$('actComposition').append(card);});
 const note=document.createElement('p');note.textContent='進場加權合計另扣追價 '+f(s.penalty)+' 分：沿交易方向超過 MA20 的 2 倍波幅後，每超過 1 倍扣 10 分，最多 30 分；續抱不扣。';$('actComposition').append(note);
}
function range(){
 const start=$('actStart').value,requestedEnd=$('actEnd').value;
 if(!start||!requestedEnd||start>requestedEnd)throw Error('請設定回測起訖日期，起日不可晚於迄日');
 return {start,end:requestedEnd};
}
function backtestData(){
 if(!context?.rows.length)throw Error('請先載入行情');
 const dates=range();
 // Near-chart mode resolves ONE contract at requested period end; no cross-month splice.
 const contract=context.contract==='near'?context.rows.filter(b=>b.date<=dates.end).at(-1)?.contract:context.contract;
 if(!contract)throw Error('所選迄日前沒有合約行情，請調整日期');
 const rows=TWTaiexFutures.series(context.raw,{session:context.session,contract});
 return {rows,contract,dates};
}
function updateScope(){try{const data=backtestData();$('actScope').textContent=(context.contract==='near'?'近月圖模式：回測自動使用區間末月份 ':'回測合約 ')+data.contract+'，僅測試該月份自身歷史，不是跨月回測。回測日期獨立於上方審計游標。';}catch(e){$('actScope').textContent=e.message;}}
function persist(){try{localStorage.setItem(key,JSON.stringify(config));}catch{}}
fill();
$('actApply').addEventListener('click',()=>{try{const p={};for(const [k,id]of Object.entries(fields))p[k]=$(id).value;for(const group of ['entryWeights','holdWeights'])p[group]=[0,1,2,3].map(i=>$(group+i).value);config=A.validate(p);dirty=false;try{localStorage.setItem(key,JSON.stringify(config));}catch{}fill();$('actError').textContent='已套用參數；下方分數與回測使用此組設定。';if(context)render(context);}catch(e){$('actError').textContent=e.message+'；沿用上次有效參數。';}});
for(const id of [...Object.values(fields),...['entryWeights','holdWeights'].flatMap(k=>[0,1,2,3].map(i=>k+i))])$(id).addEventListener('input',()=>{dirty=true;cancel();$('actOptimize').disabled=true;$('actError').textContent='參數尚未套用，請按「套用參數」。';$('actRun').disabled=true;});
$('actReset').addEventListener('click',()=>{config=A.validate();dirty=false;fill();try{localStorage.setItem(key,JSON.stringify(config));}catch{}$('actError').textContent='已恢復試驗預設；並非最佳參數。';if(context)render(context);});
function run(){
 if(dirty||!context)return;
 try{const data=backtestData(),result=A.backtest(data.rows,config,context.sar,data.dates);updateScope();
 $('actResult').textContent=result.validBars<2?'有效樣本不足，請選擇有較長歷史的月份或增加載入年數。':'合約 '+data.contract+'｜'+result.start+' ～ '+result.end+'｜已平倉 '+result.trades.length+' 筆｜淨損益 '+f(result.net)+' 點｜勝率 '+f(result.winRate)+'%｜收盤權益最大回撤 '+f(result.maxDrawdown)+' 點｜獲利因子 '+(result.noLoss?'無虧損交易，無法估計':f(result.profitFactor,2))+'｜每筆來回成本 '+f(config.cost)+' 點'+(config.cost===0?'（未扣交易成本）':'')+'。';
 $('actTrades').replaceChildren();for(const t of result.trades){const tr=document.createElement('tr');for(const value of [t.signalDate,t.entryDate,f(t.entry),t.exitDate,f(t.exit),f(t.net),t.reason]){const td=document.createElement('td');td.textContent=value;tr.append(td);}$('actTrades').append(tr);}
 }catch(e){$('actResult').textContent=e.message;}
}
$('actRun').addEventListener('click',run);
for(const id of ['actStart','actEnd','actMinTrades'])$(id).addEventListener('input',()=>{clearResult();updateScope();});
$('actAllDates').addEventListener('click',()=>{if(!context?.rows.length)return;$('actStart').value=context.rows[0].date;$('actEnd').value=context.rows.at(-1).date;clearResult();updateScope();});
$('actCancel').addEventListener('click',()=>cancel('搜尋已停止；未套用任何參數。'));
$('actOptimize').addEventListener('click',async()=>{
 if(dirty||!context)return;
 cancel('準備搜尋…');const own=job;$('actCancel').disabled=false;
 try{
 const data=backtestData();updateScope();const iterator=A.optimize(data.rows,config,context.sar,data.dates,Number($('actMinTrades').value));let last;
 for(const progress of iterator){if(own!==job)return;last=progress;$('actOptStatus').textContent='已搜尋 '+progress.done+'／'+progress.total+' 組；符合最低筆數 '+progress.eligible+' 組';await new Promise(resolve=>setTimeout(resolve,0));}
 if(own!==job)return;
 $('actOptStatus').textContent=last.top.length?'合約 '+data.contract+'｜'+last.start+' ～ '+last.end+'｜搜尋完成 '+last.total+' 組，符合筆數 '+last.eligible+' 組。下列為樣本內前五名，請另換區間驗證。':'沒有候選達到最低交易筆數；可增加區間或調整最低筆數，勿將極少筆交易的高勝率當成可靠績效。';
 for(const [i,item]of last.top.entries()){
 const card=document.createElement('article'),label=document.createElement('p'),params=document.createElement('p'),button=document.createElement('button'),p=item.config,r=item.result;
 label.textContent='第 '+(i+1)+' 名｜勝率 '+f(r.winRate)+'%｜'+r.trades.length+' 筆｜淨 '+f(r.net)+' 點｜回撤 '+f(r.maxDrawdown)+' 點';
 params.textContent='進場權重 '+p.entryWeights.join('/')+'；續抱權重 '+p.holdWeights.join('/')+'；變化 ≥ '+p.delta+'；最低分 ≥ '+p.minEntry+'；離場 < '+p.exit+'；SAR 根數 '+(p.maxAge||'不限')+'；成本 '+p.cost+' 點';
 button.textContent='套用此組並回測';button.addEventListener('click',()=>{config=A.validate(p);dirty=false;fill();persist();$('actError').textContent='已套用樣本內候選參數；請另換區間驗證。';render(context);run();});
 card.append(label,params,button);$('actOptResults').append(card);
 }
 }catch(e){if(own===job)$('actOptStatus').textContent=e.message;}finally{if(own===job)$('actCancel').disabled=true;}
});
window.TWTaiexActionUI={render};
})();
