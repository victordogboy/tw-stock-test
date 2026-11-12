#!/usr/bin/env python3
"""R294-R301: daily OHLC, next-day PRECOMMITTED order simulator, no same-day OHLC peek.
Source signal engine: R290 / R167 / R99 research code; 233 2026-stock-futures names RETROSPECTIVELY.
Not actual stock futures, not a true out-of-sample test. Orders on raw daily STOCK OHLC.
ALL fills are hypothetical; limit-locked/ambiguous executions and intraday sequence are unknown.
"""
from __future__ import annotations
import sys, time, json, re, zipfile, shutil
from pathlib import Path
import numpy as np, pandas as pd
ROOT=Path('/mnt/data/r324_r399');ROOT.mkdir(exist_ok=True)
sys.path.insert(0,'/mnt/data/r170_work')
import run_r170 as r
m=r.m
P=m.P; K=m.K; D=m.dates;N=len(D);M=len(K); a=m.a;z=m.z
BASE=m.BASE;TREND=m.TREND;RELAX=m.RELAX;B=m.B;R20=m.R20;EMA20=m.EMA20;RS20=m.RS20;RS60=m.RS60;RS5=m.RS5; SCORE=m.S; atr=m.ATR
EXEC=m.execute;market=m.market;ma20=m.ma20;ma60=m.ma60;ma120=m.ma120
assert M==233 and N==1407

# Price data. Build native OHLC matrix; the existing feature cache CLOSE agrees with these raw closes.
def load_ohlc():
 fn='/mnt/data/FinMind_All_TWSE_TPEX_Daily_20180101_20261027_ALL.csv.gz'
 df=pd.read_csv(fn,usecols=['date','stock_id','open','high','low','close'],dtype={'stock_id':str},parse_dates=['date'])
 df=df[df.stock_id.isin(K) & df.date.isin(D)].copy()
 di=pd.Index(D); ki=pd.Index(K)
 ti=di.get_indexer(df.date); sj=ki.get_indexer(df.stock_id)
 o=np.full((N,M),np.nan); h=o.copy();l=o.copy(); c=o.copy()
 o[ti,sj]=df.open.values;h[ti,sj]=df.high.values;l[ti,sj]=df.low.values;c[ti,sj]=df.close.values
 valid=(np.isfinite(o)&np.isfinite(h)&np.isfinite(l)&np.isfinite(c)&(o>0)&(l>0)&(h>=l)&(o>=l-1e-9)&(o<=h+1e-9)&(c>=l-1e-9)&(c<=h+1e-9))
 bad=int(np.sum(np.isfinite(c)&~valid))
 overlap=np.isfinite(c)&np.isfinite(P[a:z+1]);max_diff=float(np.max(np.abs(c[overlap]-P[a:z+1][overlap])))
 print('OHLC good',int(valid.sum()),'bad',bad,'close diff',max_diff,flush=True)
 assert max_diff<5e-4
 return o,h,l,c,valid,bad
O,H,L,C,VALID,BAD=load_ohlc()
# Reject hypothetical fills when a one-price price-limit lock implies no opposing liquidity.
PREV_CLOSE=P[a-1:z]
ONE_PRICE=(np.abs(H-L)<1e-9)&(np.abs(O-H)<1e-9)&(np.abs(C-H)<1e-9)&VALID
LOCK_UP=ONE_PRICE&(C/np.maximum(PREV_CLOSE,1e-8)>1.08)
LOCK_DOWN=ONE_PRICE&(C/np.maximum(PREV_CLOSE,1e-8)<.92)

def cash_tick(price:float)->float:
 if price<10:return .01
 if price<50:return .05
 if price<100:return .1
 if price<500:return .5
 if price<1000:return 1.
 return 5.
def tick_down(price:float)->float:
 return round(np.floor((price+1e-8)/cash_tick(price))*cash_tick(price),4)
def tick_up(price:float)->float:
 return round(np.ceil((price-1e-8)/cash_tick(price))*cash_tick(price),4)

# All signal indices have a-1 and below, OHLC t corresponds 2021/1/6...2026/10/27.

