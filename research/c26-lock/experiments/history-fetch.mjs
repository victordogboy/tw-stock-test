/** C26 PRIVATE long-history importer using per-stock data_id range queries.
 * FinMind full-market (no data_id) is SINGLE DAY even with end_date; treating
 * it as a month was an invalid research assumption. This importer never does so.
 * All licensed OHLC remains under .c26-private, never GitHub/Actions artifacts.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
const ROOT='.c26-private/rs-history';
const LOCK='C26-EVENT-CORR-LOCK-20261112';
const ref=JSON.parse(fs.readFileSync('research/c26-lock/forward/archive-feature-reference.json','utf8'));
const pool=ref.codes;
if(ref.lock_id!==LOCK||pool.length!==233||new Set(pool).size!==233)throw Error('C26 universe mismatch');
const fromArg=process.argv.find(x=>x.startsWith('--from='))?.slice(7)||'2026-09';
const toArg=process.argv.find(x=>x.startsWith('--to='))?.slice(5)||'2026-10';
if(!/^20\d\d-(0[1-9]|1[0-2])$/.test(fromArg)||!/^20\d\d-(0[1-9]|1[0-2])$/.test(toArg)
 ||fromArg>toArg||fromArg<'2021-01'||toArg>'2026-11')throw Error('Invalid history range');
const token=process.env.FINMIND_TOKEN?.trim();
if(!token)throw Error('FINMIND_TOKEN unavailable in protected Actions');
const nextMonth=m=>{const [y,n]=m.split('-').map(Number);return n===12?(y+1)+'-01':y+'-'+String(n+1).padStart(2,'0')};
const priorDay=d=>new Date(Date.parse(d+'T00:00:00Z')-86400e3).toISOString().slice(0,10);
const first=fromArg+'-01',endExclusive=nextMonth(toArg)+'-01',last=priorDay(endExclusive);
const months=[];for(let m=fromArg;m<=toArg;m=nextMonth(m))months.push(m);
fs.mkdirSync(ROOT,{recursive:true,mode:0o700});
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const redact=e=>String(e?.message||e).replace(/eyJ[A-Za-z0-9._-]+/g,'[secret]');
const files=months.map(m=>path.join(ROOT,m+'.json.gz'));
const prior=files.map(f=>fs.existsSync(f));
if(prior.every(Boolean)){
 const rows=files.map((f,i)=>({month:months[i],rows:JSON.parse(gunzipSync(fs.readFileSync(f))).length}));
 console.log('C26_RS_HISTORY_ALL_MONTHS_CACHED',JSON.stringify({range:[fromArg,toArg],months:rows.length,totalRows:rows.reduce((n,x)=>n+x.rows,0)}));
 process.exit(0);
}
async function request(code,begin,end,depth=0){
 const url='https://api.finmindtrade.com/api/v4/data?'+new URLSearchParams({
  dataset:'TaiwanStockPrice',data_id:code,start_date:begin,end_date:end
 });
 let lastError='';
 for(let attempt=0;attempt<5;attempt++){
  try{
   const r=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(46000),cache:'no-store'});
   if(r.status===401||r.status===403)throw Error('AUTH_DENIED');
   if(r.status===429)throw Error('RATE_LIMITED');
   if(!r.ok)throw Error('HTTP_'+r.status);
   const body=await r.json();
   if(body.status!==200||!Array.isArray(body.data))throw Error('Provider_error_'+body.status);
   // Ensure the endpoint really returned a historical date range.
   return body.data.filter(x=>x.date>=begin&&x.date<=end);
  }catch(e){
   lastError=redact(e);
   if(lastError==='AUTH_DENIED')throw Error('FinMind entitlement denied for historical price query');
   await sleep(2000*(attempt+1));
  }
 }
 const beginTime=Date.parse(begin+'T00:00:00Z'),endTime=Date.parse(end+'T00:00:00Z');
 if(depth>=3||endTime-beginTime<60*86400e3)throw Error('FinMind history data_id call failed ('+code+' '+begin+') '+lastError);
 const midpoint=new Date(beginTime+Math.floor((endTime-beginTime)/86400e3/2)*86400e3).toISOString().slice(0,10);
 const left=await request(code,begin,midpoint,depth+1);
 const right=await request(code,new Date(Date.parse(midpoint+'T00:00:00Z')+86400e3).toISOString().slice(0,10),end,depth+1);
 return [...left,...right];
}
function normalize(r,code){
 const v=[r.open,r.max,r.min,r.close,r.Trading_Volume,r.Trading_money].map(Number);
 const [o,h,l,c,volume,money]=v;
 const valid=v.every(Number.isFinite)&&o>0&&l>0&&h>=l&&o>=l-1e-3&&o<=h+1e-3&&c>=l-1e-3&&c<=h+1e-3&&volume>=0&&money>=0;
 return {date:r.date,code,o,h,l,c,v:volume,m:money,valid};
}
let cursor=0,completed=0;
const map=new Map(months.map(m=>[m,new Map()]));
async function worker(){
 while(cursor<pool.length){
  const i=cursor++,code=pool[i];
  const rows=await request(code,first,last);
  const seen=new Set();
  for(const raw of rows){
   if(raw.stock_id!==code||!/^20\d\d-\d\d-\d\d$/.test(raw.date))throw Error('Wrong per-stock history response for '+code);
   const m=raw.date.slice(0,7);
   if(!map.has(m))continue;
   if(seen.has(raw.date))throw Error('Duplicate OHLC '+code+' '+raw.date);
   seen.add(raw.date);
   map.get(m).set(raw.date+'|'+code,normalize(raw,code));
  }
  completed++;
  if(completed%25===0||completed===pool.length)console.log('C26_RS_HISTORY_STOCK_PROGRESS',JSON.stringify({loaded:completed,total:233,range:[fromArg,toArg]}));
 }
}
await Promise.all(Array.from({length:4},()=>worker()));
const metas=[];
for(const month of months){
 const rows=[...map.get(month).values()].sort((a,b)=>a.date.localeCompare(b.date)||a.code.localeCompare(b.code));
 const days=[...new Set(rows.map(x=>x.date))],counts=days.map(date=>rows.filter(x=>x.date===date&&x.valid).length);
 const min=counts.length?Math.min(...counts):0;
 if(days.length<10||min<165)throw Error('Stock dataset incomplete '+month+': trading_days '+days.length+' min_valid '+min);
 const bytes=gzipSync(JSON.stringify(rows),{level:8});
 const p=path.join(ROOT,month+'.json.gz');
 if(fs.existsSync(p)){
  // A restored cache must agree with independently fetched data; no silent overwrite.
  const old=JSON.parse(gunzipSync(fs.readFileSync(p)));
  if(JSON.stringify(old)!==JSON.stringify(rows))throw Error('Historical C26 research cache changed '+month);
 }else fs.writeFileSync(p,bytes,{mode:0o600});
 metas.push({month,days:days.length,minCoverage:min,records:rows.length,sha256:sha(bytes)});
 console.log('C26_RS_MONTH_READY',JSON.stringify({month,days:days.length,minCoverage:min,records:rows.length}));
}
fs.writeFileSync(path.join(ROOT,'manifest-'+fromArg+'-'+toArg+'.json'),JSON.stringify({
 lock_id:LOCK,months:metas,stock_count:233,raw_public:false,
 disclaimer:'Research only; selected 2026 future-stock pool is survivor-biased. No licensed OHLC copied to public repository.'
},null,2),{mode:0o600});
console.log('C26_RS_HISTORY_IMPORTED',JSON.stringify({from:fromArg,to:toArg,months:months.length,
 rows:metas.reduce((n,m)=>n+m.records,0),priceDataPublished:false}));
