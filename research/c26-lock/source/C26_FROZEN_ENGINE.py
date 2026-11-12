#!/usr/bin/env python3
"""FC17: causal early re-entry after actual FC15 full position exit. Original R1748 transaction engine retained.
No future prices in entry signals; all use yesterday-close computed matrices and next-day stop orders.
All exits and portfolio risk unchanged. Baseline must reproduce exact frozen FC15.
"""
from pathlib import Path
import numpy as np,pandas as pd,time,json,sys,hashlib
R=Path('/mnt/data');OUT=R/'R1748_FC17_reentry';OUT.mkdir(exist_ok=True);T=time.monotonic()
s=(R/'FC15_micro_rank.py').read_text().split('rows=[]\ndef run(')[0]
n={'__name__':'FC17_BOOT','__file__':str(R/'FC15_micro_rank.py')};exec(compile(s,'<FC17_BOOT>','exec'),n)
m=n['m'];sc=m.sc;P=np.asarray(n['P'],float);TD=m.TD;f=n['f'];rpool=n['rpool'];N,M=P.shape
# FC15 LOCK base scoring matrices, not modified on-disk
m.base_values['FC15_FEATURE']=(rpool&f['fresh_acceleration']).astype(np.float32)
needle="score_line=SCORE[sig]+CHIP_BONUSES[cfg.get('chip_score','none')][sig]+EXTRA_RANK_BONUS[sig]"
assert m.source.count(needle)==1
src=m.source.replace(needle,needle+"+FC13_WEIGHT*FC13_BONUS[sig]+FC15_WEIGHT*FC15_FEATURE[sig]")
# Watchlist is created ONLY after full-position exit and cleared on buy.
a='buy=sell=swaps=0;pending_buy={};pending_sell=set()'
b=a+";fc17_watch_t=np.full(M,-99999,dtype=int);fc17_watch_price=np.zeros(M,float);fc17_selected=set()"
assert src.count(a)==1;src=src.replace(a,b)
a="   pending_sell.discard(j)"
b="""   if FC17_ENABLE and (reason in ('risk_exit','protective_stop') or (FC17_EXIT_ALL and reason in ('rank_exit','replace'))):
    fc17_watch_t[j]=t;fc17_watch_price[j]=float(price)
   else:
    fc17_watch_t[j]=-99999;fc17_watch_price[j]=0.
"""+a
assert src.count(a)==1;src=src.replace(a,b)
a="  if held[j]<0:held[j]=0;peak[j]=P[a+t-1,j] if t else price"
b="  fc17_watch_t[j]=-99999;fc17_watch_price[j]=0.\n"+a
assert src.count(a)==1;src=src.replace(a,b)
# FC17 reentry signal before tomorrow's order placement; this block only references <= signal day.
a="  risk_release=((prevstate and not state) or (prev_basket_risk and not basket_risk) or (prev_overlay and not overlay_risk) or (prev_port_risk and not port_risk))"
b="""  fc17_selected.clear();fc17_reenter=False
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
     if not FC17_REENTRY_SIGNAL[sig,j] or not np.isfinite(valid_raw[j]):continue
     if fc17_watch_price[j]<=0 or float(P[sig,j])<fc17_watch_price[j]*FC17_MIN_RECOVERY:continue
     # no rescue when ACCOUNT level is de-risking or no resource to fund new position
     if not np.isfinite(P[sig,j]):continue
     entrants.append(int(j));fc17_selected.add(int(j));fc17_reenter=True;remaining-=1
     stat['fc17_signal']=stat.get('fc17_signal',0)+1
"""+a
assert src.count(a)==1;src=src.replace(a,b)
a="if rebal or (FC09_REFILL and (risk_release or (FAST_REFILL and extra_sells) or special_refill)):"
assert src.count(a)==2,src.count(a)
src=src.replace(a,"if rebal or (FC09_REFILL and (risk_release or (FAST_REFILL and extra_sells) or special_refill)) or fc17_reenter:")
a="if add(t,j,spend,float(fill),typ,level,'new_position'):"
b="if add(t,j,spend,float(fill),typ,level,'fc17_confirmed_reentry' if j in fc17_selected else 'new_position'):"
assert src.count(a)==1;src=src.replace(a,b)
a="     stat['entry_fill']+=1"
b=a+"\n     if j in fc17_selected:stat['fc17_filled']=stat.get('fc17_filled',0)+1"
assert src.count(a)==1;src=src.replace(a,b)
# Installation: compile once, runtime parameters can vary without overwriting LOCK.
sc.update(FC17_ENABLE=False,FC17_EXIT_ALL=False,FC17_REENTRY_SIGNAL=np.zeros((N,M),bool),FC17_MIN_DELAY=2,FC17_MAX_DELAY=15,
          FC17_MIN_TARGET=.7,FC17_MAX_RANK=30,FC17_MIN_RECOVERY=.98,FC13_BONUS=n['n']['n']['factors']['breadth55'].astype(np.float32),
          FC15_FEATURE=m.base_values['FC15_FEATURE'],FC13_WEIGHT=.10,FC15_WEIGHT=.008)

