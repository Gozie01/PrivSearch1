# PrivSearch healthcare Phase Breakdown

Generated: 2026-07-16T08:38:33.474Z

Run ID: healthcare_privsearch-prototype_2026-07-15T05-48-51-545Z

Workloads benchmarked: 258

Trials per workload: 100

## Global Summary

| Metric | Value |
|---|---:|
| Weighted mean setup ms | 0.0351 |
| Weighted mean search ms | 0.6583 |
| Weighted mean verify ms | 2.6937 |
| Weighted mean total ms | 3.3871 |
| Weighted auth-overhead ms | 2.7288 |
| Weighted search share % | 28.24 |
| Weighted verify share % | 69.88 |
| Weighted auth share % | 71.76 |
| Total verification failures | 0 |

## Query-Family Breakdown

| Query Type | Count | Setup ms | Search ms | Verify ms | Total ms | Auth Overhead ms | Search Share % | Verify Share % | Auth Share % | Failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| and_2 | 24 | 0.0052 | 0.0030 | 4.7105 | 4.7188 | 4.7158 | 0.06 | 99.83 | 99.94 | 0 |
| and_4 | 12 | 0.0087 | 0.0029 | 12.2038 | 12.2154 | 12.2124 | 0.02 | 99.91 | 99.98 | 0 |
| fuzzy_1 | 12 | 0.0072 | 0.7236 | 0.1395 | 0.8703 | 0.1467 | 83.14 | 16.03 | 16.86 | 0 |
| or_2 | 24 | 0.0085 | 0.6780 | 0.2077 | 0.8942 | 0.2162 | 75.82 | 23.23 | 24.18 | 0 |
| or_3 | 12 | 0.0128 | 1.2027 | 0.3470 | 1.5625 | 0.3598 | 76.97 | 22.21 | 23.03 | 0 |
| or_of_and | 12 | 0.0094 | 0.0057 | 0.1662 | 0.1812 | 0.1755 | 3.12 | 91.71 | 96.88 | 0 |
| range_month_1 | 8 | 0.0091 | 1.5087 | 4.6890 | 6.2069 | 4.6981 | 24.31 | 75.55 | 75.69 | 0 |
| range_month_3 | 6 | 0.0123 | 2.3448 | 7.6908 | 10.0479 | 7.7031 | 23.34 | 76.54 | 76.66 | 0 |
| range_year_2 | 4 | 0.0176 | 6.7425 | 21.5143 | 28.2744 | 21.5319 | 23.85 | 76.09 | 76.15 | 0 |
| range_year_3 | 2 | 0.0296 | 5.7627 | 6.8686 | 12.6609 | 6.8982 | 45.52 | 54.25 | 54.48 | 0 |
| semantic_v1 | 12 | 0.6122 | 0.6402 | 0.8687 | 2.1211 | 1.4809 | 30.18 | 40.95 | 69.82 | 0 |
| single_keyword | 130 | 0.0049 | 0.4458 | 1.7599 | 2.2107 | 1.7648 | 20.17 | 79.61 | 79.83 | 0 |

## Notes

- Authentication overhead is defined here as setup plus verification: trapdoor derivation / encrypted-postings preparation plus proof checking.
- Auth-dominant families in this run: and_4 (99.98%), and_2 (99.94%), or_of_and (96.88%), single_keyword (79.83%), range_month_3 (76.66%), range_year_2 (76.15%), range_month_1 (75.69%), semantic_v1 (69.82%), range_year_3 (54.48%).
- This artifact is intended to support encrypted latency-separation and authentication-overhead discussion directly from the executable benchmark outputs.