// R26 historical named-contract minute K bridge. No change to R26 trading rules.
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-methods':'GET, OPTIONS','access-control-allow-headers':'Authorization, Content-Type'};
const J=(v,s=200)=>new Response(JSON.stringify(v),{status:s,headers:H});
const DAY=86400000;
const isDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'') && Number.isFinite(Date.parse(s+'T00:00:00Z')) && new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const prev=d=>new Date(Date.parse(d+'T00:00:00Z')-DAY).toISOString().slice(0,10);
export function normalizeFinmindR26(rows,dt,month=''){
 if(!Array.isArray(rows))throw Error('Invalid FinMind data');
 const seen=new Set(),out=[];
 for(const r of rows){
  if(r?.futures_id!=='TX'||!/^\d{6}$/.test(String(r.contract_date||''))||(month&&String(r.contract_date)!==month)||r.date!==dt)continue;
  const time=String(r.minute||'');
  if(!/^\d{2}:\d{2}:\d{2}$/.test(time))continue;
  const h=+time.slice(0,2),mn=+time.slice(3,5),ss=+time.slice(6,8);
  if(h>23||mn>59||ss>59)continue;
  const m=h*60+mn,day=m>=525&&m<=824,night=m>=900||m<300;
  if(!day&&!night)continue;
  const [o,hi,lo,c,v]=['open','high','low','close','volume'].map(k=>Number(r[k]));
  if(![o,hi,lo,c,v].every(Number.isFinite)||lo<=0||hi<Math.max(o,c,lo)||lo>Math.min(o,c)||v<0)continue;
  const key=r.contract_date+'|'+r.date+'|'+time;if(seen.has(key))continue;seen.add(key);
  const openDate=day||m>=900?dt:prev(dt);
  out.push({timestamp_tpe:dt+' '+time,contract_date:r.contract_date,session:day?'day':'night',
   session_key:(day?'day:':'night:')+openDate,session_start_date:openDate,
   open:o,high:hi,low:lo,close:c,volume:v,source:'FinMind TaiwanFuturesKBar',
   time_convention:'minute-start',contract_verified:true,trade_date:null});
 }
 return out.sort((a,b)=>a.timestamp_tpe.localeCompare(b.timestamp_tpe)||a.contract_date.localeCompare(b.contract_date));
}
export async function r26BridgeRoute(request,env,fetchImpl=fetch){
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:H});
 if(request.method!=='GET')return J({ok:false,error:'Method not allowed'},405);
 const u=new URL(request.url),p=u.pathname;
 if(p==='/api/r26/health')return J({ok:true,version:'r26-data-bridge-1',auth:'browser bearer token',
  note:'Named-contract historical TX KBar only. Live quote and R26 state replay require separate verification.'});
 if(p!=='/api/r26/kbar')return J({ok:false,error:'Endpoint not found'},404);
 const date=u.searchParams.get('date'),contract=u.searchParams.get('contract')||'';
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date());
 if(!isDate(date)||date<'2011-01-03'||date>today)return J({ok:false,error:'Invalid historical date'},400);
 if(contract&&(!/^20\d{4}$/.test(contract)||+contract.slice(4)<1||+contract.slice(4)>12))return J({ok:false,error:'Invalid monthly contract, use YYYYMM'},400);
 const token=(request.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
 if(!token||token.length>4096||/[\r\n]/.test(token))return J({ok:false,error:'Browser FinMind token required'},401);
 const endpoint='https://api.finmindtrade.com/api/v4/data?'+new URLSearchParams({dataset:'TaiwanFuturesKBar',data_id:'TX',start_date:date});
 try{
  const r=await fetchImpl(endpoint,{headers:{'authorization':'Bearer '+token,'accept':'application/json'},signal:AbortSignal.timeout(25000)});
  let body;try{body=await r.json()}catch{return J({ok:false,error:'FinMind did not return JSON',upstream_status:r.status},502)}
  if(!r.ok||body?.status!==200||!Array.isArray(body?.data))return J({ok:false,error:'FinMind rejected request or returned unexpected data',
   upstream_status:r.status,finmind_status:body?.status,reason:String(body?.msg||'').slice(0,120)},r.status===401?401:502);
  const data=normalizeFinmindR26(body.data,date,contract);
  return J({ok:true,date,contract:contract||null,rows:data.length,source:'FinMind TaiwanFuturesKBar',
   retrieved_at:new Date().toISOString(),bar_time_zone:'Asia/Taipei',
   warning:'Historical KBar only. Missing minutes may represent no trades; no forward-fill. Trade date needs exchange calendar.',
   data});
 }catch(e){return J({ok:false,error:'FinMind upstream unavailable',reason:String(e?.message||e).slice(0,180)},502)}
}
