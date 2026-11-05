const KEY1494='r1494-a/state-v1.json';let running1494=null;
function ingest1494(st,day){const rows=new Map(day.rows.map(r=>[r.code,r]));for(const [k,s] of Object.entries(st.stocks)){ingestStock(s,rows.get(k));if(s.pc)push(s.pc,s.p,121);if(st.codes.includes(k))push(s.chips??=[],day.chips[k],5)}for(const r of day.rows)if(!st.stocks[r.code]&&/^\d{4}$/.test(r.code)){const s={c:[],v:[],a:[],e:[null,null,null],w:[1,1,1],n:0,p:null,market:r.market};ingestStock(s,r);st.stocks[r.code]=s;st.names[r.code]=r.name}
 const mk=sum(st.marketCodes.map((k,j)=>st.stocks[k].p/st.marketBase[j]))/200;push(st.marketHistory,mk,121);for(let j=0;j<3;j++){const alpha=2/([20,60,120][j]+1);st.marketE[j]=(1-alpha)*st.marketE[j]+alpha*mk}push(st.breadthHistory,breadth(st),21)}
async function load1494(env){const obj=env.BUCKET?await env.BUCKET.get(KEY1494):null;return {st:obj?await obj.json():structuredClone(SEED1494),etag:obj?.etag||null}}
async function save1494(env,st,etag){if(!env.BUCKET)throw Error('永久儲存未連線');const r=await env.BUCKET.put(KEY1494,JSON.stringify(st),{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});if(!r)throw Error('另一項更新已提交，請重新讀取');return r.etag}
function hash1494(s){return crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)).then(b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join(''))}
async function freeze1494(env,st){const p=plan1494(st);p.universe_sha256=st.universe_sha256;p.data_version=st.dataVersion||'frozen-20261027';p.created_at=new Date().toISOString();p.trade_date_calendar_status='下一個平日；正式交易日待官方行情確認';const key='r1494-a/plans-cap5/'+p.signal_as_of+'.json',old=await env.BUCKET.get(key);if(old)return old.json();p.plan_sha256=await hash1494(JSON.stringify({...p,created_at:null}));const wrote=await env.BUCKET.put(key,JSON.stringify(p),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});if(!wrote){const existing=await env.BUCKET.get(key);if(!existing)throw Error('計畫凍結衝突');return existing.json()}return p}
async function chipRequest1494(url){return fetchOfficialJSON(url,'法人／融資券來源')}
function chipTable1494(raw,date,kind){if(raw.date&&dateOf(raw.date)!==date)throw Error(kind+' 籌碼日期不符');const ts=raw.tables||[{fields:raw.fields,data:raw.data}];const table=ts.find(t=>Array.isArray(t.fields)&&t.fields.some(f=>/^(證券代號|代號|股票代號)$/.test(f)));if(!table?.data?.length)throw Error(kind+' 籌碼欄位未通過檢查');if(table.date&&dateOf(table.date)!==date)throw Error(kind+' 表內籌碼日期不符');return table}
async function finmindMargin1494(env,date,market,codes){
 const dataset='TaiwanStockMarginPurchaseShortSale';
 const endpoint='https://api.finmindtrade.com/api/v4/data';
 async function query(code){
  const params=new URLSearchParams({dataset,start_date:date,end_date:date});
  if(code)params.set('data_id',code);
  const response=await fetch(endpoint+'?'+params,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:env.FINMIND_TOKEN?{Authorization:'Bearer '+env.FINMIND_TOKEN}:{}});
  if(!response.ok)throw Error('HTTP '+response.status);
  const result=await response.json();
  if(result.status!==200||!Array.isArray(result.data))throw Error('API 狀態 '+result.status);
  const found=new Map();
  for(const r of result.data){
   if(r.date!==date||code&&r.stock_id!==code)throw Error('日期或代號不符');
   if(!codes.includes(r.stock_id))continue;
   const values=[number(r.MarginPurchaseTodayBalance),number(r.ShortSaleTodayBalance)];
   if(found.has(r.stock_id)||!values.every(v=>Number.isSafeInteger(v)&&v>=0))throw Error('餘額或代號異常');
   found.set(r.stock_id,[r.stock_id,...values]);
  }
  return [...found.values()];
 }
 const key='r1494-a/finmind-margin/'+date+'/'+market+'/';
 let records=[];
 if(env.FINMIND_TOKEN)records=await query(null);
 else{
  // Persist verified batches independently so later syncs resume within Worker limits.
  const batches=Array.from({length:Math.ceil(codes.length/6)},(_,i)=>codes.slice(i*6,i*6+6));
  let fetched=0;
  for(const batch of batches){
   const path=key+batch.join('-')+'.json',cached=await env.BUCKET.get(path);
   if(cached){records.push(...await cached.json());continue}
   if(fetched>=2)throw Error('已暫存 '+records.length+'/'+codes.length+' 檔，下次更新接續');
   const first=await query(batch[0]);
   if(!first.length)throw Error(batch[0]+' 尚無 '+date+' 資料');
   const group=first.concat((await Promise.all(batch.slice(1).map(query))).flat());
   if(group.length!==batch.length)throw Error('部分個股尚無 '+date+' 資料');
   await env.BUCKET.put(path,JSON.stringify(group));records.push(...group);fetched++;
  }
 }
 if(!codes.length||records.length!==codes.length)throw Error('當日覆蓋 '+records.length+'/'+codes.length+' 檔');
 return {market,kind:'margin',url:endpoint+'?dataset='+dataset,raw:{date:date.replaceAll('-',''),fields:['股票代號','融資今日餘額','融券今日餘額'],data:records}};
}
async function finmindInstitutional1494(env,date,market,codes){
 const dataset='TaiwanStockInstitutionalInvestorsBuySell';
 const endpoint='https://api.finmindtrade.com/api/v4/data';
 if(!env.FINMIND_TOKEN)throw Error('缺少 Actions Secret FINMIND_TOKEN');
 const params=new URLSearchParams({dataset,start_date:date,end_date:date});
 const response=await fetch(endpoint+'?'+params,{signal:AbortSignal.timeout(23000),headers:{Authorization:'Bearer '+env.FINMIND_TOKEN}});
 if(!response.ok)throw Error('HTTP '+response.status);
 const result=await response.json();
 if(result.status!==200||!Array.isArray(result.data))throw Error('API 狀態 '+result.status);
 const expected=new Set(codes), fields=['Foreign_Investor','Investment_Trust','Dealer_Hedging'], records=new Map();
 for(const row of result.data){
  if(row.date!==date)throw Error('法人日期不符');
  if(!expected.has(row.stock_id)||!fields.includes(row.name))continue;
  const buy=number(row.buy),sell=number(row.sell);
  const values=records.get(row.stock_id)??new Map();
  if(values.has(row.name)||![buy,sell].every(v=>Number.isSafeInteger(v)&&v>=0))throw Error('法人欄位或代號異常');
  values.set(row.name,buy-sell);records.set(row.stock_id,values);
 }
 const data=codes.map(code=>[code,...fields.map(field=>records.get(code)?.get(field))]);
 const missing=data.filter(row=>row.slice(1).some(v=>v==null));
 if(!data.length||missing.length)throw Error('法人欄位覆蓋 '+(data.length-missing.length)+'/'+data.length+' 檔');
 return {market,kind:'inst',url:endpoint+'?dataset='+dataset,raw:{date:date.replaceAll('-',''),fields:['股票代號','外資買賣超股數','投信買賣超股數','自營商買賣超股數(避險)'],data}};
}
async function stageChipSource1494(env,{date,market,kind,raw}){
 const {st}=await load1494(env);
 if(date!==nextSession1494(st.lastChecked||st.date)||date>cutoff()||dateOf(raw?.date)!==date)throw Error('匯入日期不符');
 if(!['twse','tpex'].includes(market)||!['inst','margin'].includes(kind))throw Error('來源類型不符');
 const source={market,kind,raw,url:'official-executor-import:'+market+'-'+kind};
 const parsed=parseChips1494(date,[],[source]);
 const expected=st.codes.filter(k=>st.stocks[k]?.market===market);
 if(!expected.length||expected.some(k=>!parsed.chips[k]))throw Error('研究池覆蓋不足');
 await env.BUCKET.put('r1494-a/official-source/'+date+'/'+market+'-'+kind,JSON.stringify(source),{onlyIf:{etagDoesNotMatch:'*'}});
 return {date,market,kind,covered:expected.length};
}
async function officialChips1494(date,rows,env,st){const ds=date.replaceAll('-',''),sl=date.replaceAll('-','/');const sources=[
 ['twse','inst','https://www.twse.com.tw/fund/T86?response=json&date='+ds+'&selectType=ALLBUT0999'],
 ['tpex','inst','https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?date='+encodeURIComponent(sl)+'&type=Daily&sect=EW&response=json'],
 ['twse','margin','https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date='+ds+'&selectType=ALL'],
 ['tpex','margin','https://www.tpex.org.tw/www/zh-tw/margin/balance?date='+encodeURIComponent(sl)+'&response=json']];
 const rawSources=await Promise.all(sources.map(async([market,kind,url])=>{
  const stored=await env.BUCKET.get('r1494-a/official-source/'+date+'/'+market+'-'+kind);
  if(stored)return stored.json();
  const label=(market==='twse'?'上市':'上櫃')+(kind==='inst'?'三大法人':'融資券');
  const alternate=market==='twse'?url.replace('/fund/','/rwd/zh/fund/').replace('/exchangeReport/','/rwd/zh/marginTrading/'):url.replace('/zh-tw/','/en/');
  const errors=[];
  const datedT86='https://www.twse.com.tw/rwd/zh/fund/T86?date='+ds+'&selectType=';
  const candidates=market==='twse'&&kind==='inst'
   ? [datedT86+'ALLBUT0999&response=json',datedT86+'ALL&response=json',url,alternate]
   : market==='twse'?[url,alternate]:[url];
  for(const candidate of new Set(candidates)){
   try{
    const raw=await fetchOfficialJSON(candidate,label);
    if(!raw.date&&/沒有符合條件|查無資料/.test(raw.stat||''))throw Error(label+'尚無該日資料');
    chipTable1494(raw,date,kind);
    return {market,kind,url:candidate,raw};
   }catch(e){errors.push(sourceError(e,label))}
  }
  const markets=new Map(rows.map(r=>[r.code,r.market]));
  const suspended=new Set(confirmedSuspensions1494(date).map(s=>s.code));
  const codes=st.codes.filter(k=>!suspended.has(k)&&(markets.get(k)||st.stocks[k]?.market)===market);
  try{return await (kind==='margin'?finmindMargin1494:finmindInstitutional1494)(env,date,market,codes)}
  catch(e){errors.push('FinMind '+e.message)}
  throw Error(label+'取得失敗：'+[...new Set(errors)].join('；'));
 }));return parseChips1494(date,rows,rawSources);}