# Remove 20-trading-day calendar trigger -- no periodic rebalance remains.
assert src.count('rebal=t%REBAL_N==0;to_sell=set();reason={};extra_sells=set()')==1
src=src.replace('rebal=t%REBAL_N==0;to_sell=set();reason={};extra_sells=set()', 'rebal=False;to_sell=set();reason={};extra_sells=set()')
# One-time initial capacity (8), then increment ONLY on FULL liquidation; no fixed date refill.
assert src.count('buy=sell=swaps=0;pending_buy={};pending_sell=set()')==1
src=src.replace('buy=sell=swaps=0;pending_buy={};pending_sell=set()', 'buy=sell=swaps=0;pending_buy={};pending_sell=set();EV_PENDING=8;EV_LAST_EXIT_SCORE=-np.inf')
assert src.count('nonlocal cash, sell')==1
src=src.replace('nonlocal cash, sell', 'nonlocal cash, sell, EV_PENDING, EV_LAST_EXIT_SCORE')
assert src.count('if qty[j]<=1e-13:\n   if FC17_ENABLE')==1
src=src.replace('if qty[j]<=1e-13:\n   if FC17_ENABLE', '''if qty[j]<=1e-13:
   EV_PENDING=min(8,EV_PENDING+1)
   if EV_ONLY_STRONGER and np.isfinite(score_line[j]):
    EV_LAST_EXIT_SCORE = float(score_line[j]) if not np.isfinite(EV_LAST_EXIT_SCORE) else min(EV_LAST_EXIT_SCORE,float(score_line[j]))
   if FC17_ENABLE''')
assert src.count('nonlocal cash,buy')==1
src=src.replace('nonlocal cash,buy', 'nonlocal cash,buy,EV_PENDING,EV_LAST_EXIT_SCORE')
assert src.count('if spend<=1e-13 or price<=0:return False')==1
src=src.replace('if spend<=1e-13 or price<=0:return False', "if spend<=1e-13 or price<=0:return False\n  if reason in ('new_position','fc17_confirmed_reentry','previous_limit_missed') and spend/(1+BUY_COST)<EV_MIN_NEW_NAV:return False")
assert src.count('buy+=1;turn[t]+=spend/max(prev_nav,1e-10)')==1
src=src.replace('buy+=1;turn[t]+=spend/max(prev_nav,1e-10)', '''if reason in ('new_position','fc17_confirmed_reentry','previous_limit_missed'):
   EV_PENDING=max(0,EV_PENDING-1)
   if EV_PENDING==0:EV_LAST_EXIT_SCORE=-np.inf
  buy+=1;turn[t]+=spend/max(prev_nav,1e-10)''')
