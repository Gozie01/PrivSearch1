# PrivSearch Statistical Reporting Plan

This file defines the stronger statistical-reporting standard for the PrivSearch paper and now also records the implemented statistical-rigor artifacts generated from the current PrivSearch benchmark runs.

## 0. Implementation Status

The statistical-rigor generator has been implemented.

Primary generated artifacts:

- [privsearch_statistical_rigor.md](/C:/Users/Gozie/Desktop/Search Functionality in Blockchain/lifedb ICMIC/Results/paper_assets/privsearch_statistical_rigor.md)
- [privsearch_statistical_rigor.json](/C:/Users/Gozie/Desktop/Search Functionality in Blockchain/lifedb ICMIC/Results/paper_assets/privsearch_statistical_rigor.json)
- [privsearch_statistical_rigor_descriptive.csv](/C:/Users/Gozie/Desktop/Search Functionality in Blockchain/lifedb ICMIC/Results/paper_assets/privsearch_statistical_rigor_descriptive.csv)
- [privsearch_statistical_rigor_significance.csv](/C:/Users/Gozie/Desktop/Search Functionality in Blockchain/lifedb ICMIC/Results/paper_assets/privsearch_statistical_rigor_significance.csv)
- [generate-privsearch-statistical-rigor.js](/C:/Users/Gozie/Desktop/Search Functionality in Blockchain/lifedb ICMIC/scripts/generate-privsearch-statistical-rigor.js)

Run command:

`npm run privsearch:analyze:stats`

Current methodological note:

- descriptive statistics are computed over workload-level benchmark instances from stored runs
- significance testing currently uses workload-level mean total latency samples
- this is because the historical full benchmark archives do not retain every raw per-trial latency sample

So this standard is now partially operational with real numbers, while still leaving room for an even stronger future version if all future runs persist full raw trial arrays.

## 1. Recommended Reporting Standard

For every benchmarked metric, report:

| Required Statistic | Why It Matters |
|---|---|
| mean | standard central tendency summary |
| median | robust central tendency for skewed latency distributions |
| standard deviation | spread / variability |
| 95% confidence interval | uncertainty around the sample mean |
| P95 | tail latency under realistic load |
| P99 | extreme tail behavior |
| statistical significance | whether observed differences are likely real rather than noise |

For top-journal quality, this should be the default rather than an optional extra.

## 2. Why Means Alone Are Not Enough

Latency data are often non-normal and right-skewed. A mean can hide:

- long-tail delays
- burst-induced outliers
- unstable verification behavior
- differences that are not statistically reliable

That is especially important for PrivSearch because:

- range workloads can have broad result sets
- authentication-heavy families can produce long verification tails
- WAN and distributed-validation runs can exhibit network-driven variance
- concurrency benchmarks can show saturation behavior that a mean alone will hide

## 3. Minimum Table Format for Every Benchmark

Every benchmark summary table should use a structure like this:

| Benchmark | Query Family / Condition | N | Mean | Median | Std Dev | 95% CI | P95 | P99 | Min | Max | Failures |
|---|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|
| PrivSearch workload | and_2 |  |  |  |  |  |  |  |  |  |  |
| PrivSearch workload | or_2 |  |  |  |  |  |  |  |  |  |  |
| PrivSearch workload | range_year_2 |  |  |  |  |  |  |  |  |  |  |

This same structure should be reused for:

- query-family benchmarks
- healthcare benchmarks
- replay-protection benchmarks
- distributed-validation benchmarks
- scalability curves
- ablation studies
- cryptographic-overhead decomposition

## 4. Statistical Significance: What to Test

Statistical significance should be reported whenever two or more comparable conditions are being contrasted.

### 4.1 Recommended comparisons

| Comparison | Significance Question |
|---|---|
| PureSearch vs PrivSearch | does the extension add significant overhead or improvement? |
| OR-2 vs AND-2 | does disjunctive support materially change cost? |
| range_month_1 vs range_year_2 | does larger interval breadth significantly increase cost? |
| 2 nodes vs 10 nodes | does validator scaling significantly change latency? |
| LAN vs regional vs WAN | are network-profile differences statistically significant? |
| concurrency 10 vs 100 | does user-pressure significantly change service behavior? |

### 4.2 Recommended tests

Use the test that matches the data shape and experimental design.

| Situation | Recommended Test |
|---|---|
| two independent groups, approximately normal | Welch's t-test |
| two independent groups, non-normal / skewed | Mann-Whitney U test |
| paired repeated conditions on same workload set | paired t-test if normal, Wilcoxon signed-rank if non-normal |
| more than two groups, approximately normal | one-way ANOVA |
| more than two groups, non-normal | Kruskal-Wallis |

For most latency benchmarks in this project, a non-parametric fallback is the safer choice unless normality checks support parametric testing.

## 5. Effect Size Should Accompany Significance

P-values alone are not enough. A result can be statistically significant but practically trivial.

So wherever significance is reported, also include:

