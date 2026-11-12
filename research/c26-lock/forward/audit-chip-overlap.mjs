/** Read FinMind private raw source in GitHub Actions runner; emit only sanitized
 * comparison of 5d foreign/trust ratios versus the original C26 frozen F5/T5.
 * Does NOT use source data after a signal date and does NOT publish buy/sell.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const REF='research/c26-lock/forward/archive-feature-reference.json';
const PRIVATE='.c26-private/forward-eod.json.gz';
const PUBLIC='public/r1494a/c26/data/forward-chip-parity.json';
export function groupInstitution(name){
 const v=String(name||'').trim().toLowerCase();
 if(/trust|投信/.test(v))return 'trust';
 if(/foreign|外資|陸資/.test(v)&& !/^外資自營商$/.test(v)&& !/foreign.?dealer|dealer.*foreign/.test(v))return 'foreign';
 return null;
}
export function netInstitution(rows,group){
 let total=0,any=false;
 for(const r of rows||[]){if(groupInstitution(r.name)!==group)continue;
  const buy=Number(r.buy),sell=Number(r.sell);
  if(!Number.isFinite(buy)||!Number.isFinite(sell))return null;
  total+=buy-sell;any=true;
 }
 return any?total:null;
}
const clip=x=>Math.max(-.5,Math.min(.5,x));
export function ratio5(days,dates,id,kind){
 const i=dates.indexOf(id);if(i<4)return null;
 let totalVol=0,totalNet=0;
 for(const date of dates.slice(i-4,i+1)){
  const day=days[date];if(!day||day.source_state!=='available')return null;
  const stock=day.price.find(x=>String(x.stock_id)===kind.stockId);
  if(!stock||!stock.valid||!(stock.volume>0))return null;
  const rows=day.institutional.filter(x=>String(x.stock_id)===kind.stockId);
  const net=netInstitution(rows,kind.field);
  if(net===null)return null;
  totalVol+=stock.volume;totalNet+=net;
 }
 return totalVol>0?clip(totalNet/totalVol):null;
}
export function audit(reference,source){
 const dates=Object.keys(source.days).sort(),results=[];
 if(reference.lock_id!==source.lock_id||reference.pool_sha256!==source.pool_sha256)throw Error('C26 source vs frozen feature reference mismatch');
 for(const date of dates){const factors=reference.days?.[date];if(!factors)continue;const idx=dates.indexOf(date);if(idx<4)continue;
  const counts={date,all:0,exact1e5:0,exact1e3:0,not_comparable:0,bad_gt_1e3:0,largest_error:0};
  for(const field of ['F5','T5'])for(let j=0;j<reference.codes.length;j++){
   const actual=factors[field][j];if(actual===null)continue;
   const reconstructed=ratio5(source.days,dates,date,{stockId:reference.codes[j],field:field==='F5'?'foreign':'trust'});
   if(reconstructed===null){counts.not_comparable++;continue}
   const abs=Math.abs(Number(actual)-reconstructed);counts.all++;
   if(abs<=1e-5)counts.exact1e5++;
   if(abs<=1e-3)counts.exact1e3++;else counts.bad_gt_1e3++;
   counts.largest_error=Math.max(counts.largest_error,abs);
  }
  results.push(counts);
 }
 return {lock_id:reference.lock_id,source_as_of:dates.at(-1)||null,
  archive_end:'2026-10-27',factors:['F5','T5'],results,
  strict_all_1e5:results.length>0&&results.every(r=>r.not_comparable===0&&r.bad_gt_1e3===0&&r.exact1e5===r.all),
  raw_public:false,latest_c26_positions_verified:false,trade_plan:'BLOCKED'};
}
if(process.argv[1]&&process.argv[1].endsWith('audit-chip-overlap.mjs')){
 if(!fs.existsSync(PRIVATE))throw Error('C26 private forward data missing: run FinMind stage first');
 const ref=JSON.parse(fs.readFileSync(REF,'utf8'));
 const raw=JSON.parse(gunzipSync(fs.readFileSync(PRIVATE)));
 const output=audit(ref,raw);
 fs.writeFileSync(PUBLIC,JSON.stringify(output,null,2)+'\n');
 console.log('C26_F5_T5_OVERLAP_AUDIT',JSON.stringify(output.results));
 console.log('C26_F5_T5_PARITY_REQUIRED',output.strict_all_1e5?'passed':'not yet exact (C26 live still BLOCKED)');
}