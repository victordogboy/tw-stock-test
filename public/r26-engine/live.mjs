import {run,audit,stop,simulate} from './engine.mjs';
const offset=8*3600000,dayms=86400000;
const tpe=ms=>new Date(ms+offset).toISOString().slice(0,19).replace('T',' ');
const ms=s=>Date.parse(s.replace(' ','T')+'+08:00');
const shift=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*dayms).toISOString().slice(0,10);
export function physicalSessions(calendar,after,now=Date.now()){
 const out=[];
 for(let i=1;i<calendar.length;i++){
  const d=calendar[i];if(d<=after)continue;
  for(const sid of [0,1]){
   const date=sid?d:calendar[i-1],start=date+(sid?' 08:45:00':' 15:00:00'),end=(sid?date:shift(date,1))+(sid?' 13:45:00':' 05:00:00');
   if(ms(start)>now)continue;
   out.push({date:d,sid,key:(sid?'day:':'night:')+date,start,end,complete:now>=ms(end)});
  }
 }
 return out;
}
export function mergeRecords(old,added){
 const priority=x=>/TAIFEX/.test(x.source)?3:/FinMind/.test(x.source)?2:1;
 const map=new Map(old.map(x=>[x.contract_date+'|'+x.timestamp_tpe,x]));
 const officialGroups=new Set(added.filter(x=>priority(x)===3).map(x=>x.contract_date+'|'+x.session_key));
 for(const [k,v] of map)if(officialGroups.has(v.contract_date+'|'+v.session_key)&&priority(v)<3)map.delete(k);
 for(const r of added){const key=r.contract_date+'|'+r.timestamp_tpe,prev=map.get(key);if(!prev||priority(r)>=priority(prev))map.set(key,r)}
 return [...map.values()].sort((a,b)=>a.timestamp_tpe.localeCompare(b.timestamp_tpe));
}
export function replayLive(meta,bars,records,calendar,now=Date.now()){
 const expected=physicalSessions(calendar,meta.end,now),issues=[],groups=new Map(),ss=meta.sessions.map(x=>({...x})),extra=[];
 for(const r of records){
  if(!r.contract_verified||!/^\d{6}$/.test(r.contract_date)||!['open','high','low','close'].every(k=>Number.isInteger(r[k])&&r[k]>0))continue;
  if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/.test(r.timestamp_tpe)||ms(r.timestamp_tpe)>now)continue;
  const key=r.contract_date+'|'+r.session_key;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);
 }
 for(const target of expected){
  const all=[...groups.entries()].filter(([k])=>k.endsWith('|'+target.key));
  // Preserve the frozen model's scheduled monthly rollover: reject mixed-contract sessions.
  if(all.length!==1){issues.push(target.date+' '+(target.sid?'日盤':'夜盤')+' '+(all.length?'合約混雜':'缺少分K'));break}
  const rr=all[0][1].sort((a,b)=>a.timestamp_tpe.localeCompare(b.timestamp_tpe)),official=rr.every(x=>/TAIFEX/.test(x.source));
  const first=rr[0],last=rr.at(-1);
  if(first.timestamp_tpe!==target.start&&!official){issues.push(target.key+' 缺少可核實開盤');break}
  if(target.complete&&!official&&!rr.every(x=>/^Yahoo WTX/.test(x.source)&&x.source_complete)){issues.push(target.key+' 尚待官方逐筆確認完整（不以分鐘根數猜測）');break}
  if(rr.some(r=>ms(r.timestamp_tpe)<ms(target.start)||ms(r.timestamp_tpe)>=ms(target.end))){issues.push(target.key+' 時段錯誤');break}
  const prev=ss.at(-1),p=(prev.offset+prev.count-1)*4+3,pclose=p<bars.length?bars[p]:extra[p-bars.length],cl=last.close;
  const session={...target,contract:first.contract_date,offset:(bars.length+extra.length)/4,count:rr.length,
   start:first.timestamp_tpe,end:last.timestamp_tpe,physical_end:target.end,partial:!target.complete,
   timestamps:rr.map(r=>r.timestamp_tpe),source:official?'TAIFEX official ticks':first.source,
   market:first.contract_date===prev.contract?cl-pclose:cl-first.open-5};
  for(const r of rr)extra.push(r.open,r.high,r.low,r.close);ss.push(session);
 }
 if(!expected.length||!calendar.some(d=>d>tpe(now).slice(0,10)))issues.push('交易日曆尚未涵蓋下一交易日');
 const combined=new Int32Array(bars.length+extra.length);combined.set(bars);combined.set(extra,bars.length);
 const result=run({...meta,sessions:ss},combined,{liquidate:false}),session=result.sessions.at(-1),row=result.rows.at(-1),last=ss.at(-1);
 const added=ss.length-meta.sessions.length;
 if(!added)issues.push('尚無新增盤可重播');
 const currentExpected=expected.at(-1);
 if(added&&currentExpected?.key!==last.key)issues.push('後續盤尚未接齊');
 const age=added?(now-ms(last.end))/60000:Infinity;
 if(added&&last.partial&&age>3)issues.push('當盤分鐘K已延遲 '+Math.floor(age)+' 分鐘');
 const shadow=simulate(result.sessions,combined,{shadow:true,reentry:false,liquidate:false}),i=result.sessions.length-1;
 const loss=shadow.pnls.slice(Math.max(0,i-2),i).reduce((a,b)=>a+b,0);
 const events=result.events.filter(e=>e.date===session.date&&e.sid===session.sid).map(e=>({...e,time:session.timestamps?.[e.bar]||session.start}));
 return {ready:issues.length===0,issues:[...new Set(issues)],added,session:{...session,timestamps:undefined,gold:undefined},row,
  events,stop:row.held?row.stop:null,shadowPreviousTwo:loss,ageMinutes:age,
  total:result.rows.reduce((a,r)=>a+r.pnl,0),newPnl:result.rows.filter(r=>r.date>meta.end).reduce((a,r)=>a+r.pnl,0),
  recent:result.rows.filter(r=>r.date>meta.end).slice(-10),as_of:added?last.end:null,
  nextSession:physicalSessions(calendar,meta.end,now+dayms*5).find(x=>ms(x.start)>now)||null};
}
let crcTable;
function crc32(bytes,crc=0xffffffff){crcTable??=Array.from({length:256},(_,i)=>{for(let j=0;j<8;j++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0});for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return crc>>>0}
export async function parseOfficialZip(buffer,tradeDate,contract){
 const bytes=new Uint8Array(buffer),v=new DataView(buffer);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break}
 if(end<0)throw Error('官方 ZIP 未下載完整');
 let ptr=v.getUint32(end+16,true),entry;
 const n=v.getUint16(end+10,true);
 for(let i=0;i<n;i++){
  if(v.getUint32(ptr,true)!==0x02014b50)throw Error('ZIP 目錄錯誤');
  const nl=v.getUint16(ptr+28,true),el=v.getUint16(ptr+30,true),cl=v.getUint16(ptr+32,true),name=new TextDecoder().decode(bytes.slice(ptr+46,ptr+46+nl));
  if(name.toLowerCase().endsWith('.csv'))entry={method:v.getUint16(ptr+10,true),crc:v.getUint32(ptr+16,true),compressed:v.getUint32(ptr+20,true),size:v.getUint32(ptr+24,true),at:v.getUint32(ptr+42,true)};
  ptr+=46+nl+el+cl;
 }
 if(!entry||entry.size>100000000||entry.method!==8)throw Error('官方 CSV 壓縮格式或大小錯誤');
 const p=entry.at+30+v.getUint16(entry.at+26,true)+v.getUint16(entry.at+28,true);
 const stream=new Blob([bytes.slice(p,p+entry.compressed)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
 const reader=stream.getReader(),decoder=new TextDecoder(),map=new Map();let tail='',crc=0xffffffff,size=0;
 function line(s){
  if(!/,TX\s*,/.test(s))return;const a=s.split(',').map(x=>x.trim());if(a[1]!=='TX'||a[2]!==contract)return;
  const date=a[0].slice(0,4)+'-'+a[0].slice(4,6)+'-'+a[0].slice(6),tm=a[3].padStart(6,'0'),m=+tm.slice(0,2)*60+ +tm.slice(2,4),day=m>=525&&m<825;
  if(!day&&m<900&&m>=300)return;const price=Number(a[4]),volume=Number(a[5])/2;if(!Number.isInteger(price)||price<=0||!Number.isFinite(volume)||volume<0)throw Error('官方逐筆價量不合法');
  const timestamp_tpe=date+' '+tm.slice(0,2)+':'+tm.slice(2,4)+':00',openDate=day||m>=900?date:shift(date,-1),key=(day?'day:':'night:')+openDate;
  const r=map.get(timestamp_tpe)||{timestamp_tpe,contract_date:contract,session:day?'day':'night',session_key:key,trade_date:tradeDate,
   open:price,high:price,low:price,close:price,volume:0,source:'TAIFEX official ticks',contract_verified:true};
  r.high=Math.max(r.high,price);r.low=Math.min(r.low,price);r.close=price;r.volume+=volume;map.set(timestamp_tpe,r);
 }
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;crc=crc32(value,crc);tail+=decoder.decode(value,{stream:true});const chunks=tail.split('\n');tail=chunks.pop();for(const s of chunks)line(s)}
 tail+=decoder.decode();if(tail)line(tail);
 if(size!==entry.size||((crc^0xffffffff)>>>0)!==entry.crc)throw Error('官方 CSV CRC 完整性校驗失敗');
 if(!map.size)throw Error('官方逐筆不含指定月份 TX');
 return [...map.values()].sort((a,b)=>a.timestamp_tpe.localeCompare(b.timestamp_tpe));
}
export {audit};
