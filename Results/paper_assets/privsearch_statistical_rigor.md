# PrivSearch Statistical Rigor Summary

Generated: 2026-07-15T07:12:55.582Z

Descriptive statistics are computed over workload-level benchmark instances from stored runs. Significance testing uses workload-level mean total latency to avoid treating repeated trials from the same workload as fully independent. Where raw per-trial samples are available, the summary also reports workload-level bootstrap confidence intervals and hierarchical bootstrap confidence intervals.

## Enron Descriptive Statistics

Run ID: enron_privsearch-prototype_2026-07-15T07-12-46-002Z

Workloads benchmarked: 448

Trials per query: 100

| Query Type | N | Mean Total ms | Median Total ms | Std Dev ms | 95% CI ms | Bootstrap 95% CI ms | IQR ms | P95 ms | P99 ms | Mean Search ms | Mean Verify ms |
|---|---:|---:|---:|---:|---|---|---|---:|---:|---:|---:|
| and_10 | 20 | 22.1457 | 21.6835 | 14.8845 | [15.6223, 28.6691] | [15.8233, 28.6779] | [9.9906, 32.3534] (IQR 22.3628) | 44.9714 | 44.9714 | 0.0265 | 22.1002 |
| and_2 | 40 | 4.7145 | 3.3199 | 4.0951 | [3.4454, 5.9836] | [3.4990, 6.0706] | [2.1690, 5.8867] (IQR 3.7177) | 12.1055 | 12.7770 | 0.0224 | 4.6863 |
| and_4 | 20 | 16.7982 | 16.2708 | 9.4356 | [12.6629, 20.9336] | [12.7543, 20.9424] | [7.6129, 21.3624] (IQR 13.7495) | 27.8102 | 27.8102 | 0.0306 | 16.7585 |
| and_5 | 20 | 15.8325 | 16.6137 | 7.8983 | [12.3709, 19.2941] | [12.4362, 19.0884] | [8.3452, 21.7736] (IQR 13.4284) | 24.0482 | 24.0482 | 0.0245 | 15.7980 |
| and_6 | 20 | 19.8517 | 21.7056 | 9.5126 | [15.6826, 24.0208] | [15.7621, 23.7382] | [15.8238, 24.0259] (IQR 8.2021) | 31.8607 | 31.8607 | 0.0276 | 19.8123 |
| and_8 | 20 | 19.3392 | 20.6236 | 11.8901 | [14.1281, 24.5502] | [14.1932, 24.3650] | [8.3831, 29.0169] (IQR 20.6339) | 36.4369 | 36.4369 | 0.0308 | 19.2930 |
| fuzzy_1 | 24 | 0.1268 | 0.0841 | 0.1336 | [0.0734, 0.1803] | [0.0885, 0.1870] | [0.0790, 0.1045] (IQR 0.0255) | 0.1642 | 0.2948 | 0.0457 | 0.0779 |
| or_2 | 40 | 0.3116 | 0.1932 | 0.3042 | [0.2173, 0.4059] | [0.2323, 0.4126] | [0.1695, 0.2954] (IQR 0.1259) | 0.6872 | 0.8136 | 0.1441 | 0.1613 |
| or_3 | 20 | 0.5075 | 0.3251 | 0.4591 | [0.3063, 0.7087] | [0.3464, 0.7311] | [0.2669, 0.4629] (IQR 0.1960) | 1.3114 | 1.3114 | 0.2450 | 0.2530 |
| or_of_and | 20 | 0.4140 | 0.3939 | 0.1771 | [0.3364, 0.4917] | [0.3488, 0.4991] | [0.3273, 0.4378] (IQR 0.1105) | 0.5526 | 0.5526 | 0.0668 | 0.3376 |
| range_month_1 | 12 | 12.1442 | 3.6716 | 13.4167 | [4.5530, 19.7354] | [5.2800, 19.6473] | [0.7345, 20.0609] (IQR 19.3264) | 31.3515 | 31.3515 | 2.9006 | 9.2331 |
| range_month_3 | 10 | 25.8181 | 16.2927 | 24.2048 | [10.8158, 40.8204] | [11.5839, 39.5733] | [2.0918, 34.5751] (IQR 32.4833) | 58.0953 | 58.0953 | 6.5023 | 19.2917 |
| range_month_6 | 8 | 20.6197 | 19.1329 | 20.9276 | [6.1177, 35.1218] | [8.2805, 34.9713] | [1.7856, 20.0540] (IQR 18.2684) | 42.1205 | 42.1205 | 7.5428 | 13.0401 |
| range_year_2 | 6 | 104.7179 | 11.3626 | 137.7135 | [-5.4759, 214.9117] | [14.1613, 213.8358] | [0.7559, 72.6766] (IQR 71.9207) | 209.8671 | 209.8671 | 36.2163 | 68.4724 |
| range_year_3 | 4 | 38.1694 | 21.8706 | 32.1038 | [6.7077, 69.6312] | [11.3799, 64.9590] | [0.8892, 64.2102] (IQR 63.3210) | 64.2102 | 64.2102 | 34.7648 | 3.3616 |
| range_year_5 | 2 | 65.7020 | 62.7942 | 4.1122 | [60.0027, 71.4012] | [62.7942, 68.6097] | [62.7942, 62.7942] (IQR 0.0000) | 62.7942 | 62.7942 | 60.6090 | 5.0362 |
| semantic_v1 | 12 | 204.6701 | 160.7856 | 117.1436 | [138.3899, 270.9504] | [151.1972, 275.4554] | [134.1417, 247.9617] (IQR 113.8200) | 310.7656 | 310.7656 | 73.6869 | 107.3167 |
| single_keyword | 150 | 1.4101 | 0.2523 | 2.4847 | [1.0124, 1.8077] | [1.0462, 1.8188] | [0.1162, 1.5051] (IQR 1.3889) | 5.9030 | 12.2071 | 0.2666 | 1.1392 |

