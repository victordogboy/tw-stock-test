"""Frozen A56 integration with causal C26 input globals and verified EOD ticks."""
from pathlib import Path
from dataclasses import asdict
import sys,json,gzip,urllib.request,os,hashlib,ast,copy
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'a56-stage6'))
from checkpoint_a56 import install,loads,dumps
import a56_signals as live
from account_io import clean,VERSION
ROOT=Path(__file__).resolve().parent

def input_fingerprints(sc,end):
    ans={}
    full=['P','BASE','TREND','RELAX','R20','EMA20','atr','RS5','RS20','VOL_RATIO','DOWN_SHARE','BUY_LEVEL','SCORE','EXTRA_RANK_BONUS','FC13_BONUS','FC15_FEATURE','FC17_REENTRY_SIGNAL','EXEC']
    daily=['O','H','L','C','VALID','LOCK_UP','LOCK_DOWN','market','B','SOFT_WEAK','EMG_SYS','MARKET_COLD']
    for key in full+daily:
        stop=sc['a']+end+1 if key in full else end+1
        x=np.asarray(sc[key][max(0,stop-69):stop],float)
        x=np.nan_to_num(np.round(x,3),nan=-999999,posinf=999999,neginf=-999999).astype('<f8')
        ans[key]=hashlib.sha256(x.tobytes()).hexdigest()
    return ans

