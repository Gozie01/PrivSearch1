# PrivSearch Scalability Summary

Generated: 2026-09-10T16:11:28.216Z

Dataset: enron

Engine: privsearch-prototype

Trials per query: 5

## Posting-List Size

| Bucket | Query Count | Mean Doc Freq | Mean Total (ms) | Mean Search (ms) | Mean Verify (ms) | Mean Proof Size (bytes) | Mean Memory Delta (bytes) |
|---|---:|---:|---:|---:|---:|---:|---:|
| P1_1_10 | 5 | 5.0 | 2.6901 | 0.3547 | 2.3179 | 982 | 3441 |
| P2_11_100 | 5 | 12.4 | 4.8684 | 0.7662 | 4.0912 | 974 | -87491 |
| P3_101_1000 | 5 | 108.2 | 36.3569 | 6.7384 | 29.5808 | 970 | 11796 |
| P4_1001_10000 | 5 | 1060.2 | 352.0691 | 68.0083 | 284.0399 | 974 | 40796 |
| P5_10001_plus | 3 | 13082.0 | 4829.4158 | 825.8744 | 4003.5134 | 975 | 802543 |

## Clause Count

| Mode | Clause Count | Query Count | Mean Total (ms) | Mean Verify (ms) | Mean Proof Size (bytes) | 95% CI Total (ms) |
|---|---:|---:|---:|---:|---:|---|
| conjunctive | 2 | 5 | 2.5961 | 2.5318 | 1670 | [2.5397, 2.6526] |
| conjunctive | 4 | 5 | 5.4931 | 5.4040 | 3062 | [5.2069, 5.7794] |
| conjunctive | 5 | 5 | 6.6821 | 6.5402 | 3748 | [6.5574, 6.8069] |
| conjunctive | 6 | 5 | 7.8904 | 7.7776 | 4441 | [7.7197, 8.0611] |
| conjunctive | 8 | 5 | 10.6726 | 10.4490 | 5823 | [10.5838, 10.7614] |
| conjunctive | 10 | 5 | 13.6511 | 13.4102 | 7212 | [12.2828, 15.0193] |
| disjunctive | 2 | 5 | 2.6862 | 2.6519 | 1957 | [2.5350, 2.8373] |
| disjunctive | 3 | 5 | 3.8842 | 3.8388 | 2933 | [3.8406, 3.9279] |
| dnf | 2 | 5 | 5.9882 | 5.8722 | 3343 | [5.5751, 6.4012] |
| single | 1 | 5 | 1.2671 | 1.2512 | 973 | [1.2274, 1.3068] |

## Concurrent Users

| Query Type | Concurrency | Mean Total (ms) | Median (ms) | P95 (ms) | Throughput (req/s) | Success Rate | Queueing Delay (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
| and_2 | 1 | 2.6076 | 2.5094 | 2.8624 | 378.98 | 100.00% | 0.0000 |
| and_2 | 5 | 2.5512 | 2.5077 | 2.6439 | 387.85 | 100.00% | 0.0000 |
| and_2 | 10 | 2.6197 | 2.5173 | 2.9406 | 377.90 | 100.00% | 0.0000 |
| and_2 | 25 | 2.4751 | 2.4170 | 2.5721 | 399.92 | 100.00% | 0.0000 |
| or_2 | 1 | 2.6362 | 2.5881 | 2.8072 | 375.77 | 100.00% | 0.0000 |
| or_2 | 5 | 2.5997 | 2.5764 | 2.7140 | 380.93 | 100.00% | 0.0000 |
| or_2 | 10 | 2.6552 | 2.5878 | 2.8923 | 372.73 | 100.00% | 0.0000 |
| or_2 | 25 | 2.5731 | 2.5013 | 2.8613 | 383.91 | 100.00% | 0.0000 |
| range_month_1 | 1 | 1.4052 | 1.3229 | 1.6285 | 697.83 | 100.00% | 0.0000 |
| range_month_1 | 5 | 1.3970 | 1.3522 | 1.5147 | 700.39 | 100.00% | 0.0000 |
| range_month_1 | 10 | 1.3686 | 1.3251 | 1.5075 | 715.25 | 100.00% | 0.0000 |
| range_month_1 | 25 | 1.3435 | 1.2807 | 1.5801 | 728.04 | 100.00% | 0.0000 |

## Corpus Size

| Label | Status | Configured Value | Query Count | Mean Total (ms) | Mean Verify (ms) | Notes |
|---|---|---:|---:|---:|---:|---|
| C1_10000 | disabled | 10000 | 0 | n/a | n/a | Fill these paths after preparing a 10k-record slice. |
| C2_50000 | disabled | 50000 | 0 | n/a | n/a | Fill these paths after preparing a 50k-record slice. |

## Vocabulary Size

| Label | Status | Configured Value | Query Count | Mean Total (ms) | Mean Verify (ms) | Notes |
|---|---|---:|---:|---:|---:|---|
| V1_5000 | disabled | 5000 | 0 | n/a | n/a | Fill these paths after preparing a 5k-keyword slice. |
| V2_25000 | disabled | 25000 | 0 | n/a | n/a | Fill these paths after preparing a 25k-keyword slice. |

## Notes

- This is the first executable PrivSearch scalability skeleton.
- Posting-list, clause-count, and concurrent-user axes are measured directly on the current prototype.
- Corpus-size and vocabulary-size axes are manifest-driven so prepared slice indexes can be added without changing the script.
- Concurrent-user scaling here is same-process engine-level stress, not a full multi-host distributed deployment.

Generated files:
- `Results/paper_assets/privsearch_scalability_summary.json`
- `Results/paper_assets/privsearch_scalability_postings.csv`
- `Results/paper_assets/privsearch_scalability_clause_count.csv`
- `Results/paper_assets/privsearch_scalability_concurrency.csv`
- `Results/paper_assets/privsearch_scalability_corpus.csv`
- `Results/paper_assets/privsearch_scalability_vocabulary.csv`
- Manifest: `Results/paper_assets/privsearch_scalability_manifest.json`
