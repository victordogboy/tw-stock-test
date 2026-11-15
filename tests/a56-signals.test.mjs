import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import {gunzipSync} from 'node:zlib';
import {MinuteMonitor,VerifiedMinuteFeed,openingIntent,tick,marketWarning,candidate,rankCandidates,tranche,exitReason} from '../public/r1494a/c26/a56/signals.mjs';
const c=candidate('3443',100,110,60,true,[{date:'2026-11-12',ref_close:100,low:90,close:92,volume_shares:1e6,executable:true}]);
const config={sessionDate:'2026-11-16',candidates:[c],slots:4,budget:.4,navTwd:3e6};
const bar=(k=0,extra={})=>({code:'3443',start:`2026-11-16T09:${String(k).padStart(2,'0')}:00+08:00`,end:`2026-11-16T09:${String(k+1).padStart(2,'0')}:00+08:00`,status:'TRADED',high:95,low:92,volume_shares:10000,volume_unit:'shares',...extra});
test('legal ticks and frozen completed-day conditions',()=>{
 for(const p of [9.99,10,49.99,50,99.99,100,499.99,500,999.99,1000]){assert.ok(tick(p)<=p+1e-8);assert.ok(tick(p,true)>=p-1e-8)}
 assert.equal(marketWarning([100,100,100,100,100,90])[0],true);
 assert.equal(marketWarning([100,100,100,100,100,95])[0],false);
 assert.equal(exitReason(false,.1,false,1,2),'warning_ended');
 assert.deepEqual(tranche(true,.4,false,1,null,false,false,false,0,3e6,3e6,{opening:true}),[0,0]);
 assert.deepEqual(rankCandidates([{code:'1',strength60:1},{code:'2',strength60:1}]).map(x=>x.code),['1','2']);
});
test('C recovery requires a later completed minute and C precedes B',()=>{
 const m=new MinuteMonitor(c,.4,4,3e6);assert.deepEqual(m.completed(0,95,92,10000).map(x=>x.route),['B_reclaim']);
 assert.deepEqual(m.completed(1,95,94,10000).map(x=>x.route),['C_intraday','B_reclaim']);
});
test('unfinished, stale, missing, wrong-unit and malformed batches never advance',()=>{
 const g=new VerifiedMinuteFeed(config);
 for(const [bars,now] of [[[bar()],'2026-11-16T09:00:59+08:00'],[[bar()],'2026-11-16T09:03:00+08:00'],[[],'2026-11-16T09:01:00+08:00'],[[bar(0,{volume_unit:'lots'})],'2026-11-16T09:01:00+08:00'],[[bar(0,{high:NaN})],'2026-11-16T09:01:00+08:00']]){
  assert.throws(()=>g.accept(bars,now));assert.equal(g.last,-1);assert.equal(g.monitors.get(c.code).last,-1);
 }
 const obs=g.accept([bar()],'2026-11-16T09:01:00+08:00');assert.equal(g.last,0);assert.equal(obs[0].status,'PAPER_CONDITIONAL_INTENT');assert.equal(obs[0].minute,1);
 assert.throws(()=>g.accept([bar()],'2026-11-16T09:01:00+08:00'));assert.equal(g.last,0);
});
test('a conditional intent expires when its next execution minute ends, even inside source delay allowance',()=>{
 const g=new VerifiedMinuteFeed(config);
 assert.throws(()=>g.accept([bar()],'2026-11-16T09:02:00+08:00'));
 assert.equal(g.last,-1);
 assert.equal(g.accept([bar()],'2026-11-16T09:01:59+08:00')[0].minute,1);
});
test('confirmed no trade differs from unknown; blocked symbols cannot re-enter',()=>{
 const g=new VerifiedMinuteFeed(config);assert.throws(()=>g.accept([bar(0,{status:'UNKNOWN'})],'2026-11-16T09:01:00+08:00'));
 assert.deepEqual(g.accept([bar(0,{status:'CONFIRMED_NO_TRADE',high:null,low:null,volume_shares:0})],'2026-11-16T09:01:00+08:00'),[]);
 assert.deepEqual(g.accept([],'2026-11-16T09:02:00+08:00',['3443']),[]);
 assert.throws(()=>g.accept([bar(2)],'2026-11-16T09:03:00+08:00',[]));assert.equal(g.last,1);
});
test('invalid second symbol rolls back first symbol too',()=>{
 const d={...c,code:'3661'},g=new VerifiedMinuteFeed({...config,candidates:[c,d]});
 assert.throws(()=>g.accept([bar(),bar(0,{code:'3661',low:-1})],'2026-11-16T09:01:00+08:00'));
 assert.equal(g.monitors.get('3443').last,-1);assert.equal(g.monitors.get('3661').last,-1);
});
test('Python frozen histories match every browser opening order and minute intent',()=>{
 const p=JSON.parse(gunzipSync(fs.readFileSync(new URL('../research/a56-stage5/parity-fixtures.json.gz',import.meta.url))));let n=0;
 for(const x of p.opening)assert.deepEqual(openingIntent(x.candidates,x.hold,x.blocked,x.budget,x.nav),x.expected,x.date);
 for(const x of p.cases){const m=new MinuteMonitor(x.candidate,x.budget,x.slots,x.nav);
  x.bars.forEach((b,k)=>{assert.deepEqual(m.completed(k,...b.map(v=>v===null?NaN:v)),x.expected[k],`${x.date} ${x.candidate.code} ${k}`);n++});
 }
 assert.equal(p.opening.length,1419);assert.ok(n>10000);console.log('PARITY',JSON.stringify({opening:p.opening.length,cases:p.cases.length,completed_minutes:n}));
});
