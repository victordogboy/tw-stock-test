import {test} from 'node:test';import assert from 'node:assert/strict';
import {sessionReview} from '../public/r1494a/c26/a56/session-review.mjs';
import {collectQuoteCodes} from '../public/r1494a/c26/a56/quotes.mjs';
import {assessExecution} from '../public/r1494a/c26/a56/execution.mjs';
const todayPlan={signal_as_of:'2026-11-17',trade_date:'2026-11-18',actions:[{code:'3406',orderType:'A_OPEN_LIMIT',level:844}],candidates:[{code:'3406',b_floor:836,b_cap:857,c_arm:758,c_floor:771,c_cap:791}],opening_slots:3};
const blocked={readiness:'blocked',signal_as_of:'2026-11-17',trade_date:'2026-11-19',actions:[],candidates:[]};
const D={dates:['2026-11-17'],snapshots:[{date:'2026-11-17',holdings:[{code:'2801'}]}],a56:{ready:false,reviewPlans:[todayPlan]}};
const at=t=>Date.parse(t+'+08:00');
test('13:30 expiry does not erase the verified plan, candidates or strategy prices',()=>{
 const open=sessionReview(D,0,blocked,at('2026-11-18T13:29:00')),closed=sessionReview(D,0,blocked,at('2026-11-18T13:30:00'));
 assert.equal(open.mode,'盤中追蹤');assert.equal(closed.mode,'收盤檢視');assert.equal(closed.ready,true);assert.equal(closed.reviewOnly,true);
 assert.deepEqual(closed.plan,open.plan);assert.equal(closed.plan.actions[0].level,844);
 assert.deepEqual(collectQuoteCodes(closed.snapshot,closed.plan).map(r=>r.code),['2801','3406']);
 const rows=assessExecution({...closed,quotes:[{code:'3406',status:'available',trade_date:'2026-11-18',open:858}]});assert.equal(rows[0].state,'not_filled');assert.match(rows[0].reason,/858.*844/);
 assert.equal(D.a56.ready,false);assert.equal(blocked.readiness,'blocked');assert.equal(blocked.actions.length,0);
});
test('publishing tomorrow plan retains today review and uses pretrade holdings',()=>{
 const tomorrow={...todayPlan,signal_as_of:'2026-11-18',trade_date:'2026-11-19',candidates:[{code:'9999'}]};
 const d={...D,dates:[...D.dates,'2026-11-18'],snapshots:[...D.snapshots,{date:'2026-11-18',holdings:[{code:'3406'}]}],a56:{ready:true,reviewPlans:[todayPlan,tomorrow]}};
 const r=sessionReview(d,1,tomorrow,at('2026-11-18T15:00:00'));assert.equal(r.plan.trade_date,'2026-11-18');assert.equal(r.snapshot.date,'2026-11-17');assert.equal(r.snapshot.holdings[0].code,'2801');assert.equal(tomorrow.trade_date,'2026-11-19');
});
test('invalid archive fallback cannot masquerade as reviewed verified plan',()=>{
 const r=sessionReview({...D,a56:{ready:false,reviewPlans:[]}},0,blocked,at('2026-11-18T15:00:00'));assert.equal(r.ready,false);assert.equal(r.mode,'等待已驗證計畫');
});
test('historical model selection never mixes today quotes into its original view',()=>{
 assert.equal(sessionReview({...D,dates:['2026-11-16','2026-11-17']},0,todayPlan,at('2026-11-18T15:00:00')),null);
});
test('reopening after close derives review from durable verified asset, not memory',()=>{
 const restored=JSON.parse(JSON.stringify(D));const r=sessionReview(restored,0,blocked,at('2026-11-18T18:00:00'));assert.equal(r.plan.actions[0].level,844);assert.equal(r.mode,'收盤檢視');
});
