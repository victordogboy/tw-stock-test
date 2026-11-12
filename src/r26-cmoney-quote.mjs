// Read-only public CMoney TXF1 reference quote.
// CMoney TXF1 is near-month CONTINUOUS, not proof of a specific TX YYYYMM contract.
// Do not use these snapshots for R26's frozen trading/replay engine.
const numeric = value => {
 if(value==null)return null;
 const n=Number(String(value).replace(/,/g,'').trim());
 return Number.isFinite(n)?n:null;
};
const strip = html => String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
 .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
 .replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&')
 .replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const field = (s, label) => numeric(s.match(new RegExp('(?:^|\\s)'+label+'\\s*([\\d,]+(?:\\.\\d+)?)'))?.[1]);
function localIso(year,month,day,clock){
 const pieces=/^(\d\d):(\d\d)(?::(\d\d))?$/.exec(clock);
 if(!pieces)return null;
 const [hh,mi,sec]=pieces.slice(1).map(Number);
 if(hh>23||mi>59||sec>59)return null;
 const utc=Date.UTC(year,month-1,day,hh-8,mi,sec);
 const check=new Date(utc+8*3600000);
 if(check.getUTCFullYear()!==year||check.getUTCMonth()+1!==month||check.getUTCDate()!==day)return null;
 return new Date(utc).toISOString();
}
export function parseCmoneyTxf1Page(html,sourceUrl='https://auth.cmoney.tw/forum/stock?tab=news',now=Date.now()){
 if(typeof html!=='string'||html.length>6000000)return null;
 const t=strip(html);
 const pos=t.search(/台指(?:期貨)?\s*TXF1\b/);
 if(pos<0)return null;
 const section=t.slice(pos,Math.min(pos+850,t.length));
 const m=section.match(/(?:日盤\s*夜盤\s*)?([\d,]{4,}(?:\.\d+)?)\s+[-+]?[\d,]+(?:\.\d+)?\s*\(\s*[-+]?\d+(?:\.\d+)?\s*%\s*\)/);
 const last=numeric(m?.[1]);
 if(!Number.isFinite(last)||last<1000||last>200000)return null;
 // Never reuse page retrieval time as the market quote time.
 const tm=t.match(/報價時間\s*[|｜:：]?\s*(?:(20\d{2})[/-])?(\d{1,2})[/-](\d{1,2})\s+(\d\d:\d\d(?::\d\d)?)/);
 if(!tm)return null;
 const [,explicitYear,monthStr,dayStr,clock]=tm,month=Number(monthStr),day=Number(dayStr);
 const nowYear=new Date(now+8*3600000).getUTCFullYear();
 const options=(explicitYear?[Number(explicitYear)]:[nowYear-1,nowYear,nowYear+1])
  .map(year=>localIso(year,month,day,clock)).filter(Boolean)
  .filter(iso=>Date.parse(iso)<=now+90000)
  .sort((a,b)=>Math.abs(now-Date.parse(a))-Math.abs(now-Date.parse(b)));
 const source_time=options[0];
 if(!source_time)return null;
 const open=field(section,'(?:開盤|開)'),high=field(section,'(?:最高|高)'),
  low=field(section,'(?:最低|低)'),prev=field(section,'(?:昨收|昨)');
 if([open,high,low].some(v=>v!=null&&(v<1000||v>200000)))return null;
 // Mixed day/night fields should not silently populate a bogus OHLC panel.
 const aligned=high!=null&&low!=null&&
  high>=Math.max(last,open??last)&&low<=Math.min(last,open??last)&&high>=low;
 return {ok:true,version:'r26-cmoney-txf1-v1',market:'TX_NEAR_MONTH',
  quote_type:'snapshot',symbol:'TXF1',product:'CMoney 台指期近月',
  contract_month:null,contract_verified:false,
  price:last,open:aligned?open:null,high:aligned?high:null,low:aligned?low:null,
  bid:null,ask:null,volume:null,prev_close:prev,
  change:prev!=null?last-prev:null,change_pct:prev>0?(last-prev)/prev*100:null,
  source:'CMoney TXF1 公開網頁',source_url:sourceUrl,
  source_time,quote_age_seconds:Math.max(0,Math.round((now-Date.parse(source_time))/1000)),
  quote_status:now-Date.parse(source_time)<=90000?'recent':'stale',
  time_year_inferred:!explicitYear,
  note:'TXF1 是近月連續報價，非指定月份交易合約；報價時間以 CMoney 頁面明示為準，無法確認即時性則必須標示過期。'};
}
export async function fetchCmoneyTxf1(fetchImpl=fetch){
 const urls=['https://auth.cmoney.tw/forum/stock?tab=news','https://www.cmoney.tw/forum/futures/TXF1'];
 const results=await Promise.all(urls.map(async url=>{
  try{
   const r=await fetchImpl(url,{headers:{accept:'text/html,application/xhtml+xml',
    'user-agent':'Mozilla/5.0 (compatible; R26-read-only-market-monitor/1.0)'},signal:AbortSignal.timeout(4200)});
   if(!r.ok)throw Error('HTTP '+r.status);
   const html=await r.text();
   const q=parseCmoneyTxf1Page(html,url);
   if(!q)throw Error('TXF1 price and source time not simultaneously verified');
   return {quote:q,url};
  }catch(e){return {error:url+': '+String(e?.message||e).slice(0,75)}}
 }));
 const sorted=results.filter(x=>x.quote).sort((a,b)=>Date.parse(b.quote.source_time)-Date.parse(a.quote.source_time));
 return {quote:sorted[0]?.quote??null,errors:results.filter(x=>x.error).map(x=>x.error)};
}
