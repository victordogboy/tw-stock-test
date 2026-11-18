import {test} from 'node:test';import assert from 'node:assert/strict';
import {assessExecution} from '../public/r1494a/c26/a56/execution.mjs';
import {parseYahooMinutes,a56QuotesRoute} from '../src/c26/a56-quotes.mjs';
const date='2026-11-18',start=Date.parse(date+'T09:00:00+08:00');
const candidate={code:'3406',c_arm:758,c_floor:771,c_cap:791,b_floor:836,b_cap:857};
const plan={trade_date:date,opening_slots:1,actions:[{code:'3406',orderType:'A_OPEN_LIMIT',level:844}],candidates:[candidate]};
const bar=(minute,open,high,low,complete=true)=>({minute,start:new Date(start+minute*60000).toISOString(),open,high,low,complete,volume_shares:10000});
function run(bars,extra={}){return assessExecution({plan,snapshot:{holdings:[]},quotes:[{code:'3406',status:'available',trade_date:date,open:858,source_time:new Date(start+3600000).toISOString(),minutes:{status:'available',date,bars,missing_price_bars:0}}],...extra})}
test('opening A cannot fill on a later dip; B price match stays unconfirmed',()=>{
 const rows=run([bar(0,858,860,845),bar(1,849,850,844),bar(2,844,846,836)]);
 assert.equal(rows[0].state,'not_filled');const b=rows.find(r=>r.route==='B_reclaim');assert.equal(b.state,'price_match');assert.equal(b.price,849);assert.equal(b.broker_status,'unconfirmed');assert.ok(rows.every(r=>r.state!=='model_filled'));
});
test('C does not infer low then high from the same bar, or use incomplete bars',()=>{
 const c=rows=>rows.find(r=>r.route==='C_intraday');
 assert.notEqual(c(run([bar(0,800,810,745),bar(1,780,780,775)])).state,'price_match');
 assert.notEqual(c(run([bar(0,760,760,745),bar(1,775,780,770,false),bar(2,780,780,775)])).state,'price_match');
 const r=c(run([bar(0,760,760,745),bar(1,775,780,770),bar(2,780,780,775)]));assert.equal(r.state,'price_match');assert.equal(r.price,780);assert.equal(r.time,new Date(start+120000).toISOString());
});
test('no missing-minute bridge fabricates next-minute execution',()=>{const rows=run([bar(0,858,860,845),bar(2,844,846,836)]);const b=rows.find(r=>r.route==='B_reclaim');assert.notEqual(b.state,'price_match');assert.equal(b.state,'unknown')});
test('historical quote, unverified plan, zero slots and held stock cannot become fills',()=>{
 assert.ok(run([], {ready:false}).every(r=>r.state==='unknown'));
 assert.ok(run([],{quotes:[{code:'3406',status:'available',trade_date:'2026-11-17'}]}).every(r=>r.state==='unknown'));
 assert.equal(run([],{plan:{...plan,opening_slots:0}}).find(r=>r.route==='B_reclaim').state,'blocked');
 assert.equal(run([],{snapshot:{holdings:[{code:'3406'}]}}).find(r=>r.route==='C_intraday').state,'blocked');
});
test('verified ledger is the only source for model-filled state',()=>{
 const r=run([],{orders:[{date,code:'3406',route:'B_reclaim',filled:true,price:844,executionTime:'09:02分K開盤代理'}]}).find(r=>r.route==='B_reclaim');assert.equal(r.state,'model_filled');assert.equal(r.price,844);assert.equal(r.broker_status,'unconfirmed');
});
test('entry cutoff respects original final execution minute 12:30',()=>{
 const rows=run([bar(210,800,860,740),bar(211,780,790,770)]);assert.ok(rows.every(r=>r.state!=='price_match'));
});
test('Yahoo minute parsing excludes future/current unfinished signal bars and retains unknown volume',()=>{
 const raw={chart:{result:[{meta:{symbol:'3406.TW',exchangeTimezoneName:'Asia/Taipei',dataGranularity:'1m',regularMarketTime:(start+90000)/1000},timestamp:[start/1000,(start+60000)/1000],indicators:{quote:[{open:[858,849],high:[860,850],low:[845,844],close:[849,844],volume:[0,199000]}]}}]}};
 const feed=parseYahooMinutes(raw,'3406.TW',start+120000);assert.equal(feed.bars[0].complete,true);assert.equal(feed.bars[1].complete,false);assert.equal(feed.bars[0].volume_shares,null);assert.equal(feed.fills_verified,false);
 assert.equal(parseYahooMinutes(raw,'1303.TW',start+120000),null);
 raw.chart.result[0].timestamp.reverse();assert.equal(parseYahooMinutes(raw,'3406.TW',start+120000),null);
});
test('minute API bounds its provider request budget',async()=>{const r=await a56QuotesRoute(new Request('https://site/api?minutes=1&codes=1111,2222,3333,4444,5555,6666,7777'));assert.equal(r.status,400)});
