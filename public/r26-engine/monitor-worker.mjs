import {run,audit} from './engine.mjs';
import {replayLive,parseOfficialZip} from './live.mjs';
let base;
async function load(){
 if(base)return base;
 const mr=await fetch('/r26-engine/data/manifest.json.gz');if(!mr.ok)throw Error('金標索引下載失敗');
 const meta=await new Response(mr.body.pipeThrough(new DecompressionStream('gzip'))).json();
 const parts=await Promise.all(meta.compressedParts.map(async name=>{const rsp=await fetch('/r26-engine/data/'+name);if(!rsp.ok)throw Error('凍結資料下載失敗');return rsp.arrayBuffer()}));
 const packed=new Blob(parts);
 const raw=await new Response(packed.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),x=>x.toString(16).padStart(2,'0')).join('');
 if(hash!==meta.binarySha256)throw Error('凍結分K SHA256 不符');
 const bars=new Int32Array(raw),gold=audit(run(meta,bars,{end:meta.end}),meta);
 if(!gold.pass)throw Error('原版 2,428 盤金標驗證未通過');
 base={meta,bars,gold};return base;
}
self.onmessage=async({data:m})=>{try{
 if(m.type==='official'){const rows=await parseOfficialZip(m.buffer,m.date,m.contract);postMessage({type:'official',id:m.id,rows});return}
 const {meta,bars,gold}=await load();
 if(m.type==='replay')postMessage({type:'replay',id:m.id,gold,result:replayLive(meta,bars,m.rows,m.calendar,m.now||Date.now())});
}catch(e){postMessage({type:'error',id:m.id,error:e.message})}};