class A56Engine:
    def __init__(self,sc,raw,*,minute_loader=None):
        self.sc=sc;self.raw=raw;self.routes={};self.candidates={};self.opening={};self.minute_loader=minute_loader
        self.source=(ROOT/'source/A56_SIMULATOR_INTEGRATED.py').read_text()
        self.sha=hashlib.sha256(self.source.encode()).hexdigest()
        self.anchor=json.loads((ROOT.parent/'a56-stage6/checkpoint-verification.json').read_text())
        assert self.sha==self.anchor['source_sha256']
        self.codes=list(map(str,sc['K']));self.dates=[str(d.date()) for d in sc['D']]
        self.group=[];episode=-1;previous=False
        for t in range(len(self.dates)):
            warning=t>=6 and live.market_warning(list(map(float,sc['market'][t-6:t])))[0]
            if warning and not previous:episode+=1
            self.group.append(episode if warning else -1);previous=warning
        sc.update(A32_DATA={t:{'t':t,'date':d} for t,d in enumerate(self.dates) if self.group[t]>=0},
          A32_EID=np.array(self.group),A32_PICK=self.pick,A32_CODES={c:j for j,c in enumerate(self.codes)},
          A32_ON=True,A32_GATE='B',A32_REPEAT=False,A34_FIRST=.40,A34_SECOND=.40,
          A32_ORDERS=[],A32_TRACE=[],A38_MODE='close',A38_AGE='cycle',A38_DAYS=5,
          A38_TP=0.,A38_SL=0.,A38_TRAIL=0.,A38_LOG=[],A44_LIMIT=.40,
          A51_OPEN=True,A51_EXCLUDE=None,A51_FRAC=1.,A51_PICK=self.preopen)
        assert abs(sc['BUY_COST']-.0014275)<1e-12 and abs(sc['SELL_COST']-.0044275)<1e-12
    def candidates_at(self,t):
        if t in self.candidates:return self.candidates[t]
        sc=self.sc;sig=sc['a']+t-1;xs=[]
        for j,c in enumerate(self.codes):
            hs=[]
            for u in (t-2,t-1):
                d=self.dates[u];day=self.raw.get('days',{}).get(d,{})
                p=next((x for x in day.get('price',[]) if str(x['stock_id'])==c),None)
                volume=float(p['volume']) if p else float('nan')
                hs.append(live.Daily(d,float(sc['P'][sc['a']+u-1,j]),float(sc['L'][u,j]),float(sc['C'][u,j]),volume,self.executable(u,j)))
            v=live.candidate(c,float(sc['P'][sig,j]),float(sc['P'][sig-5,j]),float(sc['P'][sig-65,j]),bool(sc['BASE'][sig,j]),hs)
            if v:xs.append(v)
        self.candidates[t]=live.rank_candidates(xs)
        return self.candidates[t]
    def executable(self,t,j):return bool(self.sc['EXEC'][self.sc['a']+t,j] and self.sc['VALID'][t,j])
    def preopen(self,d,hold,blocked,budget,nav_twd):
        t=d['t'];i=live.opening_intent(self.candidates_at(t),hold,blocked,budget,nav_twd)
        self.opening[d['date']]=asdict(i) if i else None
        if i is None:return []
        j=self.codes.index(i.code);p=float(self.sc['O'][t,j])
        if not live.match_open(i,p,self.executable(t,j)):return []
        self.routes[d['date'],0,i.code]=i.route
        return [(d['date'],0,i.code,p,i.shares*p/nav_twd,0.,0.)]
    def pick(self,d,model,gate,hold,blocked=(),budget=.04,nav_twd=None):
        out=[];t=d['t']
        for c in self.candidates_at(t)[:hold]:
            j=self.codes.index(c.code)
            if c.code in blocked or not self.executable(t,j):continue
            if self.minute_loader is None:raise ValueError('Verified minute source is required for active A56 entry')
            z=self.minute_loader(d['date'],c.code,t,j)
            monitor=live.MinuteMonitor(c,budget,hold,nav_twd)
            for k in range(210):
                intents=monitor.completed(k,float(z[k,1]),float(z[k,2]),float(z[k,4]))
                p=float(z[k+1,0]);i=next((i for i in intents if live.match_open(i,p,True)),None)
                if i:
                    self.routes[d['date'],k+1,c.code]=i.route
                    out.append((d['date'],k+1,c.code,p,i.shares*p/nav_twd,0.,0.));break
        return sorted(out,key=lambda x:(x[1],x[2]))
    def run(self,checkpoint,observer=None):
        fn,caps=install(self.sc,self.source,expected_source_sha256=self.sha,resume=checkpoint,
                        capture_days=[len(self.dates)-1],routes=lambda:self.routes,observer=observer)
        self.routes.update(checkpoint['routes'])
        result=fn('R1489_H',detailed=True)
        return result,caps.get(len(self.dates)-1,checkpoint)
    def plan(self,checkpoint,trade_date):
        sc=self.sc;N=sc['N'];assert N==len(self.dates) and checkpoint['date']==self.dates[-1]
        assert trade_date>checkpoint['date']
        # Unknown next-session prices exist only as NaN. Capture before the
        # simulator's first detailed block, which would read execution OHLC.
        import pandas as pd
        saved={k:sc[k] for k in ['D','P','N','z','EV_STOCKCAP_HISTORY']}
        sc['D']=sc['D'].append(pd.DatetimeIndex([trade_date]));sc['P']=np.vstack([sc['P'],np.full(len(self.codes),np.nan)])
        sc['N']+=1;sc['z']+=1;sc['EV_STOCKCAP_HISTORY']=np.r_[sc['EV_STOCKCAP_HISTORY'],1.]
        self.dates.append(trade_date)
        warning=live.market_warning(list(map(float,sc['market'][N-6:N])))[0]
        ep=self.group[-1] if warning and self.group[-1]>=0 else max(self.group)+1 if warning else -1
        self.group.append(ep);sc['A32_EID']=np.array(self.group)
        if warning:sc['A32_DATA'][N]={'t':N,'date':trade_date}
        fn,_=install(sc,self.source,expected_source_sha256=self.sha,resume=checkpoint)
        tree=ast.parse(self.source);func=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='simulate')
        line=next(n.lineno for n in ast.walk(func) if isinstance(n,ast.If) and isinstance(n.test,ast.Name) and n.test.id=='detailed' and any(isinstance(x,ast.Assign) and any(isinstance(y,ast.Name) and y.id=='signal_date' for y in x.targets) for x in n.body))
        class Captured(Exception):pass
        pre={}
        def trace(frame,event,arg):
            if event=='line' and frame.f_code.co_filename=='<A56_CHECKPOINT_RUNTIME>' and frame.f_code.co_name=='simulate' and frame.f_lineno==line:
                for k in ['current','entrants','to_sell','reason','target','port_risk','dd_gate','state','basket_risk','overlay_risk','qty','cash','held','peak','basis','prev_nav','cfg','sig','t','side_first','side_used','side_pending','pending_buy']:
                    pre[k]=copy.deepcopy(frame.f_locals[k])
                raise Captured()
            return trace
        try:
            sys.settrace(trace)
            try:fn('R1489_H',detailed=True)
            except Captured:pass
            finally:sys.settrace(None)
            assert pre and pre['t']==N
            st=checkpoint['state'];actions=[];sig=pre['sig'];core_new=bool(pre['entrants'])
            for j in pre['current']:
                q=float(st['qty'][j]);p=float(sc['P'][sig,j]);b=float(st['basis'][j]);cfg=pre['cfg']
                active=bool(cfg.get('protect') and sc['stop_gate'](sig,j,pre['held'][j],p/b-1))
                stop=sc['tick_down'](max(0,float(st['peak'][j])*(1-cfg.get('trail_pct',.15)),float(st['peak'][j])-cfg.get('stop_atr',2.8)*max(.005,float(sc['atr'][sig,j]))*p))
                sell=j in pre['to_sell']
                actions.append(dict(code=self.codes[j],sleeve='C26',side='SELL' if sell else 'HOLD',quantity=q,
                  referencePrice=p,orderType='SELL_OPEN' if sell else 'HOLD',reason=pre['reason'].get(j,'CONTINUE_HOLDING'),
                  stop=stop,stopActive=active,noFillPolicy='DEFER_LOCKED_EXIT' if sell else 'CONTINUE_HOLDING'))
            for j in pre['entrants']:
                p=float(sc['P'][sig,j]);ap=max(.005,min(.25,float(sc['atr'][sig,j])))
                level=sc['tick_up'](p*(1+pre['cfg'].get('break_atr',.1)*ap))
                actions.append(dict(code=self.codes[j],sleeve='C26',side='BUY',referencePrice=p,level=level,
                  budgetCap=min(pre['cash'],pre['prev_nav']/8),orderType='BUY_STOP_BREAKOUT',reason='new_position',noFillPolicy='NO_FILL_NO_BUY'))
            exit=live.exit_reason(warning,pre['target'],core_new,pre['side_first'],N,pre['side_pending'])
            for j in np.flatnonzero(st['side']>1e-13):
                actions.append(dict(code=self.codes[j],sleeve='REVERSAL',side='SELL' if exit else 'HOLD',quantity=float(st['side'][j]),
                  referencePrice=float(sc['P'][sig,j]),orderType='SELL_OPEN' if exit else 'HOLD',reason=exit or 'CONTINUE_HOLDING',noFillPolicy='DEFER_LOCKED_EXIT' if exit else 'CONTINUE_HOLDING'))
            slots,budget=live.tranche(warning,pre['target'],core_new,N,pre['side_first'],pre['side_used'],pre['side_pending'],False,
              int(np.count_nonzero(st['qty']+st['side']>1e-13)),pre['cash'],pre['prev_nav'],opening=True,core_pending=bool(pre['pending_buy']))
            cs=self.candidates_at(N) if warning else []
            blocked={self.codes[j] for j in np.flatnonzero(st['qty']+st['side']>1e-13)}
            intent=live.opening_intent(cs,slots,blocked,budget,pre['prev_nav']*3e6) if slots and budget and not exit else None
            if intent:actions.append(dict(code=intent.code,sleeve='REVERSAL',side='BUY',route='A_open',level=intent.max_price,
                maxShares=intent.shares,referencePrice=next(c.prev_close for c in cs if c.code==intent.code),orderType='A_OPEN_LIMIT',reason='A_open',noFillPolicy='NO_FILL_NO_BUY'))
            return clean(dict(model_version='A56',lock_id=VERSION,source_sha256=self.sha,signal_as_of=checkpoint['date'],trade_date=trade_date,
              readiness='ready_for_manual_review',actions=actions,target=pre['target'],warning=warning,episode=ep,
              candidates=[c.public() for c in cs],opening_slots=slots,opening_budget=budget*pre['prev_nav'],exit_reason=exit,
              side_used=pre['side_used'],side_first=pre['side_first'],no_future_execution_prices=True,
              conditions='B/C 只列盤前條件價；開盤後須核對核心成交、剩餘現金、名額及已完成分K，才可確認條件委託。',
              risk={k:bool(pre[k]) for k in ['port_risk','dd_gate','state','basket_risk','overlay_risk']}))
        finally:
            sc.update(saved);self.dates.pop();self.group.pop()

