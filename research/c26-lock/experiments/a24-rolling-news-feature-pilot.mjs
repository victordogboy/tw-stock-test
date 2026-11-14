/**
 * A24 PRE-COMMITTED news incremental signal pilot, 26 crash events x 10 stocks.
 * Price top 5: 0.5*(prior RS20 percentile+signal day return percentile).
 * Control 5: sha256("A24-FIXED-20261115:"+date+":"+code) lexicographic first 5.
 * The precommitted cohorts were created from A20 point-in-time candidate frame,
 * and do not depend on future pnl5, except cohort retrospective analysis later.
 * Output derived category counts, NO raw news text/links/copyrighted articles/token.
 */
import fs from 'node:fs';
const token=process.env.FINMIND_TOKEN?.trim();
if(!token)throw new Error('Missing FinMind protected secret');
const cohorts=String.raw\`2021-05-07 2605 6116 2609 3006 2409 | 1210 3211 8163 2455 2485
2021-07-29 5269 3189 3006 2393 1795 | 3552 9945 2408 6188 6147
2021-09-30 3661 2486 8044 3529 3443 | 2892 9904 4743 1210 1513
2022-02-07 8069 2323 3036 3324 2883 | 2312 2439 2542 4743 8358
2022-03-09 4162 2609 2603 3017 3529 | 2633 4128 3714 2401 9904
2022-04-13 1795 1560 3552 2618 4919 | 3529 2382 2520 1802 1102
2022-05-13 5425 3533 6770 2401 2345 | 2605 1312 2388 2371 1609
2022-06-21 1560 1319 1590 2201 2049 | 2492 2801 3042 8299 8046
2022-07-29 1536 3008 5904 3081 2388 | 1802 3324 1605 5009 2913
2022-09-27 1536 3680 6153 1605 6285 | 9958 1609 6274 2313 6239
2022-12-22 8436 2606 2615 2603 2605 | 2409 3034 2458 2382 5009
2023-04-28 3078 1503 8086 5009 2408 | 4123 2486 2312 3673 2880
2023-08-15 2059 2383 3017 3035 2376 | 2610 6139 6279 4743 2884
2024-04-23 2520 2634 9914 1795 2393 | 5880 2388 6279 1909 9939
2024-07-23 2520 3653 3293 2542 9945 | 2515 2308 5904 6269 2489
2024-09-12 3081 2388 8039 3529 3661 | 3042 2337 3711 3044 3005
2025-01-14 3081 3264 6285 6245 8046 | 2312 2884 3260 4919 1802
2025-03-20 2408 1319 2328 5347 2439 | 5425 6547 1717 3189 2385
2025-04-23 2404 6669 6510 3529 2454 | 3532 2408 2486 1319 3006
2025-11-20 2368 8299 1303 2383 6274 | 2548 2609 2439 3324 2347
2026-03-05 2337 2486 6443 2383 3529 | 4743 3035 6005 1722 8150
2026-04-07 6213 6274 6147 8046 3105 | 9945 2105 2890 5009 6139
2026-05-21 2327 3443 2454 2492 3481 | 3293 2324 2412 9958 5009
2026-06-30 2492 1303 1718 2327 6182 | 6257 8436 3533 3042 4904
2026-07-31 6669 3231 2059 8039 6488 | 3376 6176 2303 1503 4958
2026-09-16 3406 3324 2489 6173 2338 | 3673 3529 1301 1402 2379\`;
const items=[];
for (const line of cohorts.trim().split('\n')){
 const [lhs,rhs]=line.split('|');const [date,...leaders]=lhs.trim().split(/\s+/);
 const controls=rhs.trim().split(/\s+/);
 if(leaders.length!==5||controls.length!==5)throw Error('precommitted cohort mismatch: '+date);
 for(const [name,list] of [['baseline_top5',leaders],['fixed_random5',controls]]){
  for(const code of list)items.push({signal_date:date,stock_id:code,group:name});
 }
}
if(items.length!==260)throw Error('not 260');
const cats={
 financial:/營收|財報|財測|獲利|EPS|毛利|年增|月增|業績|法說|forecast|guidance/i,
 business:/接單|訂單|客戶|出貨|新產品|合作|代工|產品|簽約|contract|order/i,
 capacity:/擴產|產能|新廠|資本支出|投資|設備|capex/i,
 semiconductors:/晶片|晶圓|ASIC|半導體|IP|封裝|先進製程|HBM|CoWoS/i,
 ai:/人工智慧|AI|伺服器|NVIDIA|輝達|GPU|資料中心/i,
 price_reactive:/股價|漲停|跌停|飆股|強勢股|反彈|急漲|急跌|重挫|暴漲|大漲|大跌|盤中|開高|開低|股市|台股|行情/i,
 regulatory:/重訊|公告|處置|裁罰|調查|董事會|法說|澄清|重大訊息/i,
 sentiment_positive:/上修|優於|創高|成長|上升|獲利|增加|利多|擴大|超預期|新高/i,
 sentiment_negative:/下修|低於|衰退|下滑|減少|虧損|利空|倒閉|裁員|失利|警告/i
};
function prevYMD(s,n=7){const t=new Date(s+'T12:00:00Z');t.setUTCDate(t.getUTCDate()-n);return t.toISOString().slice(0,10)}
const safeTime=date=>/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d/.test(String(date??''));
function dedup(s){return String(s||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'').slice(0,230)}
const results=new Array(items.length);
let pos=0;
let retries=0;
async function fetchOne(item) {
 const out={...item, news_count:0,unique_titles:0,independent_sources:0,unverified_timestamp_count:0,
  same_day_excluded:0, out_of_window_excluded:0,duplicate_count:0,
  financial_count:0,business_count:0,capacity_count:0,semiconductors_count:0,ai_count:0,
  price_reactive_count:0,regulatory_count:0,sentiment_positive_count:0,sentiment_negative_count:0,
  factual_preprice_count:0};
 const start=prevYMD(item.signal_date,7);
 const params=new URLSearchParams({dataset:'TaiwanStockNews',data_id:item.stock_id,start_date:start,end_date:item.signal_date});
 const url='https://api.finmindtrade.com/api/v4/data?'+params.toString();
 let records=null;
 for(let attempt=0;attempt<4;attempt++){
  try{
   const resp=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(70000)});
   if(resp.status===429||resp.status===503){retries++;await new Promise(f=>setTimeout(f,700*(attempt+1)));continue}
   if(!resp.ok){out.error='HTTP_'+resp.status;return out}
   const data=await resp.json();
   if(data.status!==200||!Array.isArray(data.data)){out.error='API_'+String(data.status);return out}
   records=data.data;break;
  }catch(e){if(attempt===3){out.error='QUERY_ERROR';return out}await new Promise(f=>setTimeout(f,500*(attempt+1)))}
 }
 if(!records){out.error='RETRY_EXHAUSTED';return out}
 out.api_rows=records.length;
 const titles=new Set(); const sources=new Set();
 for (const r of records){
  const time=String(r.date||'');
  if(!safeTime(time)){out.unverified_timestamp_count++;continue}
  const day=time.slice(0,10);
  // Exclude on-signal date even before 08:45. This also avoids UTC/Taipei ambiguity;
  // prior calendar day records must still be source verified for final causal claim.
  if(day>=item.signal_date){out.same_day_excluded++;continue}
  if(day<start){out.out_of_window_excluded++;continue}
  const norm=dedup(r.title);if(!norm)continue;
  if(titles.has(norm)){out.duplicate_count++;continue}
  titles.add(norm);
  const source=String(r.source||'').trim().toLowerCase().replace(/^www\./,'');
  if(source)sources.add(source);
  out.news_count++;
  const flags={};for(const [k,re] of Object.entries(cats)){flags[k]=re.test(String(r.title));if(flags[k])out[k+'_count']++}
  if(!flags.price_reactive&&(flags.business||flags.financial||flags.capacity||flags.regulatory))out.factual_preprice_count++;
 }
 out.unique_titles=titles.size;out.independent_sources=sources.size;
 return out;
}
async function worker(){
 while(true){const i=pos++;if(i>=items.length)return;results[i]=await fetchOne(items[i]);
 if((i+1)%25===0)console.log('A24_PROGRESS',JSON.stringify({last_index:i+1,success:results.filter(x=>x&&!x.error).length,err:results.filter(x=>x?.error).length}));
 }}
await Promise.all(Array.from({length:3},worker));
const summary={
 study:'A24 precommitted 26 events x 10 stocks, news before signal day only',
 research_only:true,
 sample_design:'5 price rank top and 5 SHA256 predetermined unrelated controls per crash event',
 target_dates:'2021-05-07 through 2026-09-16',
 feature_cutoff:'strict news record date < signal_date at any time; allow conservative pre-open only',
 timestamp_note:'FinMind date timezone/source-creation not independently authenticated; publication availability unproven',
 source_priority:'official MOPS publication needs separate historical archive; NOT conflated with media news',
 derived_metadata_only:true, raw_titles_or_articles_stored:false,
 total_requests:items.length,success:results.filter(x=>x&&!x.error).length, failures:results.filter(x=>x.error).length,
 retries,api_returned_total:results.reduce((a,x)=>a+(x.api_rows||0),0),
 pre_signal_distinct_news_total:results.reduce((a,x)=>a+x.news_count,0),
 same_day_excluded_total:results.reduce((a,x)=>a+x.same_day_excluded,0),
 out_of_window_excluded_total:results.reduce((a,x)=>a+x.out_of_window_excluded,0),
 rows:results
};
fs.writeFileSync('research/c26-lock/experiments/A24_PREDECLARED_NEWS_FEATURES_260.json',JSON.stringify(summary,null,2)+'\n');
console.log('A24_FINISHED',JSON.stringify({requests:summary.total_requests,success:summary.success,failures:summary.failures,news:summary.pre_signal_distinct_news_total,returned:summary.api_returned_total,retries:summary.retries}));
