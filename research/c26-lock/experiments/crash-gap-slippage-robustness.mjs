/* C26 crash reversal research, 2021-01-06 .. 2026-10-27.
 * Reads ONLY private FinMind stock OHLC under .c26-private/rs-history;
 * no raw data, credentials, exact trade dates or ticker order lists are published.
 * Original C26 frozen model remains unchanged. No broker trades.
 * This study was motivated by a KNOWN 2026-11-06 event and is not a pristine
 * independent hypothesis test. Nov06 itself is outside the training period.
 */
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
const REFDIR='research/c26-lock/forward/archive-feature-reference.json';
const ref=JSON.parse(fs.readFileSync(REFDIR,'utf8'));
const codes=ref.codes;
if(ref.lock_id!=='C26-EVENT-CORR-LOCK-20261112'||codes.length!==233)throw Error('C26 233-stock lock changed');
const q=new Map();
const nextMonth=(m)=>{const [y,v]=m.split('-').map(Number);return v===12?(y+1)+'-01':y+'-'+String(v+1).padStart(2,'0')};
let months=0,rowsSeen=0,invalid=0;
for(let m='2021-01';m<='2026-10';m=nextMonth(m)){
 const file='.c26-private/rs-history/'+m+'.json.gz';
 if(!fs.existsSync(file))throw Error('Missing private OHLC month '+m);
 const rows=JSON.parse(gunzipSync(fs.readFileSync(file)));months++;
 for(const v of rows){
  if(!codes.includes(v.code)||!v.date.startsWith(m))throw Error('Source universe/date mismatch');
  if(!q.has(v.date))q.set(v.date,new Map());
  if(q.get(v.date).has(v.code))throw Error('Duplicate price '+v.code+' '+v.date);
  if(!v.valid)invalid++;
  q.get(v.date).set(v.code,v);
  rowsSeen++;
 }
}
if(months!==70)throw Error('Historical months incomplete');
const hist=JSON.parse(fs.readFileSync('public/r1494a/c26/data/historical-assets.json','utf8')).parts.nav;
const zipped=Buffer.from(hist.base64_parts.map(p=>fs.readFileSync('public/r1494a/c26/data/'+p,'utf8').trim()).join(''),'base64');
const dates=gunzipSync(zipped).toString('utf8').trim().split(/\r?\n/).slice(1).map(l=>l.slice(0,10));
if(dates.length!==1407||dates[0]!=='2021-01-06'||dates.at(-1)!=='2026-10-27')throw Error('C26 day alignment mismatch');
const N=dates.length, M=codes.length;
const by=Array.from({length:M},(_,j)=>dates.map(date=>q.get(date)?.get(codes[j])||null));
let missingSessions=0;for(const date of dates){if(!q.has(date)||q.get(date).size<165)missingSessions++}
if(missingSessions)throw Error('History contains '+missingSessions+' incomplete exchange sessions');
const tick=p=>p<10?.01:p<50?.05:p<100?.1:p<500?.5:p<1000?1:5;
const tickUp=p=>Math.ceil(p/tick(p)-1e-9)*tick(p);
const valid=r=>r?.valid===true&&r.o>0&&r.h>=r.l&&r.l>0&&r.c>0&&r.v>0;
const buyFee=.0014275,sellFee=.0044275;
const ret=(entry,exit)=>exit*(1-sellFee)/(entry*(1+buyFee))-1;
const mean=arr=>arr.reduce((a,b)=>a+b,0)/(arr.length||1);
const median=arr=>{if(!arr.length)return NaN;arr.sort((a,b)=>a-b);return arr.length%2?arr[(arr.length-1)>>1]:(arr[arr.length/2-1]+arr[arr.length/2])/2};
const chg=new Float64Array(N*M),candleHigh=new Float64Array(N*M),closeLow=new Float64Array(N*M),emaDev=new Float64Array(N*M),volRatio=new Float64Array(N*M);
let anomalies=0,nonusable=0;
for(let j=0;j<M;j++){
 let ema=0,seen=0;
 for(let t=0;t<N;t++){
  const i=j*N+t,r=by[j][t],prev=t?by[j][t-1]:null;
  if(!valid(r)){nonusable++;chg[i]=NaN;candleHigh[i]=NaN;closeLow[i]=NaN;emaDev[i]=NaN;volRatio[i]=NaN;continue}
  const c=r.c,prevC=valid(prev)?prev.c:NaN;
  const change=prevC>0?c/prevC-1:NaN;
  if(Number.isFinite(change)&&Math.abs(change)>.35){anomalies++;chg[i]=NaN}
  else chg[i]=change;
  const vols=by[j].slice(Math.max(0,t-20),t).filter(valid).map(x=>x.v);
  volRatio[i]=vols.length>=15?r.v/mean(vols):NaN;
  seen++;ema=seen===1?c:(c*(2/21)+ema*(19/21));
  emaDev[i]=seen>=20?c/ema-1:NaN;
  candleHigh[i]=r.h;
  closeLow[i]=c/r.l-1;
 }
}
function candidates(d,fall,vol,rank,body=false,closeLoc=.55){
 const all=[];
 for(let j=0;j<M;j++){
  const r=by[j][d],prev=by[j][d-1],prior=by[j][d-2];
  if(!valid(r)||!valid(prev)||!valid(prior))continue;
  const s=j*N+d,sp=j*N+d-1;
  if(body){
   if(!(chg[sp]<=-fall)||!Number.isFinite(volRatio[s])||volRatio[s]<vol)continue;
   if(!(r.c/r.o-1>=.05)||!(r.h>r.l)||!((r.c-r.l)/(r.h-r.l)>=closeLoc))continue;
   if(!(r.c>1)||r.v*r.c<2e7)continue;
   all.push({j,code:codes[j],vRatio:volRatio[s],body:r.c/r.o-1,prevClose:prev.c});
  }else{
   if(!(chg[s]<=-fall)||!(closeLow[s]<=.005)||!(emaDev[s]<=-.04)||
     !Number.isFinite(volRatio[s])||volRatio[s]<vol)continue;
   if(!(r.c>1)||r.v*r.c<2e7)continue;
   all.push({j,code:codes[j],vRatio:volRatio[s],body:chg[s],prevClose:r.c});
  }
 }
 if(rank==='volume')all.sort((a,b)=>b.vRatio-a.vRatio||a.code.localeCompare(b.code));
 if(rank==='body')all.sort((a,b)=>b.body-a.body||a.code.localeCompare(b.code));
 return all;
}

