/** C26 independent five-year stock-OHLC research staging, NOT the frozen simulator.
 * FinMind full-market price requests are made only inside private GitHub Actions.
 * Licensed rows remain under .c26-private/ and are never committed/artifact-uploaded.
 * Each cached month is immutable for the duration of a model comparison.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
const ROOT='.c26-private/rs-history',REFER='research/c26-lock/forward/archive-feature-reference.json';
const ref=JSON.parse(fs.readFileSync(REFER,'utf8')),allowed=new Set(ref.codes);
if(allowed.size!==233||ref.lock_id!=='C26-EVENT-CORR-LOCK-20261112')throw Error('C26 universe changed');
const arg=n=>process.argv.find(x=>x.startsWith('--'+n+'='))?.split('=')[1];
const start=arg('from')||'2026-09',end=arg('to')||'2026-10';
const tok=process.env.FINMIND_TOKEN?.trim();
if(!tok)throw Error('FINMIND_TOKEN unavailable in protected runner');
if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(start)||!/^20\d\d-(0[1-9]|1[0-2])$/.test(end)||start>end||start<'2021-01'||end>'2026-11')
 throw Error('Illegal range or beyond frozen study');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const nextDay=d=>new Date(Date.parse(d+'T00:00:00Z')+86400e3).toISOString().slice(0,10);
const monthAfter=d=>{const [y,m]=d.split('-').map(Number);return m===12?String(y+1)+'-01':y+'-'+String(m+1).padStart(2,'0')};
const months=[];for(let m=start;m<=end;m=monthAfter(m))months.push(m);
fs.mkdirSync(ROOT,{recursive:true,mode:0o700});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sanitize=e=>String(e?.message||e).replace(/eyJ[A-Za-z0-9._-]+/g,'[secret]');
async function fetchSlice(begin,endExclusive,depth=0){
 const url='https://api.finmindtrade.com/api/v4/data?'+
 new URLSearchParams({dataset:'TaiwanStockPrice',start_date:begin,end_date:endExclusive});
 let error='';
 for(let k=0;k<3;k++){
  try{
   const r=await fetch(url,{headers:{Authorization:'Bearer '+tok},signal:AbortSignal.timeout(25000),cache:'no-store'});
   if(r.status===401||r.status===403)throw Error('AUTHORIZATION_DENIED');
   if(r.status===429)throw Error('RATE_LIMIT');
   if(!r.ok)throw Error('HTTP_'+r.status);
   const j=await r.json();
   if(j.status!==200||!Array.isArray(j.data))throw Error('FinMind_status_'+j.status);
   return j.data;
  }catch(e){
   error=sanitize(e);
   if(error.includes('AUTHORIZATION_DENIED'))throw Error(error);
   await sleep(1300*(k+1));
  }
 }
 const b=Date.parse(begin+'T00:00:00Z'),e=Date.parse(endExclusive+'T00:00:00Z');
 const days=Math.round((e-b)/86400e3);
 if(days<=1||depth>=6)throw Error('FinMind month range failed (no rows logged): '+begin+' '+endExclusive+' '+error);
 const pivot=new Date(b+Math.floor(days/2)*86400e3).toISOString().slice(0,10);
 return [...await fetchSlice(begin,pivot,depth+1),...await fetchSlice(pivot,endExclusive,depth+1)];
}
function normalize(data,begin,endExclusive){
 const by=new Map();
 for(const r of data){
  if(!allowed.has(String(r.stock_id))||r.date<begin||r.date>=endExclusive)continue;
  const code=String(r.stock_id),date=r.date,key=date+'|'+code;
  const v=[r.open,r.max,r.min,r.close,r.Trading_Volume,r.Trading_money].map(Number);
  const [open,high,low,close,volume,value]=v;
  const valid=v.every(Number.isFinite)&&open>0&&low>0&&high>=low&&open>=low-1e-3&&open<=high+1e-3&&close>=low-1e-3&&close<=high+1e-3&&volume>=0&&value>=0;
  if(by.has(key))throw Error('Duplicate FinMind OHLC '+key);
  by.set(key,{date,code,o:open,h:high,l:low,c:close,v:volume,m:value,valid});
 }
 return [...by.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.code.localeCompare(b.code));
}
function metadata(rows,month){
 const dates=[...new Set(rows.map(x=>x.date))].sort(),byDay=new Map(dates.map(d=>[d,rows.filter(r=>r.date===d)]));
 const coverage=dates.map(d=>({date:d,valid:byDay.get(d).filter(r=>r.valid).length,count:byDay.get(d).length}));
 return {month,dates:dates.length,records:rows.length,
  minCoverage:coverage.length?Math.min(...coverage.map(c=>c.valid)):0,
  invalid:rows.filter(x=>!x.valid).length,
  first:dates.at(0)||null,last:dates.at(-1)||null};
}
async function runMonth(month){
 const out=path.join(ROOT,month+'.json.gz'),begin=month+'-01',endExclusive=monthAfter(month)+'-01';
 if(fs.existsSync(out)){
  const bytes=fs.readFileSync(out),rows=JSON.parse(gunzipSync(bytes));
  if(!Array.isArray(rows)||rows.some(r=>r.date<begin||r.date>=endExclusive))throw Error('Corrupt cache '+month);
  return {...metadata(rows,month),sha256:sha(bytes),reused:true};
 }
 const all=await fetchSlice(begin,endExclusive);
 const rows=normalize(all,begin,endExclusive);
 const meta=metadata(rows,month);
 if(meta.dates<15||meta.minCoverage<175)throw Error('Incomplete month '+month+': days '+meta.dates+' minCoverage '+meta.minCoverage);
 const bytes=gzipSync(JSON.stringify(rows),{level:9});
 fs.writeFileSync(out,bytes,{mode:0o600});
 return {...meta,sha256:sha(bytes),reused:false};
}
const result=[];
for(const month of months){
 const item=await runMonth(month);
 result.push(item);
 console.log('C26_LONG_HISTORY_MONTH',JSON.stringify({month:item.month,tradingDays:item.dates,minCoverage:item.minCoverage,invalid:item.invalid,reused:item.reused}));
}
const summary={schema:1,lock_id:ref.lock_id,universe:233,first_month:start,last_month:end,
 months:result,complete_months:result.length,
 total_rows:result.reduce((v,r)=>v+r.records,0),
 fetched_at:new Date().toISOString(),
 warning:'Independent RS research cache only, no broker trading or full C26 historical replay. Licensed prices remain private.'};
fs.writeFileSync(path.join(ROOT,'manifest-'+start+'-'+end+'.json'),JSON.stringify(summary,null,2),{mode:0o600});
console.log('C26_LONG_HISTORY_SUMMARY',JSON.stringify({from:start,to:end,months:result.length,rows:summary.total_rows,universe:233}));