function parseChips1494(date,rows,rawSources){const chips={},marketRows=new Map(rows.map(r=>[r.code,r]));for(const {market,kind,url,raw} of rawSources){const tab=chipTable1494(raw,date,kind),f=tab.fields.map(x=>String(x).replace(/\s|<[^>]*>/g,''));const codeIdx=f.findIndex(x=>/^(證券代號|代號|股票代號)$/.test(x));let count=0;
 for(const a of tab.data){const code=String(a[codeIdx]).trim();if(!SEED1494.codes.includes(code))continue;const get=(pattern)=>{const i=f.findIndex(x=>pattern.test(x));return i>=0?number(a[i]):null};const c=chips[code]??={date,volume:marketRows.get(code)?.volume??0};if(kind==='inst'){let foreign=get(/^(外陸資|外資及陸資|外資).*買賣超(股數)?(\(不含外資自營商\))?$/),trust=get(/^投信.*買賣超(股數)?$/),hedge=get(/^自營商.*(避險).*買賣超|^自營商買賣超股數\(避險\)$/);
 // TPEx's dated Daily report has seven explicitly ordered B/S/net groups.
 if(market==='tpex'&&f.length===24&&f[23]==='三大法人買賣超股數合計'&&Array.from({length:7},(_,n)=>f.slice(2+3*n,5+3*n).join(',')).every(x=>x==='買進股數,賣出股數,買賣超股數')){
  const v=a.map(number);for(let n=0;n<7;n++){const i=2+3*n;if(![v[i],v[i+1],v[i+2]].every(Number.isFinite)||Math.abs(v[i]-v[i+1]-v[i+2])>.5)throw Error('上櫃法人買賣超加總未通過檢查')}
  if(Math.abs(v[4]+v[7]-v[10])>.5||Math.abs(v[16]+v[19]-v[22])>.5||Math.abs(v[10]+v[13]+v[22]-v[23])>.5)throw Error('上櫃法人分類加總未通過檢查');foreign=v[4];trust=v[13];hedge=v[19];
 }
if([foreign,trust,hedge].some(v=>v==null))throw Error(market+' 法人欄位缺少外資、投信或避險；停止訊號');Object.assign(c,{foreign,trust,hedge,institutionalAvailable:true})}else{const bal=[];f.forEach((x,i)=>{if(/今日餘額|本日餘額/.test(x))bal.push(i)});const mi=f.findIndex(x=>/^(資餘額|融資餘額|融資今日餘額|融資本日餘額)$/.test(x)),si=f.findIndex(x=>/^(券餘額|融券餘額|融券今日餘額|融券本日餘額)$/.test(x));const midx=mi>=0?mi:bal[0],sidx=si>=0?si:bal[1];if(!Number.isInteger(midx)||!Number.isInteger(sidx)||midx===sidx)throw Error(market+' 融資券餘額欄位未驗證');const margin=number(a[midx]),short=number(a[sidx]);if(margin==null||short==null)throw Error('融資券缺值');Object.assign(c,{margin,short,marginAvailable:true})}count++}
 if(count<10)throw Error(market+' '+kind+' 研究池覆蓋異常')}
 return {chips,sources:rawSources.map(({market,kind,url})=>({market,kind,url,date}))};}
