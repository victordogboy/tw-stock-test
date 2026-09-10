const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "Content-Type,Authorization",
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...JSON_HEADERS, ...CORS, ...extra },
  });
}

async function fetchJson(url, init = {}) {
  const r = await fetch(url, {
    ...init,
    headers: {
      "accept": "application/json,text/plain,*/*",
      "user-agent": "tw-stock-api/1.0",
      ...(init.headers || {}),
    },
  });

  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  if (!r.ok) {
    throw new Error(`Upstream ${r.status}: ${text.slice(0, 300)}`);
  }
  if (body === null) {
    throw new Error(`Upstream returned non-JSON: ${text.slice(0, 300)}`);
  }
  return body;
}

function normalizeTwse(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(x => ({
    market: "twse",
    code: String(x.Code ?? x.code ?? "").trim(),
    name: String(x.Name ?? x.name ?? "").trim(),
    close: Number(String(x.ClosingPrice ?? x.Close ?? x.close ?? "").replace(/,/g, "")),
    change: Number(String(x.Change ?? x.change ?? "").replace(/,/g, "")),
    volume_shares: Number(String(x.TradeVolume ?? x.Trading_Volume ?? x.volume ?? "").replace(/,/g, "")),
    turnover: Number(String(x.TradeValue ?? x.turnover ?? "").replace(/,/g, "")),
    open: Number(String(x.OpeningPrice ?? x.Open ?? x.open ?? "").replace(/,/g, "")),
    high: Number(String(x.HighestPrice ?? x.High ?? x.high ?? "").replace(/,/g, "")),
    low: Number(String(x.LowestPrice ?? x.Low ?? x.low ?? "").replace(/,/g, "")),
    raw: x,
  })).filter(x => x.code);
}


async function fetchTpexAll() {
  const attempts = [];

  // Strategy A: official OpenAPI endpoints
  const openapiCandidates = [
    "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
    "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes"
  ];

  for (const u of openapiCandidates) {
    try {
      const r = await fetch(u, {
        redirect: "manual",
        headers: {
          "accept": "application/json",
          "user-agent": "Mozilla/5.0 (compatible; tw-stock-api/1.2)"
        }
      });
      const location = r.headers.get("location");
      attempts.push({strategy:"openapi",url:u,status:r.status,location});
      if (r.status >= 300 && r.status < 400) continue;
      if (!r.ok) continue;
      const text = await r.text();
      try {
        const body = JSON.parse(text);
        if (Array.isArray(body) && body.length) {
          return { ok:true, raw:body, upstream:u, attempts, mode:"openapi" };
        }
      } catch {}
    } catch(e) {
      attempts.push({strategy:"openapi",url:u,error:String(e?.message||e)});
    }
  }

  // Strategy B: TPEx official webpage JSON interface.
  // The public Daily Stock Quotes page is still available and exposes data
  // through its webpage backend. Try current-date and empty-date forms.
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const webpageCandidates = [
    `https://www.tpex.org.tw/www/zh-tw/mainboard/trading/info/pricing?date=${today}&id=&response=json`,
    `https://www.tpex.org.tw/www/zh-tw/mainboard/trading/info/pricing?date=&id=&response=json`,
    `https://www.tpex.org.tw/zh-tw/mainboard/trading/info/pricing.html?date=${today}&id=&response=json`,
    `https://www.tpex.org.tw/zh-tw/mainboard/trading/info/pricing.html?date=&id=&response=json`
  ];

  for (const u of webpageCandidates) {
    try {
      const r = await fetch(u, {
        redirect: "manual",
        headers: {
          "accept": "application/json,text/plain,*/*",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
          "referer": "https://www.tpex.org.tw/zh-tw/mainboard/trading/info/pricing.html"
        }
      });
      const location = r.headers.get("location");
      attempts.push({strategy:"webpage-json",url:u,status:r.status,location,contentType:r.headers.get("content-type")});
      if (r.status >= 300 && r.status < 400) continue;
      if (!r.ok) continue;
      const text = await r.text();

      let body;
      try { body = JSON.parse(text); } catch { body = null; }
      if (!body) continue;

      // Known TPEx webpage JSON payloads commonly wrap tables under tables[]
      // with rows stored in data / rows.
      const candidates = [];
      if (Array.isArray(body)) candidates.push(body);
      if (Array.isArray(body.data)) candidates.push(body.data);
      if (Array.isArray(body.rows)) candidates.push(body.rows);
      if (Array.isArray(body.tables)) {
        for (const t of body.tables) {
          if (Array.isArray(t?.data)) candidates.push(t.data);
          if (Array.isArray(t?.rows)) candidates.push(t.rows);
        }
      }

      for (const arr of candidates) {
        if (arr.length) {
          return {
            ok:true,
            raw:arr,
            upstream:u,
            attempts,
            mode:"webpage-json",
            payload_meta:{
              topKeys:Object.keys(body).slice(0,20),
              tableCount:Array.isArray(body.tables)?body.tables.length:null
            }
          };
        }
      }
    } catch(e) {
      attempts.push({strategy:"webpage-json",url:u,error:String(e?.message||e)});
    }
  }

  return { ok:false, raw:[], upstream:null, attempts };
}

