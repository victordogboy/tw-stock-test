/**
 * C26 non-production post-close four-stock diagnostics across the FULL 233-symbol
 * pool. Reads the private FinMind staging cache only inside the restricted
 * c26-forward-eod GitHub OIDC job; releases derived signal flags, never raw OHLC.
 *
 * Two alternative screen families (momentum, early reversal). This is NOT C26's
 * original factor ranking, live broker signal, or a backtest. No stock whitelist.
 * Uses completed signal-day closing data for a NEXT-session candidate audit.
 */
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const dir='public/r1494a/c26/data/';
const seed=JSON.parse(gunzipSync(Buffer.from(fs.readFileSync('public/r1494a/fc23/shared-seed.b64','utf8').trim(),'base64')));
const raw=JSON.parse(gunzipSync(fs.readFileSync('.c26-private/forward-eod.json.gz')));
const refs=JSON.parse(fs.readFileSync('research/c26-lock/forward/archive-feature-reference.json','utf8'));
const status=JSON.parse(fs.readFileSync(dir+'forward-status.json','utf8'));
const pool=refs.codes;
if(raw.lock_id!==refs.lock_id||raw.pool_sha256!==refs.pool_sha256||status.lock_id!==refs.lock_id)throw Error('C26 source version mismatch');
if(seed.date!=='2026-10-27'||pool.length!==233||new Set(pool).size!==233)throw Error('research seed mismatch');
const navMeta=JSON.parse(fs.readFileSync(dir+'historical-assets.json','utf8')).parts.nav;
const zipped=Buffer.from(navMeta.base64_parts.map(f=>fs.readFileSync(dir+f,'utf8').trim()).join(''),'base64');
if(zipped.length!==navMeta.bytes_gzip||createHash('sha256').update(zipped).digest('hex')!==navMeta.sha256_gzip)throw Error('C26 historical dates checksum mismatch');
const navRows=gunzipSync(zipped).toString('utf8').trim().split(/\r?\n/).slice(1).map(l=>l.slice(0,10));
if(navRows.at(-1)!=='2026-10-27')throw Error('frozen dates mismatch');
const N=Math.min(121,seed.marketHistory.length,...pool.map(c=>seed.stocks[c]?.c?.length||0));
if(N<70)throw Error('seed too short');
const dates=navRows.slice(-N);
const matrix=new Map(pool.map(c=>[c,seed.stocks[c].c.slice(-N).map(x=>x==null?NaN:Number(x))]));
const tradable=new Map(pool.map(c=>[c,Array.from({length:N},(_,i)=>matrix.get(c)[i]>0)]));
const extra=Object.keys(raw.days).filter(d=>d>'2026-10-27'&&d<=status.full_market_last_verified&&raw.days[d].source_state==='available').sort();
if(extra.length<10)throw Error('Too little verified forward source');
let last=dates.at(-1);
for(const date of extra){
 if(date<=last)throw Error('out of order source');
 const record=raw.days[date];
 const by=new Map(record.price.map(x=>[String(x.stock_id),x]));
 for(const code of pool){
  const rows=matrix.get(code),x=by.get(code);
  const good=!!(x?.valid&&Number.isFinite(x.close)&&x.close>0);
  const previous=rows.at(-1);
  rows.push(good?x.close:previous);
  tradable.get(code).push(good);
 }
 dates.push(date);last=date;
}
const positive=x=>Number.isFinite(x)&&x>0;
const returns=(arr,t,n)=>positive(arr[t])&&positive(arr[t-n])?arr[t]/arr[t-n]-1:NaN;
const median=a=>{const v=a.filter(Number.isFinite).sort((a,b)=>a-b);return v.length?(v[(v.length-1)>>1]+v[v.length>>1])/2:NaN};
const market=[1];
for(let t=1;t<dates.length;t++){
 const daily=median(pool.map(c=>returns(matrix.get(c),t,1)).filter(v=>Math.abs(v)<=.2));
 market.push(market.at(-1)*(Number.isFinite(daily)?1+daily:1));
}
function feature(code,idx){
 const p=matrix.get(code),v=p[idx];if(!positive(v)||idx<20)return null;
 const rs5=returns(p,idx,5)-returns(market,idx,5);
 const rs20=returns(p,idx,20)-returns(market,idx,20);
 const win=p.slice(idx-19,idx+1);
 if(![rs5,rs20].every(Number.isFinite)||win.some(x=>!positive(x)))return null;
 const near20=v/Math.max(...win),avg20=win.reduce((a,b)=>a+b,0)/win.length;
 return {code,rs5,rs20,near20,above20:v/avg20-1,executable:tradable.get(code)[idx]===true};
}
const families={
 momentum:f=>f.rs20>=.06&&f.rs5>=.015&&f.near20>=.99&&f.above20>=0,
 reversal:f=>f.rs20>=-.05&&f.rs20<=.08&&f.rs5>=.025&&f.near20>=.80&&f.above20>=-.08
};
const score={
 momentum:f=>f.rs20+.6*f.rs5,
 reversal:f=>f.rs5-f.rs20/4
};
const lookAt=['2026-11-12',status.full_market_last_verified].filter((x,i,a)=>a.indexOf(x)===i&&dates.includes(x));
const interesting=['3443','3661','3035','2454']; // DIAGNOSTICS ONLY; not entry whitelist.
const report={lock_id:refs.lock_id,model_version:'C26',
 research_only:true,live_plan_readiness:'NOT_A_TRADING_PLAN',portfolio_replay_not_performed:true,
 causal:true,universe_size:233,source_as_of:status.full_market_last_verified,
 market_benchmark:'median daily return of 233-pool, NOT C26 original full-market proxy',
 source:'C26 verified private FinMind EOD plus public frozen FC23 stock close seed',
 limitations:'Indicator-side screen only; C26 original rank, cash, position, cooldown, risk exposure and actual trade signals must come from frozen Python engine. No future execution data used.',
 assessed_dates:[]};
for(const date of lookAt){
 const idx=dates.indexOf(date),features=pool.map(c=>feature(c,idx)).filter(Boolean),familiesOut={};
 for(const [family,condition] of Object.entries(families)){
  const valid=features.filter(f=>f.executable&&condition(f)).sort((a,b)=>score[family](b)-score[family](a));
  const ranks=new Map(valid.map((x,i)=>[x.code,i+1]));
  familiesOut[family]={passing_count:valid.length,top5:valid.slice(0,5).map(x=>x.code),
   four_stocks:interesting.map(code=>({code,passed:ranks.has(code),rank:ranks.get(code)||null}))};
 }
 report.assessed_dates.push({
  close_as_of:date,
  candidate_for_next_session:date==='2026-11-12'?'2026-11-13':status.next_exchange_trade_date,
  all_features_available:features.length,
  four_stock_technical:interesting.map(code=>{
   const x=feature(code,idx);
   if(!x)return {code,available:false};
   return {code,available:true,tradable:x.executable,rs5_pct:+(x.rs5*100).toFixed(3),
    rs20_pct:+(x.rs20*100).toFixed(3),near20_pct:+(x.near20*100).toFixed(3),
    above_mean20_pct:+(x.above20*100).toFixed(3)};
  }),families:familiesOut
 });
}
fs.writeFileSync(dir+'rotation-diagnostic.json',JSON.stringify(report,null,2)+'\n');
console.log('C26_ROTATION_DIAGNOSTIC',JSON.stringify({
 source_as_of:report.source_as_of,assessed_dates:report.assessed_dates,
 warning:'Non-production alternative candidates only; never substitute for verified C26 frozen-engine plan.'}));
