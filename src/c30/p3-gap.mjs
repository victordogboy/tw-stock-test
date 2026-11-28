
const P3_ALLOWED = new Set(["TaiwanStockInstitutionalInvestorsBuySell|1504|2017-02-18|2017-02-18","TaiwanStockInstitutionalInvestorsBuySell|1736|2017-02-18|2017-02-18","TaiwanStockInstitutionalInvestorsBuySell|2059|2017-02-18|2017-02-18","TaiwanStockInstitutionalInvestorsBuySell|2401|2017-02-18|2017-02-18","TaiwanStockInstitutionalInvestorsBuySell|2609|2017-02-18|2017-02-18","TaiwanStockInstitutionalInvestorsBuySell|2903|2017-02-18|2017-02-18","TaiwanStockInstitutionalInvestorsBuySell|3211|2017-02-18|2017-02-18","TaiwanStockInstitutionalInvestorsBuySell|5478|2017-02-18|2017-02-18","TaiwanStockInstitutionalInvestorsBuySell|5880|2017-02-18|2017-02-18","TaiwanStockInstitutionalInvestorsBuySell|6005|2017-02-18|2017-02-18","TaiwanStockInstitutionalInvestorsBuySell|6153|2017-02-18|2017-02-18","TaiwanStockInstitutionalInvestorsBuySell|6206|2017-02-18|2017-02-18","TaiwanStockInstitutionalInvestorsBuySell|6278|2017-02-18|2017-02-18","TaiwanStockInstitutionalInvestorsBuySell|6279|2017-02-18|2017-02-18","TaiwanStockInstitutionalInvestorsBuySell|6605|2017-02-18|2017-02-18","TaiwanStockInstitutionalInvestorsBuySell|8163|2017-02-18|2017-02-18","TaiwanStockInstitutionalInvestorsBuySell|3264|2017-03-23|2017-03-23","TaiwanStockInstitutionalInvestorsBuySell|3036|2017-04-06|2017-04-06","TaiwanStockInstitutionalInvestorsBuySell|1101|2017-04-19|2017-04-19","TaiwanStockInstitutionalInvestorsBuySell|1101|2017-04-20|2017-04-20","TaiwanStockInstitutionalInvestorsBuySell|6504|2017-05-08|2017-05-08","TaiwanStockInstitutionalInvestorsBuySell|1304|2017-06-03|2017-06-03","TaiwanStockInstitutionalInvestorsBuySell|1702|2017-06-03|2017-06-03","TaiwanStockInstitutionalInvestorsBuySell|2062|2017-06-03|2017-06-03","TaiwanStockInstitutionalInvestorsBuySell|2489|2017-06-03|2017-06-03","TaiwanStockInstitutionalInvestorsBuySell|2545|2017-06-03|2017-06-03","TaiwanStockInstitutionalInvestorsBuySell|3022|2017-06-03|2017-06-03","TaiwanStockInstitutionalInvestorsBuySell|3454|2017-06-03|2017-06-03","TaiwanStockInstitutionalInvestorsBuySell|5371|2017-06-03|2017-06-03","TaiwanStockInstitutionalInvestorsBuySell|6257|2017-06-03|2017-06-03","TaiwanStockInstitutionalInvestorsBuySell|6605|2017-06-03|2017-06-03","TaiwanStockInstitutionalInvestorsBuySell|1216|2017-07-27|2017-07-27","TaiwanStockInstitutionalInvestorsBuySell|6282|2017-08-09|2017-08-09","TaiwanStockInstitutionalInvestorsBuySell|2498|2017-09-21|2017-09-21","TaiwanStockInstitutionalInvestorsBuySell|1532|2017-09-30|2017-09-30","TaiwanStockInstitutionalInvestorsBuySell|1711|2017-09-30|2017-09-30","TaiwanStockInstitutionalInvestorsBuySell|2062|2017-09-30|2017-09-30","TaiwanStockInstitutionalInvestorsBuySell|2323|2017-09-30|2017-09-30","TaiwanStockInstitutionalInvestorsBuySell|2489|2017-09-30|2017-09-30","TaiwanStockInstitutionalInvestorsBuySell|2834|2017-09-30|2017-09-30","TaiwanStockInstitutionalInvestorsBuySell|2880|2017-09-30|2017-09-30","TaiwanStockInstitutionalInvestorsBuySell|2887|2017-09-30|2017-09-30","TaiwanStockInstitutionalInvestorsBuySell|3042|2017-09-30|2017-09-30","TaiwanStockInstitutionalInvestorsBuySell|3060|2017-09-30|2017-09-30","TaiwanStockInstitutionalInvestorsBuySell|3514|2017-09-30|2017-09-30","TaiwanStockInstitutionalInvestorsBuySell|3561|2017-09-30|2017-09-30","TaiwanStockInstitutionalInvestorsBuySell|4904|2017-09-30|2017-09-30","TaiwanStockInstitutionalInvestorsBuySell|5371|2017-09-30|2017-09-30","TaiwanStockInstitutionalInvestorsBuySell|6214|2017-09-30|2017-09-30","TaiwanStockInstitutionalInvestorsBuySell|8163|2017-09-30|2017-09-30","TaiwanStockInstitutionalInvestorsBuySell|8422|2017-09-30|2017-09-30","TaiwanStockInstitutionalInvestorsBuySell|3514|2017-10-16|2017-10-16","TaiwanStockInstitutionalInvestorsBuySell|3561|2017-10-16|2017-10-16","TaiwanStockInstitutionalInvestorsBuySell|3576|2017-10-16|2017-10-16","TaiwanStockInstitutionalInvestorsBuySell|2823|2017-10-19|2017-10-19","TaiwanStockInstitutionalInvestorsBuySell|3060|2017-11-14|2017-11-14","TaiwanStockInstitutionalInvestorsBuySell|6504|2018-01-19|2018-01-19","TaiwanStockInstitutionalInvestorsBuySell|6504|2018-01-31|2018-01-31","TaiwanStockInstitutionalInvestorsBuySell|4401|2018-02-22|2018-02-22","TaiwanStockInstitutionalInvestorsBuySell|4401|2018-02-23|2018-02-23","TaiwanStockInstitutionalInvestorsBuySell|6504|2018-03-06|2018-03-06","TaiwanStockInstitutionalInvestorsBuySell|1304|2018-03-31|2018-03-31","TaiwanStockInstitutionalInvestorsBuySell|2062|2018-03-31|2018-03-31","TaiwanStockInstitutionalInvestorsBuySell|2545|2018-03-31|2018-03-31","TaiwanStockInstitutionalInvestorsBuySell|3022|2018-03-31|2018-03-31","TaiwanStockInstitutionalInvestorsBuySell|3060|2018-03-31|2018-03-31","TaiwanStockInstitutionalInvestorsBuySell|4401|2018-03-31|2018-03-31","TaiwanStockInstitutionalInvestorsBuySell|3060|2018-05-10|2018-05-10","TaiwanStockInstitutionalInvestorsBuySell|4401|2018-05-14|2018-05-14","TaiwanStockInstitutionalInvestorsBuySell|5478|2018-12-17|2018-12-17","TaiwanStockInstitutionalInvestorsBuySell|2062|2018-12-22|2018-12-22","TaiwanStockInstitutionalInvestorsBuySell|2401|2018-12-22|2018-12-22","TaiwanStockInstitutionalInvestorsBuySell|2485|2018-12-22|2018-12-22","TaiwanStockInstitutionalInvestorsBuySell|3022|2018-12-22|2018-12-22","TaiwanStockInstitutionalInvestorsBuySell|3042|2018-12-22|2018-12-22","TaiwanStockInstitutionalInvestorsBuySell|5009|2018-12-22|2018-12-22","TaiwanStockInstitutionalInvestorsBuySell|6279|2018-12-22|2018-12-22","TaiwanStockInstitutionalInvestorsBuySell|4960|2019-10-08|2019-10-08","TaiwanStockPrice|TAIEX|2015-12-01|2015-12-31","TaiwanStockPrice|2330|2024-01-02|2024-01-02"]);
export async function c30P3GapRoute(request, upstreamFetch=fetch){
 const reply=(status,body)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
 const u=new URL(request.url),origin=request.headers.get('origin');
 if(origin&&origin!==u.origin)return reply(403,{error:'cross_origin_rejected'});
 if(request.method!=='POST')return reply(405,{error:'post_required'});
 const names=['dataset','data_id','start_date','end_date'],vals=names.map(k=>u.searchParams.get(k)||'');
 if(!P3_ALLOWED.has(vals.join('|'))&&!(['TaiwanStockInstitutionalInvestorsBuySell|2330|2017-10-16|2017-10-16','TaiwanStockInstitutionalInvestorsBuySell|2330|2024-01-02|2024-01-02'].includes(vals.join('|'))))return reply(400,{error:'not_in_gap_manifest'});
 const auth=request.headers.get('authorization')||'';
 const token=auth.match(/^Bearer ([^\s]{1,4096})$/i)?.[1];
 if(auth.trim()&&auth.trim()!=='Bearer'&&!token)return reply(401,{error:'invalid_token_format'});
 if(u.searchParams.get('source')==='official')return officialGap(vals,upstreamFetch);
 const q=new URLSearchParams(names.map((k,i)=>[k,vals[i]]));
 let endpoint='https://api.finmindtrade.com/api/v4/data?'+q;
 try{
  let res;
  for(let i=0;i<3;i++){
   res=await upstreamFetch(endpoint,{headers:{Accept:'application/json',...(token?{Authorization:'Bearer '+token}:{})},redirect:'manual',signal:AbortSignal.timeout(40000)});
   if(![301,302,303,307,308].includes(res.status))break;
   const loc=res.headers.get('location');if(!loc)return reply(502,{error:'finmind_redirect_missing'});
   const dest=new URL(loc,endpoint);if(dest.origin!=='https://api.finmindtrade.com')return reply(502,{error:'finmind_external_redirect'});endpoint=dest.href;
  }
  if([301,302,303,307,308].includes(res.status))return reply(502,{error:'finmind_redirect_loop'});
  let raw;try{raw=await res.json()}catch{return reply(502,{error:'finmind_non_json'})}
  const s=Number(raw.status??res.status);if(!res.ok||s!==200){const code=[401,402,403,429].includes(s)?s:[401,402,403,429].includes(res.status)?res.status:502;return reply(code,{error:'finmind_request_failed',upstream_status:s});}
  if(!Array.isArray(raw.data))return reply(502,{error:'finmind_invalid_schema'});
  const data=raw.data.filter(r=>String(r.stock_id??r.data_id??'')===vals[1]&&String(r.date??'').slice(0,10)>=vals[2]&&String(r.date??'').slice(0,10)<=vals[3]);
  return reply(200,{status:200,data,received_rows:raw.data.length,matched_rows:data.length,returned_fields:Object.keys(raw.data[0]||{}).filter(k=>["stock_id","data_id","date","name","buy","sell","close","open","max","min"].includes(k)),source:"FinMind"});
 }catch(e){return reply(502,{error:e?.name==='TimeoutError'||e?.name==='AbortError'?'finmind_timeout':'finmind_connection_failed'})}
}

