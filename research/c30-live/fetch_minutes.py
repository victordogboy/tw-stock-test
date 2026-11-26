"""Fetch only the post-anchor stock-days the original replay actually requires."""
import csv
import gzip
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'a56-live'))
from engine import tick_minutes
from stage_inputs import load_gzip, ANCHOR


def main():
    report, private_eod, destination, through = sys.argv[1:]
    report = json.loads(Path(report).read_text())
    tasks = sorted({(r['date'], str(r['code'])) for r in report.get('missing_minutes', [])})
    if not tasks or any(not ANCHOR < d <= through or len(c) != 4 or not c.isdigit() for d, c in tasks):
        raise ValueError('No valid post-anchor minute inputs to resolve')
    raw = load_gzip(Path(private_eod))
    for date, code in tasks:
        try:
            bars = tick_minutes(None, raw, date, code, None, None)
        except Exception as error:
            raise ValueError(f'FinMind minute replay could not verify {date} {code}: {type(error).__name__}') from None
        path = Path(destination) / date / (code + '.csv.gz')
        path.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(path, 'wt', newline='') as stream:
            writer = csv.writer(stream)
            writer.writerow(['date', 'stock_id', 'minute', 'open', 'high', 'low', 'close', 'volume'])
            for k in np.flatnonzero(np.isfinite(bars[:, 0])):
                o,h,l,c,shares = bars[k]
                hour, minute = divmod(540 + int(k), 60)
                writer.writerow([date,code,f'{hour:02}:{minute:02}:00',o,h,l,c,shares/1000])
        print('C30 verified required tick-derived bars', date, code)


if __name__ == '__main__':
    main()