# ORIGINAL daily signals and risk exits stay, but optional daily rank-drop sell uses causal prior close.
assert src.count('  if rebal:\n   for j in current:')==1
src=src.replace('  if rebal:\n   for j in current:', '''  if EV_RANK_EXIT:
   for j in current:
    if FC09_RANK_EXIT and rank[j]>EV_EXIT_RANK and held[j]>=EV_MIN_HOLD:to_sell.add(j);reason[j]='rank_exit'
  if (EV_PENDING+len(to_sell))>0 and (t==0 or len(current)<8 or bool(to_sell)) and target>=EV_MIN_TARGET and not port_risk and not dd_gate and not MARKET_COLD[sig]:
   for j in []:''')
# Current replacement mechanism must NOT proactively swap before an existing sell.
assert src.count('   stay=[j for j in current if j not in to_sell]')==1
assert src.count('   for j in top[:30]:')==2
assert src.count('    if len(stay)+len(entrants)<8:entrants.append(j);continue')==1
assert src.count('    if not stay:continue')==1
start=src.index('   for j in []:')
end=src.index('  fc17_selected.clear();fc17_reenter=False',start)
segment='''   stay=[j for j in current if j not in to_sell]
   open_slots=min(EV_PENDING+len(to_sell),max(0,8-len(stay)))
   for j in top[:EV_MAX_RANK]:
    if len(entrants)>=open_slots:break
    if j in stay or j in to_sell or j in entrants:continue
    if EV_ONLY_STRONGER and np.isfinite(EV_LAST_EXIT_SCORE) and float(cand[j])<=EV_LAST_EXIT_SCORE+EV_SCORE_EDGE:continue
    entrants.append(int(j));stat['EV_candidates']=stat.get('EV_candidates',0)+1
'''
src=src[:start]+segment+src[end:]
# Remove fixed 5-day risk / allocation day; risk STATE transitions still cause rebalancing.
clock='rebalance=rebal or (FC09_FIVE_DAY_REBAL and t%5==0) or '
assert src.count(clock)==1
src=src.replace(clock,'rebalance=')
assert src.count('  if rebalance:\n   openv=qty*np.where(np.isfinite(O[t]),O[t],px)')==1
src=src.replace('  if rebalance:\n   openv=qty*np.where(np.isfinite(O[t]),O[t],px)', '''  if EV_CAP_REBAL:
   oldvalue=float(np.dot(qty,np.where(np.isfinite(P[sig]),P[sig],0.)))
   if oldvalue>1e-10 and (oldvalue>target*max(prev_nav,1e-10)+1e-10 or np.any(qty*P[sig]/max(prev_nav,1e-10)>FC09_CAP+CAP_BAND+.002)):
    rebalance=True
  if rebalance:
   openv=qty*np.where(np.isfinite(O[t]),O[t],px)''')
# Top-ups only on actual risk-state change, NEVER via TOPUP_DAYS modulo.
conditional='if FC09_TOPUP and rebalance and (TOPUP_DAYS<=5 or t%TOPUP_DAYS==0 or (prevstate!=state or prev_basket_risk!=basket_risk or prev_overlay!=overlay_risk or prev_port_risk!=port_risk)):'
assert src.count(conditional)==1
src=src.replace(conditional,'if FC09_TOPUP and rebalance:')
# Order placement only when candidates have been selected after actual empty slot / committed full exit.
old="if rebal or (FC09_REFILL and (risk_release or (FAST_REFILL and extra_sells) or special_refill)) or fc17_reenter:"
assert src.count(old)==2,src.count(old)
src=src.replace(old,'if entrants:')
# Do not misstate daily slot trigger as calendar rebalancing.
sc.update(EV_PENDING_DEFAULT=8, EV_RANK_EXIT=True,EV_EXIT_RANK=24,EV_MIN_HOLD=20,
          EV_MIN_TARGET=.70,EV_MAX_RANK=8,EV_ONLY_STRONGER=False,EV_SCORE_EDGE=0.,EV_MIN_NEW_NAV=10000/3000000,EV_CAP_REBAL=False)