function completeChips1494(c,date){return c&&c.date===date&&c.institutionalAvailable&&c.marginAvailable&&[c.foreign,c.trust,c.hedge,c.margin,c.short,c.volume].every(Number.isFinite)}
function validate1494Day(st,day){if(day.rows.some(r=>r.date&&r.date!==day.date))throw Error('價量來源日期混用');const rows=new Map(day.rows.map(r=>[r.code,r]));if(rows.size!==day.rows.length)throw Error('價量代號重複');const suspended=new Set((day.suspensions||[]).map(s=>s.code));const missing=st.codes.filter(k=>!suspended.has(k)&&!rows.has(k));if(missing.length)throw Error('233檔日線缺漏：'+missing.join(','));for(const code of st.codes){if(suspended.has(code)&&!rows.has(code))continue;const r=rows.get(code),c=day.chips?.[code];if(!completeChips1494(c,day.date))throw Error('法人或融資券未完整：'+code);if(!(r.volume>=0&&r.value>=0))throw Error('成交量金額不合法：'+code);if(r.volume>0&&!(r.open>0&&r.low>0&&r.high>=r.low&&r.open>=r.low-.001&&r.open<=r.high+.001&&r.close>=r.low-.001&&r.close<=r.high+.001))throw Error('OHLC不合法：'+code);const prev=st.stocks[code].p;if(r.close>0&&prev>0&&Math.abs(r.close/prev-1)>.25)throw Error('公司行動或異常跳價待核實：'+code)}for(const k of st.marketCodes)if(!suspended.has(k)&&!rows.has(k)&&st.stocks[k]?.c.at(-1)>0)throw Error('200檔市場代理資料缺漏：'+k)}
async function doSync1494(env,{through=cutoff(),maxDays=3}={}){if(through>cutoff())throw Error('當日19:00前不使用未完成資料');let {st,etag}=await load1494(env);if(!env.BUCKET)throw Error('永久儲存未連線');const report=[];
 if(!st.backupDone){const legacy=await env.BUCKET.get('r290/state-v2.json');if(legacy)await env.BUCKET.put('r1494-a/migration-backup/legacy_R290_state.json',await legacy.text(),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});st.backupDone=true}
 st.planHistory??={};st.planHistory[st.date]=await freeze1494(env,st);let cursor=st.lastChecked||st.date;for(let n=0;n<Math.min(7,Math.max(1,maxDays));n++){const date=nextDate(cursor);if(date>through)break;if([0,6].includes(new Date(date+'T00:00:00Z').getUTCDay())){cursor=date;st.lastChecked=date;continue}
 try{const cached=await env.BUCKET.get('r290/daily/'+date+'.json');let day;if(cached)day=await cached.json();else day=await multiSourceDay1494(date,env,st);if(day.closed){cursor=date;st.lastChecked=date;report.push({date,status:'closed'});continue}day=structuredClone(day);const stored=await env.BUCKET.get('r1494-a/chips/'+date+'.json');let source;if(stored)source=await stored.json();else if(SUPPLEMENT1494[date]){const x=SUPPLEMENT1494[date];for(const r of day.rows){if(x[r.code]&&r.close>0&&Math.abs(x[r.code].close-r.close)>.00051)throw Error('使用者籌碼檔與官方收盤不一致：'+r.code)}source={chips:x,sources:[{kind:'user_research_dataset',date,name:'FinMind_FuturesEligibleStocks_ALL_daily_research_20260101_20261031.zip'}]}}else source=await officialChips1494(date,day.rows,env,st);day.chips={...source.chips};day.chipSources=source.sources;
 const excluded=new Set((day.suspensions||[]).map(x=>x.code));
 const chipGaps=st.codes.filter(code=>!excluded.has(code)&&!completeChips1494(day.chips[code],date));
 if(chipGaps.length+(day.suspensions||[]).filter(x=>x.type==='unconfirmed gap').length>2)throw Error('籌碼缺漏超過可隔離上限：'+chipGaps.slice(0,8).join(','));
 const diagnosed=await Promise.all(chipGaps.map(code=>diagnoseMissing1494(date,code,st.stocks[code]?.market,env,'法人或融資券')));
 day.suspensions=[...(day.suspensions||[]),...diagnosed];
 for(const {code} of day.suspensions){excluded.add(code);delete day.chips[code]}
 day.benchmarkCloses=Object.fromEntries(day.rows.filter(row=>excluded.has(row.code)&&row.close>0).map(row=>[row.code,row.close]));
 day.rows=day.rows.filter(row=>!excluded.has(row.code));
 validate1494Day(st,day);
 const inputVersion=await hash1494(JSON.stringify(day)),candidate=structuredClone(st);const result=advance1494(candidate,day);ingest1494(candidate,day);candidate.excludedCodes=day.suspensions.map(x=>x.code);result.snapshot.dataGaps=day.suspensions;candidate.newSnapshots.push(result.snapshot);candidate.newOrders.push(...result.events);candidate.lastChecked=date;candidate.lastUpdatedAt=new Date().toISOString();candidate.dataVersion=inputVersion;candidate.revision++;candidate.lastError=null;candidate.lastSources=[...day.sources,...day.chipSources];await env.BUCKET.put('r1494-a/daily/'+date+'.json',JSON.stringify(day),{httpMetadata:{contentType:'application/json'}});await env.BUCKET.put('r1494-a/chips/'+date+'.json',JSON.stringify(source),{httpMetadata:{contentType:'application/json'}});candidate.planHistory[candidate.date]=await freeze1494(env,candidate);etag=await save1494(env,candidate,etag);st=candidate;cursor=date;report.push({date,status:'updated',rows:233,nav:result.snapshot.nav,events:result.events.length});
 }catch(e){st.lastError={date,message:sourceError(e),at:new Date().toISOString()};report.push({date,status:'blocked',message:st.lastError.message});break}}
 st.lastAttemptAt=new Date().toISOString();etag=await save1494(env,st,etag);return {model_version:MODEL1494,to:st.date,checkedThrough:st.lastChecked,report,lastError:st.lastError,more:st.lastChecked<through,revision:st.revision};}