function normalizeTpex(rows) {
  if (!Array.isArray(rows)) return [];

  return rows.map(x => {
    // Object-form rows from OpenAPI
    if (!Array.isArray(x)) {
      const code = x.SecuritiesCompanyCode ?? x.SecuritiesCode ?? x.Code ?? x.code ?? x["代號"] ?? "";
      const name = x.CompanyName ?? x.SecuritiesName ?? x.Name ?? x.name ?? x["名稱"] ?? "";
      const close = x.Close ?? x.ClosePrice ?? x.ClosingPrice ?? x.close ?? x["收盤"] ?? "";
      const vol = x.TradingShares ?? x.TradingVolume ?? x.TradeVolume ?? x.Volume ?? x.volume ?? x["成交股數"] ?? "";
      return {
        market:"tpex",
        code:String(code).trim(),
        name:String(name).trim(),
        close:Number(String(close).replace(/,/g,"").replace(/--/g,"")),
        volume_shares:Number(String(vol).replace(/,/g,"").replace(/--/g,"")),
        raw:x
      };
    }

    // Array-form rows from TPEx webpage tables.
    // Typical order begins with code, name, close/change, open/high/low, volume...
    // We infer code/name by content and infer numeric fields defensively.
    const vals=x.map(v=>String(v??"").trim());
    let code="", name="";
    for (let i=0;i<Math.min(vals.length,4);i++) {
      if (!code && /^\d{4}$/.test(vals[i])) {
        code=vals[i];
        if (i+1<vals.length) name=vals[i+1];
        break;
      }
    }

    const nums=vals.map(v=>{
      const z=v.replace(/,/g,"").replace(/--/g,"").replace(/[+]/g,"");
      return /^-?\d+(\.\d+)?$/.test(z)?Number(z):NaN;
    });

    // Heuristic:
    // first plausible price after code/name = close;
    // largest integer-like number later in row = volume shares.
    let close=NaN;
    for (let i=2;i<nums.length;i++) {
      if (Number.isFinite(nums[i]) && nums[i]>0 && nums[i]<100000) { close=nums[i]; break; }
    }
    let volume=NaN;
    const numericCandidates=nums.filter(n=>Number.isFinite(n) && n>=0);
    if (numericCandidates.length) volume=Math.max(...numericCandidates.filter(n=>Number.isInteger(n)));

    return {market:"tpex",code,name,close,volume_shares:volume,raw:x};
  }).filter(x=>x.code);
}

function ordinaryStock(x) {
  return /^\d{4}$/.test(x.code) && !x.code.startsWith("00");
}