Raw-trial availability:

| Query Type | Raw Trial Samples Available | Pooled Trial Count | Hierarchical Bootstrap 95% CI ms |
|---|---|---:|---|
| and_10 | yes | 2000 | [10.9889, 36.2293] |
| and_2 | yes | 4000 | [2.7490, 7.0951] |
| and_4 | yes | 2000 | [8.7234, 26.6927] |
| and_5 | yes | 2000 | [8.4709, 24.6472] |
| and_6 | yes | 2000 | [10.8001, 30.7651] |
| and_8 | yes | 2000 | [9.5935, 31.3960] |
| fuzzy_1 | yes | 2400 | [0.0883, 0.1867] |
| or_2 | yes | 4000 | [0.2341, 0.4165] |
| or_3 | yes | 2000 | [0.3383, 0.7271] |
| or_of_and | yes | 2000 | [0.3472, 0.4973] |
| range_month_1 | yes | 1200 | [2.8751, 25.9661] |
| range_month_3 | yes | 1000 | [6.3211, 52.6612] |
| range_month_6 | yes | 800 | [5.2734, 45.2053] |
| range_year_2 | yes | 600 | [7.4834, 283.8758] |
| range_year_3 | yes | 400 | [11.1656, 65.1486] |
| range_year_5 | yes | 200 | [61.6713, 70.0535] |
| semantic_v1 | yes | 1200 | [143.5350, 283.4641] |
| single_keyword | yes | 15000 | [0.8926, 2.0679] |

## Healthcare Descriptive Statistics

Run ID: healthcare_privsearch-prototype_2026-07-15T05-48-51-545Z

Workloads benchmarked: 258

Trials per query: 100

| Query Type | N | Mean Total ms | Median Total ms | Std Dev ms | 95% CI ms | Bootstrap 95% CI ms | IQR ms | P95 ms | P99 ms | Mean Search ms | Mean Verify ms |
|---|---:|---:|---:|---:|---|---|---|---:|---:|---:|---:|
| and_2 | 24 | 4.7188 | 0.2987 | 19.5458 | [-3.1012, 12.5387] | [0.4234, 12.9555] | [0.0486, 0.8097] (IQR 0.7612) | 3.3641 | 4.2110 | 0.0030 | 4.7105 |
| and_4 | 12 | 12.2154 | 0.3179 | 30.8369 | [-5.2322, 29.6630] | [0.9915, 31.1871] | [0.1387, 3.2481] (IQR 3.1094) | 20.2936 | 20.2936 | 0.0029 | 12.2038 |
| fuzzy_1 | 12 | 0.8703 | 0.0978 | 2.5836 | [-0.5915, 2.3321] | [0.0968, 2.3784] | [0.0811, 0.1340] (IQR 0.0529) | 0.3332 | 0.3332 | 0.7236 | 0.1395 |
| or_2 | 24 | 0.8942 | 0.1932 | 3.2019 | [-0.3868, 2.1752] | [0.2031, 2.2210] | [0.1644, 0.2744] (IQR 0.1100) | 0.4472 | 0.7959 | 0.6780 | 0.2077 |
| or_3 | 12 | 1.5625 | 0.3068 | 4.1350 | [-0.7771, 3.9020] | [0.3153, 3.9867] | [0.2706, 0.4326] (IQR 0.1621) | 0.7727 | 0.7727 | 1.2027 | 0.3470 |
| or_of_and | 12 | 0.1812 | 0.1733 | 0.0920 | [0.1291, 0.2332] | [0.1348, 0.2341] | [0.1034, 0.2066] (IQR 0.1032) | 0.3173 | 0.3173 | 0.0057 | 0.1662 |
| range_month_1 | 8 | 6.2069 | 0.1444 | 16.8194 | [-5.4484, 17.8621] | [0.1146, 18.1641] | [0.0528, 0.3234] (IQR 0.2706) | 0.9915 | 0.9915 | 1.5087 | 4.6890 |
| range_month_3 | 6 | 10.0479 | 0.3704 | 22.8635 | [-8.2467, 28.3425] | [0.2758, 28.8349] | [0.2773, 0.5819] (IQR 0.3045) | 2.2952 | 2.2952 | 2.3448 | 7.6908 |
| range_year_2 | 4 | 28.2744 | 0.3358 | 55.1585 | [-25.7809, 82.3297] | [0.1987, 83.3378] | [0.0616, 1.6951] (IQR 1.6335) | 1.6951 | 1.6951 | 6.7425 | 21.5143 |
| range_year_3 | 2 | 12.6609 | 0.2809 | 17.5080 | [-11.6039, 36.9257] | [0.2809, 25.0409] | [0.2809, 0.2809] (IQR 0.0000) | 0.2809 | 0.2809 | 5.7627 | 6.8686 |
| semantic_v1 | 12 | 2.1211 | 2.1899 | 1.4354 | [1.3090, 2.9333] | [1.3972, 2.9228] | [0.7644, 2.4540] (IQR 1.6896) | 3.5360 | 3.5360 | 0.6402 | 0.8687 |
| single_keyword | 130 | 2.2107 | 0.2185 | 11.3737 | [0.2555, 4.1658] | [0.8840, 4.4540] | [0.1179, 1.2293] (IQR 1.1114) | 5.5981 | 13.9662 | 0.4458 | 1.7599 |

