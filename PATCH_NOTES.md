# V1.14.2-R1 — clean rollback + latest-data repair

Base is the clean V1.14.2 project.

This rebuild intentionally DOES NOT include V1.15.0 / V1.15.1 changes:
- no Action Score
- no Confidence score
- no 5-day intraday-volume-profile change
- no V1.15 scanner/API refactor

Only latest-data behavior is repaired:

1. `/api/history/auto?fresh=1`
   - bypasses the Worker's 6-hour history cache
   - returns `cache-control: no-store`
   - is not written back into the 6-hour cache

2. Detail page
   - requests fresh history first
   - Scanner localStorage snapshot becomes fallback only
   - therefore an old Scanner snapshot cannot keep the formal audit on 9/10 after 9/11 has completed

3. Full-market Scanner
   - all TWSE / TPEx history requests use `fresh=1`
   - watchlist update uses `fresh=1`
   - diagnostic history uses `fresh=1`

4. TWSE `STOCK_DAY`
   - request includes a cache-buster to avoid stale intermediary monthly responses

Scoring/model behavior remains V1.14.2.
