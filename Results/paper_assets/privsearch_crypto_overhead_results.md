# PrivSearch Cryptographic Overhead Results

Generated: 2026-07-16T08:46:52.618Z

Run ID: enron_privsearch-prototype_2026-07-15T07-12-46-002Z

Dataset: enron

Workloads benchmarked: 448

Trials per workload: 100

## Global Summary

| Metric | Value |
|---|---:|
| Weighted mean total ms | 13.9524 |
| Weighted mean query normalization ms | 0.0007 |
| Weighted mean trapdoor generation ms | 0.0092 |
| Weighted mean encrypted postings retrieval ms | 1.1685 |
| Weighted mean proof construction ms | 0.0011 |
| Weighted mean proof verification ms | 9.7850 |
| Weighted mean blockchain verification ms | 0.0000 |
| Weighted mean crypto total ms | 10.9645 |
| Weighted crypto share % | 87.86 |

## Query-Family Breakdown

| Query Type | Count | Total ms | Trapdoor ms | Encrypted retrieval ms | Proof construction ms | Proof verification ms | Blockchain verification ms | Crypto total ms | Crypto share % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| and_10 | 20 | 22.1457 | 0.0187 | 0.0018 | 0.0018 | 22.0998 | 0.0000 | 22.1223 | 99.89 |
| and_2 | 40 | 4.7145 | 0.0053 | 0.0004 | 0.0007 | 4.6860 | 0.0000 | 4.6927 | 99.54 |
| and_4 | 20 | 16.7982 | 0.0087 | 0.0007 | 0.0011 | 16.7582 | 0.0000 | 16.7689 | 99.83 |
| and_5 | 20 | 15.8325 | 0.0097 | 0.0008 | 0.0010 | 15.7977 | 0.0000 | 15.8093 | 99.85 |
| and_6 | 20 | 19.8517 | 0.0115 | 0.0009 | 0.0012 | 19.8120 | 0.0000 | 19.8258 | 99.87 |
| and_8 | 20 | 19.3392 | 0.0149 | 0.0012 | 0.0015 | 19.2927 | 0.0000 | 19.3106 | 99.85 |
| fuzzy_1 | 24 | 0.1268 | 0.0027 | 0.0002 | 0.0003 | 0.0776 | 0.0000 | 0.0814 | 64.16 |
| or_2 | 40 | 0.3116 | 0.0055 | 0.0005 | 0.0009 | 0.1609 | 0.0000 | 0.1681 | 53.96 |
| or_3 | 20 | 0.5075 | 0.0087 | 0.0009 | 0.0012 | 0.2524 | 0.0000 | 0.2638 | 51.98 |
| or_of_and | 20 | 0.4140 | 0.0089 | 0.0008 | 0.0014 | 0.3372 | 0.0000 | 0.3487 | 84.22 |
| range_month_1 | 12 | 12.1442 | 0.0082 | 2.2531 | 0.0010 | 9.2328 | 0.0000 | 11.4969 | 94.67 |
| range_month_3 | 10 | 25.8181 | 0.0197 | 4.5912 | 0.0024 | 19.2910 | 0.0000 | 23.9078 | 92.60 |
| range_month_6 | 8 | 20.6197 | 0.0309 | 3.1495 | 0.0043 | 13.0389 | 0.0000 | 16.2288 | 78.71 |
| range_year_2 | 6 | 104.7179 | 0.0219 | 17.0162 | 0.0035 | 68.4713 | 0.0000 | 85.5191 | 81.67 |
| range_year_3 | 4 | 38.1694 | 0.0323 | 0.0034 | 0.0051 | 3.3602 | 0.0000 | 3.4099 | 8.93 |
| range_year_5 | 2 | 65.7020 | 0.0435 | 0.0053 | 0.0075 | 5.0340 | 0.0000 | 5.1018 | 7.77 |
| semantic_v1 | 12 | 204.6701 | 0.0452 | 23.6185 | 0.0020 | 107.3139 | 0.0000 | 130.9818 | 64.00 |
| single_keyword | 150 | 1.4101 | 0.0037 | 0.2641 | 0.0005 | 1.1389 | 0.0000 | 1.4074 | 99.81 |

## Notes

- Query normalization is reported separately for completeness, but the main cryptographic path is trapdoor generation -> encrypted retrieval -> proof construction -> proof verification -> blockchain verification.
- Inline blockchain verification remains zero in the current prototype because validator-side commitment checking is still benchmarked separately.
- External blockchain verification reference: `Results/paper_assets/distributed_validation_wan.csv`.