async function sync1494(env,options){if(running1494)return running1494;
 running1494=(async()=>{if(!env.BUCKET)throw Error('永久儲存未連線');const key='r1494-a/sync-lease.json',obj=await env.BUCKET.get(key),old=obj?await obj.json():null;if(old?.expires>Date.now())return {status:'running',...(await status1494(env))};const lease=await env.BUCKET.put(key,JSON.stringify({expires:Date.now()+120000}),{onlyIf:obj?{etagMatches:obj.etag}:{etagDoesNotMatch:'*'}});if(!lease)return {status:'running'};
 try{return await doSync1494(env,options)}finally{await env.BUCKET.put(key,JSON.stringify({expires:0}),{onlyIf:{etagMatches:lease.etag}})}})().finally(()=>running1494=null);return running1494}

async function status1494(env){const {st}=await load1494(env),leaseObj=env.BUCKET?await env.BUCKET.get('r1494-a/sync-lease.json'):null,lease=leaseObj?await leaseObj.json():null;const isRunning=!!running1494||lease?.expires>Date.now();return {model_version:MODEL1494,ledger:'R1494_A_paper',data_as_of:st.date,signal_as_of:st.date,price_updated_at:st.lastUpdatedAt||null,lastAttemptAt:st.lastAttemptAt||null,checkedThrough:st.lastChecked,latestExpected:cutoff(),sync_status:isRunning?'running':st.lastError?'blocked':st.lastChecked>=cutoff()?'current':'pending',trade_status:'paper_only_broker_unconfirmed',lastError:st.lastError?{...st.lastError,message:sourceError(st.lastError.message)}:null,universe_count:st.codes.length,universe_sha256:st.universe_sha256,revision:st.revision,actualBrokerConnected:false,sources:st.lastSources||[]}}
async function snapshot1494(env){const {st}=await load1494(env),planObj=env.BUCKET?await env.BUCKET.get('r1494-a/plans-cap5/'+st.date+'.json'):null,plan=planObj?await planObj.json():plan1494(st),status=await status1494(env),ready=status.sync_status==='current';const planHistory={...HISTORY1494.planHistory,...st.planHistory};for(const s of st.newSnapshots)if(!planHistory[s.date]&&env.BUCKET){const obj=await env.BUCKET.get('r1494-a/plans-cap5/'+s.date+'.json')||await env.BUCKET.get('r1494-a/plans/'+s.date+'.json');if(obj)planHistory[s.date]=await obj.json()}return {...HISTORY1494,planHistory,snapshots:[...HISTORY1494.snapshots,...st.newSnapshots],dates:[...HISTORY1494.dates,...st.newSnapshots.map(s=>s.date)],orders:[...HISTORY1494.orders,...st.newOrders],status,executionRevision:EXECUTION_REV1494,historyExecutionRevision:'original-open-execution-v1',plan:{...plan,readiness:ready?'ready':'blocked',blockedReason:ready?null:(st.lastError?sourceError(st.lastError.message):null)||'先補足連續完整日線與籌碼；舊日期價位僅供回放'},names:{...HISTORY1494.names,...st.names},broker:{connected:false,holdings:null,trade_status:'unconfirmed'},assumptions:HISTORY1494.assumptions}}
export {ingest1494,load1494,save1494,freeze1494,validate1494Day,sync1494,status1494,snapshot1494};

