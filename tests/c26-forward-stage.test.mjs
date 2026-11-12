import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const base='research/c26-lock/forward/archive-feature-reference.json';
const statusFile='public/r1494a/c26/data/forward-status.json';
const dataFile='.c26-private/forward-eod.json.gz';
const ref=JSON.parse(fs.readFileSync(base,'utf8'));
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
test('C26 immutable archive overlap has 233 unique stocks and T+1 feature references',()=>{
 assert.equal(ref.lock_id,'C26-EVENT-CORR-LOCK-20261112');
 assert.equal(ref.codes.length,233);assert.equal(new Set(ref.codes).size,233);
 assert.equal(ref.pool_sha256,digest(ref.codes.join('\n')));
 assert.equal(Object.keys(ref.days).at(-1),'2026-10-27');
 for(const x of Object.values(ref.days))for(const key of ['F5','T5','peer_breadth'])assert.equal(x[key].length,233);
});
test('C26 forward staging never changes trading readiness, even with good FinMind prices',()=>{
 assert.equal(fs.existsSync('public/r1494a/c26/data/forward-eod.json.gz'),false,'FinMind raw records must not be publicly committed');
 if(!fs.existsSync(statusFile)||!fs.existsSync(dataFile))return;
 const st=JSON.parse(fs.readFileSync(statusFile,'utf8'));
 const compressed=fs.readFileSync(dataFile);
 assert.equal(digest(compressed),st.sha256_gzip);
 const raw=JSON.parse(gunzipSync(compressed));
 assert.equal(raw.pool_sha256,ref.pool_sha256);
 assert.equal(st.universe_count,233);
 assert.equal(st.live_plan_readiness,'BLOCKED');
 assert.equal(st.public_raw_data,false);
 assert.equal(st.frozen_c26_portfolio_replay,'NOT_IMPLEMENTED');
 assert.ok(st.state==='source_staged'||st.state==='source_partial');
 for(const day of Object.values(raw.days)){
  assert.ok(day.date>='2026-10-16');
  assert.ok(day.price_valid<=233);
  assert.equal(day.price.length,new Set(day.price.map(x=>x.stock_id)).size);
  for(const row of day.price)if(row.valid){assert.ok(row.high>=row.low&&row.open>0&&row.close>0)}
 }
});