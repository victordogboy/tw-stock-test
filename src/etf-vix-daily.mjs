// 0050 + TaiwanOptionVix daily download proxy.
// Explicit allowlist prevents this endpoint from becoming a generic FinMind proxy.
const ALLOWED = new Set(['TaiwanStockPrice','TaiwanStockPriceAdj','TaiwanOptionVix']);
function reply(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}
  });
}
export async function etfVixDailyRoute(request,env) {
  if (request.method !== 'GET') return reply({status:405,msg:'GET only',data:[]},405);
  const url=new URL(request.url);
  const dataset=url.searchParams.get('dataset')||'';
  const start=url.searchParams.get('start_date')||'';
  const end=url.searchParams.get('end_date')||'';
  const dataId=url.searchParams.get('data_id')||'';
  if(!ALLOWED.has(dataset))return reply({status:400,msg:'Dataset not allowed',data:[]},400);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)
    return reply({status:400,msg:'Invalid date range',data:[]},400);
  const days=(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000;
  if(!Number.isFinite(days)||days<0||days>(dataset==='TaiwanOptionVix'?14:3660))
    return reply({status:400,msg:'Date window too wide',data:[]},400);
  if(dataset==='TaiwanOptionVix'&&dataId)
    return reply({status:400,msg:'VIX does not use data_id',data:[]},400);
  if(dataset!=='TaiwanOptionVix'&&dataId!=='0050')
    return reply({status:400,msg:'Only 0050 is supported',data:[]},400);
  const fromRequest=/^Bearer\s+(.+)$/i.exec(request.headers.get('authorization')||'')?.[1]?.trim()||'';
  const token=fromRequest||String(env?.FINMIND_TOKEN||'').trim();
  const q=new URLSearchParams({dataset,start_date:start,end_date:end});
  if(dataset!=='TaiwanOptionVix')q.set('data_id','0050');
  const headers={accept:'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  try{
    const upstream=await fetch('https://api.finmindtrade.com/api/v4/data?'+q.toString(),{
      method:'GET',headers,signal:AbortSignal.timeout(55000)
    });
    let body;
    try{body=await upstream.json()}catch{return reply({status:502,msg:'FinMind returned non-JSON',data:[]},502)}
    const ok=upstream.ok&&Number(body?.status)===200&&Array.isArray(body?.data);
    if(!ok)return reply({status:Number(body?.status)||upstream.status,msg:String(body?.msg||'FinMind access error').slice(0,240),data:[]},upstream.ok?403:upstream.status);
    return reply({status:200,msg:body.msg||'success',data:body.data});
  }catch(e){
    return reply({status:502,msg:'FinMind upstream unavailable: '+String(e?.message||e).slice(0,150),data:[]},502);
  }
}
