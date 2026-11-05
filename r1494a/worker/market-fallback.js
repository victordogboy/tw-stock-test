// Company announcement published 2026-10-27. Only these dates are exempt.
function confirmedSuspensions1494(date) {
 return date>='2026-11-05'&&date<='2026-11-13'
  ? [{code:'3714',type:'confirmed suspension',url:'https://m.moneydj.com/f1a.aspx?a=80E8B6EA-1B62-4870-93F1-6CCE1D660ED1'}]
  : [];
}
const usablePrice1494 = row => row && Number.isFinite(row.value) && row.value >= 0 &&
 Number.isFinite(row.volume) && row.volume >= 0 &&
 (row.volume === 0 || [row.open, row.high, row.low, row.close].every(v => Number.isFinite(v) && v > 0) &&
 row.low <= Math.min(row.open, row.close) && row.high >= Math.max(row.open, row.close));

async function yahooPrice1494(date, code, market, host) {
 const symbol = code + (market === 'tpex' ? '.TWO' : '.TW');
 const start = Date.parse(date + 'T00:00:00+08:00') / 1000;
 const params = new URLSearchParams({period1:start,period2:start+86400,interval:'1d'});
 const url = 'https://' + host + '/v8/finance/chart/' + symbol + '?' + params;
 const response = await fetch(url, {signal:AbortSignal.timeout(9000),headers:{Accept:'application/json'}});
 if (!response.ok) throw Error('HTTP '+response.status);
 const result = (await response.json()).chart?.result?.[0];
 if (result?.meta?.symbol !== symbol || result.meta.exchangeTimezoneName !== 'Asia/Taipei') throw Error('代號或市場不符');
 const i = result.timestamp?.findIndex(t => Number.isFinite(t) && new Date(t*1000+28800000).toISOString().slice(0,10) === date);
 if (i == null || i < 0) throw Error('沒有指定日期日線');
 const q = result.indicators?.quote?.[0];
 return Object.fromEntries(['open','high','low','close','volume'].map(k => [k,q?.[k]?.[i]]));
}

async function repairYahoo1494(date, row, market) {
 if (!row || !['twse','tpex'].includes(market) || !(row.volume>0) || !Number.isFinite(row.value)) return null;
 for (const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']) {
  try {
   const price = await yahooPrice1494(date,row.code,market,host);
   if (price.volume !== row.volume) continue;
   const repaired = {...row,...price,market,date,priceSource:'Yahoo Finance'};
   if (usablePrice1494(repaired)) return repaired;
  } catch {}
 }
 return null;
}

async function diagnoseMissing1494(date, code, market, env, field) {
 const endpoint='https://api.finmindtrade.com/api/v4/data';
 const start=new Date(Date.parse(date+'T00:00:00Z')-30*86400000).toISOString().slice(0,10);
 const headers=env.FINMIND_TOKEN?{Authorization:'Bearer '+env.FINMIND_TOKEN}:{};
 const params=new URLSearchParams({dataset:'TaiwanStockSuspended',data_id:code,start_date:start,end_date:date});
 try {
  const r=await fetch(endpoint+'?'+params,{headers,signal:AbortSignal.timeout(6000)});
  if(!r.ok)throw Error('HTTP '+r.status);
  const result=await r.json();
  if(result.status!==200||!Array.isArray(result.data))throw Error('API '+result.status);
  const event=result.data.find(x=>x.stock_id===code&&dateOf(x.date)<=date&&dateOf(x.resumption_date)>date);
  if(event)return {code,field,type:'confirmed suspension',reason:'FinMind 暫停交易公告',url:endpoint+'?dataset=TaiwanStockSuspended'};
 } catch(e) {
  return {code,field,type:'unconfirmed gap',reason:field+'缺漏；停牌公告查詢失敗（'+sourceError(e)+'）'};
 }
 return {code,field,type:'unconfirmed gap',reason:field+'缺漏；未查到符合日期的停牌公告'};
}
async function multiSourceDay1494(date, env, st) {
 const markets = ['twse','tpex'];
 const results = await Promise.allSettled(markets.map(type => officialMarket(date,type)));
 const official = results.filter(r => r.status === 'fulfilled').map(r => r.value);
 const errors = results.filter(r => r.status === 'rejected').map(r => r.reason.message);
 const suspensions = confirmedSuspensions1494(date);
 const suspended = new Set(suspensions.map(s=>s.code));
 const required = [...new Set([...st.codes,...st.marketCodes.filter(k=>st.stocks[k]?.c.at(-1)>0)])].filter(k=>!suspended.has(k));
 const rows = new Map();
 const sources = [];
 for (const feed of official) {
  for (const row of feed.rows) {
   if (rows.has(row.code)) throw Error('上市上櫃代號重複：'+row.code);
   rows.set(row.code,{...row,date});
  }
  sources.push({type:feed.type,url:feed.url,rows:feed.rows.length});
 }
 if (official.length === 2 && official.every(feed=>feed.closed)) return {date,closed:true,rows:[],sources};
 const needsBackup = official.length !== 2 || official.some(feed=>feed.closed) || required.some(k=>!usablePrice1494(rows.get(k)));
 if (needsBackup) {
  if (env.FINMIND_TOKEN) {
   try {
    const feed = await finmindDay(date,env.FINMIND_TOKEN);
    if (new Set(feed.rows.map(r=>r.code)).size !== feed.rows.length) throw Error('日線代號重複');
    for (const row of feed.rows) {
     const prior = rows.get(row.code);
     if (!usablePrice1494(prior)) rows.set(row.code,{...row,date,market:prior?.market??st.stocks[row.code]?.market??null,name:prior?.name??st.names[row.code]??row.code});
    }
    sources.push(...feed.sources);
   } catch (e) { errors.push('FinMind：'+sourceError(e)); }
  } else errors.push('FinMind 全市場備援缺少 Actions Secret FINMIND_TOKEN');
 }
 const candidates = required.filter(k=>!usablePrice1494(rows.get(k))&&rows.get(k)?.volume>0&&Number.isFinite(rows.get(k)?.value));
 let repaired = 0;
 for (let i=0;i<candidates.length;i+=6) {
  const group = await Promise.all(candidates.slice(i,i+6).map(k=>repairYahoo1494(date,rows.get(k),rows.get(k)?.market??st.stocks[k]?.market)));
  for (const row of group) if (row) { rows.set(row.code,row); repaired++; }
 }
 if (repaired) sources.push({type:'Yahoo Finance',rows:repaired});
 const missing = required.filter(k=>!usablePrice1494(rows.get(k)));
 if (missing.length > 2 || ((official.length !== 2 || official.some(feed=>feed.closed)) && !sources.some(s=>s.type==='FinMind'))) {
  throw Error([...errors,'日線缺漏 '+missing.length+' 檔（'+missing.slice(0,8).join(',')+'）；Yahoo 須有同日實際成交金額才能補 OHLC'].join('；'));
 }
 const gaps=await Promise.all(missing.map(code=>diagnoseMissing1494(date,code,st.stocks[code]?.market,env,'日線')));
 const exclusions=[...suspensions.map(s=>({...s,reason:'現金減資停止買賣'})),...gaps];
 for(const {code} of exclusions)rows.delete(code);
 return {date,closed:false,rows:[...rows.values()],sources:[...sources,...exclusions],suspensions:exclusions};
}
export {multiSourceDay1494, yahooPrice1494};