async function importChips1494(env,input){const {date}=input;if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||date>cutoff())throw Error('籌碼匯入日期不合法');const {st}=await load1494(env);if(date<=st.date)return {alreadyApplied:true,to:st.date};let expected=nextSession1494(st.lastChecked||st.date);if(date!==expected)throw Error('必須先補 '+expected);const stored=await env.BUCKET.get('r290/daily/'+date+'.json')||await env.BUCKET.get('r1494-a/daily/'+date+'.json');if(!stored)throw Error('請先匯入該日官方日線');const day=await stored.json();if(day.closed)throw Error('休市日沒有籌碼訊號');const ds=date.replaceAll('-',''),sl=encodeURIComponent(date.replaceAll('-','/'));const sources=[{market:'twse',kind:'inst',raw:input.twseInstitutional,url:'https://www.twse.com.tw/fund/T86?response=json&date='+ds+'&selectType=ALLBUT0999'},{market:'tpex',kind:'inst',raw:input.tpexInstitutional,url:'https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade?date='+sl+'&type=Daily&sect=EW&response=json'},{market:'twse',kind:'margin',raw:input.twseMargin,url:'https://www.twse.com.tw/exchangeReport/MI_MARGN?response=json&date='+ds+'&selectType=ALL'},{market:'tpex',kind:'margin',raw:input.tpexMargin,url:'https://www.tpex.org.tw/www/zh-tw/margin/balance?date='+sl+'&response=json'}];if(sources.some(s=>!s.raw||typeof s.raw!=='object'))throw Error('四份官方原始籌碼JSON必須完整提供');const parsed=parseChips1494(date,day.rows,sources);day.chips=parsed.chips;validate1494Day(st,day);await env.BUCKET.put('r1494-a/chips-raw/'+date+'.json',JSON.stringify(input),{httpMetadata:{contentType:'application/json'}});await env.BUCKET.put('r1494-a/chips/'+date+'.json',JSON.stringify(parsed),{httpMetadata:{contentType:'application/json'}});return sync1494(env,{through:date,maxDays:7})}
export {parseChips1494,importChips1494};
// One complete official session, for cloud-task/executor fallback when Worker egress fails.
async function importSession1494(env,input){
 const {date}=input;if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||date>cutoff())throw Error('只可匯入已完成交易日');const {st}=await load1494(env);if(date<=st.date)return {alreadyApplied:true,to:st.date,revision:st.revision};if(date!==nextSession1494(st.lastChecked||st.date))throw Error('不得跳過尚未完成日期');
 const a=parseOfficial(input.twse,'twse',date),b=parseOfficial(input.tpex,'tpex',date);if(a.closed||b.closed){if(a.closed!==b.closed)throw Error('上市上櫃休市判定不同');const legacy=await importOfficial(env,input);return {...await sync1494(env,{through:date,maxDays:7}),legacy}}
 const rows=[...a.rows,...b.rows],sourceInputs=[['twse','inst','twseInstitutional'],['tpex','inst','tpexInstitutional'],['twse','margin','twseMargin'],['tpex','margin','tpexMargin']].map(([market,kind,key])=>({market,kind,raw:input[key],url:'official-executor-import:'+key}));if(sourceInputs.some(s=>!s.raw))throw Error('必須包含四份完整官方籌碼JSON');const chips=parseChips1494(date,rows,sourceInputs);validate1494Day(st,{date,rows,chips:chips.chips});
 const cached=await env.BUCKET.get('r290/daily/'+date+'.json');if(cached){const previous=await cached.json(),by=new Map(rows.map(r=>[r.code,r]));for(const r of previous.rows){const s=by.get(r.code);if(!s||['open','high','low','close','volume','value'].some(k=>r[k]!==s[k]))throw Error('與已保存的官方日線不一致：'+r.code)}}
 await env.BUCKET.put('r1494-a/chips-raw/'+date+'.json',JSON.stringify(input),{httpMetadata:{contentType:'application/json'}});await env.BUCKET.put('r1494-a/chips/'+date+'.json',JSON.stringify(chips),{httpMetadata:{contentType:'application/json'}});const legacy=await importOfficial(env,input);return {...await sync1494(env,{through:date,maxDays:7}),legacy};
}
export {importSession1494};
