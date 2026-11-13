/** C26 5-year satellite strategy PROXY using independently fetched private FinMind
 * OHLC and the immutable original C26 NAV archive. Not an original C26 Python
 * simulation and NOT a trade signal. 2026 stock-futures universe = survivor bias.
 * Signal is computed only from trading day t-lag CLOSE, trades at t OPEN.
 * The 5/10% sleeve is funded separately; frozen C26 state is never modified.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const PATH='.c26-private/rs-history/';
const REF='research/c26-lock/forward/archive-feature-reference.json';
const A='public/r1494a/c26/data/';
const universe=JSON.parse(fs.readFileSync(REF,'utf8')), codes=universe.codes;
if(codes.length!==233||new Set(codes).size!==233)throw Error('C26 frozen pool mismatch');
const idx=new Map(codes.map((x,i)=>[x,i]));
const archived=JSON.parse(fs.readFileSync(A+'historical-assets.json','utf8'));
const navMeta=archived.parts.nav;
const buf=Buffer.from(navMeta.base64_parts.map(x=>fs.readFileSync(A+x,'utf8').trim()).join(''),'base64');
if(crypto.createHash('sha256').update(buf).digest('hex')!==navMeta.sha256_gzip)throw Error('Historical C26 NAV checksum mismatch');
const csv=gunzipSync(buf).toString('utf8').trim().split(/\r?\n/),heads=csv.shift().split(',');
const navDate=heads.indexOf('date'),navValue=heads.indexOf('nav'),navExposure=heads.indexOf('exposure');
const frozen=csv.map(l=>{const r=l.split(',');return {date:r[navDate],nav:+r[navValue],exposure:+r[navExposure]}});
if(frozen.length!==1407||frozen[0].date!=='2021-01-06'||frozen.at(-1).date!=='2026-10-27'||frozen.some(x=>!(x.nav>0)))throw Error('C26 historical NAV invalid');
const first='2021-01',last='2026-10';
const months=[];for(let m=first;m<=last;){months.push(m);const [y,n]=m.split('-').map(Number);m=n===12?(y+1)+'-01':y+'-'+String(n+1).padStart(2,'0')}
const quotations=new Map();
for(const month of months){
 const filename=PATH+month+'.json.gz';
 if(!fs.existsSync(filename))throw Error('Private historical month unavailable '+month);
 const rows=JSON.parse(gunzipSync(fs.readFileSync(filename)));
 if(!rows.length)throw Error('Empty C26 research month '+month);
 for(const q of rows){
  if(!idx.has(q.code)||!q.date.startsWith(month))throw Error('Unrecognized research record');
  const key=q.date;
  if(!quotations.has(key))quotations.set(key,new Map());
  if(quotations.get(key).has(q.code))throw Error('Duplicate research record '+q.code+' '+key);
  quotations.get(key).set(q.code,q);
 }
}
const days=frozen.map(x=>x.date),N=days.length,M=codes.length;
const closes=Array.from({length:M},()=>new Float64Array(N)),opens=Array.from({length:M},()=>new Float64Array(N)),
  tradable=Array.from({length:M},()=>new Uint8Array(N));
let missingDays=0,corpShocks=0,closeDislocations=0;
for(let t=0;t<N;t++){
 const map=quotations.get(days[t])||new Map();
 if(map.size<165)missingDays++;
 for(let j=0;j<M;j++){
  const row=map.get(codes[j]),prev=t>0?closes[j][t-1]:0;
  const valid=row?.valid===true&&row.v>0&&row.o>0&&row.c>0;
  const extreme=valid&&prev>0&&(row.c/prev>1.35||row.c/prev<.65);
  if(extreme)corpShocks++;
  closes[j][t]=valid&&!extreme?row.c:prev;
  opens[j][t]=valid&&!extreme?row.o:0;
  tradable[j][t]=valid&&!extreme?1:0;
  if(extreme&&prev>0)closeDislocations++;
 }
}
if(missingDays>0)throw Error('FinMind full-market monthly coverage incomplete on '+missingDays+' C26 trading dates');
const median=(v)=>{if(!v.length)return 0;v.sort((a,b)=>a-b);const m=v.length>>1;return v.length%2?v[m]:(v[m-1]+v[m])/2};
const market=new Float64Array(N);market[0]=1;
for(let t=1;t<N;t++){
 const rets=[];for(let j=0;j<M;j++){
  const p=closes[j][t-1],c=closes[j][t];
  if(tradable[j][t]&&p>0&&Math.abs(c/p-1)<.3)rets.push(c/p-1);
 }
 market[t]=market[t-1]*(1+median(rets));
}
const ret=(arr,t,n)=>t>=n&&arr[t-n]>0&&arr[t]>0?arr[t]/arr[t-n]-1:NaN;
const feature=(j,s)=>{
 const p=closes[j],last=p[s];if(s<25||!(last>0)||!tradable[j][s])return null;
 const r5=ret(p,s,5),r20=ret(p,s,20),m5=ret(market,s,5),m20=ret(market,s,20);
 if(![r5,r20,m5,m20].every(Number.isFinite))return null;
 const window=p.slice(s-19,s+1);
 if([...window].some(x=>!(x>0)))return null;
 const high=Math.max(...window),mean=[...window].reduce((a,b)=>a+b,0)/20;
 return {j,code:codes[j],price:last,rs5:r5-m5,rs20:r20-m20,near20:last/high,above20:last/mean-1};
};
const rules={
 momentum:f=>f.rs20>=.06&&f.rs5>=.015&&f.near20>=.99&&f.above20>=0,
 reversal:f=>f.rs20>=-.05&&f.rs20<=.08&&f.rs5>=.025&&f.near20>=.80&&f.above20>=-.08,
 relay:f=>f.rs20>=.08&&f.rs5>=.04&&f.near20>=.92&&f.above20>=.02
};
const score={
 momentum:f=>f.rs20+.6*f.rs5,
 reversal:f=>f.rs5-.25*f.rs20,
 relay:f=>f.rs5+.35*f.rs20
};
const COST_BUY=.0014275,COST_SELL=.0044275;
const startIndex=26,baseStart=frozen[startIndex-1].nav;
const scenarioConfigs=Object.keys(rules).flatMap(family=>[.05,.1].flatMap(sleeve=>[.3,.8].flatMap(gate=>[1,2].map(lag=>({family,sleeve,gate,lag})))));
function calcDD(vals){let peak=vals[0],mdd=0;for(const v of vals){peak=Math.max(v,peak);mdd=Math.min(mdd,v/peak-1)}return mdd*100}
function metrics(navArray,from,to){
 const a=days.findIndex(d=>d>=from),b=days.findLastIndex(d=>d<=to);
 if(a<startIndex||b<=a)return null;
 let peak=navArray[a],worst=0;
 for(let t=a;t<=b;t++){peak=Math.max(peak,navArray[t]);worst=Math.min(worst,navArray[t]/peak-1)}
 return {from:days[a],through:days[b],return_pct:100*(navArray[b]/navArray[a]-1),max_dd_pct:worst*100};
}
function simulate(config){
 let cash=1,position=-1,shares=0,daysHeld=0,peakEntry=0,feePaid=0,buys=0,sells=0,
  excessGapSkip=0,haltedDuringHold=0;
 const sat=new Float64Array(N);sat.fill(1);
 for(let t=startIndex;t<N;t++){
  const s=t-config.lag;
  const p=position>=0?closes[position][t]:NaN,prevClose=position>=0?closes[position][s]:NaN;
  const targetSignal=frozen[s].exposure<config.gate;
  const own=position>=0?feature(position,s):null;
  const exit=position>=0&&(!targetSignal||!own||own.rs5<-.01||own.above20<-.10||
   (prevClose>0&&peakEntry>0&&prevClose/peakEntry-1<=-.08)||daysHeld>=15);
  if(position>=0){
   if(!tradable[position][t])haltedDuringHold++;
   if(exit&&tradable[position][t]){
    cash+=shares*opens[position][t]*(1-COST_SELL);
    feePaid+=shares*opens[position][t]*COST_SELL;
    position=-1;shares=0;daysHeld=0;peakEntry=0;sells++;
   }
  }
  // No data from execution date t can influence the list of candidates or their rank.
  if(position<0&&targetSignal){
   const valid=[];
   for(let j=0;j<M;j++){const f=feature(j,s);if(f&&rules[config.family](f))valid.push(f)}
   valid.sort((a,b)=>score[config.family](b)-score[config.family](a) || a.code.localeCompare(b.code));
   for(const candidate of valid){
    const j=candidate.j;
    if(!tradable[j][t])continue;
    const open=opens[j][t];
    // Precommitted avoid-chase: gap > +5% skips. No assumption of intraday pullback.
    if(open/candidate.price>1.05){excessGapSkip++;continue}
    const spend=cash;
    if(spend<=0)break;
    shares=spend/((1+COST_BUY)*open);
    feePaid+=spend*COST_BUY/(1+COST_BUY);
    cash=0;position=j;daysHeld=0;peakEntry=candidate.price;
    buys++;break;
   }
  }
  if(position>=0){daysHeld++;peakEntry=Math.max(peakEntry,closes[position][t]);}
  const value=cash+(position>=0?shares*closes[position][t]:0);
  if(!(value>0)||!Number.isFinite(value))throw Error('Invalid portfolio accounting '+config.family+' '+days[t]);
  sat[t]=value;
 }
 const combined=Array.from({length:N},(_,t)=>(1-config.sleeve)*(frozen[t].nav/baseStart)+config.sleeve*sat[t]);
 const base=Array.from({length:N},(_,t)=>frozen[t].nav/baseStart);
 const years={};
 for(let year=2021;year<=2026;year++){
  const y=String(year);years[y]={baseline:metrics(base,y+'-01-01',y+'-12-31'),
   combined:metrics(combined,y+'-01-01',y+'-12-31')};
 }
 const before=metrics(combined,'2021-02-01','2024-12-31'),after=metrics(combined,'2025-01-01','2026-10-27'),
  afterBase=metrics(base,'2025-01-01','2026-10-27');
 return {...config,return_pct:100*(combined.at(-1)/combined[startIndex-1]-1),
  max_dd_pct:calcDD(combined.slice(startIndex-1)),
  baseline_return_pct:100*(base.at(-1)/base[startIndex-1]-1),
  baseline_max_dd_pct:calcDD(base.slice(startIndex-1)),
  holdout:after,holdout_base:afterBase,train:before,
  orders:{buys,sells,open_positions:position>=0?1:0,fees_paid_sleeve_fraction:feePaid,
    skipped_gaps:excessGapSkip,halted_held_sessions:haltedDuringHold},
  annual:years};
}
const results=scenarioConfigs.map(simulate);
const pairs=new Map();
for(const r of results){
 const key=[r.family,r.sleeve,r.gate].join('/');
 if(!pairs.has(key))pairs.set(key,[]);
 pairs.get(key).push(r);
}
const robustness=[...pairs].map(([key,rs])=>({
 key,pair:rs.map(r=>({lag:r.lag,total_pnl_pp:r.return_pct-r.baseline_return_pct,
  max_dd_improve_pp:r.max_dd_pct-r.baseline_max_dd_pct,
  holdout_pnl_pp:r.holdout&&r.holdout_base?r.holdout.return_pct-r.holdout_base.return_pct:null})),
 both_lags_win:rs.every(r=>r.return_pct>r.baseline_return_pct),
 both_lags_mdd_better:rs.every(r=>r.max_dd_pct>r.baseline_max_dd_pct),
 both_lags_holdout_win:rs.every(r=>r.holdout&&r.holdout_base&&r.holdout.return_pct>r.holdout_base.return_pct)
}));
const report={
 lock_id:universe.lock_id,source:'FinMind private OHLC + SHA-checked C26 frozen NAV',
 warning:'INDEPENDENT PAPER PROXY ONLY. Not full C26 Python execution nor broker advice; fractional shares, survivor-biased 2026 future-stock universe, raw unadjusted corporate actions can distort results.',
 data_quality:{monthly_files:months.length,stock_count:M,backtest_days:N,missing_session_days:missingDays,
  detected_large_unadjusted_price_events:corpShocks,suspended_marks_not_executable:true,
  method:'Carry last close for valuation only; exclude abnormal >35% changes as unknown corporate action; never simulate fill on missing quote.'},
 execution:'Signal from s=t-lag close; buy/sell at t open, skip >5% gap buys, buy 0.14275%, sell 0.44275%',
 starting_after_warmup:days[startIndex-1],end_date:days.at(-1),configs:results.length,
 baseline_same_window:{return_pct:results[0].baseline_return_pct,max_dd_pct:results[0].baseline_max_dd_pct},
 results,robustness,
 pass_criteria:{c26_historical_engine_changed:false,post_archive_11_16_model_not_verified:true,
  user_total_roundtrip_cost_pct:.5855,not_four_stock_whitelist:true,output_raw_prices:false},
 research_generated_at:new Date().toISOString()
};
fs.mkdirSync('research/c26-lock/experiments',{recursive:true});
const out='research/c26-lock/experiments/RS_FIVEYEAR_PROXY_RESULTS.json';
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log('C26_FIVEYEAR_RESEARCH_SUMMARY',JSON.stringify({
 period:[report.starting_after_warmup,report.end_date],raw_events:corpShocks,
 scenarios:results.length,baseline:report.baseline_same_window,
 both_lags_win:robustness.filter(x=>x.both_lags_win).length,
 both_lags_holdout_win:robustness.filter(x=>x.both_lags_holdout_win).length,
 both_lags_mdd_better:robustness.filter(x=>x.both_lags_mdd_better).length
}));
