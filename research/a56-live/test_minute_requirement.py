"""A missing tick file cannot block a mathematically impossible entry day."""
import unittest
from types import SimpleNamespace
import numpy as np
from engine import A56Engine
import a56_signals as live

class RequirementTests(unittest.TestCase):
    def setup_engine(self,high,low):
        e=object.__new__(A56Engine);e.sc={'H':np.array([[high]]),'L':np.array([[low]])};e.codes=['3653'];e.routes={}
        c=live.Candidate('3653',100,.1,.2,False,None,None,105,108,'2026-11-16')
        e.candidates_at=lambda t:[c];e.executable=lambda t,j:True
        self.calls=[]
        def missing(*a):self.calls.append(a);raise ValueError('required tick reconciliation failed')
        e.minute_loader=missing
        return e
    def test_no_tick_required_if_neither_path_can_trade(self):
        e=self.setup_engine(93,90)
        self.assertEqual(e.pick({'t':0,'date':'2026-11-17'},None,None,4,budget=.4,nav_twd=3e6),[])
        self.assertEqual(self.calls,[])
    def test_a_possible_c_path_still_requires_verified_minutes(self):
        e=self.setup_engine(95,90)
        with self.assertRaisesRegex(ValueError,'reconciliation'):e.pick({'t':0,'date':'2026-11-17'},None,None,4,budget=.4,nav_twd=3e6)
        self.assertEqual(len(self.calls),1)
    def test_a_possible_b_path_still_requires_verified_minutes_without_fresh_dip(self):
        e=self.setup_engine(106,101)
        with self.assertRaisesRegex(ValueError,'reconciliation'):e.pick({'t':0,'date':'2026-11-17'},None,None,4,budget=.4,nav_twd=3e6)
        self.assertEqual(len(self.calls),1)
    def test_daily_extremes_do_not_create_a_trade_or_assume_minute_order(self):
        e=self.setup_engine(106,90);e.minute_loader=lambda *a:np.full((276,5),np.nan)
        self.assertEqual(e.pick({'t':0,'date':'2026-11-17'},None,None,4,budget=.4,nav_twd=3e6),[])

if __name__=='__main__':unittest.main()