# Frozen complete simulator SHA-256 derived from full C26 runtime, immutable.
C26_INNER_HASH='741862f102438f8f10fcf40cf2f9b47edb8fece004e0175ae3f1be7e94bd4ad5'
_C26_FILE=Path(__file__).resolve().parent/'C26_SIMULATOR_FROZEN.py'
_C26_SRC=_C26_FILE.read_text(encoding='utf-8')
assert hashlib.sha256(_C26_SRC.encode('utf-8')).hexdigest()==C26_INNER_HASH,'C26 frozen engine modified; abort'
sc.update(EV_STOCKCAP_ON=False,EV_STOCKCAP_LOW=.12,EV_STOCKCAP_TRIGGER=-.1,
EV_STOCKCAP_RELEASE=-.05,EV_STOCKCAP_BREADTH=.55,EV_STOCKCAP_RECOVER_BREADTH=.65,
EV_STOCKCAP_MARKET_RELEASE=True,EV_STOCKCAP_HISTORY=np.ones(len(TD),float),
EV_LOSS_COOLDOWN=26,EV_LOSS_REENTRY_BLOCK=True,
EV_CORR_ENABLE=True,EV_CORR_WINDOW=40,EV_CORR_THRESHOLD=.6,
EV_CORR_MAX_CLUSTER_W=.30,EV_CORR_MIN_NEIGHBORS=1,
EV_CORR_ALLOW=lambda *args: True)
exec(compile(_C26_SRC,'<C26_FROZEN_SIMULATOR>','exec'),sc)

sc['VARIANTS'].update(m.old_vars['VARIANTS']);sc['RISK_GATES'].update(m.old_vars['RISK_GATES']);m.real_sim=sc['simulate'];sc['simulate']=m.ns['sim_with_cost']
# Runtime factory: vectorize all causal features before simulation. No sector/ticker whitelist.
RS5=np.asarray(n['n']['n']['rs5'],float);RS20=np.asarray(n['n']['n']['rs20'],float);RS60=np.asarray(n['n']['n']['rs60'],float)
VR=np.asarray(n['n']['n']['vr'],float);EMA=np.asarray(n['n']['n']['ema'],float)
near20=np.asarray(n['n']['h20'],float);near60=np.asarray(n['n']['h60'],float)
breadth=np.asarray(n['n']['n']['sector_breadth'],float)
base_elig=np.asarray(sc['BASE'])&np.asarray(sc['TREND'])
# Signal arrays built on same-day-close snapshot and used only at t+1.
signals={
 'RS_early':base_elig&(P>EMA)&(RS20>.05)&(RS5>.01)&(near20>.93),
 'RS_steady':base_elig&(P>EMA)&(RS20>.07)&(RS5>.015)&(RS5<.12)&(VR>=.8)&(near60>=.88),
 'RS_acceleration':base_elig&(P>EMA)&(RS20>.08)&(RS5>.015)&((RS5-RS20/4)>.005)&(VR>=.8)&(near60>=.9),
 'RS_breakout':base_elig&(P>EMA)&(RS5>.025)&(RS20>.10)&(near20>.99)&(VR>=1.0),
 'RS_sector':base_elig&(P>EMA)&(RS5>.015)&(RS20>.07)&(breadth>=.55)&(near60>=.90),
 'RS_chip_plus':base_elig&(P>EMA)&(RS5>.015)&(RS20>.07)&(near60>.93)&(np.asarray(sc['CHIP_BONUSES'][sc['VARIANTS']['R1489_H'].get('chip_score','none')])>0),
}
base={'BUY_LEVEL_SCALE':.88,'FC09_RANK_HOLD':20,'RISK_RELEASE':-.078,'FC13_WEIGHT':.10,'FC15_WEIGHT':.008}
rows=[];years=[]
def run(name,par=None,sig=None,cost=.001,fee=True,detail=False):
 par=par or {};m.changes={**base,**par.get('rules',{})};m.cfg.clear();m.cfg.update(m.cfg_base)
 for k,v in m.base_values.items():sc[k]=v
 for k in m.allflag:sc[k]=True
 sc.update(FC17_ENABLE=sig is not None,FC17_EXIT_ALL=bool(par.get('exit_all',False)),FC17_REENTRY_SIGNAL=(signals[sig] if sig is not None else np.zeros((N,M),bool)),
           FC17_MIN_DELAY=int(par.get('delay',2)),FC17_MAX_DELAY=int(par.get('until',15)),FC17_MIN_TARGET=float(par.get('target',.7)),
           FC17_MAX_RANK=int(par.get('rank',30)),FC17_MIN_RECOVERY=float(par.get('recover',.98)),
           FC13_BONUS=n['n']['n']['factors']['breadth55'].astype(np.float32),FC15_FEATURE=m.base_values['FC15_FEATURE'],FC13_WEIGHT=.10,FC15_WEIGHT=.008)
 rr,nav,det=m.ns['actualtest'](name,{},costside=cost,fee=fee,detail=detail);nav=np.asarray(nav,float)
 yr={f'y{y}':float(100*(nav[idx[-1]]/(nav[idx[0]-1] if idx[0] else 1)-1)) for y in range(2021,2027) for idx in [np.flatnonzero(TD.year==y)]}
 row=dict(name=name,signal=sig or 'FC15_LOCK',params=json.dumps(par,sort_keys=True),cost_pct=(.3855 if fee else 0)+200*cost,
          return_pct=float(rr['ret_all_pct']),mdd_pct=float(rr['mdd_pct']),maxw=float(rr['maxw_pct']),maxexp=float(rr['maxexp_pct']),buys=int(rr['buys']),sells=int(rr['sells']),
          reentry_signals=int(det['stat'].get('fc17_signal',0)),reentry_fills=int(det['stat'].get('fc17_filled',0)),**yr)
 return row,nav,det

