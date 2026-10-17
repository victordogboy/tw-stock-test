const test=require('node:test'),assert=require('node:assert/strict');
const SAR=require('../public/parabolic-sar.js');
const A=require('../public/taiex-action.js');

function waves(){
 return Array.from({length:240},(_,i)=>{
  const close=20000+Math.sin(i/8)*200+i;
  return {date:new Date(Date.UTC(2025,0,i+1)).toISOString().slice(0,10),contract:'202612',
   open:close-10,close,high:close+25,low:close-25,volume:10000+Math.round(300*Math.cos(i/8))};
 });
}
const permissive={direction:'long',sarMode:'anticipate',preFlipGap:0.75,preFlipMin:65,delta:0,minEntry:0,exit:0,maxAge:0,cost:1};
test('SAR next-session reversal threshold is known at session close; future bars never rewrite it',()=>{
 const rows=waves();
 const a=SAR.calculate(rows.slice(0,191)),b=SAR.calculate(rows);
 assert.deepEqual(b.slice(0,191),a);
 assert(Number.isFinite(a[189].nextTrigger));
 assert.equal(a[189].rising,false);
 assert.equal(a[190].reversal,true);
 assert.equal(a[190].rising,true);
});
test('pre-flip mode detects a signal before actual SAR reversal without using future prices',()=>{
 const rows=waves(),scores=A.analyze(rows,permissive),i=189;
 assert.equal(scores[i].aligned,false);
 assert.equal(scores[i].enter,true);
 assert(scores[i].evidence.k>scores[i].evidence.dh);
 assert(scores[i].evidence.gap<=permissive.preFlipGap);
 assert.deepEqual(A.analyze(rows.slice(0,i+1),permissive).at(-1),scores[i]);
 assert.equal(A.analyze(rows,{...permissive,sarMode:'aligned'})[i].enter,false);
 assert.equal(A.analyze(rows,{...permissive,sarMode:'both'})[i].enter,true);
 assert.equal(A.analyze(rows,{...permissive,preFlipMin:100})[i].enter,false);
 assert.equal(A.analyze(rows,{...permissive,preFlipGap:0.05,preFlipMin:100})[i].enter,false);
});
test('SAR pre-flip mode and extra parameter validation rejects out-of-range values',()=>{
 for(const v of [{sarMode:'future'},{preFlipGap:4},{preFlipGap:0},{preFlipMin:101}])assert.throws(()=>A.validate(v));
});
test('optimizer candidates cover SAR confirmed, anticipated and mixed without lookahead',()=>{
 const grid=A.candidateGridMulti(permissive);
 assert(grid.length>4800);
 assert(grid.some(x=>x.sarMode==='anticipate'));
 assert(grid.some(x=>x.sarMode==='aligned'));
 assert(grid.some(x=>x.sarMode==='both'));
 const prices=waves(),out=A.backtest(prices,permissive);
 assert(out.trades.every(t=>t.entryDate>t.signalDate));
});
test('five-year multi-month signal history can be backtested without repeated monthly MA60 warmup',()=>{
 const rows=[];let prevContract=null;
 for(let i=0;i<1830;i++){
  const date=new Date(Date.UTC(2021,9,1+i)).toISOString().slice(0,10),contract=A.nextMonth(date),close=18000+i*3+Math.sin(i/8)*300;
  const b={date,contract,open:close-8,close,high:close+30,low:close-30,volume:10000+i,openInterest:5000};
  rows.push(b);
  if(prevContract&&prevContract!==contract)rows.push({...b,contract:prevContract});
  prevContract=contract;
 }
 const r=A.backtestMulti(rows,{...permissive,sarMode:'both'},{},{start:rows[80].date,end:rows.at(-1).date});
 assert(r.totalBars>1700);
 assert(r.months.length>=55);
 assert.equal(r.validBars,r.totalBars);
 assert(r.preFlipCheck.evaluated>=r.preFlipCheck.within2);
 if(r.preFlipCheck.evaluated)assert.equal(r.preFlipCheck.percent,r.preFlipCheck.within2/r.preFlipCheck.evaluated*100);
});
test('browser splits five-year data requests and displays 5-year K-line option',async()=>{
 const {page}=require('./helpers/detail-page.cjs'),p=page('futures.html');
 await new Promise(resolve=>setImmediate(resolve));
 const rows=[],from=Date.UTC(2021,8,1);
 for(let i=0;i<1830;i+=8){
  const date=new Date(from+i*86400000).toISOString().slice(0,10),contract=A.nextMonth(date);
  const c=18000+i*3;
  rows.push({date,contract_date:contract,futures_id:'TX',trading_session:'position',open:c,close:c+5,max:c+30,min:c-30,volume:10000,open_interest:5000});
 }
 let calls=0;
 p.ctx.fetch=async url=>{
  calls++;const u=new URL(url,'https://test.local'),start=u.searchParams.get('start_date'),end=u.searchParams.get('end_date');
  return new Response(JSON.stringify({ok:true,data:rows.filter(r=>r.date>=start&&r.date<=end),source:'fixture',cache_hit:false}));
 };
 const fire=(id,event='click')=>p.events.find(x=>x[0]===id&&x[1]===event)[2]();
 p.nodes.get('txYears').value='5';p.nodes.get('txSession').value='position';
 await fire('txLoad');
 assert(calls>=4,'five-year history should use bounded request chunks');
 assert.match(p.nodes.get('txStatus').textContent,/共 [45] 段/);
 p.nodes.get('txChartBars').value='1250';fire('txChartBars','change');
 assert.equal(JSON.parse(p.storage.get('twq_taiex_view_r36')).chartBars,'1250');
 fire('actAllDates');
 assert(p.nodes.get('actStart').value<'2023-01-01');
});