# Each variant changes the order method, NOT the stock-selection/market-risk logic.
VARIANTS={
 'R294_OPEN_OPEN':dict(entry='open',exit='open',protect=False),
 'R295_LIMIT_HOLD':dict(entry='pullback',exit='open',protect=True,pull_atr=.50,miss_buy='skip',tp_atr=0),
 'R296_BREAK_HOLD':dict(entry='breakout',exit='open',protect=True,break_atr=.25,miss_buy='skip',tp_atr=0),
 'R297_LIMIT_CLOSE':dict(entry='pullback',exit='open',protect=True,pull_atr=.50,miss_buy='close',tp_atr=0),
 'R298_BREAK_CLOSE':dict(entry='breakout',exit='open',protect=True,break_atr=.25,miss_buy='close',tp_atr=0),
 'R299_LIMIT_TP4':dict(entry='pullback',exit='open',protect=True,pull_atr=.50,miss_buy='skip',tp_atr=4),
 'R300_LIMIT_TP4_CLOSE':dict(entry='pullback',exit='open',protect=True,pull_atr=.50,miss_buy='close',tp_atr=4),
 'R301_OPEN_TP4':dict(entry='open',exit='open',protect=True,tp_atr=4),
 'R302_LIMIT_EXIT_HOLD':dict(entry='pullback',exit='limit_hold',protect=True,pull_atr=.5,miss_buy='skip',tp_atr=0),
 'R303_LIMIT_EXIT_CLOSE':dict(entry='pullback',exit='limit_close',protect=True,pull_atr=.5,miss_buy='skip',tp_atr=0),
 'R304_LIMIT025_ONLY':dict(entry='pullback',exit='open',protect=False,pull_atr=.25,miss_buy='skip'),
 'R305_LIMIT050_ONLY':dict(entry='pullback',exit='open',protect=False,pull_atr=.50,miss_buy='skip'),
 'R306_LIMIT100_ONLY':dict(entry='pullback',exit='open',protect=False,pull_atr=1.0,miss_buy='skip'),
 'R307_BREAK025_ONLY':dict(entry='breakout',exit='open',protect=False,break_atr=.25,miss_buy='skip'),
 'R308_BREAK050_ONLY':dict(entry='breakout',exit='open',protect=False,break_atr=.5,miss_buy='skip'),
 'R309_LIMIT025_CLOSE_ONLY':dict(entry='pullback',exit='open',protect=False,pull_atr=.25,miss_buy='close'),
 'R310_LIMIT050_CLOSE_ONLY':dict(entry='pullback',exit='open',protect=False,pull_atr=.5,miss_buy='close'),
 'R311_BREAK025_CLOSE_ONLY':dict(entry='breakout',exit='open',protect=False,break_atr=.25,miss_buy='close'),
 'R312_OPEN_STOP5':dict(entry='open',exit='open',protect=True,stop_atr=5),
 'R313_LIMIT050_STOP5':dict(entry='pullback',exit='open',protect=True,pull_atr=.5,miss_buy='skip',stop_atr=5),
 'R314_OPEN_STOP5_TP8':dict(entry='open',exit='open',protect=True,stop_atr=5,tp_atr=8),
 'R315_LIMIT025_STOP5':dict(entry='pullback',exit='open',protect=True,pull_atr=.25,miss_buy='skip',stop_atr=5),
 'R316_LIMIT050_CLOSE_STOP5':dict(entry='pullback',exit='open',protect=True,pull_atr=.5,miss_buy='close',stop_atr=5),
 'R317_LIMIT050_CLOSE_STOP5_TP8':dict(entry='pullback',exit='open',protect=True,pull_atr=.5,miss_buy='close',stop_atr=5,tp_atr=8),
 'R318_LIMIT025_NEXTOPEN':dict(entry='pullback',exit='open',protect=False,pull_atr=.25,miss_buy='next_open'),
 'R319_LIMIT050_NEXTOPEN':dict(entry='pullback',exit='open',protect=False,pull_atr=.5,miss_buy='next_open'),
 'R320_BREAK025_NEXTOPEN':dict(entry='breakout',exit='open',protect=False,break_atr=.25,miss_buy='next_open'),
 'R321_LIMIT025_NEXTOPEN_STOP5':dict(entry='pullback',exit='open',protect=True,pull_atr=.25,miss_buy='next_open',stop_atr=5),
 'R322_LIMIT025_CLOSE_LIMITSELL':dict(entry='pullback',exit='limit_close',protect=False,pull_atr=.25,miss_buy='close'),
 'R323_LIMIT025_CLOSE_LIMITSELL_HOLD':dict(entry='pullback',exit='limit_hold',protect=False,pull_atr=.25,miss_buy='close'),
}
# OHLC single-bar ambiguity: on positions with a stop and take-profit both touched, assume stop fills first.
# For same-day NEW buys, if low touches stop, conservatively mark stopped despite inability to know sequence.
# Selection / risk unchanged from R290. For protection use prev-close peak and prev ATR (ATR is dimensionless fraction).

LOG_COLUMNS=['version','signal_date','execution_date','ticker','action','order_type','limit_or_stop','open','high','low','close','fill_price','filled','reason','shares_proxy','notional_proxy','realized_pct','ambiguity']

