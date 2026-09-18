# PrivSearch Resource Overhead Results

Generated: 2026-09-10T15:46:28.279Z

Run ID: enron_privsearch-prototype_resource_2026-09-10T15-46-28-279Z

Dataset: enron

Engine: privsearch-prototype

Workloads benchmarked: 53

Trials per query: 1

## Global Deployment-Cost Summary

| Metric | Value |
|---|---:|
| Prepared posting sets | 102 |
| Indexed document references | 1279790 |
| Raw postings bytes | 37164996 |
| Encrypted payload bytes | 74339172 |
| Encrypted index size bytes | 74434355 |
| Blockchain commitment bytes | 74101 |
| Storage overhead ratio | 2.0028x |

## Query-Family Resource Overhead

| Query Type | Count | CPU ms | RSS delta bytes | Heap delta bytes | Mean proof bytes | P95 proof bytes | Request bytes | Response bytes | Network bytes | Blockchain ref bytes |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| and_10 | 3 | 15.6667 | 25941 | 3877587 | 7215.67 | 7215.67 | 730.00 | 7579.00 | 8309.00 | 6984.67 |
| and_2 | 3 | 0.0000 | 4096 | 749419 | 1664.67 | 1664.67 | 193.00 | 2017.33 | 2210.33 | 1452.67 |
| and_4 | 3 | 5.0000 | 1365 | 1584531 | 3060.67 | 3060.67 | 327.00 | 3422.00 | 3749.00 | 2835.33 |
| and_5 | 3 | 10.3333 | 0 | 2011635 | 3757.67 | 3757.67 | 394.00 | 4115.00 | 4509.00 | 3527.33 |
| and_6 | 3 | 5.3333 | 0 | 2391971 | 4442.33 | 4442.33 | 461.00 | 4794.33 | 5255.33 | 4217.67 |
| and_8 | 3 | 15.3333 | 0 | 3180755 | 5823.00 | 5823.00 | 595.00 | 6171.00 | 6766.00 | 5601.33 |
| fuzzy_1 | 3 | 0.0000 | 0 | 1644523 | 974.33 | 974.33 | 128.00 | 1437.00 | 1565.00 | 759.33 |
| or_2 | 3 | 41.6667 | 12288 | -12516709 | 1950.33 | 1950.33 | 194.00 | 2630.67 | 2824.67 | 1517.33 |
| or_3 | 3 | 141.0000 | 13653 | -1962296 | 2941.00 | 2941.00 | 263.00 | 6253.67 | 6516.67 | 2274.67 |
| or_of_and | 3 | 5833.0000 | 84651 | 4293421 | 3342.00 | 3342.00 | 325.00 | 4391.33 | 4716.33 | 2904.33 |
| range_month_1 | 3 | 1031.6667 | -9906859 | -10131264 | 966.00 | 966.00 | 134.00 | 19340.33 | 19474.33 | 760.67 |
| range_month_3 | 3 | 4051.6667 | 19115 | -4860789 | 2900.33 | 2900.33 | 272.00 | 85435.67 | 85707.67 | 2280.00 |
| range_month_6 | 3 | 21437.6667 | 1129131 | 3088184 | 5815.00 | 5815.00 | 479.00 | 515479.33 | 515958.33 | 4560.33 |
| range_year_2 | 3 | 106520.6667 | -84189184 | -63168669 | 1930.33 | 1930.33 | 202.00 | 2128705.67 | 2128907.67 | 1522.00 |
| range_year_3 | 3 | 140776.3333 | 55010645 | 41467955 | 2899.33 | 2899.33 | 271.00 | 6747013.00 | 6747284.00 | 2284.67 |
| range_year_5 | 2 | 27562.5000 | -10876928 | -23688452 | 4836.00 | 4836.00 | 409.00 | 14376656.50 | 14377065.50 | 3807.50 |
| semantic_v1 | 3 | 88432.0000 | 78667776 | 139154157 | 422.00 | 422.00 | 671.33 | 804.33 | 1475.67 | 6661.33 |
| single_keyword | 3 | 31.3333 | -487424 | -14227013 | 969.33 | 969.33 | 130.00 | 1553.00 | 1683.00 | 759.67 |

## Notes

- CPU and memory metrics are process-delta measurements around each prototype query run.
- Proof size, blockchain reference size, and network traffic are serialized-payload estimates derived from the runnable prototype proof objects.
- Encrypted index size and storage overhead are measured from the prepared PrivSearch prototype encrypted postings held by the benchmark engine.
