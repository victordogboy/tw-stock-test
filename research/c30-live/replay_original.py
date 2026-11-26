"""Run RISK23 in a writable copy of its hashed private archive."""
import argparse
import json
import os
import runpy
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from stage_inputs import ANCHOR, LABEL

VARIANT = 'rev_decay_ratio175_cash_dailypositivetwice'
RUN_NAME = 'linear__baseline__weighted_atr__target_both__pair__' + VARIANT
SIGNAL_MARK = 'fn,captured=install(sc,source,resume=checkpoint'
FORWARD = 'A30_forward/research/c26-lock/forward/replay-forward.py'
CONTINUATION = """
from replay_original import append_inert_session
append_inert_session(sc, e)
"""


def append_inert_session(sc, engine):
    """An exchange date with no executable prices, after all verified closes."""
    trade_date = os.environ['C30_PLAN_DATE']
    assert trade_date > sc['D'][-1].strftime('%Y-%m-%d')
    sc['D'] = sc['D'].append(pd.DatetimeIndex([trade_date]))
    sc['m'].D = sc['m'].D.append(pd.DatetimeIndex([trade_date]))
    n, z = sc['N'], sc['z']
    for key, value in tuple(sc.items()):
        if not isinstance(value, np.ndarray) or value.ndim == 0:
            continue
        if len(value) not in (n, z + 1):
            continue
        if key in ('O', 'H', 'L', 'C'):
            row = np.full_like(value[-1:], np.nan)
        elif key in ('EXEC', 'VALID', 'LOCK_UP', 'LOCK_DOWN'):
            row = np.zeros_like(value[-1:])
        else:
            # Carried prior marks support the inert valuation only. There is
            # no OHLC or volume record of the planned session.
            row = value[-1:]
        sc[key] = np.concatenate((value, row))
    for key in ('CHIP_BONUSES', 'CHIP_EXIT_MAP', 'RISK_GATES'):
        for name, value in sc[key].items():
            if isinstance(value, np.ndarray) and len(value) == z + 1:
                sc[key][name] = np.concatenate((value, value[-1:]))
    sc['N'], sc['z'] = n + 1, z + 1
    engine._C26_PRICES = sc['P']
    engine._C26_RET = np.vstack([engine._C26_RET, np.full_like(engine._C26_RET[-1], np.nan)])


def run_original(bundle, trade_date):
    path_read = Path.read_text

    def staged_read(path, *args, **kwargs):
        source = path_read(path, *args, **kwargs)
        if str(path).endswith(FORWARD):
            assert source.count(SIGNAL_MARK) == 1
            return source.replace(SIGNAL_MARK, CONTINUATION + SIGNAL_MARK)
        if path.name == 'c30_market_root.py':
            marker = "    for i,c in enumerate(contexts[1:],start=len(f['F5'])):"
            assert source.count(marker) == 1
            return source.replace(marker, "    contexts.append(contexts[-1])\n" + marker)
        return source

    if not Path('/mnt/data/R1748_FC08_work').exists():
        raise RuntimeError('The private /mnt/data archive is not mounted')
    os.chdir(bundle / 'lock/workspace')
    os.environ.update(C30_REV_COMPLETE='1', C30_REV_VALIDATION='1', C30_RISK18='1',
                      C30_RISK19='1', C30_RISK20='1', C30_REV_WARNING_TAIEX='1',
                      C30_REV_GATE='.06,.10', C30_PLAN_DATE=trade_date)
    driver = bundle / 'c30_research/c30_improve_replay.py'
    sys.argv = [str(driver), LABEL, VARIANT]
    sys.path.insert(0, str(driver.parent))
    captured = {}
    positions = {}

    def trace_close(frame, event, _):
        if event != 'line':
            return trace_close
        namespace = frame.f_globals
        traces = namespace['A32_TRACE']
        if not traces:
            return trace_close
        date, *_ = traces[-1]
        if ANCHOR < date < trade_date and date not in positions:
            state = frame.f_locals
            # The engine has recorded NAV, fills and holdings at this line.
            prices = state['px']
            positions[date] = [
                dict(code=str(namespace['K'][j]), sleeve=sleeve, q=float(quantities[j]),
                     entry=float(bases[j]), p=float(prices[j]), start=date, last=date)
                for sleeve, quantities, bases in (
                    ('core', state['qty'], state['basis']), ('reversal', state['side'], state['side_entry']))
                for j in np.flatnonzero(quantities > 1e-13)
            ]
        return trace_close

    def trace_calls(frame, event, _):
        if event == 'call' and frame.f_code.co_name == 'simulate' and 'ROOT_REFILL_EVENTS' in frame.f_globals:
            return trace_close
        return None

    def capture(frame, event, result):
        if (event == 'return' and frame.f_code.co_name == 'simulate'
                and 'ROOT_REFILL_EVENTS' in frame.f_globals and isinstance(result, dict)):
            captured.update(result)
            captured['next_buy_intents'] = frame.f_locals['entrants'].copy()
            captured['pending_limit_buys'] = [int(j) for j in frame.f_locals['pending_buy']]
            captured['next_open_rebalance'] = bool(frame.f_locals['rebalance'])
            captured['side_ranked'] = frame.f_globals['A32_DATA'].get(frame.f_locals['t'])
            captured['pending_sell_count'] = len(frame.f_locals['pending_sell'])
            captured['open_budget'] = float(frame.f_locals['a60_budget'])
            captured['opening_conditions'] = {
                'riskBlocksReversal': bool(frame.f_locals['z79_on'] and frame.f_globals['Z79_SIDE'] != 'off'),
                'openingRoute': bool(frame.f_globals['A51_OPEN']),
                'excludedEpisode': bool(frame.f_globals['A32_EID'][frame.f_locals['t']] == frame.f_globals['A51_EXCLUDE']),
                'reversalLimit': float(frame.f_globals['A44_LIMIT']),
            }
            captured['side_trace'] = frame.f_globals['A32_TRACE'].copy()

    previous_profile, previous_trace = sys.getprofile(), sys.gettrace()
    Path.read_text = staged_read
    sys.setprofile(capture)
    sys.settrace(trace_calls)
    try:
        state = runpy.run_path(str(driver), run_name='__main__')
        state['kernel'] = captured
        state['positions'] = positions
        return state
    finally:
        sys.settrace(previous_trace)
        sys.setprofile(previous_profile)
        Path.read_text = path_read


