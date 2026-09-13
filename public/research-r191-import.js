(function(root){'use strict';
function r19Date(value) {
  const s=String(value||'').trim();
  let m=s.match(/^(\d{3,4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if(!m && /^\d{8}$/.test(s)) m=[s,s.slice(0,4),s.slice(4,6),s.slice(6,8)];
  if(!m) return null;
  const y=Number(m[1])+(m[1].length===3?1911:0);
  const d=`${y}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  return Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d?d:null;
}
function r19Snapshot(raw, market, date) {
  const returned=r19Date(raw.date||raw.reportDate||raw.queryDate);
  if(returned && returned!==date) throw new Error('Upstream returned a different date');
  const status=String(raw.stat||raw.status||raw.message||'');
  if(/沒有符合|查無資料|無交易資料|休市/.test(status)) return {date,market,rows:[],closed:true};
  if(!returned) throw new Error('Historical response has no verifiable date; refusing latest-day fallback');
  const tables=[...(raw.tables||[])];
  // Legacy TPEx full-market report: fixed published field order, dated report only.
  if(market==='tpex' && Array.isArray(raw.aaData) && returned===date){
    tables.push({fields:['代號','名稱','收盤','漲跌','開盤','最高','最低','均價','成交股數'],data:raw.aaData});
  }
  if(raw.fields) tables.push({fields:raw.fields,data:raw.data});
  for(const k of Object.keys(raw)) if(/^fields\d+$/.test(k)) tables.push({fields:raw[k],data:raw[k.replace('fields','data')]});
  const clean=s=>String(s).replace(/<[^>]*>/g,'').replace(/\s/g,'');
  const number=s=>{const t=clean(s??'').replace(/,/g,'');return t && !/--|除權|除息/.test(t)&&Number.isFinite(Number(t))?Number(t):null};
  for(const t of tables){
    const fields=(t.fields||[]).map(x=>clean(typeof x==='object'?(x.title||x.name||''):x));
    const index=re=>fields.findIndex(f=>re.test(f));
    const ix={code:index(/^(證券代號|代號|股票代號)$/),name:index(/^(證券名稱|名稱|股票名稱)$/),open:index(/^開盤(價)?$/),high:index(/^最高(價)?$/),low:index(/^最低(價)?$/),close:index(/^收盤(價)?$/),volume:index(/^成交(股數|仟股|千股|張數)(\(.*\))?$/)};
    if(Object.values(ix).some(i=>i<0)||!Array.isArray(t.data))continue;
    const declared=Number(t.totalCount??raw.iTotalRecords);
    if(Number.isFinite(declared)&&declared>t.data.length)throw new Error('Paginated market report is incomplete');
    const factor=/仟股|千股|張數/.test(fields[ix.volume])?1000:1;
    if(t.data.length===0 && /^(ok|200)$/i.test(status)) return {date,market,rows:[],closed:true};
    const rows=t.data.filter(Array.isArray).map(r=>({date,market,code:clean(r[ix.code]),name:clean(r[ix.name]),open:number(r[ix.open]),high:number(r[ix.high]),low:number(r[ix.low]),close:number(r[ix.close]),volume:number(r[ix.volume])===null?null:number(r[ix.volume])*factor})).filter(r=>/^[1-9]\d{3}$/.test(r.code));
    if(rows.length<100||rows.some(r=>r.volume===null||r.volume<0))throw new Error('Incomplete full-market table or invalid volume');
    if(new Set(rows.map(r=>r.code)).size!==rows.length)throw new Error('Duplicate stock in market snapshot');
    return {date,market,rows,closed:false};
  }
  throw new Error('Unrecognized historical OHLC/volume table; no snapshot published');
}

function normalizeImport(input){
  const snapshots=Array.isArray(input)?input:input.snapshots;
  if(!Array.isArray(snapshots)||!snapshots.length)throw Error('需要 snapshots 陣列或每日行情陣列');
  const seen=new Set();
  return snapshots.map(s=>{
    if(!s||!['twse','tpex'].includes(s.market)||typeof s.date!=='string'||r19Date(s.date)!==s.date)throw Error('匯入資料缺少有效 date / market');
    const id=s.market+':'+s.date;if(seen.has(id))throw Error('同市場同日期資料重複');seen.add(id);
    const p=s.raw?r19Snapshot(s.raw,s.market,s.date):s;
    if(!Array.isArray(p.rows)||(!p.closed&&p.rows.length<100)||(p.closed&&p.rows.length))throw Error('必須提供完整市場 rows，休市資料 rows 須為空');
    const codes=new Set();
    for(const r of p.rows){
      if(r.date!==s.date||r.market!==s.market||!/^[1-9]\d{3}$/.test(r.code)||codes.has(r.code)||typeof r.volume!=='number'||!Number.isFinite(r.volume)||r.volume<0)throw Error('股票日期、市場、代號或成交股數無效');
      for(const k of ['open','high','low','close'])if(r[k]!==null&&(typeof r[k]!=='number'||!Number.isFinite(r[k])))throw Error('價格須為數字或 null');
      codes.add(r.code);
    }
    return {ok:true,version:19,patch:'19.1',date:s.date,market:s.market,rows:p.rows,closed:!!p.closed,source:'User imported historical market',provider:'import',cached_at:new Date().toISOString()};
  });
}
const api={normalizeImport};root.ResearchImportR191=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
