#!/usr/bin/env python3
"""Independent full replay vs serialized checkpoint continuation parity."""
import argparse
import importlib.util
import json
import sys
from pathlib import Path
import numpy as np
from checkpoint_runtime import install, dumps, loads, ENGINE_SHA

parser = argparse.ArgumentParser()
parser.add_argument('--out', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, '/mnt/data')
spec = importlib.util.spec_from_file_location('c26_resume_validation', root/'source/C26_FROZEN_ENGINE.py')
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)
baseline, nav, detail = engine.replay_c26('C26_PARITY', detail=True)
assert len(nav) == 1407 and len(detail['orders']) == 1758
assert abs(baseline['return_pct'] - 1720.495844396837) < 1e-9
assert abs(baseline['mdd_pct'] + 17.989769234703846) < 1e-9
sc = engine.sc
cuts = [0, 199, 699, 1199, 1394, 1406]
original_wrapper = engine.m.ns['sim_with_cost']
fn, captured = install(sc, root/'source/C26_SIMULATOR_FROZEN.py', capture_days=cuts)
engine.m.real_sim = fn
sc['simulate'] = original_wrapper
_, captured_nav, captured_detail = engine.replay_c26('C26_PARITY', detail=True)
np.testing.assert_array_equal(nav, captured_nav)
assert dumps(detail['orders']) == dumps(captured_detail['orders'])
reports = []
for cut in cuts:
    checkpoint = loads(dumps(captured[cut]))
    fn, _ = install(sc, root/'source/C26_SIMULATOR_FROZEN.py', resume=checkpoint)
    engine.m.real_sim = fn
    sc['simulate'] = original_wrapper
    result, resumed_nav, resumed_detail = engine.replay_c26('C26_PARITY', detail=True)
    np.testing.assert_array_equal(nav, resumed_nav)
    for key in ['orders', 'exp', 'gate', 'stat']:
        assert dumps(detail[key]) == dumps(resumed_detail[key]), key
    assert result == baseline
    reports.append(dict(checkpoint_date=checkpoint['date'], resumed_trading_days=len(nav)-cut-1,
                        all_1758_order_rows_exact=True, all_1407_nav_values_exact=True,
                        cash_inventory_cost_risk_state_parity=True))
    print('C26_CHECKPOINT_RESUME_PASS', reports[-1], flush=True)
# An old display-only checkpoint must never silently initialize a strategy.
try:
    install(sc, root/'source/C26_SIMULATOR_FROZEN.py', resume={'date': '2026-10-27'})
except ValueError:
    pass
else:
    raise AssertionError('Incomplete checkpoint accepted')
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
(out/'runtime_checkpoint_20261027.json').write_text(dumps(captured[1406]), encoding='utf-8')
report = dict(lock_id='C26-EVENT-CORR-LOCK-20261112', simulator_sha256=ENGINE_SHA,
              historical_return_pct=baseline['return_pct'], historical_mdd_pct=baseline['mdd_pct'],
              continuation_parity_passed=True, comparisons=reports,
              source_inputs_after_20261027_verified=False, forward_portfolio_verified=False,
              today_plan_ready=False,
              note='Checkpoint continuation is verified on historical data only; no new market data or live plan is implied.')
(out/'checkpoint_runtime_validation.json').write_text(json.dumps(report, indent=2)+'\n')
