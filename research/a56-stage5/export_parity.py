"""Run frozen full-account verification, then export Python→browser parity cases."""
import sys,runpy,json,gzip,math,hashlib
from pathlib import Path
from dataclasses import asdict
here=Path(__file__).resolve().parent
sys.path.insert(0,str(here));sys.argv=[str(here/'verify_historical.py'),sys.argv[1]]
env=runpy.run_path(str(here/'verify_historical.py'))
m=env['m'];live=env['live'];cases=[];bars_total=0
for t,cs in env['refs'].items():
 for c in cs:
  z=m.cache.get((t,m.codes.index(c.code)))
  if z is None:continue
  monitor=live.MinuteMonitor(c,.4,4,3e6);bars=[];expected=[]
  for k in range(210):
   high,low,vol=map(float,(z[k,1],z[k,2],z[k,4]*1000))
   # Zero-volume historical rows represent confirmed no trade only if prices
   # are absent. Keep the archived semantics for the parity dataset.
   bars.append([high,low,vol]);expected.append([asdict(x) for x in monitor.completed(k,high,low,vol)])
  cases.append(dict(date=str(m.dates[t].date()),candidate=c.public(),budget=.4,slots=4,nav=3e6,bars=bars,expected=expected));bars_total+=210
opening=[]
for p in env['plans']:
 proposal=p['preopen_proposal'];opening.append(dict(date=p['date'],candidates=p['candidates'],hold=proposal['slots'],blocked=p['core_hold']+p['side_hold'],budget=proposal['budget_twd']/p['prior_nav_twd'],nav=p['prior_nav_twd'],expected=proposal['order']))
def clean(x):
 if isinstance(x,float) and not math.isfinite(x):return None
 if isinstance(x,dict):return {k:clean(v) for k,v in x.items()}
 if isinstance(x,(list,tuple)):return [clean(v) for v in x]
 return x
payload=clean(dict(version=live.VERSION,cases=cases,opening=opening))
raw=json.dumps(payload,separators=(',',':'),allow_nan=False).encode();(here/'parity-fixtures.json.gz').write_bytes(gzip.compress(raw,mtime=0))
# Only historical prices, never golden expected outcomes, are served to UI.
import base64
out=here.parents[1]/'public/r1494a/c26/a56/minutes.json.gz.b64'
public=clean(dict(version=live.VERSION,data_through='2026-11-12',cases=[{k:v for k,v in c.items() if k!='expected'} for c in cases]))
out.write_text(base64.b64encode(gzip.compress(json.dumps(public,separators=(',',':'),allow_nan=False).encode(),mtime=0)).decode())
report=dict(status='passed',nav_days=len(env['nav']),side_orders=len(env['orders']),side_trades=len(env['trades']),nav_max_absolute_error=env['payload']['nav_max_absolute_error'],minute_cases=len(cases),completed_minutes=bars_total,opening_cases=len(opening),fixture_sha256=hashlib.sha256(raw).hexdigest())
(here/'historical-verification.json').write_text(json.dumps(report,indent=2));print('BROWSER_FIXTURES',report,flush=True)