# FROZEN C26: all historical matrices below use only completed signal-day data.
_REF=Path('/mnt/data/research/FC23_LIVE_PREP_v1/reference')
_C= np.load(_REF/'FC20_盤後法人與動態同儕可重現特徵.npz')
_peer=np.load(_REF/'FC17_當時可知60日動態同儕強勢比例.npz')['peer_breadth']
_T5=_C['T5'];_F5=_C['F5']
_sig=(base_elig&(P>EMA)&(RS20>.08)&(RS5>.015)&(RS5-RS20/4>.007)
      &(near60>.87)&(_peer>=.50)&(np.isnan(_T5)|(_T5>=-.02)))
_sig &= ((RS5<=.18)|((RS5<=.25)&(_peer>=.70)&np.isfinite(_F5)&(_F5>=0)))
signals['FC23_EVENT_TEST']=_sig
assert _sig.shape==P.shape
# Initialized from true same-day CLOSE data, observed at decision signal day i-1.
_C26_PRICES=np.asarray(P,float)
_C26_N,_C26_M=_C26_PRICES.shape
_C26_RET=np.full((_C26_N,_C26_M),np.nan,np.float32)
_rs=np.divide(_C26_PRICES[1:],_C26_PRICES[:-1],
              out=np.full((_C26_N-1,_C26_M),np.nan),
              where=(_C26_PRICES[:-1]>0)&np.isfinite(_C26_PRICES[:-1])&np.isfinite(_C26_PRICES[1:]))-1
_rs[~np.isfinite(_rs)|(np.abs(_rs)>.2)]=np.nan
_C26_RET[1:]=_rs.astype(np.float32)

