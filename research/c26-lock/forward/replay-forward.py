#!/usr/bin/env python3
"""Frozen C26 source bridge: append verified technical contexts, retain historical inputs.
No other strategy's positions, cash or orders are imported.
"""
from pathlib import Path
import sys,json,importlib.util,hashlib,copy,ast
import numpy as np,pandas as pd
from checkpoint_runtime import install,dumps,loads,ENGINE_SHA
ROOT=Path(__file__).resolve().parents[1];PRIVATE=Path('.c26-private');OUT=PRIVATE/'replay';OUT.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,'/mnt/data')
sp=importlib.util.spec_from_file_location('c26_frozen_forward',ROOT/'source/C26_FROZEN_ENGINE.py');e=importlib.util.module_from_spec(sp);sp.loader.exec_module(e)
r,nav,det=e.replay_c26('C26_FROZEN',detail=True)
assert len(nav)==1407 and len(det['orders'])==1758
assert abs(r['return_pct']-1720.495844396837)<1e-9 and abs(r['mdd_pct']+17.989769234703846)<1e-9
sc=e.sc;source=ROOT/'source/C26_SIMULATOR_FROZEN.py';wrapper=e.m.ns['sim_with_cost']
fn,caps=install(sc,source,capture_days=[1406]);e.m.real_sim=fn;sc['simulate']=wrapper
r2,nv,dt=e.replay_c26('C26_FROZEN',detail=True)
np.testing.assert_array_equal(nav,nv);assert dumps(det['orders'])==dumps(dt['orders'])
checkpoint=loads(dumps(caps[1406]));sc['simulate']=fn
contexts=json.loads((PRIVATE/'contexts.json').read_text());assert contexts[0]['date']=='2026-10-27'
new=contexts[1:];dates=[x['date'] for x in new];assert dates==sorted(set(dates)) and dates[0]=='2026-10-28'
from gzip import decompress
raw=json.loads(decompress((PRIVATE/'forward-eod.json.gz').read_bytes()))
assert dates==sorted(d for d in raw['days'] if d>'2026-10-27')
F=lambda c,k:np.array([np.nan if x.get(k) is None else x[k] for x in c['F']])
cfg=sc['VARIANTS']['R1489_H'];n0=sc['N'];p0=len(sc['P']);a=sc['a'];codes=list(map(str,sc['K']));M=len(codes)
# Every frozen-boundary input used by the active C26 decision is compared.
mapfields={'P':'mark','BASE':'base','TREND':'trend','RELAX':'relaxed','R20':'r20','EMA20':'e20','atr':'atr','RS5':'rs5','RS20':'rs20','VOL_RATIO':'vr','DOWN_SHARE':'downShare','BUY_LEVEL':'buyLevel','SCORE':'baseScore','EXTRA_RANK_BONUS':'rankHot'}
comparisons={}
for key,field in mapfields.items():
 original=np.asarray(sc[key][-1],float);rebuilt=F(contexts[0],field).astype(float)
 assert original.shape==rebuilt.shape
 nan=np.count_nonzero(np.isfinite(original)!=np.isfinite(rebuilt));finite=np.isfinite(original)&np.isfinite(rebuilt)
 error=float(np.max(np.abs(original[finite]-rebuilt[finite]))) if finite.any() else 0.
 comparisons[key]={'max_abs_error':error,'nan_mismatch':int(nan)}
 assert nan==0 and error<=1e-5,(key,error,nan)
# Institutional exits and score components, plus market risk gates.
for key,values in [('hedge',sc['CHIP_BONUSES'][cfg['chip_score']][-1]),('chipExit',sc['CHIP_EXIT_MAP'][cfg['chip_exit']][-1])]:
 field='hedgeBonus' if key=='hedge' else key
 np.testing.assert_allclose(F(contexts[0],field).astype(float),np.asarray(values,float),atol=1e-6,rtol=0)
assert abs(contexts[0]['breadth']-sc['B'][-1])<1e-7
assert abs(contexts[0]['gate']-sc['RISK_GATES'][cfg['risk_gate']][-1])<1e-7
old_arrays={k:v.copy() for k,v in sc.items() if isinstance(v,np.ndarray)}
for key,field in mapfields.items():
 sc[key]=np.concatenate([sc[key],np.array([F(c,field) for c in new],dtype=sc[key].dtype)])
