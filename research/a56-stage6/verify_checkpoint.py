"""Full-run vs resumed A56 account parity on recovered original archives."""
import sys
import json
import gzip
import hashlib
from pathlib import Path
import numpy as np
import pandas as pd
from checkpoint_a56 import install, dumps, loads, RULE

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(Path(sys.argv[1]).resolve()))
import a56_robust_final as f
m=f.m
source=m.integrate(m.b.source)
sha=hashlib.sha256(source.encode()).hexdigest()
days=['2021-05-17','2025-04-09','2026-11-05','2026-11-06','2026-11-11','2026-11-12']
indices=[m.dates.get_loc(d) for d in days]
fn,captured=install(m.sc,source,expected_source_sha256=sha,capture_days=indices,routes=lambda:m.route)
m.fn_open=fn
config=(.06,.10,5,'open',None,.03,.40)
row,nav,orders,trades=f.evaluate(config)
reference=m.ROOT/'A56_RELEASE'
np.testing.assert_allclose(nav,pd.read_csv(reference/'nav.csv.gz').nav,rtol=0,atol=1e-10)
ref_orders=pd.read_csv(reference/'orders.csv.gz',dtype={'code':str})
pd.testing.assert_frame_equal(pd.DataFrame(orders,columns=ref_orders.columns),ref_orders,check_dtype=False,rtol=1e-10,atol=1e-10)
ref_trades=pd.read_csv(reference/'trades.csv',dtype={'code':str,'sell_code':str})
pd.testing.assert_frame_equal(pd.DataFrame(trades,columns=ref_trades.columns),ref_trades,check_dtype=False,rtol=1e-10,atol=1e-10)
final=loads(dumps(captured[indices[-1]]))
checks=[]
for index in indices:
    cp=loads(dumps(captured[index]))
    simulator,end=install(m.sc,source,expected_source_sha256=sha,resume=cp,
                          capture_days=[len(m.dates)-1],routes=lambda:m.route)
    def run(*args, _fn=simulator, _cp=cp, **kwargs):
        m.route.update(_cp['routes'])
        return _fn(*args,**kwargs)
    m.fn_open=run
    rr,nn,oo,tt=f.evaluate(config)
    np.testing.assert_allclose(nn,nav,rtol=0,atol=1e-10)
    assert dumps(oo)==dumps(orders)
    assert dumps(tt)==dumps(trades)
    if index < len(m.dates)-1:
        assert dumps(end[len(m.dates)-1]['state'])==dumps(final['state'])
        assert dumps(end[len(m.dates)-1]['global_state'])==dumps(final['global_state'])
    checks.append(dict(date=cp['date'],nav_days=len(nn),side_orders=len(oo),side_trades=len(tt),
                       side_positions=int(np.count_nonzero(cp['state']['side']>1e-13)),
                       passed=True,max_nav_absolute_error=float(np.max(np.abs(nn-nav)))))
    print('A56_RESUME_PARITY',checks[-1],flush=True)

# Negative tests are real serialized account checkpoints, not invented fixtures.
negative=[]
for name,mutate in [
 ('wrong_lock',lambda c:c.update(lock_id='C26')),
 ('missing_side_state',lambda c:c['state'].pop('side')),
 ('wrong_code_order',lambda c:c['codes'].reverse()),
 ('wrong_calendar',lambda c:c['dates'].pop()),
 ('wrong_allocation',lambda c:c['rule'].update(allocation=.5)),
 ('missing_global_orders',lambda c:c['global_state'].pop('A32_ORDERS')),
]:
    cp=loads(dumps(final));mutate(cp)
    try:install(m.sc,source,expected_source_sha256=sha,resume=cp)
    except ValueError:negative.append(name)
    else:raise AssertionError('Invalid checkpoint accepted: '+name)

raw=dumps(final).encode()
(ROOT/'A56_checkpoint_20261112.json.gz').write_bytes(gzip.compress(raw,mtime=0))
state=final['state']; prices=m.P[m.a+len(m.dates)-1]
holdings=[dict(code=code,core_shares=float(state['qty'][j]*3e6),
               side_shares=float(state['side'][j]*3e6),mark=float(prices[j]))
          for j,code in enumerate(m.codes) if state['qty'][j]+state['side'][j]>1e-13]
equity=float(state['equity'][-1]*3e6)
cash=float(state['cash']*3e6)
assert abs(cash+sum((h['core_shares']+h['side_shares'])*h['mark'] for h in holdings)-equity)<.01
report=dict(schema=1,version='A56-LOCK-20261116',status='historical_checkpoint_verified',
            as_of=final['date'],source_sha256=sha,checkpoint_sha256=hashlib.sha256(raw).hexdigest(),
            rule=RULE,full_replay=dict(nav_days=len(nav),side_orders=len(orders),side_trades=len(trades)),
            resume_checks=checks,rejected_checkpoints=negative,
            paper_account=dict(cash_twd=cash,equity_twd=equity,holdings=holdings,
                               side_first=state['side_first'],side_used=bool(state['side_used']),
                               side_episode=int(state['side_episode']),side_pending=bool(state['side_pending'])),
            current_plan_ready=False,actions=[],broker_orders_submitted=False,
            limitation='Checkpoint resumes verified history only; latest complete feeds and post-anchor A56 replay are still required.')
(ROOT/'checkpoint-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print('A56_CHECKPOINT_VERIFIED',len(checks),'resumes',len(negative),'rejections',flush=True)
