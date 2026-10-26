/* 0050 corporate-actions helpers, pure and testable.
   FinMind adjusted close remains separate from split-only close.
   Explicitly do NOT mislabel split-only data as total return. */
(function(global){
  'use strict';
  const SPLIT_DATE='2025-06-18',RATIO=4;
  function n(x){if(x===null||x===undefined||x==='')return null;const v=Number(x);return Number.isFinite(v)?v:null}
  function ratioOnDate(date){return date<SPLIT_DATE?RATIO:1}
  function splitPrice(price,date){
    const value=n(price);return value===null?'':Math.round((value/ratioOnDate(date))*1e8)/1e8;
  }
  function splitDividend(amount,date){
    const value=n(amount);return value===null?'':Math.round(value/ratioOnDate(date)*1e8)/1e8;
  }
  function merge(original,adjusted,vix,dividend){
    const ad=new Map((adjusted||[]).map(x=>[x.date,x]));
    const vi=new Map((vix||[]).map(x=>[x.date,x]));
    const di=new Map((dividend||[]).map(x=>[x.date,x]));
    return (original||[]).map(r=>{
      const a=ad.get(r.date),v=vi.get(r.date),d=di.get(r.date);
      return {...r,
        split_adjusted_open:splitPrice(r.open,r.date),
        split_adjusted_high:splitPrice(r.high,r.date),
        split_adjusted_low:splitPrice(r.low,r.date),
        split_adjusted_close:splitPrice(r.close,r.date),
        split_factor:ratioOnDate(r.date),
        split_event_ratio:r.date===SPLIT_DATE?RATIO:'',
        adj_close:a?.close??'', // True provider-adjusted price; never silently substitute split-only close.
        adj_source:a?'FinMind TaiwanStockPriceAdj':'',
        cash_dividend:d?.cash_dividend??'',
        cash_dividend_split_unit:d?splitDividend(d.cash_dividend,r.date):'',
        dividend_payment_date:d?.payment_date??'',
        dividend_source:d?.source??'',
        vix_open:v?.open??'',vix_high:v?.high??'',vix_low:v?.low??'',
        vix_close:v?.close??'',vix_last_time:v?.last_time??'',
        vix_samples:v?.samples??'',vix_source:v?.source??''
      };
    });
  }
  function audit(raw,adj,vix,divs,divReady){
    const joined=merge(raw,adj,vix,divs);
    const divDates=new Set((divs||[]).map(x=>x.date));
    const rawDates=new Set((raw||[]).map(x=>x.date));
    const unpaired=[...divDates].filter(d=>!rawDates.has(d));
    const hasPre=joined.some(x=>x.date<'2025-06-18');
    const hasPost=joined.some(x=>x.date>='2025-06-18');
    const coverage=divReady && (divs||[]).length>0;
    return {joined,unpaired,
      hasSplit:hasPre&&hasPost,
      splitReference:188.65/RATIO, // Official 2025-06-10 last close before suspension: 47.1625.
      dividendsVerified:coverage,
      missingAdj:joined.filter(x=>x.adj_close==='').length,
      missingVix:joined.filter(x=>x.vix_close==='').length
    };
  }
  global.ETF0050={splitPrice,splitDividend,ratioOnDate,merge,audit,SPLIT_DATE,RATIO};
})(window);
