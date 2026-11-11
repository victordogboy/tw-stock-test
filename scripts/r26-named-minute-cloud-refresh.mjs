// Cron-maintained public TX specified-month 1m. Zero FinMind secrets.
// Official daily archive always supersedes this lower-priority Yahoo cache.
import fs from 'node:fs';
import zlib from 'node:zlib';
import {mergeCloudSnapshot,validateCloudSnapshot} from '../public/r26-engine/cloud-minute-cache.mjs';
const target='public/r26-engine/data/verified-named-minute-cloud.json.gz';
const now=Date.now(),stamp=new Date(now+8*3600000).toISOString();
const date=stamp.slice(0,10),time=stamp.slice(11,16),weekday=new Date(Date.parse(date+'T00:00:00Z')).getUTCDay();
const minute=Number(time.slice(0,2))*60+Number(time.slice(3));
const active=((weekday>=1&&weekday<=5&&((minute>=525&&minute<825)||minute>=900))||
 (weekday>=2&&weekday<=6&&minute<300));
const d=Number(date.slice(8,10)),m=Number(date.slice(5,7)),y=Number(date.slice(0,4));
const first=new Date(Date.UTC(y,m-1,1)).getUTCDay();
const thirdWed=1+(3-first+7)%7+14;
let cm=m+(d>thirdWed?1:0),cy=y;if(cm>12){cm=1;cy++}
const contract=String(cy)+String(cm).padStart(2,'0');
if(!active){console.log('R26_CLOUD_PAUSED_OUTSIDE_MARKET',date,time);process.exit(0)}
const prior=fs.existsSync(target)?validateCloudSnapshot(
 JSON.parse(zlib.gunzipSync(fs.readFileSync(target))),now):null;
const root='https://tw-stock-api.victordogboy.workers.dev';
let payload,lastError='';
for(let i=0;i<3;i++){
 try{
  const rsp=await fetch(root+'/api/r26/intraday?contract='+contract,{
   cache:'no-store',signal:AbortSignal.timeout(22000),
   headers:{accept:'application/json'}});
  if(!rsp.ok)throw Error('HTTP_'+rsp.status);
  const x=await rsp.json();
  if(x.ok!==true||x.contract!==contract||!Array.isArray(x.data))throw Error('NAMED_MONTH_NOT_VERIFIED');
  payload=x;break;
 }catch(e){lastError=String(e?.message||e);console.log('R26_CLOUD_FETCH_RETRY',i,lastError);
  await new Promise(r=>setTimeout(r,1500*(i+1)))}
}
if(!payload){
 console.log('R26_CLOUD_SOURCE_UNAVAILABLE_RETAIN_OLD',lastError);
 // No fabricated bars: preserve the last valid asset and report a source error.
 process.exit(0);
}
const latest=payload.data.at(-1)?.timestamp_tpe;
if(!latest)throw Error('R26_NAMED_MONTH_EMPTY');
const localNow=Date.parse(latest.replace(' ','T')+'+08:00')+60000;
if(!Number.isFinite(localNow)||now-localNow>12*60000)
 {console.log('R26_CLOUD_VENDOR_STALE_RETAIN_OLD',latest);process.exit(0)}
const next=mergeCloudSnapshot(prior,payload,now);
if(prior?.latest_timestamp_tpe===next.latest_timestamp_tpe&&
 prior?.latest_contract===next.latest_contract&&prior.rows.length===next.rows.length){
 console.log('R26_CLOUD_UNCHANGED',next.latest_timestamp_tpe);process.exit(0)
}
const gz=zlib.gzipSync(Buffer.from(JSON.stringify(next)),{level:9});
fs.writeFileSync(target+'.tmp',gz);fs.renameSync(target+'.tmp',target);
console.log('R26_CLOUD_UPDATED',JSON.stringify({
 contract,latest:next.latest_timestamp_tpe,previous:prior?.latest_timestamp_tpe||null,
 bars:next.rows.length,bytes:gz.length,generated_at:next.generated_at,
 source:next.source}));
