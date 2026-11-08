import sys,json,gzip,base64,math,hashlib
from pathlib import Path
import numpy as np
sys.path.insert(0,'/mnt/data')
import FC17_confirmed_reentry as e
snapshots=[]
def capture(v):
 t=v['t'];date=str(e.TD[t].date());sig=str(e.sc['m'].D[v['sig']].date());hold=[]
 for j in np.flatnonzero(v['qty']>1e-13):
  q=float(v['qty'][j]);p=float(v['px'][j]);b=float(v['basis'][j]);entry=t-int(v['held'][j]);code=str(e.sc['K'][j])
  hold.append(dict(code=code,quantity=q,price=p,weight=q*p/v['nav'],days=int(v['held'][j]),peak=float(v['peak'][j]),trail=None,rank=int(v['rank'][j]),score=float(v['score_line'][j]),avgEntryPrice=b,entryDate=str(e.TD[max(0,entry)].date()),lastBuyDate=date,entryTime='FC23 原引擎現股開盤／日K觸價模擬',costNotional=q*b,marketNotional=q*p,unrealizedNotional=q*(p-b),unrealizedPct=p/b-1))
 snapshots.append(dict(date=date,signal=sig,nav=float(v['nav']),exposure=float(v['expos'][t]),target=float(v['target']),t=t,holdings=hold,basket=bool(v['basket_risk']),bear=bool(v['state']),overlay=bool(v['overlay_risk']),gate=float(v['target']/v['gate_target'][t]) if v['gate_target'][t] else 1,breadthChange=float(e.sc['B'][v['sig']]-e.sc['B'][max(0,v['sig']-10)]),market20=float(e.sc['market'][t-1]/e.sc['market'][max(0,t-21)]-1) if t else 0))
e.sc['FC23_CAPTURE']=capture
needle='  for j in np.flatnonzero(qty>1e-13):peak[j]=max(peak[j],px[j])'
assert e.src.count(needle)==1
source=e.src.replace(needle,needle+'\n  if detailed:FC23_CAPTURE(locals())')
old={k:dict(e.sc[k]) for k in ['VARIANTS','RISK_GATES']}
exec(compile(source,'<FC23_CAPTURE_ONLY>','exec'),e.sc)
for k,v in old.items():e.sc[k].update(v)
e.m.real_sim=e.sc['simulate'];e.sc['simulate']=e.m.ns['sim_with_cost']
chip=np.load('/mnt/data/R1748_FC20_法人同儕_交易日稽核/FC20_盤後法人與動態同儕可重現特徵.npz')
peer=np.load('/mnt/data/R1748_FC17_reentry/FC17_當時可知60日動態同儕強勢比例.npz')['peer_breadth']
T5=chip['T5'];F5=chip['F5']
common=e.base_elig&(e.P>e.EMA)&(e.RS20>.08)&(e.RS5>.015)&(e.RS5-e.RS20/4>.007)&(e.near60>.87)&(peer>=.5)&(np.isnan(T5)|(T5>=-.02))
e.signals['FC23']=common&((e.RS5<=.18)|((e.RS5<=.25)&(peer>=.70)&np.isfinite(F5)&(F5>=0)))
r,nav,det=e.run('FC23',{'delay':3,'rank':8,'recover':1.,'until':35,'target':.7,'rules':{'RISK_RELEASE':-.074}},'FC23',cost=.001,fee=True,detail=True)
assert abs(r['return_pct']-3185.28999624682)<1e-7
assert abs(r['mdd_pct']+16.845430582233234)<1e-7
assert len(snapshots)==1407
root=Path(__file__).resolve().parent.parent
bench=json.loads(gzip.decompress((root/'public/r1494a/snapshot.bin').read_bytes()))
orders=[dict(zip(e.sc['LOG_COLUMNS'],o)) for o in det['orders']]
last_buys={}
for s in snapshots:
 for o in orders:
  if o['execution_date']==s['date'] and o['filled'] and o['action']=='BUY':last_buys[o['ticker']]=s['date']
 for h in s['holdings']:h['lastBuyDate']=last_buys[h['code']]
