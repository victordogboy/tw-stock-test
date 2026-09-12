# Strategy Regression Lab R2 — Server Cache

Base: V1.17.0-R16

## Scope
Only two production paths differ from R16:
- `src/index.js`: adds isolated `/api/research/cache/*` routes.
- `public/strategy-regression-lab.html`: new research page.

Scanner, Detail, Index and `public/v44-engine.js` are unchanged.

## Token-safe flow
1. `檢查研究快取` is cache-only and does not call FinMind.
2. `補齊缺少資料` is the only research-lab action allowed to request missing upstream data and may use FinMind Token.
3. `開始回測` reads `/api/research/cache/load` only. That route never fetches Yahoo/TWSE/TPEx/FinMind. Re-running strategy calculations therefore consumes 0 FinMind requests as long as the required server cache exists.
4. Existing coverage is reused. Expanding the sample only builds newly missing stocks; expanding the date range only requests uncovered date ranges.

## Storage
Cloudflare Cache API, TTL 1 year. This is best-effort edge cache, not a durable database; eviction is possible.

## Research
Strict No-Lookahead replay, ΔEntry / ΔAction, T+1/T+3/T+5/T+10, MFE/MAE, Train/Test split, controlled OLS, and ExitRisk price-mirror tests remain isolated from production strategy.