/** Preset sensitivity grid, NOT optimized from the known 11/06 case.
 * No 2026-11-06 observations are in the study period, but the hypothesis itself
 * was inspired by that event: this is still not independent discovery.
 */
const configs=[];
for(const fall of [.08,.095])
 for(const vol of [.8,1.2])
  for(const trigger_discount of [.02,.04,.06])
   for(const minimum_open_gap of [.03,.05,.07])
    for(const cap of [1,3,8])
     for(const execution_slippage_each_side of [0,.005])
      configs.push({fall,vol,trigger_discount,minimum_open_gap,cap,execution_slippage_each_side});
if(configs.length!==216)throw Error('expected 216 variants');
function periodReturn(yearly,first,last){
 let compounded=1;
 for(let y=first;y<=last;y++)compounded*=1+(yearly[String(y)]?.return_pct||0)/100;
 return 100*(compounded-1);
}
function test(c){
 const dayReturns=[],trades=[],yearly={};
 let signalDays=0,crossings=0,missingEntry=0,missingExit=0,exceedsObservedHigh=0,lowestWithinTrade=null;
 for(let year=2021;year<=2026;year++)yearly[String(year)]={event_days:0,trades:0,return_pct:0};
 const bookedByYear=new Map();
 for(let d=22;d<N-2;d++){
  const selected=candidates(d,c.fall,c.vol,'volume').slice(0,c.cap);
  if(!selected.length)continue;
  signalDays++;
  const entryIdx=d+1,exitIdx=d+2,dayR=dates[entryIdx];
  let sum=0,nTrade=0;
  for(const {j,code,prevClose} of selected){
   const today=by[j][entryIdx],later=by[j][exitIdx];
   if(!valid(today)){missingEntry++;continue}
   const stop=tickUp(prevClose*(1-c.trigger_discount));
   if(today.o/prevClose>1-c.minimum_open_gap||!(today.o<stop&&today.h>=stop))continue;
   // STOP touch is a daily OHLC crossing, not a confirmed broker fill.
   crossings++;
   const enter=stop*(1+c.execution_slippage_each_side);
   if(enter>today.h)exceedsObservedHigh++;
   let realized;
   if(!valid(later)||(!Number.isFinite(chg[j*N+exitIdx])&&Math.abs(later.o/today.c-1)>.35)){
    missingExit++;
    // Conservative reserved-slot stress for unavailable exit, not a fabricated trade.
    realized=-.20;
   }else{
    const exit=later.o*(1-c.execution_slippage_each_side);
    realized=ret(enter,exit);
    if(!Number.isFinite(realized)||Math.abs(realized)>1){realized=-.20;missingExit++;}
   }
   trades.push({year:dayR.slice(0,4),net:realized});
   sum+=realized;nTrade++;
   if(valid(today)){
    const adverse=today.l/enter-1; // day-low may PRECEDE stop; conservative bound, not observed after entry.
    lowestWithinTrade=lowestWithinTrade===null?adverse:Math.min(lowestWithinTrade,adverse);
   }
  }
  const r=sum/c.cap;
  dayReturns.push({date:dayR,return:r});
  const key=dayR.slice(0,4);
  if(!bookedByYear.has(key))bookedByYear.set(key,[]);
  bookedByYear.get(key).push(r);
  if(nTrade)yearly[key].event_days++;
  yearly[key].trades+=nTrade;
 }
 let cash=1,peak=1,closedDD=0;
 for(const d of dayReturns){
  cash*=1+d.return;peak=Math.max(peak,cash);closedDD=Math.min(closedDD,cash/peak-1);
 }
 for(const [year,values] of bookedByYear){
  yearly[year].return_pct=100*(values.reduce((v,x)=>v*(1+x),1)-1);
 }
 const nums=trades.map(x=>x.net);
 const train=periodReturn(yearly,2021,2024),holdout=periodReturn(yearly,2025,2026);
 return {...c,
  historical_signals:signalDays,
  hypothetical_entry_crosses:crossings,
  hypothetical_trades:trades.length,
  modeled_profitable:nums.filter(x=>x>0).length,
  win_rate_pct:nums.length?100*nums.filter(x=>x>0).length/nums.length:null,
  avg_net_trade_pct:nums.length?100*nums.reduce((a,b)=>a+b,0)/nums.length:null,
  closed_equity_book_pct:100*(cash-1),
  closed_equity_max_dd_pct:100*closedDD,
  return_2021_2024_pct:train,
  return_2025_2026_pct:holdout,
  both_periods_positive:train>0&&holdout>0,
  missing_entry_days:missingEntry,
  forced_stress_exits:missingExit,
  conservative_daylow_relative_entry_pct:lowestWithinTrade===null?null:100*lowestWithinTrade,
  modeled_entry_above_same_day_high:exceedsObservedHigh,
  years:yearly
 };
}
const results=configs.map(test);
// Post-scan local sensitivity check motivated by the 4%-discount winner:
// NOT a pre-registered independent test. Keep separate from the original 216.
const trigger_neighborhood=[];
for(const fall of [.08,.095])
 for(const vol of [.8,1.2])
  for(const trigger_discount of [.03,.035,.04,.045,.05])
   for(const minimum_open_gap of [.03,.05])
    for(const cap of [3,8])
     trigger_neighborhood.push(test({
      fall,vol,trigger_discount,minimum_open_gap,cap,
      execution_slippage_each_side:.005
     }));
