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



async function fetchTpexUniverse(){
  const urls=["https://isin.twse.com.tw/isin/C_public.jsp?strMode=4"];
  const attempts=[];
  for(const u of urls){
    try{
      const r=await fetch(u,{headers:{"accept":"text/html,*/*","user-agent":"Mozilla/5.0 (compatible; tw-stock-api/1.11.5)"}});
      const buf=await r.arrayBuffer();
      const utf8=new TextDecoder("utf-8",{fatal:false}).decode(buf);
      let big5="";
      try{big5=new TextDecoder("big5",{fatal:false}).decode(buf)}catch{}
      const bad=s=>(s.match(/�/g)||[]).length;
      const chinese=s=>(s.match(/[一-龥]/g)||[]).length;
      const text=(big5&&(bad(big5)<bad(utf8)||chinese(big5)>chinese(utf8)*1.25))?big5:utf8;
      attempts.push({url:u,status:r.status,bytes:buf.byteLength,encoding:text===big5?"big5":"utf-8"});
      if(!r.ok||text.length<1000) continue;
      const out=new Map();
      for(const m of text.matchAll(/<td[^>]*>\s*(\d{4})[\s\u3000]*(?:&nbsp;)*\s*([^<\r\n]+?)\s*<\/td>/gi)){
        const code=m[1],name=m[2].replace(/&nbsp;/g," ").trim();
        if(!code.startsWith("00")&&name) out.set(code,{market:"tpex",code,name});
      }
      const cells=[...text.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1].replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/\s+/g," ").trim());
      for(let i=0;i<cells.length-1;i++) if(/^\d{4}$/.test(cells[i])&&!cells[i].startsWith("00")){
        const name=cells[i+1]; if(name&&!/^\d/.test(name)) out.set(cells[i],{market:"tpex",code:cells[i],name});
      }
      if(out.size>300) return {ok:true,data:[...out.values()],source:"TWSE ISIN OTC universe",upstream:u,attempts};
    }catch(e){attempts.push({url:u,error:String(e?.message||e)})}
  }
  return {ok:false,data:[],source:"TWSE ISIN OTC universe",attempts,error:"Unable to obtain OTC universe"};
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


async function mergeTwseLatestBar(code, market, endDate, history){
  // Yahoo daily chart can lag the TWSE same-day close even after the TWSE quote is final.
  // For listed stocks, use official TWSE STOCK_DAY_ALL as the same-day source of truth.
  if(market==="tpex") return {data:history,merged:false};
  const today=isoDateTaipei();
  if(endDate < today) return {data:history,merged:false};

  try{
    const raw=await fetchJson("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL");
    const rows=normalizeTwse(raw);
    const q=rows.find(x=>String(x.code)===String(code));
    if(!q || !Number.isFinite(q.close) || !Number.isFinite(q.open) ||
       !Number.isFinite(q.high) || !Number.isFinite(q.low) ||
       !Number.isFinite(q.volume_shares) || q.volume_shares<=0){
      return {data:history,merged:false};
    }

    const bar={
      date:today,
      open:q.open,
      high:q.high,
      low:q.low,
      close:q.close,
      adj_close:q.close,
      volume:q.volume_shares,
      symbol:String(code)+".TW",
      source:"TWSE STOCK_DAY_ALL"
    };

    const data=[...history];
    const i=data.findIndex(x=>x.date===today);
    if(i>=0) data[i]=bar;
    else data.push(bar);
    data.sort((a,b)=>a.date.localeCompare(b.date));

    return {data,merged:true,twse_bar:bar};
  }catch(e){
    return {data:history,merged:false,merge_error:String(e?.message||e)};
  }
}

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
          open:roundTwPrice(q.open?.[i]),
          high:roundTwPrice(q.high?.[i]),
          low:roundTwPrice(q.low?.[i]),
          close:roundTwPrice(q.close?.[i]),
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

