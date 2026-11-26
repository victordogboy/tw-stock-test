"""Join the verified C26 source to the independent C30 RISK23 archive."""
import argparse
import gzip
import hashlib
import json
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd

ANCHOR = '2026-11-20'
LABEL = 'buffer250_partial_2019'
LOCK = 'C26-EVENT-CORR-LOCK-20261112'
BENCHMARKS = (
    'rs_broad/benchmark.csv',
    'rs_broad/vintage_benchmark.csv',
    'rs_broad/root_periodic.csv',
    'rs_broad/root_stage2.csv',
    'c30_database_results/benchmark.csv',
)


def load_gzip(path):
    return json.loads(gzip.decompress(path.read_bytes()))


def buffered_proxy(history, market, sessions):
    """Rebuild the exact 2019, top-200, quarterly 250-buffer proxy."""
    sessions = list(sessions)
    columns = ['date', 'stock_id', 'close', 'high', 'low', 'trading_money_twd']
    raw = pd.read_csv(history, usecols=columns, dtype={'stock_id': str}, parse_dates=['date'])
    post = pd.DataFrame([
        (pd.Timestamp(date), str(row['stock_id']), row['close'], row['max'], row['min'], row['Trading_money'])
        for date, rows in market.items() if '2026-10-27' < date <= sessions[-1]
        for row in rows if row['close'] > 0
    ], columns=columns)
    raw = pd.concat([raw, post], ignore_index=True)
    raw = raw[raw.stock_id.str.fullmatch(r'[1-9][0-9]{3}')].drop_duplicates(['date', 'stock_id'])
    matrices = [raw.pivot(index='date', columns='stock_id', values=key).astype('float32')
                for key in columns[2:]]
    close, high, low, turnover = matrices
    close = close.where((close > 0) & (high >= low) & (close <= high + .001) & (close >= low - .001))
    marks = close.ffill().to_numpy(float)
    valid = close.notna().to_numpy()
    avg_turnover = turnover.rolling(20, min_periods=20).mean().to_numpy()
    dates = close.index
    first = dates.get_loc('2019-01-02')
    start, end = dates.get_loc(sessions[0]), dates.get_loc(sessions[-1])
    if dates[start:end + 1].strftime('%Y-%m-%d').tolist() != list(sessions):
        raise ValueError('C30 proxy calendar differs from replay sessions')
    quarters = dates.to_period('Q')
    members, weights = None, None
    index = []
    for t in range(first, end + 1):
        if members is None or quarters[t] != quarters[t - 1]:
            previous = avg_turnover[t - 1]
            eligible = np.flatnonzero(valid[t - 1] & np.isfinite(previous) & (previous > 0))
            ordered = eligible[np.argsort(-previous[eligible], kind='stable')]
            if len(ordered) < 250:
                raise ValueError('C30 quarterly turnover universe has fewer than 250 eligible stocks')
            if members is None:
                members = ordered[:200]
                weights = np.full(200, .005)
            else:
                keep = np.isin(members, ordered[:250])
                vacancies = int((~keep).sum())
                if vacancies:
                    retained = members[keep]
                    new = ordered[~np.isin(ordered, retained)][:vacancies]
                    weights = np.r_[weights[keep], np.full(vacancies, weights[~keep].sum() / vacancies)]
                    members = np.r_[retained, new]
                weights = .75 * weights + .25 / 200
        prior, current = marks[t - 1, members], marks[t, members]
        returns = np.ones(200)
        np.divide(current, prior, out=returns, where=np.isfinite(prior) & np.isfinite(current) & (prior > 0))
        gross = float(weights @ returns)
        weights = weights * returns / gross
        if t >= start:
            index.append(gross)
    values = np.cumprod(index)
    return values / values[0]


def official_taiex(dates):
    """Get official closes by month and retain exactly the requested dates."""
    result = {}
    for month in sorted({date[:7] for date in dates}):
        query = urllib.parse.urlencode({'response': 'json', 'date': month.replace('-', '') + '01'})
        request = urllib.request.Request('https://www.twse.com.tw/indicesReport/MI_5MINS_HIST?' + query,
                                         headers={'User-Agent': 'C30 end of day research replay'})
        with urllib.request.urlopen(request, timeout=25) as response:
            payload = json.load(response)
        if payload.get('stat') != 'OK' or not str(payload['fields'][4]).endswith('收盤指數'):
            raise ValueError('TWSE TAIEX response format changed')
        for row in payload['data']:
            year, month_no, day = map(int, row[0].split('/'))
            date = f'{year+1911:04}-{month_no:02}-{day:02}'
            if date in dates:
                result[date] = float(row[4].replace(',', ''))
    if set(result) != set(dates) or any(not np.isfinite(x) or x <= 0 for x in result.values()):
        raise ValueError('TWSE TAIEX calendar is incomplete')
    return result