def simulate(name:str, detailed=False):
 cfg=VARIANTS[name]
 qty=np.zeros(M);cash=1.;held=np.full(M,-1,int);peak=np.zeros(M);cool=np.zeros(M,int)
 basis=np.zeros(M);atr_entry=np.zeros(M); cycle_buy=np.zeros(M);cycle_sell=np.zeros(M);cycles=[]
 equity=np.empty(N);expos=np.empty(N);turn=np.zeros(N);maxw=np.empty(N)
 buy=sell=swaps=0;pending_buy={};pending_sell=set();EV_PENDING=8;EV_LAST_EXIT_SCORE=-np.inf;EV_STOCKCAP_ACTIVE=False;EV_STOCKCAP_PREV=FC09_CAP;fc17_watch_t=np.full(M,-99999,dtype=int);fc17_watch_price=np.zeros(M,float);fc17_selected=set();stat={'entry_intent':0,'entry_fill':0,'entry_nofill':0,'gap_entries':0,'stop_fills':0,'tp_fills':0,'dual_touch':0,'bad_ohlc_skips':0,'hard_exit_open':0,'close_fallback':0,'stops_new_day':0,'pending_fills':0,'pending_expired':0,'locked_buy_skips':0,'locked_sell_skips':0}
 orders=[];closed=[];positions=[];plans=[]; state=False; basket_risk=False; overlay_risk=False
 prev_target=0;port_risk=False;dd_gate=False;risk_recover=False;recover_level=1.;dd_level=1.;gate_history=np.zeros(N,dtype=np.int8);gate_target=np.ones(N,dtype=float)
 def event(t,j,act,typ,lv,price,filled,reason,shares,realized=None,amb=False):
  if not detailed:return
  orders.append((name, str(D[t-1].date()) if t else str(m.D[m.a-1].date()),str(D[t].date()), K[j],act,typ,round(float(lv),5) if np.isfinite(lv) else None,
                 float(O[t,j]) if np.isfinite(O[t,j]) else None,float(H[t,j]) if np.isfinite(H[t,j]) else None,float(L[t,j]) if np.isfinite(L[t,j]) else None,float(C[t,j]) if np.isfinite(C[t,j]) else None,
                 round(float(price),5) if np.isfinite(price) else None,bool(filled),reason, float(shares),float(shares*price) if filled else 0, float(realized) if realized is not None else None,bool(amb)))
 def reduce(t,j,q,price,typ,lv,reason,amb=False):
  nonlocal cash, sell, EV_PENDING, EV_LAST_EXIT_SCORE
  if q<=1e-14:return
  cash+=q*price*(1-SELL_COST);qty[j]-=q;sell+=1;cycle_sell[j]+=q*price;turn[t]+=q*price/max(prev_nav,1e-10)
  entry=basis[j];rtn=price/entry-1 if entry>0 else np.nan
  if detailed:closed.append((name,D[t].strftime('%Y-%m-%d'),K[j],float(q),float(entry),float(price),100*float(rtn),reason))
  event(t,j,'SELL',typ,lv,price,True,reason,q,100*rtn,amb)
  if qty[j]<=1e-13:
   EV_PENDING=min(8,EV_PENDING+1)
   if EV_ONLY_STRONGER and np.isfinite(score_line[j]):
    EV_LAST_EXIT_SCORE = float(score_line[j]) if not np.isfinite(EV_LAST_EXIT_SCORE) else min(EV_LAST_EXIT_SCORE,float(score_line[j]))
   if FC17_ENABLE and (reason in ('risk_exit','protective_stop') or (FC17_EXIT_ALL and reason in ('rank_exit','replace'))):
    fc17_watch_t[j]=t;fc17_watch_price[j]=float(price)
   else:
    fc17_watch_t[j]=-99999;fc17_watch_price[j]=0.
   pending_sell.discard(j)
   if cycle_buy[j]>1e-13:cycles.append((name,str(D[t].date()),K[j],100*(cycle_sell[j]/cycle_buy[j]-1),cycle_buy[j],cycle_sell[j],reason))
   cycle_buy[j]=cycle_sell[j]=0
   qty[j]=0;held[j]=-1;peak[j]=0;basis[j]=0;atr_entry[j]=0;cool[j]=(COOLDOWN_EARLY if j in extra_sells and reason=='risk_exit' else (10 if reason in ('risk_exit','protective_stop','profit_take') else 0))
   if EV_LOSS_COOLDOWN>10 and reason in ('risk_exit','protective_stop') and rtn<0:cool[j]=max(cool[j],EV_LOSS_COOLDOWN)
 def add(t,j,spend,price,typ,lv,reason):
  nonlocal cash,buy,EV_PENDING,EV_LAST_EXIT_SCORE
  if spend<=1e-13 or price<=0:return False
  if reason in ('new_position','fc17_confirmed_reentry','previous_limit_missed') and spend/(1+BUY_COST)<EV_MIN_NEW_NAV:return False
  q=spend/(price*(1+BUY_COST)); oldv=qty[j]*basis[j];qty[j]+=q;basis[j]=(oldv+spend)/qty[j];cash-=spend;cycle_buy[j]+=spend
  fc17_watch_t[j]=-99999;fc17_watch_price[j]=0.
  if held[j]<0:held[j]=0;peak[j]=P[a+t-1,j] if t else price
  if atr_entry[j]==0:atr_entry[j]=max(.005,float(atr[a+t-1,j]))
  if reason in ('new_position','fc17_confirmed_reentry','previous_limit_missed'):
   EV_PENDING=max(0,EV_PENDING-1)
   if EV_PENDING==0:EV_LAST_EXIT_SCORE=-np.inf
  buy+=1;turn[t]+=spend/max(prev_nav,1e-10)
  event(t,j,'BUY',typ,lv,price,True,reason,q)
  return True
 for t,i in enumerate(range(a,z+1)):
  px=P[i];sig=i-1;current=np.flatnonzero(qty>1e-13);prev_nav=cash+float(np.dot(qty[current],P[i-1,current]))
  prev_port_risk=port_risk
  prev_dd_gate=dd_gate
  port_risk=False
  if RISK_WINDOW>0 and t+1-RISK_LAG-RISK_WINDOW>=0:
   g0=t-RISK_LAG;g1=g0-RISK_WINDOW
   recent_nav=float(equity[g0]) if g0>=0 else 1.
   distant_nav=float(equity[g1]) if g1>=0 else 1.
   risk_value=recent_nav/max(distant_nav,1e-12)-1
   port_risk=(risk_value < (RISK_RELEASE if prev_port_risk else RISK_THRESHOLD))
  gate_history[t]=int(port_risk)
  acct_peak=max(1.,float(np.max(equity[:t])) if t else 1.)
  acct_dd=prev_nav/acct_peak-1.
  dd_gate=(acct_dd<DD_TRIG) and bool(SOFT_WEAK[sig])
  prev_recover_level=recover_level;prev_dd_level=dd_level
  recover_level=1.
  if RECOVER_ON:
   if port_risk:risk_recover=True
   elif risk_recover and risk_value>RECOVER_END:risk_recover=False
   if risk_recover and not port_risk:
    recover_level=min(1.,max(RECOVER_FLOOR,RECOVER_FLOOR+(1.-RECOVER_FLOOR)*(risk_value-RISK_RELEASE)/max(RECOVER_END-RISK_RELEASE,1e-6)))
  dd_level=1.
  if DD_SMOOTH and SOFT_WEAK[sig]:
   if acct_dd<DD_TRIG:dd_level=DD_MULT
   elif acct_dd<DD_TRIG+DD_WIDTH*.50:dd_level=DD_MID
   elif acct_dd<DD_TRIG+DD_WIDTH:dd_level=DD_HIGH

  held[current]+=1
  # Same market and portfolio risk state from R290, but with actual current holdings.
  delta=B[sig]-B[max(0,sig-10)];target=(.35 if delta<-.16 else (.7 if delta<-.08 else 1.)) if FC09_BREADTH_DELEVER else 1.
  prevstate=state;prev_basket_risk=basket_risk;prev_overlay=overlay_risk
  if t>=60 and len(current)>=2:
   v=qty[current]*P[sig,current];w=v/max(v.sum(),1e-12)
   r5=float(np.dot(w,RS5[sig,current]));r20=float(np.dot(w,RS20[sig,current]))
   r10=float(np.dot(w,np.clip(P[sig,current]/np.maximum(P[sig-10,current],1e-9)-1-(market[t-1]/market[t-11]-1),-1,1)))
   if r10<BASKET_ENTER:basket_risk=True
   elif r5>BASKET_EXIT:basket_risk=False
  if basket_risk and FC09_BASKET_DELEVER:target*=BASKET_MULT
  if t>121:
   k=t-1;down=(market[k]<ma120[k] and ma20[k]<ma60[k]);up=(market[k]>ma60[k] and ma20[k]>ma60[k]);
   if down:state=True
   elif up:state=False
   if state and FC09_MARKET_TREND_DELEVER:target*=.35
  if t>=65:
   overlay_risk=(market[t-1]/market[t-21]-1<-.15)
  if overlay_risk and FC09_OVERLAY_DELEVER:target*=.70
  if port_risk:target*=RISK_FRACTION
  if MARKET_COLD[sig]:target*=MARKET_MULT
  if DD_SMOOTH:target*=dd_level
  elif dd_gate:target*=DD_MULT
  target*=recover_level
  gate_target[t]=target
  target*=RISK_GATES[cfg.get('risk_gate','none')][sig]
  # Prior-close account drawdown and breadth; event-based single-stock concentration cap.
  ev_stockcap_weak=bool(B[sig]<EV_STOCKCAP_BREADTH)
  if EV_STOCKCAP_ON:
   if not EV_STOCKCAP_ACTIVE and acct_dd<=EV_STOCKCAP_TRIGGER and ev_stockcap_weak:EV_STOCKCAP_ACTIVE=True
   elif EV_STOCKCAP_ACTIVE and (acct_dd>=EV_STOCKCAP_RELEASE or (EV_STOCKCAP_MARKET_RELEASE and B[sig]>=EV_STOCKCAP_RECOVER_BREADTH)):EV_STOCKCAP_ACTIVE=False
  EV_STOCKCAP_NOW=EV_STOCKCAP_LOW if EV_STOCKCAP_ACTIVE else FC09_CAP
  EV_STOCKCAP_CHANGE=abs(EV_STOCKCAP_NOW-EV_STOCKCAP_PREV)>1e-10
  EV_STOCKCAP_PREV=EV_STOCKCAP_NOW
  EV_STOCKCAP_HISTORY[t]=EV_STOCKCAP_NOW

  # Note baseline overlay signals event every 5 trading days or state switch.
  rebal=False;to_sell=set();reason={};extra_sells=set()
  for j in current:
   stop=(FC09_RELAX_EXIT and not bool(RELAX[sig,j])) or (FC09_R20_EXIT and R20[sig,j]<-.15) or (FC09_PEAK_EXIT and peak[j]>0 and P[sig,j]/peak[j]-1<-.15)
   if FC09_RELATIVE_EXIT and t>=22 and held[j]>=5 and RS20[sig,j]<RELATIVE_EXIT and P[sig,j]<EMA20[sig,j]:stop=True
   if CHIP_EXIT_MAP[cfg.get('chip_exit','none')][sig,j]:stop=True
   extra=False
   if EXTRA_RULE and held[j]>=EXTRA_MIN_HOLD and np.isfinite(RS5[sig,j]) and np.isfinite(RS20[sig,j]) and np.isfinite(P[sig,j]):
    emabelow=bool(P[sig,j]<EMA20[sig,j])
    if EXTRA_RULE==1:extra=emabelow and RS5[sig,j]<-EXTRA_THR
    elif EXTRA_RULE==2:extra=emabelow and RS5[sig,j]<-EXTRA_THR and RS20[sig,j]<0
    elif EXTRA_RULE==3:extra=emabelow and RS20[sig,j]<-EXTRA_THR
    elif EXTRA_RULE==4:extra=R20[sig,j]<-EXTRA_THR and RS5[sig,j]<-.01
    elif EXTRA_RULE==5:extra=peak[j]>0 and (P[sig,j]/peak[j]-1)<-EXTRA_THR and RS5[sig,j]<0
    elif EXTRA_RULE==6:extra=emabelow and RS5[sig,j]<-EXTRA_THR and B[sig]<.65
    elif EXTRA_RULE==7:extra=emabelow and RS5[sig,j]<-EXTRA_THR and RS20[sig,j]<-.02 and B[sig]<.65
   if extra and not stop:extra_sells.add(j);stop=True
   riskextra=False
   if RISK_MODE and held[j]>=RISK_MIN_HOLD and np.isfinite(RS5[sig,j]) and np.isfinite(RS20[sig,j]):
    weak5=RS5[sig,j]<-RISK_THR;weak20=RS20[sig,j]<-RISK_THR
    emaweak=P[sig,j]<EMA20[sig,j];br=float(B[sig]);brdrop=br-B[max(0,sig-10)]
    volshock=VOL_RATIO[sig,j]>=RISK_VOL;downvol=DOWN_SHARE[sig,j]>=RISK_DOWN
    red=(P[sig,j]<P[sig-1,j]) if sig>=1 else False
    if RISK_MODE==1:riskextra=emaweak and weak5 and br<RISK_BREADTH
    elif RISK_MODE==2:riskextra=emaweak and weak5 and br>RISK_BREADTH
    elif RISK_MODE==3:riskextra=emaweak and weak5 and brdrop<-RISK_BREADTH
    elif RISK_MODE==4:riskextra=emaweak and weak5 and volshock and red
    elif RISK_MODE==5:riskextra=emaweak and weak5 and downvol
    elif RISK_MODE==6:riskextra=emaweak and weak20 and volshock and red
    elif RISK_MODE==7:riskextra=weak5 and volshock and downvol and red
    elif RISK_MODE==8:riskextra=emaweak and weak5 and (br<RISK_BREADTH or (volshock and red))
    elif RISK_MODE==9:riskextra=emaweak and weak5 and (brdrop<-RISK_BREADTH or downvol)
    elif RISK_MODE==10:riskextra=weak5 and downvol and br<RISK_BREADTH
    elif RISK_MODE==11:riskextra=weak5 and volshock and downvol and red and br<RISK_BREADTH
    elif RISK_MODE==12:riskextra=weak5 and volshock and downvol and red and brdrop<-RISK_BREADTH
    elif RISK_MODE==13:riskextra=weak5 and volshock and downvol and red and br<RISK_BREADTH and brdrop<0
    elif RISK_MODE==14:riskextra=weak5 and volshock and downvol and red and (t>=21 and market[t-1]<market[t-21])
    elif RISK_MODE==15:riskextra=weak5 and volshock and downvol and red and (t>=61 and market[t-1]<market[t-61])
   if riskextra and not stop:extra_sells.add(j);stop=True;stat['new_exit']=stat.get('new_exit',0)+1
   emergency_code=0
   if EMG_MODE and not stop:
    ed=bool(EMG_DROP[sig,j]);bb=bool(EMG_BIGBEAR[sig,j]);brk=bool(EMG_BREAK10[sig,j]);vshock=bool(EMG_VOL[sig,j]);sys=bool(EMG_SYS[sig])
    if EMG_MODE in (1,4,5,6,7,8) and ed and brk:emergency_code=1
    if EMG_MODE in (2,4,6,7,8) and bb and vshock and RS5[sig,j]<EMG_RS:emergency_code=2
    if EMG_MODE in (3,4,5,6,8) and sys:emergency_code=3
    if EMG_MODE==7 and sys and (brk or bb):emergency_code=3
    if EMG_MODE==9 and sys and (brk or bb) and RS5[sig,j]<-.025:emergency_code=4
    if EMG_MODE==10 and sys and P[sig,j]<EMA20[sig,j] and RS5[sig,j]<-.06:emergency_code=5
    if EMG_MODE==11 and sys and basis[j]>0 and P[sig,j]/basis[j]-1<=-.08:emergency_code=6
    if EMG_MODE==12 and ed and brk and vshock and RS5[sig,j]<-.05:emergency_code=7
    if EMG_MODE==13 and ed and brk and basis[j]>0 and P[sig,j]/basis[j]-1<-.06:emergency_code=8
    if EMG_MODE==14 and sys and brk and (vshock or RS5[sig,j]<-.04):emergency_code=9
    if emergency_code:
     extra_sells.add(j);stop=True;stat['emergency_exit']=stat.get('emergency_exit',0)+1
     if held[j]<15:stat['emergency_under15']=stat.get('emergency_under15',0)+1

   if stop:to_sell.add(j);reason[j]='risk_exit'
  for j in pending_sell:
   if qty[j]>1e-13:to_sell.add(j);reason[j]='deferred_locked_exit'
  score_line=SCORE[sig]+CHIP_BONUSES[cfg.get('chip_score','none')][sig]+EXTRA_RANK_BONUS[sig]+FC13_WEIGHT*FC13_BONUS[sig]+FC15_WEIGHT*FC15_FEATURE[sig]
  cand=np.where(BASE[sig]&(TREND[sig] | (not FC09_TREND_GATE))&(cool==0),score_line,-np.inf).copy()
  top=np.argpartition(cand,-min(40,M))[-min(40,M):];top=top[np.argsort(cand[top])[::-1]];top=top[np.isfinite(cand[top])]
  rank=np.full(M,999,int);rank[top]=np.arange(1,len(top)+1)
  entrants=[]
  if EV_RANK_EXIT:
   for j in current:
    if FC09_RANK_EXIT and rank[j]>EV_EXIT_RANK and held[j]>=EV_MIN_HOLD:to_sell.add(j);reason[j]='rank_exit'
  if (EV_PENDING+len(to_sell))>0 and (t==0 or len(current)<8 or bool(to_sell)) and target>=EV_MIN_TARGET and not port_risk and not dd_gate and not MARKET_COLD[sig]:
   stay=[j for j in current if j not in to_sell]
   open_slots=min(EV_PENDING+len(to_sell),max(0,8-len(stay)))
   for j in top[:EV_MAX_RANK]:
    if len(entrants)>=open_slots:break
    if j in stay or j in to_sell or j in entrants:continue
    if EV_ONLY_STRONGER and np.isfinite(EV_LAST_EXIT_SCORE) and float(cand[j])<=EV_LAST_EXIT_SCORE+EV_SCORE_EDGE:continue
    if EV_CORR_ENABLE and not EV_CORR_ALLOW(j,stay,entrants,sig,qty,prev_nav):stat['corr_entry_skip']=stat.get('corr_entry_skip',0)+1;continue
    entrants.append(int(j));stat['EV_candidates']=stat.get('EV_candidates',0)+1
  fc17_selected.clear();fc17_reenter=False
  if FC17_ENABLE and t>1 and target>=FC17_MIN_TARGET and not port_risk and not dd_gate and not MARKET_COLD[sig]:
   existing=set(int(j) for j in current if j not in to_sell)
   remaining=8-len(existing)-len(entrants)
   if remaining>0:
    # ranking computed using information at signal close and WITHOUT changing the original top8 path.
    valid_raw=np.where(BASE[sig]&TREND[sig],score_line,-np.inf)
    best_raw=np.argsort(valid_raw)[::-1][:FC17_MAX_RANK]
    for j in best_raw:
     if remaining<=0:break
     if j in existing or j in entrants or j in to_sell:continue
     age=t-fc17_watch_t[j]
     if not FC17_MIN_DELAY<=age<=FC17_MAX_DELAY:continue
     if EV_CORR_ENABLE and not EV_CORR_ALLOW(j,list(existing),entrants,sig,qty,prev_nav):stat['corr_fc17_skip']=stat.get('corr_fc17_skip',0)+1;continue
     if EV_LOSS_REENTRY_BLOCK and cool[j]>0:continue
     if not FC17_REENTRY_SIGNAL[sig,j] or not np.isfinite(valid_raw[j]):continue
     if fc17_watch_price[j]<=0 or float(P[sig,j])<fc17_watch_price[j]*FC17_MIN_RECOVERY:continue
     # no rescue when ACCOUNT level is de-risking or no resource to fund new position
     if not np.isfinite(P[sig,j]):continue
     entrants.append(int(j));fc17_selected.add(int(j));fc17_reenter=True;remaining-=1
     stat['fc17_signal']=stat.get('fc17_signal',0)+1
  risk_release=((prevstate and not state) or (prev_basket_risk and not basket_risk) or (prev_overlay and not overlay_risk) or (prev_port_risk and not port_risk))
  special_refill=(REFILL_INTERVAL>0 and t%REFILL_INTERVAL==0 and t>=1 and len([j for j in current if j not in to_sell])<8 and float(B[sig])>=REFILL_BREADTH and (not REFILL_TREND or market[t-1]/market[max(0,t-21)]-1>=0))
  if (risk_release or (FAST_REFILL and extra_sells) or special_refill) and not rebal:
   alive=[j for j in current if j not in to_sell]
   for j in top[:30]:
    if len(alive)+len(entrants)>=8:break
    if j in alive or j in to_sell or j in entrants:continue
    entrants.append(j)
  # CLOSE model via the frozen original exact R290 separately, this simulator only tests new fills.
  if detailed:
   signal_date=str(m.D[sig].date());execute_date=str(D[t].date());cc=cfg
   for j in current:
    if not np.isfinite(P[sig,j]):continue
    risk=j in to_sell and reason.get(j) in ('risk_exit','deferred_locked_exit')
    ordinary=j in to_sell and not risk
    if risk or ordinary:
     if cc['exit']=='moc':method='SELL_MOC';lv=np.nan; fallback='CLOSE_UNCONDITIONAL'
     elif risk or cc['exit']=='open':method='SELL_OPEN';lv=np.nan;fallback='OPEN_UNCONDITIONAL'
     else:method='SELL_LIMIT';lv=tick_up(float(P[sig,j]*(1+cc.get('exit_atr',.5)*max(.005,float(atr[sig,j])))));fallback='UNFILLED_HOLD_RECHECK_TOMORROW'
    else:method='HOLD';lv=np.nan;fallback='CONTINUE_HOLDING'
    st=np.nan;tp=np.nan
    if cc.get('protect'):
     ay=max(.005,float(atr[sig,j])); st=tick_down(max(0,float(peak[j])*(1-cc.get('trail_pct',.15)),float(peak[j])-cc.get('stop_atr',2.8)*ay*float(P[sig,j])))
     if cc.get('tp_atr',0)>0:tp=tick_up(float(basis[j]+cc['tp_atr']*atr_entry[j]*basis[j]))
    plans.append((name,signal_date,execute_date,K[j],'SELL_OR_HOLD',method,float(P[sig,j]),float(lv) if np.isfinite(lv) else None,float(st) if np.isfinite(st) else None,float(tp) if np.isfinite(tp) else None,fallback,reason.get(j,''),float(O[t,j]),float(H[t,j]),float(L[t,j]),float(C[t,j])))
   if entrants:
    for j in entrants:
     if not np.isfinite(P[sig,j]):continue
     ent=cc['entry'];pr=float(P[sig,j]);ap=max(.005,min(.25,float(atr[sig,j])));lv=np.nan
     if ent=='breakout':method='BUY_STOP_BREAKOUT';lv=tick_up(pr*(1+cc.get('break_atr',.1)*ap))
     elif ent=='pullback':method='BUY_LIMIT_PULLBACK';lv=tick_down(pr*(1-cc.get('pull_atr',.25)*ap))
     elif ent=='open':method='BUY_OPEN'
     else:method='BUY_MOC'
     fb='NO_FILL_NO_BUY' if cc.get('miss_buy')=='skip' and ent in ('breakout','pullback') else ('NO_FILL_NEXT_DAY_OPEN' if cc.get('miss_buy')=='next_open' else 'PRECOMMITTED_UNCONDITIONAL')
     plans.append((name,signal_date,execute_date,K[j],'NEW_ENTRY',method,pr,float(lv) if np.isfinite(lv) else None,None,None,fb,'candidate',float(O[t,j]),float(H[t,j]),float(L[t,j]),float(C[t,j])))
  # Trade phase 1: hard exits at t OPEN even if no intraday stop triggered.
  moc_exits=[]
  pending_exit=[]
  for j in sorted(to_sell):
   if qty[j]<=1e-13:continue
   if cfg['exit']=='moc':moc_exits.append(j);continue
   if cfg['exit'].startswith('limit_') and reason.get(j) not in ('risk_exit','deferred_locked_exit'):
    pending_exit.append(j);continue
   if not EXEC[i,j] or not VALID[t,j]:stat['bad_ohlc_skips']+=1;pending_sell.add(j);continue
   if LOCK_DOWN[t,j]:stat['locked_sell_skips']+=1;pending_sell.add(j);event(t,j,'SELL','LOCKED_LIMIT_DOWN',np.nan,np.nan,False,'no_bid_no_fill',0);continue
   reduce(t,j,float(qty[j]),float(O[t,j]),'MARKET_OPEN',np.nan,reason.get(j,'sell'))
   stat['hard_exit_open']+=1
  cool=np.maximum(0,cool-1)
  # Trade phase 2: opening risk rebalance; all sell decisions precommitted at previous close.
  rebalance=prevstate!=state or prev_basket_risk!=basket_risk or prev_overlay!=overlay_risk or prev_port_risk!=port_risk or MARKET_COLD[sig]!=MARKET_COLD[max(sig-1,0)] or prev_dd_gate!=dd_gate or abs(prev_dd_level-dd_level)>1e-8 or abs(prev_recover_level-recover_level)>1e-8 or (cfg.get('risk_gate','none')!='none' and t>=1 and abs(RISK_GATES[cfg.get('risk_gate','none')][sig]-RISK_GATES[cfg.get('risk_gate','none')][sig-1])>1e-8)
  if EV_STOCKCAP_ON and EV_STOCKCAP_CHANGE:rebalance=True
  if EV_CAP_REBAL:
   oldvalue=float(np.dot(qty,np.where(np.isfinite(P[sig]),P[sig],0.)))
   if oldvalue>1e-10 and (oldvalue>target*max(prev_nav,1e-10)+1e-10 or np.any(qty*P[sig]/max(prev_nav,1e-10)>EV_STOCKCAP_NOW+CAP_BAND+.002)):
    rebalance=True
  if rebalance:
   openv=qty*np.where(np.isfinite(O[t]),O[t],px);navopen=cash+openv.sum();inv=openv.sum()
   if inv>target*navopen+1e-10:
    fac=max(0.,target*navopen/max(inv,1e-10))
    for j in np.flatnonzero(qty>1e-13):
     if not VALID[t,j] or LOCK_DOWN[t,j]:continue
     q=float(qty[j])*(1-fac)
     if q>0:reduce(t,j,q,float(O[t,j]),'MARKET_OPEN',np.nan,'portfolio_reduce')
   # cap target max 16% per name, at OPEN; no intraday look ahead.
   navopen=cash+np.dot(qty,np.where(np.isfinite(O[t]),O[t],px))
   for j in np.flatnonzero(qty>1e-13):
    if not VALID[t,j] or LOCK_DOWN[t,j]:continue
    v=qty[j]*O[t,j];limit=EV_STOCKCAP_NOW*navopen
    if v>limit+(CAP_BAND+.002)*navopen:reduce(t,j,float((v-limit)/O[t,j]),float(O[t,j]),'MARKET_OPEN',np.nan,'cap16')
  # Investment top-ups are committed using previous-day target, filled at OPEN; independent of today's H/L.
  if FC09_TOPUP and rebalance:
   price_open=np.where(np.isfinite(O[t]),O[t],px)
   invested=float(np.dot(qty,price_open));navopen=cash+invested
   room=max(0.,target*navopen-invested)
   if room>.001*navopen:
    for j in sorted(np.flatnonzero(qty>1e-13),key=lambda j:qty[j]*price_open[j]):
     if j in to_sell:continue
     if not VALID[t,j] or LOCK_UP[t,j]:continue
     cap=max(0.,EV_STOCKCAP_NOW*navopen-qty[j]*O[t,j]);spent=min(room,cap,cash)
     if spent<=1e-12 or spent < MIN_TOPUP_NAV*navopen:continue
     add(t,j,spent,float(O[t,j]),'MARKET_OPEN',np.nan,'topup')
     room-=spent
  # Next-day-open contingency is executable because the prior day's limit miss is now known.
  for j, signal_t in list(pending_buy.items()):
   del pending_buy[j]
   if qty[j]>1e-13 or not VALID[t,j] or LOCK_UP[t,j] or not EXEC[i,j] or cool[j]!=0 or not (BASE[sig,j] and TREND[sig,j]):
    stat['pending_expired']+=1;continue
   if np.count_nonzero(qty>1e-13)>=8:stat['pending_expired']+=1;continue
   navopen=cash+float(np.dot(qty,np.where(np.isfinite(O[t]),O[t],px)))
   exposure=float(np.dot(qty,np.where(np.isfinite(O[t]),O[t],px)))
   spend=min(cash, max(0.,target*navopen-exposure),navopen/8,EV_STOCKCAP_NOW*navopen)
   if spend>1e-12:
    add(t,j,spend,float(O[t,j]),'NEXT_DAY_MARKET_OPEN',np.nan,'previous_limit_missed')
    stat['pending_fills']+=1
   else:stat['pending_expired']+=1
  cash_for_buys=cash # Reject using same-day intraday stop/profit-take proceeds to buy stock.
  # Trade phase 3: protective orders placed before this trading day. No use of current-day highs/lows to choose levels.
  if cfg.get('protect'):
   for j in list(np.flatnonzero(qty>1e-13)):
    if STOP_MODE and not stop_gate(sig,j,held[j],(P[sig,j]/basis[j]-1 if basis[j]>0 else 0.)):continue
    if not EXEC[i,j] or not VALID[t,j]:continue
    atr_y=max(.005,float(atr[sig,j]));st=max(0,float(peak[j])*(1-cfg.get('trail_pct',.15)),float(peak[j])-cfg.get('stop_atr',2.8)*atr_y*float(P[sig,j]))
    tp=float(basis[j]+cfg.get('tp_atr',0)*atr_entry[j]*basis[j]) if cfg.get('tp_atr',0)>0 else np.inf
    st=tick_down(st);tp=tick_up(tp) if np.isfinite(tp) else np.inf
    op=float(O[t,j]); lo=float(L[t,j]); hi=float(H[t,j]);
    stop_touch=lo<=st; tp_touch=hi>=tp
    if stop_touch and tp_touch:stat['dual_touch']+=1
    if stop_touch and LOCK_DOWN[t,j]:
     stat['locked_sell_skips']+=1;pending_sell.add(j);event(t,j,'SELL','LOCKED_LIMIT_DOWN',st,np.nan,False,'protective_stop_unfilled',0)
    elif stop_touch:
     fill=op if op<=st else st
     reduce(t,j,float(qty[j]),fill,'STOP',st,'protective_stop',amb=tp_touch)
     stat['stop_fills']+=1
    elif tp_touch:
     fill=op if op>=tp else tp
     reduce(t,j,float(qty[j]),fill,'LIMIT_SELL',tp,'profit_take')
     stat['tp_fills']+=1
  # Trade phase 4: precommitted limit-price exits; do not treat a high touched as guaranteed by futures liquidity.
  for j in pending_exit:
   if qty[j]<=1e-13:continue
   if not EXEC[i,j] or not VALID[t,j]:stat['bad_ohlc_skips']+=1;continue
   lv=tick_up(float(P[sig,j]*(1+cfg.get('exit_atr',.50)*max(.005,float(atr[sig,j])))))
   if H[t,j]>=lv:
    fill=float(O[t,j]) if O[t,j]>=lv else lv
    reduce(t,j,float(qty[j]),fill,'LIMIT_SELL',lv,reason.get(j,'rank_exit'))
   elif cfg['exit']=='limit_close' and not LOCK_DOWN[t,j]:
    # At close, irrespective of missed target; proceeds cannot be used for another intraday purchase.
    reduce(t,j,float(qty[j]),float(C[t,j]),'CLOSE_FALLBACK',lv,reason.get(j,'close_exit'))
    stat['close_fallback']+=1
   else:
    if LOCK_DOWN[t,j]:pending_sell.add(j);stat['locked_sell_skips']+=1
    event(t,j,'SELL','LIMIT_UNFILLED',lv,np.nan,False,'hold_position',0)
  # Trade phase 5: new entry price orders. They are decided from t-1 CLOSE/ATR, never from t H/L.
  if entrants:
   for j in entrants:
    if qty[j]>1e-13 or not EXEC[i,j]:continue
    if np.count_nonzero(qty>1e-13)>=8:continue
    stat['entry_intent']+=1
    if not VALID[t,j]:
     stat['bad_ohlc_skips']+=1;stat['entry_nofill']+=1
     event(t,j,'BUY','INVALID_OHLC',np.nan,np.nan,False,'bad_market_data',0)
     continue
    if LOCK_UP[t,j]:
     stat['locked_buy_skips']+=1;stat['entry_nofill']+=1
     event(t,j,'BUY','LOCKED_LIMIT_UP',np.nan,np.nan,False,'no_offer_no_fill',0)
     continue
    prev=float(P[sig,j]);ap=max(.005,min(.25,float(atr[sig,j])));op=float(O[t,j]);lo=float(L[t,j]);hi=float(H[t,j]);cl=float(C[t,j]);
    entry=cfg['entry'];level=np.nan;fill=np.nan;typ=''
    if entry=='open':fill=op;typ='MARKET_OPEN'
    elif entry=='moc':fill=cl;typ='PRECOMMITTED_MOC'
    elif entry=='pullback':
     level=tick_down(prev*(1-cfg.get('pull_atr',.5)*ap))
     if op<=level:fill=op;typ='LIMIT_GAP_OPEN';stat['gap_entries']+=1
     elif lo<=level:fill=level;typ='LIMIT_TOUCHED'
     else:typ='LIMIT_UNFILLED'
    elif entry=='breakout':
     level=tick_up(prev*(1+BUY_LEVEL[sig,j]*ap))
     if op>=level:fill=op;typ='STOP_GAP_OPEN';stat['gap_entries']+=1
     elif hi>=level:fill=level;typ='STOP_TOUCHED'
     else:typ='STOP_UNFILLED'
    if not np.isfinite(fill) and cfg.get('miss_buy')=='close':
     fill=cl;typ='CLOSE_FALLBACK';stat['close_fallback']+=1
    if not np.isfinite(fill):
     stat['entry_nofill']+=1;event(t,j,'BUY',typ,level,np.nan,False,'no_touch_no_buy',0)
     if cfg.get('miss_buy')=='next_open' and t<N-1:pending_buy[j]=t
     continue
    # Restrict to cash available before unknown-sequence intraday exits.
    nav_ref=cash+float(np.dot(qty,np.where(np.isfinite(O[t]),O[t],px)))
    invest_open=float(np.dot(qty,np.where(np.isfinite(O[t]),O[t],px)))
    available=max(0.,cash_for_buys)
    spend=min(available,max(0.,target*nav_ref-invest_open),nav_ref/8,EV_STOCKCAP_NOW*nav_ref)
    if spend<=1e-12:
     event(t,j,'BUY','INSUFFICIENT_CASH',level,np.nan,False,'target_exposure_full',0);continue
    if add(t,j,spend,float(fill),typ,level,'fc17_confirmed_reentry' if j in fc17_selected else 'new_position'):
     cash_for_buys-=spend
     stat['entry_fill']+=1
     if j in fc17_selected:stat['fc17_filled']=stat.get('fc17_filled',0)+1
     # Assume stop-first on same day a new buy occurs. This is a deliberately pessimistic OHLC uncertainty policy.
     if cfg.get('protect') and typ!='CLOSE_FALLBACK' and (not STOP_MODE or stop_gate(sig,j,held[j],(P[sig,j]/basis[j]-1 if basis[j]>0 else 0.))):
      st=tick_down(float(fill*(1-cfg.get('stop_atr',2.8)*ap)))
      if lo<=st:
       stop_fill=min(float(fill),st) # pessimistic price; gap was observed before limit fill
       reduce(t,j,float(qty[j]),stop_fill,'SAME_DAY_STOP',st,'protective_stop',amb=True)
       stat['stops_new_day']+=1
  # Precommitted closing auctions; close price known only upon fill, not during signal generation.
  for j in moc_exits:
   if qty[j]<=1e-13:continue
   if not EXEC[i,j] or not VALID[t,j]:pending_sell.add(j);continue
   if LOCK_DOWN[t,j]:stat['locked_sell_skips']+=1;pending_sell.add(j);event(t,j,'SELL','MOC_LOCKED_DOWN',np.nan,np.nan,False,'unfilled',0);continue
   reduce(t,j,float(qty[j]),float(C[t,j]),'PRECOMMITTED_MOC',np.nan,reason.get(j,'moc_exit'))
  # No re-buy after intraday stopped positions; risk buffers and capital are recalculated tomorrow.
  value=qty*px;nav=cash+value.sum();equity[t]=nav;expos[t]=value.sum()/nav;maxw[t]=max(value,default=0)/nav
  for j in np.flatnonzero(qty>1e-13):peak[j]=max(peak[j],px[j])
  if detailed and rebal:
   for j in np.flatnonzero(qty>1e-13):positions.append((name,str(D[t].date()),K[j],float(qty[j]*px[j]/nav),float(qty[j]*basis[j]),float(px[j])))
 final_nav=float(equity[-1]);final_pos=[(name,str(D[-1].date()),K[j],float(qty[j]*P[z,j]/final_nav),float(basis[j]),float(P[z,j]),float(peak[j]),float(qty[j])) for j in np.flatnonzero(qty>1e-13)]
 return dict(gate=gate_history,target=gate_target,eq=equity,exp=expos,turn=turn,maxw=maxw,plans=plans,orders=orders,closed=closed,cycles=cycles,holdings=positions,final_positions=final_pos,buy=buy,sell=sell,swap=swaps,stat=stat)

if __name__=='__main__':
 print('Prepared model',N,M,flush=True)
