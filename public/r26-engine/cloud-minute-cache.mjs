// R26 independent public minute-cloud snapshot. This is an immutable research
// record, not a trade execution feed. Token-free, strictly named TX contract.
const DATE_TIME=/^20\d{2}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:00$/;
const MONTH=/^20\d{2}(0[1-9]|1[0-2])$/;
const asMs=s=>Date.parse(s.replace(' ','T')+'+08:00');
export const R26_MINUTE_CLOUD_VERSION='R26_NAMED_TX_MINUTE_CACHE_V1';
export function validCloudBar(row,now=Date.now()){
 if(!row||!MONTH.test(String(row.contract_date||''))||
    !DATE_TIME.test(String(row.timestamp_tpe||''))||
    !['day','night'].includes(row.session)||
    !/^(day|night):20\d{2}-\d{2}-\d{2}$/.test(String(row.session_key||''))||
    !String(row.session_key).startsWith(row.session+':')||
    row.contract_verified!==true||
    !/^Yahoo WT[X][FGHJKMNQUVXZ]\d$/.test(String(row.source||'')))return false;
 const ms=asMs(row.timestamp_tpe);
 if(!Number.isFinite(ms)||ms>now+90000)return false;
 const nums=[row.open,row.high,row.low,row.close].map(Number);
 const [o,h,l,c]=nums;
 if(!nums.every(Number.isFinite)||l<1000||h>200000||
    h<Math.max(o,c)||l>Math.min(o,c))return false;
 const date=row.timestamp_tpe.slice(0,10),min=Number(row.timestamp_tpe.slice(11,13))*60+Number(row.timestamp_tpe.slice(14,16));
 const day=min>=525&&min<825;
 const night=min>=900||min<300;
 if(!day&&!night||row.session!==(day?'day':'night'))return false;
 const physicalOpen=day||min>=900?date:new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 return row.session_key===(day?'day:':'night:')+physicalOpen;
}
export function validateCloudSnapshot(snapshot,now=Date.now()){
 if(snapshot?.version!==R26_MINUTE_CLOUD_VERSION||
    !Array.isArray(snapshot.rows)||snapshot.rows.length>15000||
    !snapshot.rows.every(r=>validCloudBar(r,now))||
    !/^20\d{2}-\d{2}-\d{2}T/.test(String(snapshot.generated_at||'')))
  throw Error('R26_CLOUD_NAMED_MINUTE_SNAPSHOT_INVALID');
 if(snapshot.rows.length&&snapshot.latest_timestamp_tpe!==snapshot.rows.at(-1).timestamp_tpe)
  throw Error('R26_CLOUD_NAMED_MINUTE_TIMESTAMP_MISMATCH');
 return snapshot;
}
export function mergeCloudSnapshot(prior,feed,now=Date.now()){
 const contract=String(feed?.contract||'');
 if(!MONTH.test(contract)||!Array.isArray(feed?.data)||!feed.data.length||
    feed.data.some(r=>r.contract_date!==contract||!validCloudBar(r,now)))
  throw Error('R26_NEW_NAMED_TX_MINUTE_FEED_INVALID');
 let old=[];
 if(prior){validateCloudSnapshot(prior,now);old=prior.rows;}
 const cutoff=now-9*86400000,map=new Map();
 for(const x of [...old,...feed.data]){
  if(asMs(x.timestamp_tpe)>=cutoff){
   const key=x.contract_date+'|'+x.timestamp_tpe;
   map.set(key,{timestamp_tpe:x.timestamp_tpe,contract_date:x.contract_date,
    session:x.session,session_key:x.session_key,open:x.open,high:x.high,
    low:x.low,close:x.close,volume:x.volume,source:x.source,
    contract_verified:true,time_convention:x.time_convention,
    source_retrieved_at:x.source_retrieved_at});
  }
 }
 const rows=[...map.values()].sort((a,b)=>a.timestamp_tpe.localeCompare(b.timestamp_tpe)||a.contract_date.localeCompare(b.contract_date));
 if(rows.length>15000)rows.splice(0,rows.length-15000);
 return {version:R26_MINUTE_CLOUD_VERSION,generated_at:new Date(now).toISOString(),
  contract,latest_timestamp_tpe:rows.at(-1)?.timestamp_tpe||null,
  latest_contract:rows.at(-1)?.contract_date||null,
  source:'Yahoo named monthly TX via R26 Cloudflare API (minute-start, not ticks)',
  rows};
}
