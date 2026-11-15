#!/usr/bin/env python3
"""One-time private data bundle export and full frozen-engine parity proof."""
from pathlib import Path
import importlib.util, sys, json, hashlib
import numpy as np
from checkpoint_runtime import dumps
from portable_runtime import export_inputs, load_inputs
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, '/mnt/data')
sp = importlib.util.spec_from_file_location('c26_original_export', root/'source/C26_FROZEN_ENGINE.py')
engine = importlib.util.module_from_spec(sp)
sp.loader.exec_module(engine)
reference, nav, detail = engine.replay_c26('C26_FROZEN', detail=True)
assert len(nav)==1407 and len(detail['orders'])==1758
target = Path('.c26-private/c26-runtime.npz')
export_inputs(engine, root, target, reference)
portable = load_inputs(target, root)
row, replay_nav, replay_detail = portable.replay_c26('C26_FROZEN', detail=True)
np.testing.assert_array_equal(nav, replay_nav)
for key in ['orders', 'gate', 'target', 'exp', 'stat', 'final_positions']:
    assert dumps(detail[key]) == dumps(replay_detail[key]), key
assert row['return_pct'] == reference['return_pct']
assert row['mdd_pct'] == reference['mdd_pct']
report = dict(lock_id='C26-EVENT-CORR-LOCK-20261112', passed=True,
              portable_bundle_sha256=hashlib.sha256(target.read_bytes()).hexdigest(),
              portable_bytes=target.stat().st_size, historical_days=1407, historical_orders=1758,
              nav_bit_exact=True, orders_bit_exact=True, cash_risk_target_bit_exact=True,
              numpy=np.__version__, data_only_no_pickle=True)
Path('research/c26-lock/forward/portable-runtime-parity.json').write_text(json.dumps(report, indent=2)+'\n')
print('C26_PORTABLE_PARITY', json.dumps(report), flush=True)
