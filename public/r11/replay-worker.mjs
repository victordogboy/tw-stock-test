import {nextCoreState} from './next-core.mjs';
import {replayP40,nextP193State} from './p40-replay.mjs';
import {appendReplayInput} from './replay-input.mjs';
import {run,audit} from '../r26-engine/engine.mjs';
import {parseOfficialZip} from '../r26-engine/live.mjs';
let base;
async function jsonGzip(url){const r=await fetch(url);if(!r.ok)throw Error('資料下載失敗 '+r.status);return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json()}
async function load(){
 if(base)return base;
 const meta=await jsonGzip('/r26-engine/data/manifest.json.gz');
 const parts=await Promise.all(meta.compressedParts.map(async name=>{const r=await fetch('/r26-engine/data/'+name);if(!r.ok)throw Error('原版資料下載失敗');return r.arrayBuffer()}));
 const raw=await new Response(new Blob(parts).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),n=>n.toString(16).padStart(2,'0')).join('');
 if(sha!==meta.binarySha256)throw Error('原版分鐘資料 SHA256 不符');
 const bars=new Int32Array(raw),gold=audit(run(meta,bars,{end:meta.end}),meta);
 if(!gold.pass)throw Error('R26 原版歷史核對失敗');
 const p40=replayP40(meta,bars,{end:meta.end,liquidate:true});
 if(p40.p40.rows.length!==2428||p40.p40.rows.reduce((s,r)=>s+r.pnl,0)!==71601||p40.p40.minuteDD!==4656)throw Error('P40 原版歷史核對失敗');
 const recent=await jsonGzip('/r26-engine/data/recent.json.gz');
 base={meta,bars,recent};return base;
}
self.onmessage=async({data:m})=>{
 const progress=text=>postMessage({type:'progress',text});
 try{
  progress('載入原始資料並核對 R26／P40 歷史結果…');
  const {meta,bars,recent}=await load();let records=[...recent.rows,...(m.rows||[])],failures=[];
  const today=new Date((m.now||Date.now())+8*3600000).toISOString().slice(0,10);
  const lastSeedDay=recent.rows.filter(r=>r.session==='day').at(-1)?.trade_date||meta.end;
  // Current session data are never manufactured; official completed dates only.
  if(m.fetchOfficial){
   const hour=new Date((m.now||Date.now())+8*3600000).getUTCHours();
   const dates=recent.calendar.filter(d=>d>lastSeedDay&&(d<today||(d===today&&hour>=17)));
   if(dates.length>35)throw Error('封存截止已超過官方35日下載範圍，請先補齊歷史分鐘K');
   for(const date of dates){
    if(records.some(r=>r.trade_date===date&&r.session==='day'&&r.source==='TAIFEX official ticks'))continue;
    progress('下載期交所 '+date+'，核對 ZIP 完整性並轉成分鐘K…');
    try{
     const r=await fetch('/api/r26/official-zip?'+new URLSearchParams({date,contract:'202611'}));
     if(!r.ok)throw Error('HTTP '+r.status);
     const rows=await parseOfficialZip(await r.arrayBuffer(),date,'202611',{maxUncompressedBytes:150000000});
     records.push(...rows);postMessage({type:'cache',id:'official:202611:'+date,rows});
    }catch(e){failures.push(date+': '+e.message);break;}
   }
  }
  progress('逐盤重播 A 影子策略、P40 與 P193 權重…');
  const input=appendReplayInput(meta,bars,records,recent.calendar,m.now||Date.now());
  const result=replayP40(input.meta,input.bars,{liquidate:false}),last=result.p40.rows.at(-1);
  const target=last.sid===0?{trade_date:last.date,session:'day'}:{trade_date:recent.calendar.find(d=>d>last.date),session:'night'};
  const next=target.trade_date?nextP193State(result,target):null;
  postMessage({type:'result',result:{version:result.version,paper_only:true,tradeable:false,
   historical_sessions:2428,added_sessions:input.accepted.length,last_date:last.date,last_session:last.sid?'day':'night',
   rows:result.p40.rows.filter(r=>r.date>meta.end),next,next_core:next?nextCoreState(result,target):null,issues:[...input.issues,...failures],
   new_p40_pnl:result.p40.rows.filter(r=>r.date>meta.end).reduce((s,r)=>s+r.pnl,0)}});
 }catch(e){postMessage({type:'error',error:e.message})}
};
