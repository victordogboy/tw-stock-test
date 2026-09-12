const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');

function harness(old, history, chips) {
  const context = vm.createContext({ Request, Response, Headers, URL, console });
  vm.runInContext(source.replace('export default {', 'globalThis.worker = {'), context);
  const writes = [], calls = [];
  context.requestFinMindToken = async () => '';
  context.readResearchCache = async () => old;
  context.writeResearchCache = async (_, value) => { writes.push(value); };
  context.callOwnApiJSON = async url => {
    calls.push(url);
    return url.startsWith('/api/history/') ? history : chips;
  };
  return { writes, calls, async request(action, start = '2026-09-01', end = '2026-09-11') {
    const body = { code: '2330', market: 'twse', start_date: start, end_date: end };
    const url = new URL(`https://test.example/api/research/cache/${action}`);
    let req;
    if (action === 'build') req = new Request(url, { method: 'POST', body: JSON.stringify(body) });
    else { Object.entries(body).forEach(([k,v]) => url.searchParams.set(k,v)); req = new Request(url); }
    const res = await context.worker.fetch(req, {});
    return { status: res.status, body: await res.json() };
  }};
}

const old = { code: '2330', market: 'twse', coverage_start: '2026-09-01', coverage_end: '2026-09-10',
  history: [{ date: '2026-09-10', close: 100 }], chips: {}, completeness: 100 };
const goodHistory = { ok: true, body: { data: [{ date: '2026-09-11', close: 101 }] } };
const goodChips = { ok: true, body: { completeness: 100, margin: [{ date: '2026-09-11', MarginPurchaseTodayBalance: 0 }], inst: [], daytrade: [] } };

for (const [name, history, chips] of [
  ['failed history request', { ok: false, body: {} }, goodChips],
  ['empty history response', { ok: true, body: { data: [] } }, goodChips],
  ['failed chips request', goodHistory, { ok: false, body: {} }],
  ['partial chips response', goodHistory, { ok: true, body: { completeness: 67 } }],
]) test(name + ' preserves existing coverage and remains retryable', async () => {
  const h = harness(old, history, chips);
  for (let i = 0; i < 2; i++) {
    const result = await h.request('build');
    assert.equal(result.status, 502);
    assert.equal(result.body.coverage_end, '2026-09-10');
    assert.equal(result.body.cache_preserved, true);
  }
  assert.equal(h.writes.length, 0);
  assert.equal(h.calls.length, 4);
});

test('failed initial build does not publish coverage', async () => {
  const h = harness(null, goodHistory, { ok: false, body: {} });
  const r = await h.request('build');
  assert.equal(r.status, 502);
  assert.equal(r.body.coverage_end, null);
  assert.equal(h.writes.length, 0);
});

test('successful extension merges history, preserves real zero, and fetches only the missing range', async () => {
  const h = harness(old, goodHistory, goodChips);
  assert.equal((await h.request('build')).status, 200);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].coverage_end, '2026-09-11');
  assert.equal(h.writes[0].history.length, 2);
  assert.equal(h.writes[0].chips.margin[0].MarginPurchaseTodayBalance, 0);
  assert.ok(h.calls.every(url => url.includes('start_date=2026-09-11')));
});

test('already covered build and load never fetch upstream', async () => {
  const h = harness(old);
  assert.equal((await h.request('build', '2026-09-01', '2026-09-10')).status, 200);
  assert.equal((await h.request('load', '2026-09-01', '2026-09-10')).status, 200);
  assert.equal((await h.request('load')).status, 409);
  assert.equal(h.calls.length, 0);
  assert.equal(h.writes.length, 0);
});
