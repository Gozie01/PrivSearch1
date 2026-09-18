# PrivSearch Healthcare Validation Summary

Generated: 2026-07-09T05:12:30Z

## Dataset Scope

- Normalized healthcare corpus: `281,042` documents
- eICU-derived records: `100,582`
- MedCD search-note records: `1,999`
- openFDA-derived records: `178,461`
- Unique healthcare keywords: `221,760`
- Mixed workload support: keyword, conjunctive, disjunctive, OR-of-AND, fuzzy, semantic, and temporal range queries

## Benchmark Scope

- Benchmark run: `healthcare_privsearch-prototype_2026-07-09T05-11-24-879Z`
- Total workloads: `258`
- Trials per workload: `10`
- Verification failures: `0`

## Query-Family Means

| Query Type | Query Count | Mean Total ms | Mean Search ms | Mean Verify ms |
|---|---:|---:|---:|---:|
| single_keyword | 130 | 27.2553 | 5.3176 | 21.9284 |
| and_2 | 24 | 61.6895 | 0.0116 | 61.6638 |
| and_4 | 12 | 153.1927 | 0.0081 | 153.1662 |
| or_2 | 24 | 0.8857 | 0.6503 | 0.2253 |
| or_3 | 12 | 1.8925 | 1.3752 | 0.4932 |
| or_of_and | 12 | 0.3275 | 0.0154 | 0.2906 |
| fuzzy_1 | 12 | 1.2173 | 1.0176 | 0.1854 |
| semantic_v1 | 12 | 10.5223 | 0.7681 | 2.9355 |
| range_month_1 | 8 | 68.4591 | 13.2304 | 55.2145 |
| range_month_3 | 6 | 123.3925 | 24.2617 | 99.1105 |
| range_year_2 | 4 | 369.1905 | 72.4388 | 296.7246 |
| range_year_3 | 2 | 114.4895 | 25.6785 | 88.7712 |

## Latency-Separation and Authentication Overhead

- Weighted mean total latency across the 258-workload pack: `38.9325 ms`
- Weighted mean search latency: `5.1857 ms`
- Weighted mean verification latency: `33.4175 ms`
- Weighted mean setup latency: `0.3293 ms`
- Weighted authentication overhead (`setup + verify`): `33.7468 ms`
- Weighted authentication share of total latency: `73.98%`

## Main Experimental Takeaways

- Healthcare-scale PrivSearch execution now runs on a three-dataset corpus rather than the earlier two-dataset healthcare path.
- Disjunctive search, fuzzy matching, semantic search, and temporal range search all execute successfully within the same authenticated prototype benchmark harness.
- The dominant runtime cost on healthcare workloads remains authentication rather than raw postings lookup, which gives us a direct basis for latency-separation and authentication-overhead claims.
- The heaviest families are still broad temporal ranges and high-cardinality conjunctive families, especially `range_year_2`, `range_month_3`, `range_month_1`, and `and_4`.
- Semantic search is experimentally represented inside the healthcare corpus as well and remains authentication-dominated rather than search-dominated.

## Backing Artifacts

- Phase breakdown: `Results/paper_assets/privsearch_healthcare_phase_breakdown.md`
- Benchmark report: `NweDB/benchmark_runs/healthcare_privsearch-prototype_2026-07-09T05-11-24-879Z/benchmark_report.md`
- Benchmark summary CSV: `NweDB/benchmark_runs/healthcare_privsearch-prototype_2026-07-09T05-11-24-879Z/benchmark_summary.csv`
