# V1.16.0 — R3 + Action/Confidence + Scanner reliability fix

Base: confirmed-working V1.14.2-R3.

## Added
Action = 40% Entry + 30% Setup + 30% Opportunity.

Confidence = existing FinMind completeness. It does not affect scoring.

## Scanner root-cause fix
The R3 full-market worker requested `fresh=1` for every one of ~2271 stocks.
`fresh=1` intentionally bypasses the Worker's 6-hour history cache. Repeated whole-market
scans therefore directly hammered Yahoo/TWSE thousands of times and can trigger upstream
rate limiting / transient failures. The symptom is exactly:
`成功 0 / 略過 N`.

V1.16.0 changes only the HISTORY FETCH strategy of first-pass scanning:
1. use the last completed Taiwan session date;
2. request normal cached history first;
3. only failed symbols retry `fresh=1`;
4. cap first-pass concurrency at 3;
5. show the latest concrete error beside the running status if success is still zero.

FinMind recheck, Live current-score recheck, V4.4 scoring, Detail R3 close promotion,
and Worker API code are unchanged.
