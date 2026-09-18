# PrivSearch Ablation Study Plan

This file defines the stronger ablation-study structure for the PrivSearch paper so we do not report only final end-to-end latency. The goal is to isolate the contribution and overhead of each major system component on a common workload and hardware baseline.

## 1. Ablation Ladder

The recommended ablation sequence is:

`PureSearch`

`PureSearch + encrypted index`

`PureSearch + encrypted index + accumulator verification`

`PureSearch + encrypted index + accumulator verification + OR support`

`PureSearch + encrypted index + accumulator verification + OR support + range support`

`PureSearch + encrypted index + accumulator verification + OR support + range support + replay protection`

`Final PrivSearch`

For paper presentation, these stages can be labeled as follows:

| Stage | System Variant | Newly Added Capability |
|---|---|---|
| A0 | PureSearch baseline | Original searchable pipeline without PrivSearch additions |
| A1 | `A0 + encrypted index` | Encrypted searchable index layer |
| A2 | `A1 + accumulator verification` | Authenticated verification via accumulators |
| A3 | `A2 + OR support` | Disjunctive authenticated retrieval |
| A4 | `A3 + range support` | Metadata-backed authenticated range search |
| A5 | `A4 + replay protection` | Real-time nonce/timestamp freshness enforcement |
| A6 | Final PrivSearch | Full integrated system used in the manuscript |

## 2. What Must Be Measured at Every Stage

Instead of reporting only one final latency number, each stage should be measured on the same dataset slice, same query mix, same trial count, and same deployment condition.

The minimum metrics are:

| Metric Family | Required Metrics |
|---|---|
| Latency | setup latency, search latency, verification latency, total end-to-end latency |
| Memory | peak RSS, mean RSS, memory delta during query execution |
| Proof Cost | proof size in bytes, mean proof size, P95 proof size |

For stronger journal quality, also add:

| Optional but Strongly Recommended | Why It Helps |
|---|---|
| server CPU time | shows where computation moves as features are added |
| verifier CPU time | supports authentication-overhead decomposition |
| index build time | useful for encrypted-index and accumulator stages |
| index storage size | complements proof-size and memory claims |

## 3. Measurement Intent by Stage

Each ablation stage should answer a different scientific question.

| Stage | Main Question |
|---|---|
| A0 | What is the baseline cost of the original PureSearch path? |
| A1 | What latency and memory overhead is introduced by encryption alone? |
| A2 | What additional cost comes from authenticated accumulator verification? |
| A3 | What is the extra cost of disjunctive authenticated union over conjunctive-only support? |
| A4 | What is the extra cost of metadata-backed temporal range evaluation? |
| A5 | What is the runtime cost of freshness checks and replay rejection logic? |
| A6 | What is the final integrated cost of the complete PrivSearch design? |

## 4. Workload Matrix

To keep the ablation fair, the same benchmark backbone should be reused across stages whenever a feature is supported.

### Core workloads for all compatible stages

| Workload Group | Query Shape | Use In Stages |
|---|---|---|
| AND-2 | 2-keyword conjunctive query | A0-A6 |
| AND-4 | 4-keyword conjunctive query | A0-A6 |
| AND-6 | 6-keyword conjunctive query | A0-A6 |
| AND-8 | 8-keyword conjunctive query | A0-A6 |
| AND-10 | 10-keyword conjunctive query | A0-A6 |

### Additional workloads for feature-bearing stages

| Workload Group | Query Shape | Use In Stages |
|---|---|---|
| OR-2 | 2-keyword OR query | A3-A6 |
| OR-3 | 3-keyword OR query | A3-A6 |
| OR-of-AND | disjunction of small conjunctive clauses | A3-A6 |
| RANGE-M1 | 1-month range | A4-A6 |
| RANGE-M3 | 3-month range | A4-A6 |
| RANGE-Y2 | 2-year range | A4-A6 |
| RANGE-Y3 | 3-year range | A4-A6 |
| REPLAY-VALID | fresh valid write request | A5-A6 |
| REPLAY-DUP | replayed write request | A5-A6 |

### Rule for comparison

When a feature is absent in a stage, the workload should be marked `not supported` rather than omitted silently. This makes the expressiveness gain visible, not just the performance cost.

## 5. Required Reporting Tables

### Table A. Stage-by-stage latency decomposition

| Stage | Query Family | Setup (ms) | Search (ms) | Verify (ms) | Total (ms) | Delta vs Previous Stage (ms) |
|---|---|---:|---:|---:|---:|---:|
| A0 | AND-2 |  |  |  |  |  |
| A1 | AND-2 |  |  |  |  |  |
| A2 | AND-2 |  |  |  |  |  |
| A3 | AND-2 |  |  |  |  |  |
| A4 | AND-2 |  |  |  |  |  |
| A5 | AND-2 |  |  |  |  |  |
| A6 | AND-2 |  |  |  |  |  |

This same table pattern should be repeated for `AND-4`, `AND-6`, `AND-8`, `AND-10`, and the feature-specific families once available.

### Table B. Stage-by-stage memory cost

| Stage | Query Family | Mean RSS (MB) | Peak RSS (MB) | Memory Delta (MB) | Delta vs Previous Stage (MB) |
|---|---|---:|---:|---:|---:|
| A0 | AND-2 |  |  |  |  |
| A1 | AND-2 |  |  |  |  |
| A2 | AND-2 |  |  |  |  |
| A3 | AND-2 |  |  |  |  |
| A4 | AND-2 |  |  |  |  |
| A5 | AND-2 |  |  |  |  |
| A6 | AND-2 |  |  |  |  |

### Table C. Stage-by-stage proof-size cost

