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
const configs=[];
for(const fall of [.08,.095])for(const vol of [.8,1.2,1.6]){
 for(const trig of [.04,.06])for(const cap of [3,8])
   configs.push({kind:'prior_day_stop',fall,vol,trigger_discount:trig,cap,ranking:'volume'});
 for(const closeLoc of [.55,.65])for(const cap of [3,8])
   configs.push({kind:'close_confirmation',fall,vol,closeLoc,cap,ranking:'body'});
}
if(configs.length!==48)throw Error('Expected 48 scan scenarios');
const results=[];
for(const c of configs){
 const tradePnl=[],incomesByYear=new Map(),eventDaysByYear=new Map(),tradesByYear=new Map();
 let possible=0,haltedEntries=0,nontradableExits=0,triggered=0,candidateDays=0,sourceDays=0;
 const dayReturns=[],eventDates=[];
 for(let d=22;d<N-2;d++){
  const body=c.kind==='close_confirmation';
  const candidate=candidates(d,c.fall,c.vol,c.ranking,body,c.closeLoc);
  if(!candidate.length)continue;
  possible+=candidate.length;candidateDays++;
  const chosen=candidate.slice(0,c.cap),buyIndex=d+1,sellIndex=d+2;
  let sum=0,dayCount=0;
  for(const item of chosen){
   const row=by[item.j][buyIndex],exit=by[item.j][sellIndex];
   if(!valid(row)){haltedEntries++;continue}
   if(!valid(exit)){nontradableExits++;continue}
   let price=row.o;
   if(!body){
    // Precommitted buy-stop fixed at signal CLOSE. 9am gap must be large,
    // then high must cross stop. Intraday OHLC cannot certify timestamps/queue.
    const target=tickUp(item.prevClose*(1-c.trigger_discount));
    if(row.o/item.prevClose> .93 || !(row.o<target&&row.h>=target))continue;
    price=target;
   } else {
    // Signal after fully known close d; execute next OPEN, no future order selection.
    if(row.o<=0)continue;
   }
   if(!Number.isFinite(chg[item.j*N+sellIndex])&&Math.abs(exit.o/row.c-1)>.35){nontradableExits++;continue}
   const net=ret(price,exit.o);
   if(!Number.isFinite(net)||Math.abs(net)>1){nontradableExits++;continue}
   tradePnl.push(net);sum+=net;dayCount++;triggered++;
   const y=dates[buyIndex].slice(0,4);
   tradesByYear.set(y,(tradesByYear.get(y)||0)+1);
   incomesByYear.set(y,(incomesByYear.get(y)||0)+net/c.cap);
  }
  if(dayCount)eventDates.push(dates[buyIndex]);
  const dailyReturn=sum/c.cap;
  dayReturns.push(dailyReturn);
  const y=dates[buyIndex].slice(0,4);eventDaysByYear.set(y,(eventDaysByYear.get(y)||0)+(dayCount>0?1:0));
  sourceDays++;
 }
 // Cash-only book, no C26 integration. Return attributed to a 100% conditional
 // sleeve, with at most 1/cap of NAV per selected symbol for one day.
 const compound=dayReturns.reduce((v,x)=>v*(1+x),1),perYear={};
 for(let y=2021;y<=2026;y++){
  const key=String(y),series=dayReturns; // per-year return more precise via new pass below.
  perYear[key]={event_days:eventDaysByYear.get(key)||0,trades:tradesByYear.get(key)||0,per_day_book_sum_pct:100*(incomesByYear.get(key)||0)};
 }
 const win=tradePnl.filter(x=>x>0).length;
 let peak=1,nav=1,mdd=0;
 for(const r of dayReturns){nav*=1+r;peak=Math.max(peak,nav);mdd=Math.min(mdd,nav/peak-1)}
 results.push({...c,selected_candidate_count:possible,event_days:eventDates.length,filtered_days:candidateDays,
   actual_buy_triggers:triggered,censored_missing_entry:haltedEntries,censored_missing_exit:nontradableExits,
   win_rate_pct:triggered?100*win/triggered:null,
   mean_trade_pct:triggered?100*mean(tradePnl):null,
   median_trade_pct:triggered?100*median([...tradePnl]):null,
   worst_trade_pct:tradePnl.length?100*Math.min(...tradePnl):null,
   best_trade_pct:tradePnl.length?100*Math.max(...tradePnl):null,
   book_100pct_conditional_return_pct:100*(compound-1),
   book_100pct_conditional_max_dd_pct:100*mdd,
   cash_sleeve_10pct_contribution_approx_pp:10*(compound-1),
   yearly:perYear, sourceDays,
   caveat:'Only event sleeve, fixed positions and one-session exit; NOT C26 full portfolio or guaranteed stop fills.'});
}
const groups={};
for(const c of results){
 const key=[c.kind,c.fall,c.vol,c.cap].join('|');
 if(!groups[key])groups[key]=[];
 groups[key].push(c);
}
const stability=Object.entries(groups).map(([key,r])=>({
 key,variants:r.length,
 both_positive:r.every(x=>x.book_100pct_conditional_return_pct>0),
 worst_net_pct:Math.min(...r.map(x=>x.book_100pct_conditional_return_pct)),
 best_net_pct:Math.max(...r.map(x=>x.book_100pct_conditional_return_pct)),
 min_trades:Math.min(...r.map(x=>x.actual_buy_triggers)),
 all_years_event_days:Object.fromEntries(Array.from({length:6},(_,i)=>[String(i+2021),Math.min(...r.map(x=>x.yearly[String(i+2021)].event_days))]))
}));
const report={
 mode:'RESEARCH_ONLY',lock_id:ref.lock_id,source:'2021-2026 private FinMind monthly stock OHLC',
 source_window:[dates[0],dates.at(-1)],universe_size:M,observations:N,
 experimental_variants:configs.length,
 transaction_cost_pct:(buyFee+sellFee)*100,
 selection_limit_at_most:8,
 source_quality:{monthly_files:months,total_licensed_rows:rowsSeen,invalid_rows:invalid,price_jumps_over_35pct:anomalies,missing_exchange_sessions:missingSessions,nontradable_rows:nonusable},
 methodology:{
 no_future_in_screen:true,trigger_on_next_day_high_is_touch_not_certified_fill:true,
 no_same_day_stop_order_assumed:true,exec_exit_second_next_open:true,
 preopen_buy_stop_price_fixed_at_prior_close:true,open_gap_filter_requires_7pct:true,
 factor:'Price vs 20-day EMA, previous close falling 8/9.5%, close near day low, prior 20d volume ratio, <=8 top-ranked symbols',
 eod_confirm:'prior day drop, current green body>=5%, close high in candle, confirm after 13:30, buy next session open',
 survivor_pool_bias:'2026 stock futures research pool applied backward',
 corporate_actions:'price jumps over 35pct excluded but full corporate actions not cleaned',
 money_model:'Independent conditional paper sleeve, NO integration with original C26 cash/holdings; return not directly comparable with frozen C26.',
 event_known_in_advance:false
 },results,stability,
 high_level:{
 configurations_profitable:results.filter(x=>x.book_100pct_conditional_return_pct>0).length,
 configurations_with_10plus_trades:results.filter(x=>x.actual_buy_triggers>=10).length,
 stop_configs_profitable:results.filter(x=>x.kind==='prior_day_stop'&&x.book_100pct_conditional_return_pct>0).length,
 confirmation_configs_profitable:results.filter(x=>x.kind==='close_confirmation'&&x.book_100pct_conditional_return_pct>0).length
 }
};
const path='research/c26-lock/experiments/CRASH_REVERSAL_2021_2026_RESULTS.json';
fs.writeFileSync(path,JSON.stringify(report,null,2)+'\n');
console.log('C26_CRASH_REVERSAL_LONG_HORIZON',JSON.stringify({
 source_window:report.source_window,variants:results.length,quality:report.source_quality,
 highlights:report.high_level,
 preopen_default:results.find(x=>x.kind==='prior_day_stop'&&x.fall===.095&&x.vol===1.2&&x.trigger_discount===.06&&x.cap===8),
 eod_default:results.find(x=>x.kind==='close_confirmation'&&x.fall===.095&&x.vol===1.2&&x.closeLoc===.55&&x.cap===8)
}));
