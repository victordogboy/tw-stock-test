// R26-2TX ATR35 DD100: independent READ-ONLY paper-model live overlay.
// Never sends orders, never claims that historical entries are current broker positions.
// Prices and state derive only from source-validated 1-minute K, not the quote's 5s stream.
import {run} from './engine.mjs';
import {replayLive} from './live.mjs';
import {simulateLimitRisk} from '../r26-research/combined-breakout-risk.mjs';
import {priorDailyRegimes,regimeFlags} from '../r26-research/prior-regime-features.mjs';
import {replaySizedTape} from '../r26-research/five-lot-tape.mjs';

const CAPITAL=2_000_000,TX_MARGIN=701_000,RESERVE=300_000,POINT_NTD=200;
const FROZEN_NAME='R26-2TX-ATR35-DD100';
const valid=n=>Number.isFinite(n)?n:null;
const r2=x=>Math.round(x*100)/100;

export function replayTwoTxPaper(meta,originalBars,records,calendar,now=Date.now()){
 const live=replayLive(meta,originalBars,records,calendar,now,{includeResearchInputs:true});
 const issues=[...(live.issues||[])];
 const basis={name:FROZEN_NAME,paperOnly:true,model:'凍結研究版｜無實際委託',
  verifiedOriginalGold:true,asOf:live.as_of,issues,contract:live.session?.contract||null,
  sessionDate:live.session?.date||null,sid:live.session?.sid??null,
  source:live.session?.source||null,partial:!!live.session?.partial,
  freezeEnd:'2026-11-11 日盤',baseline1:{net:29657,dd:806},
  baseline2:{net:32001,dd:806},status:live.positionConfirmed?'verified-minute':'insufficient-data'};
 // Fail closed if the underlying R26 live replay lacks any complete prior session
 // or fails its own position-publication rule.
 if(!live.ready||!live.positionConfirmed||!live._research||!live.added){
  return {...basis,ready:false,warning:'指定月份分鐘K／歷史盤尚未完全核對，禁止發布當盤雙口策略訊號。',
   nextSession:live.nextSession?.start||null};
 }
 const {sessions:withTicks,bars}=live._research;
 const prepared=run({...meta,sessions:withTicks},bars,{end:'9999',liquidate:false});
 const past=priorDailyRegimes(prepared.sessions);
 const green=regimeFlags(past,r=>
   (r.atrSlope20<=-.25&&r.features?.mom5>2)||
   (r.atrPercentile250>=.7&&r.atrSlope5<=-.1&&r.features?.mom5>0)||
   (r.efficiency10>.8&&r.features?.mom5>1.5)||
   (r.efficiency20>=.8&&r.upDays10>=.5));
 const signal=simulateLimitRisk(prepared.sessions,bars,{
  end:'9999',fee:2.5,liquidate:false,
  risk:{
   preopenShortOnlyAboveATRDay:200,preopenShortOnlyAboveATRNight:195,
   highVolLongRescueFlags:green,equityDdCap:800,cooldownReset:true,haltSessions:8,
   resumeShadowLookback:8,resumeShadowProfit:0,shadowPnl:prepared.pnls,
   coreProfitProtect:{kind:'fraction',activateATR:1,fraction:.3}
  },
  limit:{anchor:'priorClose',entryMode:'breakout',entryATR:.005,
   entryWindow:30,onlySide:-1}
 });
 let currentPreopen=null;
 const result=replaySizedTape(prepared.sessions,bars,signal,{
  end:'9999',fee:2.5,maxLots:2,liquidate:false,
  sizeAtOpen:({index,priorEquity,priorDd})=>{
   const d=past[index],s=prepared.sessions[index];
   const account=CAPITAL+priorEquity*POINT_NTD;
   const can=Math.min(2,Math.max(0,Math.floor((account-RESERVE)/TX_MARGIN)));
   const add=!!(d.historyReady&&d.atrPercentile250<.35&&priorDd<100);
   const want=Math.min(can,add?2:1);
   if(index===prepared.sessions.length-1){
    currentPreopen={marketDate:s.date,sid:s.sid,atr20:valid(s.atr),
     atr250Percentile:valid(d.atrPercentile250),
     precedingEquityDd:valid(priorDd),accountEquityBeforeOpenNTD:r2(account),
     maxLotsByMarginBeforeOpen:can,wantsSecondLot:add&&can>=2,
     desiredLots:want,observedExtraTradeEligibility:add,
     dataBasedOnLastCompletedDay:d.price,knownPriorDayIndex:d.dayIndex};
   }
   return want;
  },
  marginGuard:{
   initialCapitalNTD:CAPITAL,perLotMarginNTD:TX_MARGIN,
   reserveNTD:RESERVE,pointValueNTD:POINT_NTD
  }
 });
 const row=result.rows.at(-1),frozenRow=signal.rows.at(-1),s=prepared.sessions.at(-1);
 if(!row||!frozenRow)throw Error('R26_2TX_EMPTY_SIGNAL');
 if(currentPreopen?.marketDate!==s.date||currentPreopen.sid!==s.sid)
  throw Error('R26_2TX_PREOPEN_ALIGNMENT');
 const events=result.tradeFills.filter(x=>x.date===s.date&&x.sid===s.sid);
 const modelPosition=row.endingLots;
 // Report predicted target and stop ONLY for the studied model, not a verified live brokerage state.
 const stop=Number(frozenRow.stop);
 const hasStop=modelPosition!==0&&Number.isFinite(stop)&&stop>0;
 const lastMinute=s.end;
 return {
  ...basis,ready:true,positionConfirmed:true,asOf:lastMinute,
  candidatePreopen:currentPreopen,
  modelLots:modelPosition,
  proposedAtOpenLots:currentPreopen?.desiredLots??null,
  coreSignal:frozenRow.signal,
  baseModelPosition:frozenRow.held,
  stopPrice:hasStop?stop:null,
  stopStatus:hasStop?'模型原始核心/關鍵價停損參考':'目前無有效、可確認的固定停損價',
  limitEntryType:'新空單：跌破前一盤同月合約收盤價−round(ATR×0.005)，有效30分鐘',
  profitProtection:'核心單浮盈達1ATR後，下一根1分K鎖住最大浮盈30%',
  profitPointsToDate:r2(result.net),
  oneLotPointsToDate:r2(signal.rows.reduce((a,x)=>a+x.pnl,0)),
  maxMinuteDrawdownToDate:r2(result.minuteDD),
  incrementalPoints:r2(result.net-signal.rows.reduce((a,x)=>a+x.pnl,0)),
  realizedOrMarked:'模型逐分鐘重播（含未平倉浮動損益；非券商實際損益）',
  equityNTDEstimated:r2(CAPITAL+result.net*POINT_NTD),
  marginRequiredNTD:Math.abs(modelPosition)*TX_MARGIN,
  marginBufferNTD:r2(CAPITAL+result.net*POINT_NTD-Math.abs(modelPosition)*TX_MARGIN),
  extraLotGapMarginReductions:result.gapMarginReductions,
  lastPaperFills:events.slice(-8),
  nextSession:live.nextSession?.start||null,
  warning:live.session?.partial?
   '當盤仍在進行：這是已完成分鐘K的暫時紙上部位，之後可能因新K棒改變。不可視為券商成交。':
   '完成盤已重播：紙上訊號並非實際帳戶倉位，下一盤須重新驗證。'
 };
}
