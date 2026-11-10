// Direct JavaScript replay of archived P40 engine_minute_shadow.py / R26 adaptive_fuse.py.
// PAPER research only. Inputs require already independently verified causal R26 signal,
// original A shadow prior P&L, P40 prior state, 50 completed DAY key-level inputs.
export const P40_VERSION = 'P40_R26_MINUTE_SHADOW_CAUSAL_STAGE2_20261110';
export const P40_PARAMS = Object.freeze([700,0,40,30,1.1,8,.6,50,125,.5,300,0]);
const finite = x=>typeof x==='number'&&Number.isFinite(x);
const sum=a=>a.reduce((acc,x)=>acc+x,0);
const floor=x=>Math.floor(x);
const sampleStd=a=>{const mean=sum(a)/a.length;return Math.sqrt(a.reduce((s,x)=>s+(x-mean)**2,0)/(a.length-1));};

export function p40KeyLevels(previous50CompletedDays, openingPrice) {
  if(!Array.isArray(previous50CompletedDays)||previous50CompletedDays.length!==50||!finite(openingPrice)||openingPrice<=0)
    throw Error('P40_REQUIRES_PREVIOUS_50_COMPLETE_DAYS_AND_OPEN');
  for(const d of previous50CompletedDays){
    if(d?.complete!==true||![d.open,d.high,d.low,d.close].every(finite)||
       d.open<=0||d.high<Math.max(d.open,d.close)||d.low>Math.min(d.open,d.close))throw Error('P40_UNVERIFIED_DAY_INPUT');
  }
  const x=previous50CompletedDays, last=x.at(-1),shift=floor(openingPrice-sum(x.map(d=>d.open))/50);
  const h0=floor(shift+sum(x.map(d=>d.high))/50+.5),l0=floor(shift+sum(x.map(d=>d.low))/50+.5);
  const ah=floor(sampleStd(x.map(d=>d.high-d.open))),al=floor(sampleStd(x.map(d=>d.low-d.open)));
  const a=last.high,b=last.low,c=last.close,r=a-b,cdp=floor((a+b+2*c)/4);
  return [...new Set([...Array.from({length:4},(_,i)=>h0+i*ah),...Array.from({length:4},(_,i)=>l0-i*al),
    cdp,cdp+r,2*cdp-b,cdp-r,2*cdp-a,floor(b+r*1.382),floor(b+r*1.191),floor((a+b)/2),floor(a-r*1.191),floor(a-r*1.382)])].sort((a,b)=>a-b);
}
const roundHalfStop=(entry,stop,side)=>side===0?floor((entry+stop+1)/2):-floor((-entry-stop+1)/2);
const emptyPlan=()=>({entry:0,stop:0,target:0,adds:[]});

