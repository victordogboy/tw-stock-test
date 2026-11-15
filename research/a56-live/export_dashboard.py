"""Regenerate the full A56 dashboard from the recovered frozen research data."""
from pathlib import Path
import sys,json,gzip,base64,hashlib
import numpy as np,pandas as pd
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parents[0]/'a56-stage6'))
from checkpoint_a56 import install,dumps,loads
from account_io import Recorder,audit,clean,VERSION
sys.path.insert(0,str(Path(sys.argv[1]).resolve()))
import a56_robust_final as f
m=f.m;source=m.integrate(m.b.source);sha=hashlib.sha256(source.encode()).hexdigest()
expected=json.loads((ROOT.parent/'a56-stage6/checkpoint-verification.json').read_text())['source_sha256']
assert sha==expected
(ROOT/'source/A56_SIMULATOR_INTEGRATED.py').write_text(source)
recorder=Recorder(m.sc,lambda:m.route)
fn,captured=install(m.sc,source,expected_source_sha256=sha,capture_days=[len(m.dates)-1],routes=lambda:m.route,observer=recorder)
results={}
def capture_result(*args,**kwargs):
    result=fn(*args,**kwargs);results.update(result);return result
m.fn_open=capture_result
row,nav,orders,trades=f.evaluate((.06,.10,5,'open',None,.03,.40))
np.testing.assert_allclose(nav,pd.read_csv(m.ROOT/'A56_RELEASE/nav.csv.gz').nav,rtol=0,atol=1e-10)
assert len(orders)==38 and len(trades)==19
check=audit(recorder.snapshots,recorder.orders)
cp=captured[len(m.dates)-1]
assert dumps(cp['state'])==dumps(loads(gzip.decompress((ROOT.parent/'a56-stage6/A56_checkpoint_20261112.json.gz').read_bytes()).decode())['state'])
daily_plans=json.loads((ROOT.parents[1]/'public/r1494a/c26/a56/summary.json').read_text())
payload=clean(dict(model_version='A56',lock_id=VERSION,source_sha256=sha,as_of=str(m.dates[-1].date()),
  audited=True,audit=check,core_order_rows=recorder.core_cursor,side_order_rows=recorder.side_cursor,
  snapshots=recorder.snapshots,orders=sorted(recorder.orders,key=lambda x:x['date']),metrics=row,
  core_plans=[list(p[:12]) for p in results['plans']],
  anchor_next_plan=json.loads((ROOT/'bridge-parity.json').read_text())['next_plan']))
out=ROOT.parents[1]/'public/r1494a/c26/a56'
raw=json.dumps(payload,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()
(out/'dashboard-history.b64').write_text(base64.b64encode(gzip.compress(raw,mtime=0)).decode())
(out/'dashboard-history-index.json').write_text(json.dumps(dict(version=VERSION,source_sha256=sha,sha256=hashlib.sha256(raw).hexdigest(),days=1419,orders=len(recorder.orders)),indent=2))
(ROOT/'dashboard-audit.json').write_text(json.dumps(dict(**check,source_sha256=sha,history_sha256=hashlib.sha256(raw).hexdigest(),core_order_rows=recorder.core_cursor,side_order_rows=recorder.side_cursor),indent=2))
print('A56_DASHBOARD_EXPORTED',check,flush=True)
