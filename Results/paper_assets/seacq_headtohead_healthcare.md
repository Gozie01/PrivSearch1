# PrivSearch vs SeaCQ Head-to-Head (Healthcare (281,042 records))

**Run:** 2026-09-10T13:08:41.436Z
**Accumulator:** RSA-2048  |  **per-modPow:** 174.0 µs  |  **s = 5**
**Trials:** 100 measured, 5 warmup  |  **k ∈ {2,4,6,8,10}**
**Node:** v24.15.0  |  **CPU:** AMD Ryzen 7 7700 8-Core Processor               (16 cores)

## Summary (primary metric: modpow_ops = parameter-independent operation count)

| k | avg\|R\| | PS ops | SQ ops | ops ratio | PS ver (ms) | SQ ver (ms) | SQ mode |
|---|---:|---:|---:|---:|---:|---:|---|
| 2 | 102.0 | 10.0 | 204.0 | 20.4× | 3.106 | 35.504 | ⚠ estimated |
| 4 | 60.3 | 20.0 | 241.3 | 12.1× | 5.497 | 42.002 | ⚠ estimated |
| 6 | 379.7 | 30.0 | 2278.0 | 75.9× | 8.544 | 396.463 | ⚠ estimated |
| 8 | 922.7 | 40.0 | 7381.3 | 184.5× | 11.292 | 1284.647 | ⚠ estimated |
| 10 | 918.7 | 50.0 | 9186.7 | 183.7× | 13.680 | 1598.847 | ⚠ estimated |

> PS verify: measured at 2048-bit.  SQ verify "estimated": |R|×k×per_modPow_ms extrapolation.
> modpow_ops ratio = SQ_ops / PS_ops = |R|×k / (s×k) = |R|/s.  Parameter-independent.