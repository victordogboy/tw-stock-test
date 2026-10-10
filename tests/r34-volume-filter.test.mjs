import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {createScanRuntime} from '../src/scan-runtime.mjs';
import {validateOptions} from '../src/scan-job.mjs';
const require=createRequire(import.meta.url),{page}=require('./helpers/detail-page.cjs');
const RealDate=Date,target='2026-09-30';
const history=volume=>Array.from({length:220},(_,i)=>({date:new RealDate(Date.UTC(2026,8,30-220+i)).toISOString().slice(0,10),open:30,high:31,low:29,close:30,volume}));
const quote=(volume,time='10:30:00')=>({quote_valid:true,bar:{date:target,open:30,high:31,low:29,close:30,volume,last_time:time}});
function clock(t,hour){const at=`${target}T${hour}:00+08:00`;globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[at]))}static now(){return new RealDate(at).getTime()}};t.after(()=>globalThis.Date=RealDate);}
function setup(hist,q,minLots=3000){let current=q;const calls=[];const get=async url=>{calls.push(url);return url.includes('/intraday')?current:{data:hist,source:'fixture'}};return {rt:createScanRuntime({targetDate:target,options:validateOptions({minLots})},get),get,calls,setQuote:q=>current=q};}
const item={code:'2330',market:'twse'};
test('intraday surge passes using projected volume even when yesterday and cumulative volume are below threshold; browser matches server',async t=>{
 clock(t,'10:30');const a=setup(history(1000000),quote(1500000));
 const {row,error}=await a.rt.scan(item);assert.equal(error,null);assert.ok(row);assert.equal(a.calls.length,2);
 assert.equal(row.liquidityVolume,3625000);assert.equal(row.liveActualVolume,1500000);assert.equal(row.liquidityBasis,'projected');assert.equal(row.liquidityDate,target);
 assert.equal(row._hist.at(-1).volume,row.liquidityVolume);assert.equal(row.holdVolumeProjected,true);
 const p=page('scanner.html');p.ctx.getJSON=a.get;p.ctx.Date=globalThis.Date;
 vm.runInContext(`SCAN_TARGET_DATE='${target}';SCAN_FILTERS={minClose:10,maxClose:300,minLots:3000}`,p.ctx);
 await vm.runInContext("worker({code:'2330',market:'twse'})",p.ctx);
 const browser=vm.runInContext('results[0]',p.ctx);assert.equal(browser.liquidityVolume,row.liquidityVolume);assert.equal(browser.entry,row.entry);
 vm.runInContext('renderRankOnly()',p.ctx);assert.match(p.nodes.get('rows').innerHTML,/預估收盤量/);assert.match(p.nodes.get('rows').innerHTML,/3,625/);assert.match(p.nodes.get('rows').innerHTML,/1,500/);
});
test('large prior-day volume cannot admit a quiet stock, including futures',async t=>{
 clock(t,'12:30');const a=setup(history(10000000),quote(200000,'12:30:00'));
 const {row,error}=await a.rt.scan({...item,hasFutures:true});assert.equal(row,null);assert.match(error,/低於最低成交量.*盤中預估/);assert.equal(a.calls.length,2);
});
test('live refresh rechecks exact volume threshold, including compact background rank rows',async t=>{
 clock(t,'10:30');const a=setup(history(1000000),quote(1500000)),{row}=await a.rt.scan(item);
 a.setQuote(quote(200000,'12:30:00'));await a.rt.liveCurrentRecheckOne(row);assert.equal(a.rt.selectCandidates([row]).length,0);
 // Background storage carries volume alongside score; display rounding never controls inclusion.
 assert.equal(a.rt.selectCandidates([{code:'a',entry:50,liquidityVolume:2999999}]).length,0);
 assert.equal(a.rt.selectCandidates([{code:'a',entry:50,liquidityVolume:3000000}]).length,1);
});
test('closing daily and fallback quotes both use current actual volume, never previous day',async t=>{
 clock(t,'14:00');for(const daily of [false,true])for(const vol of [2000000,4000000]){
  const hist=history(1000000);if(daily)hist.push(quote(vol).bar);
  const a=setup(hist,quote(vol,'13:30:00')),{row,error}=await a.rt.scan(item);
  assert.equal(!!row,vol>=3000000);if(row){assert.equal(row.liquidityBasis,'actual');assert.equal(row.liquidityVolume,vol);assert.equal(row.liveActualVolume,vol)}else assert.match(error,/當日實際/);
 }
});
test('formal history refresh retains intraday projection and switches to actual at close',async t=>{
 clock(t,'10:30');const hist=history(1000000),a=setup(hist,quote(1500000)),{row}=await a.rt.scan(item);
 hist.push(quote(2000000).bar);await a.rt.formalizeListedOne(row);assert.equal(row.liquidityVolume,3625000);assert.equal(row.liquidityBasis,'projected');
 clock(t,'14:00');await a.rt.formalizeListedOne(row);assert.equal(row.liquidityVolume,2000000);assert.equal(row.liquidityBasis,'actual');assert.equal(a.rt.selectCandidates([row]).length,0);
});
test('zero volume never becomes tradable through historical smoothing; missing volume or time is rejected',async t=>{
 clock(t,'10:30');for(const [vol,time] of [[0,'10:30:00'],[null,'10:30:00'],[-1,'10:30:00'],[1000000,'']]){
  const a=setup(history(10000000),quote(vol,time)),r=await a.rt.scan(item);assert.equal(r.row,null);assert.ok(r.error);
 }
});
