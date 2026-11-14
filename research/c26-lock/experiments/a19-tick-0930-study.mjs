/** A19 protected FinMind historical tick: PRE-registered opening 30-min observables.
 * Public output: derived snapshots ONLY. No raw ticks or auth secrets.
 * Warning: EX-POST selected historical leader examples, not population OOS.
 */
import fs from 'node:fs';
const token=process.env.FINMIND_TOKEN?.trim();
if(!token)throw new Error('Protected FINMIND_TOKEN missing');
const targets=[
 ['2021-05-17','2615','historical_rebound_leader'],['2021-05-17','2609','historical_rebound_leader'],['2021-05-17','2330','benchmark'],
 ['2022-01-25','3661','historical_rebound_leader'],['2022-01-25','2330','benchmark'],
 ['2024-08-06','3019','historical_rebound_leader'],['2024-08-06','3661','historical_rebound_leader'],['2024-08-06','2330','benchmark'],
 ['2025-04-22','1560','historical_rebound_leader'],['2025-04-22','2330','benchmark'],
 ['2026-03-09','3037','historical_rebound_leader'],['2026-03-09','2330','benchmark'],
 ['2026-07-30','2059','historical_rebound_leader'],['2026-07-30','8039','historical_rebound_leader'],['2026-07-30','2330','benchmark'],
 ['2026-11-06','3443','known_2026_reversal'],['2026-11-06','3661','same_event_nonqualifier']
];
const ts=s=>{const a=String(s).split(':').map(Number);return a[0]*3600+a[1]*60+(a[2]||0)};
const b=(a,t)=>a.filter(x=>x.sec>=ts('09:00:00')&&x.sec<t);
const sum=(a,k)=>a.reduce((v,x)=>v+(x[k]||0),0);
const all=[];
for(let i=0;i<targets.length;i++){
 const [date,code,kind]=targets[i];
 const rec={date,stock_id:code,kind};
 try{
  const u='https://api.finmindtrade.com/api/v4/data?'+new URLSearchParams({dataset:'TaiwanStockPriceTick',data_id:code,start_date:date});
  const response=await fetch(u,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(110000),cache:'no-store'});
  if(response.status===401||response.status===403){rec.error='TICK_NOT_PERMITTED';all.push(rec);continue}
  if(response.status===429){rec.error='RATE_LIMIT';all.push(rec);continue}
  if(!response.ok){rec.error='HTTP_'+response.status;all.push(rec);continue}
  const body=await response.json();
  if(body.status!==200||!Array.isArray(body.data)){rec.error='API_'+body.status;all.push(rec);continue}
  const rows=body.data.map((r,n)=>({
   t:String(r.Time||r.time||''),price:Number(r.deal_price),volume:Number(r.volume),
   side:Number(r.TickType??r.tick_type??0),idx:n
  })).filter(x=>x.t&&Number.isFinite(x.price)&&x.price>0&&x.volume>0)
    .sort((a,b)=>a.t.localeCompare(b.t)||a.idx-b.idx)
    .map(x=>({...x,sec:ts(x.t)}));
  const day=rows.filter(x=>x.sec>=ts('09:00')&&x.sec<=ts('13:30:30'));
  if(day.length<15){rec.error='INSUFFICIENT_TICK_'+day.length;all.push(rec);continue}
  const first=day[0];
  const last=day[day.length-1];
  const early15=b(day,ts('09:15:00')),early30=b(day,ts('09:30:00')),early60=b(day,ts('10:00:00'));
  const snap=(d,tag)=>{
   if(d.length<3){rec[tag+'_error']='MISSING';return}
   const px=d.at(-1).price,hi=Math.max(...d.map(x=>x.price)),lo=Math.min(...d.map(x=>x.price)),vol=sum(d,'volume');
   const buy=sum(d.filter(x=>x.side===1),'volume'),sell=sum(d.filter(x=>x.side===2),'volume'),zero=sum(d.filter(x=>x.side!==1&&x.side!==2),'volume');
   rec[tag+'_ticks']=d.length;
   rec[tag+'_last_trade_time']=d.at(-1).t;
   rec[tag+'_last_price']=px;
   rec[tag+'_return_pct']=100*(px/first.price-1);
   rec[tag+'_range_pct']=100*(hi/lo-1);
   rec[tag+'_high_price']=hi;
   rec[tag+'_low_price']=lo;
   rec[tag+'_close_location_0_1']=hi>lo?(px-lo)/(hi-lo):null;
   rec[tag+'_vwap']=d.reduce((a,x)=>a+x.price*x.volume,0)/vol;
   rec[tag+'_above_vwap']=px>=rec[tag+'_vwap'];
   rec[tag+'_classified_buy_volume_frac']=buy+sell>0?buy/(buy+sell):null;
   rec[tag+'_unclassified_volume_frac']=zero/vol;
   rec[tag+'_cumulative_volume']=vol;
  };
  rec.valid_ticks_day=day.length;
  rec.first_trade_time=first.t;rec.first_trade_price=first.price;
  rec.last_trade_time=last.t;rec.last_trade_price=last.price;
  snap(early15,'m15');snap(early30,'m30');snap(early60,'m60');
  // At 09:30 this test uses ONLY first 30-min ticks. No future day-high or close.
  if(early30.length>=3&&early15.length>=3){
   const x30=early30.at(-1).price;
   rec.opening_30min_reclaims_first15_high=x30>Math.max(...early15.map(x=>x.price)) && rec.m30_range_pct>0.001;
   rec.opening_30min_above_first15_vwap=x30>=rec.m15_vwap;
  }
  const firstAfter=day.find(z=>z.sec>=ts('09:30:00'));
  rec.next_available_trade_at_or_after_0930=firstAfter?.price??null;
  rec.next_available_trade_time_at_or_after_0930=firstAfter?.t??null;
  // Event-driven triggers fixed as a percent of the known FIRST trade price.
  // The trade at trigger is only an observed print; never a verified order fill.
  rec.precommitted_open_reclaim_triggers={};
  for(const percent of [3,5,7]){
    const threshold=first.price*(1+percent/100);
    const index=day.findIndex((z,i)=>i>0&&z.price>=threshold);
    const key='open_plus_'+percent+'_pct';
    if(index<0){
      rec.precommitted_open_reclaim_triggers[key]={touched:false};
      continue;
    }
    const crossing=day[index];
    const after30=day.filter(z=>z.sec>=crossing.sec&&z.sec<=crossing.sec+1800);
    const min30=after30.length?Math.min(...after30.map(z=>z.price)):null;
    const max30=after30.length?Math.max(...after30.map(z=>z.price)):null;
    rec.precommitted_open_reclaim_triggers[key]={
      touched:true,
      first_cross_time:crossing.t,
      first_cross_trade_price:crossing.price,
      open_price: first.price,
      observed_trade_return_to_day_last_pct:100*(last.price/crossing.price-1),
      min_trade_in_30min_after_cross:min30,
      min30_trade_drawdown_from_cross_pct:min30?100*(min30/crossing.price-1):null,
      max30_trade_rise_from_cross_pct:max30?100*(max30/crossing.price-1):null,
      no_broker_fill_certification:true
    };
  }
  rec.opening_30_min_traded_flat=early30.length>2 && rec.m30_range_pct<.001;
  // descriptive outcome only, never used in detection conditions
  rec.same_day_last_return_from_0930_pct=firstAfter?100*(last.price/firstAfter.price-1):null;
  console.log('A19_TICK_FEATURE_ONLY',JSON.stringify({date,code,kind,first30:rec.m30_return_pct,near:rec.m30_close_location_0_1,ticks:rec.valid_ticks_day}));
 }catch(e){rec.error='QUERY_ERROR_'+String(e.message).slice(0,50)}
 all.push(rec);
}
const output={
 mode:'A19_RESEARCH_ONLY',
 generated_by:'Private protected GitHub Actions FinMind, no JWT/raw licensed rows committed',
 notes:[
 'Each example selected because it was a known historical leader or benchmark; not a representative tradeable training set',
 'All 09:30 indicators derived strictly from transactions before 09:30:00; 09:30+ first price is a separate hypothetical execution quote',
 'TickType 0 unclassified, not grouped with buyer/seller',
 'No broker execution confirmation, fill capacity or limit-up queue validation',
 'Historical tick dataset access depends on FinMind account permission; missing data recorded explicitly'
 ],
 requested_samples:targets.length,samples:all,
 sufficient_sample_count:all.filter(x=>!x.error).length,
 failed_samples:all.filter(x=>x.error).map(x=>({date:x.date,code:x.stock_id,error:x.error}))
};
fs.writeFileSync('research/c26-lock/experiments/A19_HISTORICAL_0930_TICK_FEATURES.json',JSON.stringify(output,null,2)+'\n');
console.log('A19_TICK_SUMMARY',JSON.stringify({requested:output.requested_samples,verified:output.sufficient_sample_count,failed:output.failed_samples}));
