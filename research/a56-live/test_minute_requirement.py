"""A missing tick file cannot block a mathematically impossible entry day."""
import unittest
from types import SimpleNamespace
import numpy as np
from engine import A56Engine,aggregate_ticks
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

class VolumeTests(unittest.TestCase):
    def setUp(self):
        self.d=dict(open=100,high=105,low=100,close=105,volume=10000)
        self.rows=[dict(date='2026-11-17',stock_id='3324',Time='09:00:01',deal_price=100,volume=4),dict(date='2026-11-17',stock_id='3324',Time='13:30:00',deal_price=105,volume=4),dict(date='2026-11-17',stock_id='3324',Time='14:30:00',deal_price=105,volume=1.7)]
    def test_after_hours_contributes_only_to_full_day_reconciliation(self):
        z=aggregate_ticks(self.rows,self.d,'2026-11-17','3324')
        self.assertEqual(z.shape,(276,5));self.assertEqual(np.nansum(z[:,4]),8000)
        self.assertEqual(z[0,4],4000);self.assertEqual(z[270,4],4000)
    def test_missing_tick_volume_is_still_rejected_by_unchanged_threshold(self):
        with self.assertRaisesRegex(ValueError,'volume not reconciled'):aggregate_ticks(self.rows[:2],self.d,'2026-11-17','3324')
    def test_duplicate_or_excess_volume_cannot_pass(self):
        with self.assertRaisesRegex(ValueError,'volume not reconciled'):aggregate_ticks(self.rows*2,self.d,'2026-11-17','3324')
    def test_bad_ohlc_and_wrong_date_cannot_pass(self):
        with self.assertRaisesRegex(ValueError,'OHLC'):aggregate_ticks(self.rows,{**self.d,'high':120},'2026-11-17','3324')
        with self.assertRaisesRegex(ValueError,'Wrong tick'):aggregate_ticks(self.rows,self.d,'2026-11-18','3324')

if __name__=='__main__':unittest.main()