def stage(bundle, raw_path, status_path, contexts_path, through=None, index_loader=official_taiex):
    research = bundle / 'c30_research'
    original = bundle / 'lock/workspace/replay/A30_forward/private-input'
    raw, coverage = load_gzip(raw_path), json.loads(status_path.read_text())
    if raw.get('lock_id') != LOCK or coverage.get('lock_id') != LOCK or coverage.get('state') != 'source_staged':
        raise ValueError('C26 private source is not verified')
    if coverage.get('sha256_gzip') != hashlib.sha256(raw_path.read_bytes()).hexdigest():
        raise ValueError('C26 private source hash mismatch')
    available = [day['date'] for day in coverage['days']
                 if day['date'] > ANCHOR and day['state'] in ('available', 'cached')]
    through = through or coverage['full_market_last_verified']
    dates = [date for date in available if date <= through]
    if not dates or through != dates[-1] or dates != sorted(set(dates)):
        raise ValueError('C30 replay requires a contiguous verified trading calendar after its anchor')
    trade_date = next((date for date in available if date > through), coverage['next_exchange_trade_date'])
    if not trade_date or trade_date <= through:
        raise ValueError('No verified next exchange trading date')
    staged = load_gzip(original / 'forward-eod.json.gz')
    if max(staged['days']) != ANCHOR or max(staged['market_days']) != ANCHOR:
        raise ValueError('C30 source archive does not end on the frozen anchor')
    live_contexts = {row['date']: row for row in json.loads(contexts_path.read_text())}
    saved_contexts = json.loads((original / 'contexts.json').read_text())
    if saved_contexts[-1]['date'] != ANCHOR:
        raise ValueError('C30 feature archive does not end on the frozen anchor')
    for date in dates:
        day = raw['days'][date]
        market = raw['market_days'][date]
        if day['source_state'] != 'available' or len(day['price']) < 210 or len(day['institutional']) < 190:
            raise ValueError('Insufficient verified 233-stock data on ' + date)
        codes = [str(row['stock_id']) for row in market]
        if len(codes) != len(set(codes)) or sum(len(code) == 4 and code.isdigit() for code in codes) < 1500:
            raise ValueError('Incomplete or duplicated full-market prices on ' + date)
        if live_contexts[date]['date'] != date or len(live_contexts[date]['F']) != 233:
            raise ValueError('C30 feature context is incomplete on ' + date)
        staged['days'][date] = day
        staged['market_days'][date] = market
        saved_contexts.append(live_contexts[date])

    archived = pd.read_csv(research / BENCHMARKS[3])
    sessions = archived.date.tolist() + dates
    proxy = buffered_proxy(bundle / 'market/history.csv.gz',
                           staged['market_days'], sessions)
    np.testing.assert_allclose(proxy[:len(archived)], archived[LABEL], atol=1e-10, rtol=0)
    indices = pd.read_csv(research / BENCHMARKS[4])
    check_dates = indices.date.iloc[-5:].tolist()
    closes = index_loader(check_dates + dates)
    scale = indices.TAIEX.iloc[-1] / closes[ANCHOR]
    np.testing.assert_allclose([closes[date] * scale for date in check_dates], indices.TAIEX.iloc[-5:],
                               atol=1e-10, rtol=0)
    for i, name in enumerate(BENCHMARKS):
        file = research / name
        baseline = pd.read_csv(file)
        if baseline.date.tolist() != sessions[:len(archived)]:
            raise ValueError('Frozen benchmark calendars differ')
        new = pd.DataFrame({'date': dates + [trade_date]})
        if i == 3:
            new[LABEL] = np.r_[proxy[len(archived):], proxy[-1]]
        if i == 4:
            values = [closes[date] * scale for date in dates]
            new['TAIEX'] = values + values[-1:]
        pd.concat([baseline, new], ignore_index=True).to_csv(file, index=False)
    (original / 'forward-eod.json.gz').write_bytes(gzip.compress(json.dumps(staged, separators=(',', ':')).encode()))
    (original / 'contexts.json').write_text(json.dumps(saved_contexts, separators=(',', ':')))
    return {'signal_date': through, 'trade_date': trade_date, 'replayed_dates': dates}


if __name__ == '__main__':
    cli = argparse.ArgumentParser()
    cli.add_argument('bundle', type=Path)
    cli.add_argument('raw', type=Path)
    cli.add_argument('status', type=Path)
    cli.add_argument('contexts', type=Path)
    cli.add_argument('--through')
    args = cli.parse_args()
    print(json.dumps(stage(args.bundle, args.raw, args.status, args.contexts, args.through)))
