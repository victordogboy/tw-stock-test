const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/index.js'), 'utf8')
  .replace(/export default\s*\{/, 'globalThis.worker = {');

const upstreamCalls = [];
const misFixture = {
  msgArray: [{
    c: '8046',
    d: '20260916',
    t: '09:17:00',
    tlong: '1789521420000',
    z: '-',
    trade: {t: '09:16:58', z: '1085.0000'},
    o: '1070.0000',
    h: '1110.0000',
    l: '1055.0000',
    y: '1065.0000',
    v: '7514'
  }],
  rtcode: '0000'
};

const context = vm.createContext({
  console,
  URL,
  URLSearchParams,
  Request,
  Response,
  Headers,
  AbortSignal,
  TextDecoder,
  Intl,
  Date,
  setTimeout,
  clearTimeout,
  caches: {default: {
    async match(){ return null; },
    async put(){},
    async delete(){ return true; }
  }},
  fetch: async url => {
    const value = String(url);
    upstreamCalls.push(value);
    if(value.includes('query1.finance.yahoo.com')){
      return new Response('{"chart":{"result":null}}', {status: 429, headers: {'content-type': 'application/json'}});
    }
    if(value.includes('mis.twse.com.tw')){
      return new Response(JSON.stringify(misFixture), {status: 200, headers: {'content-type': 'application/json'}});
    }
    throw new Error(`unexpected upstream: ${value}`);
  }
});

vm.runInContext(source, context, {filename: 'src/index.js'});

(async () => {
  const response = await context.worker.fetch(
    new Request('https://worker.test/api/intraday?code=8046&market=twse'),
    {}
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.quote_valid, true);
  assert.equal(body.source, 'TWSE MIS official realtime fallback');
  assert.equal(body.symbol, '8046.TW');
  assert.equal(body.bar.date, '2026-09-16');
  assert.equal(body.bar.open, 1070);
  assert.equal(body.bar.high, 1110);
  assert.equal(body.bar.low, 1055);
  assert.equal(body.bar.close, 1085);
  assert.equal(body.bar.prev_close, 1065);
  assert.equal(body.bar.change, 20);
  assert.equal(body.bar.volume, 7_514_000, 'TWSE MIS lots must be converted to shares');
  assert.equal(upstreamCalls.filter(x => x.includes('query1.finance.yahoo.com')).length, 1);
  assert.equal(upstreamCalls.filter(x => x.includes('mis.twse.com.tw')).length, 1);
  assert.equal(upstreamCalls.some(x => x.includes('query2.finance.yahoo.com')), false,
    'official fallback should run before a second Yahoo request');

  console.log('Yahoo rate-limit falls back to validated TWSE MIS intraday quote.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
