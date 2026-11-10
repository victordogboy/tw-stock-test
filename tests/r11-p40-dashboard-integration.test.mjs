import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {replayP40Session} from '../public/r11/p40-shadow-engine.mjs';
const page=readFileSync(new URL('../public/r11/index.html',import.meta.url),'utf8');
const api=readFileSync(new URL('../src/r11-preopen.mjs',import.meta.url),'utf8');
test('exact original P40/A-shadow engine integrated without damaging existing private seed or daily replay',()=>{
 assert.ok(page.includes("from './p40-shadow-engine.mjs'"));
 assert.ok(page.includes('id="p40-original-panel"'));
 assert.ok(page.includes('id="p40-engine-test"'));
 assert.ok(page.includes("addEventListener('click',verifyP40LocalKernel)"));
 assert.ok(page.includes('id="seed-file"'));
 assert.ok(page.includes('id="r26-daily-replay-panel"'));
 assert.ok(page.includes('id="bk-token"'));
 assert.ok(page.includes('P40 是允許跨盤持倉'));
});
test('new preopen diagnostic reflects real historical parity but remains blocked',()=>{
 assert.ok(api.includes('p40_a_shadow_python_js_parity'));
 assert.ok(api.includes('minute_bars:1361206'));
 assert.ok(api.includes("status:'BLOCKED'"));
 assert.ok(api.includes('tradeable:false'));
});
test('live facade rejects unverified R26 direction even when minute history is present',()=>{
 const s={session:'night',contract:'202611',atr:250,signal:1,bars:[[28000,28100,27900,28050]],
   levels:[27800,27900,28050,28200,28300],signal_verified:false,bars_verified:true,
   atr_verified:true,contract_verified:true,calendar_verified:true,levels_verified:true};
 assert.throws(()=>replayP40Session(s),/VERIFIED_FEATURES/);
});
