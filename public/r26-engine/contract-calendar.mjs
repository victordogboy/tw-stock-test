import {TAIFEX_2026_CLOSED} from './calendar-2026.mjs';

const shift=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const weekday=date=>new Date(date+'T00:00:00Z').getUTCDay();
const regular=date=>weekday(date)>0&&weekday(date)<6&&!TAIFEX_2026_CLOSED.has(date);
export function settlementDate(date){
 const [year,month]=date.split('-').map(Number);
 const first=new Date(Date.UTC(year,month-1,1)).getUTCDay();
 let d=date.slice(0,7)+'-'+String(1+(3-first+7)%7+14).padStart(2,'0');
 while(!regular(d))d=shift(d,1);
 return d;
}
// Frozen R26 rolls the entire expiry *trade date* to the next month, i.e.
// the preceding physical night opens the new contract. The expiring contract
// has only 285 daytime bars; it is NOT the model's settlement-day input.
export function referenceTxMonth(tradeDate){
 let [y,m]=tradeDate.split('-').map(Number);
 if(tradeDate>=settlementDate(tradeDate)){if(++m===13){m=1;y++}}
 return String(y)+String(m).padStart(2,'0');
}
export function activeTxMonth(now=Date.now(),calendar=[]){
 const t=new Date(Number(now)+8*3600000).toISOString();
 let date=t.slice(0,10);
 if(Number(t.slice(11,13))>=15)date=shift(date,1);
 const tradeDate=calendar.find(d=>d>=date);
 if(tradeDate)return referenceTxMonth(tradeDate);
 while(!regular(date))date=shift(date,1);
 return referenceTxMonth(date);
}
// A whole official CRC-checked trade-date ZIP must contain the model's full
// 300-minute day AND the preceding night. Sparse next-month night trading is
// genuine; don't synthesize empty minutes or impose a 750-bar liquidity floor.
export function officialCoverage(date,contract,rows,calendar=[]){
 if(contract!==referenceTxMonth(date))throw Error('R26_WRONG_ROLL_CONTRACT '+date+' '+contract);
 const prior=calendar[calendar.indexOf(date)-1];
 const unique=new Set(),night=[],day=[];
 for(const r of rows){
  const t=r.timestamp_tpe,key=r.session_key;
  if(r.trade_date!==date||r.contract_date!==contract||r.source!=='TAIFEX official ticks'||r.contract_verified!==true||
   !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/.test(t)||unique.has(t))throw Error('R26_OFFICIAL_ROW_INVALID '+date);
  unique.add(t);
  if(r.session==='day'&&key==='day:'+date&&t>=date+' 08:45:00'&&t<date+' 13:45:00')day.push(r);
  else if(r.session==='night'&&key.startsWith('night:')){
   const p=key.slice(6);
   if((prior&&p!==prior)||p>=date||t<p+' 15:00:00'||t>=shift(p,1)+' 05:00:00')throw Error('R26_OFFICIAL_NIGHT_WRONG_DATE '+date);
   night.push(r);
  }else throw Error('R26_OFFICIAL_SESSION_INVALID '+date);
 }
 if(day.length!==300||!night.length||night.length>840||new Set(night.map(r=>r.session_key)).size!==1)
  throw Error('Invalid official session coverage night='+night.length+' day='+day.length+' TX'+contract);
 return {night:night.length,day:day.length};
}
