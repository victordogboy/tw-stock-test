#!/usr/bin/env python3
"""Extract C26 immutable as-of-2026-10-27 paper-model state from full replay.

The simulator file SHA is checked; one **diagnostic-only**, side-effect-free
in-memory probe is injected AFTER the last simulated close, not into the
frozen code on disk. Orders, equity and MDD must remain bit-identical.

Requires the original full C26 ZIP and bootstrap_assets.py installed at
/mnt/data. Exports NO user/broker holdings or FinMind raw subscription data.
"""
from __future__ import annotations
import importlib.util,json,hashlib,sys,os
from pathlib import Path
import numpy as np
ROOT=Path('/mnt/data')
RELEASE=Path(os.getenv('C26_RELEASE_DIR',str(ROOT/'c26_local/C26_正式候選_凍結重播_20261112')))
FROZEN=RELEASE/'source/C26_FROZEN_ENGINE.py'
INNER=RELEASE/'source/C26_SIMULATOR_FROZEN.py'
OUT=Path(__file__).with_name('model_checkpoint_20261027.json')
EXPECTED='741862f102438f8f10fcf40cf2f9b47edb8fece004e0175ae3f1be7e94bd4ad5'
assert hashlib.sha256(INNER.read_bytes()).hexdigest()==EXPECTED
s=FROZEN.read_text(encoding='utf-8')
old="exec(compile(_C26_SRC,'<C26_FROZEN_SIMULATOR>','exec'),sc)"
assert s.count(old)==1
probe='''  if t==N-1 and EV_C26_CAPTURE is not None:
   EV_C26_CAPTURE.update({
    "date":str(D[t].date()),"trade_index":int(t),"cash_unit":float(cash),
    "quantity_by_code":{str(K[j]):float(qty[j]) for j in np.flatnonzero(qty>1e-13)},
    "held_days_by_code":{str(K[j]):int(held[j]) for j in np.flatnonzero(qty>1e-13)},
    "peak_by_code":{str(K[j]):float(peak[j]) for j in np.flatnonzero(qty>1e-13)},
    "basis_by_code":{str(K[j]):float(basis[j]) for j in np.flatnonzero(qty>1e-13)},
    "entry_atr_by_code":{str(K[j]):float(atr_entry[j]) for j in np.flatnonzero(qty>1e-13)},
    "mark_close_by_code":{str(K[j]):float(P[i,j]) for j in np.flatnonzero(qty>1e-13)},
    "cooldown_by_code":{str(K[j]):int(cool[j]) for j in np.flatnonzero(cool>0)},
    "fc17_watch_by_code":{str(K[j]):{"watch_t":int(fc17_watch_t[j]),"exit_price":float(fc17_watch_price[j])} for j in np.flatnonzero(fc17_watch_t>-99999)},
    "pending_buy":{str(K[j]):int(v) for j,v in pending_buy.items()},
    "pending_sell":[str(K[j]) for j in sorted(pending_sell)],
    "event_pending":int(EV_PENDING),"last_exit_score":float(EV_LAST_EXIT_SCORE),
    "stockcap_active":bool(EV_STOCKCAP_ACTIVE),"stockcap_previous":float(EV_STOCKCAP_PREV),
    "market_bear":bool(state),"basket_risk":bool(basket_risk),"overlay_risk":bool(overlay_risk),
    "portfolio_risk":bool(port_risk),"account_drawdown_gate":bool(dd_gate),
    "risk_recover":bool(risk_recover),"recover_level":float(recover_level),
    "dd_level":float(dd_level),"previous_target":float(prev_target),
    "nav_unit":float(nav),"last40_nav_units":equity[max(0,t-40):t+1].astype(float).tolist(),
    "cycle_buy_by_code":{str(K[j]):float(cycle_buy[j]) for j in np.flatnonzero(qty>1e-13)},
    "cycle_sell_by_code":{str(K[j]):float(cycle_sell[j]) for j in np.flatnonzero(qty>1e-13)},
    "buy_fills":int(buy),"sell_fills":int(sell),"stat":{str(k):int(v) for k,v in stat.items()}
   })
'''
needle='  if detailed and rebal:\n'
original=INNER.read_text(encoding='utf-8')
assert original.count(needle)==1
# Inject before optional diagnostic position dump after financial state is finalized.
patched=s.replace(old,"""EV_C26_CAPTURE={}
sc['EV_C26_CAPTURE']=EV_C26_CAPTURE
needle='  if detailed and rebal:\\n'
assert _C26_SRC.count(needle)==1
_C26_DIAGNOSTIC=_C26_SRC.replace(needle,%r+needle)
exec(compile(_C26_DIAGNOSTIC,'<C26_DIAGNOSTIC_AFTER_FINAL_CLOSE>','exec'),sc)
"""%probe)
# Avoid import path of the same full source under /mnt/data which would mutate frozen executable.
tmp=RELEASE/'source/C26_FROZEN_DRIVER_DIAGNOSTIC.py'
tmp.write_text(patched,encoding='utf-8')
try:
 spec=importlib.util.spec_from_file_location('_c26_checkpoint_diagnostic',tmp)
 m=importlib.util.module_from_spec(spec)
 sys.path.insert(0,str(ROOT))
 spec.loader.exec_module(m)
 r,nav,det=m.replay_c26('C26_CHECKPOINT_PARITY',detail=True)
 assert abs(r['return_pct']-1720.495844396837)<1e-9
 assert abs(r['mdd_pct']+17.989769234703846)<1e-9
 assert len(det['orders'])==1758
 c=dict(m.sc['EV_C26_CAPTURE'])
 assert c['date']=='2026-10-27' and len(c['quantity_by_code'])==5
 assert abs(c['nav_unit']-nav[-1])<1e-12
 assert c['buy_fills']==539 and c['sell_fills']==1028
 assert abs(c['cash_unit']+sum(c['quantity_by_code'][k]*c['mark_close_by_code'][k] for k in c['quantity_by_code'])-c['nav_unit'])<1e-10
 assert 0<=c['event_pending']<=8
 c['lock_id']='C26-EVENT-CORR-LOCK-20261112'
 c['simulator_sha256']=EXPECTED
 c['model_not_broker_account']=True
 c['checkpoint_precedes_new_signals']=True
 c['forward_trade_plan_ready']=False
 c['current_market_date']='2026-10-27'
 c['model_initialized_capital_ntd']=3000000
 c['notes']='Paper research state only. Subsequent dates have NOT been replayed. Zero actual broker positions implied.'
 OUT.write_text(json.dumps(c,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
 print('C26_CHECKPOINT_PARITY_OK',json.dumps({"date":c['date'],"nav_unit":c['nav_unit'],"positions":len(c['quantity_by_code']),"event_pending":c['event_pending'],"cooldown_stocks":len(c['cooldown_by_code']),"watchlist":len(c['fc17_watch_by_code']),"orders":len(det['orders']),"cash_unit":c['cash_unit']},ensure_ascii=False),flush=True)
finally:
 tmp.unlink(missing_ok=True)