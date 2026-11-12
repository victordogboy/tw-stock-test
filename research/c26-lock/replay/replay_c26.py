#!/usr/bin/env python3
"""Frozen C26 historical replay and trade-by-trade audit.
    Historical data END at 2026-10-27. LIVE TRADING IS DISABLED.
    Run: python replay/replay_c26.py --out /path/to/replay
    Historical engine expects compatible data tree in /mnt/data (use bootstrap_assets.py).
"""
from __future__ import annotations
import argparse,hashlib,importlib.util,json,sys,platform
from pathlib import Path
import numpy as np
import pandas as pd
RELEASE=Path(__file__).resolve().parents[1]
EXPECTED={
 'historical_days':1407,'pool_count':233,
 'return_pct':1720.495844396837,'mdd_pct':-17.989769234703846,
 'filled_buys':539,'filled_sells':1028,'unfilled_buys':191,
 'all_orders':1758,'initial_capital_ntd':3000000,
 'cost_roundtrip_pct':0.5855,
 'frozen_simulator_sha256':'741862f102438f8f10fcf40cf2f9b47edb8fece004e0175ae3f1be7e94bd4ad5',
}

def sha256(path:Path)->str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1<<20),b''):h.update(b)
    return h.hexdigest()

def load_engine():
    src=RELEASE/'source'/'C26_FROZEN_ENGINE.py'
    spec=importlib.util.spec_from_file_location('c26_frozen_release',src)
    m=importlib.util.module_from_spec(spec)
    if '/mnt/data' not in sys.path:sys.path.insert(0,'/mnt/data')
    spec.loader.exec_module(m)
    return m

