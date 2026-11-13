/** FinMind historical tick audit of 3443 2026/11/06.
 * Private Github Actions Secret; publishes only derived stop-touch chronology,
 * never raw licensed ticks or user JWT. No trade execution.
 */
import fs from 'node:fs';
const token=process.env.FINMIND_TOKEN?.trim();
if(!token)throw Error('Protected FINMIND_TOKEN missing');
const id='3443', threshold=6025;
const days=['2026-11-06','2026-11-09','2026-11-10'];
function num(v){const n=Number(v);return Number.isFinite(n)?n:NaN}
async function get(date){
 const url='https://api.finmindtrade.com/api/v4/data?'+new URLSearchParams({
  dataset:'TaiwanStockPriceTick',data_id:id,start_date:date
 });
 const res=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(120000),cache:'no-store'});
 if(res.status===401||res.status===403)throw Error('FinMind Tick denied; subscription permission needed');
 if(res.status===429)throw Error('FinMind Tick rate limit; retry on separate date');
 if(!res.ok)throw Error('FinMind Tick HTTP '+res.status);
 const j=await res.json();
 if(j.status!==200||!Array.isArray(j.data))throw Error('FinMind Tick returned status '+j.status);
 const x=j.data.map((v,i)=>({time:String(v.Time||v.time||''),price:num(v.deal_price),volume:num(v.volume),idx:i}))
   .filter(x=>x.time&&x.price>0&&x.volume>0)
   .sort((a,b)=>a.time.localeCompare(b.time)||a.idx-b.idx);
 if(x.length<20)throw Error('Missing tick records '+date+' valid='+x.length);
 return x;
}
const report={research_only:true,lock_id:'C26-EVENT-CORR-LOCK-20261112',
 stock_id:id,source:'FinMind TaiwanStockPriceTick private',
 order_model:{pre_signal:'2026-11-05 13:30',prior_close:6405,conditional_gap_open_max:6405*.93,
   trigger_buy_stop:threshold,exit_following_open:'2026-11-09',roundtrip_cost_pct:.5855},
 note:'Observed tick trades at/above buy-stop are not broker order acknowledgments; prints can skip trigger, queue, slippage and price-time priority remain.',
 sessions:[]};
