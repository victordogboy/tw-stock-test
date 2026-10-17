// Dedicated TX endpoints. Credentials are only forwarded in Authorization headers.
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,OPTIONS'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export async function taiexFuturesRoute(request,env={}){
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='GET')return json({ok:false,error:'僅支援 GET'},405);
  const url=new URL(request.url),kind=url.pathname.split('/').at(-1);
  if(!['history','quote'].includes(kind))return json({ok:false,error:'找不到台指期功能'},404);
  const token=(request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]||env.FINMIND_TOKEN||'').trim();
  let upstream;
  if(kind==='history'){
    const start=url.searchParams.get('start_date')||'',end=url.searchParams.get('end_date')||'';
    if(!validDate(start)||!validDate(end)||start>end||(Date.parse(end)-Date.parse(start))/86400000>2000)return json({ok:false,error:'日期須有效，起訖範圍最多 2,000 天'},400);
    upstream='https://api.finmindtrade.com/api/v4/data?'+new URLSearchParams({dataset:'TaiwanFuturesDaily',data_id:'TX',start_date:start,end_date:end});
  }else{
    if(!token)return json({ok:false,error:'台指期盤中報價需要有 sponsor 權限的 FinMind Token；日 K 可另外載入。'},401);
    upstream='https://api.finmindtrade.com/api/v4/taiwan_futures_snapshot?data_id=TXF';
  }
  try{
    // Scope cached market data by credential digest; never put tokens in URLs or responses.
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token||'anonymous'))),b=>b.toString(16).padStart(2,'0')).join('');
    const key=new Request(url.origin+'/__tx_cache/r36/'+digest+'/'+kind+'?'+(kind==='history'?new URL(upstream).searchParams.toString():''));
    const cache=globalThis.caches?.default;
    if(url.searchParams.get('refresh')!=='1'&&cache){const hit=await cache.match(key);if(hit)return json({...await hit.json(),cache_hit:true});}
    const response=await fetch(upstream,{headers:{accept:'application/json',...(token?{Authorization:'Bearer '+token}:{})},signal:AbortSignal.timeout(25000)});
    const raw=await response.json().catch(()=>null);
    if(!response.ok||!raw||Number(raw.status)!==200||!Array.isArray(raw.data)){
      const code=Number(raw?.status)||response.status;
      const error=[401,402,403].includes(code)?'FinMind 權限不足或 Token 無效；請確認帳號權限與目前選用 Token。':code===429?'FinMind 請求額度已達上限，請稍後再試。':'FinMind 暫時未提供有效台指期資料，請稍後再試。';
      return json({ok:false,error,upstream_status:code},[401,402,403,429].includes(code)?code:502);
    }
    let data;
    if(kind==='history'){
      const start=url.searchParams.get('start_date'),end=url.searchParams.get('end_date');
      data=raw.data.filter(r=>r.futures_id==='TX'&&validDate(r.date)&&r.date>=start&&r.date<=end).map(r=>({date:r.date,futures_id:'TX',contract_date:r.contract_date,open:r.open,max:r.max,min:r.min,close:r.close,volume:r.volume,open_interest:r.open_interest,trading_session:r.trading_session,settlement_price:r.settlement_price}));
    }else{
      const quote=raw.data.find(r=>r.futures_id==='TXFR1');
      if(!quote)return json({ok:false,error:'來源未提供可辨識的 TXFR1 近月報價；不以其他月份替代。'},502);
      data=[Object.fromEntries(['futures_id','date','open','high','low','close','change_price','change_rate','total_volume'].map(k=>[k,quote[k]]))];
    }
    const payload={ok:true,source:kind==='history'?'FinMind TaiwanFuturesDaily':'FinMind taiwan_futures_snapshot',kind,symbol:'TX',data,fetched_at:new Date().toISOString(),cache_hit:false};
    if(data.length&&cache)try{await cache.put(key,new Response(JSON.stringify(payload),{headers:{'content-type':'application/json','cache-control':'public,max-age='+(kind==='history'?900:30)}}));}catch{}
    return json(payload);
  }catch{return json({ok:false,error:'台指期資料連線失敗或逾時，請稍後重試。'},502);}
}