Raw-trial availability:

| Query Type | Raw Trial Samples Available | Pooled Trial Count | Hierarchical Bootstrap 95% CI ms |
|---|---|---:|---|
| and_2 | yes | 2400 | [0.2720, 20.4713] |
| and_4 | yes | 1200 | [0.2380, 45.3389] |
| fuzzy_1 | yes | 1200 | [0.0977, 2.4084] |
| or_2 | yes | 2400 | [0.2026, 2.2351] |
| or_3 | yes | 1200 | [0.3106, 4.0009] |
| or_of_and | yes | 1200 | [0.1341, 0.2333] |
| range_month_1 | yes | 800 | [0.0984, 24.2171] |
| range_month_3 | yes | 600 | [0.2333, 37.8939] |
| range_year_2 | yes | 400 | [0.1310, 109.0775] |
| range_year_3 | yes | 200 | [0.2537, 40.9909] |
| semantic_v1 | yes | 1200 | [1.2709, 3.2234] |
| single_keyword | yes | 13000 | [0.7376, 5.7427] |

## Significance Comparisons

| Left | Right | Sample Sizes | Mean Diff ms | p-value | Cliff's delta | Effect | Significant at 0.05? | Note |
|---|---|---:|---:|---:|---:|---|---|---|
| enron:single_keyword | enron:and_2 | 150/40 | -3.3044 | 0.000200 | -0.6880 | large | yes | single_keyword vs and_2 within Enron |
| enron:and_2 | enron:or_2 | 40/40 | 4.4029 | 0.000200 | 0.9350 | large | yes | and_2 vs or_2 within Enron |
| enron:or_2 | enron:fuzzy_1 | 40/24 | 0.1848 | 0.002599 | 0.8479 | large | yes | or_2 vs fuzzy_1 within Enron |
| healthcare:single_keyword | healthcare:and_2 | 130/24 | -2.5081 | 0.301140 | 0.1506 | small | no | single_keyword vs and_2 within healthcare |
| healthcare:and_2 | healthcare:or_2 | 24/24 | 3.8245 | 0.494101 | 0.0069 | negligible | no | and_2 vs or_2 within healthcare |
| healthcare:range_month_1 | healthcare:range_year_2 | 8/4 | -22.0675 | 0.124575 | -0.4375 | medium | no | range_month_1 vs range_year_2 within healthcare |
| healthcare:semantic_v1 | healthcare:fuzzy_1 | 12/12 | 1.2508 | 0.159968 | 0.8194 | large | no | semantic_v1 vs fuzzy_1 within healthcare |
| enron:single_keyword | healthcare:single_keyword | 150/130 | -0.8006 | 0.609678 | 0.0432 | negligible | no | single_keyword across datasets |
| enron:and_2 | healthcare:and_2 | 40/24 | -0.0043 | 0.999800 | 0.7188 | large | no | and_2 across datasets |
| enron:or_2 | healthcare:or_2 | 40/24 | -0.5826 | 0.313537 | 0.0667 | negligible | no | or_2 across datasets |
| enron:fuzzy_1 | healthcare:fuzzy_1 | 24/12 | -0.7434 | 0.136173 | -0.3264 | small | no | fuzzy_1 across datasets |

## Notes

- Significance testing here is based on workload-level mean total latency samples extracted from stored benchmark runs.
- Bootstrap confidence intervals are included because latency distributions are often right-skewed and mean-based normal intervals can become misleading for sparse or noisy families.
- Where raw per-trial samples are available, the report now includes hierarchical bootstrap confidence intervals that resample workloads and trials without treating repeated trials from the same workload as fully independent.
- Very small workload-family counts should still be interpreted cautiously even when bootstrap intervals are reported.
