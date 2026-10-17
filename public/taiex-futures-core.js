(function(root){
  'use strict';
  const number=v=>v===null||v===undefined||String(v).trim()===''?NaN:Number(String(v).replace(/,/g,''));
  const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
  function normalize(raw){
    const map=new Map();let rejected=0;
    for(const r of Array.isArray(raw)?raw:[]){
      const contract=String(r.contract_date||'');
      if(r.futures_id!=='TX'||!validDate(r.date)||!/^\d{4}(0[1-9]|1[0-2])$/.test(contract)||contract<r.date.slice(0,7).replace('-','')||!['position','after_market'].includes(r.trading_session)){rejected++;continue;}
      const b={date:r.date,contract,session:r.trading_session,open:number(r.open),high:number(r.max),low:number(r.min),close:number(r.close),volume:number(r.volume),openInterest:number(r.open_interest)};
      if(![b.open,b.high,b.low,b.close,b.volume].every(Number.isFinite)||b.low<=0||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close)||b.volume<0){rejected++;continue;}
      if(!Number.isFinite(b.openInterest)||b.openInterest<0||b.session==='after_market')b.openInterest=null;
      const key=[b.date,b.contract,b.session].join(':');
      const existing=map.get(key);
      if(existing&&JSON.stringify(existing)!==JSON.stringify(b))throw new Error('來源出現同日同合約重複且不一致資料，請重新載入。');
      map.set(key,b);
    }
    return {data:[...map.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.contract.localeCompare(b.contract)||a.session.localeCompare(b.session)),rejected};
  }
  // Provider dates are exchange trading dates: night session precedes the day session.
  function series(data,{session='position',contract='near'}={}){
    if(!['position','after_market','combined'].includes(session))throw new Error('無效交易時段');
    const groups=new Map();
    for(const r of data){const key=r.date+':'+r.contract;if(!groups.has(key))groups.set(key,{});groups.get(key)[r.session]=r;}
    const days=new Map();
    for(const pair of groups.values()){
      const day=pair.position,night=pair.after_market;
      let b;
      if(session==='combined'){
        if(!day)continue; // Only show full trading dates after the day session is available.
        b={...day,open:night?.open??day.open,high:Math.max(day.high,night?.high??day.high),low:Math.min(day.low,night?.low??day.low),volume:day.volume+(night?.volume??0),nightMissing:!night};
      }else b=pair[session];
      if(!b||(contract!=='near'&&b.contract!==contract))continue;
      const existing=days.get(b.date);
      if(!existing||b.contract<existing.contract)days.set(b.date,{...b});
    }
    const rows=[...days.values()].sort((a,b)=>a.date.localeCompare(b.date));
    rows.forEach((b,i)=>{b.rollover=i>0&&b.contract!==rows[i-1].contract;});
    return rows;
  }
  function sma(rows,n,index=rows.length-1){if(index<n-1)return null;return rows.slice(index-n+1,index+1).reduce((s,b)=>s+b.close,0)/n;}
  function summary(rows){
    const b=rows.at(-1),prev=rows.at(-2);if(!b)return null;
    const previous20=rows.slice(-21,-1),meanVolume=previous20.length===20?previous20.reduce((s,x)=>s+x.volume,0)/20:null;
    const change=prev&&!b.rollover?b.close-prev.close:null;
    return {bar:b,change,changePercent:change===null?null:change/prev.close*100,ma5:sma(rows,5),ma10:sma(rows,10),ma20:sma(rows,20),ma60:sma(rows,60),volumeRatio:meanVolume>0?b.volume/meanVolume:null,oiChange:prev&&!b.rollover&&Number.isFinite(b.openInterest)&&Number.isFinite(prev.openInterest)?b.openInterest-prev.openInterest:null};
  }
  const api={normalize,series,sma,summary,number};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.TWTaiexFutures=api;
})(typeof window==='object'?window:globalThis);