// side 0 is long; side 1 is short. Short prices are returned transformed NEGATIVE.
export function p40MakePlan(levels, openingPrice, side, params=P40_PARAMS, overrideTight=false){
  if(!Array.isArray(levels)||!levels.every(finite)||!finite(openingPrice)||openingPrice<=0||![0,1].includes(side)||params.length!==12)
    throw Error('P40_INVALID_LEVEL_INPUT');
  const vals=[...new Set(levels.filter(x=>x>0))].sort((a,b)=>a-b),above=vals.filter(v=>v>openingPrice),below=vals.filter(v=>v<=openingPrice).reverse();
  const span=above.length&&below.length?above[0]-below[0]:0;
  const forward=(side===0?above:below).map(v=>side===0?v:-v);
  const back=(side===0?below:above),bk=back.length?(side===0?back[0]:-back[0]):0;
  const [rlimit,tight,addgap,exitgap,pratio,pdiv,mrr,srange,starget,lrr,lrange,ltarget]=params;
  const size=forward.length;
  if(size<2||!bk||(side===1&&span<srange)||(side===0&&span<lrange))return emptyPlan();
  const isTight=span<tight&&size>1&&!overrideTight;
  const rawTarget=j0=>{let j=j0+1;
    while(j<size&&forward[j]-forward[j-1]<addgap)j++;
    if(j>=size)return 0;
    while(j+1<size&&forward[j+1]-forward[j]<exitgap)j++;
    return forward[j];};
  if(isTight&&side===0){
    const base=p40MakePlan(levels,openingPrice,side,params,true);
    if(base.entry>0){
      let original=rawTarget(0);
      if(original>base.target){
        const entry=base.target;let stop=forward[0];
        if(entry-stop>rlimit)stop=roundHalfStop(entry,stop,side);
        if(ltarget>0){
          const index=forward.indexOf(original);
          if(index>=0){let j=index;while(j+1<size&&original-entry<ltarget){j++;original=forward[j];}}
        }
        if(lrr>0&&original-entry<lrr*(entry-stop))return emptyPlan();
        return {entry,stop,target:original,adds:[]};
      }
    }
  }
  const skip=isTight||(side===0&&span>rlimit&&size>1),j0=skip?1:0,entry=forward[j0];
  const stoplv=skip?forward[0]:bk;
  let stop=entry-stoplv>rlimit?roundHalfStop(entry,stoplv,side):stoplv;
  const halved=entry-stoplv>rlimit;
  if(stop>=entry)return emptyPlan();
  let j=j0+1;let adds=[];
  while(j<size&&forward[j]-forward[j-1]<addgap){adds.push(forward[j]);j++;}
  if(j>=size)return emptyPlan();
  while(j+1<size&&forward[j+1]-forward[j]<exitgap){adds.push(forward[j]);j++;}
  let target=forward[j];
  const mindist=side===1?starget:ltarget;
  if(mindist>0)while(j+1<size&&target-entry<mindist){j++;target=forward[j];}
  if(target<=entry)return emptyPlan();
  let profit=target-entry+sum(adds.map(v=>target-v)),risk=entry-stop+sum(adds.map(v=>v-stop));
  if(!halved&&!isTight&&profit<risk){stop=roundHalfStop(entry,stoplv,side);risk=entry-stop+sum(adds.map(v=>v-stop));}
  if(risk>0&&pratio>0&&pdiv>0&&profit>pratio*risk){
    const step=(target-entry)/pdiv;
    target=entry+(side===0?floor(step+.5):Math.ceil(step-.5));
    adds=adds.filter(v=>v<target);
  }
  profit=target-entry+sum(adds.map(v=>target-v));risk=entry-stop+sum(adds.map(v=>v-stop));
  if(risk<=0||profit<(side===1?mrr:lrr)*risk)return emptyPlan();
  return {entry,stop,target,adds};
}
function coreStop(levels,op,atr,dir,mg,maxGap=2){
  const boundary=op+(-dir)*mg*atr,hard=op+(-dir)*maxGap*atr;
  if(dir===1){
    const nearest=Math.max(-1e10,...levels.filter(v=>v>0&&v<=boundary));
    return Math.max(nearest,hard);
  }
  const near=levels.filter(v=>v>0&&v>=boundary),nearest=near.length?Math.min(...near):1e10;
  return Math.min(nearest,hard);
}
function check(s){
 if(!s||!['night','day'].includes(s.session)||![-1,0,1].includes(s.signal)||
   !Array.isArray(s.bars)||!s.bars.length||!Array.isArray(s.levels)||
   !finite(s.atr)||s.atr<=0||!['number','string'].includes(typeof s.contract)||
   !s.bars.every(b=>Array.isArray(b)&&b.length>=4&&b.slice(0,4).every(finite)&&b[0]>0&&b[2]>0&&b[1]>=Math.max(b[0],b[3])&&b[2]<=Math.min(b[0],b[3])))
   throw Error('P40_BARS_OR_UPSTREAM_SIGNAL_NOT_VERIFIED');
}
export function replayP40Session(s,previous={pos:0,last_close:0,last_contract:null,equity:0,has_prior:false},mode='P40'){
 check(s);
 if(!['P40','A_SHADOW'].includes(mode))throw Error('UNSUPPORTED_P40_OR_SHADOW_ENGINE');
 if(![-1,0,1].includes(previous.pos)||!finite(previous.equity)||
   (previous.has_prior&&(!finite(previous.last_close)||previous.last_close<=0)))throw Error('INVALID_P40_PRIOR_STATE');
 if(s.signal_verified!==true||s.bars_verified!==true||s.contract_verified!==true||s.calendar_verified!==true||s.atr_verified!==true||s.levels_verified!==true)
   throw Error('P40_REQUIRES_INDEPENDENTLY_VERIFIED_FEATURES');
 const cost=2.5,op=s.bars[0][0],cl=s.bars.at(-1)[3],posPrev=previous.pos;
 const blocked=mode==='P40'?s.blocked===true:false;
 const desire=blocked?0:s.signal;
 let pos=previous.pos,stop=0,pnl=0,active=0,anchor=op,keyStop=0,keyTarget=0;
 const count={ncore:0,nkeys:0,nstops:0,ntarget:0,namb:0,nrecoveries:0};
 if(pos!==0&&previous.has_prior){
   if(String(previous.last_contract)===String(s.contract))pnl+=pos*(op-previous.last_close);
   else pnl-=2*cost;
 }
 if(desire!==pos){if(pos)pnl-=cost;pos=desire;
   if(pos){pnl-=cost;count.ncore++;stop=0;}}
 const mg=mode==='P40'?(s.session==='day'?.75:.9):(s.session==='day'?.55:.6);
 if(pos)stop=coreStop(s.levels,op,s.atr,pos,mg);
 const factor=Math.min(2.5,Math.max(.5,op/20000));
 const p=P40_PARAMS.map((v,i)=>[0,1,2,3,7,8,10,11].includes(i)?v*factor:v);
 const long=p40MakePlan(s.levels,op,0,p),short=p40MakePlan(s.levels,op,1,p);
 const enL=long.entry,enS=-short.entry,slL=long.stop,slS=-short.stop,tpL=long.target,tpS=-short.target;
 let stoppedCore=false,keyDone=false,stopDir=0,stopPrice=0,stoppedAt=-1,reentered=false;
 const allowKey=!blocked;
 let peak=previous.equity,maxDrawdown=0,mae=0;
 const marks=[];
 for(let b=0;b<s.bars.length;b++){
   const [bo,high,low]=s.bars[b];
   if(b>0){const priorClose=s.bars[b-1][3],marked=previous.equity+pnl+pos*(priorClose-anchor);
      marks.push(marked);peak=Math.max(peak,marked);maxDrawdown=Math.max(maxDrawdown,peak-marked);}
   if(pos){
     mae=Math.max(mae,pos>0?Math.max(0,anchor-low):Math.max(0,high-anchor));
     const lv=active?keyStop:stop;
     if(lv&&((pos>0&&low<=lv)||(pos<0&&high>=lv))){
       const exit=pos>0?Math.min(lv,bo):Math.max(lv,bo);
       pnl+=pos*(exit-anchor)-cost;
       if(!active){count.nstops++;stoppedCore=true;stopDir=pos;stopPrice=exit;stoppedAt=b;}
       else keyDone=true;
       pos=0;active=0;continue;
     }
     if(active&&((pos>0&&high>=keyTarget)||(pos<0&&low<=keyTarget))){
       pnl+=pos*(keyTarget-anchor)-cost;count.ntarget++;pos=0;active=0;keyDone=true;continue;
     }
   }
   if(!pos&&mode==='P40'&&stopDir&&!reentered&&s.entrygate===true&&b>=stoppedAt+15&&b>stoppedAt){
     const trigger=stopDir>0?stopPrice+.5*s.atr:stopPrice-.5*s.atr;
     if(stopDir>0?high>=trigger:low<=trigger){
       const newEntry=stopDir>0?Math.ceil(Math.max(trigger,bo)):Math.floor(Math.min(trigger,bo));
       pos=stopDir;active=0;anchor=newEntry;reentered=true;count.nrecoveries++;
       stop=pos>0?Math.floor(newEntry-.55*s.atr):Math.ceil(newEntry+.55*s.atr);
       pnl-=cost;
       if((pos>0&&low<=stop)||(pos<0&&high>=stop)){
         const exit=pos>0?Math.min(stop,bo):Math.max(stop,bo);
         pnl+=pos*(exit-anchor)-cost;pos=0;continue;
       }
     }
   }
   // overlay=1: on a neutral/flat original signal, one key trade allowed;
   // a core stop does NOT enable a second overlay entry in the same session.
   if(!pos&&allowKey&&!keyDone&&desire===0){
     const lc=enL>0&&high>=enL,sc=enS>0&&low<=enS;
     if(lc&&sc){count.namb++;keyDone=true;continue;}
     if(lc||sc){
       const direction=lc?1:-1,entry=lc?Math.max(enL,bo):Math.min(enS,bo);
       pos=direction;active=1;anchor=entry;keyStop=lc?slL:slS;keyTarget=lc?tpL:tpS;
       pnl-=cost;count.nkeys++;
       if((lc&&low<=keyStop)||(sc&&high>=keyStop)){
         const exit=lc?Math.min(keyStop,bo):Math.max(keyStop,bo);
         pnl+=pos*(exit-anchor)-cost;pos=0;active=0;keyDone=true;
       }else if((lc&&high>=keyTarget)||(sc&&low<=keyTarget)){
         pnl+=pos*(keyTarget-anchor)-cost;count.ntarget++;pos=0;active=0;keyDone=true;
       }
     }
   }
 }
 if(pos){pnl+=pos*(cl-anchor);if(active){pnl-=cost;pos=0;}}
 const equity=previous.equity+pnl;
 peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,peak-equity);
 marks.push(equity);
 return {version:P40_VERSION,mode,paper_only:true,tradeable:false,
   pnl,held_end:pos,equity,marks,minute_drawdown:maxDrawdown,minute_adverse:mae,
   last_close:cl,last_contract:String(s.contract),has_prior:true,
   state:{pos,last_close:cl,last_contract:String(s.contract),has_prior:true,equity},
   key_long:long,key_short:short,counts:count};
}
