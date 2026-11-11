import {stop} from '../r26-engine/engine.mjs';
// R26 RESEARCH ONLY: combined pre-market breakout orders + equity-circuit breaker.
// No live trading dependency; baseline, breakout-only, and risk-only strict parity tested.
export function simulateLimitRisk(ss,bars,{fee=2.5,shadow=false,reentry=true,end='9999',liquidate=true,limit={},risk={}}={}){
 let pos=0,st=0,lastCon='',lastCl=0,prev=-1,equity=0,peak=0,mdd=0,core=0,keys=0,stops=0,reentries=0,rows=[],events=[],pnls=Array(ss.length).fill(0);
 let pnl=0,activeTrade=null,closedTrades=[],missEntry=0,missExit=0,limitEntries=0,limitExits=0,eligibleEntries=0,eligibleExits=0;
 let riskPeak=0,riskResetPending=false,resetCount=0,resumeAt=-1,hardStops=0,skippedSessions=0;
 const riskTimeline=[];
 const terminal=new Set(['開盤平倉','核心停損','關鍵價停損','關鍵價停利','輔助單尾盤平倉','再進場同根停損','限價平倉','未成交尾盤市價平倉','權益風控停機','指定盤尾盤風控平倉']);
 const beginnings=new Set(['核心進場','停損再進場','關鍵價進場','限價核心進場']);
 const addPnl=v=>{pnl+=v;if(activeTrade)activeTrade.pnl+=v;};
 for(let i=0;i<ss.length;i++){
  const s=ss[i];if(s.date<'2021-10-22'||s.date>end)continue;pnl=0;let desire=shadow?s.A:s.blocked?0:s.signal,af=Number.isFinite(s.atr)&&s.atr>0?s.atr:200,anchor=s.op,active=0,keyStop=0,keyTarget=0,stopdir=0,stopprice=0,stoppedAt=-1,recovered=false,keyDone=false;
  // All risk gates use the original, position-independent shadow's COMPLETED
  // sessions only, never the current paper trade's future P&L.
  let riskBlocked=i<resumeAt;
  if(riskResetPending&&i>=resumeAt){
   const lookback=Number(risk.resumeShadowLookback||0);
   const recent=lookback&&Array.isArray(risk.shadowPnl)?
    risk.shadowPnl.slice(Math.max(0,i-lookback),i).reduce((a,b)=>a+b,0):0;
   if(!lookback||recent>=Number(risk.resumeShadowProfit||0)){
    riskResetPending=false;riskPeak=equity;resetCount++;
    riskTimeline.push({type:'恢復交易',date:s.date,sid:s.sid,bar:0,resetEquity:equity,shadowRecent:recent});
   }else riskBlocked=true;
  }
  // All experimental pre-opening filters use the last COMPLETED close of
  // this exact contract, ATR and already-known R26 stop. No current open.
  const premarketClose=prev>=0&&lastCon===s.contract?lastCl:null;
  if(risk.preopenMaxATR!=null&&af>Number(risk.preopenMaxATR))riskBlocked=true;
  if(risk.onlySid!=null&&s.sid!==Number(risk.onlySid))riskBlocked=true;
  if(risk.preopenShortOnlyAboveATR!=null&&af>Number(risk.preopenShortOnlyAboveATR)&&desire>0)riskBlocked=true;
  if(risk.preopenShortOnlyAboveATRRatio!=null&&desire>0&&
    (premarketClose===null||af/premarketClose>Number(risk.preopenShortOnlyAboveATRRatio)))riskBlocked=true;
  if(risk.preopenLongOnlyAboveATR!=null&&af>Number(risk.preopenLongOnlyAboveATR)&&desire<0)riskBlocked=true;
  if(risk.shadowLookbackMin!=null&&Array.isArray(risk.shadowPnl)){
   const n=Number(risk.shadowLookbackMin);
   const observed=risk.shadowPnl.slice(Math.max(0,i-n),i).reduce((a,b)=>a+b,0);
   if(i<n||observed<Number(risk.minShadowProfit||0))riskBlocked=true;
  }
  if(risk.preopenMaxATRRRatio!=null&&
    (premarketClose===null||af/premarketClose>Number(risk.preopenMaxATRRRatio)))riskBlocked=true;
  if(risk.preopenMaxStopDistance!=null&&desire&&
    (premarketClose===null||Math.abs(premarketClose-stop(s,desire))>Number(risk.preopenMaxStopDistance)))riskBlocked=true;
  if(risk.onlyDirection!=null&&desire&&desire!==Number(risk.onlyDirection))riskBlocked=true;
  if(riskBlocked){desire=0;skippedSessions++;}
  const riskCap=Number(risk.equityDdCap||0);
  let riskTripped=false;
  const event=(b,type,side,price)=>{
   events.push({date:s.date,sid:s.sid,bar:b,type,side,price,contract:s.contract,start:s.start});
   if(beginnings.has(type)){
     if(activeTrade)throw Error('R26_LIMIT_OVERLAPPING_POSITIONS');
     activeTrade={type,entryDate:s.date,entrySid:s.sid,entryBar:b,entryPrice:price,side,pnl:-fee};
   }
   if(terminal.has(type)&&activeTrade){
     activeTrade.exitDate=s.date;activeTrade.exitSid=s.sid;activeTrade.exitBar=b;
     activeTrade.exitPrice=price;activeTrade.exitType=type;
     closedTrades.push(activeTrade);activeTrade=null;
   }
  };
  if(pos&&prev>=0){if(s.contract===lastCon)addPnl(pos*(s.op-lastCl));else {addPnl(-(2*fee));event(0,'換月',pos,s.op)}}
  const knownAtr=Number.isFinite(s.atr)&&s.atr>0?s.atr:200;
  const validPrior=limit.anchor!=='priorClose'||(prev>=0&&lastCon===s.contract);
  const reference=limit.anchor==='priorClose'&&validPrior?lastCl:s.op;
  const entryOffset=Math.max(0,Math.round(knownAtr*Number(limit.entryATR||0)));
  // This gate is chosen before seeing the current session's OHLC. It uses
  // only the previous completed session equity, R26 direction and ATR.
  const preOpenDd=Math.max(0,riskPeak-equity);
  const preOpenLimitAllowed=(!limit.onlySide||desire===Number(limit.onlySide))&&
   (limit.atrMin==null||knownAtr>=Number(limit.atrMin))&&
   (limit.atrMax==null||knownAtr<=Number(limit.atrMax))&&
   (limit.ddMin==null||preOpenDd>=Number(limit.ddMin))&&
   (limit.ddMax==null||preOpenDd<=Number(limit.ddMax));
  const exitOffset=Math.max(0,Math.round(knownAtr*Number(limit.exitATR||0)));
  const entryWindow=Math.max(1,Math.min(s.count,Number(limit.entryWindow||s.count)));
  const exitWindow=Math.max(1,Math.min(s.count,Number(limit.exitWindow||s.count)));
  let pendingEntry=0,pendingExit=0,pendingExitPrice=0,pendingEntryPrice=0,marketAfterExit=false,exitFillBar=-1;
  if(desire!==pos){
   if(pos){
    if(exitOffset>0&&validPrior){
     pendingExit=pos;pendingExitPrice=reference+pos*exitOffset;eligibleExits++;
    }else{
     // No known same-contract prior close at rollover -> original market exit.
     addPnl(-(fee));event(0,'開盤平倉',pos,s.op);pos=0;
    }
   }
   if(!pos&&desire){
    if(entryOffset>0&&preOpenLimitAllowed){
     if(validPrior){pendingEntry=desire;pendingEntryPrice=reference+(limit.entryMode==='breakout'?desire:-desire)*entryOffset;eligibleEntries++}
     else missEntry++;
    }else{
     pos=desire;addPnl(-(fee));core++;st=0;event(0,'核心進場',pos,s.op);
    }
   }
  }
  if(pos){
   st=stop(s,pos);
   if(risk.coreMaxStopPoints!=null&&Number(risk.coreMaxStopPoints)>0){
    const distance=Number(risk.coreMaxStopPoints);
    st=pos>0?Math.max(st,s.op-distance):Math.min(st,s.op+distance);
   }
  }
  let startPos=pos;
  for(let b=0;b<s.count;b++){
   let idx=(s.offset+b)*4,bo=bars[idx],hi=bars[idx+1],lo=bars[idx+2];
   if(b>0){
    const marked=equity+pnl+pos*(bars[idx-1]-anchor);
    peak=Math.max(peak,marked);
    if(!riskResetPending)riskPeak=Math.max(riskPeak,marked);
    mdd=Math.max(mdd,peak-marked);
   }
   // Budget is calculated from the last completed minute's high water, never
   // the current minute high. A gap across the trigger executes at the gap open.
   if(pos&&!riskTripped&&riskCap>0){
    const floor=(risk.cooldownReset?riskPeak:peak)-riskCap;
    const threshold=anchor+pos*(floor-equity-pnl+fee);
    if(pos>0?lo<=threshold:hi>=threshold){
     const theoretical=pos>0?Math.min(Math.floor(threshold),bo):Math.max(Math.ceil(threshold),bo);
     const actual=theoretical-pos*Math.max(0,Number(risk.hardStopSlippagePoints||0));
     addPnl(pos*(actual-anchor)-fee);event(b,'權益風控停機',pos,actual);
     riskTimeline.push({type:'權益風控停機',date:s.date,sid:s.sid,bar:b,side:pos,
       theoretical,actual,cap:riskCap,equity,peak,periodPeak:riskPeak});
     pos=0;active=0;riskTripped=true;hardStops++;
     pendingExit=0;pendingEntry=0;stopdir=0;keyDone=true;
     resumeAt=Math.max(resumeAt,i+1+Number(risk.haltSessions||0));
     if(risk.cooldownReset)riskResetPending=true;
     continue;
    }
   }
   if(pos){let lev=active?keyStop:st;if(lev&&(pos>0?lo<=lev:hi>=lev)){let ex=pos>0?Math.min(lev,bo):Math.max(lev,bo);addPnl(pos*(ex-anchor)-fee);event(b,active?'關鍵價停損':'核心停損',pos,ex);if(!active){stops++;stopdir=pos;stopprice=ex;stoppedAt=b}else keyDone=true;pos=0;active=0;continue}
    if(active&&(pos>0?hi>=keyTarget:lo<=keyTarget)){addPnl(pos*(keyTarget-anchor)-fee);event(b,'關鍵價停利',pos,keyTarget);pos=0;active=0;keyDone=true;continue}
   }
   if(pos&&pendingExit&&b<exitWindow){
    const touch=pos>0?hi>=pendingExitPrice:lo<=pendingExitPrice;
    if(touch){
     // The limit may already be marketable at open. Use the more favorable
     // actual open in that case; never fill at a worse price than the limit.
     const fill=pos>0?Math.max(pendingExitPrice,bo):Math.min(pendingExitPrice,bo);
     addPnl(pos*(fill-anchor)-fee);event(b,'限價平倉',pos,fill);
     pos=0;pendingExit=0;limitExits++;exitFillBar=b;
     if(desire){
      pendingEntry=desire;pendingEntryPrice=reference+(limit.entryMode==='breakout'?desire:-desire)*entryOffset;
      marketAfterExit=entryOffset===0;eligibleEntries++;
     }
    }
   }
   if(!pos&&!riskBlocked&&!riskTripped&&pendingEntry&&b<entryWindow&&b>exitFillBar){
    const touched=marketAfterExit||
     (limit.entryMode==='breakout'?
       (pendingEntry>0?hi>=pendingEntryPrice:lo<=pendingEntryPrice):
       (pendingEntry>0?lo<=pendingEntryPrice:hi>=pendingEntryPrice));
    if(touched){
     // Opposite signal after delayed exit is submitted no earlier than the
     // NEXT minute. Never claim both fills in an ambiguous same OHLC bar.
     const side=pendingEntry;
     const fillBeforeExtraSlippage=marketAfterExit?bo:
      limit.entryMode==='breakout'?
       (side>0?Math.max(pendingEntryPrice,bo):Math.min(pendingEntryPrice,bo)):
       (side>0?Math.min(pendingEntryPrice,bo):Math.max(pendingEntryPrice,bo));
     // Stop entries may gap beyond the planned trigger AND suffer slippage.
     // Apply adverse fill slippage to every triggered breakout in the stress
     // runs; zero by default to retain exact prior simulator parity.
     const extraSlippage=limit.entryMode==='breakout'&&!marketAfterExit?
       Math.max(0,Number(limit.breakoutSlippagePoints||0)):0;
     const ent=fillBeforeExtraSlippage+side*extraSlippage;
     let protective=stop(s,side);
     if(risk.coreMaxStopPoints!=null&&Number(risk.coreMaxStopPoints)>0){
      const dist=Number(risk.coreMaxStopPoints);
      protective=side>0?Math.max(protective,ent-dist):Math.min(protective,ent+dist);
     }
     if(side>0?protective<ent:protective>ent){
      pos=side;anchor=ent;st=protective;active=0;pendingEntry=0;
      addPnl(-(fee));core++;limitEntries++;event(b,'限價核心進場',pos,ent);
      if(pos>0?lo<=st:hi>=st){
       const ex=pos>0?Math.min(st,bo):Math.max(st,bo);
       addPnl(pos*(ex-anchor)-fee);event(b,'核心停損',pos,ex);
       stops++;stopdir=pos;stopprice=ex;stoppedAt=b;pos=0;continue;
      }
      if(riskCap>0&&pos){
       // For a newly triggered breakout stop-entry, the SAME minute can also
       // touch the equity risk level. Treat it as an immediate adverse exit.
       const floor=(risk.cooldownReset?riskPeak:peak)-riskCap;
       const threshold=anchor+pos*(floor-equity-pnl+fee);
       if(pos>0?lo<=threshold:hi>=threshold){
        const theoretical=pos>0?Math.min(Math.floor(threshold),bo):Math.max(Math.ceil(threshold),bo);
        const actual=theoretical-pos*Math.max(0,Number(risk.hardStopSlippagePoints||0));
        addPnl(pos*(actual-anchor)-fee);event(b,'權益風控停機',pos,actual);
        riskTimeline.push({type:'新倉權益風控停機',date:s.date,sid:s.sid,bar:b,side:pos,
          theoretical,actual,cap:riskCap,equity,peak,periodPeak:riskPeak});
        pos=0;active=0;riskTripped=true;hardStops++;
        pendingEntry=0;pendingExit=0;stopdir=0;keyDone=true;
        resumeAt=Math.max(resumeAt,i+1+Number(risk.haltSessions||0));
        if(risk.cooldownReset)riskResetPending=true;
        continue;
       }
      }
     }
    }
   }
   if(!pos&&!riskBlocked&&!riskTripped&&!risk.disableReentry&&stopdir&&!recovered&&!shadow&&reentry&&s.gate&&b>=stoppedAt+15&&b>stoppedAt){let trigger=stopprice+stopdir*.5*af;if(stopdir>0?hi>=trigger:lo<=trigger){let ent=stopdir>0?Math.ceil(Math.max(trigger,bo)):Math.floor(Math.min(trigger,bo));pos=stopdir;active=0;anchor=ent;recovered=true;reentries++;st=pos>0?Math.floor(ent-.55*af):Math.ceil(ent+.55*af);
     if(risk.coreMaxStopPoints!=null&&Number(risk.coreMaxStopPoints)>0){
      const dist=Number(risk.coreMaxStopPoints);
      st=pos>0?Math.max(st,ent-dist):Math.min(st,ent+dist);
     }
     addPnl(-(fee));event(b,'停損再進場',pos,ent);if(pos>0?lo<=st:hi>=st){let ex=pos>0?Math.min(st,bo):Math.max(st,bo);addPnl(pos*(ex-anchor)-fee);event(b,'再進場同根停損',pos,ex);pos=0;continue}}}
   if(!pos&&!riskBlocked&&!riskTripped&&!risk.disableKey&&!keyDone&&(shadow||!s.blocked)&&desire===0){let lc=s.long.entry>0&&hi>=s.long.entry,sc=s.short.entry>0&&lo<=s.short.entry;if(lc&&sc){keyDone=true;continue}if(lc||sc){pos=lc?1:-1;let plan=lc?s.long:s.short;anchor=lc?Math.max(plan.entry,bo):Math.min(plan.entry,bo);active=1;keyStop=plan.stop;keyTarget=plan.target;addPnl(-(fee));keys++;event(b,'關鍵價進場',pos,anchor);if(lc?lo<=keyStop:hi>=keyStop){let ex=lc?Math.min(keyStop,bo):Math.max(keyStop,bo);addPnl(pos*(ex-anchor)-fee);event(b,'關鍵價停損',pos,ex);pos=0;active=0;keyDone=true}else if(lc?hi>=keyTarget:lo<=keyTarget){addPnl(pos*(keyTarget-anchor)-fee);event(b,'關鍵價停利',pos,keyTarget);pos=0;active=0;keyDone=true}}}
  }
  if(pendingEntry)missEntry++;
  if(pendingExit){
   missExit++;
   if(limit.exitUnfilled==='marketClose'&&pos){
    addPnl(pos*(s.cl-anchor)-fee);
    event(s.count-1,'未成交尾盤市價平倉',pos,s.cl);
    pos=0;
   }
  }
  if(pos){
   addPnl(pos*(s.cl-anchor));
   if(!active&&!s.partial&&((risk.flatAfterNight&&s.sid===0)||(risk.flatAfterDay&&s.sid===1))){
    addPnl(-fee);event(s.count-1,'指定盤尾盤風控平倉',pos,s.cl);pos=0;
   }
   if(active&&!s.partial){addPnl(-(fee));event(s.count-1,'輔助單尾盤平倉',pos,s.cl);pos=0}
  }
  equity+=pnl;peak=Math.max(peak,equity);
  if(!riskResetPending)riskPeak=Math.max(riskPeak,equity);
  mdd=Math.max(mdd,peak-equity);pnls[i]=pnl;
  rows.push({date:s.date,sid:s.sid,pnl,held:pos,signal:desire,blocked:!!s.blocked,atr:s.atr,market:s.market,recovered:+recovered,startPos,stop:active?keyStop:st,target:active?keyTarget:null,long:s.long,short:s.short,op:s.op,cl:s.cl,count:s.count,contract:s.contract});prev=i;lastCon=s.contract;lastCl=s.cl;
 }
 if(pos&&liquidate&&rows.length){rows.at(-1).pnl-=fee;pnls[prev]-=fee;if(activeTrade){activeTrade.pnl-=fee;activeTrade.exitDate=ss[prev].date;activeTrade.exitSid=ss[prev].sid;activeTrade.exitType='樣本末結算費';closedTrades.push(activeTrade);activeTrade=null}eventEnd();}function eventEnd(){let s=ss[prev];events.push({date:s.date,sid:s.sid,bar:s.count-1,type:'樣本末結算費',side:pos,price:s.cl,contract:s.contract,start:s.start})}
 return {rows,events,minuteDD:mdd,core,keys,stops,reentries,pnls,position:pos,closedTrades,limitEntries,limitExits,eligibleEntries,eligibleExits,missEntry,missExit,hardStops,skippedSessions,resetCount,riskTimeline};
}
