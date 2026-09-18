# PrivSearch Witness-Phase Profiling (Enron-derived)

**Run:** 2026-09-11T05:15:57.866Z
**Profile trials:** 1  |  **s = 5** (fixed accumulator sample size)

## Phase Decomposition by Keyword Count

| k | avg\|R\| | s used | witness ops | avg list size | per-witness (ms) | total witness (ms) | verify (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2 | 10.3 | 5.0 | 10.0 | 3113 | 835.9991 | 8360.0780 | 2.7757 |
| 4 | 10.3 | 5.0 | 20.0 | 7570 | 1948.4658 | 38969.4958 | 17146.9632 |
| 6 | 10.0 | 5.0 | 30.0 | 6816 | 1724.1598 | 51725.0218 | 27883.0586 |
| 8 | 10.0 | 5.0 | 40.0 | 7122 | 1804.6355 | 72185.6250 | 58755.9179 |
| 10 | 10.0 | 5.0 | 50.0 | 6342 | 1615.0602 | 80753.2725 | 71426.8676 |

> witness_ops = min(s, |R|) × k.  per-witness time scales with avg posting-list size (O(|list|) modPow ops).
> The k=6→k=8 verify jump is driven by: more witness ops (s×8 vs s×6) and posting-list size differences.