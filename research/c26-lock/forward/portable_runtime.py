"""Data-only portable inputs for the unchanged, SHA-locked C26 simulator.

NPZ is read with allow_pickle=False. Executable code comes only from the two
tracked frozen Python sources, never from the downloaded private input bundle.
"""
from pathlib import Path
from types import SimpleNamespace
import ast, builtins, hashlib, json, symtable
import numpy as np
import pandas as pd
from checkpoint_runtime import ENGINE_SHA

LOCK = 'C26-EVENT-CORR-LOCK-20261112'
VERSION = 1

def functions(source, names):
    tree = ast.parse(source)
    found = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    if {n.name for n in found} != set(names):
        raise ValueError('Frozen source function missing')
    return ast.fix_missing_locations(ast.Module(body=found, type_ignores=[]))

def export_inputs(engine, root, target, reference):
    root, target = Path(root), Path(target)
    source = (root/'source/C26_SIMULATOR_FROZEN.py').read_bytes()
    assert hashlib.sha256(source).hexdigest() == ENGINE_SHA
    symbols = symtable.symtable(source.decode(), '<frozen>', 'exec').lookup('simulate').get_namespace()
    needed = set()
    def walk(table):
        needed.update(s.get_name() for s in table.get_symbols() if s.is_global() and s.is_referenced())
        for child in table.get_children():
            walk(child)
    walk(symbols)
    needed -= set(vars(builtins)) | {'np', 'pd', 'm', 'cash_tick', 'tick_up', 'tick_down', 'stop_gate', 'EV_CORR_ALLOW'}
    needed |= {'EV_CORR_WINDOW', 'EV_CORR_THRESHOLD', 'EV_CORR_MAX_CLUSTER_W', 'EV_CORR_MIN_NEIGHBORS', 'LOG_COLUMNS'}
    sc = engine.sc
    cfg = sc['VARIANTS']['R1489_H']
    values = {k: sc[k] for k in needed}
    values['VARIANTS'] = {'R1489_H': dict(cfg), 'C26_FROZEN': dict(cfg)}
    for name, active in [('CHIP_BONUSES', cfg['chip_score']), ('CHIP_EXIT_MAP', cfg['chip_exit']), ('RISK_GATES', cfg['risk_gate'])]:
        values[name] = {key: sc[name][key] for key in {active, 'none'} if key in sc[name]}
    arrays = {}
    def pack(value):
        if isinstance(value, np.ndarray):
            if value.dtype.hasobject:
                raise ValueError('Object arrays cannot enter the private bundle')
            key = 'a'+str(len(arrays))
            arrays[key] = value
            return {'array': key}
        if isinstance(value, np.generic):
            return pack(value.item())
        if isinstance(value, pd.DatetimeIndex):
            return {'dates': value.strftime('%Y-%m-%d').tolist()}
        if isinstance(value, dict):
            return {'mapping': {str(k): pack(v) for k, v in value.items()}}
        if isinstance(value, (list, tuple)):
            return [pack(v) for v in value]
        if isinstance(value, float) and not np.isfinite(value):
            return {'float': str(value)}
        if value is None or isinstance(value, (str, bool, int, float)):
            return value
        raise TypeError('Unsupported portable input '+str(type(value)))
    meta = dict(version=VERSION, lock_id=LOCK, simulator_sha256=ENGINE_SHA,
                input_as_of='2026-10-27', numpy=np.__version__, pandas=pd.__version__,
                globals=pack(values), full_dates=sc['m'].D.strftime('%Y-%m-%d').tolist(),
                m_a=int(sc['m'].a), boundary_peer=np.asarray(engine._peer[-1], float).tolist(),
                reference=reference)
    arrays['metadata_json'] = np.array(json.dumps(meta, allow_nan=False))
    target.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(target, **arrays)
    return meta

