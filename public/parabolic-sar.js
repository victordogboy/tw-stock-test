/* Parabolic SAR: calculated from chronological daily OHLC candles only.
   Legacy numeric AF remains the initial factor and increment; options allow separate factors.
   The maximum acceleration factor is 0.20 by default. */
(function (root) {
  'use strict';
  const DEFAULT_AF = 0.05;
  const MIN_AF = 0.005;
  const MAX_AF = 0.20;

  function normalizeAf(value) {
    const n = Number(value);
    return Number.isFinite(n) && n >= MIN_AF && n <= MAX_AF
      ? Math.round(n * 1000) / 1000
      : DEFAULT_AF;
  }

  const defaults=Object.freeze({enabled:true,start:DEFAULT_AF,step:DEFAULT_AF,max:MAX_AF});
  function validate(input={}) {
    const p={...defaults,...input};
    for(const k of ['start','step','max']) {
      p[k]=Number(p[k]);
      if(!Number.isFinite(p[k])||p[k]<0.001||p[k]>1)throw new Error('加速因子須介於 0.001 與 1。');
      p[k]=Math.round(p[k]*1000)/1000;
    }
    if(p.start<MIN_AF||p.start>MAX_AF)throw new Error('初始加速因子須介於 0.005 與 0.200。');
    if(p.max<p.start||p.max<p.step)throw new Error('上限不可小於初始值或每次增加量。');
    p.enabled=p.enabled!==false;return p;
  }

  function calculate(rows, initialAf = DEFAULT_AF, maximumAf = MAX_AF) {
    if (!Array.isArray(rows)) return [];
    const result = Array(rows.length).fill(null);
    if (rows.length < 2) return result;

    const prices = rows.map(row => ({
      high: Number(row && row.high),
      low: Number(row && row.low),
      close: Number(row && row.close)
    }));
    if (prices.some(p => !Number.isFinite(p.high) || !Number.isFinite(p.low) ||
      !Number.isFinite(p.close) || p.low > p.high)) return result;

    const options=initialAf&&typeof initialAf==='object'?validate(initialAf):null;
    const start=options?options.start:normalizeAf(initialAf);
    const step=options?options.step:start;
    const cap=options?options.max:(Number.isFinite(Number(maximumAf))
      ? Math.max(start, Math.min(1, Number(maximumAf))) : MAX_AF);
    let rising = prices[1].close >= prices[0].close;
    let sar = rising ? Math.min(prices[0].low, prices[1].low)
                     : Math.max(prices[0].high, prices[1].high);
    let extreme = rising ? Math.max(prices[0].high, prices[1].high)
                         : Math.min(prices[0].low, prices[1].low);
    let af = start;
    result[1] = { value: sar, rising, af, reversal: false };

    for (let i = 2; i < prices.length; i++) {
      const today = prices[i], previous = prices[i - 1], before = prices[i - 2];
      let next = sar + af * (extreme - sar);
      let reversal = false;
      if (rising) {
        // A bullish SAR cannot exceed the two preceding daily lows.
        next = Math.min(next, previous.low, before.low);
        if (today.low <= next) {
          sar = extreme;
          rising = false;
          extreme = today.low;
          af = start;
          reversal = true;
        } else {
          sar = next;
          if (today.high > extreme) {
            extreme = today.high;
            af = Math.min(cap, Math.round((af + step) * 1000) / 1000);
          }
        }
      } else {
        // A bearish SAR cannot fall below the two preceding daily highs.
        next = Math.max(next, previous.high, before.high);
        if (today.high >= next) {
          sar = extreme;
          rising = true;
          extreme = today.high;
          af = start;
          reversal = true;
        } else {
          sar = next;
          if (today.low < extreme) {
            extreme = today.low;
            af = Math.min(cap, Math.round((af + step) * 1000) / 1000);
          }
        }
      }
      result[i] = { value: sar, rising, af, reversal };
    }
    return result;
  }

  const api = { calculate, normalizeAf, validate, defaults, DEFAULT_AF, MIN_AF, MAX_AF };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TWParabolicSAR = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
