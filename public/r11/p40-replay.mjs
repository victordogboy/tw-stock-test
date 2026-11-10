// Exact archived A-shadow / P40 execution, separate from R11 intraday orders.
// P40 uses .75/.90 ATR minimum stops and its own lagged ATR loss gate.
// Never liquidate the shadow ledger between batches or use market returns as P40 PnL.
import {prepare,run,audit} from '../r26-engine/engine.mjs';
import {p193Weights} from './p193-weights.mjs';
export const REPLAY_VERSION='R11_P40_A_SHADOW_MINUTE_20261110';
function causalStop(s,side,p40){
 const af=Number.isFinite(s.atr)&&s.atr>0?s.atr:200;
 const dist=af*(p40?(s.sid?.75:.90):(s.sid?.55:.60)),hard=2*af;
 return side===1?Math.max(s.op-hard,...s.levels.filter(x=>x>0&&x<=s.op-dist)):
 Math.min(s.op+hard,...s.levels.filter(x=>x>0&&x>=s.op+dist));
}
export function simulateCausal(ss,bars,{fee=2.5,shadow=false,reentry=true,end='9999',liquidate=false,p40=false,minuteMarks=false}={}){
 let pos=0,st=0,lastCon='',lastCl=0,prev=-1,equity=0,peak=0,mdd=0,core=0,keys=0,stops=0,reentries=0,rows=[],events=[],pnls=Array(ss.length).fill(0),minuteEquity=[],minutePosition=[];
 for(let i=0;i<ss.length;i++){
  const s=ss[i];if(s.date<'2021-10-22'||s.date>end)continue;let pnl=0,desire=shadow?s.A:s.blocked?0:s.signal,af=Number.isFinite(s.atr)&&s.atr>0?s.atr:200,anchor=s.op,active=0,keyStop=0,keyTarget=0,stopdir=0,stopprice=0,stoppedAt=-1,recovered=false,keyDone=false;
  const event=(b,type,side,price)=>events.push({date:s.date,sid:s.sid,bar:b,type,side,price,contract:s.contract,start:s.start});
  if(pos&&prev>=0){if(s.contract===lastCon)pnl+=pos*(s.op-lastCl);else {pnl-=2*fee;event(0,'換月',pos,s.op)}}
  if(desire!==pos){if(pos){pnl-=fee;event(0,'開盤平倉',pos,s.op)}pos=desire;if(pos){pnl-=fee;core++;st=0;event(0,'核心進場',pos,s.op)}}
  if(pos)st=causalStop(s,pos,p40);let startPos=pos;
  for(let b=0;b<s.count;b++){
   let idx=(s.offset+b)*4,bo=bars[idx],hi=bars[idx+1],lo=bars[idx+2];
   if(b>0){let marked=equity+pnl+pos*(bars[idx-1]-anchor);if(minuteMarks){minuteEquity.push(marked);minutePosition.push(pos)}peak=Math.max(peak,marked);mdd=Math.max(mdd,peak-marked)}
   if(pos){let lev=active?keyStop:st;if(lev&&(pos>0?lo<=lev:hi>=lev)){let ex=pos>0?Math.min(lev,bo):Math.max(lev,bo);pnl+=pos*(ex-anchor)-fee;event(b,active?'關鍵價停損':'核心停損',pos,ex);if(!active){stops++;stopdir=pos;stopprice=ex;stoppedAt=b}else keyDone=true;pos=0;active=0;continue}
    if(active&&(pos>0?hi>=keyTarget:lo<=keyTarget)){pnl+=pos*(keyTarget-anchor)-fee;event(b,'關鍵價停利',pos,keyTarget);pos=0;active=0;keyDone=true;continue}
   }
   if(!pos&&stopdir&&!recovered&&!shadow&&reentry&&s.gate&&b>=stoppedAt+15&&b>stoppedAt){let trigger=stopprice+stopdir*.5*af;if(stopdir>0?hi>=trigger:lo<=trigger){let ent=stopdir>0?Math.ceil(Math.max(trigger,bo)):Math.floor(Math.min(trigger,bo));pos=stopdir;active=0;anchor=ent;recovered=true;reentries++;st=pos>0?Math.floor(ent-.55*af):Math.ceil(ent+.55*af);pnl-=fee;event(b,'停損再進場',pos,ent);if(pos>0?lo<=st:hi>=st){let ex=pos>0?Math.min(st,bo):Math.max(st,bo);pnl+=pos*(ex-anchor)-fee;event(b,'再進場同根停損',pos,ex);pos=0;continue}}}
   if(!pos&&!keyDone&&(shadow||!s.blocked)&&desire===0){let lc=s.long.entry>0&&hi>=s.long.entry,sc=s.short.entry>0&&lo<=s.short.entry;if(lc&&sc){keyDone=true;continue}if(lc||sc){pos=lc?1:-1;let plan=lc?s.long:s.short;anchor=lc?Math.max(plan.entry,bo):Math.min(plan.entry,bo);active=1;keyStop=plan.stop;keyTarget=plan.target;pnl-=fee;keys++;event(b,'關鍵價進場',pos,anchor);if(lc?lo<=keyStop:hi>=keyStop){let ex=lc?Math.min(keyStop,bo):Math.max(keyStop,bo);pnl+=pos*(ex-anchor)-fee;event(b,'關鍵價停損',pos,ex);pos=0;active=0;keyDone=true}else if(lc?hi>=keyTarget:lo<=keyTarget){pnl+=pos*(keyTarget-anchor)-fee;event(b,'關鍵價停利',pos,keyTarget);pos=0;active=0;keyDone=true}}}
  }
  if(pos){pnl+=pos*(s.cl-anchor);if(active&&!s.partial){pnl-=fee;event(s.count-1,'輔助單尾盤平倉',pos,s.cl);pos=0}}
  equity+=pnl;if(minuteMarks){minuteEquity.push(equity);minutePosition.push(pos)}peak=Math.max(peak,equity);mdd=Math.max(mdd,peak-equity);pnls[i]=pnl;
  rows.push({date:s.date,sid:s.sid,pnl,held:pos,signal:desire,blocked:!!s.blocked,atr:s.atr,market:s.market,recovered:+recovered,startPos,stop:active?keyStop:st,target:active?keyTarget:null,long:s.long,short:s.short,op:s.op,cl:s.cl,count:s.count,contract:s.contract});prev=i;lastCon=s.contract;lastCl=s.cl;
 }
 if(pos&&liquidate&&rows.length){rows.at(-1).pnl-=fee;pnls[prev]-=fee;if(minuteMarks)minuteEquity[minuteEquity.length-1]-=fee;eventEnd();}function eventEnd(){let s=ss[prev];events.push({date:s.date,sid:s.sid,bar:s.count-1,type:'樣本末結算費',side:pos,price:s.cl,contract:s.contract,start:s.start})}
 return {rows,events,minuteDD:mdd,core,keys,stops,reentries,pnls,position:pos,minuteEquity,minutePosition};
}