function unixSec(dateStr) {
  return Math.floor(new Date(dateStr + "T00:00:00+08:00").getTime()/1000);
}
function isoDateTaipei(d=new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Taipei"}).format(d);
}
function addDaysISO(dateStr, days) {
  const d=new Date(dateStr+"T12:00:00+08:00");
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}
function yyyymmdd(dateStr){ return String(dateStr).replaceAll("-",""); }

async function fetchYahooHistory(code, market, startDate, endDate) {
  const suffixes = market==="tpex" ? [".TWO",".TW"] :
                   market==="twse" ? [".TW",".TWO"] :
                   [".TW",".TWO"];
  const attempts=[];
  const p1=unixSec(startDate);
  const p2=unixSec(addDaysISO(endDate,1));
  for(const suffix of suffixes){
    const symbol=code+suffix;
    for(const host of ["query1.finance.yahoo.com","query2.finance.yahoo.com"]){
      const u=`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d&events=history&includeAdjustedClose=true`;
      try{
        const r=await fetch(u,{headers:{
          "accept":"application/json,text/plain,*/*",
          "user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
        }});
        attempts.push({source:"yahoo",host,symbol,status:r.status});
        if(!r.ok) continue;
        const j=await r.json();
        const z=j?.chart?.result?.[0];
        const ts=z?.timestamp||[];
        const q=z?.indicators?.quote?.[0]||{};
        const adj=z?.indicators?.adjclose?.[0]?.adjclose||[];
        if(!ts.length) continue;
        const data=ts.map((t,i)=>({
          date:new Date(t*1000).toISOString().slice(0,10),
          open:q.open?.[i]??null,
          high:q.high?.[i]??null,
          low:q.low?.[i]??null,
          close:q.close?.[i]??null,
          adj_close:adj?.[i]??null,
          volume:q.volume?.[i]??null,
          symbol
        })).filter(x=>Number.isFinite(x.close));
        if(data.length) return {ok:true,source:"Yahoo Finance chart",symbol,data,attempts};
      }catch(e){
        attempts.push({source:"yahoo",host,symbol,error:String(e?.message||e)});
      }
    }
  }
  return {ok:false,source:"Yahoo Finance chart",data:[],attempts};
}

function rocToIso(s){
  const m=String(s||"").match(/(\d{3})\/(\d{2})\/(\d{2})/);
  if(!m) return null;
  return `${Number(m[1])+1911}-${m[2]}-${m[3]}`;
}
function numTW(v){
  const n=Number(String(v??"").replaceAll(",","").replaceAll("--","").trim());
  return Number.isFinite(n)?n:null;
}
async function fetchTwseMonthlyHistory(code,startDate,endDate){
  const attempts=[], rows=[];
  let cursor=new Date(startDate.slice(0,7)+"-01T12:00:00+08:00");
  const endM=new Date(endDate.slice(0,7)+"-01T12:00:00+08:00");
  while(cursor<=endM){
    const ds=cursor.toISOString().slice(0,10).replaceAll("-","");
    const u=`https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${ds}&stockNo=${encodeURIComponent(code)}&response=json`;
    try{
      const r=await fetch(u,{headers:{
        "accept":"application/json,text/plain,*/*",
        "user-agent":"Mozilla/5.0 (compatible; tw-stock-api/1.3)"
      }});
      attempts.push({source:"twse-monthly",month:ds.slice(0,6),status:r.status});
      if(r.ok){
        const j=await r.json();
        if(Array.isArray(j.data)){
          for(const a of j.data){
            const date=rocToIso(a?.[0]);
            if(!date) continue;
            rows.push({
              date,
              volume:numTW(a?.[1]),
              turnover:numTW(a?.[2]),
              open:numTW(a?.[3]),
              high:numTW(a?.[4]),
              low:numTW(a?.[5]),
              close:numTW(a?.[6]),
              change:numTW(String(a?.[7]??"").replace("+","")),
              trades:numTW(a?.[8])
            });
          }
        }
      }
    }catch(e){attempts.push({source:"twse-monthly",month:ds.slice(0,6),error:String(e?.message||e)})}
    cursor.setMonth(cursor.getMonth()+1);
  }
  const map=new Map(rows.filter(x=>x.date>=startDate&&x.date<=endDate).map(x=>[x.date,x]));
  const data=[...map.values()].sort((a,b)=>a.date.localeCompare(b.date));
  return {ok:data.length>0,source:"TWSE STOCK_DAY monthly",data,attempts};
}