# Stock mark P is carried on suspended dates only for valuation. OHLC/EXEC remain absent.
for key in ['EMG_DROP','EMG_BIGBEAR','EMG_BREAK10','EMG_VOL']:
 sc[key]=np.concatenate([sc[key],np.zeros((len(new),M),dtype=sc[key].dtype)])
sc['FC17_REENTRY_SIGNAL']=np.concatenate([sc['FC17_REENTRY_SIGNAL'],np.array([F(c,'reentry') for c in new],bool)])
for key,field in [('B','breadth'),('SOFT_WEAK','softWeak'),('EMG_SYS','emergency'),('MARKET_COLD','cold')]:
 sc[key]=np.r_[sc[key],np.array([c[field] for c in new],dtype=sc[key].dtype)]
for key,field in [('market','market'),('ma20',0),('ma60',1),('ma120',2)]:
 values=[c[field] if isinstance(field,str) else c['marketE'][field] for c in new]
 sc[key]=np.r_[sc[key],np.array(values,dtype=sc[key].dtype)]
for key in ['FC13_BONUS','FC15_FEATURE']:
 sc[key]=np.concatenate([sc[key],np.zeros((len(new),M),dtype=sc[key].dtype)])
# Reconstruct original numpy rank rescues with original array dtypes and tie handling.
sc['CHIP_BONUSES'][cfg['chip_score']]=np.concatenate([sc['CHIP_BONUSES'][cfg['chip_score']],np.array([F(c,'hedgeBonus') for c in new],dtype=sc['CHIP_BONUSES'][cfg['chip_score']].dtype)])
sc['CHIP_EXIT_MAP'][cfg['chip_exit']]=np.concatenate([sc['CHIP_EXIT_MAP'][cfg['chip_exit']],np.array([F(c,'chipExit') for c in new],bool)])
sc['RISK_GATES'][cfg['risk_gate']]=np.r_[sc['RISK_GATES'][cfg['risk_gate']],np.array([c['gate'] for c in new],dtype=sc['RISK_GATES'][cfg['risk_gate']].dtype)]
def peer_at(i):
 close=sc['P'][i-60:i+1];returns=close[1:]/close[:-1]-1;valid=np.isfinite(returns)
 residual=returns-np.nanmedian(returns,axis=1)[:,None];xx=np.nan_to_num(residual,nan=0.,posinf=0.,neginf=0.)
 sums=xx.sum(0);den=np.sqrt(np.maximum((xx*xx).sum(0)-sums*sums/60,1e-15));co=(xx.T@xx-sums[:,None]*sums[None,:]/60)/(den[:,None]*den[None,:]);np.fill_diagonal(co,-np.inf);counts=valid.sum(0)
 strong=np.isfinite(sc['RS20'][i])&(sc['RS20'][i]>.07)&np.isfinite(sc['RS5'][i])&(sc['RS5'][i]>0)&(sc['P'][i]>sc['EMA20'][i]);pb=np.zeros(M)
 for j in range(M):
  if counts[j]<45:continue
  ids=np.argsort(co[j])[::-1];ids=ids[counts[ids]>=45][:6];ids=ids[co[j,ids]>.4];pb[j]=strong[ids].sum()/max(1,len(ids))
 return pb
