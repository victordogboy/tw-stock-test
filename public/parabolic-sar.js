/* Parabolic SAR: calculated from chronological daily OHLC candles only.
   af is both the initial acceleration factor and the increment after new extremes.
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

    const step = normalizeAf(initialAf);
    const cap = Number.isFinite(Number(maximumAf))
      ? Math.max(step, Math.min(1, Number(maximumAf))) : MAX_AF;
    let rising = prices[1].close >= prices[0].close;
    let sar = rising ? Math.min(prices[0].low, prices[1].low)
                     : Math.max(prices[0].high, prices[1].high);
    let extreme = rising ? Math.max(prices[0].high, prices[1].high)
                         : Math.min(prices[0].low, prices[1].low);
    let af = step;
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
          af = step;
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
          af = step;
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

  const api = { calculate, normalizeAf, DEFAULT_AF, MIN_AF, MAX_AF };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.TWParabolicSAR = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