mapped=[]
for o in orders:
 p=o['fill_price'];q=o['shares_proxy'];rp=o['realized_pct']
 mapped.append(dict(date=o['execution_date'],signal=o['signal_date'],code=o['ticker'],side=o['action'],orderType=o['order_type'],price=p,quantity=q,notional=o['notional_proxy'],reason=o['reason'],level=o['limit_or_stop'],filled=o['filled'],ledger='FC23_paper',executionTime='09:00 開盤模擬' if 'OPEN' in o['order_type'] else '日K觸價模擬；無逐筆時間',realizedPct=rp/100 if rp is not None else None,realizedNotional=q*(p-p/(1+rp/100)) if rp is not None else None))
cols=['strategy','signal_date','execution_date','ticker','category','action','close_at_signal','entry_exit_level','stop_level','take_profit_level','no_fill_policy','reason','actual_open','actual_high','actual_low','actual_close']
plans={}
for row in det['plans']:
 p=dict(zip(cols,row));key=p['signal_date']
 plan=plans.setdefault(key,dict(model_version='FC23',ledger='FC23_paper',signal_as_of=key,trade_date=p['execution_date'],actions=[],readiness='historical',provenance='original_fc23_engine'))
 plan['actions'].append(dict(code=p['ticker'],side='BUY' if p['action'].startswith('BUY') else 'SELL' if p['action'].startswith('SELL') else 'HOLD',method=p['action'],referencePrice=p['close_at_signal'],level=p['entry_exit_level'],stop=p['stop_level'],reason=p['reason'] or '持續持有',noFillPolicy=p['no_fill_policy']))
last=snapshots[-1]['date'];dates=[s['date'] for s in snapshots];ix={d:i for i,d in enumerate(bench['dates'])}
blocked='FC23 原始特徵資料截至 2026-10-27；尚未完成之後日線、法人與動態同儕重算，無下一交易日計畫。'
s=dict(model_version='FC23',ledger='FC23_paper',dates=dates,snapshots=snapshots,orders=mapped,planHistory=plans,names=bench['names'],curves={'strategy':list(nav),**{k:[bench['curves'][k][ix[d]] for d in dates] for k in ['old49','market']}},assumptions='FC23 原引擎；往返總成本0.5855%；單筆賣出損益為費稅前，淨值已扣成本',status=dict(model_version='FC23',data_as_of=last,signal_as_of=snapshots[-1]['signal'],checkedThrough=last,price_updated_at=None,sync_status='blocked',trade_status='historical_only',universe_count=233,sources=[],lastError=dict(date='2026-10-28',message=blocked)),plan=dict(model_version='FC23',signal_as_of=last,trade_date=None,actions=[],readiness='blocked',blockedReason=blocked),broker={'connected':False},replay={'return_pct':r['return_pct'],'mdd_pct':r['mdd_pct'],'orders':len(mapped),'days':len(dates)})
def clean(x):
 if isinstance(x,dict):return {k:clean(v) for k,v in x.items()}
 if isinstance(x,(list,tuple,np.ndarray)):return [clean(v) for v in x]
 if isinstance(x,(float,np.floating)):return float(x) if math.isfinite(x) else None
 if isinstance(x,np.integer):return int(x)
 if isinstance(x,np.bool_):return bool(x)
 return x
raw=json.dumps(clean(s),ensure_ascii=False,separators=(',',':')).encode();gz=gzip.compress(raw,mtime=0)
(root/'public/r1494a/fc23/integrated-snapshot.b64').write_text(base64.b64encode(gz).decode())
print('VERIFIED',len(raw),len(gz),r['return_pct'],r['mdd_pct'],len(snapshots),len(mapped),hashlib.sha256(gz).hexdigest())
