// R26 research-only historical download planner. A session's trade-date can
// differ from the *physical calendar date* of its 15:00 night opening.
import {referenceTxMonth} from '../r26-data-sync.mjs';
export function pendingR26OfficialDownloads(sessions,records){
 if(!Array.isArray(sessions)||!Array.isArray(records))throw Error('R26_HISTORY_ARGUMENTS_INVALID');
 const jobs=new Map();
 for(const s of sessions){
  if(!s.complete||records.some(r=>r.session_key===s.key&&/TAIFEX/.test(String(r.source||''))))continue;
  const physicalDate=s.start.slice(0,10),monthlyContract=referenceTxMonth(s.date);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(physicalDate)||!/^\d{6}$/.test(monthlyContract))throw Error('R26_INVALID_PHYSICAL_DATE_OR_CONTRACT');
  const key=physicalDate+'|'+monthlyContract;
  if(!jobs.has(key))jobs.set(key,{date:physicalDate,contract:monthlyContract,trade_dates:[],sessions:[]});
  const j=jobs.get(key);j.trade_dates.push(s.date);j.sessions.push(s.key);
 }
 return [...jobs.values()];
}
export function physicalFinMindDates(date){
 const next=new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 return [date,next]; // Overnight 00:00-05:00 belongs to the next physical day.
}
