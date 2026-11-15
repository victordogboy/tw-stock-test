import unittest
from math import nan
from a56_signals import *

class SignalTests(unittest.TestCase):
    def c(self,low=90,close=92,volume=1000000):
        return candidate('3443',close,100,50,True,[Daily('2026-11-12',100,low,close,volume,True)])

    def test_warning_uses_completed_days(self):
        self.assertTrue(market_warning([100,100,100,100,100,93])[0])
        self.assertFalse(market_warning([100,100,100,100,100,95])[0])
        self.assertTrue(market_warning([100,98,96,94,92,90])[0])
        with self.assertRaises(ValueError):market_warning([100,99,nan,97,96,95])

    def test_open_commits_only_first(self):
        a=self.c(low=90,close=93)
        b=candidate('3661',93,100,55,True,[Daily('2026-11-12',100,90,93,1000000,True)])
        i=opening_intent([a,b],2,[],.4,3000000)
        self.assertEqual(i.code,'3443')
        self.assertFalse(match_open(i,i.max_price+1,True))
        self.assertTrue(match_open(i,i.max_price,True))
        self.assertEqual(i.shares,1000)

    def test_b_reclaims_without_new_dip(self):
        c=self.c(); self.assertEqual(c.b_floor,94)
        m=MinuteMonitor(c,.4,4,3000000)
        i=m.completed(0,94,93,100000)[0]
        self.assertEqual((i.route,i.minute,i.shares),('B_reclaim',1,2500))

    def test_c_requires_subsequent_bar(self):
        c=self.c(low=91,close=96); m=MinuteMonitor(c,.4,4,3000000)
        self.assertEqual(m.completed(0,c.c_floor,c.c_arm,100000),[])
        i=m.completed(1,c.c_floor,c.c_arm,100000)[0]
        self.assertEqual((i.route,i.minute),('C_intraday',2)); self.assertFalse(match_open(i,i.max_price+.5,True))

    def test_missing_and_late_minute(self):
        c=self.c(); m=MinuteMonitor(c,.4,4,3000000)
        with self.assertRaises(ValueError):m.completed(1,94,93,100000)
        for k in range(210):m.completed(k,nan,nan,nan)
        with self.assertRaises(ValueError):m.completed(210,94,93,100000)

    def test_exit_and_limit(self):
        self.assertEqual(exit_reason(True,.39,False,12,17),'cycle_expiry')
        self.assertEqual(exit_reason(True,.4,False,12,13),'core_recovery')
        self.assertEqual(exit_reason(False,.2,False,12,13),'warning_ended')
        self.assertFalse(exit_open(100,90,True)); self.assertTrue(exit_open(100,90.1,True))
        self.assertFalse(exit_open(100,95,False))

    def test_tranche_and_reservation(self):
        s,b=tranche(True,.1,False,10,-1,False,False,False,6,.2,1,opening=True)
        self.assertEqual(s,2); self.assertAlmostEqual(b,.1/(1+BUY_COST))
        self.assertEqual(tranche(True,.1,False,12,10,True,False,False,2,.5,1,opening=False),(0,0.))
        self.assertEqual(tranche(True,.4,False,10,-1,False,False,False,0,1,1,opening=True),(0,0.))

if __name__=='__main__':unittest.main()
