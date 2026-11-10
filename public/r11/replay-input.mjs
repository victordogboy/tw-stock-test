// Append completed, contiguous sessions only. Missing sessions stop the replay.
// Source completeness is separate from trade permission: all outputs remain paper-only.
import {physicalSessions} from '../r26-engine/live.mjs';
export function appendReplayInput(meta,bars,records,calendar,now=Date.now()){
 const targets=physicalSessions(calendar,meta.end,now),targetKeys=new Set(targets.map(s=>s.key)),groups=new Map(),errors=[];
 for(const r of records){
  if(!/^20\d\d-\d\d-\d\d \d\d:\d\d:00$/.test(r.timestamp_tpe||''))continue;
  const t=Date.parse(r.timestamp_tpe.replace(' ','T')+'+08:00'),clock=r.timestamp_tpe.slice(11,16),m=60*Number(clock.slice(0,2))+Number(clock.slice(3));
  const day=m>=525&&m<825,night=m>=900||m<300;if(!day&&!night)continue;
  const date=r.timestamp_tpe.slice(0,10),openDate=day||m>=900?date:new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10),key=(day?'day:':'night:')+openDate;
  if(!targetKeys.has(key))continue;
  if(!groups.has(key))groups.set(key,new Map());
  const map=groups.get(key),k=r.contract_date+'|'+r.timestamp_tpe,prev=map.get(k);
  const official=x=>x?.source==='TAIFEX official ticks'&&x.contract_verified===true;
  if(prev&&official(prev)&&!official(r))continue;
  if(prev&&!official(prev)&&official(r)){map.set(k,{...r,t});continue;}
  if(prev&&['open','high','low','close'].some(x=>prev[x]!==r[x]))errors.push('CONFLICTING_MINUTE:'+k);
  else map.set(k,{...r,t});
 }
 const sessions=meta.sessions.map(s=>({...s})),extra=[],accepted=[],issues=[];
 if(errors.length)return {meta,bars,accepted,issues:errors,tradeable:false};
 for(const target of targets){
  if(!target.complete){issues.push('SESSION_NOT_CLOSED:'+target.date+'|'+target.sid);break;}
  const rr=[...(groups.get(target.key)?.values()||[])].sort((a,b)=>a.t-b.t);
  const contracts=[...new Set(rr.map(r=>r.contract_date))];
  if(!rr.length){issues.push('MISSING_SESSION:'+target.key);break;}
  if(contracts.length!==1||contracts[0]!==sessions.at(-1).contract){issues.push('CONTRACT_ROLL_UNVERIFIED:'+target.key);break;}
  if(rr.some(r=>!['open','high','low','close'].every(k=>Number.isInteger(r[k])&&r[k]>0)||r.high<Math.max(r.open,r.close)||r.low>Math.min(r.open,r.close))){issues.push('INVALID_OHLC:'+target.key);break;}
  const start=Date.parse(target.start.replace(' ','T')+'+08:00'),end=Date.parse(target.end.replace(' ','T')+'+08:00');
  const official=rr.every(r=>r.source==='TAIFEX official ticks'&&r.contract_verified===true);
  const full=rr.length===(target.sid?300:840)&&rr.every((r,i)=>r.t===start+i*60000);
  if(rr.some(r=>r.t<start||r.t>=end)||(!official&&!full)){issues.push('INCOMPLETE_SESSION:'+target.key);break;}
  const previous=sessions.at(-1),lastIndex=(previous.offset+previous.count-1)*4+3,previousClose=lastIndex<bars.length?bars[lastIndex]:extra[lastIndex-bars.length];
  const s={...target,contract:contracts[0],offset:(bars.length+extra.length)/4,count:rr.length,start:rr[0].timestamp_tpe,end:rr.at(-1).timestamp_tpe,market:rr.at(-1).close-previousClose};
  for(const r of rr)extra.push(r.open,r.high,r.low,r.close);
  sessions.push(s);accepted.push({date:s.date,sid:s.sid,count:s.count,source:official?'TAIFEX official ticks':'complete minute grid'});
 }
 const combined=new Int32Array(bars.length+extra.length);combined.set(bars);combined.set(extra,bars.length);
 return {meta:{...meta,sessions},bars:combined,accepted,issues,tradeable:false};
}
