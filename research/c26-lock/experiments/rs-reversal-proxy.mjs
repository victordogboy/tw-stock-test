/**
 * C26 RS reversal satellite PROXY experiment — NOT the frozen Python strategy, not a live plan.
 * Exact C26 portfolio NAV is a historical index sleeve; selected stocks form a
 * separate 5/10% capital sleeve. Cannot substitute for whole-engine C26 reruns:
 * original position sizing, future cash constraints and market-to-open fills differ.
 *
 * Data: public FC23 historical seed CLOSE buffers (at most last 121 trading days)
 * and frozen C26 NAV archive. At signal d a candidate is seen after d close;
 * order executes at d+1 (or d+2) close, predetermined MOC, without future prices
 * in candidate selection. 0.14275% buy, 0.44275% sell.
 *
 * Never whitelist the four discussed ASIC stocks; log their diagnostics only.
 */
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const root=process.cwd();
const get=path=>fs.readFileSync(root+'/'+path);
const seed=JSON.parse(gunzipSync(Buffer.from(String(get('public/r1494a/fc23/shared-seed.b64')).trim(),'base64')));
const archive=JSON.parse(String(get('public/r1494a/c26/data/historical-assets.json')));
const part=archive.parts.nav;
const zip=Buffer.from(part.base64_parts.map(p=>String(get('public/r1494a/c26/data/'+p)).trim()).join(''),'base64');
if(zip.length!==part.bytes_gzip||createHash('sha256').update(zip).digest('hex')!==part.sha256_gzip)throw Error('C26 NAV checksum mismatch');
const text=gunzipSync(zip).toString('utf8').trim().split(/\r?\n/);
const hdr=text.shift().split(',');
const col=key=>{const i=hdr.indexOf(key);if(i<0)throw Error('missing '+key);return i};
const di=col('date'),ni=col('nav'),ei=col('exposure');
const historic=text.map(line=>{const c=line.split(',');return {date:c[di],nav:Number(c[ni]),exposure:Number(c[ei])}});
if(historic.at(-1).date!=='2026-10-27'||historic.length!==1407)throw Error('historical ledger unexpected');
if(seed.date!==historic.at(-1).date)throw Error('FC23 seed and frozen C26 last close mismatch');
const codes=[...seed.codes],stocks=seed.stocks;
if(codes.length!==233)throw Error('C26 stock count mismatch');
const N=Math.min(121,seed.marketHistory.length,...codes.map(c=>stocks[c]?.c?.length||0));
if(N<70)throw Error('not enough seed history');
const rows=historic.slice(-N),market=seed.marketHistory.slice(-N).map(Number);
if(rows.length!==N||market.some(v=>!(v>0)))throw Error('market/history alignment impossible');
const close=new Map(codes.map(code=>[code,stocks[code].c.slice(-N).map(x=>x==null?NaN:Number(x))]));
const tickerAudit=['3443','3661','3035','2454'];
const price=(code,t)=>close.get(code)?.[t]||NaN;
const ret=(arr,t,lookback)=>arr[t]>0&&arr[t-lookback]>0?arr[t]/arr[t-lookback]-1:NaN;
function feature(code,signal){
 const c=close.get(code),p=c[signal];if(!(p>0)||signal<21)return null;
 const r20=ret(c,signal,20),r5=ret(c,signal,5),mr20=ret(market,signal,20),mr5=ret(market,signal,5);
 const twenty=c.slice(signal-19,signal+1);
 if(!twenty.every(x=>x>0)||![r20,r5,mr20,mr5].every(Number.isFinite))return null;
 const high=Math.max(...twenty),avg=twenty.reduce((a,b)=>a+b,0)/twenty.length;
 return {code,p,rs20:r20-mr20,rs5:r5-mr5,near20:p/high,above20:p/avg-1,score:(r20-mr20)+.6*(r5-mr5)};
}
const configurations=[];
for(const rs5_min of [.025,.04,.06])for(const rs20_floor of [-.15,-.05])for(const gate of [.30,.80])for(const latency of [1,2])
 configurations.push({rs5_min,rs20_floor,gate,latency});
