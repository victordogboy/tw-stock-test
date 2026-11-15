"""Independent callback bridge parity on an active historical A56 cycle."""
from pathlib import Path
import sys,json,gzip,hashlib
import numpy as np
from engine import A56Engine,input_fingerprints
from checkpoint_a56 import install,dumps,loads
ROOT=Path(__file__).resolve().parent
replay=Path(sys.argv[1]).resolve();sys.path.insert(0,str(replay))
import a56_robust_final as f
m=f.m;source=m.integrate(m.b.source);sha=hashlib.sha256(source.encode()).hexdigest()
start=m.dates.get_loc('2026-11-05');last=len(m.dates)-1
fn,caps=install(m.sc,source,expected_source_sha256=sha,capture_days=[start,last],routes=lambda:m.route)
m.fn_open=fn
row,nav,orders,trades=f.evaluate((.06,.10,5,'open',None,.03,.40))
final=loads(dumps(caps[last]));seed=loads(dumps(caps[start]))
raw=json.loads(gzip.decompress((replay/'A30_forward/private-input/forward-eod.json.gz').read_bytes()))
def minutes(date,code,t,j):
    z=m.cache[(t,j)].copy();z[:,4]*=1000;return z
engine=A56Engine(m.sc,raw,minute_loader=minutes)
result,end=engine.run(seed)
np.testing.assert_array_equal(result['eq'],nav)
assert dumps(result['orders'])==dumps(final['state']['orders'])
assert dumps(end['state'])==dumps(final['state'])
assert dumps(end['global_state'])==dumps(final['global_state'])
fingerprints=input_fingerprints(m.sc,last)
(ROOT/'anchor-input-fingerprints.json').write_text(json.dumps(dict(as_of='2026-11-12',precision_decimals=3,hashes=fingerprints),indent=2))
plan=engine.plan(end,'2026-11-13')
assert plan['no_future_execution_prices'] and plan['signal_as_of']=='2026-11-12'
assert plan['trade_date']=='2026-11-13' and plan['actions']
(ROOT/'bridge-parity.json').write_text(json.dumps(dict(passed=True,start='2026-11-05',end='2026-11-12',
  nav_days=len(nav),side_orders=len(orders),core_orders=len(result['orders']),max_nav_error=0.,
  full_final_state_exact=True,global_histories_exact=True,next_plan_captured_before_execution=True,
  next_plan=plan),ensure_ascii=False,indent=2))
print('A56_FORWARD_BRIDGE_PARITY_PASSED',len(nav),len(orders),flush=True)
