/** Yahoo session quotes for display only; never write strategy positions. */
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const positive=x=>Number.isFinite(x)&&x>0;
const day=ms=>new Date(ms+28800000).toISOString().slice(0,10);
const price=x=>positive(x)?Number(x.toFixed(4)):null;
export function parseYahooDaily(raw,symbol,now=Date.now()){
 const r=raw?.chart?.result?.[0],m=r?.meta,a=r?.timestamp,q=r?.indicators?.quote?.[0];
 if(!r||m?.symbol!==symbol||m.exchangeTimezoneName!=='Asia/Taipei'||m.dataGranularity!=='1d'||!Array.isArray(a)||!q)return null;
 const ms=m.regularMarketTime*1000;
 if(!Number.isFinite(ms)||ms<1577836800000||ms>now+90000||!positive(m.regularMarketPrice))return null;
 const tradeDate=day(ms);
 const valid=t=>Number.isFinite(t)&&t>1577836800&&t<=ms/1000;
 const i=a.findLastIndex(t=>valid(t)&&day(t*1000)===tradeDate);
 if(i<0)return null;
 const o=q.open?.[i],h=q.high?.[i],l=q.low?.[i],last=m.regularMarketPrice;
 if(![o,h,l].every(positive)||h<l||h+1e-4<Math.max(o,last)||l-1e-4>Math.min(o,last))return null;
 let previous=null;
 for(let k=i-1;k>=0;k--)if(valid(a[k])&&day(a[k]*1000)<tradeDate&&positive(q.close?.[k])){previous=q.close[k];break}
 const today=day(now),hm=new Date(now+28800000).toISOString().slice(11,16);
 const state=tradeDate!==today?'previous_session':hm<'09:00'?'preopen':hm<='13:30'?'trading':'closed';
 return {code:symbol.split('.')[0],symbol,exchange:symbol.endsWith('.TWO')?'TPEX':'TWSE',
 price:price(last),open:price(o),high:price(h),low:price(l),prev_close:price(previous),
 change_pct:previous?(last/previous-1)*100:null,trade_date:tradeDate,source:'Yahoo Finance',source_time:new Date(ms).toISOString(),
 source_url:'https://tw.stock.yahoo.com/quote/'+symbol,session_state:state,
 quote_age_seconds:Math.max(0,Math.round((now-ms)/1000)),delayed:state==='trading'&&now-ms>180000,
 ohl_period:'session_to_date',is_today:tradeDate===today,strategy_signal_validated:false};
}
const exchanges=new Map();
export async function fetchYahooStock(code,fetchImpl=fetch,now=Date.now()){
 const suffixes=exchanges.has(code)?[exchanges.get(code)]:['TW','TWO'];
 let lastError='報價來源暫無有效回應';
 for(const suffix of suffixes){
  const symbol=code+'.'+suffix;
  for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']){
   try{
    const r=await fetchImpl('https://'+host+'/v8/finance/chart/'+symbol+'?interval=1d&range=5d',{
     headers:{accept:'application/json','user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(3500)});
    if(r.status===404)break;
    if(!r.ok)throw Error('HTTP '+r.status);
    const q=parseYahooDaily(await r.json(),symbol,now);
    if(!q)throw Error('股票、日期或當日OHL未通過核對');
    exchanges.set(code,suffix);return {...q,status:'available'};
   }catch(e){lastError=String(e?.message||'來源暫不可用').slice(0,100)}
  }
 }
 return {code,status:'unavailable',source:'Yahoo Finance',error:lastError,price:null,open:null,high:null,low:null,source_time:null};
}
export async function a56QuotesRoute(request,env={},fetchImpl=fetch){
 if(request.method!=='GET')return json({ok:false,error:'GET required'},405);
 const u=new URL(request.url),codes=[...new Set((u.searchParams.get('codes')||'').split(',').filter(Boolean))].sort();
 if(!codes.length||codes.length>12||codes.some(c=>!/^\d{4,6}$/.test(c)))return json({ok:false,error:'Provide 1–12 numeric stock codes'},400);
 const withMinutes=u.searchParams.get('minutes')==='1';
 if(withMinutes&&codes.length>6)return json({ok:false,error:'Minute requests support at most 6 codes'},400);
 const cache=globalThis.caches?.default,key=new Request(u.origin+'/__a56_yahoo_quotes_v2/'+(withMinutes?'minute/':'daily/')+codes.join(',')),now=Date.now();
 try{const hit=cache&&await cache.match(key);if(hit){const body=await hit.json(),at=Date.parse(body.fetched_at);if(Number.isFinite(at)&&now>=at&&now-at<12000)return json({...body,cache_hit:true})}}catch{}
 const quotes=[];
 // Bound fan-out to avoid exhausting the Worker's concurrent connection limit.
 for(let i=0;i<codes.length;i+=3)quotes.push(...await Promise.all(codes.slice(i,i+3).map(async c=>{
  const q=await fetchYahooStock(c,fetchImpl,now);
  if(withMinutes&&q.status==='available')q.minutes=await fetchYahooMinutes(q.symbol,fetchImpl,now);
  return q;
 })));
 const body={ok:quotes.some(q=>q.status==='available'),source:'Yahoo Finance',fetched_at:new Date().toISOString(),poll_interval_seconds:15,cache_hit:false,strategy_signal_validated:false,quotes};
 if(body.ok&&cache)try{await cache.put(key,new Response(JSON.stringify(body),{headers:{'content-type':'application/json','cache-control':'public,max-age=12'}}))}catch{}
 return json(body,body.ok?200:503);
}

// Minute history is observational. Gaps/zero volume remain unknown, never fills.
export function parseYahooMinutes(raw,symbol,now=Date.now()){
 const r=raw?.chart?.result?.[0],m=r?.meta,q=r?.indicators?.quote?.[0],a=r?.timestamp;
 const source=m?.regularMarketTime*1000;
 if(m?.symbol!==symbol||m.exchangeTimezoneName!=='Asia/Taipei'||m.dataGranularity!=='1m'||!Array.isArray(a)||!q||!Number.isFinite(source)||source>now+90000)return null;
 const date=day(source),start=Date.parse(date+'T09:00:00+08:00');let last=-1;
 const bars=[];
 for(let i=0;i<a.length;i++){
  const ms=a[i]*1000,k=(ms-start)/60000;
  if(!Number.isInteger(k)||k<0||k>270||ms>source||ms>now)continue;
  if(k<=last)return null;last=k;
  const values=['open','high','low','close'].map(key=>q[key]?.[i]);
  const valid=values.every(positive)&&values[1]>=Math.max(values[0],values[2],values[3])&&values[2]<=Math.min(values[0],values[3]);
  bars.push({minute:k,start:new Date(ms).toISOString(),complete:ms+60000<=Math.min(now,source),
   open:valid?price(values[0]):null,high:valid?price(values[1]):null,low:valid?price(values[2]):null,close:valid?price(values[3]):null,
   volume_shares:valid&&positive(q.volume?.[i])?q.volume[i]:null});
 }
 if(!bars.length)return null;
 return {status:'available',date,source_time:new Date(source).toISOString(),bars,
  missing_price_bars:bars.filter(b=>b.open===null).length,unverified_volume_bars:bars.filter(b=>b.volume_shares===null).length,
  fills_verified:false};
}
export async function fetchYahooMinutes(symbol,fetchImpl=fetch,now=Date.now()){
 for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com'])try{
  const r=await fetchImpl('https://'+host+'/v8/finance/chart/'+symbol+'?interval=1m&range=1d',{
   headers:{accept:'application/json','user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(3500)});
  if(!r.ok)continue;const result=parseYahooMinutes(await r.json(),symbol,now);if(result)return result;
 }catch{}
 return {status:'unavailable',bars:[],fills_verified:false};
}
