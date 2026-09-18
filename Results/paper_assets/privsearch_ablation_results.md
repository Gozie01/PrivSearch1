# PrivSearch Ablation Results

Generated: 2026-09-10T15:07:13.272Z

Dataset: enron

Trials per query: 10

## Stage Summary

| Stage | System Variant | Scope | Mean Latency (ms) | Secondary Latency (ms) | Mean Memory Delta (bytes) | Mean Proof Size (bytes) |
|---|---|---|---:|---:|---:|---:|
| A0 | Baseline postings proxy | single_keyword + AND core | 0.0232 | 0.0000 | 549 | 0 |
| A1 | Encrypted-path proxy | single_keyword + AND core | 1.0731 | 0.0000 | 1875 | 2309 |
| A2 | Authenticated conjunctive PrivSearch | single_keyword + AND core | 100.5184 | 99.4453 | 1875 | 2309 |
| A3 | OR / OR-of-AND extension | or_2 + or_3 + or_of_and | 3.7714 | 3.5914 | 143 | 2540 |
| A4 | Range extension | month/year range families | 3893.8788 | 3231.0156 | 327592 | 2862 |
| A5 | Replay protection | live API freshness enforcement | 0.0205 | 0.0036 | 0 | 0 |
| A6 | Integrated PrivSearch | all current non-semantic families + healthcare corroboration | 459.1764 | 3.3871 | 30995 | 2333 |
| A6b | Integrated fuzzy extension | fuzzy_1 | 1.3668 | 1.3051 | -57617 | 975 |

Secondary latency notes:
- `A2`: mean verification latency on the same single-keyword and conjunctive workload core.
- `A5`: mean replay-rejection latency from the live API replay benchmark.
- `A6`: weighted healthcare mean total latency for broader-corpus corroboration.
- `A6b`: mean verification latency for fuzzy-one-edit queries.

## Core Conjunctive Comparison

| Query Type | Baseline Mean Total (ms) | PrivSearch Setup+Search Mean (ms) | PrivSearch Verify Mean (ms) | PrivSearch Mean Total (ms) | Baseline Mean Memory Delta (bytes) | PrivSearch Mean Memory Delta (bytes) | PrivSearch Mean Proof Size (bytes) |
|---|---:|---:|---:|---:|---:|---:|---:|
| and_10 | 0.0505 | 0.2503 | 13.1438 | 13.3942 | -17449 | 0 | 7206 |
| and_2 | 0.0478 | 0.0926 | 2.6051 | 2.6977 | 72 | 338 | 1669 |
| and_4 | 0.0549 | 0.1492 | 5.2477 | 5.3969 | 123 | 0 | 3056 |
| and_6 | 0.0499 | 0.1694 | 7.7498 | 7.9192 | 14602 | 430 | 4437 |
| and_8 | 0.0530 | 0.2668 | 10.9245 | 11.1914 | 9708 | 41 | 5824 |
| single_keyword | 0.0012 | 1.7955 | 173.3647 | 175.1602 | 38 | 3222 | 976 |

## Extension Families

| Query Type | Query Count | Mean Total (ms) | Median Total (ms) | Std Dev (ms) | 95% CI (ms) | Mean Verify (ms) | Mean Memory Delta (bytes) | Mean Proof Size (bytes) |
|---|---:|---:|---:|---:|---|---:|---:|---:|
| fuzzy_1 | 24 | 1.3668 | 1.3241 | 0.1576 | [1.3038, 1.4299] | 1.3051 | -57617 | 975 |
| or_2 | 40 | 2.7546 | 2.6843 | 0.2490 | [2.6775, 2.8318] | 2.5925 | 143155 | 1948 |
| or_3 | 20 | 4.1997 | 4.1309 | 0.3165 | [4.0610, 4.3385] | 3.9481 | -104755 | 2926 |
| or_of_and | 20 | 5.3768 | 5.3375 | 0.2096 | [5.2849, 5.4686] | 5.2324 | -180982 | 3338 |
| range_month_1 | 12 | 1877.2922 | 555.3951 | 2104.5824 | [686.5126, 3068.0718] | 1559.2331 | -108578 | 973 |
| range_month_3 | 10 | 3850.4255 | 2508.0793 | 3626.3142 | [1602.8126, 6098.0383] | 3201.3400 | 43581 | 2915 |
| range_month_6 | 8 | 2583.8597 | 1614.4087 | 2995.7245 | [507.9286, 4659.7909] | 2147.2349 | 1158810 | 5826 |
| range_year_2 | 6 | 13594.5662 | 1752.0029 | 18637.6888 | [-1318.6908, 28507.8231] | 11291.8357 | -55842 | 1917 |
| range_year_3 | 4 | 33.9668 | 18.4327 | 26.7341 | [7.7674, 60.1662] | 5.8099 | 9133158 | 2902 |
| range_year_5 | 2 | 68.5028 | 60.8316 | 10.8486 | [53.4673, 83.5382] | 13.1622 | -15421030 | 4836 |

## Notes

- This artifact is the first real-number ablation pass built from the current executable stack.
- `A0` is a baseline postings proxy, not a separate historical PureSearch reimplementation.
- `A1` is a practical encrypted-path proxy computed as `setup + search` from the PrivSearch prototype on the conjunctive core.
- Range and fuzzy families are benchmarked directly on the current PrivSearch prototype because the baseline engine does not implement those query classes.
- Memory is reported here as mean RSS delta per query run; peak-RSS instrumentation remains future work for the fuller ablation plan.
- Proof size is reported as serialized byte length of the returned `proof_hints` object when present.

Generated files:
- `Results/paper_assets/privsearch_ablation_results.csv`
- `Results/paper_assets/privsearch_ablation_core_conjunctive.csv`
- `Results/paper_assets/privsearch_ablation_extension_families.csv`
- `Results/paper_assets/privsearch_ablation_results.json`
