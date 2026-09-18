# PrivSearch vs SeaCQ Head-to-Head (Enron-derived)

**Run:** 2026-09-10T12:36:18.914Z
**Accumulator:** RSA-2048  |  **per-modPow:** 175.2 µs  |  **s = 5**
**Trials:** 100 measured, 5 warmup  |  **k ∈ {2,4,6,8,10}**
**Node:** v24.15.0  |  **CPU:** AMD Ryzen 7 7700 8-Core Processor               (16 cores)

## Summary (primary metric: modpow_ops = parameter-independent operation count)

| k | avg\|R\| | PS ops | SQ ops | ops ratio | PS ver (ms) | SQ ver (ms) | SQ mode |
|---|---:|---:|---:|---:|---:|---:|---|
| 2 | 10.3 | 10.0 | 20.7 | 2.1× | 2.446 | 5.215 | measured |
| 4 | 10.3 | 20.0 | 41.3 | 2.1× | 5.110 | 10.374 | measured |
| 6 | 10.0 | 30.0 | 60.0 | 2.0× | 7.717 | 15.261 | measured |
| 8 | 10.0 | 40.0 | 80.0 | 2.0× | 10.043 | 19.812 | measured |
| 10 | 10.0 | 50.0 | 100.0 | 2.0× | 12.487 | 24.805 | measured |

> PS verify: measured at 2048-bit.  SQ verify "estimated": |R|×k×per_modPow_ms extrapolation.
> modpow_ops ratio = SQ_ops / PS_ops = |R|×k / (s×k) = |R|/s.  Parameter-independent.