export function replayP40(meta,bars,{end='9999',liquidate=false,minuteMarks=false}={}){
 const ss=prepare(meta,bars);
 const shadow=simulateCausal(ss,bars,{shadow:true,reentry:false,end,liquidate:false});
 const alarms=ss.map((s,i)=>i>=2&&shadow.pnls[i-1]+shadow.pnls[i-2]<-2*s.atr);
 const r26alarms=ss.map((s,i)=>i>=2&&shadow.pnls[i-1]+shadow.pnls[i-2]<-750);
 for(let i=0;i<ss.length;i++){
  const s=ss[i],add=s.r10===0&&i>0&&ss[i-1].market/s.atr>.35&&s.gate&&s.tower===1&&s.ratio>1&&!s.guard;
  s.signal=add?1:s.r10;
  s.blocked=!add&&!!(alarms[i]||alarms[i-1]||alarms[i-2]||s.guard);
  s.r26blocked=!add&&!!(r26alarms[i]||r26alarms[i-1]||r26alarms[i-2]||s.guard);
 }
 const p40=simulateCausal(ss,bars,{end,liquidate,p40:true,minuteMarks});
 const priorPnl=[],priorMarket=[];
 for(const row of p40.rows){
  const s=ss.find(x=>x.date===row.date&&x.sid===row.sid);
  row.p193=priorPnl.length>=60?p193Weights(row.atr,row.sid?'day':'night',priorPnl,priorMarket):null;
  row.core_signal=s.signal;row.r26_blocked=s.r26blocked;
  row.r26_effective_signal=s.r26blocked?0:s.signal;
  priorPnl.push(row.pnl);priorMarket.push(row.market);
 }
 return {version:REPLAY_VERSION,paper_only:true,tradeable:false,p40,shadow,sessions:ss};
}

// This checkpoint describes the next *research* state, not a broker position.
export function nextP193State(result,target){
 if(!target||!['day','night'].includes(target.session))throw Error('INVALID_NEXT_SESSION');
 const rows=result.p40.rows,last=rows.at(-1),ss=result.sessions;
 if(!last||target.trade_date<last.date||(target.trade_date===last.date&&!(last.sid===0&&target.session==='day')))throw Error('NEXT_SESSION_NOT_AFTER_REPLAY');
 const days=ss.filter(s=>s.sid===1),lastDay=days.at(-1);
 if(lastDay.date>=target.trade_date)throw Error('NEXT_SESSION_DAILY_HISTORY_NOT_CAUSAL');
 const tr=days.map((s,i)=>Math.max(s.hi-s.lo,Math.abs(s.hi-(i?days[i-1].cl:s.op)),Math.abs(s.lo-(i?days[i-1].cl:s.op))));
 const atr=tr.slice(-20).reduce((a,b)=>a+b,0)/20;
 return {...p193Weights(atr,target.session,rows.map(r=>r.pnl),rows.map(r=>r.market)),
  trade_date:target.trade_date,session:target.session,completed_as_of:last.date+' '+(last.sid?'day':'night'),
  last_completed_day:lastDay.date,last_session_close:last.cl,status:'P193_RESEARCH_STATE',tradeable:false};
}
