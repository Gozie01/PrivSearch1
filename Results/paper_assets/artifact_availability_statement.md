# Artifact Availability Statement

Generated: 2026-07-08T05:01:29.643Z

The SupplyChainDB manuscript is backed by the source code, benchmark runners, generated result summaries, and figure/table assets contained in this repository.

## Availability

- Code status: available in the current repository workspace.
- Benchmark scripts: available under `scripts/` and `scripts/experiments/`.
- Generated paper assets: available under `Results/paper_assets/`.
- Raw benchmark summaries: available under `Results/` and `Results/paper_assets/supplychain_trials/`.
- Deployment contract: `contracts/LifeDBAnchor.sol` with compiled artifact in `artifacts/contracts/LifeDBAnchor.sol/`.

## Reproduction Commands

```bash
npm run supplychain:benchmark:suite
npm run supplychain:benchmark:q1
npm run supplychain:baseline:search
npm run supplychain:benchmark:search-scaling
npm run supplychain:benchmark:anchor-queue
npm run supplychain:benchmark:recovery
npm run purechain:benchmark
npm run anchor:benchmark:comparator
npm run supplychain:benchmark:distributed
npm run supplychain:benchmark:distributed-validation
npm run bench:storage:aggregate
npm run paper:assets
```

## Key Artifact Files

- `Results/paper_assets/supplychain_logistics_summary.json`: repeated-trial logistics benchmark summary.
- `Results/paper_assets/supplychain_search_baselines.json`: MongoDB no-index vs indexed search baseline comparison.
- `Results/paper_assets/search_scaling_concurrency.json`: concurrent search scaling benchmark output.
- `Results/paper_assets/anchor_queue_saturation.json`: anchor backlog saturation benchmark output.
- `Results/paper_assets/failure_recovery_benchmark.json`: failure recovery benchmark output.
- `Results/paper_assets/anchor_comparator.json`: Purechain versus external EVM benchmarking output.
- `Results/paper_assets/supplychain_distributed_two_node.json`: two-node HTTP benchmark output.
- `Results/paper_assets/distributed_validation_scaling.json`: validator-set scaling benchmark output for 2, 4, 7, and 10 nodes.
- `Results/storage_matrix_publication_summary.json`: aggregated storage-mode comparison.
- `Results/purechain_connection_raw.json`: direct Purechain benchmark output.
- `Results/purechain_auto_anchor_api_raw.json`: end-to-end create-to-anchor benchmark output.

## Environment Notes

- The default benchmark environment is local and single-site unless a remote `LIFEDB_BASE_URL` is supplied for the distributed benchmark.
- The external blockchain comparator is opt-in and requires `EXTERNAL_EVM_RPC_URL` plus a funded testnet key.
- The Q1 repeated-trial suite defaults to `N = 100` via `npm run supplychain:benchmark:q1`.

## Generated Status

- Search baseline present: yes
- Concurrent search scaling present: yes
- Anchor queue saturation present: yes
- Failure recovery benchmark present: yes
- Distributed benchmark present: yes
- Distributed validation scaling present: yes
- External comparator present: no