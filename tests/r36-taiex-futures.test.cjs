const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const core=require('../public/taiex-futures-core.js'),SAR=require('../public/parabolic-sar.js');
const row=(date,contract='202610',session='position',extra={})=>({date,futures_id:'TX',contract_date:contract,trading_session:session,open:100,close:103,max:105,min:98,volume:1000,open_interest:4000,...extra});
test('normalization excludes other products, weekly/spread contracts and invalid OHLC without silently adding duplicate volumes',()=>{
 const a=row('2026-10-01');const n=core.normalize([a,a,row('2026-10-01','202610W1'),row('2026-10-01','202610/202611'),row('2026-10-01','202609'),{...a,futures_id:'MTX'},row('2026-10-02','202610','position',{min:null}),row('2026-10-03','202610','position',{max:99}),row('2026-02-30')]);
 assert.equal(n.data.length,1);assert.equal(n.rejected,7);assert.equal(n.data[0].volume,1000);
 assert.throws(()=>core.normalize([a,{...a,close:102}]),/重複/);
});
test('night + day uses exchange trading date, night open, day close, session volumes, and only day OI',()=>{
 const raw=[row('2026-10-01'),row('2026-10-01','202610','after_market',{open:97,max:106,min:96,close:101,volume:400,open_interest:0}),row('2026-10-02','202610','after_market')];
 const data=core.normalize(raw).data,full=core.series(data,{session:'combined'});
 assert.equal(full.length,1);assert.equal(full[0].open,97);assert.equal(full[0].close,103);assert.equal(full[0].high,106);assert.equal(full[0].low,96);assert.equal(full[0].volume,1400);assert.equal(full[0].openInterest,4000);
 assert.equal(core.series(data,{session:'after_market'})[0].openInterest,null);
 assert.equal(core.series(core.normalize([row('2026-10-01')]).data,{session:'combined'})[0].nightMissing,true);
});
test('nearest monthly series rolls only on observable dates and fixed contract never splices',()=>{
 const raw=[row('2026-10-20'),row('2026-10-20','202611','position',{close:104}),row('2026-10-21','202610'),row('2026-10-21','202611'),row('2026-10-22','202611')];
 const n=core.normalize(raw).data,near=core.series(n);
 assert.deepEqual(near.map(r=>r.contract),['202610','202610','202611']);assert.equal(near[2].rollover,true);
 assert.equal(core.summary(near).change,null);assert.equal(core.summary(near).oiChange,null);
 const fixed=core.series(n,{contract:'202611'});assert.equal(fixed.length,3);assert.ok(fixed.every(b=>!b.rollover));
 assert.deepEqual(core.series(n.filter(r=>r.date<='2026-10-21')),near.slice(0,2));
});
test('analysis uses prefix only, contracts not stock lots, excludes current volume from average',()=>{
 const raw=Array.from({length:25},(_,i)=>row('2026-10-'+String(i+1).padStart(2,'0'),'202610','position',{open:100+i,close:101+i,max:103+i,min:99+i,volume:i===24?5000:1000,open_interest:4000+i}));
 const rows=core.series(core.normalize(raw).data),s=core.summary(rows);
 assert.equal(s.volumeRatio,5);assert.equal(s.oiChange,1);assert.equal(s.ma5,123);assert.equal(s.ma60,null);assert.equal(s.bar.volume,5000);
 const all=SAR.calculate(rows);assert.deepEqual(SAR.calculate(rows.slice(0,12)),all.slice(0,12));
 assert.equal(core.summary(rows.slice(0,12)).volumeRatio,null);
});
test('individual-stock search redirects TX aliases before looking up a stock',async()=>{
 const {page}=require('./helpers/detail-page.cjs');const p=page('detail.html');p.nodes.get('stockInput').value='台指期';await vm.runInContext('analyze()',p.ctx);assert.equal(p.ctx.location.href,'/futures.html');
});
