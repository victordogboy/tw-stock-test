// R26 experimental MAX-5 whole TX futures multi-lot replay.
// Consumes an independently simulated 1-TX trade EVENT TAPE and historical
// minute OHLC. Contract quantity is selected before opening a session;
// scaling a winning trade after seeing its same-session result is forbidden.
// This is an execution-ledger replay, NOT a fresh re-optimization of R26 signals.
const OPEN=new Set(['核心進場','停損再進場','關鍵價進場','限價核心進場']);
const CLOSE=new Set(['開盤平倉','核心停損','關鍵價停損','關鍵價停利','輔助單尾盤平倉','再進場同根停損','限價平倉','未成交尾盤市價平倉','權益風控停機','指定盤尾盤風控平倉']);

export function replaySizedTape(ss,bars,signal,{
 fee=2.5,end='2026-11-11',maxLots=5,sizeAtOpen=()=>1,
 drawdownCircuit=0,haltSessions=8,riskExitExtraSlip=0,
 openRebalance=true
}={}){
 if(!Number.isInteger(maxLots)||maxLots<1||maxLots>5)throw Error('MAX_FIVE_TX_ONLY');
 const eqSession=[],detailed=[],fills=[],events=new Map();
 for(const e of signal.events){
  const k=e.date+'-'+e.sid;
  if(!events.has(k))events.set(k,new Map());
  const bars=events.get(k);
  if(!bars.has(e.bar))bars.set(e.bar,[]);
  bars.get(e.bar).push(e);
 }
 let cash=0,qty=0,basis=0,peak=0,mdd=0,prevCon='',prevClose=NaN,first=true;
 // Global peak computes *whole-history* max DD; riskEpochPeak is separately
 // reset only after the complete scheduled cooldown of an emergency stop.
 let riskEpochPeak=0,riskEpochResetPending=false,riskEpochResets=0;
 let sessions=0,totalTradedLots=0,rebalanceLots=0,
  stopEvents=0,blockedUntil=-1,tradingDays=0;
 const round=x=>Math.round(x*1e8)/1e8;
 const changeQty=(newQty,px,date,sid,bar,type)=>{
  if(!Number.isInteger(newQty)||Math.abs(newQty)>maxLots)throw Error('BAD_MULTILOT_QTY');
  if(qty&&newQty&&Math.sign(qty)!==Math.sign(newQty))throw Error('REVERSAL_MUST_CLOSE_FIRST');
  // Mark all held contracts at the execution price, then buy/sell delta.
  if(qty)cash+=qty*(px-basis);
  const executed=Math.abs(newQty-qty);
  if(executed){cash-=executed*fee;totalTradedLots+=executed;
   fills.push({date,sid,bar,type,price:px,old:qty,qty:newQty,executed});}
  qty=newQty;basis=px;
  return executed;
 };
 for(let i=0;i<ss.length;i++){
  const s=ss[i];if(s.date<'2021-10-22'||s.date>end)continue;
  if(riskEpochResetPending&&i>=blockedUntil){
   // A newly eligible session starts a fresh *local* risk budget.
   // Never reset the global performance high water or whole-history MDD.
   if(qty!==0)throw Error('EMERGENCY_COOLDOWN_SHOULD_BE_FLAT');
   riskEpochPeak=cash;riskEpochResetPending=false;riskEpochResets++;
  }
  const at=events.get(s.date+'-'+s.sid)||new Map();
  const opens=at.get(0)||[];
  const carryClose=opens.some(e=>CLOSE.has(e.type));
  const prevCash=cash;
  // All permitted features are known before opening this session.
  const sizeRaw=sizeAtOpen({index:i,s,priorEquity:cash,
   priorDd:Math.max(0,peak-cash),prevClose:Number.isFinite(prevClose)?prevClose:null,
   priorPnls:eqSession.slice(-20).map(r=>r.pnl),
   frozenBaselinePrior:signal.rows.slice(Math.max(0,sessions-20),sessions).map(x=>x.pnl)});
  let wanted=Math.trunc(Number(sizeRaw));
  if(!Number.isFinite(wanted))throw Error('INVALID_PREMARKET_SIZE');
  wanted=Math.max(0,Math.min(maxLots,wanted));
  const blocked=i<blockedUntil;
  if(blocked)wanted=0;
  if(!first&&qty){
   if(prevCon!==s.contract){
    // Exact parity with frozen R26: rollover costs TWO per-side fees,
    // new contract basis starts at the current contract open, no spread P&L.
    cash-=2*fee*Math.abs(qty);totalTradedLots+=2*Math.abs(qty);
    fills.push({date:s.date,sid:s.sid,bar:0,type:'換月',price:s.op,
       old:qty,qty,executed:2*Math.abs(qty)});
    basis=s.op;
   }else{
    cash+=qty*(s.op-basis);basis=s.op;
   }
  }
  const frozenCarry=signal.rows?.[sessions-1]?.held??0;
  // If the independent one-lot signal still carries a core position and
  // our separate sizing overlay was flat last session (e.g., cooldown),
  // we may rejoin at THIS opening, never at a previous fill price.
  // When the frozen model closes at bar zero, it MUST close before any
  // scaling/re-entry rather than opening a redundant contract.
  if(openRebalance&&!carryClose&&frozenCarry){
   const targetQty=Math.sign(frozenCarry)*wanted;
   if(targetQty!==qty){
    if(qty&&Math.sign(qty)!==Math.sign(targetQty)&&targetQty!==0)throw Error('SIDED_POSITION_MISMATCH');
    rebalanceLots+=Math.abs(qty-targetQty);
    changeQty(targetQty,s.op,s.date,s.sid,0,'盤前增減碼');
   }
  }
  if(openRebalance&&!carryClose&&!frozenCarry&&qty)throw Error('LEDGER_MODEL_CARRY_MISMATCH');
  let isCircuitStopped=false;
  // Equity updates after each complete minute; this ledger replays original
  // price of stop/entry fills and mark-to-market using this minute CLOSE.
  for(let bar=0;bar<s.count;bar++){
   const ptr=(s.offset+bar)*4,bo=bars[ptr],hi=bars[ptr+1],lo=bars[ptr+2],cl=bars[ptr+3];
   if(qty&&drawdownCircuit>0){
    const q=qty,floor=riskEpochPeak-drawdownCircuit;
    const px=basis+(floor+Math.abs(q)*fee-cash)/q;
    const hit=q>0?lo<=px:hi>=px;
    if(hit){
     const ex=(q>0?Math.min(px,bo):Math.max(px,bo))-Math.sign(q)*riskExitExtraSlip;
     changeQty(0,ex,s.date,s.sid,bar,'五口組合獨立權益停機');
     stopEvents++;isCircuitStopped=true;blockedUntil=Math.max(blockedUntil,i+1+haltSessions);
     riskEpochResetPending=true;
    }
   }
   if(!isCircuitStopped&&!blocked){
    for(const e of at.get(bar)||[]){
     if(e.type==='換月'||e.type==='樣本末結算費')continue;
     if(CLOSE.has(e.type)){
      if(qty){
       if(Math.sign(qty)!==e.side)throw Error('INCONSISTENT_CLOSE_SIDE '+s.date+' '+e.type);
       changeQty(0,e.price,s.date,s.sid,bar,e.type);
      }
     }else if(OPEN.has(e.type)){
      if(qty)throw Error('OVERLAPPING_MULTILOT_POSITION '+s.date+' '+e.type);
      if(wanted>0)changeQty(e.side*wanted,e.price,s.date,s.sid,bar,e.type);
     }
    }
   }
   const marked=cash+qty*(cl-basis);
   if(!Number.isFinite(marked))throw Error('NONFINITE_EQUITY');
   peak=Math.max(peak,marked);mdd=Math.max(mdd,peak-marked);
   if(!riskEpochResetPending)riskEpochPeak=Math.max(riskEpochPeak,marked);
  }
  if(qty)cash+=qty*(s.cl-basis);
  basis=s.cl;
  if(i===ss.length-1&&qty){
   // Mirror frozen end-of-sample terminal cost (not a physical trade).
   cash-=fee*Math.abs(qty);
   fills.push({date:s.date,sid:s.sid,bar:s.count-1,type:'樣本末結算費',price:s.cl,
    old:qty,qty,executed:Math.abs(qty)});
  }
  peak=Math.max(peak,cash);mdd=Math.max(mdd,peak-cash);
  if(!riskEpochResetPending)riskEpochPeak=Math.max(riskEpochPeak,cash);
  const pnl=round(cash-prevCash);
  eqSession.push({date:s.date,sid:s.sid,pnl,endingLots:qty,requestedLots:wanted,
    equity:round(cash)});
  first=false;prevCon=s.contract;prevClose=s.cl;sessions++;
 }
 return {net:round(cash),minuteDD:round(mdd),ratio:round(cash/(mdd||1)),
  sessionCount:sessions,rows:eqSession,tradeFills:fills,
  tradedContracts:totalTradedLots,rebalanceLots,stopEvents,blockedUntil,riskEpochResets,
  heldLots:qty,peak:round(peak),maxLots};
}
