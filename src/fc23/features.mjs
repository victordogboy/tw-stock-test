import {context1494,features} from './shared.mjs';
const f32=Math.fround,sum=a=>a.reduce((s,v)=>s+v,0),mean=a=>sum(a)/a.length;
const finite=x=>Number.isFinite(x),median=a=>{a=a.filter(finite).sort((a,b)=>a-b);return a.length?(a[(a.length-1)>>1]+a[a.length>>1])/2:0};
export function ingestFc23Technical(st,day){
 st.fc23Volume??={};st.fc23Candle??={};const byCode=new Map(day.rows.map(r=>[r.code,r]));
 for(const code of st.codes){const r=byCode.get(code);if(!r)continue;const v=st.fc23Volume[code]??=[];st.fc23Candle[code]={o:r.open,h:r.high,l:r.low,c:r.close};v.push(f32(r.volume));if(v.length>21)v.shift()}
 st.fc23ReturnHistory.push(st.codes.map(k=>st.stocks[k].c.at(-1)>0?st.stocks[k].pc.at(-1):null));if(st.fc23ReturnHistory.length>61)st.fc23ReturnHistory.shift();
}
export function contextFc23(st){
 const c=context1494(st),base=features(st),F=c.F,M=F.length,history=st.fc23ReturnHistory;
 if(history?.length!==61||!st.fc23Groups||!st.fc23Volume)throw Error('FC23 原始60日特徵緩衝未完整');
 const residual=[],validCount=Array(M).fill(0),sums=Array(M).fill(0),sq=Array(M).fill(0);
 for(let t=1;t<history.length;t++){
  const raw=history[t].map((p,j)=>p>0&&history[t-1][j]>0?p/history[t-1][j]-1:null),market=median(raw);
  const row=raw.map((r,j)=>{if(finite(r))validCount[j]++;const x=finite(r)?r-market:0;sums[j]+=x;sq[j]+=x*x;return x});residual.push(row);
 }
 const std=sq.map((x,j)=>Math.sqrt(Math.max(x-sums[j]*sums[j]/60,1e-15))),strong=F.map(x=>finite(x.rs20)&&x.rs20>.07&&x.rs5>0&&x.p>x.e20&&finite(x.rs5));
 const peers=Array(M).fill(0);
 for(let j=0;j<M;j++){
  if(validCount[j]<45)continue;const cor=[];
  for(let k=0;k<M;k++){if(k===j||validCount[k]<45)continue;let cross=0;for(const row of residual)cross+=row[j]*row[k];const value=(cross-sums[j]*sums[k]/60)/std[j]/std[k];cor.push({k,value})}
  const eligible=cor.sort((a,b)=>b.value-a.value||a.k-b.k).slice(0,6).filter(x=>x.value>.40);peers[j]=f32(eligible.filter(x=>strong[x.k]).length/Math.max(1,eligible.length));
 }
 const rank=Array(M).fill(999),score0=[];
 for(let j=0;j<M;j++){const x=F[j],s=st.stocks[st.codes[j]],chips=s.chips||[];
  const good=chips.length>=5&&chips.slice(-5).every(c=>c?.institutionalAvailable),vol=good?sum(chips.slice(-5).map(c=>c.volume)):0;
  x.F5=good&&vol>0?f32(sum(chips.slice(-5).map(c=>c.foreign))/vol):null;x.T5=good&&vol>0?f32(sum(chips.slice(-5).map(c=>c.trust))/vol):null;
  const hedge=good&&vol>0?sum(chips.slice(-5).map(c=>c.hedge))/vol:0;
  const hedgeBonus=f32(.085*Math.max(-1,Math.min(1,hedge/.04))),hot=f32(x.rs5>.20&&x.rs20<.24?-.10:0);
  score0[j]=f32(f32(base[j].score+hedgeBonus)+hot);
  const volumes=st.fc23Volume[st.codes[j]]||[],vden=volumes.length>=21?mean(volumes.slice(-21,-1)):null;
  x.vr=vden>0?f32(volumes.at(-1)/vden):null;
  const pc=s.pc,tail=volumes.slice(-5);let dn=0;for(let k=0;k<5;k++)if(pc.at(-5+k)<pc.at(-6+k))dn+=tail[k]||0;
  x.downShare=tail.length===5&&sum(tail)>0?f32(dn/sum(tail)):null;x.red=pc.at(-1)<pc.at(-2);
  const candle=st.fc23Candle?.[st.codes[j]],range=candle?Math.max(candle.h-candle.l,.01):1,largeRed=candle&&(candle.c-candle.o)/range<=-.3&&(candle.c-candle.l)/range<.3;
  x.buyLevel=Math.max(0,(x.vr<.8&&x.rs20>=.10?.05:.10)-.1*Number(largeRed))*.88;
  const high=Math.max(...pc.slice(-60).filter(finite));x.near60=x.p/high;x.peer=peers[j];
 }
 const ids=F.map((_,j)=>j).filter(j=>F[j].base&&F[j].trend&&finite(score0[j])).sort((a,b)=>score0[b]-score0[a]||b-a);ids.forEach((j,k)=>rank[j]=k+1);
 const sector=Array(4).fill(0),denom=Array(4).fill(0);
 for(let j=0;j<M;j++){const x=F[j],g=st.fc23Groups[j];if(finite(x.p))denom[g]++;if(finite(x.rs20)&&x.rs20>.06&&x.rs5>0&&x.p>x.e20)sector[g]++}
 for(let j=0;j<M;j++){
  const x=F[j],pool=rank[j]>=9&&rank[j]<=30&&x.base&&x.trend,safe=finite(x.rs20)&&finite(x.rs5)&&finite(x.vr)&&x.p>x.e20;
  const fc13=pool&&safe&&sector[st.fc23Groups[j]]/Math.max(1,denom[st.fc23Groups[j]])>=.55&&x.rs20>.08&&x.rs5>-.005;
  const fc15=pool&&x.near60>=.94&&x.rs20>.07&&x.rs20<.30&&x.rs5-x.rs20/4>.007&&x.vr>=1;
  x.score=f32(f32(score0[j]+f32(.10*Number(fc13)))+f32(.008*Number(fc15)));
  x.reentry=x.base&&x.trend&&x.p>x.e20&&x.rs20>.08&&x.rs5>.015&&x.rs5-x.rs20/4>.007&&x.near60>.87&&x.peer>=.5&&(x.T5===null||x.T5>=-.02)&&(x.rs5<=.18||(x.rs5<=.25&&x.peer>=.70&&x.F5!==null&&x.F5>=0));
  if(st.excludedCodes?.includes(st.codes[j])){x.base=false;x.reentry=false}
 }
 const mh=st.marketHistory,b=c.breadth,mr3=mh.at(-1)/mh.at(-4)-1;
 return {...c,date:st.date,F,cold:b<.35&&mr3<-.07,softWeak:mh.at(-1)<mean(mh.slice(-60))&&b<.60,emergency:mr3<=-.06&&b<.35};
}
