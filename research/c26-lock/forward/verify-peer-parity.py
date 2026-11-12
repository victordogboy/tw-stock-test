#!/usr/bin/env python3
"""Verify the frozen C26 FC17 peer breadth against the original matrices.

No external FinMind calls, no credential, no future-day information. Source-only
corrective discovery: DO NOT drop >20% daily changes in the reconstructed
peer feature; archived FC17 formation did not apply C26 correlation gate's filter.
This validator is research-only; does NOT authorize new C26 trading orders.
"""
from __future__ import annotations
import importlib.util,sys,hashlib,json,os,argparse
from pathlib import Path
import numpy as np
R=Path(os.getenv('C26_RELEASE_DIR','/mnt/data/c26_local/C26_正式候選_凍結重播_20261112'))
ROOT=Path('/mnt/data')
lock=R/'source/C26_FROZEN_ENGINE.py'; inner=R/'source/C26_SIMULATOR_FROZEN.py'
refroot=ROOT/'research/FC23_LIVE_PREP_v1/reference'
EXPECTED='741862f102438f8f10fcf40cf2f9b47edb8fece004e0175ae3f1be7e94bd4ad5'
assert hashlib.sha256(inner.read_bytes()).hexdigest()==EXPECTED
sp=importlib.util.spec_from_file_location('c26_peer_verifier',lock);m=importlib.util.module_from_spec(sp)
sys.path.insert(0,str(ROOT));sp.loader.exec_module(m)
P=np.asarray(m.P,dtype=float);rs5=np.asarray(m.RS5,dtype=float);rs20=np.asarray(m.RS20,dtype=float);ema=np.asarray(m.EMA,dtype=float)
with np.load(refroot/'FC17_當時可知60日動態同儕強勢比例.npz') as z: target=np.array(z['peer_breadth'],dtype=float)
with np.load(refroot/'FC20_盤後法人與動態同儕可重現特徵.npz') as z: dates=z['date']
assert P.shape==target.shape and P.shape[0]==len(dates) and P.shape[1]==233

def peer_breadth_at(t,filter_abs_jumps=None):
    # `t` is last available signal/close. Use only t-60...t.
    assert t>=60
    close=P[t-60:t+1]
    with np.errstate(divide='ignore',invalid='ignore'):
        returns=close[1:]/close[:-1]-1.0
    valid=np.isfinite(returns)
    if filter_abs_jumps is not None:valid &= np.abs(returns)<filter_abs_jumps
    returns=np.where(valid,returns,np.nan)
    median=np.nanmedian(returns,axis=1)
    residual=returns-median[:,None]
    x=np.nan_to_num(residual,nan=0.0,posinf=0.0,neginf=0.0)
    sums=x.sum(0)
    den=np.sqrt(np.maximum(np.sum(x*x,axis=0)-sums*sums/60,1e-15))
    covariance=x.T@x - sums[:,None]*sums[None,:]/60
    c=covariance/(den[:,None]*den[None,:]);np.fill_diagonal(c,-np.inf)
    validcount=valid.sum(0)
    strong=np.isfinite(rs20[t])&(rs20[t]>.07)&np.isfinite(rs5[t])&(rs5[t]>0)&(P[t]>ema[t])
    out=np.zeros(P.shape[1],dtype=np.float64)
    for j in range(len(out)):
        if validcount[j]<45:continue
        idx=np.argsort(c[j])[::-1];idx=idx[validcount[idx]>=45][:6];idx=idx[c[j,idx]>.4]
        out[j]=strong[idx].sum()/max(1,len(idx))
    return out

# Deterministic coverage: 12 distributed dates for each complete 2021-2025 year;
# 20 dates in 2026, plus the last six trading days including Oct-27 as lock boundary.
argparse_=argparse.ArgumentParser()
argparse_.add_argument('--full',action='store_true',help='all 1407 C26 sample trading days')
args=argparse_.parse_args()
ids=[]
for year in range(2021,2027):
    idx=np.flatnonzero(dates.astype('datetime64[Y]')==np.datetime64(str(year),'Y'))
    if len(idx):
        count=20 if year==2026 else 12
        ids.extend(idx[np.unique(np.linspace(0,len(idx)-1,count).astype(int))].tolist())
ids=sorted(set(ids)|set(range(len(dates)-6,len(dates))))
if args.full:
    ids=np.flatnonzero((dates>=np.datetime64('2021-01-06'))&(dates<=np.datetime64('2026-10-27'))).tolist()
    assert len(ids)==1407,(len(ids),ids[:2],ids[-2:])
reports=[]
for t in ids:
    p=peer_breadth_at(t)
    delta=np.abs(p-target[t]);d=str(dates[t].astype('datetime64[D]'))
    mismatches=int(np.count_nonzero(delta>1e-5))
    reports.append({'date':d,'n':len(p),'mismatch_count':mismatches,'max_abs_difference':float(np.nanmax(delta)),'exact':mismatches==0})
    if len(reports)%250==0:print('PROGRESS_PARITY',len(reports),'/',len(ids),flush=True)
    if mismatches:print('MISMATCH',d,mismatches,'codes',[str(m.sc['K'][j]) for j in np.flatnonzero(delta>1e-5)[:12]],flush=True)
final6=[r for r in reports if r['date']>='2026-10-16']
print('PARITY_LAST6',[(r['date'],r['mismatch_count']) for r in final6],flush=True)
out={
 'model':'C26-EVENT-CORR-LOCK-20261112','peer_factor':'FC17 peer_breadth',
 'tested_dates':len(reports),'stocks_each_date':233,'total_values':len(reports)*233,
 'mismatch_values':sum(r['mismatch_count'] for r in reports),
 'matching_values':len(reports)*233-sum(r['mismatch_count'] for r in reports),
 'matching_rate':1-sum(r['mismatch_count'] for r in reports)/(len(reports)*233),
 'last_6_dates_match':all(r['exact'] for r in final6),
 'allow_jump_gt_20pct':True,'rolling_days':60,'min_valid_days':45,
 'nearest_peer_max':6,'min_residual_correlation_exclusive':0.4,
 'no_future_prices':True,'live_trade_ready':False,'raw_license_data_public':False,
 'original_simulator_sha256':EXPECTED,'per_day_mismatch_counts':reports}
path=Path(__file__).with_name('peer-parity-full-1407.json' if args.full else 'peer-parity-check.json')
path.write_text(json.dumps(out,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print('PEER_PARITY_SUMMARY',json.dumps({k:out[k] for k in ['tested_dates','total_values','mismatch_values','matching_rate','last_6_dates_match']}),flush=True)
if not out['last_6_dates_match']:raise AssertionError('Latest six frozen peer matrices not reproduced')