// R26 independent, causal regime features. Previous CLOSED day candles only.
// Arrays correspond to prepared R26 sessions, *never* current session's high/low.
export function priorDailyRegimes(ss){
 const days=ss.filter(s=>s.sid===1),cl=days.map(s=>s.cl),
  tr=days.map((s,i)=>Math.max(s.hi-s.lo,Math.abs(s.hi-(i?cl[i-1]:s.op)),
   Math.abs(s.lo-(i?cl[i-1]:s.op))));
 const atr=tr.map((_,i)=>i>=19?tr.slice(i-19,i+1).reduce((x,y)=>x+y,0)/20:NaN);
 const result=[];
 let j=0;
 for(let i=0;i<ss.length;i++){
  const s=ss[i];
  while(j<days.length&&days[j].date<s.date)j++;
  const last=j-1;
  if(last<19||!Number.isFinite(s.atr)||Math.abs(s.atr-atr[last])>1e-7)
    throw Error('ATR_LOOKAHEAD_ALIGNMENT_OR_WARMUP: '+s.date+' '+s.sid+' '+last+' actual '+s.atr+' pre '+atr[last]);
  const a=atr[last];
  const historicalAtr=atr.slice(Math.max(19,last-249),last+1).filter(Number.isFinite);
  const older=n=>last-n>=19?atr[last-n]:NaN;
  const slope=n=>Number.isFinite(older(n))?a/older(n)-1:NaN;
  const aboveAtr=historicalAtr.filter(v=>v<=a).length/(historicalAtr.length||1);
  const lastClose=cl[last];
  const efficiency=n=>{
   if(last<n)return NaN;
   let denom=0;for(let t=last-n+1;t<=last;t++)denom+=Math.abs(cl[t]-cl[t-1]);
   return denom?Math.abs(lastClose-cl[last-n])/denom:0;
  };
  const upCount=n=>{
   if(last<n)return NaN;
   let up=0;for(let t=last-n+1;t<=last;t++)if(cl[t]>cl[t-1])up++;
   return up/n;
  };
  const directional=n=>last>=n?(lastClose-cl[last-n])/a:NaN;
  const data={
   atr:a,atrPercentile250:aboveAtr,atrSlope5:slope(5),atrSlope10:slope(10),atrSlope20:slope(20),
   efficiency10:efficiency(10),efficiency20:efficiency(20),
   upDays10:upCount(10),priorTrend10:directional(10),priorTrend20:directional(20),
   price:lastClose,features:s.features,date:s.date,sid:s.sid,index:i,dayIndex:last
  };
  if(last>=250){
   data.historyReady=true;
  }else data.historyReady=false;
  result.push(data);
 }
 return result;
}

export function regimeFlags(regimes,match,{warmup='reject',indexStart=0}={}){
 return regimes.map((r,i)=>{
  if(i<indexStart||!r.historyReady&&warmup==='reject')return false;
  return Boolean(match(r));
 });
}