def _c26_corr_allow(j,stay,entrants,sig,qty,prev_nav):
    # Preceding close only. Match original C26 research engine byte for byte.
    if sig<sc['EV_CORR_WINDOW']:return True
    kept=list({int(k) for k in stay if int(k)!=int(j) and qty[int(k)]>1e-12})
    kept+=list({int(k) for k in entrants if int(k)!=int(j) and int(k) not in kept})
    if len(kept)<sc['EV_CORR_MIN_NEIGHBORS']:return True
    w=int(sc['EV_CORR_WINDOW']);period=_C26_RET[sig-w+1:sig+1]
    a=period[:,int(j)];sim=[]
    for k in kept:
        b=period[:,k];good=np.isfinite(a)&np.isfinite(b)
        if good.sum()<max(14,int(.7*w)):continue
        x=a[good].astype(float);y=b[good].astype(float);x-=x.mean();y-=y.mean();den=float(np.linalg.norm(x)*np.linalg.norm(y))
        if den<=1e-12:continue
        co=float(np.dot(x,y)/den)
        if co>=float(sc['EV_CORR_THRESHOLD']):
            weight=float(qty[k]*_C26_PRICES[sig,k]/max(1e-9,float(prev_nav))) if qty[k]>1e-12 else .12
            sim.append((k,weight,co))
    if len(sim)<sc['EV_CORR_MIN_NEIGHBORS']:return True
    return sum(x[1] for x in sim)<float(sc['EV_CORR_MAX_CLUSTER_W'])

C26_LOCK_CONFIG={
    'name':'C26-EVENT-CORR-LOCK-20261112',
    'initial_capital_ntd':3000000,
    'historical_start':'2021-01-06','historical_end':'2026-10-27',
    'cost_round_trip_pct':0.5855,'fee_round_trip_pct':0.3855,
    'slippage_per_side_pct':0.1,
    'cooldown_after_losing_risk_or_stop_sell_days':26,
    'fc17_early_reentry_follows_cooldown':True,
    'correlation_lookback_days':40,'correlation_threshold':0.60,
    'correlated_group_max_weight':0.30,'min_correlated_neighbors':1,
    'stock_target_weight':0.16,'max_positions':8,'max_total_exposure':1.,
    'minimum_new_position_ntd':10000,
    'periodic_rebalance':False,'live_trade_enabled':False,
    'risk_threshold':-0.06,'risk_release':-0.025,
    'min_rank_target':0.8,'ranking_candidates':12,'only_replenish_after_exit':True,
}


def replay_c26(name='C26_FROZEN',detail=True):
    # These explicit settings are not editable in production. Do not import a research scanner.
    sc.update(EV_RANK_EXIT=False,EV_EXIT_RANK=24,EV_MIN_HOLD=20,
        EV_MIN_TARGET=.8,EV_MAX_RANK=12,EV_ONLY_STRONGER=True,
        EV_SCORE_EDGE=0.,EV_MIN_NEW_NAV=10000/3000000,EV_CAP_REBAL=True,
        EV_STOCKCAP_ON=False,EV_STOCKCAP_LOW=.12,EV_STOCKCAP_TRIGGER=-.1,
        EV_STOCKCAP_RELEASE=-.05,EV_STOCKCAP_BREADTH=.55,
        EV_STOCKCAP_RECOVER_BREADTH=.65,EV_STOCKCAP_MARKET_RELEASE=True,
        EV_STOCKCAP_HISTORY=np.ones(len(TD),float),EV_LOSS_COOLDOWN=26,
        EV_LOSS_REENTRY_BLOCK=True,EV_CORR_ENABLE=True,EV_CORR_WINDOW=40,
        EV_CORR_THRESHOLD=.6,EV_CORR_MAX_CLUSTER_W=.3,
        EV_CORR_MIN_NEIGHBORS=1,EV_CORR_ALLOW=_c26_corr_allow)
    par={'delay':3,'rank':8,'recover':1.,'until':35,'target':.7,
         'rules':{'RISK_RELEASE':-.025,'RISK_THRESHOLD':-.06}}
    return run(name,par,'FC23_EVENT_TEST',cost=.001,fee=True,detail=detail)
