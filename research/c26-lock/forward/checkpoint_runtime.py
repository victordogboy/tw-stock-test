"""Resume the byte-locked C26 simulator without changing its trading statements.

Only loop bounds, state restoration and end-of-day capture are instrumented.
The caller must supply the original runtime globals and verified feature data.
This module neither fetches data nor declares a current trading plan ready.
"""
from __future__ import annotations
import ast
import copy
import hashlib
import json
from pathlib import Path
import numpy as np

ENGINE_SHA = '741862f102438f8f10fcf40cf2f9b47edb8fece004e0175ae3f1be7e94bd4ad5'
LOCK = 'C26-EVENT-CORR-LOCK-20261112'
STOCK_ARRAYS = 'qty held peak cool basis atr_entry cycle_buy cycle_sell fc17_watch_t fc17_watch_price'.split()
DAY_ARRAYS = 'equity expos turn maxw gate_history gate_target'.split()
OTHER = ('cash cycles buy sell swaps pending_buy pending_sell EV_PENDING EV_LAST_EXIT_SCORE '
         'EV_STOCKCAP_ACTIVE EV_STOCKCAP_PREV fc17_selected stat orders closed positions plans '
         'state basket_risk overlay_risk prev_target port_risk dd_gate risk_recover recover_level dd_level').split()
STATE_KEYS = STOCK_ARRAYS + DAY_ARRAYS + OTHER

def encode(x):
    if isinstance(x, np.ndarray):
        return {'__array__': x.dtype.str, 'values': encode(x.tolist())}
    if isinstance(x, np.generic):
        return encode(x.item())
    if isinstance(x, float) and not np.isfinite(x):
        return {'__float__': str(x)}
    if isinstance(x, set):
        return {'__set__': [encode(v) for v in sorted(x)]}
    if isinstance(x, tuple):
        return {'__tuple__': [encode(v) for v in x]}
    if isinstance(x, dict):
        return {'__dict__': [[encode(k), encode(v)] for k, v in x.items()]}
    if isinstance(x, list):
        return [encode(v) for v in x]
    return x

def decode(x):
    if isinstance(x, list):
        return [decode(v) for v in x]
    if not isinstance(x, dict):
        return x
    if '__array__' in x:
        return np.asarray(decode(x['values']), dtype=x['__array__'])
    if '__float__' in x:
        return float(x['__float__'])
    if '__set__' in x:
        return set(decode(v) for v in x['__set__'])
    if '__tuple__' in x:
        return tuple(decode(v) for v in x['__tuple__'])
    if '__dict__' in x:
        return {decode(k): decode(v) for k, v in x['__dict__']}
    raise ValueError('Unknown checkpoint encoding')

def dumps(checkpoint):
    return json.dumps(encode(checkpoint), ensure_ascii=False, allow_nan=False, separators=(',', ':'))

def loads(text):
    return decode(json.loads(text))

def install(runtime, source: Path, *, resume=None, capture_days=()):
    """Return instrumented simulator and captured states. Retains global date indices."""
    raw = source.read_bytes()
    if hashlib.sha256(raw).hexdigest() != ENGINE_SHA:
        raise ValueError('Frozen simulator SHA mismatch')
    codes = [str(v) for v in runtime['K']]
    dates = [str(v.date()) for v in runtime['D']]
    captured = {}
    start = 0
    if resume is not None:
        if resume.get('schema') != 1 or resume.get('lock_id') != LOCK or resume.get('engine_sha256') != ENGINE_SHA:
            raise ValueError('Checkpoint schema/lock mismatch')
        start = resume['trade_index'] + 1
        if not 0 < start <= len(dates) or resume['date'] != dates[start - 1] or resume['codes'] != codes:
            raise ValueError('Checkpoint date or stock ordering mismatch')
        if resume['dates'] != dates[:start]:
            raise ValueError('Checkpoint trading calendar prefix mismatch')
        state = copy.deepcopy(resume['state'])
        if set(state) != set(STATE_KEYS):
            raise ValueError('Incomplete state; display-only checkpoint cannot resume the engine')
        for key in STOCK_ARRAYS:
            if state[key].shape != (len(codes),):
                raise ValueError('Invalid stock state shape: ' + key)
        for key in DAY_ARRAYS:
            prefix = state[key]
            if prefix.shape != (start,):
                raise ValueError('Incomplete daily history: ' + key)
            full = np.zeros(len(dates), dtype=prefix.dtype)
            full[:start] = prefix
            state[key] = full
        runtime['_C26_RESTORE_STATE'] = state
    else:
        runtime['_C26_RESTORE_STATE'] = None

    def capture(t, scope):
        if t not in capture_days:
            return
        state = {key: copy.deepcopy(scope[key]) for key in STATE_KEYS}
        for key in DAY_ARRAYS:
            state[key] = state[key][:t + 1].copy()
        # No uninitialized future NAV values, and no future source rows.
        captured[t] = dict(schema=1, lock_id=LOCK, engine_sha256=ENGINE_SHA,
                           date=dates[t], trade_index=t, codes=codes,
                           dates=dates[:t + 1], state=state)

    runtime['_C26_START'] = start
    runtime['_C26_CAPTURE_STATE'] = capture
    tree = ast.parse(raw.decode())
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'simulate')
    loops = [(i, n) for i, n in enumerate(fn.body) if isinstance(n, ast.For)]
    if len(loops) != 1:
        raise ValueError('Frozen daily loop structure changed')
    loop_index, loop = loops[0]
    if ast.unparse(loop.iter) != 'enumerate(range(a, z + 1))':
        raise ValueError('Unexpected frozen loop bounds')
    loop.iter = ast.parse('enumerate(range(a + _C26_START, z + 1), start=_C26_START)', mode='eval').body
    loop.body += ast.parse('_C26_CAPTURE_STATE(t, locals())').body
    restore = '\n'.join(f' {key} = _C26_RESTORE_STATE[{key!r}]' for key in STATE_KEYS)
    fn.body[loop_index:loop_index] = ast.parse('if _C26_RESTORE_STATE is not None:\n' + restore).body
    module = ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[]))
    exec(compile(module, '<C26_CHECKPOINT_RUNTIME>', 'exec'), runtime)
    return runtime['simulate'], captured