| Test Family | Recommended Effect Size |
|---|---|
| t-test / ANOVA | Cohen's d or eta-squared |
| Mann-Whitney / Wilcoxon | rank-biserial correlation or Cliff's delta |
| Kruskal-Wallis | epsilon-squared |

This is important for the paper because we care about practical systems impact, not only statistical detectability.

## 6. Normality and Distribution Reporting

Before choosing mean-centered significance tests, assess whether the distribution is close to normal.

Recommended checks:

| Check | Purpose |
|---|---|
| skewness | identifies right-tail behavior |
| kurtosis | identifies heavy-tail behavior |
| normality test | supports mean-vs-median justification |

The repository already contains a useful local precedent:

- [compute-statistical-rigor.js](</C:/Users/Gozie/Desktop/Search Functionality in Blockchain/lifedb ICMIC/scripts/compute-statistical-rigor.js>)

That script already computes:

- mean
- standard deviation
- 95% confidence interval
- P50
- P95
- P99
- skewness
- kurtosis
- omnibus normality test

So the project already has the foundation for stronger PrivSearch reporting.

## 7. Recommended Per-Benchmark Output Schema

Every benchmark CSV should ideally include these columns:

| Column | Meaning |
|---|---|
| `metric` | measured quantity |
| `condition` | query family / workload / node count / profile |
| `n` | sample count |
| `mean` | arithmetic mean |
| `median` | empirical median |
| `stddev` | sample standard deviation |
| `ci95_lo` | lower 95% confidence bound |
| `ci95_hi` | upper 95% confidence bound |
| `p95` | empirical 95th percentile |
| `p99` | empirical 99th percentile |
| `min` | minimum observed value |
| `max` | maximum observed value |
| `skewness` | distribution asymmetry |
| `normality_label` | approximate distribution interpretation |
| `significance_test` | statistical test used for comparison |
| `p_value` | significance result |
| `effect_size` | practical magnitude of difference |

## 8. Recommended Figures

Tables are necessary, but figures should also make the statistics visible.

### Figure set

| Figure | Purpose |
|---|---|
| box plot per query family | median, IQR, outliers, and skew |
| mean with 95% CI bars | uncertainty around central tendency |
| P95/P99 tail plot | tail-latency comparison |
| violin plot for key comparisons | distribution shape, not only summaries |

If space is limited, the single strongest combination is:

1. mean with 95% CI
2. P95/P99 tail bar chart

## 9. Benchmark Families That Need This Standard

This statistical-reporting standard should be applied to:

| Benchmark Family | Needed? |
|---|---|
| Enron-derived PrivSearch query benchmarks | yes |
| healthcare PrivSearch query benchmarks | yes |
| replay protection | yes |
| distributed validation | yes |
| WAN validation | yes |
| scalability curves | yes |
| ablation studies | yes |
| cryptographic-overhead decomposition | yes |

No benchmark should remain "mean only" in the final paper if raw repeated samples are available.

## 10. Important Boundary for SeaCQ Comparison

One important methodological limit should be stated clearly:

- If SeaCQ results come only from published figures or digitized points, we cannot legitimately run statistical significance tests against SeaCQ unless we have raw repeated-trial data.

That means:

| Comparison | What We Can Claim |
|---|---|
| PrivSearch vs PrivSearch variants | full significance testing is possible |
| PrivSearch vs SeaCQ published figure points | descriptive comparison only, not inferential significance |

This is important to keep the paper statistically honest.

## 11. Recommended Manuscript Table Pair

For each major experiment, use two linked tables.

### Table A: descriptive statistics

| Condition | N | Mean | Median | SD | 95% CI | P95 | P99 | Min | Max |
|---|---:|---:|---:|---:|---|---:|---:|---:|---:|
|  |  |  |  |  |  |  |  |  |  |

### Table B: inferential comparison

| Comparison | Test | p-value | Effect Size | Significant at alpha=0.05? | Interpretation |
|---|---|---:|---:|---|---|
|  |  |  |  |  |  |

This split keeps the paper readable while still rigorous.

## 12. Manuscript-Ready Wording

If you want a short paper sentence for this recommendation, use:

> All benchmark results are reported with descriptive and inferential statistics, including mean, median, standard deviation, 95% confidence interval, P95, P99, and significance testing with effect sizes where comparable repeated-trial conditions are available.

## 13. Current Output Status

This next step has now been completed in the repository.

The implemented generator produces:

- a unified Markdown statistical summary
- a JSON export for downstream processing
- a descriptive-statistics CSV
- a pairwise-significance CSV

The current implementation automatically selects the strongest available stored benchmark runs for:

- Enron PrivSearch prototype runs
- healthcare PrivSearch prototype runs

It reports:

- mean
- median
- standard deviation
- 95% confidence interval
- P95
- P99
- pairwise significance testing
- Cliff's delta effect size

The remaining improvement for a later iteration is to archive raw per-trial latency samples for every full benchmark run so inferential testing can be done directly on raw trial distributions rather than workload-level means.
