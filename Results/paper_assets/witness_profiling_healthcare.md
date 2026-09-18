# PrivSearch Witness-Phase Profiling (Healthcare (281,042 records))

**Run:** 2026-09-11T04:42:25.868Z
**Profile trials:** 1  |  **s = 5** (fixed accumulator sample size)

## Phase Decomposition by Keyword Count

| k | avg\|R\| | s used | witness ops | avg list size | per-witness (ms) | total witness (ms) | verify (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2 | 102.0 | 5.0 | 10.0 | 65864 | 16796.5633 | 167965.7529 | 107450.7144 |
| 4 | 60.3 | 5.0 | 20.0 | 32525 | 8298.8260 | 165976.6986 | 107603.1707 |
| 6 | 379.7 | 5.0 | 30.0 | 21810 | 5527.8206 | 165834.7807 | 146303.5569 |
| 8 | 922.7 | 5.0 | 40.0 | 1686 | 424.6464 | 16986.0521 | 10810.9452 |
| 10 | 918.7 | 5.0 | 50.0 | 1683 | 422.7909 | 21139.7858 | 13392.7972 |

> witness_ops = min(s, |R|) × k.  per-witness time scales with avg posting-list size (O(|list|) modPow ops).
> The k=6→k=8 verify jump is driven by: more witness ops (s×8 vs s×6) and posting-list size differences.