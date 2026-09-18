# PrivSearch Resource Overhead Results

Generated: 2026-07-16T08:47:55.993Z

Run ID: healthcare_privsearch-prototype_resource_2026-07-16T08-47-55-994Z

Dataset: healthcare

Engine: privsearch-prototype

Workloads benchmarked: 24

Trials per query: 3

## Global Deployment-Cost Summary

| Metric | Value |
|---|---:|
| Prepared posting sets | 878 |
| Indexed document references | 700962 |
| Raw postings bytes | 33527101 |
| Encrypted payload bytes | 67133222 |
| Encrypted index size bytes | 67442266 |
| Blockchain commitment bytes | 128895 |
| Storage overhead ratio | 2.0116x |

## Query-Family Resource Overhead

| Query Type | Count | CPU ms | RSS delta bytes | Heap delta bytes | Mean proof bytes | P95 proof bytes | Request bytes | Response bytes | Network bytes | Blockchain ref bytes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| and_2 | 2 | 2.5000 | 2731 | 1858972 | 400.00 | 400.00 | 193.00 | 487.50 | 680.50 | 288.50 |
| and_4 | 2 | 1101.6667 | 22189397 | 12610260 | 623.50 | 623.50 | 327.00 | 711.00 | 1038.00 | 512.00 |
| fuzzy_1 | 2 | 2.6667 | 0 | 118449 | 528.50 | 528.50 | 128.00 | 1306.50 | 1434.50 | 178.50 |
| or_2 | 2 | 0.0000 | 1365 | 314271 | 747.00 | 747.00 | 194.00 | 1065.00 | 1259.00 | 356.00 |
| or_3 | 2 | 0.0000 | 1365 | 403959 | 1190.00 | 1190.00 | 263.00 | 1823.00 | 2086.00 | 533.50 |
| or_of_and | 2 | 2.5000 | 683 | 536943 | 823.50 | 823.50 | 325.00 | 941.50 | 1266.50 | 579.00 |
| range_month_1 | 2 | 0.0000 | 0 | 33281 | 343.50 | 343.50 | 134.00 | 484.00 | 618.00 | 179.00 |
| range_month_3 | 2 | 0.0000 | 2048 | 488025 | 1335.00 | 1335.00 | 272.00 | 2610.00 | 2882.00 | 536.00 |
| range_year_2 | 2 | 2.6667 | 683 | -9473492 | 900.00 | 900.00 | 202.00 | 5583.50 | 5785.50 | 358.00 |
| range_year_3 | 2 | 2635.3333 | -17496747 | -11504315 | 1457.50 | 1457.50 | 271.00 | 1919092.50 | 1919363.50 | 541.50 |
| semantic_v1 | 2 | 44.1667 | -7498411 | 240012 | 421.00 | 421.00 | 930.50 | 650.50 | 1581.00 | 2341.00 |
| single_keyword | 2 | 2.6667 | 27989 | 410820 | 422.00 | 422.00 | 130.00 | 1187.00 | 1317.00 | 179.50 |

## Notes

- CPU and memory metrics are process-delta measurements around each prototype query run.
- Proof size, blockchain reference size, and network traffic are serialized-payload estimates derived from the runnable prototype proof objects.
- Encrypted index size and storage overhead are measured from the prepared PrivSearch prototype encrypted postings held by the benchmark engine.
