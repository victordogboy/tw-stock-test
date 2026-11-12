#!/usr/bin/env python3
"""No simulator bootstrap needed. Verify archived C26 historical outputs and source fingerprints."""
from pathlib import Path
from zipfile import ZipFile
import sys,hashlib,json
import numpy as np,pandas as pd
ROOT=Path(__file__).resolve().parents[1]
results=ROOT/'replay/results'

def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
assert digest(ROOT/'source/C26_SIMULATOR_FROZEN.py')=='741862f102438f8f10fcf40cf2f9b47edb8fece004e0175ae3f1be7e94bd4ad5'
assert 't%REBAL_N' not in (ROOT/'source/C26_SIMULATOR_FROZEN.py').read_text()
assert 't%TOPUP_DAYS' not in (ROOT/'source/C26_SIMULATOR_FROZEN.py').read_text()
with (results/'C26_audit.json').open() as f:a=json.load(f)
with (results/'C26_metrics.json').open() as f:m=json.load(f)
nav=pd.read_csv(results/'C26_daily_nav.csv.gz');order=pd.read_csv(results/'C26_orders.csv.gz',dtype={'ticker':str})
assert len(nav)==1407 and len(order)==1758
assert (nav.date.iloc[0],nav.date.iloc[-1])==('2021-01-06','2026-10-27')
assert abs(100*(nav.nav.iloc[-1]-1)-1720.495844396837)<1e-9
x=np.r_[1.,nav.nav.values];assert abs(100*(x/np.maximum.accumulate(x)-1).min()+17.989769234703846)<1e-8
assert a['passed'] and a['max_open_positions']<=8 and a['max_abs_reconstructed_nav_difference']<1e-7
assert (pd.to_datetime(order.signal_date)<pd.to_datetime(order.execution_date)).all()
new=order[(order.action=='BUY') & order.filled & order.reason.isin(['new_position','fc17_confirmed_reentry','previous_limit_missed'])]
assert new.notional_proxy.min()*3000000>=9999.99
assert m['cost_pct']==0.5855 and m['online_deployed'] is False
assert not m['online_deployed']
print('OFFLINE_SNAPSHOT_CHECK_PASS',len(nav),len(order),m['return_pct'],m['mdd_pct'])