np.testing.assert_allclose(peer_at(p0-1),e._peer[-1],atol=1e-5,rtol=0)
for k,c in enumerate(new):
 i=p0+k;f=c['F'];score0=sc['SCORE'][i]+sc['CHIP_BONUSES'][cfg['chip_score']][i]+sc['EXTRA_RANK_BONUS'][i];elig=sc['BASE'][i]&sc['TREND'][i]
 scores=np.where(elig,score0,-np.inf);ids=np.argsort(scores)[::-1];ids=ids[np.isfinite(scores[ids])];rank=np.full(M,999,dtype=np.int16);rank[ids]=np.arange(1,len(ids)+1)
 groups=np.array(c['groups']);rs5=sc['RS5'][i];rs20=sc['RS20'][i];p=sc['P'][i];ema=sc['EMA20'][i];vr=sc['VOL_RATIO'][i]
 strong=np.isfinite(rs20)&(rs20>.06)&np.isfinite(rs5)&(rs5>0)&(p>ema);breadth=np.zeros(M,np.float32)
 for g in range(4):
  ii=np.flatnonzero(groups==g);breadth[ii]=strong[ii].sum()/max(1,np.isfinite(p[ii]).sum())
 pool=(rank>=9)&(rank<=30)&elig;safe=np.isfinite(rs20)&np.isfinite(rs5)&np.isfinite(vr)&(p>ema)
 sc['FC13_BONUS'][i]=(pool&safe&(breadth>=.55)&(rs20>.08)&(rs5>-.005)).astype(np.float32)
 near60=p/np.nanmax(sc['P'][i-59:i+1],axis=0)
 sc['FC15_FEATURE'][i]=(pool&(near60>=.94)&(rs20>.07)&(rs20<.30)&(rs5-rs20/4>.007)&(vr>=1.)).astype(np.float32)
 # C26's original peer factor uses the carried P valuation matrix even on
 # suspended dates. The other page's raw-close helper is not equivalent here.
 pb=peer_at(i);f5=np.clip(F(c,'F5'),-.5,.5);t5=np.clip(F(c,'T5'),-.5,.5)
 sc['FC17_REENTRY_SIGNAL'][i]=(elig&(p>ema)&(rs20>.08)&(rs5>.015)&(rs5-rs20/4>.007)&(near60>.87)&(pb>=.50)&(np.isnan(t5)|(t5>=-.02)))&((rs5<=.18)|((rs5<=.25)&(pb>=.70)&np.isfinite(f5)&(f5>=0)))
 for j in range(M):c['F'][j]['peer']=float(pb[j]);c['F'][j]['F5']=None if np.isnan(f5[j]) else float(f5[j]);c['F'][j]['T5']=None if np.isnan(t5[j]) else float(t5[j])

# Original OHLC execution inputs: never substitute a carried mark for an executable bar.
new_ohlc={k:[] for k in ['O','H','L','C','VALID','LOCK_UP','LOCK_DOWN']};execs=[]
for c in new:
 day=raw['days'][c['date']];by={x['stock_id']:x for x in day['price']};o=np.full(M,np.nan);h=o.copy();l=o.copy();close=o.copy();valid=np.zeros(M,bool);ex=np.zeros(M,bool)
 for j,code in enumerate(codes):
  if code not in by:continue
  x=by[code];o[j]=x['open'];h[j]=x['high'];l[j]=x['low'];close[j]=x['close'];valid[j]=x['valid'];ex[j]=valid[j] and x['volume']>0
 k=dates.index(c['date']);prev=sc['P'][p0+k-1];one=(np.abs(h-l)<1e-9)&(np.abs(o-h)<1e-9)&(np.abs(close-h)<1e-9)&valid
 for key,value in [('O',o),('H',h),('L',l),('C',close),('VALID',valid),('LOCK_UP',one&(close/np.maximum(prev,1e-8)>1.08)),('LOCK_DOWN',one&(close/np.maximum(prev,1e-8)<.92))]:new_ohlc[key].append(value)
 execs.append(ex)
for key,values in new_ohlc.items():sc[key]=np.concatenate([sc[key],np.array(values,dtype=sc[key].dtype)])
sc['EXEC']=np.concatenate([sc['EXEC'],np.array(execs,bool)])
sc['EV_STOCKCAP_HISTORY']=np.r_[sc['EV_STOCKCAP_HISTORY'],np.ones(len(new))]
sc['D']=pd.DatetimeIndex(list(sc['D'])+list(pd.to_datetime(dates)));sc['N']=n0+len(new);sc['z']=len(sc['P'])-1
full_dates=pd.DatetimeIndex(list(sc['m'].D)+list(pd.to_datetime(dates)));sc['m'].D=full_dates
# Correlation callback remains the original C26 implementation, with appended causal returns.
e._C26_PRICES=sc['P'];e._C26_RET=np.full(sc['P'].shape,np.nan,np.float32)
rs=sc['P'][1:]/sc['P'][:-1]-1;rs[~np.isfinite(rs)|(np.abs(rs)>.2)]=np.nan;e._C26_RET[1:]=rs.astype(np.float32)
# The original protective-stop callback was compiled in its own namespace.
# Extend its input references too; retain its original executable bytecode.
sc['stop_gate'].__globals__['V']=sc['VOL_RATIO']
sc['stop_gate'].__globals__['RS5']=sc['RS5']
# Enforce unchanged historical matrices for every modified direct array.
for key,old in old_arrays.items():
 if key in sc and isinstance(sc[key],np.ndarray) and sc[key].shape[1:]==old.shape[1:] and len(sc[key])>=len(old):np.testing.assert_array_equal(sc[key][:len(old)],old,err_msg=key)