const BUY_COST=.0014275,SELL_COST=.0044275;
const baseStart=21;const baseInit=historic.at(-N+baseStart-1).nav;
const base=rows.slice(baseStart-1).map(x=>x.nav/baseInit);
const baseExposure=rows.map(x=>x.exposure);
function mdd(values){let peak=1,dd=0;for(const x of values){peak=Math.max(peak,x);dd=Math.min(dd,x/peak-1)}return 100*dd}
function sample(config){
 let cash=1,holding=null,units=0,entryValue=0,peak=0,held=0,fees=0,entry=0,exit=0;
 let navSeries=[1],opportunities=0,signals=0,missed=0;const chosen=[];
 const start=baseStart,stage=[];
 for(let t=start;t<N;t++){
  const signal=t-config.latency;
  const validSignal=signal>=20;
  const f=validSignal?codes.map(c=>feature(c,signal)).filter(Boolean):[];
  // Early reversals: no mandatory 20-day breakout, a strong 5-day RS rebound
  // from a formerly weak 20-day trend. No symbols or sectors hard-coded.
  const ranked=f.filter(x=>x.rs20>=config.rs20_floor&&x.rs20<=.08&&x.rs5>=config.rs5_min
    &&x.near20>=.80&&x.above20>=-.08)
    .sort((a,b)=>(b.rs5-b.rs20/4)-(a.rs5-a.rs20/4));
  const eligible=validSignal&&baseExposure[signal]<config.gate;
  if(eligible)opportunities++;
  if(eligible&&ranked.length)signals++;
  const prev=holding?price(holding,t-1):NaN,next=holding?price(holding,t):NaN;
  if(holding){
   held++;
   // A suspended stock has no executable bar. Keep its previous mark, do not forge a fill.
   if(!(next>0))missed++;
   const now=next>0?next:prev;
   peak=Math.max(peak,now||peak);
   const own=validSignal?feature(holding,signal):null;
   const riskOff=!eligible||!own||own.rs5<-.01||own.above20<-.10||(now>0&&now/peak-1<=-.08)||held>=15;
   if(riskOff&&next>0){
    cash+=units*next*(1-SELL_COST);fees+=units*next*SELL_COST;
    exit++;units=0;holding=null;held=0;peak=0;entryValue=0;
   }
  }
  if(!holding&&eligible&&ranked.length){
   const buy=ranked.find(x=>price(x.code,t)>0);
   if(buy && cash>0){
    const px=price(buy.code,t);
    units=cash/(px*(1+BUY_COST));
    fees+=cash*BUY_COST/(1+BUY_COST);
    entryValue=cash;cash=0;holding=buy.code;held=0;peak=px;entry++;
    chosen.push({date:rows[t].date,signal_date:rows[signal].date,code:buy.code,signal_rs20:buy.rs20,signal_near20:buy.near20});
   }
  }
  const mark=holding?(price(holding,t)>0?price(holding,t):price(holding,t-1)):0;
  const total=cash+units*mark;
  if(!(total>0))throw Error('invalid satellite NAV');
  navSeries.push(total);
 }
 const outcomes=[];
 for(const fraction of [.05,.10]){
  const combined=navSeries.map((sv,i)=>(1-fraction)*base[i]+fraction*sv);
  outcomes.push({
   ...config,fraction,days:navSeries.length-1,
   proxy_return_pct:(combined.at(-1)-1)*100,
   proxy_mdd_pct:mdd(combined),
   c26_same_window_return_pct:(base.at(-1)-1)*100,
   c26_same_window_mdd_pct:mdd(base),
   relative_return_pp:(combined.at(-1)-base.at(-1))*100,
   mdd_change_pp:mdd(combined)-mdd(base),
   satellite_return_pct:(navSeries.at(-1)-1)*100,
   buys:entry,sells:exit,signal_days:signals,risk_budget_days:opportunities,unexecutable_days:missed,
   entry_codes:Object.fromEntries([...new Set(chosen.map(x=>x.code))].map(code=>[code,chosen.filter(x=>x.code===code).length]))
  });
 }
 return {outcomes,chosen};
}
const scans=configurations.map(sample),results=scans.flatMap(x=>x.outcomes);
const baseline={window_start:rows[baseStart-1].date,window_end:rows.at(-1).date,
 days:base.length-1,return_pct:(base.at(-1)-1)*100,mdd_pct:mdd(base),
 frozen_all_period_return_pct:1720.495844396837,
 frozen_all_period_mdd_pct:-17.989769234703846};
