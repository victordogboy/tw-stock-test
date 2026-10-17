(function(root){
'use strict';
const $=id=>document.getElementById(id),R=root.TWTaiexR48;
if(!R)throw Error('R48 engine unavailable');
const fmt=(v,n=1)=>Number.isFinite(v)?v.toLocaleString('zh-TW',{maximumFractionDigits:n}):'—';
const family=['MACD','KD','SAR','均線','量能','法人'];
let context=null,token=0,previous=null,fetchController=null;
function wipe(){
 token++;fetchController?.abort();fetchController=null;$('r48Cancel').disabled=true;$('r48Status').textContent='選項改變，請重新執行一鍵最佳化。';
 $('r48Results').replaceChildren();$('r48BySide').replaceChildren();$('r48Headline').textContent='';$('r48InstSummary').textContent='';
}
function render(c){
 const changed=c.raw!==context?.raw||c.contract!==context?.contract||c.session!==context?.session;
 context=c;
 if(changed){wipe();if(c.rows?.length){$('r48Start').value=c.rows[0].date;$('r48End').value=c.rows.at(-1).date;}}
 const ready=c.contract==='near'&&c.rows?.length;
 $('r48Go').disabled=!ready;
 if(!ready)$('r48Status').textContent=c.rows?.length?'請選擇「近月連續」合約。':'請先載入行情（建議五年）。';
 else if(previous!==c.raw){previous=c.raw;$('r48Status').textContent='資料已載入。直接按「一鍵找六指標最佳組合」。';}
}
const numeric=id=>Number($(id).value);
function inputs(){
 if(!context?.rows?.length)throw Error('尚未載入行情');
 if(context.contract!=='near')throw Error('請選擇「近月連續」');
 const start=$('r48Start').value,end=$('r48End').value;
 if(!start||!end||start>end)throw Error('請設定有效的回測起訖日');
 const contractList=[...new Set(context.raw.map(b=>b.contract))];
 const rows=contractList.flatMap(c=>TWTaiexFutures.series(context.raw,{session:context.session,contract:c}));
 const cost=numeric('r48Cost'),minTrades=numeric('r48MinTrades');
 const institutionMode=$('r48Mode').value||'six';
 const base=R.validate({cost,minTrades,side:$('r48Side').value||'both',
  weights:institutionMode==='six'?[20,20,15,15,15,15]:[20,20,20,20,20,0]});
 return {rows,range:{start,end},cost,minTrades,base,institutionMode};
}
async function loadInstitutional(range,owner){
 const start=new Date(range.start+'T00:00:00Z').getTime()-120*86400000,
 end=new Date(range.end+'T00:00:00Z').getTime(),day=86400000;
 const batchDays=180; // Smaller periods avoid over-large historical FinMind requests.
 fetchController=new AbortController();const rows=[],issues=[];
 for(let cursor=start;cursor<=end;cursor+=batchDays*day){
  if(owner!==token)throw Error('搜尋已取消');
  const from=new Date(cursor).toISOString().slice(0,10),
   until=new Date(Math.min(end,cursor+(batchDays-1)*day)).toISOString().slice(0,10);
  const params=new URLSearchParams({start_date:from,end_date:until});
  $('r48Status').textContent='載入台指期法人資料 '+from+'～'+until+'…';
  const response=await fetch('/api/futures/taiex/institutional?'+params.toString(),{
   headers:TWFinMindTokens.headers(),cache:'no-store',signal:fetchController.signal
  });
  const body=await response.json().catch(()=>null);
  if(response.status===422&&['TX_SOURCE_EMPTY','TX_SCHEMA_MISMATCH'].includes(body?.code)){
   // Record an actual source problem instead of inventing institutional scores.
   const d=body.diagnostic||{};
   issues.push({from,until,code:body.code,reason:body.error||'無資料',
    rows:d.upstream_rows??null,products:d.sample_products||[],investors:d.sample_investors||[]});
   continue;
  }
  if(!response.ok||!body?.ok||!Array.isArray(body.data)){
   const failure=Error(from+'～'+until+'：'+(body?.error||'法人資料讀取失敗'));
   failure.name='InstitutionalFetchError';throw failure;
  }
  rows.push(...body.data);
 }
 return {rows,issues};
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
 add('六元素比例（總和 100%）：'+family.map((x,i)=>x+' '+fmt(p.weights[i],0)+'%').join('／'));
 add('MACD（快／慢／訊號） '+p.macd.join('/')+
  '；KD（週期／K 平滑／D 平滑） '+p.kd.join('/')+
  '；SAR（初始／增加／最大） '+p.sar.join('/')+
  '；MA（短／中／長） '+p.ma.join('/')+
  '；量能（平均天數／倍數） '+p.volume.join('/')+
  '；法人買賣／淨未平倉變化（回溯天數） '+p.institutional.join('/'));
 add('方向 '+sideName[p.side]+'；進場綜合分數 ≥ '+p.entry+
  '；出場反向分數 ≥ '+p.exit+'；ATR 追蹤停損 ×'+p.atrStop);
 return article;
}
$('r48Cancel').addEventListener('click',()=>{token++;fetchController?.abort();$('r48Cancel').disabled=true;$('r48Status').textContent='搜尋已停止。';});
for(const id of ['r48Mode','r48Side','r48Objective','r48MinTrades','r48Cost','r48Depth','r48Start','r48End'])$(id).addEventListener('change',wipe);
$('r48Go').addEventListener('click',async()=>{
 const task=++token;$('r48Cancel').disabled=false;
 $('r48Results').replaceChildren();$('r48BySide').replaceChildren();$('r48Headline').textContent='';
 try{
  const {rows,range,cost,minTrades,institutionMode}=inputs();
  let {base}= {base:inputs().base},institutionRows=[],issues=[],loadFailure='';
  if(institutionMode==='six'){
   try{
    const fetched=await loadInstitutional(range,task);
    institutionRows=fetched.rows;issues=fetched.issues;
   }catch(err){
    if(err.name==='AbortError'||task!==token)return;
    loadFailure=err.message||'法人資料來源不可用';
   }
  }
  if(task!==token)return;
  let ctx=R.context(rows,range,cost,institutionRows),fallbackReason='';
  if(institutionMode==='six'){
   const eligible=ctx.timeline.slice(20).filter(b=>{
    const groups=ctx.institution.get(b.date);return groups&&['外資','投信','自營商'].every(x=>groups.has(x));
   }).length,possible=Math.max(1,ctx.timeline.length-20),coverage=100*eligible/possible;
   if(loadFailure||coverage<80){
    // Run only the genuine five indicators; never display it as a six-factor win.
    fallbackReason=loadFailure||'六元素資料覆蓋率 '+coverage.toFixed(1)+'%（'+eligible+'/'+possible+' 日），低於 80%';
    const issueMessage=issues.length?'；來源區間異常：'+issues.slice(0,2).map(x=>x.from+'～'+x.until+
      '（'+(x.code==='TX_SOURCE_EMPTY'?'來源回傳 0 列':'欄位格式不符')+
      (x.products.length?'；商品 '+x.products.join('/'):'')+'）').join('、'):'';
    $('r48InstSummary').textContent='六元素未執行：'+fallbackReason+issueMessage+
      '。已自動改用五元素（法人權重 0%），不會製造法人資料；如需六元素請確認 FinMind Token 與日期涵蓋率。';
    $('r48Mode').value='five';institutionRows=[];
    base=R.validate({...base,weights:[20,20,20,20,20,0]});
    ctx=R.context(rows,range,cost,[]);
   }else{
    $('r48InstSummary').textContent='六元素來源：FinMind 台指期 TX；外資／投信／自營商完整紀錄 '+
      eligible+'/'+possible+' 日（'+coverage.toFixed(1)+'%）；真實買賣與淨未平倉量，非量價代理。';
   }
  }else $('r48InstSummary').textContent='目前選擇五元素：法人權重固定為 0%，不使用任何替代或虛構法人資料。';
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
  $('r48Status').textContent=(fallbackReason?'【已改用五元素，非六元素結果】':'')+
   '一鍵最佳化完成，共測試 '+final.evaluated+' 組（合格 '+final.eligible+
   ' 組）；訓練截至 '+final.trainEnd+'，獨立驗證 '+final.validationStart+' ～ '+final.validationEnd+'。';
  $('r48Headline').textContent=final.results.length?
   '最佳結果（驗證期）：'+summary(final.results[0].validation):
   '目前沒有候選符合最低訓練交易筆數及正獲利要求，不能聲稱找到最佳勝率。';
  for(const [i,item] of final.results.entries())$('r48Results').append(card('第 '+(i+1)+' 名｜'+sideName[item.config.side],item));
  for(const side of ['long','short','both'])$('r48BySide').append(card(sideName[side]+'最佳',final.modes[side]));
 }catch(e){if(task===token)$('r48Status').textContent='一鍵搜尋未完成：'+e.message;}
 finally{if(task===token){$('r48Cancel').disabled=true;fetchController=null;}}
});
root.TWTaiexR48UI={render};
})(typeof window==='object'?window:globalThis);
