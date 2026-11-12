# C26 continuation runtime — 2026-11-13

The frozen simulator remains byte-identical. `checkpoint_runtime.py` adds state restoration and end-of-day capture around its existing daily loop, without replacing any signal, fill, fee or risk statement.

Independent validation ran the original 1407-day engine and compared serialized/resumed runs from six boundaries (including a 12-day continuation). All 1758 order rows and 1407 NAV values match exactly. See `checkpoint-runtime-validation.json`.

Run after installing the original full package:

```sh
python research/c26-lock/forward/verify-checkpoint-runtime.py --out /private/output
```

The resumable checkpoint includes the complete account-equity prefix required by the original all-history drawdown calculation, risk states, pending orders, loss cooldowns, watchlists and event slots. The earlier `model_checkpoint_20261027.json` is a diagnostic summary; it must not be used as the complete resumable state. Checkpoints use JSON with explicit types, never pickle. Keep full checkpoints in private storage.

## Still required before a current plan

- Rebuild every original runtime feature using new completed market data, with documented suspended/delisted-stock handling.
- Verify source and factor boundary parity; extend the engine data/calendar consistently.
- Resume 2026-10-28 onward, independently reconcile cash and share inventory, and generate next-session orders without using their future execution OHLC.
- Publish only after the forward replay and the current plan pass their gates. Historical continuation parity alone does not satisfy these gates.

Observed production source: through 2026-11-12, 12 staged forward trading dates, 232/233 latest prices, missing code 3714. Actual post-2026-10-27 model inventory and 2026-11-13 orders remain unverified.