if(trigger_neighborhood.length!==80)throw Error('80-case trigger local neighborhood missing');

const matched=[];
for(const d of [0,.005]){
 const defaultStudy=results.find(x=>x.fall===.095&&x.vol===1.2&&x.trigger_discount===.06&&x.minimum_open_gap===.07&&x.cap===8&&x.execution_slippage_each_side===d);
 if(!defaultStudy)throw Error('default missing');
 matched.push(defaultStudy);
}
const pairs=new Map();
for(const x of results){
 const key=[x.fall,x.vol,x.trigger_discount,x.minimum_open_gap,x.cap].join('|');
 if(!pairs.has(key))pairs.set(key,[]);
 pairs.get(key).push(x);
}
const robust=[...pairs].map(([key,values])=>({
 key,n:values.length,trade_count:values[0].hypothetical_trades,
 all_slippage_profit:values.every(x=>x.closed_equity_book_pct>0),
 all_slippage_both_period_profit:values.every(x=>x.both_periods_positive),
 worst_case_full_pct:Math.min(...values.map(x=>x.closed_equity_book_pct)),
 worst_2021_24_pct:Math.min(...values.map(x=>x.return_2021_2024_pct)),
 worst_2025_26_pct:Math.min(...values.map(x=>x.return_2025_2026_pct))
}));
const eligible=robust.filter(x=>x.trade_count>=20);
const report={
 research_only:true,strictly_not_original_c26:true,source:'70 private FinMind OHLC monthly files',
 range:[dates[0],dates.at(-1)],frozen_pool_count:233,
 quality:{month_count:months,rows:rowsSeen,invalid,anomalies,missing_sessions:missingSessions},
 scenario_count:configs.length,
 local_neighborhood_cases:trigger_neighborhood.length,
 local_neighborhood_is_post_selected:true,
 selection_rule:'All 233 stocks, prior close shock -8%/-9.5%, close within 0.5% of low, 4% below EMA20, 20-day volume ratio; rank from prior bar only.',
 execution_rule:'Precommitted buy-stop prior close discounted 2/4/6%; next-open gap 3/5/7%, intraday high only as trigger; follow-day open exit.',
 cost_pct:100*(buyFee+sellFee),
 trade_inference:'Daily high cross, not confirmed tick or executed broker order; slippage is hypothetical.',
 grossly_conservative_unverified_exit_stress:-.20,
 closed_book_warning:'Returns and drawdown calculated only on booked event outcomes; NO mark-to-market C26 account risk; concurrent orders and transaction costs not full C26 replay.',
 limitations:'Fixed 2026 futures universe backward to 2021, company actions not fully adjusted, nonindependent hypothesis inspired by 2026 Nov 06, no same-account original C26 cash replay.',
 examples:matched,
 local_trigger_neighborhood:trigger_neighborhood,
 local_neighborhood_summary:{
  variants:trigger_neighborhood.length,
  both_periods_positive:trigger_neighborhood.filter(x=>x.both_periods_positive).length,
  trades20_and_both_periods_positive:trigger_neighborhood.filter(x=>x.hypothetical_trades>=20&&x.both_periods_positive).length,
  a2_adjacent:trigger_neighborhood.filter(x=>x.fall===.08&&x.vol===1.2&&x.minimum_open_gap===.03&&x.cap===3)
    .map(x=>({trigger_discount:x.trigger_discount,trades:x.hypothetical_trades,
       book:x.closed_equity_book_pct,train:x.return_2021_2024_pct,holdout:x.return_2025_2026_pct,
       max_dd_closed:x.closed_equity_max_dd_pct,synthetic_price_above_day_high:x.modeled_entry_above_same_day_high}))
 },
 counts:{
  positive:results.filter(x=>x.closed_equity_book_pct>0).length,
  each_period_positive:results.filter(x=>x.both_periods_positive).length,
  trade20plus:results.filter(x=>x.hypothetical_trades>=20).length,
  trade20plus_each_period_positive:results.filter(x=>x.hypothetical_trades>=20&&x.both_periods_positive).length,
  nonzero_slippage_20plus_both_period_positive:results.filter(x=>x.hypothetical_trades>=20&&x.both_periods_positive&&x.execution_slippage_each_side===.005).length,
  robustness_group_total:robust.length,
  robust20plus_both_slippage_and_both_periods:eligible.filter(x=>x.all_slippage_both_period_profit).length
 },robust_by_groups:robust,all_results:results
};
const path='research/c26-lock/experiments/CRASH_GAP_SLIPPAGE_2021_2026_RESULTS.json';
fs.writeFileSync(path,JSON.stringify(report,null,2)+'\n');
console.log('C26_CRASH_GAP_SLIPPAGE_VALIDATED',JSON.stringify({range:report.range,scanned:report.scenario_count,
 source_months:months,conditions:report.counts,
 default_ideal:matched[0],default_slip_half_percent_each_side:matched[1]}));