| Stage | Query Family | Mean Proof Size (bytes) | P95 Proof Size (bytes) | Max Proof Size (bytes) | Delta vs Previous Stage (bytes) |
|---|---|---:|---:|---:|---:|
| A0 | AND-2 |  |  |  |  |
| A1 | AND-2 |  |  |  |  |
| A2 | AND-2 |  |  |  |  |
| A3 | AND-2 |  |  |  |  |
| A4 | AND-2 |  |  |  |  |
| A5 | AND-2 |  |  |  |  |
| A6 | AND-2 |  |  |  |  |

### Table D. Capability-vs-cost summary

| Stage | Supported Query Classes | Security Features | Mean Total Latency (ms) | Peak Memory (MB) | Mean Proof Size (bytes) |
|---|---|---|---:|---:|---:|
| A0 | AND only | baseline integrity only |  |  |  |
| A1 | AND only | encrypted index |  |  |  |
| A2 | AND only | encrypted index + accumulator verification |  |  |  |
| A3 | AND, OR, OR-of-AND | authenticated disjunctive support |  |  |  |
| A4 | AND, OR, OR-of-AND, range | authenticated temporal filtering |  |  |  |
| A5 | A4 capabilities | replay prevention added |  |  |  |
| A6 | full PrivSearch families | complete integrated security path |  |  |  |

## 6. How to Measure Proof Size

For consistency, proof size should be measured as the serialized byte size of the verification object returned to the client for a query.

Recommended definition:

`proof_size_bytes = byte_length(JSON.stringify(verification_object))`

If later the system uses binary encoding, report both:

| Representation | Meaning |
|---|---|
| logical proof size | semantic content size independent of transport |
| serialized proof size | actual transmitted bytes seen by the client |

For the current prototype paper, serialized proof size is the more practical metric.

## 7. How to Measure Memory

For Node-based experiments, a practical memory methodology is:

1. capture baseline RSS immediately before query execution
2. capture peak RSS during execution
3. capture end RSS after verification completes
4. compute:
   `memory_delta = end_rss - baseline_rss`
5. retain peak RSS as the main "worst-case memory" claim

This is stronger than reporting only end-state memory because some features, especially verification and OR/range aggregation, may cause temporary peaks that disappear afterward.

## 8. How to Interpret the Ablation

The paper should not frame the ablation as "more features always equals better latency." The real value is:

1. showing the incremental overhead introduced by each security and query-expressiveness component
2. showing that the overhead remains practical relative to the added capability
3. showing which component dominates cost

The expected interpretation is likely:

| Transition | Likely Main Cost Driver |
|---|---|
| A0 -> A1 | encrypted index construction and encrypted lookup handling |
| A1 -> A2 | accumulator verification and authenticated checking |
| A2 -> A3 | union, deduplication, and clause-wise verification |
| A3 -> A4 | interval filtering and larger authenticated result coverage |
| A4 -> A5 | very small per-request freshness overhead |
| A5 -> A6 | integration cost of the full PrivSearch stack |

## 9. Strongest Figure Layout

For a journal-quality presentation, the best figure set is:

| Figure | Purpose |
|---|---|
| Ablation latency line chart | total latency across A0-A6 |
| Stacked latency bars | setup vs search vs verify per stage |
| Memory bars | peak RSS per stage |
| Proof-size bars | mean proof size per stage |

If space is limited, the single strongest figure is a stacked bar chart with one bar per stage and components:

`setup + search + verify`

Then accompany it with two small side figures:

`peak memory`

`mean proof size`

## 10. What This Improves in the Paper

This ablation design makes the PrivSearch evaluation stronger than a simple final-system benchmark because it answers:

- which component contributes most to latency
- whether replay protection is nearly free or materially costly
- whether OR support mainly affects search time or proof size
- whether range support mainly affects result-set size or verification cost
- whether the final system overhead is justified by the added query expressiveness and security

## 11. Immediate Recommendation for the Current PrivSearch Project

The next implementation-grade experiment asset should therefore be:

`Results/paper_assets/privsearch_ablation_results.md`

backed by:

- one CSV for latency by stage
- one CSV for memory by stage
- one CSV for proof size by stage

and generated from a dedicated ablation benchmark script that runs the stage ladder `A0-A6` on the same fixed workload pack.

## 12. Current Executable Artifact

This project now has a first executable ablation driver:

`scripts/benchmark-privsearch-ablation.js`

with package entry:

`npm run privsearch:benchmark:ablation`

It currently generates:

- `Results/paper_assets/privsearch_ablation_results.md`
- `Results/paper_assets/privsearch_ablation_results.csv`
- `Results/paper_assets/privsearch_ablation_core_conjunctive.csv`
- `Results/paper_assets/privsearch_ablation_extension_families.csv`
- `Results/paper_assets/privsearch_ablation_results.json`

The current executable interpretation is intentionally careful:

1. `A0` is a real benchmarked postings-baseline proxy for the non-cryptographic baseline.
2. `A1` is a real measured `setup + search` encrypted-path proxy from the current PrivSearch prototype.
3. `A2` is a real measured authenticated conjunctive PrivSearch stage on the same core query families.
4. `A3-A4-A6` are real measured PrivSearch extension-family summaries.
5. Memory is currently reported as mean RSS delta per query run, not peak RSS.
6. Proof size is currently reported as serialized `proof_hints` bytes.

## 13. Manuscript-Ready Summary Sentence

If you want a short paper sentence for this idea, use:

> To isolate the cost of each PrivSearch enhancement, we perform a staged ablation from the PureSearch baseline through encrypted indexing, accumulator-based verification, disjunctive support, temporal range support, and replay protection, reporting latency, memory footprint, and proof size at each stage.
