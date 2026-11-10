import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import z from 'node:zlib';
import {replayP40} from '../public/r11/p40-replay.mjs';import {nextCoreState} from '../public/r11/next-core.mjs';
const root=new URL('../public/r26-engine/data/',import.meta.url),meta=JSON.parse(z.gunzipSync(fs.readFileSync(new URL('manifest.json.gz',root)))),raw=z.gunzipSync(Buffer.concat(meta.compressedParts.map(n=>fs.readFileSync(new URL(n,root))))),bars=new Int32Array(raw.buffer,raw.byteOffset,raw.length/4),r=replayP40(meta,bars);
test('every post-warmup next direction agrees with canonical full historical replay without target OHLC',()=>{
 let count=0;
 for(let i=500;i<r.sessions.length;i++){
  const s=r.sessions[i],prior=r.sessions.slice(0,i),shadow=r.shadow.rows.filter(x=>x.date<s.date||(x.date===s.date&&x.sid<s.sid));
  const n=nextCoreState({sessions:prior,shadow:{rows:shadow}},{trade_date:s.date,session:s.sid?'day':'night'});
  assert.equal(n.core.raw_signal,s.signal,s.date+' raw');assert.equal(n.core.blocked,s.r26blocked,s.date+' block');assert.ok(Math.abs(n.daily.atr20-s.atr)<1e-9);assert.equal(n.tradeable,false);count++;
 }
 assert.equal(count,r.sessions.length-500);
});
test('day cannot skip missing night and shadow ledger must match latest completed session',()=>{
 assert.throws(()=>nextCoreState(r,{trade_date:'2026-10-27',session:'day'}),/ADJACENT/);
 assert.throws(()=>nextCoreState({...r,shadow:{rows:r.shadow.rows.slice(0,-1)}},{trade_date:'2026-10-27',session:'night'}),/ALIGNED/);
});
