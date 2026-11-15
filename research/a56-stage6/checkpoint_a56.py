"""Capture/resume the frozen combined A56+C26 account, not C26-only holdings.

Only the daily loop bounds and checkpoint instrumentation are changed. A caller
must provide the same frozen globals, complete causal inputs and config.
"""
import ast
import copy
import hashlib
import importlib.util
from pathlib import Path
import numpy as np

LOCK = 'A56-LOCK-20261116'
RULE = dict(single=.06, cumulative=.10, hold_days=5, exit='open',
            open_cap=.03, allocation=.40, tail='off', round_trip_cost=.005855)
_path = Path(__file__).resolve().parents[1]/'c26-lock/forward/checkpoint_runtime.py'
_spec = importlib.util.spec_from_file_location('_c26_checkpoint_codec', _path)
_codec = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_codec)
dumps, loads = _codec.dumps, _codec.loads
STOCK_ARRAYS = _codec.STOCK_ARRAYS + 'side side_entry side_peak side_day'.split()
DAY_ARRAYS = _codec.DAY_ARRAYS
OTHER = _codec.OTHER + 'side_reason side_first side_used side_episode side_pending'.split()
STATE_KEYS = STOCK_ARRAYS + DAY_ARRAYS + OTHER
GLOBAL_KEYS = ['A32_ORDERS', 'A32_TRACE', 'A38_LOG']


def install(runtime, source, *, expected_source_sha256, resume=None, capture_days=(), routes=None):
    """Return simulator and checkpoints; preserve original date/stock indices.

    The source is the fully integrated A56 simulator, rather than the original
    C26-only file. Calling with an incomplete display snapshot is an error.
    """
    sha = hashlib.sha256(source.encode()).hexdigest()
    if sha != expected_source_sha256:
        raise ValueError('Integrated A56 source hash mismatch')
    codes = [str(c) for c in runtime['K']]
    dates = [str(d.date()) for d in runtime['D']]
    captured = {}
    start = 0
    restored = None
    if resume is not None:
        if resume.get('schema') != 1 or resume.get('lock_id') != LOCK or resume.get('source_sha256') != sha or resume.get('rule') != RULE:
            raise ValueError('Wrong A56 checkpoint schema, lock, code or rule')
        start = resume['trade_index'] + 1
        if not 0 < start <= len(dates) or resume['date'] != dates[start-1] or resume['codes'] != codes or resume['dates'] != dates[:start]:
            raise ValueError('Checkpoint calendar or stock ordering mismatch')
        restored = copy.deepcopy(resume['state'])
        if set(restored) != set(STATE_KEYS) or set(resume['global_state']) != set(GLOBAL_KEYS):
            raise ValueError('Incomplete combined account state')
        for key in STOCK_ARRAYS:
            if not isinstance(restored[key], np.ndarray) or restored[key].shape != (len(codes),):
                raise ValueError('Invalid stock state: ' + key)
        for key in DAY_ARRAYS:
            prefix = restored[key]
            if not isinstance(prefix, np.ndarray) or prefix.shape != (start,):
                raise ValueError('Incomplete daily account history: ' + key)
            full = np.zeros(len(dates), dtype=prefix.dtype)
            full[:start] = prefix
            restored[key] = full
        if len(restored['side_reason']) != len(codes):
            raise ValueError('Invalid side exit state')

    def capture(t, scope):
        if t not in capture_days:
            return
        state = {key: copy.deepcopy(scope[key]) for key in STATE_KEYS}
        for key in DAY_ARRAYS:
            state[key] = state[key][:t+1].copy()
        captured[t] = dict(schema=1, lock_id=LOCK, source_sha256=sha, rule=RULE,
                           date=dates[t], trade_index=t, codes=codes,
                           dates=dates[:t+1], state=state,
                           global_state={k: copy.deepcopy(runtime[k]) for k in GLOBAL_KEYS},
                           routes=copy.deepcopy(routes() if routes else {}))

    runtime['_A56_START'] = start
    runtime['_A56_RESTORE'] = restored
    runtime['_A56_CAPTURE'] = capture
    tree = ast.parse(source)
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'simulate')
    loops = [(i, n) for i, n in enumerate(fn.body) if isinstance(n, ast.For)]
    if len(loops) != 1:
        raise ValueError('Frozen daily loop structure changed')
    loop_index, loop = loops[0]
    if ast.unparse(loop.iter) != 'enumerate(range(a, z + 1))':
        raise ValueError('Unexpected frozen loop bounds')
    loop.iter = ast.parse('enumerate(range(a + _A56_START, z + 1), start=_A56_START)', mode='eval').body
    loop.body += ast.parse('_A56_CAPTURE(t, locals())').body
    assignments = '\n'.join(f' {key} = _A56_RESTORE[{key!r}]' for key in STATE_KEYS)
    fn.body[loop_index:loop_index] = ast.parse('if _A56_RESTORE is not None:\n'+assignments).body
    module = ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[]))
    exec(compile(module, '<A56_CHECKPOINT_RUNTIME>', 'exec'), runtime)
    simulator = runtime['simulate']

    def run(*args, **kwargs):
        # A56 research run() clears global logs before each simulator call.
        # Restore only at call-time, after that reset, and retain prefix orders.
        if resume is not None:
            runtime.update(copy.deepcopy(resume['global_state']))
        return simulator(*args, **kwargs)
    return run, captured
