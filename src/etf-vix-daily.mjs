// Dedicated same-origin FinMind proxy for 0050 and TaiwanOptionVix daily downloads.
// Keep credential values out of JSON responses, logs, URLs and browser storage.
const DATASETS=new Set(['TaiwanStockPrice','TaiwanStockPriceAdj','TaiwanOptionVix']);
const MODES=new Set(['auto','cloud','browser','manual','anonymous']);
function json(data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff'
  }});
}
function normalizeToken(raw){
  let t=String(raw||'').trim().replace(/^["']|["']$/g,'').trim();
  // A copied "Bearer XXX" value must not become "Bearer Bearer XXX".
  t=t.replace(/^Bearer\s+/i,'').trim();
  return t;
}
async function cloudToken(env,origin){
  const secret=normalizeToken(env?.FINMIND_TOKEN);
  if(secret)return {token:secret,source:'cloud-secret'};
  try{
    const key=new Request(origin+'/__private/finmind-token-slot-v1',{method:'GET'});
    const match=await caches.default.match(key);
    if(!match)return {token:'',source:'none'};
    const saved=await match.json();
    if(!(Number(saved?.expires_at)>Date.now()))return {token:'',source:'none'};
    const token=normalizeToken(saved?.token);
    return {token,source:token?'cloud-saved':'none'};
  }catch{
    return {token:'',source:'none'};
  }
}
function credentialError(mode){
  if(mode==='cloud')return 'Cloudflare 未設定 FINMIND_TOKEN，或七日伺服器暫存已過期；請改用原網站 Token 或重新輸入。';
  return '此認證來源沒有 Token；請改用其他來源，或在 FinMind 官網取得新的 API Token。';
}
function classify(rawStatus,httpStatus,msg){
  const message=String(msg||'FinMind 未提供錯誤內容').slice(0,240);
  if(/token is illegal|invalid token|token.*(?:invalid|illegal|expired)|無效.*token|權杖無效/i.test(message))
    return {status:401,code:'AUTH_INVALID',msg:'FinMind 拒絕此 Token（Token is illegal）。請更換有效 Token 或改選其他認證來源。'};
  if(httpStatus===429||rawStatus===402||rawStatus===429||/limit|quota|requests reach/i.test(message))
    return {status:429,code:'QUOTA',msg:message};
  if(/backer|sponsor|subscription|permission|denied|無權|付費|權限不足/i.test(message))
    return {status:403,code:'ACCESS_DENIED',msg:message};
  return {status:502,code:'FINMIND_ERROR',msg:message};
}
export async function etfVixDailyRoute(request,env){
  if(request.method!=='GET')return json({status:405,msg:'GET only'},405);
  const url=new URL(request.url);
  const action=url.searchParams.get('action')||'download';
  const mode=url.searchParams.get('credential')||'auto';
  if(!MODES.has(mode))return json({status:400,msg:'Invalid credential mode'},400);
  const cloud=await cloudToken(env,url.origin);
  if(action==='status'){
    return json({status:200,cloud_available:!!cloud.token,cloud_source:cloud.source,
      note:'已設定不代表認證有效，請按測試驗證；不會回傳任何 Token。'});
  }
  if(!['download','probe','probe-vix'].includes(action))
    return json({status:400,msg:'Invalid action'},400);
  const authorization=String(request.headers.get('authorization')||'');
  const headerToken=normalizeToken(authorization.replace(/^Bearer\s+/i,''));
  let token='',source='anonymous';
  if(mode==='cloud'){
    token=cloud.token;source=cloud.source;
  }else if(mode==='browser'||mode==='manual'){
    token=headerToken;source=mode;
  }else if(mode==='auto'){
    token=headerToken||cloud.token;
    source=headerToken?'browser-or-manual':cloud.source;
  }
  if(mode!=='anonymous'&&!token&&mode!=='auto')
    return json({status:401,code:'TOKEN_MISSING',credential_source:source,msg:credentialError(mode)},401);
  if(mode==='auto'&&!token)source='anonymous';
  const probe=action==='probe'||action==='probe-vix';
  let dataset,start,end,dataId;
  if(probe){
    dataset=action==='probe-vix'?'TaiwanOptionVix':'TaiwanStockPrice';
    // Probe with one short request, so diagnostics never launch a multi-year download.
    const today=new Date();
    const fmt=d=>d.toISOString().slice(0,10);
    const from=new Date(today.getTime()-(dataset==='TaiwanOptionVix'?8:12)*86400000);
    const to=new Date(today.getTime()-1*86400000);
    start=fmt(from);end=fmt(to);dataId=dataset==='TaiwanOptionVix'?'':'0050';
  }else{
    dataset=url.searchParams.get('dataset')||'';
    start=url.searchParams.get('start_date')||'';
    end=url.searchParams.get('end_date')||'';
    dataId=url.searchParams.get('data_id')||'';
    if(!DATASETS.has(dataset))return json({status:400,msg:'Dataset not allowed'},400);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end)
      return json({status:400,msg:'Invalid date range'},400);
    const days=(Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000;
    if(!Number.isFinite(days)||days<0||days>(dataset==='TaiwanOptionVix'?14:3660))
      return json({status:400,msg:'Date window too wide'},400);
    if(dataset==='TaiwanOptionVix'&&dataId)return json({status:400,msg:'VIX does not use data_id'},400);
    if(dataset!=='TaiwanOptionVix'&&dataId!=='0050')return json({status:400,msg:'Only 0050 is supported'},400);
  }
  const q=new URLSearchParams({dataset,start_date:start,end_date:end});
  if(dataset!=='TaiwanOptionVix')q.set('data_id','0050');
  const headers={accept:'application/json'};
  if(token)headers.Authorization='Bearer '+token;
  try{
    const upstream=await fetch('https://api.finmindtrade.com/api/v4/data?'+q,{method:'GET',headers,signal:AbortSignal.timeout(55000)});
    let body;
    try{body=await upstream.json()}catch{return json({status:502,code:'BAD_RESPONSE',credential_source:source,msg:'FinMind 回應不是 JSON'},502)}
    const ok=upstream.ok&&Number(body?.status)===200&&Array.isArray(body?.data);
    if(!ok){
      const problem=classify(Number(body?.status),upstream.status,body?.msg);
      return json({status:problem.status,provider_status:body?.status??upstream.status,
        code:problem.code,credential_source:source,msg:problem.msg},problem.status);
    }
    if(probe)return json({status:200,ok:true,credential_source:source,dataset,rows:body.data.length,
      note:'FinMind 認證與資料集請求成功；若筆數為 0，請再核對交易日或資料集涵蓋範圍。'});
    return json({status:200,msg:body.msg||'success',credential_source:source,data:body.data});
  }catch(e){
    return json({status:502,code:'UPSTREAM_UNAVAILABLE',credential_source:source,
      msg:'FinMind 連線失敗：'+String(e?.message||e).slice(0,150)},502);
  }
}
