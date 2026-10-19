// R49: TX VIX overlay data. Never substitute guessed volatility values.
const jsonHeaders={'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-headers':'Content-Type,Authorization','access-control-allow-methods':'GET,OPTIONS'};
const json=(payload,status=200)=>new Response(JSON.stringify(payload),{status,headers:jsonHeaders});
const dateOK=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const finitePositive=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>0;
const pad=n=>String(n).padStart(2,'0');

export function parseCboeVixCsv(csv,start,end){
 const lines=String(csv||'').replace(/^\uFEFF/,'').trim().split(/\r?\n/);
 const head=(lines.shift()||'').replace(/"/g,'').split(',').map(s=>s.trim().toUpperCase());
 const di=head.indexOf('DATE'),ci=head.indexOf('CLOSE');
 if(di<0||ci<0)throw Error('Cboe VIX CSV 缺少 DATE／CLOSE 欄位');
 const byDate=new Map();
 for(const line of lines){
   const fields=line.replace(/"/g,'').split(',');
   const raw=(fields[di]||'').trim();
   const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
   const date=m?m[3]+'-'+pad(m[1])+'-'+pad(m[2]):raw;
   const value=Number(fields[ci]);
   if(!dateOK(date)||date<start||date>end||!finitePositive(value))continue;
   byDate.set(date,{date,value:Number(value.toFixed(4))});
 }
 return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

export function parseFredVixCsv(csv,start,end){
 const lines=String(csv||'').replace(/^\uFEFF/,'').trim().split(/\r?\n/);
 const head=(lines.shift()||'').replace(/"/g,'').split(',').map(s=>s.trim().toUpperCase());
 const di=head.indexOf('OBSERVATION_DATE')>=0?head.indexOf('OBSERVATION_DATE'):head.indexOf('DATE'),vi=head.indexOf('VIXCLS');
 if(di<0||vi<0)throw Error('FRED CSV 缺少日期／VIXCLS 欄位');
 const data=new Map();
 for(const line of lines){
   const fields=line.replace(/"/g,'').split(','),date=(fields[di]||'').trim(),value=Number(fields[vi]);
   if(dateOK(date)&&date>=start&&date<=end&&finitePositive(value))data.set(date,{date,value});
 }
 return [...data.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

export function latestTaiwanVixByDay(rows,start,end){
 const byDate=new Map();
 for(const row of rows||[]){
   const date=String(row?.date||''),time=String(row?.time||'');
   const value=Number(row?.vix);
   // Normal daytime observations only; do not use future/invalid timestamps.
   if(!dateOK(date)||date<start||date>end||!/^\d{2}:\d{2}(?::\d{2})?$/.test(time)||time>'13:45:59'||time<'09:00:00'||!finitePositive(value))continue;
   const before=byDate.get(date);
   if(!before||time>before.time)byDate.set(date,{date,time,value:Number(value.toFixed(4))});
 }
 return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
}

export async function taiexVixRoute(request,env={}){
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:jsonHeaders});
 if(request.method!=='GET')return json({ok:false,error:'僅支援 GET'},405);
 const url=new URL(request.url),market=url.searchParams.get('market')||'us';
 const start=url.searchParams.get('start_date')||'',end=url.searchParams.get('end_date')||'';
 if(!['us','tw'].includes(market))return json({ok:false,error:'VIX 市場須為 tw 或 us'},400);
 if(!dateOK(start)||!dateOK(end)||start>end||Date.parse(end)-Date.parse(start)>2000*86400000)return json({ok:false,error:'VIX 日期不正確，最多查詢 2,000 天'},400);
 if(market==='tw'&&(start<'2026-03-01'||(Date.parse(end)-Date.parse(start))>16*86400000))
   return json({ok:false,error:'FinMind 臺灣 VIX 自 2026-03-01 起提供，單次最多 17 天；歷史由前端分段取得'},400);
 const token=(request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]||env.FINMIND_TOKEN||'').trim();
 if(market==='tw'&&!token)return json({ok:false,code:'TOKEN_REQUIRED',error:'臺灣 VIX 需要 FinMind Backer／Sponsor Token，請先在上方設定。可切換美國 VIX（免 Token）。'},401);
 try{
   const digest=market==='us'?'public':Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
   const key=new Request(url.origin+'/__tx_vix/r492/'+market+'/'+digest+'?'+new URLSearchParams({start_date:start,end_date:end}).toString());
   const cache=globalThis.caches?.default;
   if(url.searchParams.get('refresh')!=='1'&&cache){
     const hit=await cache.match(key);
     if(hit)return json({...await hit.json(),cache_hit:true});
   }
   let data=[],source='',coverage='';
   if(market==='tw'){
     const upstream='https://api.finmindtrade.com/api/v4/data?'+new URLSearchParams({dataset:'TaiwanOptionVix',start_date:start,end_date:end});
     const response=await fetch(upstream,{headers:{accept:'application/json',Authorization:'Bearer '+token},signal:AbortSignal.timeout(25000)});
     const body=await response.json().catch(()=>null),status=Number(body?.status)||response.status;
     if(!response.ok||status!==200||!Array.isArray(body?.data)){
       const permission=[401,402,403].includes(status);
       return json({ok:false,code:permission?'PERMISSION_REQUIRED':status===429?'RATE_LIMIT':'UPSTREAM_ERROR',
         error:permission?'FinMind 臺灣 VIX 須 Backer／Sponsor 權限；請確認 Token，或改看美國 VIX。':status===429?'FinMind VIX 查詢額度已滿；保留台指期原圖。':'FinMind 臺灣 VIX 資料服務暫時失敗。'},permission?403:status===429?429:502);
     }
     data=latestTaiwanVixByDay(body.data,start,end);
     source='FinMind TaiwanOptionVix';
     coverage='日盤最後有效觀測值（不等於官方收盤前一分鐘平均值）';
   }else{
     // Independent delivery paths for the same US VIX daily-close series.
     const sources=[
       {url:'https://cdn-api.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv',name:'Cboe VIX_History.csv',parse:parseCboeVixCsv},
       {url:'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv',name:'Cboe VIX_History.csv',parse:parseCboeVixCsv},
       {url:'https://fred.stlouisfed.org/graph/fredgraph.csv?'+new URLSearchParams({id:'VIXCLS',cosd:start,coed:end}),name:'FRED VIXCLS（原始來源 Cboe；備援）',parse:parseFredVixCsv}
     ];
     for(const candidate of sources){
       try{
         const response=await fetch(candidate.url,{headers:{accept:'text/csv,text/plain'},signal:AbortSignal.timeout(12000)});
         if(!response.ok)continue;
         const parsed=candidate.parse(await response.text(),start,end);
         if(!parsed.length)continue;
         data=parsed;source=candidate.name;break;
       }catch{}
     }
     if(!data.length)return json({ok:false,error:'Cboe 與 FRED 均未取得所選區間的有效美國 VIX；請稍後重試或確認日期。'},502);
     coverage='美國交易日收盤值；繪圖採嚴格早於臺指期交易日之最新美國收盤，避免同日先看未公布資訊';
   }
   const payload={ok:true,kind:'vix',market,data,source,coverage,
     available_from:market==='tw'?'2026-03-01':'1990-01-02',
     fetched_at:new Date().toISOString(),cache_hit:false};
   // Cache only actual observations; the current partial day should refresh automatically.
   if(data.length&&cache){
     const age=Date.now()-Date.parse(end+'T00:00:00Z');
     const ttl=age>4*86400000?86400:market==='us'?3600:900;
     try{await cache.put(key,new Response(JSON.stringify(payload),{headers:{'content-type':'application/json','cache-control':'public,max-age='+ttl}}));}catch{}
   }
   return json(payload);
 }catch(e){return json({ok:false,error:'VIX 資料讀取逾時或格式異常：'+String(e?.message||'未知錯誤')},502);}
}
