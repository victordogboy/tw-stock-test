"""A56-LOCK deterministic signal primitives; no network, broker, or future OHLC.

The original C26/A56 account engine owns inventory, core commitments and cash.
The caller must supply reconciled, timestamped inputs and real execution reports;
match_open is a historical/paper fill proxy only.
"""
from dataclasses import dataclass, asdict
from math import floor, ceil, isfinite
from statistics import median

VERSION = 'A56-LOCK-20261116'
BUY_COST = .0014275
ALLOC = .40
MAX_HOLDINGS = 8
LAST_FILL_MINUTE = 210  # 12:30 Taiwan time, 09:00 = 0


def tick(price, up=False):
    if not isfinite(price) or price <= 0:
        raise ValueError('invalid price')
    step = .01 if price < 10 else .05 if price < 50 else .1 if price < 100 else .5 if price < 500 else 1. if price < 1000 else 5.
    return round((ceil((price-1e-8)/step) if up else floor((price+1e-8)/step))*step, 4)


def market_warning(closes):
    """Last six *completed* market marks, oldest first; no current-day close."""
    if len(closes) != 6 or any(not isfinite(x) or x <= 0 for x in closes):
        raise ValueError('six verified market closes required')
    single=min(y/x-1 for x,y in zip(closes,closes[1:]))
    cumulative=closes[-1]/closes[0]-1
    # Match the locked comparison exactly to avoid boundary round-off.
    return single <= -.06 or closes[-1]/closes[0] <= .90, single, cumulative


@dataclass(frozen=True)
class Daily:
    date: str
    ref_close: float
    low: float
    close: float
    volume_shares: float
    executable: bool


@dataclass(frozen=True)
class Candidate:
    code: str
    prev_close: float
    loss5: float
    strength60: float
    a_ready: bool
    a_volume: float | None
    a_recovery: float | None
    b_floor: float | None
    b_cap: float | None
    b_reference_date: str | None

    @property
    def a_cap(self): return tick(self.prev_close*1.03)
    @property
    def c_arm(self): return tick(self.prev_close*.925)
    @property
    def c_floor(self): return tick(self.prev_close*.94, True)
    @property
    def c_cap(self): return tick(self.prev_close*.965)

    def public(self):
        return dict(asdict(self), a_cap=self.a_cap, c_arm=self.c_arm,
                    c_floor=self.c_floor, c_cap=self.c_cap)


def candidate(code, prev, five_ago, sixty_before_drop, base, history):
    """history: previous one or two completed sessions, newest last."""
    if not base or not all(isfinite(x) and x>0 for x in (prev,five_ago,sixty_before_drop)):
        return None
    loss=1-prev/five_ago; strength=five_ago/sixty_before_drop-1
    if loss < .03: return None
    if not history: raise ValueError('prior daily observations required')
    y=history[-1]; rec=None; vol=None; b_floor=b_cap=b_date=None
    if y.executable and y.low>0 and y.low<=tick(y.ref_close*.925):
        rec=y.close/y.low-1; vol=y.volume_shares if isfinite(y.volume_shares) else None
    for i in range(len(history)-1,-1,-1):
        d=history[i]
        if not d.executable: continue
        arm=tick(d.ref_close*.925); reclaim=tick(d.ref_close*.94,True)
        if d.low<=arm and d.close<reclaim and not any(x.close>=reclaim for x in history[i+1:]):
            b_floor=reclaim; b_cap=tick(d.ref_close*.965); b_date=d.date; break
    return Candidate(str(code),prev,loss,strength,rec is not None and rec>=.01,vol,rec,b_floor,b_cap,b_date)


def rank_candidates(candidates):
    return sorted((c for c in candidates if c is not None),key=lambda c:-c.strength60)[:4]


def exit_reason(warning, target, core_new, first_day, day, pending=False):
    if first_day is None or first_day<0: return None
    if target>=.40 or core_new: return 'core_recovery'
    if not warning: return 'warning_ended'
    if day>=first_day+5: return 'cycle_expiry'
    return 'pending_cycle' if pending else None


