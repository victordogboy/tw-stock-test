'use strict';
const el=id=>document.getElementById(id),C=ResearchR19;
let partialFailure=null;
let stopped=false,busy=false,worker=null,report=null,requestAbort=null;
const day=(s,n)=>new Date(Date.parse(s+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const twToday=new Date(Date.now()+28800000).toISOString().slice(0,10);
if(el('poolDate'))el('poolDate').value=twToday;
el('end').value=day(twToday,-1);el('start').value=day(twToday,-540);
const dbPromise=new Promise((resolve,reject)=>{const q=indexedDB.open('tw-stock-research-r19',1);q.onupgradeneeded=()=>q.result.createObjectStore('records');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
async function dbGet(key){const db=await dbPromise;return new Promise((res,rej)=>{const q=db.transaction('records').objectStore('records').get(key);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error);});}
async function dbPut(key,value){const db=await dbPromise;return new Promise((res,rej)=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put(value,key);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error||Error('資料儲存失敗'));});}
async function dbAll(){const db=await dbPromise;return new Promise((res,rej)=>{const q=db.transaction('records').objectStore('records').openCursor(),a=[];q.onsuccess=()=>{const c=q.result;if(c){a.push([c.key,c.value]);c.continue();}else res(a)};q.onerror=()=>rej(q.error);});}
function options(){
  const start=el('start').value,end=el('end').value;
  if(!start||!end||start>=end||end>=twToday||start<'2010-07-01')throw Error('請設定有效的歷史期間，截止日必須早於台灣今天');
  if((Date.parse(end)-Date.parse(start))/86400000>1827)throw Error('單次回測最長約5年（1827個日曆日），另自動預留180日暖機資料');
  const cost={};for(const k of ['fee','tax','slippage']){const n=Number(el(k).value);if(!el(k).value||!Number.isFinite(n)||n<0||n>2)throw Error('成本須介於 0% 與 2%');cost[k]=n/100;}
  const minTrades=Number(el('minTrades').value),seed=Number(el('seed').value);if(!Number.isInteger(minTrades)||minTrades<20||!Number.isFinite(seed))throw Error('最少成交筆數至少 20，種子必須是數字');
  const universe=el('universe')?.value||'top100',scoreMode=el('scoreMode')?.value||'full';
  const fixedStocks=[...new Set((el('fixedStocks')?.value||'').trim().split(/[,，\s]+/).filter(Boolean))].sort();
  if(universe==='fixed'&&(!fixedStocks.length||fixedStocks.some(x=>!/^(twse|tpex):[1-9]\d{3}$/.test(x))))throw Error('請先載入股票期貨名單，或輸入固定名單如 twse:2330');
  const poolDate=el('poolDate')?.value||null;
  if(universe==='fixed'&&(!poolDate||poolDate>twToday))throw Error('請填寫有效的名單取得日期');
  return {portfolio:portfolioOptions(),searchLiquidity:true,goal:el('goal')?.value||'balanced',fixedSource:el('fixedSource')?.value||'auto',universe,scoreMode,fixedStocks,poolDate,start,end,warmupStart:day(start,-180),source:el('source')?.value||'official',markets:el('market').value==='all'?['twse','tpex']:[el('market').value],cost,chipLag:1,minTrades,seed,candidates:Number(el('candidates').value)};
}
function expected(o){const out=[];for(let d=o.warmupStart;d<=o.end;d=day(d,1)){const w=new Date(d+'T00:00:00Z').getUTCDay();if(w!==0&&w!==6)for(const market of o.markets)out.push({date:d,market});}return out;}
function status(s,value){el('status').textContent=s;if(value!==undefined)el('progress').value=value;}
function checkStop(){if(stopped)throw Error('已停止。已完成的資料仍可續接；未產生部分樣本的研究結論。');}
function lock(on){busy=on;for(const id of ['check','build','chipsOnly','run','restore','backup','start','end','market','candidates','seed','minTrades','fee','tax','slippage','source','marketImport','universe','scoreMode','fixedStocks','poolDate','loadFutures','fixedSource','researchToken1','researchToken2','researchTokenActive','saveResearchTokens','runPartial','goal','manualRun','loadBest','manualEntryThreshold','manualExitThreshold','manualMaxHold','manualMinVolume','manualMinAvgVolume','manualMinAvgValue','initialCapital','maxPositions','lotSize','loadBenchmark',...C.FEATURES.flatMap(f=>['manualEntry_'+f,'manualExit_'+f])]){if(el(id))el(id).disabled=on;};}
async function api(path,method='GET',body){
  const headers=typeof TWFinMindTokens!=='undefined'?TWFinMindTokens.headers():{};
  if(!headers.Authorization){const legacy=localStorage.getItem('twq_finmind_token_v1')||'';if(legacy)headers.Authorization='Bearer '+legacy}
  if(body)headers['content-type']='application/json';
  const res=await fetch(path,{method,headers,body:body?JSON.stringify(body):undefined,cache:'no-store',signal:requestAbort?AbortSignal.any([requestAbort.signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000)});
  let j;try{j=await res.json();}catch{throw Error('伺服器未回傳 JSON：'+res.status);}
  if(!res.ok||!j.ok){const message=j.error||'HTTP '+res.status;const e=Error((j.market&&j.date?`${j.market.toUpperCase()} ${j.date}：`:'')+message);e.status=res.status;e.code=j.code;e.reason=j.reason;throw e;}return j;
}
async function snapshotState(o,mode){
  const snapshots=[],missing=[],items=expected(o);let requests=0;
  for(let i=0;i<items.length;i++){
    checkStop();const {date,market}=items[i],key=(o.source==='official'?'market:':'market:'+o.source+':')+market+':'+date;
    status(`${mode==='build'?'補齊':'檢查'}歷史全市場 ${i+1}/${items.length}：${date} ${market}`,i/items.length*.5);
    let s=await dbGet(key);
    if(!s&&mode!=='local'&&o.source!=='import'){
      try{s=await api(`/api/research/market-day?date=${date}&market=${market}&source=${o.source}`);}
      catch(e){if(e.status!==404)throw e;if(mode==='build'){s=await api(`/api/research/market-day?date=${date}&market=${market}&source=${o.source}`,'POST');requests++;}}
      if(s)await dbPut(key,s);
    }
    if(s)snapshots.push(s);else missing.push({date,market});
  }
  return {snapshots,missing,requests};
}
function requiredStocks(data,o){
  const ids=new Set();for(const [date,ranks] of data.ranks)if(date>=o.start)for(const id of ranks.keys())ids.add(id);
  return [...ids].sort().map(id=>({id,market:id.split(':')[0],code:id.split(':')[1]}));
}
const covered=(p,o)=>p&&p.coverage_start<=o.warmupStart&&p.coverage_end>=o.end&&p.chips&&p.completeness===100;
async function gather(mode){
  if(busy)return;lock(true);stopped=false;requestAbort=new AbortController();
  let resumePartial=false;const manualRun=mode==='manual';let partial=mode==='partial'||(manualRun&&report?.options.partial);if(partial||manualRun)mode='local';
  try{
    const o=manualRun?JSON.parse(JSON.stringify(report.options)):options();if(manualRun){o.manual=readManual();o.portfolio=portfolioOptions();o.exploratoryRetest=true;o.previousRun=report.chosen?{win:report.chosen.test.win,mean:report.chosen.test.mean,n:report.chosen.test.n}:null;}else delete o.manual;o.partial=partial;if(partial)o.downloadFailure=partialFailure;else partialFailure=null;
    if(partial&&o.universe!=='fixed')throw Error('部分資料計算目前限固定股票池；每日前100仍需完整市場排名，請切換固定池。');
    if(mode==='build'&&o.scoreMode!=='price'&&!confirm('將補齊缺少行情與籌碼。籌碼各資料集獨立保存，每個缺資料股票最多先請求融資、法人、當沖各一次；FinMind 配額或權限錯誤會停止下載並使用現有資料計算。確定開始？'))return;
    const s=o.universe==='fixed'?await fixedState(o,mode):await snapshotState(o,mode);
    if(o.priceIncomplete){partial=true;o.partial=true;}
    if(s.missing.length){el('cache').textContent=`缺 ${s.missing.length} 份歷史市場日資料；必須先補齊，才能知道每日前百名及籌碼需求。`;if(mode==='local')throw Error('本機資料不足；請先按補齊歷史資料');status(o.source==='import'?'匯入資料尚未涵蓋所選期間；請先匯入完整歷史行情 JSON。':'快取檢查完成，請先補齊歷史市場資料。',1);return;}
    const data=C.prepare(s.snapshots,o.markets,o);const ranges=C.split(data.dates,o.start),baseDate=data.dates[data.dates.indexOf(ranges.test[0])-1];
    const benchmark=await benchmarkState(baseDate,ranges.test[1],mode);
    const c=o.scoreMode==='price'?{chips:{},missing:[],stocks:requiredStocks(data,o)}:await chipState(data,o,mode);
    el('cache').textContent=`${data.dates.length} 個市場交易日（含暖機），${o.universe==='fixed'?'固定池':'歷史前百名聯集'} ${c.stocks.length} 檔；缺籌碼快取 ${c.missing.length} 檔。缺漏不以其他股票遞補。`;
    if(partial){
      o.partialInfo={...(o.partialInfo||{}),requestedScoreMode:o.scoreMode,missingChips:c.missing.map(x=>x.id),availableChipStocks:Object.keys(c.chips).length};
      if(o.scoreMode==='full'&&!Object.keys(c.chips).length){o.scoreMode='price';o.partialInfo.fallback='沒有三類籌碼快取，改跑纯價量假說版';}
    }
    if(c.missing.length&&!partial){if(mode==='local')throw Error('籌碼資料不足；請先補齊');status('檢查完成，可按補齊歷史資料。',1);return;}
    if(mode==='build'&&partial)mode='local';
    if(mode!=='local'){status('資料已就緒，現在可執行搜尋。',1);return;}
    status('分數重播與參數搜尋中；本次計算不呼叫上游。',0);report=null;clearReport();
    worker=new Worker('/research-r19-worker.js?r202');
    await new Promise((resolve,reject)=>{
      worker.onmessage=async ({data:m})=>{
        if(m.type==='progress')status(m.text,m.value);
        if(m.type==='error')reject(Error(m.error));
        if(m.type==='done'){try{report=m.report;render(report);try{await dbPut('last-report',report);}catch(e){status('計算完成，但結果快取失敗；請立即匯出研究結果。');}resolve();}catch(e){reject(e);}}
      };
      worker.onerror=e=>reject(Error(e.message||'研究 Worker 啟動失敗'));
      worker.postMessage({snapshots:s.snapshots,chips:c.chips,options:o,benchmark});
      worker.cancel=()=>reject(Error('已停止研究；未產生部分結果。'));
    });
  }catch(e){
    resumePartial=mode==='build'&&!stopped&&(el('universe')?.value==='fixed');
    if(resumePartial)partialFailure=e.message||String(e);
    status(stopped?'已停止。已完成資料可續接，未產生部分研究結果。':(e.message||String(e)));
  }
  finally{if(worker){worker.terminate();worker=null;}lock(false);}
  if(resumePartial)await gather('partial');
}
function clearReport(){el('export').disabled=true;el('summary').textContent='計算中。';for(const id of ['metrics','weights','correlations','controls','shortlist'])el(id).textContent='';}
const fmt=(x,d=3)=>typeof x==='number'&&Number.isFinite(x)?x.toFixed(d):'—';
const table=(id,heads,rows)=>{const t=el(id);t.textContent='';const tr=document.createElement('tr');for(const h of heads){const th=document.createElement('th');th.textContent=h;tr.append(th);}t.append(tr);for(const row of rows){const tr=document.createElement('tr');for(const value of row){const td=document.createElement('td');td.textContent=String(value??'—');tr.append(td);}t.append(tr);}};
function render(r){
  const q=r.chosen,cv=r.coverage;el('export').disabled=false;
  const summary=[`資料覆蓋：${cv.scoredObservations}/${cv.selectedObservations} 個入選股票日有有效分數（${fmt(100*cv.scoredObservations/cv.selectedObservations,1)}%）。`,...Object.entries(r.splits).map(([k,v])=>`${k}：${v.join(' ～ ')}`)];
  if(el('simpleResult'))renderSimple(r);
  if(el('portfolioSummary'))renderPortfolio(r);
  if(r.options.priceDiagnostics?.length)summary.push('行情缺漏：'+r.options.priceDiagnostics.map(d=>d.id+'：'+(d.error||d.state)).join('；'));
  if(r.options.exploratoryRetest)summary.push('手動重測：已看過同一測試期間，這是探索結果，不能視為新的樣本外驗證。');
  if(r.options.partial){
    const p=r.options.partialInfo||{};
    summary.unshift(`部分資料探索結果：原股票池 ${r.options.fixedStocks.length} 檔，已取得行情 ${p.availablePriceStocks||0} 檔；三類籌碼 ${p.availableChipStocks||0} 檔。下載順序與缺漏可能造成選樣偏差。`);
    if(p.fallback)summary.push(p.fallback+'；不是原版 V4.4 驗證。');
    if(p.missingPrice?.length)summary.push('缺行情：'+p.missingPrice.join('、'));
    if(p.missingChips?.length)summary.push('缺可用籌碼組合：'+p.missingChips.join('、'));
    if(r.options.downloadFailure)summary.push('停止下載原因：'+r.options.downloadFailure);
  }
  if(r.options.universe==='fixed')summary.push('固定池行情來源：'+(r.options.fixedSource==='finmind'?'FinMind 個股歷史':'Yahoo／交易所')+'；補齊可能使用配額，重跑搜尋不呼叫上游。');
  if(r.options.scoreMode==='price')summary.push('本次為純價量假說分數，未驗證原版 V4.4；未使用法人／融資／當沖。');
  if(r.options.universe==='fixed')summary.push(`固定池 ${r.options.fixedStocks.length} 檔；名單取得 ${r.options.poolDate}。今日成分回測歷史存在存活者／選樣偏差；日曆使用 0050 交易日代理。`);
  if(r.options.source==='finmind'&&r.options.universe!=='fixed')summary.push('市場別使用 FinMind 轉板日期推估；不等同完整官方 point-in-time 成分檔，需另行核對。');
  if(!q)summary.push('沒有候選同時符合訓練與驗證的最少交易數／完整平倉要求，不提供最佳權重。');
  else{
    const supported=!r.options.exploratoryRetest&&!r.options.partial&&q.test.n>=Math.ceil(r.options.minTrades/2)&&q.test.unresolved===0&&q.ci&&q.ci[0]>0&&cv.scoredObservations/cv.selectedObservations>=.9;
    summary.push(supported?'測試期有正向探索性證據；仍需新的未看過期間驗證。':'目前不足以確認策略有效；不要把搜尋第一名當成可靠最佳解。');
    summary.push(`測試平均每筆淨報酬 ${fmt(q.test.mean)}%；按進場日期以 20 日區塊重抽樣的探索性 95% 區間：${q.ci?q.ci.map(x=>fmt(x)+'%').join(' ～ '):'日期群組不足'}。`);
    const weightLine=(label,w)=>label+'：'+C.FEATURES.map((f,i)=>`${f} ${fmt(w[i]*100,1)}%`).join(' / ');
    el('weights').textContent=[weightLine('進場權重',q.parameters.entry),weightLine('出場權重',q.parameters.exit),`進場 ≥ ${q.parameters.entryThreshold}；出場 ≥ ${q.parameters.exitThreshold}；最長持有 ${q.parameters.maxHold===0?"不限制":q.parameters.maxHold+" 日"}。`,`分數＝50＋Σ[w×中心化特徵]/Σ|w|；絕對分數減 50，日變化×2.5 後限制於 ±50。權重可為負，百分比按絕對值總和歸一。`].join('\n');
  }
  el('summary').textContent=summary.join('\n');
  const metrics=q?[['訓練',q.train],['驗證',q.validation],['最終測試',q.test],['固定基準（測試）',r.baseline]]:[['固定基準（測試）',r.baseline]];
  table('metrics',['期間','交易數','平均淨報酬 %','勝率 %','下檔 RMS %','未成交嘗試','未平倉','最後可進場訊號日'],metrics.map(([k,v])=>[k,v.n,fmt(v.mean),fmt(v.win,1),fmt(v.downside),v.unfilled,v.unresolved,v.entrySignalEnd]));
  table('correlations',['特徵','h','Train IC','Validation IC','Test IC','Test Q5−Q1 pp','Test 日期數','Test 樣本数'],r.correlations.map(x=>[x.feature,x.h,fmt(x.train.ic),fmt(x.validation.ic),fmt(x.test.ic),fmt(x.test.spread),x.test.days,x.test.n]));
  table('controls',['特徵','Train β / SD','Test MSE 改善 %','Test N'],r.controls.map(x=>[x.feature,fmt(x.beta),fmt(x.mseGain),x.n]));
  table('shortlist',['候選','Train N','Train 平均 %','Validation N','Validation 平均 %','Validation 目標值','選中'],r.candidates.map(x=>[x.parameters.id,x.train.n,fmt(x.train.mean),x.validation.n,fmt(x.validation.mean),fmt(x.validation.objective),q?.parameters.id===x.parameters.id?'✓':'']));
  status('研究完成。重新搜尋不消耗 FinMind API 配額；結果不會自動套用到正式策略。',1);
}
function download(name,value){const blob=new Blob([JSON.stringify(value)],{type:'application/json'}),a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
if(el('runPartial'))el('runPartial').onclick=()=>gather('partial');
el('check').onclick=()=>gather('check');el('build').onclick=()=>gather('build');el('run').onclick=()=>gather('local');
el('stop').onclick=()=>{stopped=true;requestAbort?.abort();if(worker){worker.cancel();worker.terminate();}status('已要求停止，正在保留已完成的資料。');};
el('export').onclick=()=>{if(report)download('research-r19-results.json',report);};
el('backup').onclick=async()=>{try{download('research-r19-data-backup.json',{version:19,records:await dbAll()});}catch(e){status(e.message);}};
el('restore').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;lock(true);
  try{
    const b=JSON.parse(await file.text());if(b.version!==19||!Array.isArray(b.records))throw Error('不是 R19 備份');
    for(const [k,v] of b.records){
      if(typeof k!=='string'||!v)throw Error('無效備份記錄');
      if(k.startsWith('market:')){if(![`market:${v.market}:${v.date}`,`market:finmind:${v.market}:${v.date}`,`market:import:${v.market}:${v.date}`].includes(k)||!v.ok||!Array.isArray(v.rows)||v.rows.some(x=>x.date!==v.date||x.market!==v.market)||(!v.closed&&v.rows.length<100))throw Error('市場備份驗證失敗');}
      else if(k.startsWith('chips:')){if(!v.chips||!v.coverage_start||!v.coverage_end)throw Error('籌碼備份驗證失敗');}
      else if(k.startsWith('benchmark1910:')){if(!Array.isArray(v.data)||v.symbol!=='TAIEX')throw Error('大盤備份驗證失敗');}
      else if(k.startsWith('priceStatus198:')){if(v.error!==null&&typeof v.error!=='string')throw Error('行情狀態備份驗證失敗');}
      else if(k.startsWith('pieceStatus196:')){if(typeof v.state!=='string')throw Error('籌碼狀態備份驗證失敗');}
      else if(k.startsWith('piece196:')){if(!Array.isArray(v.data)||!['margin','inst','daytrade'].includes(v.kind))throw Error('籌碼分項備份驗證失敗');}
      else if((k.startsWith('price192:')||k.startsWith('price193:finmind:'))){if(!Array.isArray(v.data)||!v.data.length)throw Error('價量備份驗證失敗');}
      else if(k!=='last-report')throw Error('未知備份類型');
    }
    for(const [k,v] of b.records)await dbPut(k,v);status(`已還原 ${b.records.length} 筆快取。`);
  }catch(e){status('還原失敗：'+e.message);}finally{lock(false);}
};

if(el('marketImport'))el('marketImport').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;lock(true);
  try{
    const rows=ResearchImportR191.normalizeImport(JSON.parse(await file.text()));
    for(const s of rows)await dbPut(`market:import:${s.market}:${s.date}`,s);
    el('source').value='import';status(`已匯入 ${rows.length} 份完整歷史市場資料，來源已切換為匯入資料。請檢查快取。`);
  }catch(e){status('匯入失敗：'+e.message);}finally{lock(false);}
};

// Range-specific persistent browser cache; local research never calls providers.
async function fixedState(o,mode){
  o.markets=[...new Set(o.fixedStocks.map(x=>x.split(':')[0]))];
  const histories=new Map(),missing=[];o.priceDiagnostics=[];
  for(const id of ['twse:0050',...o.fixedStocks]){
    checkStop();const key=`${o.fixedSource==='finmind'?'price193:finmind':'price192'}:${id}:${o.warmupStart}:${o.end}`;
    let p=await dbGet(key);const prior=await dbGet('priceStatus198:'+key);let failure=prior?.error||null;status(`固定池行情 ${histories.size}/${o.fixedStocks.length+1}：${id}`);
    if(!p&&mode!=='local'){
      try{
      const [market,code]=id.split(':');
      const path=`/api/research/stock-history?code=${code}&market=${market}&start_date=${o.warmupStart}&end_date=${o.end}&source=${o.fixedSource||'auto'}`;
      try{p=await api(path);}catch(e){if(e.status!==404)throw Error(id+'：'+e.message);}
      if(!p&&mode==='build'){
        el('cache').textContent=`正在下載 ${id}；已讀取 ${histories.size} 檔。來源 ${o.fixedSource==='finmind'?'FinMind 個股':'Yahoo／交易所'}。`;
        try{p=await api(path,'POST');}catch(e){throw Error(id+'：'+e.message);}
      }
      if(p){
      if(!Array.isArray(p.data)||!p.data.length)throw Error(id+' 無歷史行情；停止而非靜默排除');
      await dbPut(key,p);failure=null;await dbPut('priceStatus198:'+key,{error:null});
      }
      }catch(e){
        if(stopped)throw e;
        failure=e.message;await dbPut('priceStatus198:'+key,{error:failure});
        if(mode!=='build'||!/驗證失敗|欄位缺漏|格式錯誤/.test(failure))throw e;
      }
    }
    if(!p)o.priceDiagnostics.push({id,state:failure?'資料驗證或來源失敗':'尚未下載',error:failure});
    if(p)histories.set(id,p.data);else missing.push(id);
  }
  if(missing.length&&mode==='build'){o.partial=true;o.priceIncomplete=true;}
  if(missing.length&&!o.partial){el('cache').textContent=`缺 ${missing.length} 檔固定池行情`;throw Error('固定池資料不足；請按補齊歷史資料。');}
  if(!histories.has('twse:0050'))throw Error('缺少 0050 日曆代理，無法確定下一交易日；已保存資料，但尚不能產生可信回測。');
  if(o.partial){o.partialInfo={missingPrice:missing.filter(x=>x!=='twse:0050'),availablePriceStocks:o.fixedStocks.filter(id=>histories.has(id)).length};if(!o.partialInfo.availablePriceStocks)throw Error('尚無可用股票行情；保留現有快取，至少補齊一檔後才能計算。');}
  const dates=histories.get('twse:0050').filter(r=>r.date>=o.warmupStart&&r.date<=o.end&&C.validBar(r)).map(r=>r.date);
  if(new Set(dates).size!==dates.length)throw Error('日曆代理有重複日期');
  const snapshots=dates.sort().flatMap(date=>o.markets.map(market=>({ok:true,date,market,source:o.fixedSource==='finmind'?'FinMind TaiwanStockPrice individual':'fixed-history-auto',rows:[]})));
  const map=new Map(snapshots.map(s=>[s.market+':'+s.date,s]));
  for(const id of o.fixedStocks){const [market,code]=id.split(':'),seen=new Set();
    for(const r of histories.get(id)||[]){
      if(seen.has(r.date))throw Error(id+' 有重複日期');seen.add(r.date);
      const s=map.get(market+':'+r.date);if(s)s.rows.push({...r,market,code});
    }
  }
  return {snapshots,missing:[]};
}
if(el('loadFutures'))el('loadFutures').onclick=async()=>{
  if(busy)return;lock(true);requestAbort=new AbortController();stopped=false;
  try{
    const f=await api('/api/futures/stock-list'),u=await api('/api/market/universe');
    const lookup=new Map(u.data.map(x=>[x.code,x.market]));
    const codes=[...new Set(f.codes.filter(c=>/^[1-9]\d{3}$/.test(c)))];
    if(codes.length<30||codes.some(c=>!lookup.has(c)))throw Error('期貨標的名單或市場分類不完整，請手動輸入並核對；不自動排除未知股票');
    el('fixedStocks').value=codes.map(c=>lookup.get(c)+':'+c).sort().join(' ');
    el('poolDate').value=twToday;el('universe').value='fixed';savePool();
    status(`已載入 ${codes.length} 檔目前股票期貨標的供檢視；請匯出研究結果保存凍結名單。這是股票現貨回測。`);
  }catch(e){status(e.message);}finally{lock(false);}
};
const poolFields=['universe','scoreMode','fixedStocks','poolDate','fixedSource'];
try{const saved=JSON.parse(localStorage.getItem('twq_research192_pool')||'null');if(saved)for(const k of poolFields)if(el(k)&&typeof saved[k]==='string')el(k).value=saved[k];}catch{}
function savePool(){try{localStorage.setItem('twq_research192_pool',JSON.stringify(Object.fromEntries(poolFields.map(k=>[k,el(k)?.value||'']))));}catch{status('名單設定儲存失敗，請另存名單。');}}
for(const k of poolFields)if(el(k))el(k).onchange=savePool;

if(el('researchToken1')&&typeof TWFinMindTokens!=='undefined')TWFinMindTokens.bind({one:'researchToken1',two:'researchToken2',active:'researchTokenActive',save:'saveResearchTokens',clear:'unusedResearchTokenClear',onChange:async()=>status('兩組 Token 已儲存在此瀏覽器；研究請求將使用目前選定的一組。Token 不會包含在資料備份或結果匯出。')});

async function chipState(data,o,mode){
  const stocks=o.chipsOnly?o.fixedStocks.map(id=>({id,market:id.split(':')[0],code:id.split(':')[1]})):requiredStocks(data,o),chips={},missing=[],diagnostics=[];
  const names={margin:'融資',inst:'法人',daytrade:'當沖'};
  let blocked=null,sourceFailures=0;
  for(const x of stocks){
    checkStop();
    if(data.series&&!data.series.get(x.id)?.length){missing.push(x);for(const kind of Object.values(names))diagnostics.push({id:x.id,kind,state:'缺行情，暫不下載籌碼'});continue;}
    const old=await dbGet('chips:'+x.id);
    if(covered(old,o)){chips[x.id]=old.chips;diagnostics.push({id:x.id,kind:'舊快取',state:'三類資料可用（非逐日100%）'});continue;}
    const cc={};
    for(const kind of Object.keys(names)){
      const key=`piece196:${x.id}:${kind}:${o.warmupStart}:${o.end}`;
      const priorState=await dbGet('pieceStatus196:'+key);
      let p=await dbGet(key),reason=p?.data?.length?'已取得':priorState?.state||'尚未下載';
      if((!p||(!p.data.length&&mode==='build'))&&mode!=='local'&&!blocked){
        const path=`/api/research/chip-piece?code=${x.code}&market=${x.market}&kind=${kind}&start_date=${o.warmupStart}&end_date=${o.end}`;
        try{
          try{p=await api(path);}catch(e){if(e.status!==404)throw e;}
          if(!p&&mode==='build')p=await api(path,'POST');
          if(p){await dbPut(key,p);await dbPut('pieceStatus196:'+key,{kind,state:p.data.length?'已取得':'來源回覆無資料'});}
        }catch(e){
          reason=({quota:'配額／方案限制',auth:'Token／權限不足',invalid_data:'欄位或日期錯誤',source_error:'來源失敗'})[e.reason]||e.message;
          await dbPut('pieceStatus196:'+key,{kind,state:reason});
          if(e.status===429||[401,403].includes(e.status)||e.reason==='quota'||e.reason==='auth')blocked=reason;
          else if((e.reason==='source_error'||!e.reason)&&++sourceFailures>=3)blocked='來源累計三次失敗，停止下載並保留資料';
        }
      }
      if(p){cc[kind]=p.data;reason=p.data.length?'已取得':'來源回覆無資料';}
      const dates=new Set((p?.data||[]).map(r=>r.date));
      const available=data.dates.filter(d=>dates.has(d)).length;
      diagnostics.push({id:x.id,kind:names[kind],state:reason,rows:p?.data?.length||0,availableDays:available,expectedDays:data.dates.length,first:p?.data?.[0]?.date||null,last:p?.data?.at(-1)?.date||null});
    }
    if(Object.keys(names).every(k=>cc[k]?.length))chips[x.id]=cc;else missing.push(x);
    status(`籌碼：${diagnostics.filter(d=>d.kind==='當沖'||d.kind==='舊快取').length}/${stocks.length} 檔；三類可用 ${Object.keys(chips).length} 檔${blocked?'；'+blocked+'，只讀剩餘快取':''}`);
  }
  o.chipDiagnostics=diagnostics;
  if(el('chipDiagnostics'))table('chipDiagnostics',['股票','類別','狀態','有資料日／行情日','首日','末日'],diagnostics.map(d=>[d.id,d.kind,d.state,d.expectedDays?`${d.availableDays}/${d.expectedDays}`:'—',d.first,d.last]));
  if(mode==='build'&&missing.length)throw Error(`籌碼已分項保存：三類可用 ${Object.keys(chips).length}/${stocks.length} 檔；${blocked||'其他股票有未取得或空資料'}。${o.chipsOnly?'請查看籌碼取得狀態；再次按只補籌碼可續接。':'自動以現有資料計算。'}`);
  return {chips,missing,stocks};
}
function readManual(){
  const number=id=>{const v=el(id).value;if(!v.trim())throw Error('設定不能留白');return Number(v);};
  return C.manualParameters({entry:C.FEATURES.map(f=>number('manualEntry_'+f)),exit:C.FEATURES.map(f=>number('manualExit_'+f)),entryThreshold:number('manualEntryThreshold'),exitThreshold:number('manualExitThreshold'),maxHold:number('manualMaxHold'),minVolumeLots:el('manualMinVolume')?number('manualMinVolume'):0,minAvgVolumeLots20:el('manualMinAvgVolume')?number('manualMinAvgVolume'):0,minAvgValue20:el('manualMinAvgValue')?number('manualMinAvgValue')*10000:0});
}
function fillManual(p){
  for(const [i,f] of C.FEATURES.entries()){el('manualEntry_'+f).value=String(p.entry[i]*100);el('manualExit_'+f).value=String(p.exit[i]*100);}
  el('manualEntryThreshold').value=p.entryThreshold;el('manualExitThreshold').value=p.exitThreshold;el('manualMaxHold').value=p.maxHold;
  if(el('manualMinVolume')){el('manualMinVolume').value=p.minVolumeLots||0;el('manualMinAvgVolume').value=p.minAvgVolumeLots20||0;el('manualMinAvgValue').value=(p.minAvgValue20||0)/10000;}
}
function renderSimple(r){
  const q=r.chosen;
  if(el('winCard')){el('winCard').textContent=q?fmt(q.test.win,1)+'%':'—';el('profitCard').textContent=q?fmt(q.test.mean)+'%':'—';el('countCard').textContent=q?String(q.test.n):'0';}
  el('manualRun').disabled=!q;el('loadBest').disabled=!q;
  if(!q){el('simpleResult').textContent='目前没有設定通過最低交易數與完整平倉條件，不能提供最高勝率設定。可先補資料或擴大期間。';return;}
  const title=r.options.manual?'你輸入的設定（探索重測）':r.options.goal==='equal'?'本次候選中，驗證期每檔等額投資報酬最高的設定':r.options.goal==='winrate'?'本次候選中，通過訓練門檻後驗證期勝率最高的設定':'本次報酬與風險目標選出的設定';
  el('simpleResult').textContent=[title,`驗證期：勝率 ${fmt(q.validation.win,1)}%，${q.validation.n} 筆交易。`,`測試期：勝率 ${fmt(q.test.win,1)}%，${q.test.n} 筆交易；平均每筆扣成本 ${fmt(q.test.mean)}%。`,r.options.previousRun?`上次 → 這次：測試勝率 ${fmt(r.options.previousRun.win,1)}% → ${fmt(q.test.win,1)}%；平均淨報酬 ${fmt(r.options.previousRun.mean)}% → ${fmt(q.test.mean)}%。`:'',q.test.unresolved?`尚有 ${q.test.unresolved} 筆未平倉，不能用已平倉勝率代表完整結果。`:q.test.n<Math.max(10,Math.ceil(r.options.minTrades/2))?'測試交易筆數不足，勝率僅供描述。':q.test.mean>0?'測試平均淨報酬為正，仍要留意資料覆蓋率與樣本數。':'測試平均淨報酬未為正或無法判定；高勝率不代表賺錢。',`最低進場量：訊號日 ${q.parameters.minVolumeLots||0} 張；前20日均量 ${q.parameters.minAvgVolumeLots20||0} 張；前20日平均估算成交金額 ${fmt((q.parameters.minAvgValue20||0)/10000,0)} 萬元（0＝不限制）。賣出不受這些門檻限制。`,r.withoutLiquidity?`量能篩選比較（同一設定，僅移除量門檻）：無門檻胜率 ${fmt(r.withoutLiquidity.win,1)}%、${r.withoutLiquidity.n} 筆、每筆 ${fmt(r.withoutLiquidity.mean)}%；有門檻勝率 ${fmt(q.test.win,1)}%、${q.test.n} 筆、每筆 ${fmt(q.test.mean)}%。擋下 ${q.test.liquidityBlocked||0} 次進場訊號。`:'',`進場分數至少 ${q.parameters.entryThreshold}；出場分數至少 ${q.parameters.exitThreshold}；最多持有 ${q.parameters.maxHold===0?"不限制":q.parameters.maxHold+" 個交易日"}。`,r.options.partial?'這是部分資料結果，不代表完整股票池。':'',r.options.manual?'反覆看同一測試期再調整，不能當成新的樣本外驗證。':'可按「帶入本次設定」，修改下方權重與門檻後重測。'].filter(Boolean).join('\n');
  if(!r.options.manual)fillManual(q.parameters);
}
if(el('manualWeights')){
  const labels=['Setup','Opportunity','Entry','Hold','Setup 日變化','Opportunity 日變化','Entry 日變化','Hold 日變化'];
  for(const [i,f] of C.FEATURES.entries()){
    const tr=document.createElement('tr'),name=document.createElement('td');name.textContent=labels[i];tr.append(name);
    for(const side of ['Entry','Exit']){const td=document.createElement('td'),input=document.createElement('input');input.type='number';input.step='any';input.min='-100';input.max='100';input.id='manual'+side+'_'+f;input.value='0';input.setAttribute('aria-label',labels[i]+(side==='Entry'?'進場':'出場')+'權重');td.append(input);tr.append(td);}el('manualWeights').append(tr);
  }
  el('loadBest').onclick=()=>{if(report?.chosen)fillManual(report.chosen.parameters);};
  el('manualRun').onclick=()=>{if(!report||busy)return;try{readManual();gather('manual');}catch(e){status(e.message);}};
}

function portfolioOptions(){
 const initial=Number(el('initialCapital')?.value||1000000),maxPositions=Number(el('maxPositions')?.value||5),lotSize=Number(el('lotSize')?.value||1000);
 if(!Number.isFinite(initial)||initial<=0||initial>1e12||!Number.isInteger(maxPositions)||maxPositions<1||maxPositions>100||![1,1000].includes(lotSize))throw Error('請設定有效資金、持倉上限及股數單位');
 return {initial,maxPositions,lotSize};
}
function renderPortfolio(r){
 const p=r.portfolio,money=x=>Number.isFinite(x)?Math.round(x).toLocaleString('zh-TW'):'—';
 const labels={accountROI:p?fmt(p.roi,2)+'%':'—',accountProfit:p?'NT$ '+money(p.netProfit):'—',accountDD:p?'-'+fmt(p.maxDrawdown,2)+'%':'—',accountWin:p?fmt(p.win,1)+'%':'—',accountPayoff:p?fmt(p.payoffRatio,2):'—',accountTrades:p?String(p.n):'0'};
 for(const [id,text] of Object.entries(labels))el(id).textContent=text;
 if(!p){el('portfolioSummary').textContent='尚無可模擬的選中設定。';el('equityChart').textContent='';el('monthly').textContent='';el('accountTradesTable').textContent='';return;}
 el('portfolioSummary').textContent=[`測試期間：${p.range.join(' ～ ')}；本次實際分數版本：${r.options.scoreMode==='price'?'純價量（不是原版籌碼分數）':'原版 V4.4'}。`, `初始資金 NT$ ${money(p.initial)} → 期末淨值 NT$ ${money(p.finalEquity)}；最大持倉成本 NT$ ${money(p.maxInvested)}。`,`已平倉 ${p.n} 筆：賺錢 ${p.wins}、虧損 ${p.losses}、損益兩平 ${p.breakeven}。最大回撤金額 NT$ ${money(p.maxDrawdownMoney)}。`,`因持倉上限略過 ${p.skippedSlots} 次、資金／股數單位不足略過 ${p.skippedFunds} 次；未平倉 ${p.unresolved} 檔。`,p.staleMarks?`缺收盤價時沿用最後價格估值共 ${p.staleMarks} 個持倉日，回撤可能低估。`:'',r.options.partial?'這是部分資料的帳戶模擬，不能當作完整股票池驗證。':''].filter(Boolean).join('\n');
 const b=r.benchmark;
 if(el('benchmarkSummary')){el('benchmarkSummary').textContent=b?.ok?`策略 ${fmt(p.roi,2)}% ／ 大盤 ${fmt(b.roi,2)}%；${b.excessReturn>=0?'跑贏':'落後'}大盤 ${fmt(Math.abs(b.excessReturn),2)} 個百分點。策略最大回撤 ${fmt(p.maxDrawdown,2)}% ／ 大盤 ${fmt(b.maxDrawdown,2)}%。`:'尚不能比較：'+(b?.error||'請補齊大盤資料');}
 const values=p.curve.map(x=>x.roi),bv=b?.ok?b.curve.map(x=>x.roi):[],all=[...values,...bv],lo=Math.min(0,...all),hi=Math.max(0,...all),span=hi-lo||1;
 const point=(x,i)=>`${40+700*i/Math.max(1,values.length-1)},${220-180*(x-lo)/span}`;
 const zero=220-180*(0-lo)/span;
 el('equityChart').innerHTML=`<svg viewBox="0 0 780 270" role="img" aria-label="測試期帳戶報酬率曲線" style="width:100%;height:auto"><line x1="40" y1="${zero}" x2="740" y2="${zero}" stroke="#667085"/><polyline points="${values.map(point).join(' ')}" fill="none" stroke="#22d3ee" stroke-width="3"/>${b?.ok?`<polyline points="${bv.map(point).join(' ')}" fill="none" stroke="#fb923c" stroke-width="3"/>`:''}<text x="5" y="28" fill="#e7edf7">${fmt(hi,1)}%</text><text x="5" y="240" fill="#e7edf7">${fmt(lo,1)}%</text><text x="40" y="263" fill="#e7edf7">${p.range[0]}</text><text x="625" y="263" fill="#e7edf7">${p.range[1]}</text></svg>`;
 table('monthly',['月份','策略月報酬','大盤月報酬','差距（百分點）','淨值變動 NT$'],p.monthly.map(m=>{const bm=b?.ok?b.monthly.find(x=>x.month===m.month):null;return [m.month,fmt(m.returnPct,2)+'%',bm?fmt(bm.returnPct,2)+'%':'—',bm?fmt(m.returnPct-bm.returnPct,2):'—',money(m.pnl)]}));
 table('accountTradesTable',['股票','買入日','賣出日','股數','買入成交價','賣出成交價','淨損益 NT$','淨報酬','原因'],p.trades.map(t=>[t.id,t.entryDate,t.exitDate,t.shares,fmt(t.buyPrice,2),fmt(t.sellPrice,2),money(t.pnl),fmt(t.net,2)+'%',t.reason==='maxHold'?'持有到期':'出場分數']));
}

async function benchmarkState(start,end,mode){
 const key=`benchmark1910:${start}:${end}`;let p=await dbGet(key);if(p||mode==='local')return p;
 try{const path=`/api/research/benchmark?start_date=${start}&end_date=${end}`;try{p=await api(path);}catch(e){if(e.status!==404)throw e;}if(!p&&mode==='build')p=await api(path,'POST');if(p)await dbPut(key,p);}catch(e){if(stopped)throw e;status('大盤暫不可用：'+e.message+'；其他研究可繼續。');return {ok:false,error:e.message};}return p;
}
if(el('loadBenchmark'))el('loadBenchmark').onclick=async()=>{
 if(busy)return;if(!report?.portfolio||!report.benchmarkBaseDate){status('請先執行一次研究，才能取得同期間的大盤比較。');return;}
 lock(true);stopped=false;requestAbort=new AbortController();
 try{const p=await benchmarkState(report.benchmarkBaseDate,report.portfolio.range[1],'build');report.benchmark=ResearchPortfolio.benchmark(report.portfolio,p?.data,report.benchmarkBaseDate);if(p?.error)report.benchmark.error=p.error;if(p?.source)report.benchmark.source=p.source;renderPortfolio(report);await dbPut('last-report',report);status(report.benchmark.ok?'大盤比較已更新；没有重新搜尋策略，也沒有使用 FinMind。':report.benchmark.error);}catch(e){status(e.message);}finally{lock(false);}
};

async function downloadChipsOnly(){
  if(busy)return;
  lock(true);stopped=false;requestAbort=new AbortController();
  try{
    const o=options();
    if(o.universe!=='fixed')throw Error('只補籌碼請先選固定股票池並載入名單。');
    o.chipsOnly=true;
    el('cache').textContent='只補 FinMind 融資、法人、當沖；不下載行情或 0050 日曆。';
    const c=await chipState({dates:[]},o,'build');
    status('籌碼下載完成：三類可用 '+Object.keys(c.chips).length+'/'+c.stocks.length+' 檔。回測仍需行情與交易日日曆。',1);
  }catch(e){status(stopped?'已停止籌碼下載，成功資料已保存，可再次按只補籌碼續接。':e.message);}
  finally{lock(false);}
}
if(el('chipsOnly'))el('chipsOnly').onclick=downloadChipsOnly;

const oldRenderSimple=renderSimple;
renderSimple=function(r){
 oldRenderSimple(r);
 if(el('primaryMetricLabel'))el('primaryMetricLabel').textContent=r.options.goal==='equal'?'測試期等額總報酬':'訊號交易勝率';
 if(el('secondaryMetricLabel'))el('secondaryMetricLabel').textContent=r.options.goal==='equal'?'領先／落後大盤':'每筆平均淨報酬';
 if(r.options.goal!=='equal')return;
 const q=r.chosen;
 if(el('winCard'))el('winCard').textContent=fmt(r.portfolio?.roi)+'%';
 if(el('profitCard'))el('profitCard').textContent=r.benchmark?.ok?fmt(r.benchmark.excessReturn)+' 個百分點':'大盤資料待補';
 if(el('countCard'))el('countCard').textContent=String(r.portfolio?.n||0);
 el('simpleResult').textContent=(q?'等額投資：驗證期報酬 '+fmt(q.validation.equalReturn)+'%；測試期報酬 '+fmt(r.portfolio?.roi)+'%；測試回撤 '+fmt(r.portfolio?.maxDrawdown)+'%。\n':'')+
 '每檔獨立10萬元，獲利留在原股票再投入；理論可分割股數，沒有整張限制。未交易股票保留現金。\n'+
 (r.options.partial?'注意：資料不完整，缺資料股票暫列現金；此結果僅供探索，不能代表完整股票池策略。\n':'')+el('simpleResult').textContent;
};