fn,captured=install(sc,source,resume=checkpoint,capture_days=range(n0,sc['N']))
result=fn('R1489_H',detailed=True)
np.testing.assert_array_equal(result['eq'][:n0],nav);assert dumps(result['orders'][:1758])==dumps(det['orders'])
# Independent full cash/share replay from fills.
orders=pd.DataFrame(result['orders'],columns=sc['LOG_COLUMNS']);orders['ticker']=orders.ticker.astype(str)
sp2=importlib.util.spec_from_file_location('audit',ROOT/'replay/replay_c26.py');audit=importlib.util.module_from_spec(sp2);sp2.loader.exec_module(audit)
finance,ledger=audit.audit_account(orders,sc['D'],(sc['P'][a:],codes),result['eq'])
assert finance['max_abs_reconstructed_nav_difference']<1e-9 and finance['max_open_positions']<=8 and finance['ending_cash_unit']>=0
orders.to_csv(OUT/'C26_all_orders.csv.gz',index=False)
pd.DataFrame({'date':sc['D'].strftime('%Y-%m-%d'),'nav':result['eq'],'exposure':result['exp']}).to_csv(OUT/'C26_all_nav.csv.gz',index=False)
pd.DataFrame(ledger,columns=['date','cash_unit','nav','holdings','exposure']).to_csv(OUT/'C26_all_ledger.csv.gz',index=False)
(OUT/'checkpoint.json').write_text(dumps(captured[sc['N']-1]))
report={'historical_replay':{'days':1407,'orders':1758,'passed':True,'net_return_pct':r['return_pct'],'max_drawdown_pct':r['mdd_pct']},'forward_dates':dates,'boundary_feature_comparisons':comparisons,'inventory_cash_audit':finance,'forward_order_rows':len(orders)-1758,'last_date':dates[-1],'source_after_boundary':True,'halted_stock_policy':'3714: no OHLC/no execution; last known mark for valuation only'}
(OUT/'audit.json').write_text(json.dumps(report,indent=2))
print('C26_FORWARD_REPLAY_AUDIT',json.dumps(report),flush=True)
# Independent peer and institutional factor calculations on each new close.
peer_max=0.;chip_max=0.
trade_dates=sorted(raw['days'])
for k,c in enumerate(new):
 i=p0+k;close=sc['P'][i-60:i+1];returns=close[1:]/close[:-1]-1;valid=np.isfinite(returns);residual=returns-np.nanmedian(returns,axis=1)[:,None];xx=np.nan_to_num(residual,nan=0.,posinf=0.,neginf=0.);sums=xx.sum(0);den=np.sqrt(np.maximum((xx*xx).sum(0)-sums*sums/60,1e-15));co=(xx.T@xx-sums[:,None]*sums[None,:]/60)/(den[:,None]*den[None,:]);np.fill_diagonal(co,-np.inf);counts=valid.sum(0)
 strong=np.isfinite(sc['RS20'][i])&(sc['RS20'][i]>.07)&np.isfinite(sc['RS5'][i])&(sc['RS5'][i]>0)&(sc['P'][i]>sc['EMA20'][i]);pb=np.zeros(M)
 for j in range(M):
  if counts[j]<45:continue
  ids=np.argsort(co[j])[::-1];ids=ids[counts[ids]>=45][:6];ids=ids[co[j,ids]>.4];pb[j]=strong[ids].sum()/max(1,len(ids))
 peer_max=max(peer_max,float(np.max(np.abs(pb-F(c,'peer')))))
 for j,code in enumerate(codes):
  ix=trade_dates.index(c['date']);window=trade_dates[ix-4:ix+1];volume=0;foreign=0;trust=0;complete=True
  for d in window:
   day=raw['days'][d];row=next((x for x in day['price'] if x['stock_id']==code and x['valid']),None);inst=[x for x in day['institutional'] if str(x['stock_id'])==code]
   if row is None or row['volume']<=0 or not inst:complete=False;break
   volume+=row['volume']
   for x in inst:
    name=x['name'];net=x['buy']-x['sell']
    if name=='Foreign_Investor':foreign+=net
    if name=='Investment_Trust':trust+=net
  for field,total in [('F5',foreign),('T5',trust)]:
   observed=c['F'][j].get(field)
   if complete and volume>0 and observed is not None:chip_max=max(chip_max,abs(np.clip(total/volume,-.5,.5)-observed))
