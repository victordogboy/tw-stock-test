// Published TAIFEX 2026 trading calendar with the Oct 23 emergency closure.
// Scheduled days do not prove a live market session actually opened.
// Sources: TAIFEX 2026 Holiday Schedule, TAIFEX 2026-10-22 typhoon closure notice.
export const R26_CALENDAR_VERSION='20261111-taifex-2026-physical-session';
export const TAIFEX_2026_CLOSED=new Set([
 '2026-01-01','2026-02-12','2026-02-13','2026-02-16','2026-02-17',
 '2026-02-18','2026-02-19','2026-02-20','2026-02-27','2026-04-03',
 '2026-04-06','2026-05-01','2026-06-19','2026-09-25','2026-09-28',
 '2026-10-09','2026-10-23','2026-10-26','2026-12-25'
]);
export function extendTaifexCalendar2026(seed){
 if(!Array.isArray(seed)||seed.some(d=>typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)))
  throw Error('R26 seed trading calendar invalid');
 const dates=new Set(seed.filter(d=>d<='2026-12-31'&&!TAIFEX_2026_CLOSED.has(d)));
 const end=Date.parse('2026-12-31T00:00:00Z');
 for(let ms=Date.parse('2026-10-22T00:00:00Z');ms<=end;ms+=86400000){
  const day=new Date(ms).getUTCDay(),d=new Date(ms).toISOString().slice(0,10);
  if(day!==0&&day!==6&&!TAIFEX_2026_CLOSED.has(d))dates.add(d);
 }
 return [...dates].sort();
}
