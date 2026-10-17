const test=require('node:test');
const assert=require('node:assert/strict');
const A=require('../public/taiex-action.js');
const {multiFixture}=require('./helpers/taiex-multi.cjs');

const config={delta:0,minEntry:0,exit:0,maxAge:0,cost:3};
const range={start:'2025-10-01',end:'2026-02-28'};

test('continuous roll-adjusted indicators warm up once even if each contract has under 61 bars',()=>{
 const rows=[],start=Date.UTC(2025,0,1);
 let prevContract=null;
 for(let i=0;i<150;i++){
  const date=new Date(start+i*86400000).toISOString().slice(0,10),contract=A.nextMonth(date);
  const c=20000+Math.sin(i/8)*180+i;
  const b={date,contract,open:c-5,close:c,high:c+20,low:c-20,volume:1000+i,openInterest:2000};
  rows.push(b);
  if(prevContract&&contract!==prevContract)rows.push({...b,contract:prevContract,open:b.open+25,close:b.close+25,high:b.high+25,low:b.low+25});
  prevContract=contract;
 }
 const result=A.backtestMulti(rows,config,{}, {start:rows[0].date,end:rows.at(-1).date});
 assert(result.months.length>=4);
 assert(result.validBars>=80,'MA60 must retain prior-month signal warmup');
 assert(result.warmupBars<=61,'repeated monthly MA60 warmup loses too many bars');
 assert.equal(result.totalBars,150);
});

test('contract price offsets and contract volume unit changes do not alter roll-adjusted signals or fills',()=>{
 const original=multiFixture(),r=A.backtestMulti(original,config,{},range);
 const altered=original.map(b=>{
  const n=Number(b.contract.slice(4)),gap=n*10000;
  return {...b,open:b.open+gap,high:b.high+gap,low:b.low+gap,close:b.close+gap,volume:b.volume*(n+1)};
 });
 const other=A.backtestMulti(altered,config,{},range);
 assert.deepEqual(other.trades.map(t=>[t.contract,t.entryDate,t.exitDate,t.gross,t.net]),
 r.trades.map(t=>[t.contract,t.entryDate,t.exitDate,t.gross,t.net]));
 assert.equal(other.maxDrawdown,r.maxDrawdown);
 assert.equal(r.validBars,r.totalBars,'historical warmup should carry across the requested boundary');
});

test('search returns distinct trade calendars, respects minimum samples and direct backtests',()=>{
 const rows=multiFixture();let output;
 for(const step of A.optimizeMulti(rows,config,{},range,5))output=step;
 assert.equal(output.total,A.candidateGridMulti(config).length);
 assert(output.total>2025,'extended grid should search beyond the old fixed 2025 cap');
 assert.equal(output.top.length,5);
 const ids=output.top.map(({result})=>result.trades.map(t=>[t.contract,t.entryDate,t.exitDate].join(':')).join('|'));
 assert.equal(new Set(ids).size,ids.length,'top five may not repeat identical entry/exit dates');
 for(const {config:p,result}of output.top){
  assert(result.trades.length>=5);
  assert.deepEqual(result,A.backtestMulti(rows,p,{},range));
 }
 let none;for(const progress of A.optimizeMulti(rows,config,{},range,20))none=progress;
 assert.equal(none.top.length,0);
 assert(none.maxTrades<20);
});

test('later bars do not change earlier backtest results or future-normalized volumes',()=>{
 const rows=multiFixture(),end='2026-02-28';
 const a=A.backtestMulti(rows,config,{}, {start:range.start,end});
 const b=A.backtestMulti(rows.filter(x=>x.date<=end),config,{}, {start:range.start,end});
 assert.deepEqual(a,b);
});