def numeric(value):
    return float(value) if pd.notna(value) and np.isfinite(value) else None

def main():
    cli = argparse.ArgumentParser()
    cli.add_argument('bundle', type=Path)
    cli.add_argument('stage', type=Path)
    cli.add_argument('output', type=Path)
    args = cli.parse_args()
    bundle, output = args.bundle.resolve(), args.output.resolve()
    staged = json.loads(args.stage.read_text())
    trade_date = staged['trade_date']
    retained = run_original(bundle, trade_date)
    trace = retained['t']
    ref = pd.read_csv(bundle / 'anchor/daily.csv.gz')
    if trace.date.iloc[-1] != trade_date or trace.date.iloc[-2] != staged['signal_date']:
        raise ValueError('C30 replay calendar does not end on the verified and inert dates')
    pd.testing.assert_frame_equal(trace[trace.date <= ANCHOR].reset_index(drop=True), ref,
                                  check_exact=False, atol=1e-10, rtol=0)
    missing = pd.read_csv(retained['OUT'] / 'missing.csv')
    missing = missing[(missing.date > ANCHOR) & (missing.date < trade_date)]
    sc = retained['sc']
    stop_gaps = [dict(date=date, code=code, reason='standing_stop') for date, code, _, status, *_ in sc['Z87_LOG']
                 if ANCHOR < date < trade_date and status == 'missing']
    if len(missing) or stop_gaps:
        output.write_text(json.dumps({'readiness': 'blocked',
                                      'missing_minutes': missing.to_dict('records') + stop_gaps}))
        return
    kernel = retained['kernel']
    if not kernel or kernel['side_trace'][-1][0] != trade_date:
        raise ValueError('The RISK23 execution trace did not reach the intended next session')
    i = sc['N'] - 1
    if np.any(sc['VALID'][i]) or np.any(sc['EXEC'][sc['z']]):
        raise ValueError('C30 plan must never admit execution on its pending session')
    rows = []
    for row in retained['kernel']['plans']:
        _, signal, execution, code, category, method, prior, level, stop, take, fallback, reason, *ohlc = row
        if execution == trade_date:
            if signal != staged['signal_date'] or not all(np.isnan(x) for x in ohlc):
                raise ValueError('C30 plan boundary used unexpected execution prices')
            rows.append(dict(code=str(code), sleeve='core', category=category, method=method,
                             prior=prior, level=level, stop=stop, take=take, fallback=fallback, reason=reason))
    for date, code, action, reason, minute, price in sc['A38_LOG']:
        if date == trade_date:
            if action != 'DEFER' or minute != 0 or not np.isnan(price):
                raise ValueError('C30 open replay has a future reversal fill')
            rows.append(dict(code=str(code), sleeve='reversal', category='SELL_OR_HOLD',
                             method='SELL_OPEN', reason=reason, fallback='DEFER_LOCKED_EXIT'))
    day = trace.iloc[-2]
    held = retained['hold']
    if not held.empty:
        held = held[held.date == staged['signal_date']]
    last = retained['risk'].iloc[-1]
    target = float(trace.target.iloc[-1])
    if day.core_names + day.side_names > 8 or abs(day.cash + day.core_value + day.side_value - day.nav)>1e-9:
        raise ValueError('C30 verified closing cash and holdings do not reconcile')
    _, _, _, _, _, _, _, side_first, side_used, side_pending = kernel['side_trace'][-1]
    snapshots, orders = [], []
    index = pd.read_csv(bundle / 'c30_research' / 'c30_database_results' / 'benchmark.csv').set_index('date').TAIEX
    for o in pd.read_csv(retained['OUT'] / 'core_orders.csv.gz', dtype={'code': str}).itertuples():
        if ANCHOR < o.date < trade_date:
            orders.append(dict(date=o.date, signal=o.signal_date, code=o.code, side=o.action, sleeve='core',
                               type=o.type, level=numeric(o.level), price=numeric(o.price), quantity=numeric(o.shares),
                               notional=numeric(o.notional), realized=numeric(o.realized), reason=o.reason, filled=bool(o.filled)))
    prior = dict(zip(trace.date.iloc[1:], trace.date.iloc[:-1]))
    for date, minute, code, action, price, qty, value, target_weight in sc['A32_ORDERS']:
        if ANCHOR < date < trade_date:
            orders.append(dict(date=date, signal=prior[date], code=code, side=action, sleeve='reversal',
                               type='OPEN' if minute == 0 else 'INTRADAY', price=float(price), quantity=float(qty),
                               notional=float(value), reason='reversal', filled=True))
    orders.sort(key=lambda o: o['date'])
    visited = {}
    for row in trace.itertuples():
        if not ANCHOR < row.date < trade_date:
            continue
        holdings = retained['positions'].get(row.date)
        if holdings is None:
            raise ValueError('C30 session has no audited close trace')
        for holding in holdings:
            hkey = (holding['sleeve'], holding['code'])
            previous = visited.get(hkey)
            if previous:
                holding['start'] = previous['start']
                if not any(o['date'] == row.date and (o['sleeve'], o['code']) == hkey
                           and o['side'] == 'BUY' and o['filled'] for o in orders):
                    holding['last'] = previous['last']
        visited = {(h['sleeve'], h['code']): h for h in holdings}
        if abs(sum(h['q']*h['p'] for h in holdings) + row.cash - row.nav) > 1e-8:
            raise ValueError('C30 stock-level holdings do not reconcile')
        snapshots.append(dict(date=row.date, nav=float(row.nav), cash=float(row.cash), core=float(row.core_value),
                              side=float(row.side_value), coreCount=int(row.core_names), sideCount=int(row.side_names),
                              target=float(row.target), holdings=holdings, benchmark=float(index[row.date])))
    conditions = kernel['opening_conditions']
    reversal_watch = (sc['A32_EID'][i] >= 0 and not conditions['riskBlocksReversal'] and not conditions['excludedEpisode']
                      and target < conditions['reversalLimit'] and not kernel['next_buy_intents']
                      and not kernel['pending_limit_buys'] and not side_pending and not side_used and side_first < 0)
    result = dict(lock_id='A89_C30_RISK23_buffer250_partial_2019', anchor=ANCHOR, **staged,
                  readiness='verified_replay', no_execution_prices=True, anchor_days=len(ref),
                  target=target, risk={k: bool(last[k]) for k in ('risk', 'block', 'active')},
                  position_count=int(day.core_names + day.side_names), nav=float(day.nav), cash=float(day.cash),
                  reversal=dict(warning=bool(sc['A32_EID'][i] >= 0), used=bool(side_used),
                                pending=bool(side_pending), active_position=bool(side_first >= 0)),
                  execution=dict(rebalance=kernel['next_open_rebalance'], pending_limit_buys=len(kernel['pending_limit_buys'])),
                  reversal_watch=bool(reversal_watch), engine_plan=rows, snapshots=snapshots, orders=orders,
                  holdings=held.to_dict('records'), recorded_at=pd.Timestamp.now(tz='UTC').isoformat())
    output.write_text(json.dumps(result, allow_nan=False, indent=2))


if __name__ == '__main__':
    main()