class PortableEngine:
    def __init__(self, sc, peer, corr_scope, reference):
        self.sc, self._peer, self.corr_scope, self.reference = sc, peer, corr_scope, reference
        self.m = SimpleNamespace(real_sim=sc['simulate'], ns={})
        self.m.ns['sim_with_cost'] = lambda *args, **kwargs: self.m.real_sim(*args, **kwargs)

    @property
    def _C26_PRICES(self):
        return self.corr_scope['_C26_PRICES']

    @_C26_PRICES.setter
    def _C26_PRICES(self, value):
        self.corr_scope['_C26_PRICES'] = value

    @property
    def _C26_RET(self):
        return self.corr_scope['_C26_RET']

    @_C26_RET.setter
    def _C26_RET(self, value):
        self.corr_scope['_C26_RET'] = value

    def replay_c26(self, name='C26_FROZEN', detail=True):
        result = self.m.real_sim('R1489_H', detailed=detail)
        nav = result['eq']
        path = np.r_[1., nav]
        row = dict(self.reference)
        row.update(return_pct=float((nav[-1]-1)*100),
                   mdd_pct=float(100*np.min(path/np.maximum.accumulate(path)-1)))
        return row, nav, result

def load_inputs(target, root):
    root = Path(root)
    source = (root/'source/C26_SIMULATOR_FROZEN.py').read_bytes()
    assert hashlib.sha256(source).hexdigest() == ENGINE_SHA
    with np.load(target, allow_pickle=False) as bundle:
        meta = json.loads(str(bundle['metadata_json']))
        if (meta.get('version'), meta.get('lock_id'), meta.get('simulator_sha256'), meta.get('input_as_of')) != (VERSION, LOCK, ENGINE_SHA, '2026-10-27'):
            raise ValueError('Portable input version/lock mismatch')
        def unpack(value):
            if isinstance(value, list):
                return [unpack(v) for v in value]
            if not isinstance(value, dict):
                return value
            if set(value) == {'array'}:
                return bundle[value['array']].copy()
            if set(value) == {'dates'}:
                return pd.DatetimeIndex(value['dates'])
            if set(value) == {'mapping'}:
                return {k: unpack(v) for k, v in value['mapping'].items()}
            if set(value) == {'float'}:
                return float(value['float'])
            raise ValueError('Invalid data-only portable field')
        sc = unpack(meta['globals'])
    if sc['P'].shape != (2143, 233) or sc['N'] != 1407 or len(sc['D']) != 1407:
        raise ValueError('Unexpected frozen input dimensions')
    sc.update(np=np, pd=pd, m=SimpleNamespace(D=pd.DatetimeIndex(meta['full_dates']), a=meta['m_a']))
    sc['stop_gate'] = lambda sig,j,held,pnl: held>=5 and pnl>=.10 and sc['VOL_RATIO'][sig,j]>=2. and sc['RS5'][sig,j]<-.02
    # Separate input aliases are retained for the existing continuation bridge.
    sc['stop_gate'].__globals__['V'] = sc['VOL_RATIO']
    sc['stop_gate'].__globals__['RS5'] = sc['RS5']
    returns = np.full(sc['P'].shape, np.nan, np.float32)
    change = sc['P'][1:]/sc['P'][:-1]-1
    change[~np.isfinite(change)|(np.abs(change)>.2)] = np.nan
    returns[1:] = change.astype(np.float32)
    corr_scope = dict(np=np, sc=sc, _C26_PRICES=sc['P'], _C26_RET=returns)
    original = (root/'source/C26_FROZEN_ENGINE.py').read_text()
    exec(compile(functions(original, ['_c26_corr_allow']), '<C26_ORIGINAL_CORRELATION>', 'exec'), corr_scope)
    sc['EV_CORR_ALLOW'] = corr_scope['_c26_corr_allow']
    exec(compile(functions(source.decode(), ['cash_tick', 'tick_down', 'tick_up', 'simulate']), '<C26_PORTABLE_FROZEN>', 'exec'), sc)
    return PortableEngine(sc, np.array([meta['boundary_peer']], float), corr_scope, meta['reference'])
