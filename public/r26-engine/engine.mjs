// TX_R26_CANONICAL_20261028 JavaScript port. Prices and accounting match frozen Python.
export const VERSION='TX_R26_CANONICAL_20261028 / web-1';
const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
const std=a=>{let m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1))};
const ema=(a,n)=>{let p=a[0];return a.map((x,i)=>i?(p=x*2/(n+1)+p*(1-2/(n+1))):p)};
export function prepare(meta,bars){
 const ss=meta.sessions.map(s=>({...s}));
 for(const s of ss){let p=s.offset*4;s.op=bars[p];s.cl=bars[p+(s.count-1)*4+3];s.hi=-Infinity;s.lo=Infinity;for(let b=0;b<s.count;b++){s.hi=Math.max(s.hi,bars[p+b*4+1]);s.lo=Math.min(s.lo,bars[p+b*4+2]);}}
 const days=ss.filter(s=>s.sid===1), C=days.map(s=>s.cl),tr=days.map((s,i)=>Math.max(s.hi-s.lo,Math.abs(s.hi-(i?C[i-1]:s.op)),Math.abs(s.lo-(i?C[i-1]:s.op))));
 const e20=ema(C,20),e50=ema(C,50),e150=ema(C,150),a20=tr.map((_,i)=>i>=19?mean(tr.slice(i-19,i+1)):NaN);
 let gain=NaN,loss=NaN;const rsi=C.map((x,i)=>{if(!i)return NaN;let dif=x-C[i-1];gain=i===1?Math.max(dif,0):gain*13/14+Math.max(dif,0)/14;loss=i===1?Math.max(-dif,0):loss*13/14+Math.max(-dif,0)/14;return 100-100/(1+gain/(loss+1e-9))});
 let di=0,tower=0;
 for(let i=0;i<ss.length;i++){
  let s=ss[i];while(di<days.length&&days[di].date<s.date)di++;let j=di-1,af=a20[Math.max(j,0)];s.atr=af;s.levels=[];s.tower=tower;
  if(i>=3){let w=ss.slice(i-3,i);if(s.cl>Math.max(...w.map(x=>x.hi)))tower=1;else if(s.cl<Math.min(...w.map(x=>x.lo)))tower=-1;}
  if(di>=50){let w=days.slice(di-50,di),off=Math.floor(s.op-mean(w.map(x=>x.op))),h=Math.floor(off+mean(w.map(x=>x.hi))+.5),l=Math.floor(off+mean(w.map(x=>x.lo))+.5),ah=Math.floor(std(w.map(x=>x.hi-x.op))),al=Math.floor(std(w.map(x=>x.lo-x.op))),a=days[j].hi,b=days[j].lo,c=days[j].cl,r=a-b,cdp=Math.floor((a+b+2*c)/4);s.levels=[...new Set([0,1,2,3].map(k=>h+k*ah).concat([0,1,2,3].map(k=>l-k*al),[cdp,cdp+r,2*cdp-b,cdp-r,2*cdp-a,Math.floor(b+r*1.382),Math.floor(b+r*1.191),Math.floor((a+b)/2),Math.floor(a-r*1.191),Math.floor(a-r*1.382)]))].sort((a,b)=>a-b);}
  let prev=C[j],mom5=(prev-C[Math.max(di-6,0)])/af,mom3=(prev-C[Math.max(di-4,0)])/af,mom10=(prev-C[Math.max(di-11,0)])/af,prior=(C[Math.max(di-1,0)]-C[Math.max(di-1,0)-1])/af,slope=(e50[j]-e50[Math.max(di-3,0)-1])/af,dist=(prev-e50[j])/af,ratio=di>=5?mean(tr.slice(di-5,di))/af:NaN,dd10=di>=10?(prev-Math.max(...days.slice(di-10,di).map(x=>x.hi)))/af:NaN,atrSlope=af/a20[j-10]-1;
  let sig=di>=50?(e20[j]-e150[j]>.2*af?1:e20[j]-e150[j]<-.2*af?-1:0):0;
  if(prev>e50[j]&&slope>0&&mom5>0)sig=1;
  if(s.sid&&prior<-2)sig=-1;if(!s.sid&&mom3<-.5)sig=-1;if(!s.sid&&mom10<-2)sig=1;if(s.sid&&rsi[j]>45)sig=1;if(s.sid&&ratio<.90)sig=-1;
  if(sig===-1&&(mom10>.5||ratio<.8||Math.abs(mom10)<.15))sig=0;
  if(sig===0&&mom5>.5)sig=1;if(sig===-1&&!s.sid&&dist>-1)sig=0;if(sig===1&&s.sid&&rsi[j]<35)sig=0;if(sig===0&&!s.sid&&prior<-1)sig=-1;if(sig===0&&!s.sid&&mom5<0&&prev<e50[j])sig=-1;
  let r7=sig,A=sig;if(A===1&&mom5>3)A=0;if(A===-1&&dd10<-4)A=0;if(A===-1&&atrSlope<-.1)A=0;
  let score=+(slope>.2)+ +(dist>1.5)+ +(ratio>1.1)+ +(mom10>1),r10=A;
  if(r7===1&&A===0&&score>=3&&slope>0&&dist>.5&&ratio>.85&&mom5>0)r10=1;
  s.A=A;s.r10=r10;s.guard=r10===-1&&ratio<.85&&dd10<-1.5;s.gate=dd10<-1.5;s.ratio=ratio;s.dd10=dd10;s.features={mom5,mom10,rsi:rsi[j],dist,slope,ratio,dd10};
  s.long=makePlan(s,0);s.short=makePlan(s,1);
 }
 return ss;
}
export function stop(s,side){let af=Number.isFinite(s.atr)&&s.atr>0?s.atr:200,dist=af*(s.sid?.55:.6),hard=af*2;if(side===1)return Math.max(s.op-hard,...s.levels.filter(x=>x>0&&x<=s.op-dist));return Math.min(s.op+hard,...s.levels.filter(x=>x>0&&x>=s.op+dist))}
export function makePlan(s,t){
 let factor=Math.max(.5,Math.min(2.5,s.op/20000)),p=[700,0,40,30,1.1,8,.6,50,125,.5,300,0];for(const z of [0,1,2,3,7,8,10,11])p[z]*=factor;
 let [rlimit,tight,addgap,exitgap,pratio,pdiv,mrr,srange,starget,lrr,lrange,ltarget]=p,above=s.levels.filter(x=>x>s.op),below=s.levels.filter(x=>x<=s.op).reverse(),sg=t?-1:1,fw=(t?below:above).map(x=>x*sg),bk=(t?above:below)[0]*sg,span=above.length&&below.length?above[0]-below[0]:0,sz=fw.length;
 const empty={entry:0,stop:0,target:0};if(sz<2||!bk||span<(t?srange:lrange))return empty;
 const half=(e,st)=>t?-Math.floor((-e-st+1)/2):Math.floor((e+st+1)/2);
 let isTight=span<tight&&sz>1,wide=!t&&span>rlimit&&sz>1,j0=(isTight||wide)?1:0,entry=fw[j0],stoplv=(isTight||wide)?fw[0]:bk,sl=entry-stoplv>rlimit?half(entry,stoplv):stoplv,halved=entry-stoplv>rlimit;
 if(sl>=entry)return empty;let j=j0+1,adds=[];while(j<sz&&fw[j]-fw[j-1]<addgap)adds.push(fw[j++]);if(j>=sz)return empty;while(j+1<sz&&fw[j+1]-fw[j]<exitgap)adds.push(fw[j++]);let target=fw[j],mindist=t?starget:ltarget;
 while(mindist>0&&j+1<sz&&target-entry<mindist)target=fw[++j];if(target<=entry)return empty;
 let profit=target-entry+adds.reduce((s,x)=>s+target-x,0),risk=entry-sl+adds.reduce((s,x)=>s+x-sl,0);
 if(!halved&&!isTight&&profit<risk){sl=half(entry,stoplv);risk=entry-sl+adds.reduce((s,x)=>s+x-sl,0)}
 if(risk>0&&pratio>0&&pdiv>0&&profit>pratio*risk){let step=(target-entry)/pdiv;target=entry+(t?Math.ceil(step-.5):Math.floor(step+.5));adds=adds.filter(x=>x<target)}
 profit=target-entry+adds.reduce((s,x)=>s+target-x,0);risk=entry-sl+adds.reduce((s,x)=>s+x-sl,0);if(risk<=0||profit<(t?mrr:lrr)*risk)return empty;
 return {entry:entry*sg,stop:sl*sg,target:target*sg};
}
export function simulate(ss,bars,{fee=2.5,shadow=false,reentry=true,end='9999',liquidate=true}={}){
 let pos=0,st=0,lastCon='',lastCl=0,prev=-1,equity=0,peak=0,mdd=0,core=0,keys=0,stops=0,reentries=0,rows=[],events=[],pnls=Array(ss.length).fill(0);
 for(let i=0;i<ss.length;i++){
  const s=ss[i];if(s.date<'2021-10-22'||s.date>end)continue;let pnl=0,desire=shadow?s.A:s.blocked?0:s.signal,af=Number.isFinite(s.atr)&&s.atr>0?s.atr:200,anchor=s.op,active=0,keyStop=0,keyTarget=0,stopdir=0,stopprice=0,stoppedAt=-1,recovered=false,keyDone=false;
  const event=(b,type,side,price)=>events.push({date:s.date,sid:s.sid,bar:b,type,side,price,contract:s.contract,start:s.start});
  if(pos&&prev>=0){if(s.contract===lastCon)pnl+=pos*(s.op-lastCl);else {pnl-=2*fee;event(0,'換月',pos,s.op)}}
  if(desire!==pos){if(pos){pnl-=fee;event(0,'開盤平倉',pos,s.op)}pos=desire;if(pos){pnl-=fee;core++;st=0;event(0,'核心進場',pos,s.op)}}
  if(pos)st=stop(s,pos);let startPos=pos;
  for(let b=0;b<s.count;b++){
   let idx=(s.offset+b)*4,bo=bars[idx],hi=bars[idx+1],lo=bars[idx+2];
   if(b>0){let marked=equity+pnl+pos*(bars[idx-1]-anchor);peak=Math.max(peak,marked);mdd=Math.max(mdd,peak-marked)}
   if(pos){let lev=active?keyStop:st;if(lev&&(pos>0?lo<=lev:hi>=lev)){let ex=pos>0?Math.min(lev,bo):Math.max(lev,bo);pnl+=pos*(ex-anchor)-fee;event(b,active?'關鍵價停損':'核心停損',pos,ex);if(!active){stops++;stopdir=pos;stopprice=ex;stoppedAt=b}else keyDone=true;pos=0;active=0;continue}
    if(active&&(pos>0?hi>=keyTarget:lo<=keyTarget)){pnl+=pos*(keyTarget-anchor)-fee;event(b,'關鍵價停利',pos,keyTarget);pos=0;active=0;keyDone=true;continue}
   }
   if(!pos&&stopdir&&!recovered&&!shadow&&reentry&&s.gate&&b>=stoppedAt+15&&b>stoppedAt){let trigger=stopprice+stopdir*.5*af;if(stopdir>0?hi>=trigger:lo<=trigger){let ent=stopdir>0?Math.ceil(Math.max(trigger,bo)):Math.floor(Math.min(trigger,bo));pos=stopdir;active=0;anchor=ent;recovered=true;reentries++;st=pos>0?Math.floor(ent-.55*af):Math.ceil(ent+.55*af);pnl-=fee;event(b,'停損再進場',pos,ent);if(pos>0?lo<=st:hi>=st){let ex=pos>0?Math.min(st,bo):Math.max(st,bo);pnl+=pos*(ex-anchor)-fee;event(b,'再進場同根停損',pos,ex);pos=0;continue}}}
   if(!pos&&!keyDone&&(shadow||!s.blocked)&&desire===0){let lc=s.long.entry>0&&hi>=s.long.entry,sc=s.short.entry>0&&lo<=s.short.entry;if(lc&&sc){keyDone=true;continue}if(lc||sc){pos=lc?1:-1;let plan=lc?s.long:s.short;anchor=lc?Math.max(plan.entry,bo):Math.min(plan.entry,bo);active=1;keyStop=plan.stop;keyTarget=plan.target;pnl-=fee;keys++;event(b,'關鍵價進場',pos,anchor);if(lc?lo<=keyStop:hi>=keyStop){let ex=lc?Math.min(keyStop,bo):Math.max(keyStop,bo);pnl+=pos*(ex-anchor)-fee;event(b,'關鍵價停損',pos,ex);pos=0;active=0;keyDone=true}else if(lc?hi>=keyTarget:lo<=keyTarget){pnl+=pos*(keyTarget-anchor)-fee;event(b,'關鍵價停利',pos,keyTarget);pos=0;active=0;keyDone=true}}}
  }
  if(pos){pnl+=pos*(s.cl-anchor);if(active&&!s.partial){pnl-=fee;event(s.count-1,'輔助單尾盤平倉',pos,s.cl);pos=0}}
  equity+=pnl;peak=Math.max(peak,equity);mdd=Math.max(mdd,peak-equity);pnls[i]=pnl;
  rows.push({date:s.date,sid:s.sid,pnl,held:pos,signal:desire,blocked:!!s.blocked,atr:s.atr,market:s.market,recovered:+recovered,startPos,stop:active?keyStop:st,target:active?keyTarget:null,long:s.long,short:s.short,op:s.op,cl:s.cl,count:s.count,contract:s.contract});prev=i;lastCon=s.contract;lastCl=s.cl;
 }
 if(pos&&liquidate&&rows.length){rows.at(-1).pnl-=fee;pnls[prev]-=fee;eventEnd();}function eventEnd(){let s=ss[prev];events.push({date:s.date,sid:s.sid,bar:s.count-1,type:'樣本末結算費',side:pos,price:s.cl,contract:s.contract,start:s.start})}
 return {rows,events,minuteDD:mdd,core,keys,stops,reentries,pnls,position:pos};
}
export function run(meta,bars,options={}){
 let ss=prepare(meta,bars),shadow=simulate(ss,bars,{shadow:true,reentry:false,end:options.end,liquidate:true}),alarms=ss.map((s,i)=>i>=2&&shadow.pnls[i-1]+shadow.pnls[i-2]<-750);
 for(let i=0;i<ss.length;i++){let s=ss[i];s.blocked=!!(alarms[i]||alarms[i-1]||alarms[i-2]||s.guard);s.signal=s.r10;if(s.r10===0&&i>0&&ss[i-1].market/s.atr>.35&&s.gate&&s.tower===1&&s.ratio>1&&!s.guard){s.signal=1;s.blocked=false}}
 let result=simulate(ss,bars,options);result.sessions=ss;return result;
}
export function audit(result,meta){let expected=meta.sessions.filter(s=>s.gold),map=new Map(expected.map(s=>[s.date+'-'+s.sid,s.gold])),diff=[];for(const r of result.rows){let g=map.get(r.date+'-'+r.sid);if(!g||Math.abs(r.pnl-g.R26_pnl)>1e-7||r.held!==g.R26_held_end||r.recovered!==g.R26_reentered||r.signal!==(g.core_signal_blocked?0:g.core_signal))diff.push({date:r.date,sid:r.sid,pnl:r.pnl,expected:g?.R26_pnl,held:r.held,expectedHeld:g?.R26_held_end,signal:r.signal,expectedSignal:g?.core_signal})}return {compared:result.rows.length,differences:diff,pass:diff.length===0&&result.rows.length===expected.length&&result.minuteDD===2733};}
