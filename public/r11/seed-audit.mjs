// R11 seed audit: import archived P40/R26 2428-session historical state only.
// Never accept a seed as evidence of new live P40/R26 signal calculation.
const isNum=n=>typeof n==='number'&&Number.isFinite(n);
const dateOk=s=>/^20\d{2}-\d{2}-\d{2}$/.test(s||'');
const keys=['i','date','session','atr20','core','p40_pnl','market_move','r26_pnl'];
export function auditR11Seed(seed){
 const errors=[],rows=seed?.sessions,meta=seed?.manifest;
 if(meta?.schema!=='R11_CAUSAL_SEED_V1')errors.push('INVALID_SCHEMA');
 if(!Array.isArray(rows)||rows.length!==2428)errors.push('HISTORICAL_2428_SESSIONS_REQUIRED');
 if(meta?.sessions!==2428)errors.push('MANIFEST_SESSION_COUNT_MISMATCH');
 if(!meta?.verified_date_and_atr_alignment)errors.push('ORIGINAL_ARCHIVE_ALIGNMENT_UNVERIFIED');
 if(!Array.isArray(rows))return {ok:false,errors,tradeable:false};
 const seen=new Set();let prev='';
 for(let i=0;i<rows.length;i++){
  const r=rows[i];
  if(keys.some(k=>r?.[k]===undefined)||r?.i!==i||!dateOk(r.date)||
    !['day','night'].includes(r.session)||!isNum(r.atr20)||r.atr20<=0||
    ![-1,0,1].includes(r.core)||!['p40_pnl','market_move','r26_pnl'].every(k=>isNum(r[k]))){
   errors.push('INVALID_SESSION_'+i);break;
  }
  const key=r.date+'|'+r.session;
  if(seen.has(key)||r.date<prev){errors.push('DUPLICATE_OR_UNSORTED_SESSION_'+i);break;}
  seen.add(key);prev=r.date;
 }
 if(rows[0]?.date!=='2021-10-22'||rows.at(-1)?.date!=='2026-10-22')errors.push('ARCHIVE_CUTOFF_MISMATCH');
 return {ok:errors.length===0,errors,tradeable:false,paper_only:true,
   sessions:rows.length,first:rows[0]?.date,last:rows.at(-1)?.date,
   historical_p40_pnl_total:rows.reduce((s,r)=>s+(isNum(r.p40_pnl)?r.p40_pnl:0),0),
   next_missing_date:'2026-10-23',
   requires:['TX_RAW_1M_POST_CUTOFF','P40_CAUSAL_NEXT_SESSION_REPLAY','R26_CORE_NEXT_SESSION_REPLAY','HISTORICAL_PREOPEN_PRICE_PARITY','BROKER_POSITION_VERIFICATION']};
}
