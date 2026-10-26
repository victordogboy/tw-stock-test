// TWSE ETF historical cash dividends. This route is deliberately restricted to 0050.
// Source: https://www.twse.com.tw/rwd/zh/ETF/etfDiv?startDate=2005&endDate=YYYY&response=json
function respond(v,status=200){return new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}
function twseDate(value){
 const t=String(value??'').trim().replace(/[^0-9]/g,'');
 if(t.length!==7&&t.length!==8)return '';
 const year=Number(t.slice(0,-4));const y=(t.length===7?year+1911:year);
 const m=Number(t.slice(-4,-2)),d=Number(t.slice(-2));
 const dt=new Date(Date.UTC(y,m-1,d));
 return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d
  ?String(y)+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0'):'';
}
function numeric(value){const s=String(value??'').trim().replaceAll(',','');if(!s||s==='--'||s==='-'||s==='尚未公告')return null;const v=Number(s);return Number.isFinite(v)&&v>=0?v:null}
export function normalizeEtfDividends(rows,start,end){
 const map=new Map();
 for(const row of rows||[]){
  if(!Array.isArray(row)||row.length<8||String(row[0]).trim()!=='0050')continue;
  const date=twseDate(row[2]);if(!date||date<start||date>end)continue;
  const amount=numeric(row[5]);
  if(amount===null||amount<=0)continue; // missing amount is NOT a zero dividend
  map.set(date,{date,cash_dividend:amount,payment_date:twseDate(row[4]),record_date:twseDate(row[3]),source:'TWSE ETF etfDiv'});
 }
 return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
export async function etfDividendRoute(request){
 if(request.method!=='GET')return respond({ok:false,error:'GET only'},405);
 const url=new URL(request.url);
 const start=url.searchParams.get('start_date')||'2005-01-01';
 const end=url.searchParams.get('end_date')||new Date().toISOString().slice(0,10);
 const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'));
 if(!valid(start)||!valid(end)||start>end||start<'2005-01-01'||end>'2100-01-01')
  return respond({ok:false,error:'Invalid date range'},400);
 const eYear=Number(end.slice(0,4));
 const q=new URLSearchParams({startDate:'2005',endDate:String(eYear),response:'json'});
 const upstream='https://www.twse.com.tw/rwd/zh/ETF/etfDiv?'+q;
 try{
  const res=await fetch(upstream,{headers:{accept:'application/json','user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(45000)});
  if(!res.ok)return respond({ok:false,error:'TWSE ETF dividend endpoint HTTP '+res.status},502);
  const data=await res.json();
  if(!Array.isArray(data?.data))return respond({ok:false,error:'TWSE ETF response format invalid; no dividends marked as complete'},502);
  const rows=normalizeEtfDividends(data.data,start,end);
  return respond({ok:true,source:'TWSE ETF etfDiv',start_date:start,end_date:end,rows,count:rows.length,
   note:'The official endpoint has records from 2005 onward; earlier dates are not covered.'});
 }catch(e){return respond({ok:false,error:'TWSE ETF request failed: '+String(e?.message||e).slice(0,160)},502)}
}