assert peer_max<1e-5 and chip_max<1e-5,(peer_max,chip_max)
report['independent_forward_factors']={'peer_max_abs_error':peer_max,'F5_T5_max_abs_error':chip_max,'days':len(new),'stocks':233,'passed':True}
# Capture original pre-execution decisions. Dummy execution inputs are NaN;
# the AST returns before the first execution-price read or hypothetical fill.
final_checkpoint=loads(dumps(captured[sc['N']-1]));final_n=sc['N'];signal_date=dates[-1]
trade_date=json.loads(Path('public/r1494a/c26/data/forward-status.json').read_text())['next_exchange_trade_date']
sc['D']=sc['D'].append(pd.DatetimeIndex([trade_date]));sc['P']=np.vstack([sc['P'],np.full(M,np.nan)]);sc['N']+=1;sc['z']+=1;sc['EV_STOCKCAP_HISTORY']=np.r_[sc['EV_STOCKCAP_HISTORY'],1.]
fn,_=install(sc,source,resume=final_checkpoint)
tree=ast.parse(source.read_text());func=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='simulate')
# Obtain the already instrumented restore/loop function from AST, preserving
# its state restoration logic by intercepting Python's line event only.
class PrecommitCaptured(Exception):pass
pre={}
line=next(n.lineno for n in ast.walk(func) if isinstance(n,ast.If) and isinstance(n.test,ast.Name) and n.test.id=='detailed' and any(isinstance(x,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='signal_date' for t in x.targets) for x in n.body))
def trace(frame,event,arg):
 if event=='line' and frame.f_code.co_filename=='<C26_CHECKPOINT_RUNTIME>' and frame.f_code.co_name=='simulate' and frame.f_lineno==line:
  pre.update({k:copy.deepcopy(frame.f_locals[k]) for k in ['current','entrants','to_sell','reason','target','port_risk','dd_gate','state','basket_risk','overlay_risk','rank','qty','cash','held','peak','basis','prev_nav','cfg','sig','t']});raise PrecommitCaptured()
 return trace
sys.settrace(trace)
try:fn('R1489_H',detailed=True)
except PrecommitCaptured:pass
finally:sys.settrace(None)
assert pre and pre['t']==final_n and pre['sig']==p0+len(new)-1
state=final_checkpoint['state'];capital=3000000;holdings=[];actions=[]
for j in pre['current']:
 code=codes[j];price=float(sc['P'][pre['sig'],j]);quantity=float(state['qty'][j])*capital;basis=float(state['basis'][j]);sell=j in pre['to_sell']
 actions.append({'action':'SELL' if sell else 'HOLD','stock_id':code,'signal_date':signal_date,'execute_date':trade_date,'order_type':'MARKET_OPEN' if sell else 'HOLD','quantity':quantity,'limit_or_stop_ntd':None,'reference_price':price,'reason':pre['reason'].get(j,'持續持有'),'stop_active':bool(sc['stop_gate'](pre['sig'],j,pre['held'][j],price/basis-1)),'protective_stop':sc['tick_down'](max(0,float(state['peak'][j])*.9,float(state['peak'][j])-2.8*max(.005,float(sc['atr'][pre['sig'],j]))*price))})
 holdings.append({'stock_id':code,'quantity':quantity,'price':price,'basis':basis,'market_value_ntd':quantity*price,'unrealized_pct':price/basis-1})
for j in pre['entrants']:
 price=float(sc['P'][pre['sig'],j]);ap=max(.005,min(.25,float(sc['atr'][pre['sig'],j])));level=sc['tick_up'](price*(1+sc['BUY_LEVEL'][pre['sig'],j]*ap))
 actions.append({'action':'BUY','stock_id':codes[j],'signal_date':signal_date,'execute_date':trade_date,'order_type':'BUY_STOP_BREAKOUT','limit_or_stop_ntd':level,'notional_ntd':max(10000,min(pre['cash'],pre['prev_nav']/8)*capital),'sizing':'參考預算；實際以開盤淨值、現金及目標曝險限制計算','reason':'原C26事件候選','no_fill_policy':'未觸價不買；開盤高於觸發價按開盤模擬成交，無5%追價限制'})
