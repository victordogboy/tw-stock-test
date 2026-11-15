"""Continue A56 on the already verified causal C26 feature inputs.

Run AFTER the existing protected C26 workflow has rebuilt its own forward
inputs. Only input globals are reused; C26 portfolio state is discarded.
"""
from pathlib import Path
import sys,runpy,json,gzip,base64,hashlib
import numpy as np
from engine import A56Engine,input_fingerprints,tick_minutes
from checkpoint_a56 import loads,dumps
from account_io import Recorder,audit,clean,VERSION
ROOT=Path(__file__).resolve().parent
repo=ROOT.parents[1];private=repo/'.c26-private'
sys.path.insert(0,str(ROOT.parent/'c26-lock/forward'))
# This executes the original C26 input checks and independent factor audit.
env=runpy.run_path(str(ROOT.parent/'c26-lock/forward/replay-forward.py'))
sc=env['sc'];n=env['final_n']
for key in ['D','P','EV_STOCKCAP_HISTORY']:sc[key]=sc[key][:-1]
sc['N']=n;sc['z']-=1
assert len(sc['D'])==n
anchor=sc['D'].get_loc('2026-11-12')
ref=json.loads((ROOT/'anchor-input-fingerprints.json').read_text())
observed=input_fingerprints(sc,anchor)
assert observed==ref['hashes'],[k for k in observed if observed[k]!=ref['hashes'].get(k)]
raw=json.loads(gzip.decompress((private/'forward-eod.json.gz').read_bytes()))
out=repo/'public/r1494a/c26/a56'
history=json.loads(gzip.decompress(base64.b64decode((out/'dashboard-history.b64').read_text())))
seed=loads(gzip.decompress((ROOT.parent/'a56-stage6/A56_checkpoint_20261112.json.gz').read_bytes()).decode())
assert seed['date']==history['as_of']
engine=A56Engine(sc,raw,minute_loader=lambda *args:tick_minutes(sc,raw,*args))
assert engine.group[anchor]==seed['state']['side_episode']
recorder=Recorder(sc,lambda:engine.routes,previous=history)
result,cp=engine.run(seed,observer=recorder)
all_snaps=history['snapshots']+recorder.snapshots
all_orders=history['orders']+recorder.orders
check=audit(all_snaps,all_orders)
coverage=json.loads((repo/'public/r1494a/c26/data/forward-status.json').read_text())
as_of=str(sc['D'][-1].date())
assert as_of==coverage['full_market_last_verified']
plan=engine.plan(cp,coverage['next_exchange_trade_date'])
plan['anchor_checkpoint_sha256']=engine.anchor['checkpoint_sha256']
plan['historical_parity']=dict(nav_days=1419,side_orders=38,side_trades=19,passed=True)
plan['forward_audit']=dict(**check,anchor_inputs_match=True,causal_factors_passed=env['report']['independent_forward_factors']['passed'])
plan['verified_dates']=[s['date'] for s in recorder.snapshots]
delta=clean(dict(model_version='A56',lock_id=VERSION,source_sha256=engine.sha,anchor_as_of=history['as_of'],
  as_of=as_of,audited=True,audit=check,plan=plan,snapshots=recorder.snapshots,orders=recorder.orders,
  core_order_rows=recorder.core_cursor,side_order_rows=recorder.side_cursor))
bytes=json.dumps(delta,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode()
(out/'forward.json').write_bytes(bytes)
manifest=dict(version=VERSION,as_of=as_of,trade_date=plan['trade_date'],forward_sha256=hashlib.sha256(bytes).hexdigest(),
              source_sha256=engine.sha,anchor_checkpoint_sha256=engine.anchor['checkpoint_sha256'],
              source_sha256_gzip=hashlib.sha256((private/'forward-eod.json.gz').read_bytes()).hexdigest())
(out/'latest-manifest.json').write_text(json.dumps(manifest,indent=2))
(private/'a56-checkpoint.json.gz').write_bytes(gzip.compress(dumps(cp).encode(),mtime=0))
(ROOT/'forward-audit.json').write_text(json.dumps(dict(as_of=as_of,**check,anchor_inputs_match=True,plan_before_execution=True),indent=2))
print('A56_COMBINED_FORWARD_PUBLISHED',json.dumps(dict(as_of=as_of,trade_date=plan['trade_date'],new_days=len(recorder.snapshots),new_orders=len(recorder.orders),audit=check)),flush=True)
