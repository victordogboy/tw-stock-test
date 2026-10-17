// R52: preserve stocks even when the OTC quote feed is unavailable; give company lookup a quote fallback.
const FIN_TYPES=['ci','basi','fh','ins','bd','mim'];
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const number=x=>{
 if(x===null||x===undefined)return null;
 const s=String(x).replace(/,/g,'').replace(/\s/g,'').replace(/^\((.*)\)$/,'-$1');
 if(!s||s==='--'||s==='-'||s==='N/A'||s==='不適用')return null;
 const n=Number(s);return Number.isFinite(n)?n:null;
};
const codeOf=r=>String(r['公司代號']||r['股票代號']||r.Code||r.code||'').trim();
const nameOf=r=>String(r['公司簡稱']||r['公司名稱']||r['證券名稱']||r['名稱']||r.Name||r.name||'').trim();
const quoteDateISO=v=>{
 const s=String(v||'').replace(/[^0-9]/g,'');
 if(s.length===7)return (Number(s.slice(0,3))+1911)+'-'+s.slice(3,5)+'-'+s.slice(5);
 if(s.length===8)return s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6);
 return null;
};
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
const field=(r,keys)=>{for(const key of keys){if(Object.prototype.hasOwnProperty.call(r,key)){const v=number(r[key]);if(v!==null)return v;}}return null;};
function readFin(r,type){
 const year=rocYear(r['年度']),q=number(r['季別']);
 const eps=number(r['基本每股盈餘（元）']||r['基本每股盈餘(元)']);
 const revenue=number(r['營業收入']);
 if(!year||![1,2,3,4].includes(q)||eps===null)return null;
 return {year,quarter:q,reportedYtdEPS:eps,reportedYtdRevenue:revenue,
  sector:type,source:'TWSE/MOPS income statement (YTD)',statementIssueDate:String(r['出表日期']||'').trim()||null,
  grossProfit:field(r,['營業毛利（毛損）淨額','營業毛利(毛損)淨額','營業毛利（毛損）','營業毛利(毛損)']),
  opExpenses:field(r,['營業費用','營業費用合計']),
  otherOperating:field(r,['其他收益及費損淨額','其他收益及費損淨額（損失）']),
  nonOperating:field(r,['營業外收入及支出','營業外損益']),
  pretax:field(r,['稅前淨利（淨損）','稅前淨利(淨損)']),
  incomeTax:field(r,['所得稅費用（利益）','所得稅費用(利益)']),
  netIncome:field(r,['本期淨利（淨損）','本期淨利(淨損)']),
  parentIncome:field(r,['淨利（淨損）歸屬於母公司業主','淨利（損）歸屬於母公司業主','淨利歸屬於母公司業主(淨損)','淨利歸屬於母公司業主（淨損）']),
  sourceColumns:Object.keys(r).length};
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
  estimatedPE:share.close>0?share.close/projectedEPS:null,
  epsDisclosed:fin.reportedYtdEPS,
  quarter:fin.year+'Q'+fin.quarter,
  revenueDisclosed:fin.reportedYtdRevenue,
  revenueMonth:month.year+'-'+String(month.month).padStart(2,'0'),
  revenueYtd:month.ytd,revenueLatest:month.monthRevenue,
  revenue3moProxy:elapsedMonths===3?inferredRevenue:null,
  projectedYearRevenue,unreportedRevenue,
  earningsYield:share.close>0?projectedEPS/share.close*100:null,
  annualizationFactor:projectedYearRevenue/fin.reportedYtdRevenue,
  revenueMomentum:month.monthRevenue/(fin.reportedYtdRevenue/(fin.quarter*3))-1
 };
}