def audit_account(orders:pd.DataFrame,days:pd.DatetimeIndex,prices:np.ndarray,nav:np.ndarray):
    """Independent balance replay from emitted fills and agreed per-side costs.
    The engine buys with commission+slippage 0.14275% and sells 0.44275%.
    Verify each fill, cash balance, share inventory, daily NAV and stock count.
    """
    buy_cost=0.0004275+0.001
    sell_cost=0.0034275+0.001
    assert abs((buy_cost+sell_cost)*100-EXPECTED['cost_roundtrip_pct'])<1e-12
    tickers=sorted(orders.ticker.astype(str).str.zfill(4).unique())
    ix={k:i for i,k in enumerate(tickers)}
    shares=np.zeros(len(tickers),dtype=float)
    cash=1.0;max_holdings=0;maxdiff=0;max_openw=0;max_equity_exposure=0
    daily=[]
    filt=orders[orders.filled].copy()
    byday={d:g for d,g in filt.groupby('execution_date',sort=False)}
    pmap={str(k).zfill(4):idx for idx,k in enumerate(prices[1])}
    close=np.asarray(prices[0],float)
    assert close.shape[0]==len(days)
    for t,day in enumerate(days.strftime('%Y-%m-%d')):
        if day in byday:
            for row in byday[day].itertuples(index=False):
                j=ix[str(row.ticker).zfill(4)];q=float(row.shares_proxy);px=float(row.fill_price)
                assert q>=-1e-13 and np.isfinite(px) and px>0
                if row.action=='BUY':
                    cash-=q*px*(1+buy_cost);shares[j]+=q
                elif row.action=='SELL':
                    cash+=q*px*(1-sell_cost);shares[j]-=q
                else:raise AssertionError('Unexpected action '+str(row.action))
                if shares[j]<-1e-10:raise AssertionError('Negative reconstructed position '+str(row.ticker)+' at '+day)
                if shares[j]<1e-13:shares[j]=0.0
                n_open=int((shares>1e-13).sum())
                if n_open>max_holdings:max_holdings=n_open
                if n_open>8:raise AssertionError(f'More than 8 positions: {day}, {n_open}')
        pxarr=np.array([close[t,pmap[k]] for k in tickers],float)
        mask=(shares>1e-13)
        if not np.isfinite(pxarr[mask]).all():raise AssertionError(f'Invalid CLOSE for held stock on {day}')
        values=np.where(mask,shares*pxarr,0.)
        reconstructed=cash+values.sum()
        diff=abs(reconstructed-nav[t]);maxdiff=max(diff,maxdiff)
        max_openw=max(max_openw,float(values.max()/max(reconstructed,1e-9)))
        expo=float(values.sum()/max(reconstructed,1e-9));max_equity_exposure=max(max_equity_exposure,expo)
        daily.append((day,float(cash),float(reconstructed),int(mask.sum()),float(expo)))
    return dict(max_open_positions=max_holdings,max_abs_reconstructed_nav_difference=maxdiff,
        max_reconstructed_stock_weight_pct=100*max_openw,max_reconstructed_exposure_pct=100*max_equity_exposure,
        ending_cash_unit=float(cash),ending_cash_ntd=float(cash*EXPECTED['initial_capital_ntd']),
        ending_positions={k:float(shares[v]) for k,v in ix.items() if shares[v]>1e-13}),daily


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',default=str(RELEASE/'replay'/'results'))
    ap.add_argument('--compare-reference',action='store_true',help='check exact original C26 frozen research daily NAV and orders')
    a=ap.parse_args();out=Path(a.out).resolve();out.mkdir(parents=True,exist_ok=True)
    core=RELEASE/'source'/'C26_SIMULATOR_FROZEN.py'
    assert sha256(core)==EXPECTED['frozen_simulator_sha256']
    m=load_engine();r,nav,detail=m.replay_c26('C26_FROZEN',detail=True)
    nav=np.asarray(nav,float);days=pd.DatetimeIndex(m.TD)
    orders=pd.DataFrame(detail['orders'],columns=m.sc['LOG_COLUMNS'])
    orders['ticker']=orders.ticker.astype(str).str.zfill(4)
    assert len(days)==len(nav)==EXPECTED['historical_days']
    assert len(m.sc['K'])==EXPECTED['pool_count']
    assert (str(days[0].date()),str(days[-1].date()))==('2021-01-06','2026-10-27')
    assert abs(r['return_pct']-EXPECTED['return_pct'])<1e-8
    assert abs(r['mdd_pct']-EXPECTED['mdd_pct'])<1e-8
    assert abs((nav[-1]-1)*100-r['return_pct'])<1e-8
    nav2=np.r_[1.,nav];mdd_calc=100*(nav2/np.maximum.accumulate(nav2)-1).min()
    assert abs(mdd_calc-r['mdd_pct'])<1e-8
    assert len(orders)==EXPECTED['all_orders']
    assert (pd.to_datetime(orders.signal_date)<pd.to_datetime(orders.execution_date)).all()
    assert set(orders.action.unique())=={'BUY','SELL'}
    assert not orders[(orders.action=='SELL')&(~orders.filled)].shape[0]
    count_buys=int(((orders.action=='BUY')&orders.filled).sum())
    count_sells=int(((orders.action=='SELL')&orders.filled).sum())
    count_unfilled=int(((orders.action=='BUY')&~orders.filled).sum())
    assert (count_buys,count_sells,count_unfilled)==(539,1028,191)
    newbuy=orders[(orders.action=='BUY')&orders.filled&orders.reason.isin(
        ['new_position','fc17_confirmed_reentry','previous_limit_missed'])]
    assert len(newbuy)>0
    min_new_notional=float(newbuy.notional_proxy.min()*EXPECTED['initial_capital_ntd'])
    assert min_new_notional>=9999.99,min_new_notional
    assert max(detail['exp'])<=1.000000001
    assert r['maxw']<=30.000001
    assert r['cost_pct']==EXPECTED['cost_roundtrip_pct']
    # Only leftover modulo in historical source is special-refill, but its interval is frozen to 0.
    assert m.sc['REFILL_INTERVAL']==0, 'Unexpected active fixed-date refill'
    frozen_source=core.read_text(encoding='utf-8')
    assert 't%REBAL_N' not in frozen_source and 't%TOPUP_DAYS' not in frozen_source, 'Calendar rebalance code present'
    # Full two-sided fee/ippage reconstructed independently from executed quantities.
    finance,ledger=audit_account(orders,days,(np.asarray(m.P[-len(days):],float),m.sc['K']),nav)
    assert finance['max_abs_reconstructed_nav_difference']<1e-7,finance
    assert finance['max_reconstructed_exposure_pct']<=100.0001,finance
    if a.compare_reference:
        ref=Path('/mnt/data/FC23_B26_corr_new/CORR40_60_G30_K1_C05855_nav.csv.gz')
        if ref.is_file():
            old=pd.read_csv(ref)
            assert old.date.tolist()==days.strftime('%Y-%m-%d').tolist()
            assert np.allclose(old.nav.values,nav,atol=1e-12,rtol=0),'Frozen replay NAV differs from research reference' # prior reference serialized to decimal CSV
    outdf=pd.DataFrame({'date':days.strftime('%Y-%m-%d'),'nav':nav,'equity_ntd':nav*EXPECTED['initial_capital_ntd'],
            'exposure':detail['exp'],'risk_gate':detail['gate']})
    outdf.to_csv(out/'C26_daily_nav.csv.gz',index=False)
    orders.to_csv(out/'C26_orders.csv.gz',index=False)
    pd.DataFrame(ledger,columns=['date','cash_unit','reconstructed_nav','open_positions','exposure']).to_csv(out/'C26_account_ledger.csv.gz',index=False)
    pd.DataFrame([dict(ticker=k,shares_proxy=v,stock_value_ntd=v*float(m.P[-1,list(map(str,m.sc['K'])).index(k)])*3000000) for k,v in finance['ending_positions'].items()]).to_csv(out/'C26_last_historical_positions.csv',index=False,encoding='utf-8-sig')
    metric={**r,'initial_capital_ntd':EXPECTED['initial_capital_ntd'],
      'final_equity_ntd':float(nav[-1]*EXPECTED['initial_capital_ntd']),
      'gross_profit_ntd':float((nav[-1]-1)*EXPECTED['initial_capital_ntd']),
      'sample_start':str(days[0].date()),'sample_end':str(days[-1].date()),
      'number_of_days':len(days),'pool_count':len(m.sc['K']),
      'filled_buys':count_buys,'filled_sells':count_sells,'unfilled_buys':count_unfilled,
      'new_position_fills':len(newbuy),'min_new_position_notional_ntd':min_new_notional,
      'frozen_simulator_sha256':sha256(core),
      'replay_only':True,'online_deployed':False,'is_out_of_sample':False,
      'live_data_cutoff':'2026-10-27','execution_model':'fractional-share stock OHLC approximation'}
    (out/'C26_metrics.json').write_text(json.dumps(metric,ensure_ascii=False,indent=2,default=str),encoding='utf-8')
    audit={**finance,'passed':True,'replay_matches_target':True,'time_causality_checked':'all order signal_date earlier than execution_date',
        'calendar_trigger_present_in_frozen_simulator':False,'minimum_position_passed':True,
        'number_of_trading_days':len(days),'python':platform.python_version(),'numpy':np.__version__,'pandas':pd.__version__,
        'outputs':{p.name:sha256(p) for p in sorted(out.glob('C26_*'))}}
    (out/'C26_audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
    print('C26_REPLAY_PASS',json.dumps({'return_pct':r['return_pct'],'mdd_pct':r['mdd_pct'],'orders':len(orders),'finance':finance,'outputs':str(out)},ensure_ascii=False,default=str),flush=True)
    return 0
if __name__=='__main__':sys.exit(main())