def tranche(warning,target,core_new,day,first_day,used,pending,exited,held_count,cash,nav,*,opening,core_pending=False):
    """Return original tranche slot count and budget fraction of prior NAV.
    Post-open B/C budgets may use opening cash; never intraday-sale cash.
    """
    if not warning or target>=.40 or core_new or pending or exited or (opening and core_pending): return 0,0.
    if not (isfinite(cash) and isfinite(nav) and nav>0 and cash>0): return 0,0.
    h=4 if (first_day is None or first_day<0) and not used else 3 if first_day is not None and first_day>=0 and day==first_day+1 else 0
    slots=max(0,min(h,MAX_HOLDINGS-held_count))
    if not slots: return 0,0.
    available=max(0.,cash-target*nav) if opening else cash
    return slots,min(ALLOC*slots/h,available/nav/(1+BUY_COST))


@dataclass(frozen=True)
class Intent:
    code: str
    route: str
    minute: int
    min_price: float
    max_price: float
    shares: int


def opening_intent(ranked,hold,blocked,budget,nav_twd):
    """Commit at most one A candidate BEFORE observing any opening price."""
    if hold<=0 or budget<=0: return None
    for c in ranked[:hold]:
        if c.code in blocked or not c.a_ready: continue
        if c.a_volume is None or not isfinite(c.a_volume) or c.a_volume<=0:
            raise ValueError(f'{c.code}: previous volume is not verified')
        shares=min(floor(budget/hold*nav_twd/c.a_cap),floor(.001*c.a_volume))
        if shares>0: return Intent(c.code,'A_open',0,0.,c.a_cap,shares)
    return None


def match_open(intent, price, executable):
    return bool(intent and executable and isfinite(price) and price>0 and intent.min_price<=price<=intent.max_price)


def exit_open(prev_close,price,executable):
    """Locked sell proxy: a lower-limit open must defer, not assume liquidity."""
    return bool(executable and isfinite(price) and price>tick(prev_close*.90,True))


class MinuteMonitor:
    """Per-candidate sequential B/C signal state. Input only completed bars.

    A confirmed no-trade minute is represented by NaN OHLC/volume. An unknown
    or stale data feed must stop this monitor at the caller, not inject NaNs.
    Volume unit is shares, not lots. The state is rebuilt from completed bars
    after reconnect; no current-day high/low or total volume is accepted.
    """
    def __init__(self,candidate,budget,hold,nav_twd):
        self.c=candidate; self.per_slot=budget/hold*nav_twd
        self.last=-1; self.down=False; self.c_reclaimed=False; self.b_reclaimed=False; self.volume=[]

    def completed(self,k,high,low,volume_shares):
        if k != self.last+1 or not 0<=k<LAST_FILL_MINUTE: raise ValueError('completed minutes must be sequential and before 12:30')
        self.last=k; self.volume.append(volume_shares/1000 if isfinite(volume_shares) else 0.)
        if volume_shares<0: raise ValueError('negative volume')
        c=self.c; out=[]; prior_down=self.down
        if not self.down and isfinite(low) and low<=c.c_arm: self.down=True
        # C must recover in a subsequent completed minute, not in the dip bar.
        if prior_down and isfinite(high) and high>=c.c_floor: self.c_reclaimed=True
        if c.b_floor is not None and isfinite(high) and high>=c.b_floor: self.b_reclaimed=True
        known=median(self.volume[-3:]);
        for ready,route,lo,hi,part in ((self.c_reclaimed,'C_intraday',c.c_floor,c.c_cap,.05),(self.b_reclaimed,'B_reclaim',c.b_floor,c.b_cap,.025)):
            if not ready: continue
            shares=min(floor(self.per_slot/hi),floor(part*known*1000))
            if shares>0: out.append(Intent(c.code,route,k+1,lo,hi,shares))
        return out