// C uses the disclosed YTD EPS as the actual starting point. Future revenue is
// modelled using the last disclosed YTD gross margin and monthly fixed expenses.
// No historical non-operating baseline is available from this bulk endpoint, so
// the forward portion deliberately assumes zero non-operating gains/losses.
function forecastC(share,fin,month,a){
 const fail=status=>({status,eps:null,pe:null,pressurePE:null});
 if(a.status!=='ok')return fail('A 無法計算：'+a.status);
 if(!fin||fin.sector!=='ci')return fail('非一般產業或財報未取得');
 const required=['grossProfit','opExpenses','pretax','incomeTax','netIncome','parentIncome'];
 const missing=required.filter(k=>fin[k]===null||!Number.isFinite(fin[k]));
 if(missing.length)return fail('缺損益表欄位：'+missing.join('、'));
 const rev=fin.reportedYtdRevenue,elapsed=fin.quarter*3,remaining=12-elapsed;
 if(!(rev>0)||!(fin.reportedYtdEPS>0)||!(fin.parentIncome>0)||!(fin.netIncome>0)||!(fin.pretax>0)||remaining<0)
  return fail('稅前損益／歸母淨利／股數無法合理反推');
 const shares=fin.parentIncome/fin.reportedYtdEPS;
 const margin=fin.grossProfit/rev;
 const ratio=fin.parentIncome/fin.netIncome;
 const taxRate=fin.incomeTax/fin.pretax;
 if(!(shares>0)||margin< -0.5||margin>1.5||ratio<=0||ratio>1.2||taxRate<0||taxRate>0.5||fin.opExpenses<0)
  return fail('損益率／稅率／股數異常，停止計算');
 const additionalRevenue=a.projectedYearRevenue-rev;
 if(additionalRevenue<0)return fail('全年營收小於已公告財報營收');
 const otherOp=fin.otherOperating??0;
 const gross=additionalRevenue*margin;
 const operatingProfit=gross-fin.opExpenses/elapsed*remaining+otherOp/elapsed*remaining;
 const aftertax=operatingProfit>0?operatingProfit*(1-taxRate):operatingProfit;
 const additionalParent=aftertax*Math.min(1,ratio);
 const eps=fin.reportedYtdEPS+additionalParent/shares;
 if(!Number.isFinite(eps)||eps<=0||eps>1000)return fail('C 預估 EPS 非正值或異常');
 return {status:'ok',eps,pe:share.close>0?share.close/eps:null,pressurePE:share.close>0?share.close/(eps*0.8):null,
  basis:'已公告累積EPS＋未揭露期間毛利－按月固定營業費用＋其他營業收益；未來業外設0',
  assumptions:'固定已公告毛利率、月營業費用、有效稅率；股數由歸母淨利÷EPS反推；未來業外=0',
  grossMargin:margin,expenseMonthly:fin.opExpenses/elapsed,taxRate,
  inferredSharesThousands:shares,nonOperatingBaseline:'0（缺跨季資料，非歷史正常化）'};
}
function methodModels(share,fin,month,a){
 const A=a.status==='ok'?{status:'ok',eps:a.estimatedEPS,pe:a.estimatedPE,
  pressurePE:share.close>0?share.close/(a.estimatedEPS*0.8):null,basis:'已公告累積EPS按全年推估營收比例外推'}:
  {status:a.status,eps:null,pe:null,pressurePE:null};
 const B={status:'缺最近4～8季歷史損益資料（目前整批官方來源只提供最新財報期）',
  eps:null,pe:null,pressurePE:null,basis:'歷史淨利率與季節性法；未以A代替'};
 const C=forecastC(share,fin,month,a);
 return {A,B,C};
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
 const closes=chart?.indicators?.quote?.[0]?.close||[];
 let lastClose=null,lastQuoteDate=null;
 for(let i=times.length-1;i>=0;i--){
  const day=new Date(times[i]*1000+8*3600000).toISOString().slice(0,10);
  const price=Number(closes[i]);
  if(day<=today&&Number.isFinite(price)&&price>0){lastClose=price;lastQuoteDate=day;break;}
 }
 return {code,avg5Lots:last.reduce((a,b)=>a+b.v,0)/5000,
  dates:last.map(x=>x.d),lastClose,lastQuoteDate,source:'Yahoo Finance 日K'};
}
async function volumeBatch(url){
 const market=url.searchParams.get('market');
 const codes=(url.searchParams.get('codes')||'').split(',').filter(stockCode);
 if(!['twse','tpex'].includes(market)||codes.length<1||codes.length>10||new Set(codes).size!==codes.length)
  return response({ok:false,error:'需提供同市場1～10個不同的四碼股票代號'},400);
 const output=await parallel(codes,3,async c=>({ok:true,...await yahooFiveDayVolume(c,market)}));
 return response({ok:true,market,data:output.map((x,i)=>({...x,code:codes[i]}))});
}


