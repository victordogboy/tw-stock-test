// FC23 frozen rules, active R1489_H configuration. Costs match the original cash ledger.
const sum=a=>a.reduce((s,v)=>s+v,0),clip=(x,a,b)=>Math.max(a,Math.min(b,x));
const tick=p=>p<10?.01:p<50?.05:p<100?.1:p<500?.5:p<1000?1:5;
const up=p=>Math.round(Math.ceil((p-1e-8)/tick(p))*tick(p)*1e4)/1e4;
const down=p=>Math.round(Math.floor((p+1e-8)/tick(p))*tick(p)*1e4)/1e4;
export const BUY_COST=.0014275,SELL_COST=.0044275;
export function emptyFc23(codes,date){const zeros=()=>codes.map(()=>0);return {codes,date,t:-1,cash:1,qty:zeros(),basis:zeros(),peak:zeros(),held:codes.map(()=>-1),cool:zeros(),watchT:codes.map(()=>-99999),watchPrice:zeros(),atrEntry:zeros(),basket:false,bear:false,overlay:false,portRisk:false,ddGate:false,gate:1,cold:false,equity:[],entryDates:{},lastBuyDates:{},pendingSell:[]}}
const live=st=>st.qty.flatMap((q,j)=>q>1e-13?[j]:[]);
const stopGate=(x,held,pnl)=>held>=5&&pnl>=.10&&x.vr>=2&&x.rs5<-.02;
export function decideFc23(st,c){
 const {F}=c,t=st.t+1,current=live(st),held=st.held.map((h,j)=>h+(st.qty[j]>1e-13?1:0));
 let basket=st.basket,bear=st.bear,overlay=st.overlay,target=c.breadthDelta<-.16?.35:c.breadthDelta<-.08?.7:1;
 const weighted=n=>{const v=current.map(j=>st.qty[j]*F[j].p),total=sum(v);return sum(current.map((j,k)=>v[k]/Math.max(total,1e-12)*F[j][n]))};
 const g0=t-1,g1=g0-40,riskValue=t>=40?(st.equity[g0]??1)/Math.max(st.equity[g1]??1,1e-12)-1:0;
 const portRisk=t>=40&&riskValue<(st.portRisk?-.074:-.09);
 const prevNav=st.cash+sum(current.map(j=>st.qty[j]*F[j].p)),peak=Math.max(1,...st.equity),ddGate=prevNav/peak-1<-.12&&c.softWeak;
 if(t>=60&&current.length>=2){if(weighted('rs10')<-.035)basket=true;else if(weighted('rs5')>-.005)basket=false}
 if(basket)target*=.5;if(t>121){if(c.marketDown)bear=true;else if(c.marketUp)bear=false;if(bear)target*=.35}
 if(t>=65)overlay=c.market20<-.15;if(overlay)target*=.7;if(portRisk)target=0;if(c.cold)target*=.15;if(ddGate)target*=.1;target*=c.gate;
 const toSell=new Map(),early=new Set(),rank=F.map(()=>999),entrants=[],selected=new Set();
 for(const j of current){const x=F[j];let stop=!x.relaxed||x.r20<-.15||(st.peak[j]>0&&x.p/st.peak[j]-1<-.15);
  if(t>=22&&held[j]>=5&&x.rs20<-.20&&x.p<x.e20)stop=true;if(x.chipExit)stop=true;
  const extra=held[j]>=15&&x.p<x.e20&&x.rs20<-.07;
  if(extra&&!stop){early.add(j);stop=true}
  const riskextra=held[j]>=15&&x.rs5<-.03&&x.vr>=1.5&&x.downShare>=.65&&x.red&&c.breadth<.8;
  if(riskextra&&!stop){early.add(j);stop=true}
  if(!stop&&c.emergency&&x.p<x.e20&&x.rs5<-.06){early.add(j);stop=true}
  if(stop)toSell.set(j,'risk_exit');
 }
 for(const j of st.pendingSell)if(st.qty[j]>1e-13)toSell.set(j,'deferred_locked_exit');
 const top=F.map((_,j)=>j).filter(j=>F[j].base&&F[j].trend&&st.cool[j]===0&&Number.isFinite(F[j].score)).sort((a,b)=>F[b].score-F[a].score||b-a).slice(0,40);top.forEach((j,k)=>rank[j]=k+1);
 const rebal=t%20===0;
 if(rebal){for(const j of current)if(rank[j]>24&&held[j]>=20)toSell.set(j,'rank_exit');const stay=current.filter(j=>!toSell.has(j));for(const j of top.slice(0,30)){if(stay.includes(j)||toSell.has(j)||entrants.includes(j))continue;if(stay.length+entrants.length<8){entrants.push(j);continue}if(!stay.length)continue;const worst=stay.reduce((a,b)=>F[a].score<=F[b].score?a:b);if(held[worst]>=20&&F[j].score-F[worst].score>=.25){stay.splice(stay.indexOf(worst),1);toSell.set(worst,'replace');entrants.push(j)}}}
 if(t>1&&target>=.7&&!portRisk&&!ddGate&&!c.cold){const existing=current.filter(j=>!toSell.has(j));let remaining=8-existing.length-entrants.length;const best=F.map((_,j)=>j).sort((a,b)=>(F[b].base&&F[b].trend?F[b].score:-Infinity)-(F[a].base&&F[a].trend?F[a].score:-Infinity)||b-a).slice(0,8);for(const j of best){if(remaining<=0)break;if(existing.includes(j)||entrants.includes(j)||toSell.has(j))continue;const age=t-st.watchT[j];if(age<3||age>35||!F[j].reentry||!F[j].base||!F[j].trend||!Number.isFinite(F[j].score)||st.watchPrice[j]<=0||F[j].p<st.watchPrice[j])continue;entrants.push(j);selected.add(j);remaining--}}
 const riskRelease=(st.bear&&!bear)||(st.basket&&!basket)||(st.overlay&&!overlay)||(st.portRisk&&!portRisk);
 if(riskRelease&&!rebal){const alive=current.filter(j=>!toSell.has(j));for(const j of top.slice(0,30)){if(alive.length+entrants.length>=8)break;if(alive.includes(j)||toSell.has(j)||entrants.includes(j))continue;entrants.push(j)}}
 const rebalance=rebal||t%5===0||st.bear!==bear||st.basket!==basket||st.overlay!==overlay||st.portRisk!==portRisk||st.cold!==c.cold||st.ddGate!==ddGate||(t>=1&&Math.abs(c.gate-st.gate)>1e-8);
 return {F,t,current,held,basket,bear,overlay,portRisk,ddGate,target,toSell,early,rank,entrants,selected,rebal,riskRelease,rebalance};
}
export function planFc23(st,c,tradeDate){const d=decideFc23(st,c),actions=[];for(const j of d.current){const x=c.F[j],stop=down(Math.max(0,st.peak[j]*.9,st.peak[j]-2.8*Math.max(.005,x.atr)*x.p));actions.push({code:st.codes[j],side:d.toSell.has(j)?'SELL':'HOLD',method:d.toSell.has(j)?'SELL_OPEN':'HOLD',referencePrice:x.p,quantity:st.qty[j],reason:d.toSell.get(j)||'持續持有',stop,stopActive:stopGate(x,d.held[j],x.p/st.basis[j]-1),noFillPolicy:d.toSell.has(j)?'OPEN_UNCONDITIONAL':'CONTINUE_HOLDING'})}
 if(d.rebalance)actions.push({code:null,side:'REBALANCE',target:d.target,reason:'依FC23原引擎調整曝險與16%單股配置；補倉門檻1.6%淨值'});
 if(d.rebal||d.riskRelease||d.selected.size)for(const j of d.entrants){const x=c.F[j];actions.push({code:st.codes[j],side:'BUY',method:'BUY_STOP_BREAKOUT',referencePrice:x.p,researchLevel:up(x.p*(1+.1*clip(x.atr,.005,.25))),level:up(x.p*(1+x.buyLevel*clip(x.atr,.005,.25))),reason:d.selected.has(j)?'fc17_confirmed_reentry':'candidate',noFillPolicy:'NO_FILL_NO_BUY'})}
 return {model_version:'FC23',ledger:'FC23_paper',signal_as_of:st.date,trade_date:tradeDate,snapshot:{target:d.target,basket:d.basket,bear:d.bear,overlay:d.overlay,gate:c.gate},actions,decision:{rebalance:d.rebal,riskRelease:d.riskRelease,reentryCandidates:d.selected.size,portRisk:d.portRisk,ddGate:d.ddGate,marketCold:c.cold,breadth:c.breadth,breadthDelta:c.breadthDelta,market20:c.market20,target:d.target},readiness:'ready',executionRule:'FC23原始跳空／突破成交、開盤賣出及條件保護停損；淨值已扣往返總成本0.5855%'};
}
export function advanceFc23(st,day,c){
 const d=decideFc23(st,c),{F,t,target,toSell}=d;const rows=day.rows,px=rows.map((r,j)=>r.mark??r.close??F[j].p),op=rows.map((r,j)=>Number.isFinite(r.open)?r.open:px[j]);
 const valid=j=>rows[j].valid,exec=j=>rows[j].executable,upLock=j=>rows[j].lockUp,downLock=j=>rows[j].lockDown;
 const events=[],investment=()=>sum(st.qty.map((q,j)=>q*op[j]));st.held=d.held;
 const event=(j,side,type,price,q,reason,level=null,filled=true)=>events.push({date:day.date,signal:st.date,code:st.codes[j],side,orderType:type,price,quantity:q,notional:filled?q*price:0,reason,level,filled,ledger:'FC23_paper',executionTime:type==='MARKET_OPEN'?'09:00 開盤模擬':'日K觸價模擬（無逐筆時間）',...(side==='SELL'&&filled?{realizedPct:price/st.basis[j]-1,realizedNotional:q*(price-st.basis[j])}:{})});
 const reduce=(j,q,price,type,level,reason)=>{if(q<=1e-14)return;event(j,'SELL',type,price,q,reason,level);st.cash+=q*price*(1-SELL_COST);st.qty[j]-=q;
  if(st.qty[j]<=1e-13){if(['risk_exit','protective_stop'].includes(reason)){st.watchT[j]=t;st.watchPrice[j]=price}else{st.watchT[j]=-99999;st.watchPrice[j]=0}st.pendingSell=st.pendingSell.filter(k=>k!==j);st.qty[j]=0;st.held[j]=-1;st.peak[j]=0;st.basis[j]=0;st.atrEntry[j]=0;st.cool[j]=d.early.has(j)&&reason==='risk_exit'?5:['risk_exit','protective_stop','profit_take'].includes(reason)?10:0}};
 const add=(j,spend,price,type,level,reason)=>{if(spend<=1e-13||price<=0)return false;const q=spend/(price*(1+BUY_COST)),old=st.qty[j]*st.basis[j];st.qty[j]+=q;st.basis[j]=(old+spend)/st.qty[j];st.cash-=spend;st.watchT[j]=-99999;st.watchPrice[j]=0;if(st.held[j]<0){st.held[j]=0;st.peak[j]=t?F[j].p:price;st.entryDates[st.codes[j]]=day.date}st.lastBuyDates[st.codes[j]]=day.date;if(st.atrEntry[j]===0)st.atrEntry[j]=Math.max(.005,F[j].atr);event(j,'BUY',type,price,q,reason,level);return true};
 for(const [j,why] of [...toSell].sort((a,b)=>a[0]-b[0])){if(st.qty[j]<=1e-13)continue;if(!exec(j)||!valid(j)){if(!st.pendingSell.includes(j))st.pendingSell.push(j);continue}if(downLock(j)){if(!st.pendingSell.includes(j))st.pendingSell.push(j);event(j,'SELL','LOCKED_LIMIT_DOWN',null,0,'no_bid_no_fill',null,false);continue}reduce(j,st.qty[j],op[j],'MARKET_OPEN',null,why)}
 st.cool=st.cool.map(v=>Math.max(0,v-1));
 if(d.rebalance){let inv=investment(),n=st.cash+inv;if(inv>target*n+1e-10){const fac=Math.max(0,target*n/Math.max(inv,1e-10));for(const j of live(st))if(valid(j)&&!downLock(j))reduce(j,st.qty[j]*(1-fac),op[j],'MARKET_OPEN',null,'portfolio_reduce')}
 n=st.cash+investment();for(const j of live(st)){if(!valid(j)||downLock(j))continue;const v=st.qty[j]*op[j],lim=.16*n;if(v>lim+.002*n)reduce(j,(v-lim)/op[j],op[j],'MARKET_OPEN',null,'cap16')}
 }
 if(d.rebalance){const n=st.cash+investment();let room=Math.max(0,target*n-investment());if(room>.001*n)for(const j of live(st).sort((a,b)=>st.qty[a]*op[a]-st.qty[b]*op[b])){if(toSell.has(j)||!valid(j)||upLock(j))continue;const spend=Math.min(room,Math.max(0,.16*n-st.qty[j]*op[j]),st.cash);if(spend<=1e-12||spend<.016*n)continue;add(j,spend,op[j],'MARKET_OPEN',null,'topup');room-=spend}}
 let cashForBuys=st.cash;
 for(const j of live(st)){const x=F[j];if(!stopGate(x,st.held[j],x.p/st.basis[j]-1)||!exec(j)||!valid(j))continue;const stop=down(Math.max(0,st.peak[j]*.9,st.peak[j]-2.8*Math.max(.005,x.atr)*x.p));if(rows[j].low<=stop){if(downLock(j)){if(!st.pendingSell.includes(j))st.pendingSell.push(j);event(j,'SELL','LOCKED_LIMIT_DOWN',null,0,'protective_stop_unfilled',stop,false)}else reduce(j,st.qty[j],op[j]<=stop?op[j]:stop,'STOP',stop,'protective_stop')}}
 if(d.rebal||d.riskRelease||d.selected.size)for(const j of d.entrants){if(st.qty[j]>1e-13||!exec(j)||live(st).length>=8)continue;const x=F[j];if(!valid(j)){event(j,'BUY','INVALID_OHLC',null,0,'bad_market_data',null,false);continue}if(upLock(j)){event(j,'BUY','LOCKED_LIMIT_UP',null,0,'no_offer_no_fill',null,false);continue}const level=up(x.p*(1+x.buyLevel*clip(x.atr,.005,.25)));let fill=null,type='STOP_UNFILLED';if(op[j]>=level){fill=op[j];type='STOP_GAP_OPEN'}else if(rows[j].high>=level){fill=level;type='STOP_TOUCHED'}if(fill===null){event(j,'BUY',type,null,0,'no_touch_no_buy',level,false);continue}const n=st.cash+investment(),spend=Math.min(Math.max(0,cashForBuys),Math.max(0,target*n-investment()),n/8,.16*n);if(spend<=1e-12){event(j,'BUY','INSUFFICIENT_CASH',null,0,'target_exposure_full',level,false);continue}if(add(j,spend,fill,type,level,d.selected.has(j)?'fc17_confirmed_reentry':'new_position')){cashForBuys-=spend;if(stopGate(x,st.held[j],x.p/st.basis[j]-1)){const stop=down(fill*(1-2.8*clip(x.atr,.005,.25)));if(rows[j].low<=stop)reduce(j,st.qty[j],Math.min(fill,stop),'SAME_DAY_STOP',stop,'protective_stop')}}}
 const inv=sum(st.qty.map((q,j)=>q*px[j])),nav=st.cash+inv;for(const j of live(st))st.peak[j]=Math.max(st.peak[j],px[j]);
 const holdings=live(st).map(j=>({code:st.codes[j],quantity:st.qty[j],price:px[j],weight:st.qty[j]*px[j]/nav,days:st.held[j],peak:st.peak[j],rank:d.rank[j],score:F[j].score,avgEntryPrice:st.basis[j],entryDate:st.entryDates[st.codes[j]],lastBuyDate:st.lastBuyDates[st.codes[j]],costNotional:st.qty[j]*st.basis[j],marketNotional:st.qty[j]*px[j],unrealizedNotional:st.qty[j]*(px[j]-st.basis[j]),unrealizedPct:px[j]/st.basis[j]-1}));
 Object.assign(st,{date:day.date,t,basket:d.basket,bear:d.bear,overlay:d.overlay,portRisk:d.portRisk,ddGate:d.ddGate,gate:c.gate,cold:c.cold});st.equity.push(nav);
 return {snapshot:{date:day.date,signal:c.date,nav,exposure:inv/nav,target,t,holdings,basket:d.basket,bear:d.bear,overlay:d.overlay,gate:c.gate,breadthChange:c.breadthDelta,market20:c.market20},events};
}
