# C26 verified forward release — 2026-11-13

The original Python simulator is unchanged (SHA-256 `741862f102438f8f10fcf40cf2f9b47edb8fece004e0175ae3f1be7e94bd4ad5`). The 1407-day / 1758-order archive is reproduced before continuation. No FC23/R1494 portfolio state, cash or trading decision is used.

The technical input bridge starts from the existing 2026-10-27 indicator buffers. Its active decision inputs are checked against the frozen Python arrays: stock marks, BASE/TREND/RELAX, R20, EMA20, ATR, RS5/RS20, volume ratio, down-volume share, buy coefficients, score and hot-rank component. Boundary discrepancies are zero except base score float arithmetic below 6e-8. The C26 dynamic-peer formula is independently computed in Python using its original carried-mark matrix, including suspended securities. The other monitor's raw-close peer helper is deliberately not used for C26 entry decisions. F5/T5 are clipped to the original +/-0.5 range.

FinMind source through 2026-11-12 covers twelve new trading dates. Full-market ordinary-stock prices preserve the original market proxy and breadth. The frozen engine emits 18 additional order rows. A separate ledger reconstructs cash, stock quantities and every NAV from fills with the original two-sided costs; maximum NAV difference is below 1e-14 normalized units. 3714 has no executable OHLC while suspended; its previous mark can be carried for valuation only. A reopening/capital-reduction adjustment must be verified before trading it again.

The 2026-11-13 plan is captured before the frozen simulator's first execution phase, with unknown execution prices absent. The result is HOLD 2801; no new stock BUY/SELL. Protective-stop activation is false. Opening reference target exposure is 0.00694575 (0.694575%). This is a fractional-share stock paper model; it does not submit broker orders.

## Reproduce

Install the original full archive with `bootstrap_assets.py` first. With a process-local `FINMIND_TOKEN`, run from the repository root:

```sh
node research/c26-lock/forward/stage-finmind.mjs
python research/c26-lock/forward/fetch-market.py
node research/c26-lock/forward/build-contexts.mjs
python research/c26-lock/forward/replay-forward.py
node --test tests/c26-*.test.mjs
```

Keep `.c26-private/` private. Public release files contain strategy-derived orders, selected holdings, NAV and audit summaries, not the full licensed market feed. The published archive remains immutable. New-day plans require a fresh original-engine replay; the browser's source-update button alone does not establish a new-day trading plan.

Device Token UI saves only in that browser's localStorage, with a clear control. Authorized requests carry the credential over HTTPS. The Worker stores only an owner credential fingerprint for verification; neither public source nor private source storage contains the FinMind token. GitHub Actions retains its existing private secret/OIDC path for source refresh.