if not actions:actions=[{'action':'NO_ACTION','signal_date':signal_date,'execute_date':trade_date,'reason':'C26本盤無持股或新進場候選'}]
plan={'model_version':'C26','lock_id':'C26-EVENT-CORR-LOCK-20261112','simulator_sha256':ENGINE_SHA,'engine':'frozen_python_c26','strategy_source':'original_C26_LOCK','fc23_reused':False,'r1494a_reused':False,'historical_replay':report['historical_replay'],'signal_as_of':signal_date,'trade_date':trade_date,'forward_replay':{'first_date':'2026-10-28','last_date':signal_date,'trading_days':len(dates),'verified_dates':dates,'complete':True},'factors':{'full_parity':True,'causal_previous_close':True,'boundary_comparisons':comparisons,'independent_forward_factors':report['independent_forward_factors']},'positions':{'inventory_parity':True,'cash_parity':True,'holdings':holdings,'cash_ntd':float(state['cash'])*capital,'equity_ntd':float(result['eq'][-1])*capital},'orders_frozen_same_day_check':True,'transaction_cost_roundtrip_pct':.5855,'actions':actions,'target_exposure':pre['target'],'risk':{k:bool(pre[k]) for k in ['port_risk','dd_gate','state','basket_risk','overlay_risk']},'model_not_broker_account':True,'created_at':pd.Timestamp.now(tz='UTC').isoformat(),'no_future_execution_prices':True}
# Publish only strategy-derived records, never the licensed whole-market feed.
entry={};lastbuy={}
for row in det['orders']:
 o=dict(zip(sc['LOG_COLUMNS'],row))
 if o['filled'] and o['action']=='BUY':entry.setdefault(str(o['ticker']),o['execution_date']);lastbuy[str(o['ticker'])]=o['execution_date']
snapshots=[];public_orders=[]
for day_index in range(n0,final_n):
 date=str(sc['D'][day_index].date());st=captured[day_index]['state'];helds=[]
 dayrows=orders[orders.execution_date==date]
 for o in dayrows.to_dict('records'):
  if o['filled'] and o['action']=='BUY':entry.setdefault(str(o['ticker']),date);lastbuy[str(o['ticker'])]=date
  public_orders.append({'ledger':'C26_LOCK_20261112','date':date,'signal':o['signal_date'],'code':str(o['ticker']),'side':o['action'],'orderType':o['order_type'],'filled':bool(o['filled']),'price':o['fill_price'] if np.isfinite(o['fill_price']) else None,'level':o['limit_or_stop'] if o['limit_or_stop'] is not None and np.isfinite(o['limit_or_stop']) else None,'quantity':o['shares_proxy'],'notional':o['notional_proxy'],'realizedPct':o['realized_pct']/100 if o['realized_pct'] is not None and np.isfinite(o['realized_pct']) else None,'realizedNotional':None,'reason':o['reason'],'executionTime':'09:00開盤／日K觸價模擬'})
 for j in np.flatnonzero(st['qty']>1e-13):
  q=float(st['qty'][j]);p=float(sc['P'][a+day_index,j]);b=float(st['basis'][j]);code=codes[j]
  helds.append({'code':code,'quantity':q,'price':p,'avgEntryPrice':b,'weight':q*p/result['eq'][day_index],'unrealizedPct':p/b-1,'unrealizedNotional':q*(p-b),'entryDate':entry.get(code),'lastBuyDate':lastbuy.get(code)})
 snapshots.append({'date':date,'signal':str(sc['D'][day_index-1].date()),'nav':float(result['eq'][day_index]),'exposure':float(result['exp'][day_index]),'target':float(result['target'][day_index])*float(sc['RISK_GATES'][cfg['risk_gate']][a+day_index-1]),'holdings':helds,'archived_only':False,'riskGate':int(result['gate'][day_index])})
public={'lock_id':plan['lock_id'],'simulator_sha256':ENGINE_SHA,'first_date':dates[0],'last_date':dates[-1],'verified_dates':dates,'snapshots':snapshots,'orders':public_orders,'audited':True,'source_sha256':hashlib.sha256((PRIVATE/'forward-eod.json.gz').read_bytes()).hexdigest()}
public_dir=Path('public/r1494a/c26/data');(public_dir/'forward-replay.json').write_text(json.dumps(public,ensure_ascii=False,allow_nan=False,separators=(',',':')))
plan['forward_asset_sha256']=hashlib.sha256((public_dir/'forward-replay.json').read_bytes()).hexdigest();(public_dir/'verified-next-day-plan.json').write_text(json.dumps(plan,ensure_ascii=False,allow_nan=False,indent=2))
(OUT/'audit.json').write_text(json.dumps(report,indent=2));print('C26_NEXT_SESSION_PLAN',json.dumps(plan,ensure_ascii=False),flush=True)
