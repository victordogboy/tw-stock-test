import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {parseCsv,validateC26} from '../public/r1494a/c26/app.mjs';

const dataDir='public/r1494a/c26/data/';
const frozen='research/c26-lock/';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

test('uploaded frozen Python engine hash and exact cost/parameters remain immutable',()=>{
  const text=fs.readFileSync(frozen+'source/C26_SIMULATOR_FROZEN.py');
  const manifest=JSON.parse(fs.readFileSync(frozen+'MANIFEST_SHA256.json','utf8'));
  const params=JSON.parse(fs.readFileSync(frozen+'C26_LOCK_PARAMETERS.json','utf8'));
  assert.equal(sha(text),'741862f102438f8f10fcf40cf2f9b47edb8fece004e0175ae3f1be7e94bd4ad5');
  assert.equal(manifest.frozen_inner_simulator_sha256,sha(text));
  assert.equal(params.total_round_trip_cost_pct,0.5855);
  assert.equal(params.event_only_no_fixed_schedule,true);
  assert.equal(params.loss_exit_cooldown_trading_days,26);
  assert.equal(params.correlation_lookback_days,40);
  assert.equal(params.correlated_exposure_limit,0.30);
  assert.equal(params.trading_allowed,false);
});

test('public auto-loaded C26 NAV/orders pass exact frozen archive replay parity (not FC23)',()=>{
  const map=JSON.parse(fs.readFileSync(dataDir+'historical-assets.json','utf8'));
  const manifest=JSON.parse(fs.readFileSync('public/r1494a/c26/manifest.json','utf8'));
  assert.equal(map.lock_id,'C26-EVENT-CORR-LOCK-20261112');
  assert.equal(map.asof,'2026-10-27');
  const decompress=group=>{
    const ref=map.parts[group];
    const blob=Buffer.from(ref.base64_parts.map(x=>fs.readFileSync(dataDir+x,'utf8').trim()).join(''),'base64');
    assert.equal(blob.length,ref.bytes_gzip);
    assert.equal(sha(blob),ref.sha256_gzip);
    return parseCsv(gunzipSync(blob).toString('utf8'));
  };
  const days=decompress('nav'),orders=decompress('orders');
  const v=validateC26(days,orders,manifest);
  assert.equal(v.orders,1758);
  assert.equal(v.newFills,309);
  assert.equal(days.length,1407);
  assert.ok(Math.abs(v.ret-1720.495844396837)<1e-8);
  assert.ok(Math.abs(v.mdd+17.989769234703846)<1e-8);
  assert.equal(manifest.live_plan_readiness,'blocked');
  assert.equal(manifest.live_trading_enabled,false);
});
