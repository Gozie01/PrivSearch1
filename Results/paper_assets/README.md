# Paper Assets Index

This folder contains the paper-facing tables, plots, and intermediate artifacts used by the SupplyChainDB manuscript.

## Core Outputs

- `final_journal_tables.md`: consolidated paper tables
- `results_and_discussion.md`: short narrative interpretation of the final results
- `artifact_availability_statement.md`: manuscript-ready reproducibility statement
- `supplychain_logistics_summary.json`: repeated-trial logistics summary in machine-readable form
- `supplychain_logistics_summary.md`: repeated-trial logistics summary in markdown
- `supplychain_logistics_metrics.csv`: flat export of logistics metrics for plotting or spreadsheet use
- `supplychain_search_baselines.json`: explicit MongoDB no-index vs indexed search baseline comparison
- `anchor_comparator.json`: Purechain vs external EVM benchmark summary
- `supplychain_distributed_two_node.json`: HTTP-level two-node benchmark summary
- `distributed_validation_scaling.json`: validator-set scaling summary for 2, 4, 7, and 10 nodes

## CSV Tables

- `table_logistics_ingestion.csv`
- `table_search_governance_recall.csv`
- `table_storage_comparison.csv`
- `table_purechain_overhead.csv`
- `table_distributed_validation.csv`

## Figures

- `figures/figure_1_architecture.svg`
- `figures/figure_2_storage_throughput.svg`
- `figures/figure_3_payload_overhead.svg`
- `figures/figure_4_logistics_latency.svg`
- `figures/figure_5_purechain_overhead.svg`
- `figures/figure_6_workflows.svg`
- `figures/figure_9_distributed_validation_scaling.svg`

## Raw Inputs

- `supplychain_trials/`: raw JSON outputs for each repeated logistics trial
- `logs/`: console logs from repeated benchmark execution

## Upstream Source Artifacts

- `Results/storage_matrix_publication_summary.json`
- `Results/archive_heavy_20260422_160341/storage_matrix_publication_summary.json`
- `Results/purechain_connection_raw.json`
- `Results/purechain_auto_anchor_api_raw.json`

## Regeneration

To regenerate these assets from the current repository state:

1. run `node scripts/run-supplychain-benchmark-suite.js`
2. run `node scripts/run-supplychain-benchmark-q1.js`
3. run `node scripts/benchmark-supplychain-baselines.js`
4. run `node scripts/benchmark-anchor-comparator.js`
5. run `node scripts/benchmark-supplychain-distributed.js`
6. run `node scripts/benchmark-distributed-validation.js`
7. run `node scripts/generate-paper-assets.js`