async function officialGap([dataset,stock,date,end],upstreamFetch){
 const out=(status,body)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
 const digits=date.replaceAll('-','');const isIndex=stock==='TAIEX';const isChip=dataset==='TaiwanStockInstitutionalInvestorsBuySell';
 if(!isIndex&&!isChip)return out(400,{error:'official_unsupported'});
 const sourceUrl=isIndex?'https://www.twse.com.tw/rwd/zh/TAIEX/MI_5MINS_HIST?response=json&date='+digits:'https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date='+digits+'&selectType=ALL';
 try{
 const r=await upstreamFetch(sourceUrl,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok)return out(502,{error:'official_http_'+r.status});const raw=await r.json();
 if(!Array.isArray(raw.fields)||!Array.isArray(raw.data)||!raw.data.length)return out(422,{error:'official_empty_or_invalid_report'});
 if(!String(raw.date||'').startsWith(isIndex?digits.slice(0,6):digits))return out(422,{error:'official_date_not_verified'});
 const fields=raw.fields.map(x=>String(x).replace(/\s/g,''));
 const num=v=>v===null||v===undefined||String(v).trim()===''||!/^[-+]?\d+(\.\d+)?$/.test(String(v).replaceAll(',','').trim())?NaN:Number(String(v).replaceAll(',','').trim());
 let rows=[],evidenceRows=[];
 if(isIndex){
 const i=fields.findIndex(x=>x==='日期'),o=fields.findIndex(x=>x.includes('開盤')),h=fields.findIndex(x=>x.includes('最高')),l=fields.findIndex(x=>x.includes('最低')),c=fields.findIndex(x=>x.includes('收盤'));
 if([i,o,h,l,c].some(x=>x<0))return out(422,{error:'official_index_fields_not_verified'});
 for(const v of raw.data){const m=String(v[i]).match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);if(!m)continue;const d=(Number(m[1])+1911)+'-'+m[2]+'-'+m[3];const [open,max,min,close]=[o,h,l,c].map(k=>num(v[k]));if(d>=date&&d<=end&&[open,max,min,close].every(x=>Number.isFinite(x)&&x>0)&&max>=Math.max(open,close,min)&&min<=Math.min(open,close,max)){rows.push({stock_id:stock,date:d,open,max,min,close});evidenceRows.push(v)}}
 }else{
 const i=fields.findIndex(x=>x==='證券代號');if(i<0)return out(422,{error:'official_stock_field_not_verified'});
 evidenceRows=raw.data.filter(v=>String(v[i]).trim()===stock);
 const groups=[['Foreign_Investor','外陸資買進股數(不含外資自營商)','外陸資賣出股數(不含外資自營商)'],['Investment_Trust','投信買進股數','投信賣出股數'],['Dealer_Hedging','自營商買進股數(避險)','自營商賣出股數(避險)'],['Dealer_self','自營商買進股數(自行買賣)','自營商賣出股數(自行買賣)'],['Foreign_Dealer_Self','外資自營商買進股數','外資自營商賣出股數']];
 if(evidenceRows.length===1){for(const [name,b,s] of groups){const bi=fields.indexOf(b),si=fields.indexOf(s);if(bi<0||si<0)continue;const buy=num(evidenceRows[0][bi]),sell=num(evidenceRows[0][si]);if(Number.isInteger(buy)&&buy>=0&&Number.isInteger(sell)&&sell>=0)rows.push({stock_id:stock,date,name,buy,sell})}}
 }
 return out(200,{status:200,data:rows,source:'TWSE',received_rows:raw.data.length,matched_rows:rows.length,official_evidence:{url:sourceUrl,date:raw.date,fields:raw.fields,rows:evidenceRows,report_rows:raw.data.length,stock_present:evidenceRows.length>0}});
 }catch{return out(502,{error:'official_connection_or_format_failed'})}
}
