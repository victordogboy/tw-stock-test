"""Replay the new signal primitives through the frozen account engine.

Usage: python verify_historical.py /path/to/extracted-A48-A56/replay
Run on a copy of the archive; its original research loader rewrites A54/audit.csv.
"""
from pathlib import Path
import sys, json
from dataclasses import asdict
import numpy as np
import pandas as pd
import a56_signals as live

sys.path.insert(0,str(Path(sys.argv[1]).resolve()))
import a56_robust_final as f
m=f.m
refs={}; warnings=0
for t in range(6,len(m.dates)):
    warn,_,_=live.market_warning(list(m.b.market[t-6:t])); assert warn==bool(m.groups[.06,.10][t]>=0)
    if not warn: continue
    warnings+=1; xs=[]; sig=m.a+t-1
    for j,c in enumerate(m.codes):
        hs=[]
        for u in (t-2,t-1):
            dt=str(m.dates[u].date())
            hs.append(live.Daily(dt,float(m.P[m.a+u-1,j]),float(m.L[u,j]),float(m.C[u,j]),float(m.vols.get((dt,c),np.nan)),m.executable(u,j)))
        x=live.candidate(c,float(m.P[sig,j]),float(m.P[sig-5,j]),float(m.P[sig-65,j]),bool(m.sc['BASE'][sig,j]),hs)
        if x is not None: xs.append(x)
    rank=live.rank_candidates(xs); refs[t]=rank
    assert [x.code for x in rank]==[m.codes[int(j)] for j in m.ranked[t]],t
    for x in rank:
        j=m.codes.index(x.code); b=m.carry.get((t,j),[]); a=m.origin.get((t,j))
        assert x.a_ready==bool(a is not None and a[0]>=.01)
        assert (x.b_floor,x.b_cap)==((b[0][1],b[0][2]) if b else (None,None))
print('WARNING_AND_CANDIDATE_PARITY',warnings,flush=True)

opening_plans={}; minute_plans={}; pre=[]

def opening(d,hold,blocked,budget,nav_twd):
    t=d['t']; intent=live.opening_intent(refs[t],hold,blocked,budget,nav_twd)
    opening_plans[d['date']]=dict(slots=hold,budget_twd=budget*nav_twd,order=asdict(intent) if intent else None)
    if intent is None: return []
    j=m.codes.index(intent.code); price=float(m.O[t,j])
    if not live.match_open(intent,price,m.executable(t,j)): return []
    m.route[d['date'],0,intent.code]=intent.route
    return [(d['date'],0,intent.code,price,intent.shares*price/nav_twd,0.,0.)]

def pick(d,model,gate,hold,blocked=(),budget=.04,nav_twd=None):
    t=d['t']; out=[]; matched=[]
    minute_plans[d['date']]=dict(rank_slots=hold,budget_twd=budget*nav_twd,blocked=sorted(blocked),candidates=[x.public() for x in refs[t][:hold] if x.code not in blocked],matches=matched)
    for c in refs[t][:hold]:
        j=m.codes.index(c.code)
        if c.code in blocked or not m.executable(t,j): continue
        z=m.cache.get((t,j))
        if z is None:
            # This is solely a retrospective data coverage audit; no signal.
            cp=m.L[t,j]<=c.c_arm and m.H[t,j]>=c.c_floor
            bp=c.b_floor is not None and m.H[t,j]>=c.b_floor and m.L[t,j]<=c.b_cap
            if cp or bp: m.missing.append((d['date'],c.code,'minute'))
            continue
        monitor=live.MinuteMonitor(c,budget,hold,nav_twd)
        for k in range(210):
            intents=monitor.completed(k,float(z[k,1]),float(z[k,2]),float(z[k,4])*1000)
            price=float(z[k+1,0]); intent=next((i for i in intents if live.match_open(i,price,True)),None)
            if intent:
                m.route[d['date'],k+1,c.code]=intent.route
                out.append((d['date'],k+1,c.code,price,intent.shares*price/nav_twd,0.,0.)); matched.append(asdict(intent)); break
    return sorted(out,key=lambda q:(q[1],q[2]))

m.preopen=opening; m.pick=pick
src=m.integrate(m.b.source)
marker='  side_exited=False'
assert src.count(marker)==1
src=src.replace(marker,"""  A56_PRE.append((str(D[t].date()),t,float(target),int(A32_EID[t]),float(cash),float(prev_nav),[str(K[j]) for j in np.flatnonzero(qty>1e-13)],[str(K[j]) for j in np.flatnonzero(side>1e-13)],[str(K[j]) for j in entrants],[str(K[j]) for j in to_sell],int(side_first),bool(side_used),bool(side_pending),bool(pending_buy)))
  side_exited=False""")
