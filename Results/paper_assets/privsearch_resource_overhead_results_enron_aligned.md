# PrivSearch Resource Overhead Results

Generated: 2026-07-16T08:49:37.171Z

Run ID: enron_privsearch-prototype_resource_2026-07-16T08-49-37-171Z

Dataset: enron

Engine: privsearch-prototype

Workloads benchmarked: 53

Trials per query: 3

## Global Deployment-Cost Summary

| Metric | Value |
|---|---:|
| Prepared posting sets | 103 |
| Indexed document references | 1259254 |
| Raw postings bytes | 36571654 |
| Encrypted payload bytes | 73152578 |
| Encrypted index size bytes | 73188975 |
| Blockchain commitment bytes | 15118 |
| Storage overhead ratio | 2.0012x |

## Query-Family Resource Overhead

| Query Type | Count | CPU ms | RSS delta bytes | Heap delta bytes | Mean proof bytes | P95 proof bytes | Request bytes | Response bytes | Network bytes | Blockchain ref bytes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| and_10 | 3 | 230.8889 | 328135 | -5078697 | 1299.33 | 1299.33 | 730.00 | 1386.33 | 2116.33 | 1188.33 |
| and_2 | 3 | 38.2222 | -13198 | 4280022 | 391.00 | 391.00 | 193.00 | 465.67 | 658.67 | 292.33 |
| and_4 | 3 | 307.2222 | 934798 | 1483576 | 638.67 | 638.67 | 327.00 | 736.00 | 1063.00 | 517.33 |
| and_5 | 3 | 257.0000 | 345429 | -705357 | 742.00 | 742.00 | 394.00 | 830.67 | 1224.67 | 629.33 |
| and_6 | 3 | 260.3333 | 137899 | -5260819 | 853.33 | 853.33 | 461.00 | 942.33 | 1403.33 | 740.33 |
| and_8 | 3 | 260.4444 | 256228 | 6805709 | 1066.00 | 1066.00 | 595.00 | 1140.67 | 1735.67 | 967.33 |
| fuzzy_1 | 3 | 1.6667 | 0 | 118571 | 394.67 | 394.67 | 128.00 | 857.33 | 985.33 | 179.67 |
| or_2 | 3 | 1.7778 | 9102 | 546814 | 790.00 | 790.00 | 194.00 | 1470.33 | 1664.33 | 357.00 |
| or_3 | 3 | 1.7778 | 1365 | 2250755 | 1202.67 | 1202.67 | 263.00 | 4515.33 | 4778.33 | 536.33 |
| or_of_and | 3 | 119.7778 | 67356 | -141465 | 881.67 | 881.67 | 325.00 | 1133.33 | 1458.33 | 584.33 |
| range_month_1 | 3 | 22.5556 | -4218880 | 3030301 | 386.33 | 386.33 | 134.00 | 18760.67 | 18894.67 | 181.00 |
| range_month_3 | 3 | 83.3333 | 50517 | -1935514 | 1162.00 | 1162.00 | 272.00 | 83697.33 | 83969.33 | 541.67 |
| range_month_6 | 3 | 444.4444 | 1086350 | -636958 | 2338.00 | 2338.00 | 479.00 | 512002.33 | 512481.33 | 1083.33 |
| range_year_2 | 3 | 2178.7778 | -22801067 | -21724029 | 770.67 | 770.67 | 202.00 | 2127546.00 | 2127748.00 | 362.33 |
| range_year_3 | 3 | 2802.0000 | 17639652 | 15211153 | 1159.33 | 1159.33 | 271.00 | 6745273.00 | 6745544.00 | 544.67 |
| range_year_5 | 2 | 591.0000 | -729088 | -1384720 | 1937.00 | 1937.00 | 409.00 | 14373757.50 | 14374166.50 | 908.50 |
| semantic_v1 | 3 | 2336.8889 | 67350073 | 46775119 | 422.00 | 422.00 | 671.33 | 804.33 | 1475.67 | 1637.00 |
| single_keyword | 3 | 1.7778 | 15474 | 437994 | 389.00 | 389.00 | 130.00 | 972.67 | 1102.67 | 179.33 |

## Notes

- CPU and memory metrics are process-delta measurements around each prototype query run.
- Proof size, blockchain reference size, and network traffic are serialized-payload estimates derived from the runnable prototype proof objects.
- Encrypted index size and storage overhead are measured from the prepared PrivSearch prototype encrypted postings held by the benchmark engine.
