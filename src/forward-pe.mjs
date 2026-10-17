// R49: free, full-market forward-EPS screener. Does not change the existing scanner.
const FIN_TYPES=['ci','basi','fh','ins','bd','mim'];
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const number=x=>{
 if(x===null||x===undefined)return null;
 const s=String(x).replace(/,/g,'').replace(/\s/g,'').replace(/^\((.*)\)$/,'-$1');
 if(!s||s==='--'||s==='-'||s==='N/A'||s==='不適用')return null;
 const n=Number(s);return Number.isFinite(n)?n:null;
};
const codeOf=r=>String(r['公司代號']||r['股票代號']||r.Code||r.code||'').trim();
const stockCode=c=>/^[1-9]\d{3}$/.test(String(c||''));
const rocYear=v=>{const n=number(v);return n!==null?(n<1911?n+1911:n):null;};
const response=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:JSON_HEADERS});

function parseCsv(text){
 const out=[];let row=[],cell='',quote=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quote){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quote=false;else cell+=c;}
  else if(c==='"')quote=true;
  else if(c===','){row.push(cell);cell='';}
  else if(c==='\n'){row.push(cell.replace(/\r$/,''));out.push(row);row=[];cell='';}
  else cell+=c;
 }
 if(cell||row.length){row.push(cell);out.push(row);}
 const index=out.findIndex(a=>a.some(c=>String(c).replace(/^\uFEFF/,'').trim()==='公司代號'));
 if(index<0)throw Error('CSV 缺公司代號欄位');
 const headers=out[index].map(x=>String(x).replace(/^\uFEFF/,'').trim());
 return out.slice(index+1).filter(a=>a.length>=2).map(a=>{
  const o={};headers.forEach((k,i)=>o[k]=a[i]??'');return o;
 }).filter(a=>stockCode(codeOf(a)));
}
async function fetchRows(url,asCsv){
 const r=await fetch(url,{headers:{'accept':asCsv?'text/csv,text/plain,*/*':'application/json,*/*'},signal:AbortSignal.timeout(18000)});
 if(!r.ok)throw Error('HTTP '+r.status);
 if(!asCsv){
  const j=await r.json();
  if(!Array.isArray(j))throw Error('資料不是陣列');
  return j;
 }
 const bytes=await r.arrayBuffer();
 const utf=new TextDecoder('utf-8').decode(bytes),big5=new TextDecoder('big5').decode(bytes);
 const bad=s=>(s.match(/\uFFFD/g)||[]).length;
 const text=bad(big5)<bad(utf)?big5:utf;
 if(/<!doctype|<html/i.test(text.slice(0,300)))throw Error('上游回傳 HTML 而不是 CSV');
 return parseCsv(text);
}
async function parallel(items,concurrency,fn){
 let cursor=0;const res=Array(items.length);
 await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
  while(cursor<items.length){const i=cursor++;try{res[i]=await fn(items[i]);}catch(e){res[i]={ok:false,error:String(e.message||e)};}}
 }));
 return res;
}
function readMonth(r){
 const ym=String(r['資料年月']||'').replace(/\D/g,'');
 if(!/^\d{5,6}$/.test(ym))return null;
 const year=rocYear(ym.slice(0,-2)),month=Number(ym.slice(-2));
 const monthRevenue=number(r['營業收入-當月營收']);
 const prevMonth=number(r['營業收入-上月營收']);
 const ytd=number(r['累計營業收入-當月累計營收']);
 if(!year||month<1||month>12||monthRevenue===null||ytd===null||monthRevenue<0||ytd<=0)return null;
 return {year,month,monthRevenue,prevMonth,ytd,source:'TWSE/MOPS monthly disclosure'};
}
function readFin(r,type){
 const year=rocYear(r['年度']),q=number(r['季別']);
 const eps=number(r['基本每股盈餘（元）']||r['基本每股盈餘(元)']);
 const revenue=number(r['營業收入']);
 if(!year||![1,2,3,4].includes(q)||eps===null)return null;
 return {year,quarter:q,reportedYtdEPS:eps,reportedYtdRevenue:revenue,
  sector:type,source:'TWSE/MOPS income statement (YTD)'};
}
function choose(old,next){
 if(!old)return next;
 if(next.year*4+next.quarter > old.year*4+old.quarter)return next;
 return old;
}
function forecast(share,fin,month){
 if(!fin)return {status:'缺EPS報表'};
 if(!month)return {status:'缺月營收'};
 if(fin.sector!=='ci' && fin.sector!=='ins')return {status:'金融等特殊產業不適用營收推算'};
 if(fin.sector==='ins')return {status:'保險業另需適用獲利模型'};
 if(!Number.isFinite(fin.reportedYtdRevenue)||fin.reportedYtdRevenue<=0)return {status:'財報營收缺漏'};
 if(month.year!==fin.year)return {status:'財報與月營收年份不同'};
 if(month.month<fin.quarter*3)return {status:'月營收早於財報季別'};
 if(fin.reportedYtdEPS<=0)return {status:'已公布累計EPS非正值'};
 // Official statements are year-to-date cumulative, NOT stand-alone quarterly EPS.
 // Hold the EPS / disclosed YTD revenue efficiency constant for as-yet unreported revenue.
 const projectedYearRevenue=month.ytd+(12-month.month)*month.monthRevenue;
 const unreportedRevenue=Math.max(0,projectedYearRevenue-fin.reportedYtdRevenue);
 const projectedEPS=fin.reportedYtdEPS*(projectedYearRevenue/fin.reportedYtdRevenue);
 if(!Number.isFinite(projectedEPS)||projectedEPS<=0||projectedEPS>1000)return {status:'估算結果異常'};
 const inferredRevenue=month.ytd-fin.reportedYtdRevenue;
 const elapsedMonths=month.month-fin.quarter*3;
 // Different consolidation/accounting scopes can make YTD monthly vs financial revenue incomparable.
 if(projectedYearRevenue<fin.reportedYtdRevenue*0.92)return {status:'月營收／財報口徑不一致'};
 if(inferredRevenue< -fin.reportedYtdRevenue*0.08)return {status:'月營收／財報口徑不一致'};
 return {
  status:'ok',estimatedEPS:projectedEPS,
  estimatedPE:share.close/projectedEPS,
  epsDisclosed:fin.reportedYtdEPS,
  quarter:fin.year+'Q'+fin.quarter,
  revenueDisclosed:fin.reportedYtdRevenue,
  revenueMonth:month.year+'-'+String(month.month).padStart(2,'0'),
  revenueYtd:month.ytd,revenueLatest:month.monthRevenue,
  revenue3moProxy:elapsedMonths===3?inferredRevenue:null,
  projectedYearRevenue,unreportedRevenue,
  earningsYield:projectedEPS/share.close*100,
  annualizationFactor:projectedYearRevenue/fin.reportedYtdRevenue,
  revenueMomentum:month.monthRevenue/(fin.reportedYtdRevenue/(fin.quarter*3))-1
 };
}

