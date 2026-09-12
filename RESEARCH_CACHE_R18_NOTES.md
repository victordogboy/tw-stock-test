# R18: Research cache failure guard

Base commit: f65734fb783e28bbe8ee95e6dd48bd32042b712b (R17).

Failed/empty history requests and failed/partial chip requests now return HTTP 502 before cache writes. Existing cache and coverage are preserved, allowing an explicit build to retry. Successful builds still merge data and request missing ranges only. Cache-only load never fetches upstream.

Validation: node --test tests/research-cache.test.cjs — 7 tests passed with mocked upstream responses.

Limits: this is a failure guard, not proof of full per-trading-day data coverage. The upstream completeness field checks dataset presence. Existing R17 coverage metadata is not revalidated. A failed multi-range build preserves the old cache and may refetch successful ranges on an explicit retry. No durable storage migration is included; Cloudflare Cache API may evict data. Live Cloudflare deployment has not been verified.

Apply using the existing update ZIP workflow only if main still matches the base commit; otherwise compare changes first. This package changes src/index.js and adds tests and these notes. It does not include credentials.