m.sc['A56_PRE']=pre; compiled=m.b.compile_sim(src)
captured={}
def capture(*args,**kwargs):
    ans=compiled(*args,**kwargs); captured.update(ans); return ans
m.fn_open=capture
row,nav,orders,trades=f.evaluate((.06,.10,5,'open',None,.03,.40))
r=m.ROOT/'A56_RELEASE'; n=pd.read_csv(r/'nav.csv.gz'); o=pd.read_csv(r/'orders.csv.gz',dtype={'code':str}); tr=pd.read_csv(r/'trades.csv',dtype={'code':str,'sell_code':str})
np.testing.assert_allclose(nav,n.nav,rtol=0,atol=1e-10)
pd.testing.assert_frame_equal(pd.DataFrame(orders,columns=o.columns),o,check_dtype=False,rtol=1e-10,atol=1e-10)
pd.testing.assert_frame_equal(pd.DataFrame(trades,columns=tr.columns),tr,check_dtype=False,rtol=1e-10,atol=1e-10)
assert len(pre)==1419 and row['missing']==0
print('FULL_ACCOUNT_PARITY',len(nav),len(orders),len(trades),flush=True)

plans=[]; exits=m.sc['A38_LOG']
for d,t,target,ep,cash,prevnav,core,side,entrants,core_exit,first,used,pending,core_pending in pre:
    warn=ep>=0; reason=live.exit_reason(warn,target,bool(entrants),first,t,pending)
    candidates=refs.get(t,[])
    slots,budget=live.tranche(warn,target,bool(entrants),t,first,used,pending,False,len(set(core+side)),cash,prevnav,opening=True,core_pending=core_pending)
    # Before open, do not assume future sales or opening fills. Actual budgets
    # and candidates at each execution gate are separate historical outcomes.
    proposal=live.opening_intent(candidates,slots,set(core+side),budget,prevnav*3e6) if slots and budget>0 and not reason else None
    assert (asdict(proposal) if proposal else None)==(opening_plans[d]['order'] if d in opening_plans else None), d
    ev=[dict(code=str(q[1]),status=q[2],reason=q[3],price=float(q[5]) if np.isfinite(q[5]) else None) for q in exits if q[0]==d]
    if side and reason:
        assert all(x['reason']==reason or pending for x in ev)
    cp=[dict(code=str(q[3]),action=q[4],method=q[5],prev_close=q[6],level=q[7],stop=q[8],profit=q[9],fallback=q[10],reason=q[11]) for q in captured['plans'] if q[2]==d]
    plans.append(dict(date=d,signal_date=str(m.dates[t-1].date()) if t else None,warning=warn,episode=ep,core_target=target,core_new=entrants,core_sell=core_exit,core_hold=core,side_hold=side,core_plans=cp,prior_cash_twd=cash*3e6,prior_nav_twd=prevnav*3e6,exit_reason=reason,exit_orders=[dict(code=c,action='SELL',method='NEXT_EXECUTABLE_OPEN',min_price_exclusive=live.tick(float(m.P[m.a+t-1,m.codes.index(c)])*.90,True)) for c in side] if reason else [],candidates=[c.public() for c in candidates],preopen_proposal=dict(slots=slots,budget_twd=budget*prevnav*3e6,order=asdict(proposal) if proposal else None),historical_execution=dict(opening_gate=opening_plans.get(d),intraday_gate=minute_plans.get(d),exits=ev,orders=[dict(minute=q[2],code=q[3],action=q[4],price=q[5],shares=q[6]*3e6,notional=q[7]*3e6) for q in orders if q[1]==d])))

def clean(x):
    if isinstance(x,dict): return {k:clean(v) for k,v in x.items()}
    if isinstance(x,(list,tuple)): return [clean(v) for v in x]
    if isinstance(x,np.generic): return clean(x.item())
    if isinstance(x,float) and not np.isfinite(x): return None
    return x

out=Path(__file__).resolve().parent
payload=clean(dict(version=live.VERSION,status='historical_validation_only',data_through=str(m.dates[-1].date()),days=plans,metrics=row,nav_max_absolute_error=float(np.max(np.abs(nav-n.nav)))))
(out/'historical_daily_plans.json').write_text(json.dumps(payload,ensure_ascii=False,allow_nan=False,separators=(',',':')))
print('DAILY_PLAN_EXPORT',len(plans),'warning_days',warnings,'nav_max_error',payload['nav_max_absolute_error'],flush=True)
