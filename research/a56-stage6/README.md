# A56 stage 6: exact combined-account checkpoints and source-gap status

The original C26, FC23 and R1494-A rules are unchanged. A56 remains a paper
research account. No current-day orders are published by this change.

`checkpoint_a56.py` instruments the already-integrated frozen A56 simulator's
loop bounds, state restoration and end-of-day capture. It retains the full C26
risk history plus the A56 side quantities, entry/peak/day/exit state, event
episode, first-fill day, used-cycle flag, pending exits and complete global
order/trace histories. A C26-only checkpoint or display-only holding list is
insufficient and rejected. The stock ordering, calendar prefix, source hash,
frozen parameters and exact state-key/array shapes must match.

`verify_checkpoint.py` actually ran the recovered A48+A50–A52+A56 archives.
The complete run matched A56_RELEASE's 1,419 NAV marks, 38 side orders and
19 paired trades. It then serialized and resumed at six dates:

| Snapshot date | Open side positions | Result |
| --- | ---: | --- |
| 2021-05-17 | 4 | Entire subsequent account and order histories match |
| 2025-04-09 | 3 | Match |
| 2026-11-05 | 3 | Match |
| 2026-11-06 | 3 | Match |
| 2026-11-11 | 3 | Match |
| 2026-11-12 | 0 | No additional bars; returned account and histories match |

All NAV differences were exactly zero. Active-period resumes also matched
every final internal state field and global order/trace field exactly.
Six invalid serialized checkpoints were rejected. These checks establish
restart equivalence on the same historical data, not a new out-of-sample test.

`A56_checkpoint_20261112.json.gz` contains the actual full serialized state.
Decode with `checkpoint_a56.loads(gzip.decompress(bytes).decode())`; do not
attempt plain JSON decoding and lose tagged arrays, sets or nonfinite values.
Its uncompressed SHA-256 and the integrated simulator source hash appear in
`checkpoint-verification.json`. This checkpoint is simulation data and contains
no FinMind token, raw licensed source dataset or actual brokerage account.

Reproduce with the original recovered archives merged into a writable replay
directory and its original Python dependencies installed:

```sh
python3 research/a56-stage6/verify_checkpoint.py /absolute/path/to/writable/replay
node --test tests/a56-signals.test.mjs tests/a56-page.test.mjs tests/a56-continuation.test.mjs
```

The read-only `/api/c26/a56/status` compares the verified A56 checkpoint with
the existing sanitized market-coverage calendar. It shows the independent
account date, source date, next exchange date and dates still requiring A56
replay. Missing or invalid source status does not erase the verified historical
account. It always returns an empty action list until a separately implemented
forward-replay and live-plan pipeline exists. Refreshing the page queries this
status; it does not trigger background data fetching or replay.

At this verification the A56 account date is 2026-11-12, the verified source
date is 2026-11-13, and next exchange date is 2026-11-16. The remaining work is
to restore this combined state using the original C26 causal feature builder,
append verified post-anchor daily/minute inputs, execute 2026-11-13, and verify
the next-session plan against that continuing account. The live C26-only model
must not be substituted; its capital/risk path differs from A56's combined path.

Also fixed the browser minute-feed boundary: a signal is rejected once its
next execution minute has ended, even when source delay remains within 90s.
The frozen historical primitive and its 24,360-minute Python parity are intact.

Validation: 17 A56 checks and 12 existing C26 regression checks passed. An
additional legacy R56 deployment test still fails because its scheduled-job
mock expects valuation-only dispatch while the current Worker schedules FC23
as well. The identical failure was reproduced against unchanged `de10fac`;
see `baseline-r56-test.log`. No unrelated scheduler behavior was changed.