async function routeApi(request, env, url) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (url.pathname === "/api/health") {
    return json({
      ok: true,
      service: "tw-stock-api",
      version: "1.4.0",
      time_utc: new Date().toISOString(),
      finmind_secret_configured: Boolean(env.FINMIND_TOKEN),
    });
  }

  if (url.pathname === "/api/twse/all") {
    const upstream = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
    try {
      const raw = await fetchJson(upstream);
      const data = normalizeTwse(raw);
      return json({
        ok: true,
        source: "TWSE OpenAPI",
        upstream,
        count: data.length,
        ordinary_count: data.filter(ordinaryStock).length,
        data,
      });
    } catch (e) {
      return json({ ok: false, source: "TWSE OpenAPI", upstream, error: String(e.message || e) }, 502);
    }
  }

  if (url.pathname === "/api/tpex/debug") {
    const result = await fetchTpexAll();
    return json({
      ok:result.ok,
      mode:result.mode||null,
      upstream:result.upstream||null,
      attempts:result.attempts||[],
      sample:Array.isArray(result.raw)?result.raw.slice(0,5):[],
      payload_meta:result.payload_meta||null
    }, result.ok?200:502);
  }

  if (url.pathname === "/api/tpex/all") {
    const result = await fetchTpexAll();
    if (!result.ok) {
      return json({
        ok:false,
        source:"TPEx OpenAPI",
        error:"All official TPEx OpenAPI candidates failed or redirected.",
        attempts:result.attempts
      }, 502);
    }
    const data=normalizeTpex(result.raw);
    return json({
      ok:true,
      source:"TPEx OpenAPI",
      upstream:result.upstream,
      count:data.length,
      ordinary_count:data.filter(ordinaryStock).length,
      attempts:result.attempts,
      data
    });
  }

  if (url.pathname === "/api/market/filter") {
    const minClose=Number(url.searchParams.get("min_close")||10);
    const minLots=Number(url.searchParams.get("min_lots")||3000);
    const minShares=minLots*1000;

    const twsePromise=fetchJson("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL")
      .then(raw=>({ok:true,data:normalizeTwse(raw)}))
      .catch(e=>({ok:false,data:[],error:String(e?.message||e)}));
    const tpexPromise=fetchTpexAll()
      .then(r=>r.ok?({ok:true,data:normalizeTpex(r.raw),upstream:r.upstream,attempts:r.attempts})
                    :({ok:false,data:[],error:"TPEx unavailable",attempts:r.attempts}));

    const [twse,tpex]=await Promise.all([twsePromise,tpexPromise]);
    const all=[...twse.data,...tpex.data];
    const filtered=all.filter(x=>
      ordinaryStock(x) &&
      Number.isFinite(x.close) && x.close>=minClose &&
      Number.isFinite(x.volume_shares) && x.volume_shares>=minShares
    ).sort((a,b)=>b.volume_shares-a.volume_shares);

    return json({
      ok:twse.ok || tpex.ok,
      partial:!(twse.ok && tpex.ok),
      filters:{min_close:minClose,min_lots:minLots},
      sources:{
        twse:{ok:twse.ok,count:twse.data.length,error:twse.error||null},
        tpex:{ok:tpex.ok,count:tpex.data.length,error:tpex.error||null,upstream:tpex.upstream||null,attempts:tpex.attempts||[]}
      },
      total_raw:all.length,
      count:filtered.length,
      data:filtered
    }, (twse.ok||tpex.ok)?200:502);
  }


  if (url.pathname === "/api/history/yahoo") {
    const code=url.searchParams.get("code")||"3443";
    const market=url.searchParams.get("market")||"";
    const endDate=url.searchParams.get("end_date")||isoDateTaipei();
    const startDate=url.searchParams.get("start_date")||addDaysISO(endDate,-460);
    const r=await fetchYahooHistory(code,market,startDate,endDate);
    return json({...r,count:r.data.length,first:r.data[0]?.date||null,last:r.data.at(-1)?.date||null},r.ok?200:502);
  }

  if (url.pathname === "/api/history/twse") {
    const code=url.searchParams.get("code")||"3443";
    const endDate=url.searchParams.get("end_date")||isoDateTaipei();
    const startDate=url.searchParams.get("start_date")||addDaysISO(endDate,-460);
    const r=await fetchTwseMonthlyHistory(code,startDate,endDate);
    return json({...r,count:r.data.length,first:r.data[0]?.date||null,last:r.data.at(-1)?.date||null},r.ok?200:502);
  }

  if (url.pathname === "/api/history/auto") {
    const code=url.searchParams.get("code")||"3443";
    const market=url.searchParams.get("market")||"";
    const endDate=url.searchParams.get("end_date")||isoDateTaipei();
    const startDate=url.searchParams.get("start_date")||addDaysISO(endDate,-460);

    const yahoo=await fetchYahooHistory(code,market,startDate,endDate);
    if(yahoo.ok && yahoo.data.length>=150){
      return json({...yahoo,mode:"primary",count:yahoo.data.length,first:yahoo.data[0]?.date||null,last:yahoo.data.at(-1)?.date||null});
    }

    if(market!=="tpex"){
      const twse=await fetchTwseMonthlyHistory(code,startDate,endDate);
      if(twse.ok) return json({...twse,mode:"fallback",yahoo_attempts:yahoo.attempts,count:twse.data.length,first:twse.data[0]?.date||null,last:twse.data.at(-1)?.date||null});
    }

    return json({ok:false,error:"No history source succeeded",yahoo_attempts:yahoo.attempts},502);
  }

  if (url.pathname === "/api/finmind") {
    const dataset = url.searchParams.get("dataset") || "TaiwanStockPrice";
    const dataId = url.searchParams.get("data_id") || "";
    const startDate = url.searchParams.get("start_date") || "";
    const endDate = url.searchParams.get("end_date") || "";

    if (!dataset) return json({ ok:false, error:"dataset is required" }, 400);
    if (!dataId && dataset !== "TaiwanStockInfo") {
      return json({ ok:false, error:"data_id is required for this proxy endpoint" }, 400);
    }

    const q = new URLSearchParams({ dataset });
    if (dataId) q.set("data_id", dataId);
    if (startDate) q.set("start_date", startDate);
    if (endDate) q.set("end_date", endDate);
    if (env.FINMIND_TOKEN) q.set("token", env.FINMIND_TOKEN);

    const upstream = `https://api.finmindtrade.com/api/v4/data?${q.toString()}`;
    try {
      const raw = await fetchJson(upstream);
      return json({
        ok: raw.status === 200 || raw.status === "200",
        source: "FinMind",
        dataset,
        data_id: dataId || null,
        msg: raw.msg ?? null,
        count: Array.isArray(raw.data) ? raw.data.length : 0,
        data: raw.data ?? [],
      });
    } catch (e) {
      return json({ ok:false, source:"FinMind", error:String(e.message || e) }, 502);
    }
  }

  return json({ ok:false, error:"Unknown API route", path:url.pathname }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return routeApi(request, env, url);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Static assets binding is missing.", { status: 500 });
  }
};
