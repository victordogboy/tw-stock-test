"""Derived dashboard records for the original combined A56 paper account."""
import math
import numpy as np

VERSION='A56-LOCK-20261116'
BUY=.0014275
SELL=.0044275

def clean(x):
    if isinstance(x,np.generic):return clean(x.item())
    if isinstance(x,float) and not math.isfinite(x):return None
    if isinstance(x,dict):return {str(k):clean(v) for k,v in x.items()}
    if isinstance(x,(list,tuple)):return [clean(v) for v in x]
    return x

def core_order(row):
    _,signal,date,code,action,method,level,op,hi,lo,cl,price,filled,reason,q,amount,rtn,amb=row
    basis=price/(1+rtn/100) if filled and action=='SELL' and rtn is not None and rtn>-100 else None
    net=(price*(1-SELL)/(basis*(1+BUY))-1) if basis else None
    return clean(dict(ledger=VERSION,sleeve='C26',date=date,signal=signal,code=str(code),side=action,
                     orderType=method,filled=bool(filled),price=price,level=level,quantity=q,
                     notional=amount,realizedPct=net,
                     realizedNotional=q*(price*(1-SELL)-basis*(1+BUY)) if basis else None,
                     reason=reason,executionTime='09:00開盤／日K觸價模擬',ambiguity=bool(amb)))

def side_order(row,dates,routes,entries):
    date,minute,code,action,price,q,amount,target=row
    prev=dates[dates.index(date)-1] if dates.index(date)>0 else None
    route=routes.get((date,minute,code)) if action=='BUY' else entries.get(code,{}).get('route')
    before=entries.get(code)
    if action=='BUY':entries[code]=dict(price=price,route=route,date=date,quantity=q)
    basis=before['price'] if action=='SELL' and before else None
    result=clean(dict(ledger=VERSION,sleeve='REVERSAL',date=date,signal=prev,code=str(code),side=action,
       route=route,orderType=route if action=='BUY' else 'SELL_OPEN',filled=True,price=price,level=None,
       quantity=q,notional=amount,realizedPct=price*(1-SELL)/(basis*(1+BUY))-1 if basis else None,
       realizedNotional=q*(price*(1-SELL)-basis*(1+BUY)) if basis else None,
       reason=route if action=='BUY' else 'reversal_exit',
       executionTime=f'{9+minute//60:02}:{minute%60:02}分K開盤代理'))
    if action=='SELL':entries.pop(code,None)
    return result

class Recorder:
    def __init__(self,sc,routes,previous=None):
        self.sc=sc;self.routes=routes;self.snapshots=[];self.orders=[];self.entries={};self.last_buy={};self.side_entries={}
        self.core_cursor=0;self.side_cursor=0
        if previous:
            # Replay prefix events to rebuild entry dates without changing cash.
            for o in previous['orders']:
                self.track(o)
                if o.get('sleeve')=='REVERSAL' and o['filled']:
                    if o['side']=='BUY':self.side_entries[o['code']]=dict(price=o['price'],route=o.get('route'),date=o['date'],quantity=o['quantity'])
                    else:self.side_entries.pop(o['code'],None)
            self.core_cursor=previous['core_order_rows'];self.side_cursor=previous['side_order_rows']
    def track(self,o):
        if not o['filled']:return
        if o['side']=='BUY':
            self.entries.setdefault(o['code'],o['date']);self.last_buy[o['code']]=o['date']
    def __call__(self,t,s):
        sc=self.sc;dates=[str(d.date()) for d in sc['D']];date=dates[t]
        for row in s['orders'][self.core_cursor:]:
            o=core_order(row);self.orders.append(o);self.track(o)
        self.core_cursor=len(s['orders'])
        for row in sc['A32_ORDERS'][self.side_cursor:]:
            o=side_order(row,dates,self.routes(),self.side_entries);self.orders.append(o);self.track(o)
        self.side_cursor=len(sc['A32_ORDERS'])
        px=sc['P'][sc['a']+t];nav=float(s['equity'][t]);held=[]
        for j in np.flatnonzero(s['qty']+s['side']>1e-13):
            code=str(sc['K'][j]);q=float(s['qty'][j]+s['side'][j]);basis=float((s['qty'][j]*s['basis'][j]+s['side'][j]*s['side_entry'][j])/q);p=float(px[j])
            held.append(dict(code=code,quantity=q,price=p,avgEntryPrice=basis,weight=q*p/nav,
              coreQuantity=float(s['qty'][j]),sideQuantity=float(s['side'][j]),
              unrealizedPct=p/basis-1,unrealizedNotional=q*(p-basis),costNotional=q*basis,marketNotional=q*p,
              entryDate=self.entries.get(code),lastBuyDate=self.last_buy.get(code)))
        live={h['code'] for h in held}
        self.entries={k:v for k,v in self.entries.items() if k in live}
        self.last_buy={k:v for k,v in self.last_buy.items() if k in live}
        signal=str(sc['m'].D[sc['a']+t-1].date())
        self.snapshots.append(clean(dict(date=date,signal=signal,nav=nav,cash=float(s['cash']),
          exposure=float(s['expos'][t]),target=float(s['target']),holdings=held,
          riskGate=int(s['gate_history'][t]),basket=bool(s['basket_risk']),bear=bool(s['state']),
          overlay=bool(s['overlay_risk']),ddGate=bool(s['dd_gate']),
          sideFirst=int(s['side_first']),sideUsed=bool(s['side_used']),sideEpisode=int(s['side_episode']),sidePending=bool(s['side_pending']))))

def audit(snapshots,orders,initial_cash=1.):
    cash=initial_cash;qty={};oi=0;max_error=0.;ordered=sorted(orders,key=lambda o:o['date'])
    for s in snapshots:
        while oi<len(ordered) and ordered[oi]['date']<=s['date']:
            o=ordered[oi];oi+=1
            if not o['filled']:continue
            q=o['quantity'];code=o['code'];amount=q*o['price'];sign=1 if o['side']=='BUY' else -1
            cash-=amount*(1+BUY) if sign==1 else -amount*(1-SELL)
            qty[code]=qty.get(code,0)+sign*q
            if abs(qty[code])<1e-10:qty.pop(code)
        hs={h['code']:h for h in s['holdings']}
        assert set(qty)==set(hs),(s['date'],qty,hs)
        assert all(abs(q-hs[c]['quantity'])<1e-9 for c,q in qty.items())
        rebuilt=cash+sum(q*hs[c]['price'] for c,q in qty.items())
        max_error=max(max_error,abs(rebuilt-s['nav']),abs(cash-s['cash']))
        assert cash>=-1e-8 and len(qty)<=8
    assert max_error<1e-8,max_error
    return dict(passed=True,days=len(snapshots),orders=len(orders),max_nav_cash_error=max_error,max_holdings=max(len(s['holdings']) for s in snapshots))
