#!/usr/bin/env python3
"""Fetch new full-market prices privately for the frozen market/breadth proxy.
FINMIND_TOKEN is process-local; no credential is logged or saved in this file.
"""
from pathlib import Path
import os, json, gzip, hashlib, urllib.request, urllib.parse, concurrent.futures
root = Path('.c26-private')
source = json.loads(gzip.decompress((root/'forward-eod.json.gz').read_bytes()))
token = os.environ.get('FINMIND_TOKEN', '').strip()
if not token:
    raise RuntimeError('FINMIND_TOKEN is required')
def ordinary(rows):
    fields=['stock_id','open','max','min','close','Trading_Volume','Trading_money']
    return [{k:r[k] for k in fields} for r in rows if len(str(r.get('stock_id','')))==4 and str(r['stock_id']).isdigit()]
cache=source.setdefault('market_days', {})
dates=sorted(d for d in source['days'] if d>'2026-10-27')
def pull(date):
    target = root/('market-'+date+'.json.gz')
    if date not in dates[-2:]:
        if date in cache:
            cache[date]=ordinary(cache[date])
            target.write_bytes(gzip.compress(json.dumps(cache[date]).encode()))
            return
        if target.exists():
            cache[date]=ordinary(json.loads(gzip.decompress(target.read_bytes())))
            target.write_bytes(gzip.compress(json.dumps(cache[date]).encode()))
            return
    query = urllib.parse.urlencode(dict(dataset='TaiwanStockPrice', start_date=date))
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
    rows=ordinary(rows)
    cache[date]=rows
    target.write_bytes(gzip.compress(json.dumps(rows).encode()))
    print('C26_MARKET_SOURCE', date, len(rows), flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    list(pool.map(pull, dates))
packed=gzip.compress(json.dumps(source,separators=(',',':')).encode(),mtime=0)
(root/'forward-eod.json.gz').write_bytes(packed)
report_path=Path('public/r1494a/c26/data/forward-status.json')
report=json.loads(report_path.read_text())
report.update(sha256_gzip=hashlib.sha256(packed).hexdigest(),bytes_gzip=len(packed),private_storage_verified=False)
report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