for(const day of days){
 const x=await get(day);
 const first=x[0],last=x.at(-1);
 const low=x.reduce((n,v)=>Math.min(n,v.price),Infinity),high=x.reduce((n,v)=>Math.max(n,v.price),-Infinity);
 const lowIx=x.findIndex(v=>v.price===low);
 let cross=-1,seenBelow=false;
 for(let i=0;i<x.length;i++){
  if(x[i].price<threshold)seenBelow=true;
  if(seenBelow&&x[i].price>=threshold){cross=i;break}
 }
 const post=cross>=0?x.slice(cross):[];
 const near=x.filter(v=>v.price===threshold);
 const m={
  date:day,valid_ticks:x.length,
  first_trade_time:first.time,first_trade_price:first.price,
  last_trade_time:last.time,last_trade_price:last.price,
  minimum_trade_price:low,minimum_first_seen_at:x[lowIx].time,
  maximum_trade_price:high,
  stop_6025_recross_after_trading_below:cross>=0,
  first_recross_time:cross>=0?x[cross].time:null,
  first_recross_trade_price:cross>=0?x[cross].price:null,
  first_trade_at_exact_6025:near.length?near[0].time:null,
  exact_6025_trade_count:near.length,
  exact_6025_volume_total:near.reduce((n,v)=>n+v.volume,0),
  after_cross_min_price:post.length?post.reduce((n,z)=>Math.min(n,z.price),Infinity):null,
  after_cross_min_drawdown_pct:post.length?100*(Math.min(...post.map(z=>z.price))/threshold-1):null,
  after_cross_max_price:post.length?post.reduce((n,z)=>Math.max(n,z.price),-Infinity):null,
  low_before_reclaim:cross>=0?lowIx<cross:null
 };
 report.sessions.push(m);
 // Out-of-sample 2026-11-06 check for the broader 4% rebound rule selected
 // by the 2021-2026-10 historical robustness grid. No future bar in the trigger.
 if(day==='2026-11-06'){
  const alt=6150;
  let pos=-1,wasBelow=false;
  for(let i=0;i<x.length;i++){
   if(x[i].price<alt)wasBelow=true;
   if(wasBelow&&x[i].price>=alt){pos=i;break}
  }
  const after=pos>=0?x.slice(pos):[];
  // First observed trade at fixed operational delays after the stop was touched.
  // This is a latency sensitivity, never a promised broker fill.
  const ms=z=>{const [h,m,sec]=z.split(':');return 3600000*(+h)+60000*(+m)+1000*(+sec)};
  const start=pos>=0?ms(x[pos].time):NaN;
  const delayedExecutionQuotes=pos<0?[]:[0,10,30,60,300].map(delaySec=>{
    const next=x.find(z=>ms(z.time)>=start+delaySec*1000);
    return {delay_seconds:delaySec,first_observed_price_after_delay:next?.price??null,
     first_observed_time_after_delay:next?.time??null};
  });

  report.alternative_rebound_4pct={
   prior_close:6405,threshold:alt,trigger_discount_pct:4,
   min_next_open_gap_pct:3,
   actual_open_gap_pct:100*(1-first.price/6405),
   touched_after_opening_below:pos>=0,
   first_touch_time:pos>=0?x[pos].time:null,
   first_trade_at_or_above_threshold:pos>=0?x[pos].price:null,
   prints_exact_threshold:x.filter(z=>z.price===alt).length,
   day_low_observed_after_touch:after.length?after.reduce((m,z)=>Math.min(m,z.price),Infinity):null,
   day_last_trade:last.price,
   price_path_verified:pos>=0,
   hypothetical_broker_execution_quotes_after_delay:delayedExecutionQuotes,
   broker_execution_verified:false
  };
 }
 console.log('C26_TICK_3443_AGGREGATE',JSON.stringify({date:day,valid_ticks:x.length,stop_crossed:m.stop_6025_recross_after_trading_below,
   first_recross_time:m.first_recross_time,low_time:m.minimum_first_seen_at,low_before_reclaim:m.low_before_reclaim,
   minimum:m.minimum_trade_price,maximum:m.maximum_trade_price,first:m.first_trade_price,last:m.last_trade_price}));
}
const buy=report.sessions[0],sell=report.sessions[1];
report.execution_check={
 daybar_1106_ohlc_parity:buy.first_trade_price===5765&&buy.maximum_trade_price===6460&&buy.minimum_trade_price===5765&&buy.last_trade_price===6205,
 buy_stop_6025_trade_path_supported:buy.stop_6025_recross_after_trading_below,
 actual_trade_at_exact_limit:buy.exact_6025_trade_count>0,
 exit_1109_auction_price_supported:sell.first_trade_price===6420,
 gross_return_to_1109_first_print_pct:100*(sell.first_trade_price/threshold-1),
 modeled_roundtrip_net_pct:100*(sell.first_trade_price*(1-.0044275)/(threshold*(1+.0014275))-1),
 certified_user_broker_fill:false
};
if(report.alternative_rebound_4pct){
 const a=report.alternative_rebound_4pct;
 a.next_open_exit=sell.first_trade_price;
 a.hypothetical_broker_execution_quotes_after_delay=a.hypothetical_broker_execution_quotes_after_delay.map(z=>({
  ...z,conditional_net_pct:z.first_observed_price_after_delay?
   100*(sell.first_trade_price*(1-.0044275)/
   (z.first_observed_price_after_delay*(1+.0014275))-1):null
 }));
 a.net_with_first_touch_price_pct=a.first_trade_at_or_above_threshold?
  100*(sell.first_trade_price*(1-.0044275)/(a.first_trade_at_or_above_threshold*(1+.0014275))-1):null;
 a.net_with_plus_halfpct_each_side_pct=a.first_trade_at_or_above_threshold?
  100*(sell.first_trade_price*(1-.005)*(1-.0044275)/
   (a.first_trade_at_or_above_threshold*(1+.005)*(1+.0014275))-1):null;
 console.log('C26_3443_4PCT_REBOUND_TICK_VERIFIED',JSON.stringify(a));
}
fs.writeFileSync('research/c26-lock/experiments/C26_3443_20261106_TICK_PATH.json',JSON.stringify(report,null,2)+'\n');
console.log('C26_TICK_3443_VERDICT',JSON.stringify(report.execution_check));
