# V1.15.0 Stable Merge — based on working V1.14.2-R3

This version starts from the confirmed-working V1.14.2-R3.
The 9/11 after-close fixes are preserved exactly:
- fresh=1 bypasses stale history cache
- Detail fetches fresh history first
- after 13:30, completed Yahoo 1m O/H/L/C/V can be promoted into the formal daily K
- Live EST is hidden after close
- Scanner and Detail use Asia/Taipei session time

Added features:

## Action Score
`Action = 40% Entry + 30% Setup + 30% Opportunity`

Hard gates prevent other scores from hiding a bad entry:
- Entry < 62 => Action max 59
- Risk > 7% => Action max 59
- HardBroken => Action max 49

Hold is intentionally excluded from Action.

## Confidence
0–100 auxiliary data-quality score based on:
- history depth
- current price validity
- margin / institutional / day-trade freshness
- live quote validity
- intraday volume-estimate confidence
- FinMind completeness

Confidence does not modify Setup / Opportunity / Entry / Hold.

## Historical intraday volume profile
`/api/intraday` now requests Yahoo 5d / 1m.
For prior sessions it calculates the median:
`volume traded by same clock time / full-day volume`

During market hours this profile is preferred over a purely linear clock projection.
If there are fewer than 2 usable prior sessions, the original time-progress model is used.

## UI
- Scanner keeps the original four ranking tabs only.
- Adds Action and Conf. columns for decision support.
- Detail adds Action and Confidence to formal audit and intraday Live cards.
- V1.14.2 scoring formulas are unchanged.
