const MINUTE=60000, OFFSET=8*3600000;
export const sessionTime=s=>Date.parse(s.replace(' ','T')+'+08:00');
export function validReplayBar(r,now){
 return r.contract_verified&&/^\d{6}$/.test(r.contract_date)&&
  ['open','high','low','close'].every(k=>Number.isInteger(r[k])&&r[k]>0)&&
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/.test(r.timestamp_tpe)&&sessionTime(r.timestamp_tpe)<=now;
}
// Exchange closing time is an exclusive bound. A day-session bar beginning
// 13:44 ends at 13:45; the night-session equivalent is 04:59 -> 05:00.
export function assessSession(target,records,now=Date.now()){
 const rr=records.filter(r=>r.session_key===target.key&&validReplayBar(r,now))
  .sort((a,b)=>a.timestamp_tpe.localeCompare(b.timestamp_tpe));
 const contracts=[...new Set(rr.map(r=>r.contract_date))];
 const first=rr[0],last=rr.at(-1),closed=now>=sessionTime(target.end);
 const official=rr.length>0&&rr.every(r=>/TAIFEX/.test(r.source));
 const vendorComplete=rr.length>0&&rr.every(r=>/^Yahoo WTX/.test(r.source)&&r.source_complete);
 const age=last?Math.max(0,(now-sessionTime(last.timestamp_tpe)-MINUTE)/MINUTE):null;
 const base={key:target.key,date:target.date,sid:target.sid,start:target.start,endsAt:target.end,
  marketState:closed?'closed':'trading',complete:closed,count:rr.length,contracts,
  last:last?.timestamp_tpe||null,source:official?'TAIFEX official ticks':first?.source||null,
  lastBarEndsAt:last?new Date(sessionTime(last.timestamp_tpe)+MINUTE+OFFSET).toISOString().slice(0,19).replace('T',' '):null,
  ageMinutes:age,historicalMissing:false,dataReady:false};
 const title=target.date+' '+(target.sid?'日盤':'夜盤');
 if(!rr.length)return {...base,dataState:closed?'missing':'pending',historicalMissing:closed,
  label:closed?'已收盤但資料缺失':'正在交易，等待當盤分鐘資料',
  reason:closed?title+' 已收盤但沒有可用分鐘資料':title+' 正在交易，當盤分鐘資料尚未取得'};
 if(contracts.length!==1||rr.some(r=>sessionTime(r.timestamp_tpe)<sessionTime(target.start)||sessionTime(r.timestamp_tpe)>=sessionTime(target.end)))
  return {...base,dataState:'invalid',label:closed?'已收盤，資料核對失敗':'正在交易，資料核對失敗',reason:title+' 合約或時段資料核對失敗'};
 if(first.timestamp_tpe!==target.start&&!official)return {...base,dataState:closed?'unverified':'pending',
  label:closed?'已收盤，開盤資料待核對':'正在交易，開盤資料待核對',reason:title+' 缺少可核實開盤分鐘'};
 if(closed){
  if(!official&&!vendorComplete)return {...base,dataState:'unverified',label:'已收盤，完整性待核對',reason:title+' 已收盤，資料完整性尚未核實'};
  return {...base,dataState:'complete',dataReady:true,label:'已完成交易盤次',reason:null};
 }
 if(age>3)return {...base,dataState:'stale',label:'正在交易，分鐘來源延遲',reason:title+' 正在交易，來源分鐘資料延遲 '+Math.floor(age)+' 分鐘'};
 return {...base,dataState:'updating',dataReady:true,label:'正在交易，分鐘資料持續更新',reason:null};
}
export function assessSessions(targets,records,now=Date.now()){
 const groups=new Map();for(const r of records){if(!groups.has(r.session_key))groups.set(r.session_key,[]);groups.get(r.session_key).push(r)}
 return targets.map(t=>assessSession(t,groups.get(t.key)||[],now));
}
export function positionPublication(ready,sessionStates){
 const positionConfirmed=!!ready;
 return {positionConfirmed,signalAllowed:positionConfirmed&&sessionStates.some(s=>s.marketState==='trading'&&s.dataReady),
  positionStatus:positionConfirmed?'confirmed':'unknown'};
}
