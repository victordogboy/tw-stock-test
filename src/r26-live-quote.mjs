import {r26MarketRoute} from './r26-market.mjs';
// R26 view-only market quote. No order execution and NO modifications to frozen R26 engine.
// Five-second browser polling does NOT imply the upstream vendor refreshes every five seconds.
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
const finiteNumber=s=>{
 if(s==null||s==='-'||s==='--'||s==='')return null;
 const n=Number(String(s).replace(/,/g,'').replace(/[%+\s]/g,''));return Number.isFinite(n)?n:null;
};
const decode=s=>String(s??'').replace(/&amp;/gi,'&').replace(/&nbsp;|&#160;/gi,' ')
 .replace(/&quot;/gi,'"').replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)))
 .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
const clean=html=>decode(String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
 .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
 .replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim());
const num=(s,pattern)=>finiteNumber(s.match(pattern)?.[1]);
function timeToIso(dateStr,clock){
 if(!/^\d{4}[/-]\d\d[/-]\d\d$/.test(dateStr)||!/^\d\d:\d\d(?::\d\d)?$/.test(clock))return null;
 const [hh,mm,ss]=clock.split(':').map(Number);
 if(hh>23||mm>59||ss>59)return null;
 const iso=dateStr.replaceAll('/','-')+'T'+clock.padEnd(8,':00')+'+08:00';
 return Number.isFinite(Date.parse(iso))?iso:null;
}
function buildQuote(fields){
 const {last,source,source_time}=fields;
 if(!Number.isFinite(last)||last<1000||last>200000||!source_time)return null;
 const ms=Date.parse(source_time);
 if(!Number.isFinite(ms)||ms>Date.now()+90000)return null;
 return {symbol:'WTX&',product:'台指期近一',contract_month:null,contract_verified:false,
  price:last,change:Number.isFinite(fields.prev_close)?last-fields.prev_close:(fields.change??null),
  change_pct:Number.isFinite(fields.prev_close)&&fields.prev_close>0?(last-fields.prev_close)/fields.prev_close*100:(fields.change_pct??null),
  bid:fields.bid??null,ask:fields.ask??null,open:fields.open??null,high:fields.high??null,low:fields.low??null,
  volume:fields.volume??null,prev_close:fields.prev_close??null,
  source,source_time,quote_age_seconds:Math.max(0,Math.round((Date.now()-ms)/1000)),
  quote_status:(Date.now()-ms)<=90000?'recent':'stale',
  source_url:fields.source_url,
  note:'Yahoo WTX& is continuous near-month. Vendor timestamp is separate from polling time; snapshot open is not an R26 session verified opening.'
 };
}
// Parse the server-rendered Yahoo Taiwan futures quote page.
export function parseYahooQuotePage(html,sourceUrl='https://tw.stock.yahoo.com/future/WTX%26'){
 const text=clean(html);
 if(!/台指期近一/.test(text)||!text.includes('WTX&'))return null;
 // Localized page often says "收盤 | 2026/10/28 23:37 更新".
 const time=text.match(/(?:收盤|盤中|即時)\s*[|｜:：]?\s*(20\d{2}[/-]\d\d[/-]\d\d)\s+(\d\d:\d\d(?::\d\d)?)\s*(?:更新)?/);
 if(!time)return null;
 const start=text.indexOf('台指期近一');
 const section=text.slice(start,Math.min(text.length,start+3200));
 // Some Yahoo quote headers contain the last price before the labeled metrics.
 const last=num(section,/(?:成交|成交價)\s*([\d,]+(?:\.\d+)?)/);
 const result=buildQuote({source:'Yahoo Taiwan future quote',source_url:sourceUrl,
  source_time:timeToIso(time[1],time[2]),last,bid:num(section,/買價\s*([\d,]+(?:\.\d+)?)/),
  ask:num(section,/賣價\s*([\d,]+(?:\.\d+)?)/),
  open:num(section,/開盤\s*([\d,]+(?:\.\d+)?)/),
  high:num(section,/最高\s*([\d,]+(?:\.\d+)?)/),
  volume:num(section,/(?:總量|成交量)\s*([\d,]+(?:\.\d+)?)/),
  low:num(section,/最低\s*([\d,]+(?:\.\d+)?)/),
  prev_close:num(section,/昨收\s*([\d,]+(?:\.\d+)?)/),
  change:num(section,/漲跌\s*([-+]?[\d,]+(?:\.\d+)?)/),
  change_pct:num(section,/漲幅\s*([-+]?[\d,.]+)\s*%/) });
 return result;
}
// Aggregate only independently verified, contiguous 1-minute bars of ONE named TX contract
// and ONE physical session. This is an observed session-to-date summary, never an order-book quote.
export function summarizeNamedMinuteSession(data,contract){
 if(!Array.isArray(data)||!/^20\d{4}$/.test(contract))return null;
 const bars=data.filter(x=>x?.contract_verified===true&&x.contract_date===contract&&
  typeof x.session_key==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(x.timestamp_tpe||'')&&
  ['open','high','low','close'].every(k=>Number.isFinite(x[k])&&x[k]>0))
  .sort((a,b)=>a.timestamp_tpe.localeCompare(b.timestamp_tpe));
 const last=bars.at(-1);if(!last)return null;
 const same=bars.filter(x=>x.session_key===last.session_key);
 const begin=last.session==='day'?'08:45':last.session==='night'?'15:00':null;
 const parseTime=x=>Date.parse(x.timestamp_tpe.replace(' ','T')+'+08:00');
 const base=parseTime(same[0]),end=parseTime(last);
 const contiguous=!!begin&&same[0].timestamp_tpe.slice(11,16)===begin&&
  Number.isFinite(base)&&Number.isFinite(end)&&end>=base&&
  same.length===Math.round((end-base)/60000)+1&&
  same.every((x,i)=>parseTime(x)===base+i*60000);
 const hasVolume=contiguous&&same.every(x=>Number.isFinite(x.volume)&&x.volume>=0)&&same.some(x=>x.volume>0);
 return {last,complete_from_session_open:contiguous,bars:same.length,
  open:contiguous?same[0].open:null,
  high:contiguous?Math.max(...same.map(x=>x.high)):null,
  low:contiguous?Math.min(...same.map(x=>x.low)):null,
  volume:hasVolume?same.reduce((n,x)=>n+x.volume,0):null};
}
// Parse Yahoo's legacy futures full table; source day and each row's quote clock must be present.
export function parseYahooFuturesTable(html,sourceUrl='https://tw.stock.yahoo.com/future/futures.html?fumr=futurefull'){
 const text=clean(html);
 const d=text.match(/(?:資料時間)\s*[：:]\s*(20\d{2}[/-]\d\d[/-]\d\d)/);
 if(!d)return null;
 for(const m of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const row=m[1],cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>clean(x[1]));
  const pos=cells.findIndex(c=>c.includes('WTX&'));
  if(pos<0)continue;
  const next=cells.slice(pos+1);
  // Listed format: bid,ask,last,change,pct,volume,open,high,low,basis,reference,OI,time
  if(next.length<13)continue;
  const clock=next[12].match(/\b(\d\d:\d\d:\d\d)\b/)?.[1];
  const stamp=clock?timeToIso(d[1],clock):null;
  if(!stamp)continue;
  const q=buildQuote({source:'Yahoo Taiwan futures table',source_url:sourceUrl,source_time:stamp,
   bid:finiteNumber(next[0]),ask:finiteNumber(next[1]),last:finiteNumber(next[2]),
   change:finiteNumber(next[3]),change_pct:finiteNumber(next[4]),volume:finiteNumber(next[5]),
   open:finiteNumber(next[6]),high:finiteNumber(next[7]),low:finiteNumber(next[8]),prev_close:finiteNumber(next[10])});
  if(q)return q;
 }
 return null;
}
// Parse Yahoo Finance chart if Taiwan HTML pages are temporarily blocked. Do not infer contract_month.
export function parseYahooChart(raw,sourceUrl){
 const result=raw?.chart?.result?.[0];
 if(!result||!Array.isArray(result.timestamp)||!result.timestamp.length)return null;
 const bars=result.indicators?.quote?.[0],a=result.timestamp,idx=a.length-1;
 const px=Number(bars?.close?.[idx]??result.meta?.regularMarketPrice);
 const timestamp=Number(a[idx]);if(!Number.isFinite(timestamp)||timestamp<1577836800)return null;
 const stamp=new Date(timestamp*1000).toISOString();
 return buildQuote({source:'Yahoo Finance chart',source_url:sourceUrl,source_time:stamp,last:px,
  // Chart values describe the most recent minute candle, not verified session open/high/low.
  open:null,high:null,low:null,volume:null,
  prev_close:Number(result.meta?.chartPreviousClose??NaN)});
}
const providers=[
 ['chart','https://query1.finance.yahoo.com/v8/finance/chart/WTX%26?interval=1m&range=1d'],
 ['quote','https://tw.stock.yahoo.com/future/WTX%26'],
 ['table','https://tw.stock.yahoo.com/future/futures.html?fumr=futurefull']
];
export async function r26LiveQuoteRoute(request,env={},fetchImpl=fetch){
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:HEADERS});
 if(request.method!=='GET')return json({ok:false,error:'Method not allowed'},405);
 if(new URL(request.url).pathname!=='/api/r26/live-quote')return json({ok:false,error:'Not found'},404);
 // Isolated lanes: WTX quick (<=3s) and slow verified named-month 1m candles.
 // Legacy combined mode stays supported for existing clients.
 const u=new URL(request.url),contract=u.searchParams.get('contract')||'';
 const mode=u.searchParams.get('mode')||'combined';
 if(!['combined','quick','named'].includes(mode))return json({ok:false,error:'Unsupported quote mode'},400);
 if(mode==='named'&&!/^20\d{2}(0[1-9]|1[0-2])$/.test(contract))return json({ok:false,error:'Named month required'},400);
 // Cache MUST be isolated per contract AND per lane.
 const cache=globalThis.caches?.default,key=new Request(u.origin+'/__r26_live_quote_v3/'+mode+'/'+encodeURIComponent(contract));
 try{if(cache){const hit=await cache.match(key);if(hit){
  const body=await hit.json(),maxAge=mode==='named'?15000:4500;
  if(body.ok&&body.requested_mode===mode&&body.requested_contract===contract&&
   Number.isFinite(Date.parse(body.polled_at))&&Date.now()-Date.parse(body.polled_at)<maxAge&&
   (body.quote_type!=='minute_k'||body.contract_month===contract))
   return json({...body,cache_hit:true,served_at:new Date().toISOString()});
 }}}catch{}
 const namedFetch=mode!=='quick'&&/^20\d{2}(0[1-9]|1[0-2])$/.test(contract)
  ? r26MarketRoute(new Request(new URL('/api/r26/intraday?contract='+contract,u)),env,fetchImpl).catch(e=>e)
  : null;
 const failures=[];
 // Fetch in parallel; one blocked vendor must not delay the five-second frontend cycle.
 const attempts=mode==='named'?[]:await Promise.all(providers.map(async([kind,url],priority)=>{
  try{
   const rsp=await fetchImpl(url,{headers:{accept:kind==='chart'?'application/json':'text/html,application/xhtml+xml',
     'user-agent':'Mozilla/5.0 (compatible; TX-R26-quote-monitor/1.0)'},signal:AbortSignal.timeout(3000)});
   if(!rsp.ok)throw Error('HTTP '+rsp.status);
   let quote=null;
   if(kind==='chart'){const body=await rsp.json();quote=parseYahooChart(body,url);}
   else {const body=await rsp.text();if(body.length>3000000)throw Error('large HTML response');quote=kind==='quote'?parseYahooQuotePage(body,url):parseYahooFuturesTable(body,url);}
   if(!quote)throw Error('No verified timestamp + price');
   return {quote,priority};
  }catch(e){failures.push(kind+':'+String(e?.message||e?.name||'unavailable').slice(0,70));return null}
 }));
 const candidates=attempts.filter(Boolean).sort((a,b)=>
  Date.parse(b.quote.source_time)-Date.parse(a.quote.source_time)||b.priority-a.priority);
 if(candidates.length){
  const quote=candidates[0].quote;
  // Returning a stale vendor quote is permitted only when its true source timestamp is shown.
  const body={ok:true,version:'r26-quote-5s-v2',market:'TX',quote_type:'snapshot',...quote,
   requested_contract:contract,requested_mode:mode,
   polled_at:new Date().toISOString(),cache_hit:false,poll_interval_seconds:5,
   strategy_signal_validated:false};
  if(cache)try{await cache.put(key,new Response(JSON.stringify(body),{headers:{'content-type':'application/json','cache-control':'public,max-age=4'}}))}catch{}
  return json(body);
 }

 // Exact named-contract 1-minute candle is a transparent *fallback* for
 // the broken continuous WTX& quote endpoint. It is never labelled a tick.
 // The original providers retain priority whenever they succeed.
 if(namedFetch){
  try{
   const rsp=await namedFetch;
   if(rsp instanceof Error)throw rsp;
   if(rsp.ok){
    const payload=await rsp.json();
    const observed=summarizeNamedMinuteSession(payload?.data,contract);
    const last=observed?.last;
    const t=Date.parse(last?.timestamp_tpe?.replace(' ','T')+'+08:00')+60000;
    if(last?.contract_verified===true&&last.contract_date===contract&&
       Number.isFinite(last.close)&&last.close>0&&Number.isFinite(t)&&t<=Date.now()+90000){
     const namedBody={ok:true,version:'r26-quote-named-minute-v2',
      requested_contract:contract,requested_mode:mode,
      market:'TX_NAMED',symbol:'TX'+contract,product:'台指期指定月份',
      contract_month:contract,contract_verified:true,quote_type:'minute_k',
      price:last.close,change:null,change_pct:null,bid:null,ask:null,
      open:observed.open,high:observed.high,low:observed.low,volume:observed.volume,prev_close:null,
      session_key:last.session_key,session_bars:observed.bars,
      session_ohlc_verified:observed.complete_from_session_open,
      source:'Yahoo '+payload.symbol+' 指定月1分K（非逐筆成交）',
      source_time:new Date(t).toISOString(),quote_age_seconds:Math.max(0,Math.round((Date.now()-t)/1000)),
      quote_status:Date.now()-t<=90000?'recent':'stale',
      polled_at:new Date().toISOString(),cache_hit:false,poll_interval_seconds:5,
      strategy_signal_validated:false,source_url:payload.source_url,
      note:'開高低和量僅由同一指定月份、同一實際盤次的已完成分鐘K彙整；必須從開盤分鐘連續，否則不提供。無買賣一檔、非逐筆即時或券商持倉。'};
      if(cache)try{await cache.put(key,new Response(JSON.stringify(namedBody),{headers:{'content-type':'application/json','cache-control':'public,max-age=12'}}))}catch{}
      return json(namedBody);
    }
   }
  }catch(e){failures.push('named-minute:'+String(e?.message||e).slice(0,90))}
 }

 return json({ok:false,version:'r26-quote-5s-v2',error:'所查的行情來源暫時不可用；不回傳虛構現價。',
   requested_contract:contract,requested_mode:mode,
   polled_at:new Date().toISOString(),retry_after_seconds:5,providers_checked:failures},503);
}