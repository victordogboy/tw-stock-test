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
  // TPEx OpenAPI is official, but some Cloudflare egress paths can be redirected
  // repeatedly by www.tpex.org.tw. Try several official host/scheme variants and
  // expose diagnostics instead of taking down the whole market scan.
  const candidates = [
    "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
    "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes",
    "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes/",
    "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes/"
  ];
  const attempts = [];
  for (const u of candidates) {
    try {
      const r = await fetch(u, {
        redirect: "manual",
        headers: {
          "accept": "application/json",
          "user-agent": "Mozilla/5.0 (compatible; tw-stock-api/1.1)"
        }
      });
      const location = r.headers.get("location");
      attempts.push({url:u,status:r.status,location});
      if (r.status >= 300 && r.status < 400) continue;
      if (!r.ok) continue;
      const text = await r.text();
      let body;
      try { body = JSON.parse(text); } catch { continue; }
      if (Array.isArray(body) && body.length) {
        return { ok:true, raw:body, upstream:u, attempts };
      }
    } catch(e) {
      attempts.push({url:u,error:String(e?.message||e)});
    }
  }
  return { ok:false, raw:[], upstream:null, attempts };
}

function normalizeTpex(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(x => {
    const code = x.SecuritiesCompanyCode ?? x.SecuritiesCode ?? x.Code ?? x.code ?? "";
    const name = x.CompanyName ?? x.SecuritiesName ?? x.Name ?? x.name ?? "";
    const close = x.Close ?? x.ClosePrice ?? x.ClosingPrice ?? x.close ?? "";
    const volLots = x.TradingShares ?? x.TradingVolume ?? x.TradeVolume ?? x.Volume ?? x.volume ?? "";
    const v = Number(String(volLots).replace(/,/g, ""));
    return {
      market: "tpex",
      code: String(code).trim(),
      name: String(name).trim(),
      close: Number(String(close).replace(/,/g, "")),
      volume_shares: v,
      raw: x,
    };
  }).filter(x => x.code);
}

function ordinaryStock(x) {
  return /^\d{4}$/.test(x.code) && !x.code.startsWith("00");
}

async function routeApi(request, env, url) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (url.pathname === "/api/health") {
    return json({
      ok: true,
      service: "tw-stock-api",
      version: "1.1.0",
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
