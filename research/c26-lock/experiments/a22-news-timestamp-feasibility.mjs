/** A22 news DATA FEASIBILITY audit. Never publish copyrighted news text, credentials or raw records. */
import fs from 'node:fs';
const token=process.env.FINMIND_TOKEN?.trim();
if(!token)throw new Error('Protected FINMIND_TOKEN missing');
const samples=[
 ['2021-05-17','2615','major_crash_leader'],['2021-05-17','1101','same_event_control'],
 ['2024-08-05','3019','major_crash_leader_prior_day'],['2024-08-06','3019','major_crash_leader'],
 ['2025-04-22','1560','major_crash_leader'],['2026-03-09','3037','major_crash_leader'],
 ['2026-07-30','2059','major_crash_leader'],['2026-07-30','2330','index_control'],
 ['2026-11-05','3443','known_1106_case_prior'],['2026-11-05','3661','known_1106_case_prior'],
 ['2026-11-06','3443','known_1106_case_day'],['2026-11-06','3661','known_1106_case_day'],
 ['2026-11-09','3443','known_1109_case_day'],['2026-11-09','3661','known_1109_case_day'],
 ['2026-11-10','3443','known_1110_case_day'],['2026-11-10','3661','known_1110_case_day']
];
const categories={
 orders:/訂單|接單|急單|出貨|shipment|order\s?book|合約|contract/i,
 guidance:/營收|獲利|財報|EPS|財測|毛利|月增|年增|業績|forecast|guidance/i,
 semis:/ASIC|晶片|IP|晶圓|設計服務|封裝|先進製程|HBM|CoWoS|半導體/i,
 ai:/AI|人工智慧|伺服器|NVIDIA|輝達|GPU|資料中心|算力/i,
 capex:/擴產|資本支出|設備投資|產能|新廠|capex/i,
 regulatory:/停牌|處置|重訊|裁罰|澄清|董事會|公告|法說|重大訊息/i,
 price_reactive:/股價|漲停|跌停|反彈|急漲|飆股|重挫|暴漲|盤中|盤後|大漲|大跌/i
};
const type=(s)=>{
 const x=String(s||'').trim();
 if(!x)return 'empty';
 if(/^\d{4}-\d\d-\d\d$/.test(x))return 'day_only';
 if(/^\d{4}-\d\d-\d\d[T\s]\d\d:\d\d(?::\d\d)?/.test(x))return 'datetime_text';
 if(/^\d{4}\/\d\d\/\d\d/.test(x))return 'slash_date';
 return 'other';
};
const reports=[];
for (const [date,stock_id,kind] of samples) {
 const report={date,stock_id,kind};
 try{
  const u='https://api.finmindtrade.com/api/v4/data?'+new URLSearchParams({dataset:'TaiwanStockNews',data_id:stock_id,start_date:date});
  const response=await fetch(u,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(90000),cache:'no-store'});
  if(!response.ok){report.error='HTTP_'+response.status;reports.push(report);continue}
  const body=await response.json();
  if(body.status!==200||!Array.isArray(body.data)){report.error='API_'+String(body.status);reports.push(report);continue}
  const a=body.data;
  report.record_count=a.length;
  report.field_names=[...new Set(a.flatMap(r=>Object.keys(r)))].sort();
  report.datetime_field_types={};
  for(const k of ['date','published_at','publication_date','created_at','time','datetime','timestamp']){
   const vals=a.map(z=>z[k]).filter(x=>x!=null);
   if(!vals.length)continue;
   report.datetime_field_types[k]={};
   for(const v of vals){const key=type(v);report.datetime_field_types[k][key]=(report.datetime_field_types[k][key]||0)+1}
  }
  report.sources_count={};
  report.categories_count={};
  report.with_title=0;report.with_summary=0;report.with_source=0;report.with_url=0;
  for(const k of Object.keys(categories))report.categories_count[k]=0;
  for(const r of a) {
   const src=String(r.source||'').slice(0,70);
   if(src){report.with_source++;report.sources_count[src]=(report.sources_count[src]||0)+1}
   if(r.title)report.with_title++;
   if(r.description)report.with_summary++;
   if(r.link)report.with_url++;
   const str=String(r.title||'')+' '+String(r.description||'').slice(0,450);
   for(const [k,re] of Object.entries(categories)) if(re.test(str))report.categories_count[k]++;
  }
  // This summary deliberately excludes news titles, texts, article URLs and token.
 }catch(err){report.error='ERROR_'+String(err.message).slice(0,45)}
 reports.push(report);
 console.log('A22_NEWS_META',JSON.stringify({date,stock_id,rows:report.record_count??null,error:report.error??null,
   date_types:report.datetime_field_types?.date??null,categories:report.categories_count??null}));
}
const out={
 research_only:true, dataset:'FinMind TaiwanStockNews',requests:samples.length,
 created_for:'A22 news chronology feasibility, no returns labels used for dataset fetch',
 decision:'IF NEWS DATE IS DAY_ONLY it CANNOT be used for same-session trading without the original publisher timestamp; restrict to next-session signals or discard',
 limits:'This is purposive sample of known cases, not population or a tested news-based trading strategy',
 metadata_only:true, raw_titles_saved:false, reports
};
fs.writeFileSync('research/c26-lock/experiments/A22_FINMIND_NEWS_TIMESTAMP_FEASIBILITY.json',JSON.stringify(out,null,2)+'\n','utf8');
console.log('A22_SUMMARY',JSON.stringify({requests:samples.length,ok:reports.filter(x=>!x.error).length,records:reports.reduce((a,x)=>a+(x.record_count||0),0)}));