def tick_minutes(sc,raw,date,code,t,j):
    """Historical tick aggregation. Full EOD reconciliation validates volume units."""
    token=os.environ.get('FINMIND_TOKEN','').strip()
    if not token:raise ValueError('Protected FinMind tick credential missing')
    directory=Path('.c26-private/a56-minutes');directory.mkdir(parents=True,exist_ok=True)
    file=directory/(date+'-'+code+'.json.gz')
    if file.exists():data=json.loads(gzip.decompress(file.read_bytes()))
    else:
        from urllib.parse import urlencode
        url='https://api.finmindtrade.com/api/v4/data?'+urlencode(dict(dataset='TaiwanStockPriceTick',data_id=code,start_date=date))
        req=urllib.request.Request(url,headers={'Authorization':'Bearer '+token})
        with urllib.request.urlopen(req,timeout=100) as r:data=json.load(r)
        if data.get('status')!=200 or not isinstance(data.get('data'),list):raise ValueError('Verified FinMind tick response missing')
        file.write_bytes(gzip.compress(json.dumps(data).encode()))
    rows=[]
    for x in data['data']:
        if str(x.get('stock_id',code))!=code or x.get('date',date)!=date:raise ValueError('Wrong tick stock/date')
        clock=str(x.get('Time',x.get('time','')));parts=clock.split(':')
        if len(parts)<3:raise ValueError('Tick timestamp missing')
        k=(int(parts[0])-9)*60+int(parts[1]);p=float(x['deal_price']);v=float(x['volume'])
        if 0<=k<=275 and p>0 and v>0:rows.append((clock,k,p,v))
    rows.sort();assert rows,'Missing tick trades'
    d=next(x for x in raw['days'][date]['price'] if str(x['stock_id'])==code)
    total=sum(x[3] for x in rows)
    factors=[v for v in [1.,1000.] if .95<=total*v/d['volume']<=1.01]
    if len(factors)!=1:raise ValueError('Tick/daily volume units or completeness not reconciled')
    factor=factors[0];z=np.full((276,5),np.nan)
    for clock,k,p,v in rows:
        if np.isnan(z[k,0]):z[k]=[p,p,p,p,0]
        z[k,1]=max(z[k,1],p);z[k,2]=min(z[k,2],p);z[k,3]=p;z[k,4]+=v*factor
    good=np.isfinite(z[:,0]);obs=z[good]
    values=[obs[0,0],obs[:,1].max(),obs[:,2].min(),obs[-1,3]]
    if any(abs(x/y-1)>.005 for x,y in zip(values,[d['open'],d['high'],d['low'],d['close']])):raise ValueError('Tick/daily OHLC not reconciled')
    return z
