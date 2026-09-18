# EXP-8: MongoDB Index Overhead and Query Plan Analysis

Generated: 2026-05-29T10:02:02.081Z

## EXP-8.1: Index Maintenance Write Overhead

| N (docs) | With Indexes Mean (ms) | With Indexes Stddev | Without Indexes Mean (ms) | Without Indexes Stddev | Overhead (%) |
|---:|---:|---:|---:|---:|---:|
| 5000 | 0.5537 | 0.1003 | 0.5310 | 0.2139 | 4.28% |
| 20000 | 0.5293 | 0.1100 | 0.5047 | 0.1215 | 4.89% |
| 50000 | 0.5259 | 0.1471 | 0.5045 | 0.1161 | 4.23% |

> Overhead = (mean_with_indexes / mean_without_indexes − 1) × 100%

## EXP-8.2: MongoDB explain() — Query Execution Plans

| Query Type | Stage | Keys Examined | Docs Examined | Exec Time (ms) | N Returned |
|:---|:---|---:|---:|---:|---:|
| SKU | `IXSCAN` | 0 | 0 | 2 | 0 |
| Batch | `IXSCAN` | 0 | 0 | 0 | 0 |
| Facility | `IXSCAN` | 0 | 0 | 0 | 0 |
| Status | `IXSCAN` | 3405 | 3405 | 8 | 3405 |
| ActorType | `COLLSCAN` | 0 | 5994 | 3 | 0 |

> IXSCAN = index scan (efficient); COLLSCAN = collection scan (no index hit).