// A single-company report never applies screener thresholds, sorting or the
// chosen PE method. It reuses the official-data snapshot (and its 15-min cache)
// but checks only that stock's recent trading volume.
async function singleStockLookup(request,env,fetchExisting,url){
 const query=(url.searchParams.get('query')||'').trim();
 if(!query||query.length>40)return response({ok:false,error:'請輸入股票代號或公司名稱（最多40字）'},400);
 const sourceUrl=url.origin+'/api/pe-screener/data'+(url.searchParams.get('refresh')==='1'?'?refresh=1':'');
 const allResponse=await forwardPeRoute(new Request(sourceUrl,{headers:request.headers}),env,fetchExisting);
 let snapshot;
 try{snapshot=await allResponse.json();}catch{return response({ok:false,error:'行情／財報來源未回傳有效JSON'},502);}
 if(!allResponse.ok||!snapshot.ok)return response({ok:false,error:'官方行情／財報來源取得失敗',errors:snapshot.errors||[],snapshotTime:snapshot.date||null},502);
 const entries=Array.isArray(snapshot.rows)?snapshot.rows:[];
 const q=query.toLowerCase();
 const matched=entries.filter(r=>String(r.code)===query||String(r.name||'').toLowerCase()===q);
 const found=matched.length?matched:entries.filter(r=>String(r.code||'').includes(query)||String(r.name||'').toLowerCase().includes(q));
 if(!found.length)return response({ok:false,error:'未在現有報價清單找到這檔股票（可能停牌、非一般四碼股票或來源未收錄）',
  searched:query,quotedStockCount:entries.length,sourceErrors:snapshot.errors||[],snapshotTime:snapshot.date||null},404);
 if(found.length>1)return response({ok:true,ambiguous:true,query,candidates:found.slice(0,25).map(r=>({code:r.code,name:r.name,market:r.market})),
  truncated:found.length>25,snapshotTime:snapshot.date||null});
 const stock={...found[0],models:{...(found[0].models||{})}};
 // An inactive or suspended four-digit stock may have no usable quote.
 // Keep its official financials visible rather than screening it away.
 let volume5={ok:false,error:'成交量明細尚未取得'};
 try{
  const detail=await yahooFiveDayVolume(stock.code,stock.market);
  volume5={ok:true,...detail};
  if(!(stock.close>0)&&detail.lastClose>0){
   stock.close=detail.lastClose;stock.quoteReportedDate=detail.lastQuoteDate;
   stock.priceSource=detail.source;stock.priceStatus='Yahoo 日K補價，非交易所官方收盤報價';
   for(const m of Object.values(stock.models)){
    if(m?.status==='ok'&&m.eps>0){m.pe=stock.close/m.eps;m.pressurePE=stock.close/(m.eps*0.8);}
   }
   if(stock.estimatedEPS>0)stock.estimatedPE=stock.close/stock.estimatedEPS;
  }
 }catch(err){volume5={ok:false,error:String(err.message||err)};}
 return response({ok:true,ambiguous:false,query,stock,volume5,
  snapshotTime:snapshot.date||null,priceBasis:snapshot.priceBasis,
  sourceErrors:snapshot.errors||[],sources:snapshot.sources||null,
  note:'單一股票查詢不套用任何股價、成交量、PE或期貨篩選；無法計算的模型會保留缺資料原因。行情屬官方最近日線快照，並非保證盤中即時。'});
}
export async function forwardPeRoute(request,env,fetchExisting){
 const url=new URL(request.url);
 if(request.method!=='GET')return response({ok:false,error:'GET only'},405);
 if(url.pathname==='/api/pe-screener/volume-batch')return volumeBatch(url);
 if(url.pathname==='/api/pe-screener/stock')return singleStockLookup(request,env,fetchExisting,url);
 if(url.pathname==='/api/pe-screener/health')return response({ok:true,version:'R52',method:'A revenue ratio; B needs 4-8 quarterly history; C cumulative gross-profit expense bridge'});
 if(url.pathname!=='/api/pe-screener/data')return response({ok:false,error:'Not found'},404);
 const fresh=url.searchParams.get('refresh')==='1',cache=caches.default;
 const key=new Request(url.origin+'/__cache/eps-forward-r52');
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
 const errors=[],financials=new Map(),months=new Map(),companyMaster=new Map();
 for(let i=0;i<jobs.length;i++){
  const job=jobs[i],result=results[i];
  if(!result.ok){errors.push({market:job.market,type:job.type||'revenue',message:result.error});continue;}
  for(const row of result.data){
   const code=codeOf(row);if(!stockCode(code))continue;
   const name=nameOf(row);
   if(name)companyMaster.set(code,{code,name,market:job.market==='O'?'tpex':'twse',
    masterSource:job.type?'MOPS 損益公司清單':'MOPS 月營收公司清單'});
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
 // Official exchange quote outages should not erase existing OTC stocks.
 // Fetch the independent security directory when any quote source is missing.
 let masterFallback={ok:false,data:[]};
 if(!top[0].ok||!top[1].ok||quotes.length<1700){
  try{
   const response=await fetchExisting(new Request(url.origin+'/api/market/universe',{headers:request.headers}));
   const result=await response.json();
   if(response.ok&&result.ok&&Array.isArray(result.data))masterFallback=result;
  }catch(e){errors.push({market:'master',type:'universe',message:String(e.message||e)});}
 }
 for(const item of masterFallback.data){
  const code=String(item.code||'').trim(),name=String(item.name||'').trim();
  if(stockCode(code)&&name&&!companyMaster.has(code))
   companyMaster.set(code,{code,name,market:item.market==='tpex'?'tpex':'twse',masterSource:'證交所 ISIN 名冊'});
 }
 const mergedQuotes=[...quotes],seenQuoted=new Set(quotes.map(x=>String(x.code||'')));
 for(const item of companyMaster.values()){
  if(seenQuoted.has(item.code))continue;
  mergedQuotes.push({...item,close:null,volume_shares:null,raw:null});
  seenQuoted.add(item.code);
 }
 const rows=[],unique=new Set();
 for(const stock of mergedQuotes){
  const code=String(stock.code||'').trim(),close=number(stock.close),volume=number(stock.volume_shares);
  if(!stockCode(code)||unique.has(code))continue;
  unique.add(code);
  const actualClose=close>0?close:null;
  const share={code,name:String(stock.name||companyMaster.get(code)?.name||code),market:stock.market||'',
   close:actualClose,volumeTodayLots:volume!==null&&volume>=0?volume/1000:null,
   priceSource:actualClose?(stock.market==='tpex'?'TPEx':'TWSE')+' 官方行情':null,
   priceStatus:actualClose?'有官方報價':'官方報價缺漏（不能推論停牌）',
   masterSource:companyMaster.get(code)?.masterSource||null,
   hasFutures:futures.has(code)};
  const fin=financials.get(code)||null,mon=months.get(code)||null;
  const projected=forecast(share,fin,mon);
  const models=methodModels(share,fin,mon,projected);
  const quoteReportedDate=quoteDateISO(stock.raw?.Date||stock.raw?.日期||stock.raw?.資料日期||stock.raw?.TradeDate)||null;
  rows.push({...share,...projected,models,quoteReportedDate,
   statementBasis:fin?.source??null,
   revenueBasis:mon?.source??null,
   revenueLatestRaw:mon?.monthRevenue??null,revenueYtdRaw:mon?.ytd??null,
   financeGrossProfit:fin?.grossProfit??null,financeOperatingExpenses:fin?.opExpenses??null,
   financeOtherOperating:fin?.otherOperating??null,financeNonOperating:fin?.nonOperating??null,
   financeIncomeTax:fin?.incomeTax??null,financePretax:fin?.pretax??null,
   financeNetIncome:fin?.netIncome??null,financeParentIncome:fin?.parentIncome??null,
   financeIssueDate:fin?.statementIssueDate??null,
   financeQuarter:fin?fin.year+'Q'+fin.quarter:null,
   financeYtdEPS:fin?.reportedYtdEPS??null,financeYtdRevenue:fin?.reportedYtdRevenue??null,
   latestRevenueMonth:mon?mon.year+'-'+String(mon.month).padStart(2,'0'):null,
   sourceStatus:projected.status});
 }
 rows.sort((a,b)=>(a.estimatedPE??Infinity)-(b.estimatedPE??Infinity));
 const ok=rows.length>0&&financials.size>0&&months.size>0;
 const payload={ok,version:'R52',date:new Date().toISOString(),
  coverage:{officialQuotes:quotes.length,listedQuotes:quotes.filter(x=>x.market==='twse').length,
   otcQuotes:quotes.filter(x=>x.market==='tpex').length,
   universeCount:rows.length,listedUniverse:rows.filter(x=>x.market==='twse').length,
   otcUniverse:rows.filter(x=>x.market==='tpex').length,
   missingQuotes:rows.filter(x=>!(x.close>0)).length,
   partial:!top[0].ok||!top[1].ok||rows.some(x=>!(x.close>0)),
   companyDirectory:companyMaster.size,isinFallback:!!masterFallback.ok},
  asOf:{snapshotFetchedAt:new Date().toISOString(),timeZone:'Asia/Taipei',
   quotes:'交易所最新日線快照；若來源未提供交易日則標示「未提供」，不可當作即時報價',
   statements:'每檔 financeQuarter 為財報所屬季；financeIssueDate 為來源出表日期（可能無）',
   revenues:'每檔 latestRevenueMonth 為已公布最新月營收所屬月份',
   historicalQuarters:'B 需要4–8季，目前尚未取得，絕不混用當季或A模型替代'},
  priceBasis:'latest official daily market snapshot (not guaranteed intraday)',
  epsBasis:'last disclosed cumulative year-to-date EPS, not stand-alone quarter EPS',
  assumptions:'EPS/revenue efficiency held constant; unpublished months held at latest reported month revenue',
  counts:{quotes:quotes.length,stocks:rows.length,eps:financials.size,monthlyRevenue:months.size,
   projected:rows.filter(x=>x.status==='ok').length,
   models:{A:rows.filter(x=>x.models.A.status==='ok').length,
    B:rows.filter(x=>x.models.B.status==='ok').length,
    C:rows.filter(x=>x.models.C.status==='ok').length}},
  sources:{twse:top[0].ok,tpex:top[1].ok,futures:top[2].ok,
   masterFallback:!!masterFallback.ok,futuresDegraded:!!top[2].data?.degraded},
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