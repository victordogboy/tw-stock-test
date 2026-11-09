import test from 'node:test';
import assert from 'node:assert/strict';
import {auditR11Seed} from '../public/r11/seed-audit.mjs';
const make=()=>{
 const rows=[];let d=new Date('2021-10-22T00:00:00Z');
 for(let i=0;i<2428;i++){
  if(i%2===0&&i>0)d=new Date(d.getTime()+86400000);
  rows.push({i,date:d.toISOString().slice(0,10),session:i%2?'day':'night',atr20:200,core:0,p40_pnl:0,market_move:0,r26_pnl:0});
 }
 rows[2427].date='2026-10-22';rows[2426].date='2026-10-22';
 return {manifest:{schema:'R11_CAUSAL_SEED_V1',sessions:2428,verified_date_and_atr_alignment:true},sessions:rows};
};
test('archival seed never permits live trades',()=>{
 const s=make();const a=auditR11Seed(s);
 // Test fixture dates must be chronological. Artificial long-span seed only tests strict reject.
 assert.equal(a.tradeable,false);assert.equal(a.paper_only,true);
 assert.equal(a.next_missing_date,'2026-10-23');
 assert.ok(a.errors.includes('DUPLICATE_OR_UNSORTED_SESSION_2426'));
});
test('reject missing/malformed or forged P40 state',()=>{
 const s=make();s.sessions[0].p40_pnl='999';
 const a=auditR11Seed(s);
 assert.equal(a.ok,false);assert.ok(a.errors.some(x=>x.startsWith('INVALID_SESSION_')));
 assert.equal(a.tradeable,false);
});
test('missing seed is blocked',()=>{
 const a=auditR11Seed(null);assert.equal(a.ok,false);assert.equal(a.tradeable,false);
});
