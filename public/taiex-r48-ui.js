(function(root){
'use strict';
const $=id=>document.getElementById(id),R=root.TWTaiexR48;
if(!R)throw Error('R48 engine unavailable');
const fmt=(v,n=1)=>Number.isFinite(v)?v.toLocaleString('zh-TW',{maximumFractionDigits:n}):'—';
const family=['MACD','KD','SAR','均線','量能'];
let context=null,token=0,previous=null;
function wipe(){
 token++;$('r48Cancel').disabled=true;$('r48Status').textContent='選項改變，請重新執行一鍵最佳化。';
 $('r48Results').replaceChildren();$('r48BySide').replaceChildren();$('r48Headline').textContent='';
}
function render(c){
 const changed=c.raw!==context?.raw||c.contract!==context?.contract||c.session!==context?.session;
 context=c;
 if(changed)wipe();
 const ready=c.contract==='near'&&c.rows?.length;
 $('r48Go').disabled=!ready;
 if(!ready)$('r48Status').textContent=c.rows?.length?'請選擇「近月連續」合約。':'請先載入行情（建議五年）。';
 else if(previous!==c.raw){previous=c.raw;$('r48Status').textContent='資料已載入。直接按「一鍵找五指標最佳組合」。';}
}
const numeric=id=>Number($(id).value);
function inputs(){
 if(!context?.rows?.length)throw Error('尚未載入行情');
 if(context.contract!=='near')throw Error('請選擇「近月連續」');
 const start=$('actStart').value,end=$('actEnd').value;
 if(!start||!end||start>end)throw Error('請設定有效的回測起訖日');
 const contractList=[...new Set(context.raw.map(b=>b.contract))];
 const rows=contractList.flatMap(c=>TWTaiexFutures.series(context.raw,{session:context.session,contract:c}));
 const cost=numeric('r48Cost'),minTrades=numeric('r48MinTrades');
 const base=R.validate({cost,minTrades,side:$('r48Side').value||'both'});
 return {rows,range:{start,end},cost,minTrades,base};
}
const sideName={long:'只做多',short:'只做空',both:'雙向'};
const summary=r=>'淨獲利 '+fmt(r.net)+' 點｜勝率 '+fmt(r.winRate)+'%（'+r.wins+'/'+r.tradeCount+' 筆）'+
 '｜最大回撤 '+fmt(r.maxDrawdown)+' 點｜基準 '+fmt(r.benchmark)+' 點'+
 '｜超額 '+fmt(r.excess)+' 點｜持倉 '+fmt(r.coverage)+'%';
function card(title,item){
 const article=document.createElement('article'),head=document.createElement('h3');
 head.textContent=title;article.append(head);
 if(!item){const p=document.createElement('p');p.textContent='沒有候選達到訓練期最低交易筆數及正淨利條件。';article.append(p);return article;}
 const add=s=>{const p=document.createElement('p');p.textContent=s;article.append(p);};
 add('訓練期：'+summary(item.training));
 add('未參與調參的驗證期：'+summary(item.validation));
 const p=item.config;
 add('五指標比例（總和 100%）：'+family.map((x,i)=>x+' '+fmt(p.weights[i],0)+'%').join('／'));
 add('MACD（快／慢／訊號） '+p.macd.join('/')+
  '；KD（週期／K 平滑／D 平滑） '+p.kd.join('/')+
  '；SAR（初始／增加／最大） '+p.sar.join('/')+
  '；MA（短／中／長） '+p.ma.join('/')+
  '；量能（平均天數／倍數） '+p.volume.join('/'));
 add('方向 '+sideName[p.side]+'；進場綜合分數 ≥ '+p.entry+
  '；出場反向分數 ≥ '+p.exit+'；ATR 追蹤停損 ×'+p.atrStop);
 return article;
}
$('r48Cancel').addEventListener('click',()=>{token++;$('r48Cancel').disabled=true;$('r48Status').textContent='搜尋已停止。';});
for(const id of ['r48Side','r48Objective','r48MinTrades','r48Cost','r48Depth'])$(id).addEventListener('change',wipe);
$('r48Go').addEventListener('click',async()=>{
 const task=++token;$('r48Cancel').disabled=false;
 $('r48Results').replaceChildren();$('r48BySide').replaceChildren();$('r48Headline').textContent='';
 try{
  const {rows,range,cost,minTrades,base}=inputs(),ctx=R.context(rows,range,cost);
  const gen=R.optimize(ctx,{base,minTrades,mode:$('r48Objective').value||'win',steps:$('r48Depth').value||'fast'});
  let final;
  for(const z of gen){
   if(task!==token)return;
   if(z.complete)final=z;
   else $('r48Status').textContent='正在搜尋：'+z.phase+'｜已比較 '+z.evaluated+' 組（符合條件 '+z.eligible+' 組）…';
   // Yield to user input so Stop and mobile screen remain responsive.
   await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(task!==token)return;
  $('r48Cancel').disabled=true;
  $('r48Status').textContent='一鍵最佳化完成，共測試 '+final.evaluated+' 組（合格 '+final.eligible+
   ' 組）；訓練截至 '+final.trainEnd+'，獨立驗證 '+final.validationStart+' ～ '+final.validationEnd+'。';
  $('r48Headline').textContent=final.results.length?
   '最佳結果（驗證期）：'+summary(final.results[0].validation):
   '目前沒有候選符合最低訓練交易筆數及正獲利要求，不能聲稱找到最佳勝率。';
  for(const [i,item] of final.results.entries())$('r48Results').append(card('第 '+(i+1)+' 名｜'+sideName[item.config.side],item));
  for(const side of ['long','short','both'])$('r48BySide').append(card(sideName[side]+'最佳',final.modes[side]));
 }catch(e){if(task===token)$('r48Status').textContent='一鍵搜尋未完成：'+e.message;}
 finally{if(task===token)$('r48Cancel').disabled=true;}
});
root.TWTaiexR48UI={render};
})(typeof window==='object'?window:globalThis);
