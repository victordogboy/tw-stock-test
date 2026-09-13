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
  if((Date.parse(end)-Date.parse(start))/86400000>1100)throw Error('單次請限制在 1100 個日曆日內，可分期研究');
  const cost={};for(const k of ['fee','tax','slippage']){const n=Number(el(k).value);if(!el(k).value||!Number.isFinite(n)||n<0||n>2)throw Error('成本須介於 0% 與 2%');cost[k]=n/100;}
  const minTrades=Number(el('minTrades').value),seed=Number(el('seed').value);if(!Number.isInteger(minTrades)||minTrades<20||!Number.isFinite(seed))throw Error('最少成交筆數至少 20，種子必須是數字');
  const universe=el('universe')?.value||'top100',scoreMode=el('scoreMode')?.value||'full';
  const fixedStocks=[...new Set((el('fixedStocks')?.value||'').trim().split(/[,，\s]+/).filter(Boolean))].sort();
  if(universe==='fixed'&&(!fixedStocks.length||fixedStocks.some(x=>!/^(twse|tpex):[1-9]\d{3}$/.test(x))))throw Error('請先載入股票期貨名單，或輸入固定名單如 twse:2330');
  const poolDate=el('poolDate')?.value||null;
  if(universe==='fixed'&&(!poolDate||poolDate>twToday))throw Error('請填寫有效的名單取得日期');
  return {fixedSource:el('fixedSource')?.value||'auto',universe,scoreMode,fixedStocks,poolDate,start,end,warmupStart:day(start,-180),source:el('source')?.value||'official',markets:el('market').value==='all'?['twse','tpex']:[el('market').value],cost,chipLag:1,minTrades,seed,candidates:Number(el('candidates').value)};
}
function expected(o){const out=[];for(let d=o.warmupStart;d<=o.end;d=day(d,1)){const w=new Date(d+'T00:00:00Z').getUTCDay();if(w!==0&&w!==6)for(const market of o.markets)out.push({date:d,market});}return out;}
function status(s,value){el('status').textContent=s;if(value!==undefined)el('progress').value=value;}
function checkStop(){if(stopped)throw Error('已停止。已完成的資料仍可續接；未產生部分樣本的研究結論。');}
function lock(on){busy=on;for(const id of ['check','build','run','restore','backup','start','end','market','candidates','seed','minTrades','fee','tax','slippage','source','marketImport','universe','scoreMode','fixedStocks','poolDate','loadFutures','fixedSource','researchToken','saveResearchToken','runPartial']){if(el(id))el(id).disabled=on;};}
async function api(path,method='GET',body){
  const token=localStorage.getItem('twq_finmind_token_v1')||'',headers={};if(token)headers.Authorization='Bearer '+token;if(body)headers['content-type']='application/json';
  const res=await fetch(path,{method,headers,body:body?JSON.stringify(body):undefined,cache:'no-store',signal:requestAbort?AbortSignal.any([requestAbort.signal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000)});
  let j;try{j=await res.json();}catch{throw Error('伺服器未回傳 JSON：'+res.status);}
  if(!res.ok||!j.ok){const message=j.error||'HTTP '+res.status;const e=Error((j.market&&j.date?`${j.market.toUpperCase()} ${j.date}：`:'')+message);e.status=res.status;e.code=j.code;throw e;}return j;
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
async function chipState(data,o,mode){
  const stocks=requiredStocks(data,o),chips={},missing=[];
  for(let i=0;i<stocks.length;i++){
    checkStop();const x=stocks[i],key='chips:'+x.id;status(`${mode==='build'?'補齊':'檢查'}籌碼 ${i+1}/${stocks.length}：${x.code}`, .5+.5*i/stocks.length);
    let p=await dbGet(key);
    const path=`/api/research/cache/load?code=${x.code}&market=${x.market}&start_date=${o.warmupStart}&end_date=${o.end}`;
    if(!covered(p,o)&&mode!=='local'){
      try{p=await api(path);}catch(e){if(![404,409].includes(e.status))throw e;p=null;}
      if(!covered(p,o)&&mode==='build'){
        await api('/api/research/cache/build','POST',{code:x.code,market:x.market,start_date:o.warmupStart,end_date:o.end});p=await api(path);
      }
      if(covered(p,o))await dbPut(key,p);
    }
    if(covered(p,o))chips[x.id]=p.chips;else missing.push(x);
  }
  return {chips,missing,stocks};
}
async function gather(mode){
  if(busy)return;lock(true);stopped=false;requestAbort=new AbortController();
  let resumePartial=false;const partial=mode==='partial';if(partial)mode='local';
  try{
    const o=options();o.partial=partial;if(partial)o.downloadFailure=partialFailure;else partialFailure=null;
    if(partial&&o.universe!=='fixed')throw Error('部分資料計算目前限固定股票池；每日前100仍需完整市場排名，請切換固定池。');
    if(mode==='build'&&o.scoreMode!=='price'&&!confirm(`將補齊歷史行情及籌碼。${o.source==='finmind'?'FinMind 全市場行情需要 backer／sponsor 權限，每個缺少的日期可能增加一個全市場請求，另有分類／交易日查詢。':'官方或匯入行情不使用 FinMind。'}缺少的籌碼每檔可能另需 3–4 次以上請求。確定開始？`))return;
    const s=o.universe==='fixed'?await fixedState(o,mode):await snapshotState(o,mode);
    if(s.missing.length){el('cache').textContent=`缺 ${s.missing.length} 份歷史市場日資料；必須先補齊，才能知道每日前百名及籌碼需求。`;if(mode==='local')throw Error('本機資料不足；請先按補齊歷史資料');status(o.source==='import'?'匯入資料尚未涵蓋所選期間；請先匯入完整歷史行情 JSON。':'快取檢查完成，請先補齊歷史市場資料。',1);return;}
    const data=C.prepare(s.snapshots,o.markets,o);C.split(data.dates,o.start);
    const c=o.scoreMode==='price'?{chips:{},missing:[],stocks:requiredStocks(data,o)}:await chipState(data,o,mode);
    el('cache').textContent=`${data.dates.length} 個市場交易日（含暖機），${o.universe==='fixed'?'固定池':'歷史前百名聯集'} ${c.stocks.length} 檔；缺籌碼快取 ${c.missing.length} 檔。缺漏不以其他股票遞補。`;
    if(partial){
      o.partialInfo={...(o.partialInfo||{}),requestedScoreMode:o.scoreMode,missingChips:c.missing.map(x=>x.id),availableChipStocks:Object.keys(c.chips).length};
      if(o.scoreMode==='full'&&!Object.keys(c.chips).length){o.scoreMode='price';o.partialInfo.fallback='沒有完整籌碼快取，改跑纯價量假說版';}
    }
    if(c.missing.length&&!partial){if(mode==='local')throw Error('籌碼資料不足；請先補齊');status('檢查完成，可按補齊歷史資料。',1);return;}
    if(mode!=='local'){status('資料已就緒，現在可執行搜尋。',1);return;}
    status('分數重播與參數搜尋中；本次計算不呼叫上游。',0);report=null;clearReport();
    worker=new Worker('/research-r19-worker.js?r195');
    await new Promise((resolve,reject)=>{
      worker.onmessage=async ({data:m})=>{
        if(m.type==='progress')status(m.text,m.value);
        if(m.type==='error')reject(Error(m.error));
        if(m.type==='done'){try{report=m.report;render(report);try{await dbPut('last-report',report);}catch(e){status('計算完成，但結果快取失敗；請立即匯出研究結果。');}resolve();}catch(e){reject(e);}}
      };
      worker.onerror=e=>reject(Error(e.message||'研究 Worker 啟動失敗'));
      worker.postMessage({snapshots:s.snapshots,chips:c.chips,options:o});
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
  if(r.options.partial){
    const p=r.options.partialInfo||{};
    summary.unshift(`部分資料探索結果：原股票池 ${r.options.fixedStocks.length} 檔，已取得行情 ${p.availablePriceStocks||0} 檔；完整籌碼 ${p.availableChipStocks||0} 檔。下載順序與缺漏可能造成選樣偏差。`);
    if(p.fallback)summary.push(p.fallback+'；不是原版 V4.4 驗證。');
    if(p.missingPrice?.length)summary.push('缺行情：'+p.missingPrice.join('、'));
    if(p.missingChips?.length)summary.push('缺完整籌碼：'+p.missingChips.join('、'));
    if(r.options.downloadFailure)summary.push('停止下載原因：'+r.options.downloadFailure);
  }
  if(r.options.universe==='fixed')summary.push('固定池行情來源：'+(r.options.fixedSource==='finmind'?'FinMind 個股歷史':'Yahoo／交易所')+'；補齊可能使用配額，重跑搜尋不呼叫上游。');
  if(r.options.scoreMode==='price')summary.push('本次為純價量假說分數，未驗證原版 V4.4；未使用法人／融資／當沖。');
  if(r.options.universe==='fixed')summary.push(`固定池 ${r.options.fixedStocks.length} 檔；名單取得 ${r.options.poolDate}。今日成分回測歷史存在存活者／選樣偏差；日曆使用 0050 交易日代理。`);
  if(r.options.source==='finmind'&&r.options.universe!=='fixed')summary.push('市場別使用 FinMind 轉板日期推估；不等同完整官方 point-in-time 成分檔，需另行核對。');
  if(!q)summary.push('沒有候選同時符合訓練與驗證的最少交易數／完整平倉要求，不提供最佳權重。');
  else{
    const supported=!r.options.partial&&q.test.n>=Math.ceil(r.options.minTrades/2)&&q.test.unresolved===0&&q.ci&&q.ci[0]>0&&cv.scoredObservations/cv.selectedObservations>=.9;
    summary.push(supported?'測試期有正向探索性證據；仍需新的未看過期間驗證。':'目前不足以確認策略有效；不要把搜尋第一名當成可靠最佳解。');
    summary.push(`測試平均每筆淨報酬 ${fmt(q.test.mean)}%；按進場日期以 20 日區塊重抽樣的探索性 95% 區間：${q.ci?q.ci.map(x=>fmt(x)+'%').join(' ～ '):'日期群組不足'}。`);
    const weightLine=(label,w)=>label+'：'+C.FEATURES.map((f,i)=>`${f} ${fmt(w[i]*100,1)}%`).join(' / ');
    el('weights').textContent=[weightLine('進場權重',q.parameters.entry),weightLine('出場權重',q.parameters.exit),`進場 ≥ ${q.parameters.entryThreshold}；出場 ≥ ${q.parameters.exitThreshold}；最長持有 ${q.parameters.maxHold} 日。`,`分數＝50＋Σ[w×中心化特徵]/Σ|w|；絕對分數減 50，日變化×2.5 後限制於 ±50。權重可為負，百分比按絕對值總和歸一。`].join('\n');
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
  const histories=new Map(),missing=[];
  for(const id of ['twse:0050',...o.fixedStocks]){
    checkStop();const key=`${o.fixedSource==='finmind'?'price193:finmind':'price192'}:${id}:${o.warmupStart}:${o.end}`;
    let p=await dbGet(key);status(`固定池行情 ${histories.size}/${o.fixedStocks.length+1}：${id}`);
    if(!p&&mode!=='local'){
      const [market,code]=id.split(':');
      const path=`/api/research/stock-history?code=${code}&market=${market}&start_date=${o.warmupStart}&end_date=${o.end}&source=${o.fixedSource||'auto'}`;
      try{p=await api(path);}catch(e){if(e.status!==404)throw Error(id+'：'+e.message);}
      if(!p&&mode==='build'){
        el('cache').textContent=`正在下載 ${id}；已讀取 ${histories.size} 檔。來源 ${o.fixedSource==='finmind'?'FinMind 個股':'Yahoo／交易所'}。`;
        try{p=await api(path,'POST');}catch(e){throw Error(id+'：'+e.message);}
      }
      if(p){
      if(!Array.isArray(p.data)||!p.data.length)throw Error(id+' 無歷史行情；停止而非靜默排除');
      await dbPut(key,p);
      }
    }
    if(p)histories.set(id,p.data);else missing.push(id);
  }
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

if(el('researchToken')){
  el('researchToken').value=localStorage.getItem('twq_finmind_token_v1')||'';
  el('saveResearchToken').onclick=()=>{
    const token=el('researchToken').value.trim();
    if(!token){status('請輸入 FinMind API Token，不是帳號或密碼。');return;}
    try{localStorage.setItem('twq_finmind_token_v1',token);status('Token 已儲存在此瀏覽器，研究請求將使用此 Token。未驗證帳戶額度；Token 不會包含在資料備份或結果匯出。');}catch{status('Token 儲存失敗，請檢查瀏覽器設定。');}
  };
}
