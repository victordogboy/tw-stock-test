// R26 official ZIP uses TRADE-DATE naming, not physical tick date.
// Empirically verified: Daily_2026_11_10.zip contains night:2026-11-09
// and day:2026-11-10; Daily_2026_10_27.zip contains the Oct22 holiday night.
// FinMind minute queries use actual calendar days instead.
import {referenceTxMonth} from '../r26-data-sync.mjs';
export function physicalFinMindDates(date){
 const next=new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 return [date,next];
}
export function pendingR26OfficialDownloads(sessions,records){
 if(!Array.isArray(sessions)||!Array.isArray(records))throw Error('R26_HISTORY_ARGUMENTS_INVALID');
 const jobs=new Map();
 for(const s of sessions){
  if(!s.complete||records.some(r=>r.session_key===s.key&&/TAIFEX/.test(String(r.source||''))))continue;
  const tradeDate=s.date,physicalDate=s.start.slice(0,10),monthlyContract=referenceTxMonth(tradeDate);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(physicalDate)||!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)||
     !/^\d{6}$/.test(monthlyContract))throw Error('R26_INVALID_TRADE_DATE_OR_CONTRACT');
  const key=tradeDate+'|'+monthlyContract;
  if(!jobs.has(key))jobs.set(key,{date:tradeDate,contract:monthlyContract,sessions:[],physical_dates:[],finmind_dates:[]});
  const j=jobs.get(key);
  j.sessions.push(s.key);j.physical_dates.push(physicalDate);
  j.finmind_dates.push(...(s.sid===0?physicalFinMindDates(physicalDate):[physicalDate]));
 }
 return [...jobs.values()].map(j=>({...j,physical_dates:[...new Set(j.physical_dates)].sort(),
  finmind_dates:[...new Set(j.finmind_dates)].sort()}));
}
