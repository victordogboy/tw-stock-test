// EXPERIMENTAL R26 core-profit exit overlay, isolated from frozen engine.
// All signals, ATR, key levels, shadow guard and re-entry conditions come
// from the unchanged canonical run(meta,bars). No session can read its future.
// Two-sided bars: protective stop is checked before fixed profit at every bar.
// Trailing level at bar N is calculated using bars THROUGH N-1 only.
import {stop} from '../r26-engine/engine.mjs';

export function researchSimulate(ss,bars,{fee=2.5,end='9999',liquidate=true,protect={kind:'none'}}={}){
 let pos=0,st=0,lastCon='',lastCl=0,prev=-1,equity=0,peak=0,mdd=0;
 let core=0,keys=0,stops=0,reentries=0,protectStops=0,protectTargets=0;
 const rows=[],events=[],closedTrades=[],pnls=Array(ss.length).fill(0);
 let trade=null;
 const event=(s,b,type,side,price)=>events.push({date:s.date,sid:s.sid,bar:b,type,side,price,contract:s.contract,start:s.start});
 const money=(delta)=>{pnl+=delta;if(trade)trade.pnl+=delta};
 const fresh=(s,side,entry,type,af,b)=>{
  trade={side,entry,exit:null,type,entryDate:s.date,entrySid:s.sid,entryBar:b,entryAtr:af,
   pnl:0,best:entry,ref:entry,startContract:s.contract,exitType:null,exitDate:null,
   protected:0};
 };
 const done=(s,b,type,price)=>{
  if(!trade)return;
  Object.assign(trade,{exit:price,exitType:type,exitDate:s.date,exitSid:s.sid,exitBar:b});
  closedTrades.push(trade);
  trade=null;
 };
 function coreStop(s,af){
  if(!trade||protect.kind==='none')return st;
  const side=trade.side,atr=trade.entryAtr||af,entry=trade.ref;
  const gain=Math.max(0,side*(trade.best-entry)),kind=protect.kind;
  const start=Number(protect.start||0),lock=Number(protect.lock||0),dist=Number(protect.distance||0);
  let proposed=null;
  if(kind==='breakeven'&&gain>=start*atr)proposed=entry+side*lock*atr;
  if(kind==='trail'&&gain>=start*atr)proposed=trade.best-side*dist*atr;
  if(kind==='lock'&&gain>=start*atr)proposed=entry+side*lock*gain;
  if(proposed===null)return st;
  const snapped=side===1?Math.floor(proposed):Math.ceil(proposed);
  trade.protected++;
  return side===1?Math.max(st,snapped):Math.min(st,snapped);
 }
 let pnl=0;
 for(let i=0;i<ss.length;i++){
  const s=ss[i];if(s.date<'2021-10-22'||s.date>end)continue;
  pnl=0;
  const desire=s.blocked?0:s.signal;
  const af=Number.isFinite(s.atr)&&s.atr>0?s.atr:200;
  let anchor=s.op,active=0,keyStop=0,keyTarget=0,stopdir=0,stopprice=0,stoppedAt=-1;
  let recovered=false,keyDone=false;
  if(pos&&prev>=0){
   if(s.contract===lastCon)money(pos*(s.op-lastCl));
   else{
    money(-2*fee);
    event(s,0,'換月',pos,s.op);
    // The new contract is not a price-adjusted continuation: reset trail.
    if(trade){trade.best=s.op;trade.ref=s.op;trade.entryAtr=af}
   }
  }
  if(desire!==pos){
   if(pos){money(-fee);event(s,0,'開盤平倉',pos,s.op);done(s,0,'開盤平倉',s.op)}
   pos=desire;
   if(pos){fresh(s,pos,s.op,'core',af,0);money(-fee);core++;st=0;event(s,0,'核心進場',pos,s.op)}
  }
  if(pos)st=stop(s,pos);
  const startPos=pos;
  for(let b=0;b<s.count;b++){
   const idx=(s.offset+b)*4,bo=bars[idx],hi=bars[idx+1],lo=bars[idx+2];
   if(b>0){
    const marked=equity+pnl+pos*(bars[idx-1]-anchor);
    peak=Math.max(peak,marked);mdd=Math.max(mdd,peak-marked);
   }
   if(pos){
    const lev=active?keyStop:coreStop(s,af);
    if(lev&&(pos>0?lo<=lev:hi>=lev)){
     const ex=pos>0?Math.min(lev,bo):Math.max(lev,bo);
     money(pos*(ex-anchor)-fee);
     const changed=!active&&lev!==st;
     const tag=active?'關鍵價停損':changed?'核心獲利保護出場':'核心停損';
     event(s,b,tag,pos,ex);done(s,b,tag,ex);
     if(!active){
      stops++;
      if(changed)protectStops++;
      stopdir=pos;stopprice=ex;stoppedAt=b;
     }else keyDone=true;
     pos=0;active=0;continue;
    }
    if(active&&(pos>0?hi>=keyTarget:lo<=keyTarget)){
     money(pos*(keyTarget-anchor)-fee);
     event(s,b,'關鍵價停利',pos,keyTarget);
     done(s,b,'關鍵價停利',keyTarget);
     pos=0;active=0;keyDone=true;continue;
    }
    if(!active&&protect.kind==='fixed'&&trade){
     const target=trade.ref+pos*protect.targetATR*trade.entryAtr;
     if(pos>0?hi>=target:lo<=target){
      const ex=pos>0?Math.max(target,bo):Math.min(target,bo);
      money(pos*(ex-anchor)-fee);event(s,b,'核心固定停利',pos,ex);
      done(s,b,'核心固定停利',ex);
      protectTargets++;pos=0;active=0;continue;
     }
    }
   }
   if(!pos&&stopdir&&!recovered&&s.gate&&b>=stoppedAt+15&&b>stoppedAt){
    const trigger=stopprice+stopdir*.5*af;
    if(stopdir>0?hi>=trigger:lo<=trigger){
     const ent=stopdir>0?Math.ceil(Math.max(trigger,bo)):Math.floor(Math.min(trigger,bo));
     pos=stopdir;active=0;anchor=ent;recovered=true;reentries++;
     st=pos>0?Math.floor(ent-.55*af):Math.ceil(ent+.55*af);
     fresh(s,pos,ent,'reentry',af,b);money(-fee);event(s,b,'停損再進場',pos,ent);
     if(pos>0?lo<=st:hi>=st){
      const ex=pos>0?Math.min(st,bo):Math.max(st,bo);
      money(pos*(ex-anchor)-fee);event(s,b,'再進場同根停損',pos,ex);
      done(s,b,'再進場同根停損',ex);pos=0;continue;
     }
    }
   }
   if(!pos&&!keyDone&&!s.blocked&&desire===0){
    const lc=s.long.entry>0&&hi>=s.long.entry,sc=s.short.entry>0&&lo<=s.short.entry;
    if(lc&&sc){keyDone=true;continue}
    if(lc||sc){
     pos=lc?1:-1;
     const plan=lc?s.long:s.short;
     anchor=lc?Math.max(plan.entry,bo):Math.min(plan.entry,bo);
     active=1;keyStop=plan.stop;keyTarget=plan.target;
     fresh(s,pos,anchor,'key',af,b);money(-fee);keys++;event(s,b,'關鍵價進場',pos,anchor);
     if(lc?lo<=keyStop:hi>=keyStop){
      const ex=lc?Math.min(keyStop,bo):Math.max(keyStop,bo);
      money(pos*(ex-anchor)-fee);event(s,b,'關鍵價停損',pos,ex);
      done(s,b,'關鍵價停損',ex);pos=0;active=0;keyDone=true;
     }else if(lc?hi>=keyTarget:lo<=keyTarget){
      money(pos*(keyTarget-anchor)-fee);event(s,b,'關鍵價停利',pos,keyTarget);
      done(s,b,'關鍵價停利',keyTarget);pos=0;active=0;keyDone=true;
     }
    }
   }
   // Existing bar OHLC modifies the stop only from minute b+1 onward.
   if(pos&&!active&&trade&&protect.kind!=='none'){
    const favorable=pos===1?hi:lo;
    if(pos===1)trade.best=Math.max(trade.best,favorable);
    else trade.best=Math.min(trade.best,favorable);
   }
  }
  if(pos){
   money(pos*(s.cl-anchor));
   if(active&&!s.partial){
    money(-fee);event(s,s.count-1,'輔助單尾盤平倉',pos,s.cl);
    done(s,s.count-1,'輔助單尾盤平倉',s.cl);pos=0;
   }
  }
  equity+=pnl;peak=Math.max(peak,equity);mdd=Math.max(mdd,peak-equity);pnls[i]=pnl;
  rows.push({date:s.date,sid:s.sid,pnl,held:pos,signal:desire,blocked:!!s.blocked,atr:s.atr,
   market:s.market,recovered:+recovered,startPos,stop:active?keyStop:st,
   target:active?keyTarget:null,long:s.long,short:s.short,op:s.op,cl:s.cl,count:s.count,contract:s.contract});
  prev=i;lastCon=s.contract;lastCl=s.cl;
 }
 if(pos&&liquidate&&rows.length){
  rows.at(-1).pnl-=fee;pnls[prev]-=fee;
  event(ss[prev],ss[prev].count-1,'樣本末結算費',pos,ss[prev].cl);
  if(trade){trade.pnl-=fee;done(ss[prev],ss[prev].count-1,'樣本末結算費',ss[prev].cl);}
 }
 return {rows,events,minuteDD:mdd,core,keys,stops,reentries,pnls,position:pos,
  closedTrades,protectStops,protectTargets};
}
