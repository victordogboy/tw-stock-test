// Original R26 trading-day session mapping, independently validated for 2,815
// historical 2021-2026 TX day/night sessions (including weekend + holiday nights).
// Do not equate physical night opening date to the exchange's trade date.
// Frozen R26 data permits day 300/301 bars, night 05:00 bars and sparse nights.
// No synthetic bars, no futures orders.
const DATE=/^20\d\d-\d\d-\d\d$/,TIME=/^(20\d\d-\d\d-\d\d) (\d\d):(\d\d):(\d\d)$/;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const prev=s=>new Date(Date.parse(s+'T00:00:00Z')-86400000).toISOString().slice(0,10);
export function normalizeR11TxSessions(rawBars,tradingDays,{calendarVerified=false}={}){
 if(!Array.isArray(rawBars)||!Array.isArray(tradingDays))throw Error('R11_EXPECTS_BARS_AND_TRADING_CALENDAR');
 if(!tradingDays.length||tradingDays.some((d,i)=>!DATE.test(d)||(i>0&&d<=tradingDays[i-1])))throw Error('R11_CALENDAR_MUST_BE_SORTED_UNIQUE_DATES');
 const groups=new Map(),seen=new Set(),errors=[];
 for(const b of rawBars){
  const m=TIME.exec(String(b.timestamp_tpe||''));
  if(!m){errors.push('INVALID_TIMESTAMP');continue;}
  const date=m[1],hour=+m[2],min=+m[3],sec=+m[4],minute=60*hour+min;
  if(hour>23||min>59||sec!==0){errors.push('INVALID_MINUTE');continue;}
  const session=minute>=525&&minute<=825?'day':minute>=900||minute<=300?'night':null;
  if(!session){errors.push('OUT_OF_SESSION_MINUTE');continue;}
  const physicalOpenDate=session==='day'||minute>=900?date:prev(date);
  const tradeDate=session==='day'?date:tradingDays.find(d=>d>physicalOpenDate);
  const contract=String(b.contract_date||'');
  if(!tradeDate){errors.push('EXCHANGE_TRADING_DAY_UNKNOWN:'+physicalOpenDate);continue;}
  if(!/^20\d\d(0[1-9]|1[0-2])$/.test(contract)||!['open','high','low','close'].every(k=>finite(b[k]))||b.low<=0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close)){
   errors.push('INVALID_CONTRACT_OR_OHLC');continue;
  }
  const key=contract+'|'+b.timestamp_tpe;
  if(seen.has(key)){errors.push('DUPLICATE_MINUTE:'+key);continue;}seen.add(key);
  const gk=tradeDate+'|'+session+'|'+contract;
  if(!groups.has(gk))groups.set(gk,{trade_date:tradeDate,session,physical_open_date:physicalOpenDate,contract,bars:[]});
  const epoch=Date.parse(date+'T'+m[2]+':'+m[3]+':00+08:00');
  groups.get(gk).bars.push({...b,epoch});
 }
 const sessions=[];
 for(const g of groups.values()){
  g.bars.sort((a,b)=>a.epoch-b.epoch);
  const first=g.bars[0],last=g.bars.at(-1),begin=g.physical_open_date+(g.session==='day'?' 08:45':' 15:00');
  const startCorrect=first.timestamp_tpe.startsWith(begin),lastClock=last.timestamp_tpe.slice(11,16);
  const endObserved=g.session==='day'?['13:44','13:45'].includes(lastClock):['04:59','05:00'].includes(lastClock);
  const gaps=[];let internalMissing=0;
  for(let i=1;i<g.bars.length;i++){
   const n=Math.round((g.bars[i].epoch-g.bars[i-1].epoch)/60000)-1;
   if(n>0){internalMissing+=n;gaps.push({from:g.bars[i-1].timestamp_tpe,to:g.bars[i].timestamp_tpe,missing:n});}
  }
  sessions.push({trade_date:g.trade_date,session:g.session,physical_open_date:g.physical_open_date,
   contract:g.contract,open:first.open,high:Math.max(...g.bars.map(x=>x.high)),low:Math.min(...g.bars.map(x=>x.low)),close:last.close,
   first_minute:first.timestamp_tpe,last_minute:last.timestamp_tpe,bars:g.bars.length,
   missing_internal_minutes:internalMissing,gaps:gaps.slice(0,20),calendar_verified:calendarVerified,
   opening_verified:startCorrect,closing_verified:endObserved,archive_sparse_compatible:true,
   data_coverage_verified:calendarVerified&&startCorrect&&endObserved&&internalMissing===0,
   paper_only:true,tradeable:false});
 }
 sessions.sort((a,b)=>a.trade_date.localeCompare(b.trade_date)||Number(a.session==='day')-Number(b.session==='day'));
 return {sessions,errors,calendar_verified:calendarVerified,raw_bars:rawBars.length,
  normalized_bars:sessions.reduce((s,x)=>s+x.bars,0),tradeable:false};
}