function twTickSize(price){
  const p=Number(price);
  if(!Number.isFinite(p) || p<=0) return 0.01;
  if(p<10) return 0.01;
  if(p<50) return 0.05;
  if(p<100) return 0.1;
  if(p<500) return 0.5;
  if(p<1000) return 1;
  return 5;
}
function roundTwPrice(price){
  const p=Number(price);
  if(!Number.isFinite(p)) return null;
  const tick=twTickSize(p);
  const v=Math.round(p/tick)*tick;
  return Number(v.toFixed(tick<0.1?2:tick<1?1:0));
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



async function mergeTwseExactRecentBars(code,startDate,endDate,history){
  // IMPORTANT: STOCK_DAY_ALL does not carry the trading date.
  // Never stamp it with server "today", especially around midnight.
  // Instead use TWSE STOCK_DAY monthly data because every row contains its exact ROC trading date.
  try{
    const recentStart=addDaysISO(endDate,-45);
    const twse=await fetchTwseMonthlyHistory(code,recentStart,endDate);
    if(!twse.ok || !twse.data.length){
      return {data:history,merged:0,source:"Yahoo only",attempts:twse.attempts||[]};
    }
    const map=new Map((history||[]).map(x=>[x.date,x]));
    let merged=0;
    for(const row of twse.data){
      const old=map.get(row.date);
      // Official TWSE wins for overlapping recent listed-stock bars.
      if(!old || old.open!==row.open || old.high!==row.high || old.low!==row.low ||
         old.close!==row.close || old.volume!==row.volume){
        merged++;
      }
      map.set(row.date,{...old,...row,source:"TWSE STOCK_DAY monthly"});
    }
    const data=[...map.values()]
      .filter(x=>x.date>=startDate && x.date<=endDate)
      .sort((a,b)=>a.date.localeCompare(b.date));
    return {
      data,
      merged,
      source:"Yahoo history + TWSE exact-date recent bars",
      last_twse:twse.data.at(-1)?.date||null,
      attempts:twse.attempts||[]
    };
  }catch(e){
    return {data:history,merged:0,source:"Yahoo only",error:String(e?.message||e)};
  }
}

function twDateCompact(iso){ return String(iso||"").replaceAll("-",""); }
function recentWeekdays(endIso,count){
  const out=[]; let d=new Date(endIso+"T12:00:00+08:00");
  while(out.length<count){
    const wd=d.getDay();
    if(wd!==0&&wd!==6) out.push(d.toISOString().slice(0,10));
    d.setDate(d.getDate()-1);
  }
  return out;
}
function cleanNum(v){
  const s=String(v??"").replaceAll(",","").replaceAll("+","").replaceAll("--","").trim();
  const n=Number(s); return Number.isFinite(n)?n:null;
}
function rowByFields(payload,code){
  const tables=Array.isArray(payload?.tables)?payload.tables:[];
  for(const t of tables){
    const fields=(t?.fields||[]).map(x=>String(x).replace(/<[^>]+>/g,"").trim());
    const data=Array.isArray(t?.data)?t.data:[];
    for(const row of data){
      if(!Array.isArray(row))continue;
      const obj={}; fields.forEach((f,i)=>obj[f]=row[i]);
      const vals=row.map(x=>String(x??"").trim());
      const c=vals.find(v=>v===String(code));
      if(c) return {obj,fields,row};
    }
  }
  return null;
}
function pickField(obj,needles){
  for(const [k,v] of Object.entries(obj||{})){
    const kk=String(k).replace(/\s/g,"");
    if(needles.some(n=>kk.includes(n))) return v;
  }
  return null;
}
async function fetchTwseJson(url){
  const r=await fetch(url,{headers:{
    "accept":"application/json,text/plain,*/*",
    "user-agent":"Mozilla/5.0 (compatible; tw-stock-api/1.6.1)",
    "referer":"https://www.twse.com.tw/"
  }});
  if(!r.ok) throw new Error(`TWSE HTTP ${r.status}`);
  return r.json();
}
async function chipForDate(code,iso){
  const date=twDateCompact(iso);
  const result={date:iso,margin:null,inst:null,daytrade:null,errors:[]};

  // Margin balance
  try{
    const j=await fetchTwseJson(`https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${date}&selectType=ALL&response=json`);
    const hit=rowByFields(j,code);
    if(hit){
      const o=hit.obj;
      const today=cleanNum(pickField(o,["今日餘額","今日融資餘額"]));
      const prev=cleanNum(pickField(o,["前日餘額","昨日餘額","昨日融資餘額"]));
      const buy=cleanNum(pickField(o,["融資買進"]));
      const sell=cleanNum(pickField(o,["融資賣出"]));
      if(today!=null) result.margin={
        date:iso,
        stock_id:String(code),
        MarginPurchaseTodayBalance:today,
        MarginPurchaseYesterdayBalance:prev,
        MarginPurchaseBuy:buy,
        MarginPurchaseSell:sell
      };
    }
  }catch(e){result.errors.push("margin:"+String(e.message||e))}

  // Institutional investors (official TWSE daily report backend)
  try{
    const j=await fetchTwseJson(`https://www.twse.com.tw/rwd/zh/fund/T86?date=${date}&selectType=ALL&response=json`);
    const hit=rowByFields(j,code);
    if(hit){
      const o=hit.obj;
      const foreign=cleanNum(pickField(o,["外陸資買賣超股數","外資及陸資買賣超股數","外資買賣超股數"]));
      const trust=cleanNum(pickField(o,["投信買賣超股數"]));
      const dealerSelf=cleanNum(pickField(o,["自營商買賣超股數(自行買賣)","自營商(自行買賣)買賣超股數"]));
      const dealerHedge=cleanNum(pickField(o,["自營商買賣超股數(避險)","自營商(避險)買賣超股數"]));
      const dealerTotal=(dealerSelf||0)+(dealerHedge||0);
      if(foreign!=null||trust!=null||dealerSelf!=null||dealerHedge!=null) result.inst={
        date:iso,stock_id:String(code),
        Foreign_Investor_Buy:foreign>0?foreign:0,
        Foreign_Investor_Sell:foreign<0?-foreign:0,
        Investment_Trust_Buy:trust>0?trust:0,
        Investment_Trust_Sell:trust<0?-trust:0,
        Dealer_Buy:dealerTotal>0?dealerTotal:0,
        Dealer_Sell:dealerTotal<0?-dealerTotal:0,
        Foreign_Investor:foreign||0,
        Investment_Trust:trust||0,
        Dealer:dealerTotal||0
      };
    }
  }catch(e){result.errors.push("inst:"+String(e.message||e))}

  // Day trading
  try{
    let j;
    try{
      j=await fetchTwseJson("https://openapi.twse.com.tw/v1/exchangeReport/TWTB4U");
      const arr=Array.isArray(j)?j:[];
      const z=arr.find(x=>String(x.Code??x.SecuritiesCode??x["證券代號"]??"").trim()===String(code));
      if(z){
        const vol=cleanNum(z.DayTradingVolume??z.Volume??z.TradingVolume??z["當日沖銷交易成交股數"]);
        if(vol!=null) result.daytrade={date:iso,stock_id:String(code),Volume:vol};
      }
    }catch{}
    if(!result.daytrade){
      j=await fetchTwseJson(`https://www.twse.com.tw/rwd/zh/dayTrading/TWTB4U?date=${date}&selectType=All&response=json`);
      const hit=rowByFields(j,code);
      if(hit){
        const vol=cleanNum(pickField(hit.obj,["當日沖銷交易成交股數","當日沖銷成交股數"]));
        if(vol!=null) result.daytrade={date:iso,stock_id:String(code),Volume:vol};
      }
    }
  }catch(e){result.errors.push("daytrade:"+String(e.message||e))}
  return result;
}


const FUTURES_FALLBACK_CODES = [
  "1101","1102","1210","1216","1301","1303","1304","1305","1307","1308","1309","1312","1314","1319",
  "1402","1434","1476","1504","1513","1514","1519","1522","1536","1560","1590","1605","1707","1717","1722","1723",
  "1789","1795","1802","1904","2002","2014","2027","2049","2105","2201","2204","2206","2301","2303","2308","2312",
  "2313","2317","2324","2327","2330","2344","2345","2347","2352","2353","2354","2356","2357","2360","2368","2371",
  "2376","2377","2379","2382","2383","2385","2392","2404","2408","2409","2412","2421","2449","2454","2474","2492",
  "2498","2603","2609","2610","2615","2618","2634","2637","2707","2801","2880","2881","2882","2883","2884","2885",
  "2886","2887","2890","2891","2892","2912","3005","3017","3034","3035","3044","3059","3189","3231","3293","3374",
  "3443","3481","3532","3533","3653","3702","3711","4763","4904","4938","4958","5269","5347","5483","5871","5876",
  "5880","6176","6239","6257","6271","6285","6415","6446","6488","6505","6669","6770","6781","6805","8046","8069",
  "8150","8210","8299","8454","8464","9910","9921"
];

async function fetchTaifexStockFuturesCodes(){
  const urls=[
    "https://www.taifex.com.tw/cht/2/stockLists",
    "https://www.taifex.com.tw/cht/5/stockMarginingDetail",
    "https://www.taifex.com.tw/cht/2/sTF"
  ];
  const attempts=[];
  for(const u of urls){
    try{
      const r=await fetch(u,{
        headers:{
          "accept":"text/html,application/xhtml+xml",
          "user-agent":"Mozilla/5.0 (compatible; tw-stock-api/1.11.5)"
        }
      });
      const text=await r.text();
      attempts.push({url:u,status:r.status,bytes:text.length});
      if(!r.ok || text.length<1000) continue;

      const codes=new Set();
      // Official TAIFEX tables contain the underlying security code in a TD.
      // Restrict to four-digit ordinary-stock style values and exclude ETF 00xx.
      for(const m of text.matchAll(/<td[^>]*>\s*(\d{4})\s*<\/td>/gi)){
        const c=m[1];
        if(!c.startsWith("00")) codes.add(c);
      }
      // Some versions put table content inside spans/links; catch nearby 4-digit values too.
      if(codes.size<30){
        for(const m of text.matchAll(/(?:標的|證券|stock)[\s\S]{0,120}?(\d{4})/gi)){
          const c=m[1];
          if(!c.startsWith("00")) codes.add(c);
        }
      }
      if(codes.size>=30){
        return {ok:true,codes:[...codes].sort(),source:"TAIFEX official",attempts};
      }
    }catch(e){
      attempts.push({url:u,error:String(e?.message||e)});
    }
  }
  return {ok:true,codes:[...new Set(FUTURES_FALLBACK_CODES)].sort(),source:"embedded fallback",attempts};
}

async function routeApi(request, env, url) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (url.pathname === "/api/health") {
    return json({
      ok: true,
      service: "tw-stock-api",
      version: "1.11.5",
      time_utc: new Date().toISOString(),
      finmind_secret_configured: Boolean(env.FINMIND_TOKEN),
    });
  }


  if (url.pathname === "/api/futures/stock-list") {
    const cacheKey=new Request(`${url.origin}/__cache/taifex-stock-futures`);
    const cache=caches.default;
    const cached=await cache.match(cacheKey);
    if(cached) return cached;

    const r=await fetchTaifexStockFuturesCodes();
    const resp=json({
      ok:r.ok,
      source:r.source,
      count:r.codes.length,
      codes:r.codes,
      attempts:r.attempts
    },200,{"cache-control":"public,max-age=21600"});
    await cache.put(cacheKey,resp.clone());
    return resp;
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


  if (url.pathname === "/api/market/universe") {
    const [twseRaw,tpex]=await Promise.all([
      fetchJson("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL")
        .then(raw=>({ok:true,data:normalizeTwse(raw).filter(ordinaryStock)}))
        .catch(e=>({ok:false,data:[],error:String(e?.message||e)})),
      fetchTpexUniverse()
    ]);
    // STOCK_DAY_ALL is used only for universe/current prefilter fields.
    // Never attach an inferred trading date to it.
    const twse=twseRaw.data.map(x=>({
      market:"twse",code:x.code,name:x.name,
      close:roundTwPrice(x.close),open:roundTwPrice(x.open),high:roundTwPrice(x.high),low:roundTwPrice(x.low),
      volume_shares:x.volume_shares,turnover:x.turnover
    }));
    const merged=new Map();
    // Add TPEx first, then overwrite by TWSE. Taiwan ordinary-stock codes are unique;
    // if the OTC parser accidentally captures a listed code, TWSE must win.
    for(const x of tpex.data) if(/^\d{4}$/.test(String(x.code||""))) merged.set(String(x.code),x);
    for(const x of twse) merged.set(String(x.code),x);
    const universe=[...merged.values()];
    const tpexClean=universe.filter(x=>x.market==="tpex").length;
    const twseClean=universe.filter(x=>x.market==="twse").length;
    return json({ok:twseRaw.ok||tpex.ok,data:universe,
      counts:{twse:twseClean,tpex:tpexClean,total:universe.length},
      sources:{
        twse:{ok:twseRaw.ok,error:twseRaw.error||null},
        tpex:{ok:tpex.ok,source:tpex.source,upstream:tpex.upstream||null,error:tpex.error||null,attempts:tpex.attempts||[]}
      }
    },(twseRaw.ok||tpex.ok)?200:502,{"cache-control":"no-store"});
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


  if (url.pathname === "/api/intraday") {
    const code=url.searchParams.get("code")||"2330";
    const market=url.searchParams.get("market")||"";
    const suffixes=market==="tpex"?[".TWO",".TW"]:market==="twse"?[".TW",".TWO"]:[".TW",".TWO"];
    const attempts=[];
    for(const suffix of suffixes){
      const symbol=String(code)+suffix;
      for(const host of ["query1.finance.yahoo.com","query2.finance.yahoo.com"]){
        try{
          const u=`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1m&includePrePost=false`;
          const r=await fetch(u,{headers:{"accept":"application/json,text/plain,*/*","user-agent":"Mozilla/5.0 Chrome/131"}});
          attempts.push({host,symbol,status:r.status});
          if(!r.ok) continue;
          const j=await r.json(),z=j?.chart?.result?.[0],ts=z?.timestamp||[],q=z?.indicators?.quote?.[0]||{};
          if(!ts.length) continue;
          const day=t=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(t*1000));
          const time=t=>new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date(t*1000));
          const latestDay=day(ts.at(-1)),rows=[];
          for(let i=0;i<ts.length;i++){
            if(day(ts[i])!==latestDay) continue;
            const c=Number(q.close?.[i]);
            if(!Number.isFinite(c)) continue;
            rows.push({t:ts[i],open:Number(q.open?.[i]),high:Number(q.high?.[i]),low:Number(q.low?.[i]),close:c,volume:Number(q.volume?.[i]||0)});
          }
          if(!rows.length) continue;
          const hi=rows.map(x=>x.high).filter(Number.isFinite),lo=rows.map(x=>x.low).filter(Number.isFinite),op=rows.map(x=>x.open).filter(Number.isFinite);
          const last=rows.at(-1),meta=z?.meta||{},prev=Number(meta.chartPreviousClose??meta.previousClose),close=roundTwPrice(last.close);
          return json({ok:true,source:"Yahoo Finance 1m intraday",market_state:meta.marketState||null,bar:{
            date:latestDay,open:roundTwPrice(op[0]),high:roundTwPrice(Math.max(...hi)),low:roundTwPrice(Math.min(...lo)),close,
            volume:rows.reduce((s,x)=>s+(Number.isFinite(x.volume)?x.volume:0),0),
            last_time:time(last.t),prev_close:roundTwPrice(prev),
            change:Number.isFinite(prev)?roundTwPrice(close-prev):null,
            change_pct:Number.isFinite(prev)&&prev!==0?(close-prev)/prev*100:null
          },attempts},200,{"cache-control":"no-store"});
        }catch(e){attempts.push({host,symbol,error:String(e?.message||e)})}
      }
    }
    return json({ok:false,error:"intraday unavailable",attempts},502,{"cache-control":"no-store"});
  }

  if (url.pathname === "/api/history/auto") {
    const code=url.searchParams.get("code")||"3443";
    const market=url.searchParams.get("market")||"";
    const endDate=url.searchParams.get("end_date")||isoDateTaipei();
    const startDate=url.searchParams.get("start_date")||addDaysISO(endDate,-460);
    const fresh=url.searchParams.get("fresh")==="1";

    // Same code/date is requested repeatedly during rescans. Cache the completed
    // merged history at the Worker edge so a second scan does not hit Yahoo/TWSE again.
    const historyCache=caches.default;
    const historyCacheKey=new Request(
      `${url.origin}/__cache/history-auto/${market||"auto"}/${code}/${startDate}/${endDate}/${fresh?"fresh":"normal"}`
    );
    const historyCached=await historyCache.match(historyCacheKey);
    if(historyCached) return historyCached;

    const yahoo=await fetchYahooHistory(code,market,startDate,endDate);
    if(yahoo.ok && yahoo.data.length>=150){
      let data=yahoo.data, freshness={
        merged:0,source:"Yahoo only",last_twse:null,error:null
      };

      // Detail/latest requests explicitly ask for fresh=1.
      // Use exact-date TWSE monthly rows; never infer the exchange date from wall-clock "today".
      if(fresh && market!=="tpex"){
        freshness=await mergeTwseExactRecentBars(code,startDate,endDate,yahoo.data);
        data=freshness.data;
      }

      const body=json({
        ...yahoo,
        data,
        mode:"primary",
        fresh_requested:fresh,
        latest_merge:freshness.source,
        latest_merge_count:freshness.merged||0,
        latest_twse_date:freshness.last_twse||null,
        latest_merge_error:freshness.error||null,
        count:data.length,
        first:data[0]?.date||null,
        last:data.at(-1)?.date||null
      },200,{"cache-control":"public,max-age=21600","x-history-cache":"miss"});
      await historyCache.put(historyCacheKey,body.clone());
      return body;
    }

    if(market!=="tpex"){
      const twse=await fetchTwseMonthlyHistory(code,startDate,endDate);
      if(twse.ok){
        const body=json({...twse,mode:"fallback",latest_merge:"TWSE exact-date monthly",yahoo_attempts:yahoo.attempts,count:twse.data.length,first:twse.data[0]?.date||null,last:twse.data.at(-1)?.date||null},200,{"cache-control":"public,max-age=21600","x-history-cache":"miss"});
        await historyCache.put(historyCacheKey,body.clone());
        return body;
      }
    }

    return json({ok:false,error:"No history source succeeded",yahoo_attempts:yahoo.attempts},502);
  }


  if (url.pathname === "/api/chips/twse") {
    const code=url.searchParams.get("code")||"3443";
    const endDate=url.searchParams.get("end_date")||isoDateTaipei();
    const days=Math.max(1,Math.min(12,Number(url.searchParams.get("days")||12)));
    const dates=recentWeekdays(endDate,days);
    const rows=[];
    // Sequential by date: keeps subrequests bounded and easier on TWSE.
    for(const d of dates){
      rows.push(await chipForDate(code,d));
      await new Promise(r=>setTimeout(r,35));
    }
    const margin=rows.map(x=>x.margin).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date));
    const inst=rows.map(x=>x.inst).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date));
    const daytrade=rows.map(x=>x.daytrade).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date));
    return json({
      ok:true,source:"TWSE official public reports",code,
      requested_days:days,
      margin_count:margin.length,
      institutional_count:inst.length,
      daytrade_count:daytrade.length,
      margin,inst,daytrade,
      diagnostics:rows.map(x=>({date:x.date,margin:!!x.margin,inst:!!x.inst,daytrade:!!x.daytrade,errors:x.errors}))
    });
  }



  if (url.pathname === "/api/finmind/recheck") {
    const code=url.searchParams.get("code")||"3443";
    const endDate=url.searchParams.get("end_date")||isoDateTaipei();
    const startDate=url.searchParams.get("start_date")||addDaysISO(endDate,-140);

    const cacheKey=new Request(`${url.origin}/__cache/finmind-recheck/${code}/${startDate}/${endDate}`);
    const cache=caches.default;
    const cached=await cache.match(cacheKey);
    if(cached) return cached;

    async function ds(dataset){
      const q=new URLSearchParams({dataset,data_id:code,start_date:startDate,end_date:endDate});
      if(env.FINMIND_TOKEN) q.set("token",env.FINMIND_TOKEN);
      const u=`https://api.finmindtrade.com/api/v4/data?${q.toString()}`;
      try{
        const r=await fetch(u,{headers:{"accept":"application/json","user-agent":"tw-stock-api/1.7"}});
        const text=await r.text();
        let j=null; try{j=JSON.parse(text)}catch{}
        if(!r.ok || !j || !(j.status===200 || j.status==="200")){
          return {ok:false,count:0,data:[],error:`HTTP ${r.status}`,msg:j?.msg||text.slice(0,180)};
        }
        return {ok:true,count:Array.isArray(j.data)?j.data.length:0,data:Array.isArray(j.data)?j.data:[]};
      }catch(e){
        return {ok:false,count:0,data:[],error:String(e?.message||e)};
      }
    }

    // Sequential requests are deliberate: anonymous FinMind is much more fragile
    // when three datasets are fired simultaneously.
    const margin=await ds("TaiwanStockMarginPurchaseShortSale");
    await new Promise(r=>setTimeout(r,120));
    const inst=await ds("TaiwanStockInstitutionalInvestorsBuySellWide");
    await new Promise(r=>setTimeout(r,120));
    const daytrade=await ds("TaiwanStockDayTrading");

    const complete=[margin,inst,daytrade].filter(x=>x.ok&&x.count>0).length;
    const body={
      ok:complete>0,
      code,
      token:Boolean(env.FINMIND_TOKEN),
      completeness:Math.round(complete/3*100),
      margin,inst,daytrade
    };
    const resp=json(body,complete>0?200:502,{"cache-control":"public, max-age=21600"});
    if(complete>0) await cache.put(cacheKey,resp.clone());
    return resp;
  }

  if (url.pathname === "/api/chips/hybrid") {
    const code=url.searchParams.get("code")||"3443";
    const endDate=url.searchParams.get("end_date")||isoDateTaipei();
    const startDate=url.searchParams.get("start_date")||addDaysISO(endDate,-140);

    const cacheKey=new Request(`${url.origin}/__cache/chips/${code}/${startDate}/${endDate}`, request);
    const cache=caches.default;
    const cached=await cache.match(cacheKey);
    if(cached) return cached;

    async function finmindDataset(dataset){
      const q=new URLSearchParams({dataset,data_id:code,start_date:startDate,end_date:endDate});
      if(env.FINMIND_TOKEN) q.set("token",env.FINMIND_TOKEN);
      const u=`https://api.finmindtrade.com/api/v4/data?${q.toString()}`;
      try{
        const r=await fetch(u,{headers:{"accept":"application/json","user-agent":"tw-stock-api/1.6.2"}});
        const text=await r.text();
        let j=null; try{j=JSON.parse(text)}catch{}
        if(!r.ok || !j || !(j.status===200 || j.status==="200")){
          return {ok:false,error:`HTTP ${r.status}`,msg:j?.msg||text.slice(0,180),data:[]};
        }
        return {ok:true,data:Array.isArray(j.data)?j.data:[]};
      }catch(e){return {ok:false,error:String(e?.message||e),data:[]}}
    }

    const [fmMargin,fmInst,fmDay]=await Promise.all([
      finmindDataset("TaiwanStockMarginPurchaseShortSale"),
      finmindDataset("TaiwanStockInstitutionalInvestorsBuySellWide"),
      finmindDataset("TaiwanStockDayTrading")
    ]);

    // Fill datasets independently. V1.9.3 treated "one FinMind dataset succeeded"
    // as total success, so a valid day-trading response could hide missing margin/inst.
    let margin=fmMargin.ok?(fmMargin.data||[]):[];
    let inst=fmInst.ok?(fmInst.data||[]):[];
    let daytrade=fmDay.ok?(fmDay.data||[]):[];
    let fallbackUsed=false;

    // TWSE public reports are a valid fallback for LISTED stocks only.
    // For TPEx, never fabricate missing institutional/margin series.
    const isTwseCode=await (async()=>{
      try{
        const raw=await fetchJson("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL");
        return normalizeTwse(raw).some(x=>String(x.code)===String(code));
      }catch{return false}
    })();

    if(isTwseCode && (!margin.length || !inst.length || !daytrade.length)){
      const dates=recentWeekdays(endDate,12),rows=[];
      for(const d of dates){
        rows.push(await chipForDate(code,d));
        await new Promise(r=>setTimeout(r,35));
      }
      if(!margin.length){ margin=rows.map(x=>x.margin).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date)); if(margin.length)fallbackUsed=true; }
      if(!inst.length){ inst=rows.map(x=>x.inst).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date)); if(inst.length)fallbackUsed=true; }
      if(!daytrade.length){ daytrade=rows.map(x=>x.daytrade).filter(Boolean).sort((a,b)=>a.date.localeCompare(b.date)); if(daytrade.length)fallbackUsed=true; }
    }

    const parts=[];
    if(fmMargin.ok||fmInst.ok||fmDay.ok) parts.push("FinMind");
    if(fallbackUsed) parts.push("TWSE fallback");
    if(!parts.length) parts.push(isTwseCode?"TWSE fallback unavailable":"FinMind unavailable for TPEx");
    const body={
      ok:margin.length>0||inst.length>0||daytrade.length>0,
      source:parts.join(" + "),
      finmind_token:Boolean(env.FINMIND_TOKEN),
      finmind_status:{
        margin:{ok:fmMargin.ok,count:fmMargin.data?.length||0,error:fmMargin.error||null,msg:fmMargin.msg||null,final_count:margin.length},
        inst:{ok:fmInst.ok,count:fmInst.data?.length||0,error:fmInst.error||null,msg:fmInst.msg||null,final_count:inst.length},
        daytrade:{ok:fmDay.ok,count:fmDay.data?.length||0,error:fmDay.error||null,msg:fmDay.msg||null,final_count:daytrade.length}
      },
      margin,inst,daytrade
    };
    const resp=json(body,200,{"cache-control":"public, max-age=900"});
    await cache.put(cacheKey,resp.clone());
    return resp;
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
      const asset = await env.ASSETS.fetch(request);
      const path = new URL(request.url).pathname;
      if (path.endsWith(".html") || path === "/" || path === "/scanner.html" || path === "/detail.html") {
        const headers = new Headers(asset.headers);
        headers.set("Cache-Control","no-store, no-cache, must-revalidate, max-age=0");
        headers.set("Pragma","no-cache");
        headers.set("Expires","0");
        headers.set("X-App-Version","1.11.5");
        return new Response(asset.body,{status:asset.status,statusText:asset.statusText,headers});
      }
      return asset;
    }
    return new Response("Static assets binding is missing.", { status: 500 });
  }
};
