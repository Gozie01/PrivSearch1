# Final PrivSearch Journal Tables

Generated: 2026-07-09T08:38:46.754Z

## Table 1. Enron-Derived PrivSearch Query-Family Summary

| Query Type | Query Count | Mean Total ms | Mean Search ms | Mean Verify ms | Verification Failures |
|---|---:|---:|---:|---:|---:|
| single_keyword | 150 | 1.8912 | 0.3583 | 1.5284 | 0 |
| and_2 | 40 | 5.9173 | 0.0257 | 5.8856 | 0 |
| and_4 | 20 | 21.7278 | 0.0325 | 21.6850 | 0 |
| and_6 | 20 | 19.9022 | 0.0252 | 19.8657 | 0 |
| and_8 | 20 | 19.1582 | 0.0289 | 19.1145 | 0 |
| and_10 | 20 | 22.1822 | 0.0250 | 22.1389 | 0 |
| or_2 | 40 | 0.2914 | 0.1264 | 0.1605 | 0 |
| or_3 | 20 | 0.4475 | 0.1974 | 0.2435 | 0 |
| or_of_and | 20 | 0.4042 | 0.0640 | 0.3318 | 0 |
| fuzzy_1 | 24 | 0.1374 | 0.0538 | 0.0806 | 0 |
| semantic_v1 | 12 | 2358.9252 | 85.0642 | 1037.5192 | 0 |
| range_month_1 | 12 | 12.0141 | 2.8015 | 9.2074 | 0 |
| range_month_3 | 10 | 26.0500 | 6.7771 | 19.2571 | 0 |
| range_month_6 | 8 | 21.5215 | 8.2003 | 13.2903 | 0 |
| range_year_2 | 6 | 103.0774 | 35.0545 | 67.9969 | 0 |
| range_year_3 | 4 | 33.2590 | 30.7869 | 2.4334 | 0 |
| range_year_5 | 2 | 56.4804 | 52.0787 | 4.3496 | 0 |

## Table 2. SeaCQ-Aligned Conjunctive Comparison

| Query Type | PrivSearch Total ms | SeaCQ Total ms | PrivSearch Search ms | SeaCQ Search ms | PrivSearch Verify ms | SeaCQ Verify ms |
|---|---:|---:|---:|---:|---:|---:|
| and_10 | 0.7741 | 2364.5 | 0.0326 | 14.5 | 0.7223 | 2350.0 |
| and_2 | 0.2955 | 2315.5 | 0.0738 | 15.5 | 0.2142 | 2300.0 |
| and_4 | 0.4554 | 2265.0 | 0.0851 | 15.0 | 0.3600 | 2250.0 |
| and_6 | 0.5223 | 2265.0 | 0.0620 | 15.0 | 0.4436 | 2250.0 |
| and_8 | 0.5944 | 2314.5 | 0.0423 | 14.5 | 0.5291 | 2300.0 |

## Table 3. Healthcare Dataset Scope

| Source | Records |
|---|---:|
| eICU demo | 100582 |
| MedCD | 1999 |
| openFDA | 178461 |
| Total | 281042 |

## Table 4. Healthcare Global Metrics

| Metric | Value |
|---|---:|
| Workloads | 258 |
| Trials per workload | 10 |
| Weighted mean total latency (ms) | 38.9325 |
| Weighted mean search latency (ms) | 5.1857 |
| Weighted mean verify latency (ms) | 33.4175 |
| Weighted mean auth overhead (ms) | 33.7468 |
| Weighted auth share (%) | 73.98 |
| Verification failures | 0 |

## Table 5. Healthcare Query-Family Summary

| Query Type | Query Count | Mean Total ms | Mean Search ms | Mean Verify ms | Auth Share % |
|---|---:|---:|---:|---:|---:|
| and_2 | 24 | 61.6895 | 0.0116 | 61.6638 | 99.98 |
| and_4 | 12 | 153.1927 | 0.0081 | 153.1662 | 99.99 |
| fuzzy_1 | 12 | 1.2173 | 1.0176 | 0.1854 | 16.41 |
| or_2 | 24 | 0.8857 | 0.6503 | 0.2253 | 26.58 |
| or_3 | 12 | 1.8925 | 1.3752 | 0.4932 | 27.33 |
| or_of_and | 12 | 0.3275 | 0.0154 | 0.2906 | 95.30 |
| range_month_1 | 8 | 68.4591 | 13.2304 | 55.2145 | 80.67 |
| range_month_3 | 6 | 123.3925 | 24.2617 | 99.1105 | 80.34 |
| range_year_2 | 4 | 369.1905 | 72.4388 | 296.7246 | 80.38 |
| range_year_3 | 2 | 114.4895 | 25.6785 | 88.7712 | 77.57 |
| semantic_v1 | 12 | 10.5223 | 0.7681 | 2.9355 | 92.70 |
| single_keyword | 130 | 27.2553 | 5.3176 | 21.9284 | 80.49 |

## Table 6. Replay Protection

| Metric | Value |
|---|---:|
| Attempted | 200 |
| Accepted first requests | 200 |
| Replayed requests rejected | 200 |
| Replay rejection rate (%) | 100.00 |
| Mean replay rejection latency (ms) | 0.8019 |
| P95 replay rejection latency (ms) | 1.2123 |

## Table 7. WAN-Style Distributed Validation

| Profile | Nodes | Success Rate | Threshold Mean ms | Full Mean ms |
|---|---:|---:|---:|---:|
| LAN | 2 | 100.00% | 21.9329 | 12.7269 |
| LAN | 4 | 100.00% | 16.5832 | 14.0363 |
| LAN | 7 | 100.00% | 16.2922 | 17.2383 |
| LAN | 10 | 100.00% | 15.5405 | 17.8517 |
| Regional WAN | 2 | 100.00% | 43.4453 | 40.4810 |
| Regional WAN | 4 | 100.00% | 41.6740 | 46.9418 |
| Regional WAN | 7 | 100.00% | 41.5169 | 47.9945 |
| Regional WAN | 10 | 100.00% | 46.4090 | 48.5361 |
| Cross-Site WAN | 2 | 100.00% | 96.3508 | 92.8757 |
| Cross-Site WAN | 4 | 100.00% | 84.6314 | 102.3789 |
| Cross-Site WAN | 7 | 100.00% | 96.9753 | 109.7290 |
| Cross-Site WAN | 10 | 100.00% | 96.3039 | 129.2854 |