const stockAudit=tickerAudit.map(code=>{
 const snapshots=[];
 for(let signal=20;signal<N;signal++){
  const x=feature(code,signal);if(!x)continue;
  snapshots.push({date:rows[signal].date,rs20:x.rs20,rs5:x.rs5,near20:x.near20,
    early: x.rs20>=-.15&&x.rs20<=.08&&x.rs5>=.025&&x.near20>=.80&&x.above20>=-.08,
    gate:baseExposure[signal]<.8,
    rank:[...codes].map(k=>feature(k,signal)).filter(Boolean).filter(v=>v.rs20>=-.15&&v.rs20<=.08&&v.rs5>=.025&&v.near20>=.80&&v.above20>=-.08).sort((a,b)=>(b.rs5-b.rs20/4)-(a.rs5-a.rs20/4)).findIndex(v=>v.code===code)+1});
 }
 const triggers=snapshots.filter(x=>x.early);
 return {code,days_with_features:snapshots.length,strong_signal_days:triggers.length,
  risk_allowed_days:triggers.filter(x=>x.gate).length,
  top1_while_risk_allowed:triggers.filter(x=>x.gate&&x.rank===1).length,
  latest: snapshots.at(-1)||null};
});
const sorted=[...results].sort((a,b)=>b.relative_return_pp-a.relative_return_pp);
const robustGroups=[];
for(const key of [...new Set(results.map(x=>[x.rs5_min,x.rs20_floor,x.gate,x.fraction].join('|')))]){
 const group=results.filter(x=>[x.rs5_min,x.rs20_floor,x.gate,x.fraction].join('|')===key);
 if(group.length!==2)throw Error('delay test mismatch');
 robustGroups.push({...group[0],latency_1_return_pp:group.find(x=>x.latency===1).relative_return_pp,
 latency_2_return_pp:group.find(x=>x.latency===2).relative_return_pp,
 worst_latency_return_pp:Math.min(...group.map(x=>x.relative_return_pp)),
 worst_mdd_change_pp:Math.max(...group.map(x=>x.mdd_change_pp))});
}
robustGroups.sort((a,b)=>b.worst_latency_return_pp-a.worst_latency_return_pp);
const out={
 warning:'ONLY 2026 last-121-day seed; proxy blended index + CLOSE-MOC satellite, not frozen Python end-to-end historical backtest. No published trade signal.',
 lock_id:archive.lock_id,source:'FC23 seeded stock CLOSE history + SHA-verified archived C26 NAV',
 assumptions:{universe:codes.length,stockWhitelist:false,capitalSplitNotOriginalC26:true,
 execution:'Signal at prior close; precommitted MOC one/two sessions later',
 startAfterWarmup:baseStart,transaction_costs:'BUY 0.14275%, SELL 0.44275%, combined 0.5855%',shares:'fractional',
 indicators:'RS5/RS20 early reversal vs market, RSI-like inflection, 20-close mean and peak; no daily historical volume available'},
 baseline,
 scanned_variants:results.length,
 top_robust_by_return:robustGroups.slice(0,12),
 all_results:results,
 investigated_stocks:stockAudit,
 seed:{last_day:seed.date,stock_close_buffer:N,market_close_buffer:seed.marketHistory.length,
 target_stocks:stockAudit.map(x=>x.code)}
};
fs.mkdirSync('research/c26-lock/experiments',{recursive:true});
fs.writeFileSync('research/c26-lock/experiments/RS_REVERSAL_PROXY_RESULTS.json',JSON.stringify(out,null,2)+'\n');
console.log('C26_RS_REVERSAL_BASELINE',JSON.stringify(baseline));
console.log('C26_RS_REVERSAL_TOP_ROBUST',JSON.stringify(robustGroups.slice(0,6).map(v=>({
 rs5_min:v.rs5_min,rs20_floor:v.rs20_floor,gate:v.gate,fraction:v.fraction,
 lag1_pp:v.latency_1_return_pp,lag2_pp:v.latency_2_return_pp,
 worst_dd_pp:v.worst_mdd_change_pp
}))));
console.log('C26_RS_REVERSAL_FOUR_STOCKS',JSON.stringify(stockAudit));
console.log('C26_RS_REVERSAL_WARNING',out.warning);