async function yahooFiveDayVolume(code,market){
 const suffix=market==='tpex'?'.TWO':'.TW';
 const uri='https://query1.finance.yahoo.com/v8/finance/chart/'+code+suffix+'?range=1mo&interval=1d&events=false';
 const r=await fetch(uri,{headers:{accept:'application/json','user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Error('Yahoo HTTP '+r.status);
 const j=await r.json(),chart=j?.chart?.result?.[0],times=chart?.timestamp,vals=chart?.indicators?.quote?.[0]?.volume;
 if(!Array.isArray(times)||!Array.isArray(vals))throw Error('Yahoo 缺歷史成交量');
 const now=new Date(),twNow=new Date(Date.now()+8*3600000);
 const hour=twNow.getUTCHours(),minute=twNow.getUTCMinutes();
 const today=twNow.toISOString().slice(0,10),includeToday=hour>13||(hour===13&&minute>=40);
 const rows=[];
 for(let i=0;i<times.length;i++){
  const d=new Date(times[i]*1000+8*3600000).toISOString().slice(0,10);
  const v=Number(vals[i]);
  if((d<today||(d===today&&includeToday))&&Number.isFinite(v)&&v>=0)rows.push({d,v});
 }
 const last=rows.slice(-5),maxAge=(now-new Date((last.at(-1)?.d||'2000-01-01')+'T00:00:00+08:00'))/86400000;
 if(last.length!==5||maxAge>15||maxAge<0)throw Error('近5日交易量不足或報價過期');
 return {code,avg5Lots:last.reduce((a,b)=>a+b.v,0)/5000,dates:last.map(x=>x.d),source:'Yahoo 1d completed sessions'};
}
async function volumeBatch(url){
 const market=url.searchParams.get('market');
 const codes=(url.searchParams.get('codes')||'').split(',').filter(stockCode);
 if(!['twse','tpex'].includes(market)||codes.length<1||codes.length>10||new Set(codes).size!==codes.length)
  return response({ok:false,error:'需提供同市場1～10個不同的四碼股票代號'},400);
 const output=await parallel(codes,3,async c=>({ok:true,...await yahooFiveDayVolume(c,market)}));
 return response({ok:true,market,data:output.map((x,i)=>({...x,code:codes[i]}))});
}

export async function forwardPeRoute(request,env,fetchExisting){
 const url=new URL(request.url);
 if(request.method!=='GET')return response({ok:false,error:'GET only'},405);
 if(url.pathname==='/api/pe-screener/volume-batch')return volumeBatch(url);
 if(url.pathname==='/api/pe-screener/health')return response({ok:true,version:'R49',method:'Official disclosed YTD EPS/revenue, latest monthly revenue annualization'});
 if(url.pathname!=='/api/pe-screener/data')return response({ok:false,error:'Not found'},404);
 const fresh=url.searchParams.get('refresh')==='1',cache=caches.default;
 const key=new Request(url.origin+'/__cache/eps-forward-r49');
 if(!fresh){const hit=await cache.match(key);if(hit)return hit;}
 const started=Date.now();
 const inputs=[
  {id:'twse',path:'/api/twse/all'},
  {id:'tpex',path:'/api/tpex/all'},
  {id:'futures',path:'/api/futures/stock-list'}
 ];
 const top=await Promise.all(inputs.map(async inp=>{
  try{
   const r=await fetchExisting(new Request(url.origin+inp.path,{headers:request.headers}));
   const j=await r.json();
   if(!r.ok||j.ok===false)throw Error(j.error||'HTTP '+r.status);
   return {ok:true,data:j};
  }catch(e){return {ok:false,error:String(e.message||e)};}
 }));
 const financeJobs=[];
 for(const market of ['L','O'])for(const type of FIN_TYPES)financeJobs.push({market,type,
  url:market==='L'
   ? 'https://openapi.twse.com.tw/v1/opendata/t187ap06_L_'+type
   : 'https://mopsfin.twse.com.tw/opendata/t187ap06_O_'+type+'.csv'
 });
 const revJobs=[
  {market:'L',url:'https://openapi.twse.com.tw/v1/opendata/t187ap05_L'},
  {market:'O',url:'https://mopsfin.twse.com.tw/opendata/t187ap05_O.csv'}
 ];
 const jobs=[...revJobs,...financeJobs];
 const results=await parallel(jobs,3,async job=>{
  const data=await fetchRows(job.url,job.market==='O');
  return {ok:true,data};
 });
 const errors=[],financials=new Map(),months=new Map();
 for(let i=0;i<jobs.length;i++){
  const job=jobs[i],result=results[i];
  if(!result.ok){errors.push({market:job.market,type:job.type||'revenue',message:result.error});continue;}
  for(const row of result.data){
   const code=codeOf(row);if(!stockCode(code))continue;
   if(job.type){
    const fin=readFin(row,job.type);if(fin)financials.set(code,choose(financials.get(code),fin));
   }else{
    const rev=readMonth(row);
    if(rev && (!months.has(code)||rev.year*12+rev.month > months.get(code).year*12+months.get(code).month))months.set(code,rev);
   }
  }
 }
 const futures=new Set((top[2].data?.codes||[]).map(String));
 const quotes=[...(top[0].data?.data||[]),...(top[1].data?.data||[])];
 const rows=[],unique=new Set();
 for(const stock of quotes){
  const code=String(stock.code||'').trim(),close=number(stock.close),volume=number(stock.volume_shares);
  if(!stockCode(code)||unique.has(code)||!(close>0)||volume===null||volume<0)continue;
  unique.add(code);
  const share={code,name:String(stock.name||code),market:stock.market||'',
   close,volumeTodayLots:volume/1000,hasFutures:futures.has(code)};
  const fin=financials.get(code)||null,mon=months.get(code)||null;
  const projected=forecast(share,fin,mon);
  rows.push({...share,...projected,financeQuarter:fin?fin.year+'Q'+fin.quarter:null,
   financeYtdEPS:fin?.reportedYtdEPS??null,financeYtdRevenue:fin?.reportedYtdRevenue??null,
   latestRevenueMonth:mon?mon.year+'-'+String(mon.month).padStart(2,'0'):null,
   sourceStatus:projected.status});
 }
 rows.sort((a,b)=>(a.estimatedPE??Infinity)-(b.estimatedPE??Infinity));
 const ok=rows.length>0&&financials.size>0&&months.size>0;
 const payload={ok,version:'R49',date:new Date().toISOString(),
  priceBasis:'latest official daily market snapshot (not guaranteed intraday)',
  epsBasis:'last disclosed cumulative year-to-date EPS, not stand-alone quarter EPS',
  assumptions:'EPS/revenue efficiency held constant; unpublished months held at latest reported month revenue',
  counts:{quotes:quotes.length,stocks:rows.length,eps:financials.size,monthlyRevenue:months.size,
   projected:rows.filter(x=>x.status==='ok').length},
  sources:{twse:top[0].ok,tpex:top[1].ok,futures:top[2].ok,futuresDegraded:!!top[2].data?.degraded},
  errors:[...errors,...top.map((r,i)=>r.ok?null:{market:inputs[i].id,message:r.error}).filter(Boolean)],
  rows,elapsedMs:Date.now()-started};
 const output=response(payload,ok?200:502);
 if(ok){
  const toCache=new Response(JSON.stringify(payload),{headers:{
   'content-type':'application/json;charset=utf-8','cache-control':'public,max-age=900'}});
  try{await cache.put(key,toCache);}catch{}
 }
 return output;
}