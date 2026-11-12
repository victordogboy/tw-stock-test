#!/usr/bin/env python3
"""Fetch new full-market prices privately for the frozen market/breadth proxy.
FINMIND_TOKEN is process-local; no credential is logged or saved in this file.
"""
from pathlib import Path
import os, json, gzip, urllib.request, urllib.parse, concurrent.futures
root = Path('.c26-private')
source = json.loads(gzip.decompress((root/'forward-eod.json.gz').read_bytes()))
token = os.environ.get('FINMIND_TOKEN', '').strip()
if not token:
    raise RuntimeError('FINMIND_TOKEN is required')
def pull(date):
    target = root/('market-'+date+'.json.gz')
    if target.exists():
        return
    query = urllib.parse.urlencode(dict(dataset='TaiwanStockPrice', start_date=date, end_date=date))
    request = urllib.request.Request('https://api.finmindtrade.com/api/v4/data?'+query,
                                     headers={'Authorization': 'Bearer '+token})
    with urllib.request.urlopen(request, timeout=50) as response:
        data = json.load(response)
    if data.get('status') != 200 or len(data.get('data', [])) < 1500:
        raise RuntimeError('Incomplete FinMind market data for '+date)
    rows = [r for r in data['data'] if r.get('date') == date and
            len(str(r.get('stock_id', ''))) == 4 and str(r['stock_id']).isdigit()]
    if len(rows) < 1500:
        raise RuntimeError('Incomplete ordinary-stock market data for '+date)
    target.write_bytes(gzip.compress(json.dumps(rows).encode()))
    print('C26_MARKET_SOURCE', date, len(rows), flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    list(pool.map(pull, sorted(d for d in source['days'] if d>'2026-10-27')))
