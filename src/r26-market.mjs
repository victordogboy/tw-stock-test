// Exact monthly TX data. Continuous WTX& is deliberately not used for replay.
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const json=(x,s=200)=>Response.json(x,{status:s,headers:H});
export function yahooTxSymbol(contract){
 if(!/^20\d{2}(0[1-9]|1[0-2])$/.test(contract))throw Error('合約月份格式應為 YYYYMM');
 return 'WTX'+'FGHJKMNQUVXZ'[Number(contract.slice(4))-1]+contract.slice(3,4);
}
export function objectAt(text,key){
 const k='"'+key+'":',a=text.indexOf(k);if(a<0)throw Error('Yahoo 缺少分鐘圖表');
 const start=a+k.length;return JSON.parse(text.slice(start,findEnd(text,start)));
}
function findEnd(text,start){let depth=0,str=false,esc=false;for(let i=start;i<text.length;i++){
 const c=text[i];if(str){if(esc)esc=false;else if(c==='\\')esc=true;else if(c==='"')str=false}
 else if(c==='"')str=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0)return i+1;
 }throw Error('Yahoo 圖表內容不完整')}
const tpe=ms=>new Date(ms+8*3600000).toISOString().slice(0,19).replace('T',' ');
export function parseNamedChart(html,contract,now=Date.now(),calendar=[]){
 const symbol=yahooTxSymbol(contract),c=objectAt(html,'MarketChartStore')?.libra?.[symbol];
 if(c?.meta?.symbol!==symbol||c.meta.name!=='台指期'+contract.slice(2)||c.meta.exchange!=='TFE'||c.meta.dataGranularity!=='1m')throw Error('Yahoo 指定月份或分鐘格式無法核實');
 const q=c.indicators?.quote?.[0];if(!q||!Array.isArray(c.timestamp))throw Error('Yahoo 無分鐘 OHLC');
 const valid=c.timestamp.map((t,i)=>({t:Number(t)*1000,i})).filter(({t,i})=>Number.isFinite(t)&&['open','high','low','close'].every(k=>typeof q[k]?.[i]==='number'&&q[k][i]>0));
 // Taiwan Yahoo labels the completed opening minute 15:01 / 08:46.
 // Infer ONLY from a full chart with the actual opening bar, never from the last quote.
 const first=valid[0],clock=first?tpe(first.t).slice(11,16):'';
 const openingMatches=valid.some(({t,i})=>['15:01','08:46'].includes(tpe(t).slice(11,16))&&q.open[i]===Number(c.quote?.openPrice));
 if(!['15:01','08:46'].includes(clock)||!openingMatches)throw Error('分鐘時間基準或開盤尚無法核對');
 const rawMarket=Number(c.meta.regularMarketTime)*1000,quoteTime=Date.parse(c.quote?.refreshedTs),period=c.meta.sourceTradingPeriods?.[0]?.[0];
 let calendarShift=0;
 if(rawMarket>now+90000){
  if(!Number.isFinite(quoteTime)||!Number.isFinite(Number(period?.start))||!Number.isFinite(Number(period?.end)))throw Error('Yahoo 圖表日期在未來，尚無法用來源更新時間與交易日曆核實；不發布當盤分K');
  // Yahoo can anchor a Friday night chart on Sunday/Monday's trade-date
  // axis. Correct ONLY with a fresh independent quote ISO clock, an exact
  // calendar trading-day mapping and matching quote identity/price.
  const local=Number.isFinite(quoteTime)?tpe(quoteTime):'',clock=local.slice(11,16),hour=Number(clock.slice(0,2));
  const nightClock=hour>=15||clock<='05:01';
  const physicalDate=hour<6?tpe(quoteTime-86400000).slice(0,10):local.slice(0,10);
  const actualStart=Date.parse(physicalDate+'T15:00:00+08:00');
  const nextTrade=calendar.find(d=>d>physicalDate),rawStart=Number(period?.start)*1000,rawEnd=Number(period?.end)*1000;
  const delta=rawStart-actualStart;
  const checked=Number.isFinite(quoteTime)&&quoteTime<=now+90000&&now-quoteTime<=180000&&
   nightClock&&calendar.includes(physicalDate)&&nextTrade&&
   tpe(rawStart).slice(11)==='15:00:00'&&tpe(rawEnd).slice(11)==='05:00:00'&&
   tpe(rawEnd).slice(0,10)===nextTrade&&rawMarket>=rawStart&&rawMarket<=rawEnd&&
   delta>0&&delta%86400000===0&&Math.abs(rawMarket-delta-quoteTime)<60000&&
   Number(c.quote.price)===Number(c.meta.regularMarketPrice);
  if(!checked)throw Error('Yahoo 圖表日期在未來，尚無法用來源更新時間與交易日曆核實；不發布當盤分K');
  calendarShift=delta;
 }
 const adjusted=t=>calendarShift&&t>=period.start*1000&&t<=period.end*1000?t-calendarShift:t;
 const data=[];
 for(const {t:rawT,i} of valid){const t=adjusted(rawT);if(t>now)continue;
  const ts=tpe(t-60000),date=ts.slice(0,10),m=+ts.slice(11,13)*60+ +ts.slice(14,16),day=m>=525&&m<825;
  if(!day&&m<900&&m>=300)continue;
  const openDate=day||m>=900?date:tpe(Date.parse(date+'T12:00:00+08:00')-86400000).slice(0,10);
  const [o,h,l,cl]=['open','high','low','close'].map(k=>q[k][i]);if(h<Math.max(o,cl)||l>Math.min(o,cl))throw Error('Yahoo OHLC 不合法');
  data.push({timestamp_tpe:ts,contract_date:contract,session:day?'day':'night',session_key:(day?'day:':'night:')+openDate,
   open:o,high:h,low:l,close:cl,volume:q.volume?.[i]??0,source:'Yahoo '+symbol,contract_verified:true,time_convention:'minute-start (Yahoo minute-end minus 60s)',
   raw_timestamp_tpe:tpe(rawT),calendar_shift_seconds:(rawT-t)/1000,
   source_complete:(c.meta.sourceTradingPeriods||[]).flat().some(p=>p.start*1000<=rawT-60000&&p.end*1000>rawT-60000&&now>=adjusted(p.end*1000)),
   source_retrieved_at:new Date(now).toISOString()});
 }
 return {ok:true,contract,symbol,data,source:'Yahoo named monthly TX',source_url:'https://tw.stock.yahoo.com/quote/'+symbol,
  source_time:new Date(calendarShift?quoteTime:rawMarket).toISOString(),raw_source_time:new Date(rawMarket).toISOString(),quote_time:c.quote?.refreshedTs||null,
  retrieved_at:new Date(now).toISOString(),time_shift_seconds:-60,calendar_shift_seconds:calendarShift/1000,
  clock_verification:calendarShift?'quote ISO clock + exchange trading calendar':'native chart timestamp',
  source_session_start:c.meta.sourceTradingPeriods?.[0]?.[0]?.start??null};
}
let calendarCache;
async function sourceCalendar(env){
 if(calendarCache)return calendarCache;
 if(!env.ASSETS?.fetch)throw Error('交易日曆不可用，無法核實 Yahoo 週末時間');
 const rsp=await env.ASSETS.fetch(new Request('https://r26-assets.internal/r26-engine/data/recent.json.gz'));
 if(!rsp.ok)throw Error('無法取得交易日曆');
 const seed=await new Response(rsp.body.pipeThrough(new DecompressionStream('gzip'))).json();
 if(!Array.isArray(seed.calendar)||!seed.calendar.every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)))throw Error('交易日曆格式不正確');
 calendarCache=[...new Set(seed.calendar)].sort();return calendarCache;
}
export async function r26MarketRoute(request,env={},fetchImpl=fetch){
 const u=new URL(request.url),contract=u.searchParams.get('contract')||'',cache=globalThis.caches?.default;
 if(request.method!=='GET')return json({ok:false,error:'Method not allowed'},405);
 try{
  yahooTxSymbol(contract);
  if(u.pathname==='/api/r26/intraday'){
   const key=new Request(u.origin+'/__r26_named_v2/'+contract);let hit;try{hit=await cache?.match(key)}catch{}if(hit)return hit;
   const rsp=await fetchImpl('https://tw.stock.yahoo.com/quote/'+yahooTxSymbol(contract),{headers:{accept:'text/html','user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(12000)});
   if(!rsp.ok)throw Error('Yahoo HTTP '+rsp.status);
   const html=await rsp.text(),meta=objectAt(html,'MarketChartStore')?.libra?.[yahooTxSymbol(contract)]?.meta;
   const calendar=Number(meta?.regularMarketTime)*1000>Date.now()+90000?await sourceCalendar(env):[];
   const body=parseNamedChart(html,contract,Date.now(),calendar);if(!body.data.length)throw Error('來源未提供目前可核實的已完成分鐘K');
   const ret=json(body);
   if(cache)try{await cache.put(key,new Response(JSON.stringify(body),{headers:{...H,'cache-control':'public,max-age=15'}}))}catch{}
   return ret;
  }
  if(u.pathname==='/api/r26/official-zip'){
   const date=u.searchParams.get('date'),ms=Date.parse(date+'T00:00:00Z');
   if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==date||Date.now()-ms>35*86400000||ms>Date.now()+86400000)return json({ok:false,error:'僅接受最近 35 日官方交易日'},400);
   const key=new Request(u.origin+'/__r26_official_v1/'+date);let hit;try{hit=await cache?.match(key)}catch{}if(hit)return hit;
   const url='https://www.taifex.com.tw/file/taifex/Dailydownload/DailydownloadCSV/Daily_'+date.replaceAll('-','_')+'.zip';
   const rsp=await fetchImpl(url,{signal:AbortSignal.timeout(20000)});if(!rsp.ok)throw Error('期交所逐筆尚未公布 HTTP '+rsp.status);
   const b=await rsp.arrayBuffer();if(b.byteLength<100||b.byteLength>20000000||new DataView(b).getUint32(0,true)!==0x04034b50)throw Error('期交所未提供有效 ZIP');
   const ret=new Response(b,{headers:{'content-type':'application/zip','cache-control':'public,max-age=86400','X-R26-Source':url}});
   if(cache)try{await cache.put(key,ret.clone())}catch{}return ret;
  }
  return json({ok:false,error:'Not found'},404);
 }catch(e){return json({ok:false,error:String(e.message||e)},502)}
}
