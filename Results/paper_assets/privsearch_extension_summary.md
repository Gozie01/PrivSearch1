# PrivSearch Extension Summary

Generated: 2026-07-08T08:50:21.107Z

PrivSearch run: enron_privsearch-prototype_2026-07-08T07-52-50-269Z

Semantic v1 run: enron_privsearch-prototype_2026-07-08T08-47-42-701Z

SeaCQ-aligned run: seacq_comparison_privsearch-prototype_2026-07-08T05-34-54-786Z

Workloads benchmarked: 436

Trials per workload: 100

## Query-Family Results

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

## Replay Protection

| Metric | Value |
|---|---:|
| Attempted | 200 |
| Accepted first requests | 200 |
| Replayed requests rejected | 200 |
| Replay rejection rate | 100.00% |
| Mean replay rejection latency (ms) | 0.8019 |
| P95 replay rejection latency (ms) | 1.2123 |

## SeaCQ Comparison

| Query Type | PrivSearch Total ms | SeaCQ Total ms | PrivSearch Search ms | SeaCQ Search ms | PrivSearch Verify ms | SeaCQ Verify ms |
|---|---:|---:|---:|---:|---:|---:|
| and_10 | 0.7741 | 2364.5 | 0.0326 | 14.5 | 0.7223 | 2350.0 |
| and_2 | 0.2955 | 2315.5 | 0.0738 | 15.5 | 0.2142 | 2300.0 |
| and_4 | 0.4554 | 2265.0 | 0.0851 | 15.0 | 0.3600 | 2250.0 |
| and_6 | 0.5223 | 2265.0 | 0.0620 | 15.0 | 0.4436 | 2250.0 |
| and_8 | 0.5944 | 2314.5 | 0.0423 | 14.5 | 0.5291 | 2300.0 |

## WAN Distributed Validation

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

## Notes

- Month-level range workloads strengthen the temporal-range experiment by covering fine-grained windows inside the dense 1999-2002 interval.
- Year-range workloads remain useful for large-result stress cases.
- Semantic v1 currently uses authenticated concept-expanded retrieval rather than embeddings or neural encoders.
- The consolidated summary uses the largest full PrivSearch workload run plus the latest semantic_v1 run so semantic evidence is not lost when run separately.
- Replay-prevention evidence now reflects live API-layer freshness enforcement rather than paper-only design intent.