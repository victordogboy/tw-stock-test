// Build a public, reproducible and credential-free R26 TX official minute archive.
// Each accepted source is a TAIFEX CSV ZIP parsed with size and CRC validation.
// The derived archive holds only public minute OHLC, NO FinMind token or account info.
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {parseOfficialZip} from '../public/r26-engine/live.mjs';
import {extendTaifexCalendar2026} from '../public/r26-engine/calendar-2026.mjs';
import {referenceTxMonth,officialCoverage} from '../public/r26-engine/contract-calendar.mjs';
const ROOT='public/r26-engine/data/';
const DEST=ROOT+'verified-official-backfill.json.gz';
const TMP=ROOT+'verified-official-backfill.tmp';
const rootURL='https://tw-stock-api.victordogboy.workers.dev';
const seed=JSON.parse(zlib.gunzipSync(fs.readFileSync(ROOT+'recent.json.gz')));
const cal=extendTaifexCalendar2026(seed.calendar);
const localNow=new Date(Date.now()+8*3600000);
const today=localNow.toISOString().slice(0,10);
const hh=Number(localNow.toISOString().slice(11,13));
const lastEligible=hh>=14?today:new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10);
const days=cal.filter(d=>d>'2026-10-22'&&d<=lastEligible);
const prior=fs.existsSync(DEST)?JSON.parse(zlib.gunzipSync(fs.readFileSync(DEST))):null;
const known=new Map();
if(prior?.version==='R26_TAIFEX_BACKFILL_V1'&&Array.isArray(prior?.sessions)&&Array.isArray(prior?.rows)){
 const byDate=new Map();
 for(const row of prior.rows){if(!byDate.has(row.trade_date))byDate.set(row.trade_date,[]);byDate.get(row.trade_date).push(row)}
 for(const x of prior.sessions){
  try{const saved=byDate.get(x.date)||[],coverage=officialCoverage(x.date,x.contract,saved,cal);
   if(x.day===coverage.day&&x.night===coverage.night)known.set(x.date,{meta:x,rows:saved});
  }catch(e){console.log('R26_INVALID_CACHED_DAY',x.date,e.message)}
 }
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function attemptFetch(date,contract){
 const tail='Daily_'+date.replaceAll('-','_')+'.zip';
 const urls=[
  rootURL+'/api/r26/official-zip?date='+date+'&contract='+contract,
  'https://www.taifex.com.tw/file/taifex/Dailydownload/DailydownloadCSV/'+tail
 ];
 let error='';
 for(let round=0;round<3;round++){
  for(const u of urls){
   try{
    const rsp=await fetch(u,{headers:{'accept':'application/zip'},signal:AbortSignal.timeout(30000)});
    if(!rsp.ok)throw Error('HTTP '+rsp.status);
    const bytes=await rsp.arrayBuffer();
    const buf=new Uint8Array(bytes);
    if(buf.length<150||buf[0]!==0x50||buf[1]!==0x4b)throw Error('Invalid official ZIP signature');
    const rows=await parseOfficialZip(bytes,date,contract);
    const {night,day}=officialCoverage(date,contract,rows,cal);
    return {rows,meta:{date,contract,day,night,zip_bytes:bytes.byteLength,
      zip_sha256:crypto.createHash('sha256').update(buf).digest('hex')}};
   }catch(e){error=String(e?.message||e);console.log('R26_SOURCE_RETRY',date,round,u.includes('workers.dev')?'relay':'exchange',error)}
  }
  await pause(1000*(round+1));
 }
 throw Error(error);
}
const sessions=[],rows=[],failures=[];
for(const date of days){
 const contract=referenceTxMonth(date);
 let entry=known.get(date);
 if(entry&&entry.meta.contract!==contract)entry=null;
 if(!entry){
  try{entry=await attemptFetch(date,contract)}
  catch(e){failures.push({date,error:String(e?.message||e)});break}
 }
 sessions.push(entry.meta);rows.push(...entry.rows);
 console.log('R26_VERIFIED_DAY',date,'night',entry.meta.night,'day',entry.meta.day,'contract',contract);
}
if(sessions.length){
 if(prior?.last_complete_trade_day===sessions.at(-1).date &&
    prior.sessions.length===sessions.length &&
    prior.rows.length===rows.length &&
    prior.sessions.every((x,i)=>x.date===sessions[i].date&&x.day===sessions[i].day&&x.night===sessions[i].night)){
  console.log('R26_ARCHIVE_UNCHANGED',JSON.stringify({last_complete_trade_day:prior.last_complete_trade_day,
    verified_days:prior.sessions.length,failures}));
  process.exit(0);
 }
 const data={version:'R26_TAIFEX_BACKFILL_V1',source:'TAIFEX public official daily tick ZIP verified by CRC',
  generated_at:new Date().toISOString(),last_complete_trade_day:sessions.at(-1).date,
  sessions,rows};
 const json=JSON.stringify(data),hash=crypto.createHash('sha256').update(json).digest('hex');
 fs.writeFileSync(TMP,zlib.gzipSync(Buffer.from(json),{level:9}));
 fs.renameSync(TMP,DEST);
 console.log('R26_ARCHIVE_READY',JSON.stringify({through:data.last_complete_trade_day,days:sessions.length,
  bars:rows.length,bytes:fs.statSync(DEST).size,json_sha256:hash,failures}));
}else{
 console.log('R26_ARCHIVE_NOT_READY',JSON.stringify({days:days.length,failures}));
 process.exitCode=2;
}
