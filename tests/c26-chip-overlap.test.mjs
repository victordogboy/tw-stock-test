import test from 'node:test';import assert from 'node:assert/strict';
import {groupInstitution,netInstitution,ratio5,audit} from '../research/c26-lock/forward/audit-chip-overlap.mjs';
test('Institution name grouping excludes separate foreign dealer but accepts Foreign_Investor and investment trust',()=>{
 assert.equal(groupInstitution('Foreign_Investor'),'foreign');assert.equal(groupInstitution('Investment_Trust'),'trust');
 assert.equal(groupInstitution('Foreign_Dealer'),null);assert.equal(groupInstitution('外資及陸資(不含外資自營商)'),'foreign');
 assert.equal(netInstitution([{name:'Foreign_Investor',buy:120,sell:20},{name:'Foreign_Dealer',buy:300,sell:0}],'foreign'),100);
});
test('Only prior five finished trading days contribute; no after-t data used',()=>{
 const dates=['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-27','2026-10-28'];
 const days=Object.fromEntries(dates.map((d,i)=>[d,{source_state:'available',price:[{stock_id:'1101',valid:true,volume:1000}],institutional:[{stock_id:'1101',name:'Foreign_Investor',buy:i===5?999999:120,sell:20}]}]));
 const x=ratio5(days,dates,'2026-10-27',{stockId:'1101',field:'foreign'});
 assert.ok(Math.abs(x-.1)<1e-12);
 assert.equal(ratio5(days,dates,'2026-10-20',{stockId:'1101',field:'foreign'}),null);
 const ref={lock_id:'C26-EVENT-CORR-LOCK-20261112',pool_sha256:'test',codes:['1101'],days:{'2026-10-27':{F5:[.1],T5:[null]}}};
 const res=audit(ref,{lock_id:ref.lock_id,pool_sha256:'test',days});
 assert.equal(res.results[0].exact1e5,1);assert.equal(res.results[0].bad_gt_1e3,0);
 assert.equal(res.trade_plan,'BLOCKED');
});