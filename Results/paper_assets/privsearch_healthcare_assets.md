# PrivSearch Healthcare Paper Assets

Generated: 2026-07-09T07:39:52.000Z

Benchmark run: healthcare_privsearch-prototype_2026-07-09T05-11-24-879Z

Corpus size: 281042

Workloads: 258

Trials per workload: 10

## Tables

- `table_privsearch_healthcare_dataset_scope.csv`
- `table_privsearch_healthcare_query_families.csv`
- `table_privsearch_healthcare_global_metrics.csv`

## Figures

![Figure 10. Healthcare corpus composition](paper_assets/figures/figure_10_privsearch_healthcare_dataset_composition.svg)

*Figure 10. Record counts across the three healthcare sources used in the broadened PrivSearch validation corpus.*

![Figure 11. Healthcare latency components](paper_assets/figures/figure_11_privsearch_healthcare_latency_components.svg)

*Figure 11. Mean search versus verification latency for representative healthcare query families.*

![Figure 12. Authentication overhead share](paper_assets/figures/figure_12_privsearch_healthcare_auth_share.svg)

*Figure 12. Authentication-overhead share as a percentage of total latency across healthcare query families.*

## Notes

- The latency-component figure focuses on representative families so the chart remains legible while still showing the contrast between lightweight disjunctive/fuzzy queries and heavier conjunctive/range families.
- The authentication-share figure supports the manuscript claim that verification dominates the runtime profile on the broadened healthcare corpus.