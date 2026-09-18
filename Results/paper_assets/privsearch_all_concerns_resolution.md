# PrivSearch Master Concern Resolution File

Updated: 2026-07-16

This file consolidates the main scientific, experimental, and manuscript-strengthening concerns for the PrivSearch paper into one place. It separates:

1. concerns already addressed
2. concerns addressed in principle but still needing stronger aligned experiments
3. concerns that remain open because they require new implementation or new experiments

This is the best single tracking file for the current PrivSearch paper state.

## 0. 2026-07-16 Refresh Outcome

On July 16, 2026, the following experiment refreshes were completed successfully:

1. aligned healthcare phase-breakdown refresh
2. stronger ablation rerun on Enron with `25` trials per workload
3. aligned cryptographic-overhead regeneration from the `448`-workload / `100`-trial Enron run
4. stronger Enron resource-overhead rerun with `53` workloads and `3` trials per workload
5. stronger healthcare resource-overhead rerun with `24` workloads and `3` trials per workload
6. scalability refresh with `10` trials per query for posting-list, clause-count, and concurrency axes
7. WAN-style distributed-validation refresh with `20` trials per node/profile setting
8. non-WAN distributed-validation scaling refresh

One live experiment rerun was attempted but blocked by environment state:

1. the replay-protection benchmark could not be rerun because MongoDB was not reachable on `localhost:27017`, and Docker was not running on this machine

As a result, the replay-protection evidence remains experimentally supported by the existing persisted artifact, but not freshly rerun in this refresh cycle.

## 1. Canonical Current Experimental Baseline

These are the canonical aligned benchmark archives that should now be treated as the primary quantitative source:

- Enron aligned run: `NweDB/benchmark_runs/enron_privsearch-prototype_2026-07-15T07-12-46-002Z/`
- Healthcare aligned run: `NweDB/benchmark_runs/healthcare_privsearch-prototype_2026-07-15T05-48-51-545Z/`

These are the canonical current summary files:

- `Results/paper_assets/privsearch_statistical_rigor.md`
- `Results/paper_assets/privsearch_statistical_rigor_descriptive.csv`
- `Results/paper_assets/privsearch_statistical_rigor_significance.csv`
- `Results/paper_assets/privsearch_recent_aligned_updates.md`
- `CHIGOZIE_PrivSearch_Implementation_paper.md`

## 2. Master Concern Register

| Concern | Current Status | Addressed by | Additional Experiment Needed? | Best Evidence File |
|---|---|---|---|---|
| Formal correctness and completeness theorems | addressed in writing, not yet the strongest integrated manuscript form | theorem notes and strengthening file | no new experiment required | `CHIGOZIE_PrivSearch_IEEE_Strengthening_File.md` |
| OR-query correctness theorem | addressed in writing | formal claims note | no new experiment required | `Results/paper_assets/privsearch_formal_claims.md` |
| Range-query correctness theorem | addressed in writing | formal claims note | no new experiment required | `Results/paper_assets/privsearch_formal_claims.md` |
| Replay-protection proof sketch | addressed in writing and supported experimentally | formal claims plus replay benchmark | no new experiment required for current claim | `Results/paper_assets/privsearch_replay_protection.md` |
| Latency-independence claim | addressed in writing and supported experimentally | formal claims plus queue-drain evidence | no new experiment required for current claim | `Results/paper_assets/privsearch_formal_claims.md` |
| Mathematical cost analysis | addressed in writing | strengthening file and manuscript analytical model text | no new experiment required | `CHIGOZIE_PrivSearch_IEEE_Strengthening_File.md` |
| Explicit threat model | addressed in manuscript-side material | tables and strengthening file | no new experiment required | `CHIGOZIE_PrivSearch_All_Tables.md` |
| Theory-to-experiment integration | addressed in manuscript-side material, but can still be tightened further | theory-experiment integration note plus manuscript | no new experiment strictly required | `CHIGOZIE_PrivSearch_Theory_Experiment_Integration.md` |
| Statistical rigor beyond means | addressed experimentally and in manuscript | aligned reruns with bootstrap and hierarchical bootstrap | no new experiment required for current standard | `Results/paper_assets/privsearch_statistical_rigor.md` |
| Healthcare versus Enron trial-depth mismatch | addressed experimentally | both datasets now rerun at 100 trials | no | `Results/paper_assets/privsearch_recent_aligned_updates.md` |
| Ablation study | addressed experimentally and refreshed on July 16, 2026 | aligned `25`-trial rerun on the current executable stack | no new experiment required for current claim | `Results/paper_assets/privsearch_ablation_results.md` |
| Cryptographic overhead decomposition | addressed experimentally and refreshed on July 16, 2026 | aligned crypto-overhead regeneration from the latest Enron run | no new experiment required for current claim | `Results/paper_assets/privsearch_crypto_overhead_results.md` |
| Scalability versus posting size | addressed experimentally and refreshed on July 16, 2026 | scalability summary with `10` trials | optional rerun only if more checkpoints are desired | `Results/paper_assets/privsearch_scalability_summary.md` |
| Scalability versus clause count | addressed experimentally and refreshed on July 16, 2026 | scalability summary with `10` trials | optional rerun only if more checkpoints are desired | `Results/paper_assets/privsearch_scalability_summary.md` |
| Scalability versus concurrent users | addressed experimentally and refreshed on July 16, 2026 | scalability summary with `10` trials | optional rerun only if more checkpoints are desired | `Results/paper_assets/privsearch_scalability_summary.md` |
| Scalability versus corpus size | not yet experimentally completed | only skeleton and manifest path exist | yes | `Results/paper_assets/privsearch_scalability_study_plan.md` |
| Scalability versus vocabulary size | not yet experimentally completed | only skeleton and manifest path exist | yes | `Results/paper_assets/privsearch_scalability_study_plan.md` |
| Resource-overhead reporting | addressed experimentally and refreshed on July 16, 2026 | stronger Enron and healthcare reruns with repeated trials | no new experiment required for current claim | `Results/paper_assets/privsearch_resource_overhead_results_enron_aligned.md` |
| Stronger baseline comparison against TELEX, EAQ, VQL, MSTDB | addressed as literature-based comparison | stronger baselines note and manuscript positioning | no same-stack experiment required unless reimplementation is attempted | `CHIGOZIE_PrivSearch_Stronger_Baselines.md` |
| Deployment discussion | addressed in writing | deployment discussion note | no new experiment required for current claim | `CHIGOZIE_PrivSearch_Deployment_Discussion.md` |
| Replay-protection benchmark | addressed experimentally, but fresh rerun is environment-blocked | prior persisted replay benchmark plus rerun attempt on July 16, 2026 | no new experiment required for the current claim, but yes if a fresh rerun is desired | `Results/paper_assets/privsearch_replay_protection.md` |
| WAN-style distributed validation | addressed experimentally and refreshed on July 16, 2026 | WAN and distributed-validation summaries | no for current claim | `Results/paper_assets/distributed_validation_wan.md` |
| Full physical multi-host / geographically separated validation | still open | not fully implemented experimentally | yes | `CHIGOZIE_PrivSearch_Implementation_paper.md` |
| Broader healthcare validation beyond current three-source corpus | partially addressed | current eICU + MedCD + openFDA corpus | yes, only if a stronger generalization claim is desired | `Results/paper_assets/privsearch_recent_aligned_updates.md` |
| Semantic search in the strong embedding-based sense | still open | only semantic_v1 concept-expanded path is implemented | yes, and also requires new implementation | `CHIGOZIE_PrivSearch_Implementation_paper.md` |
| Sensitivity analysis | mostly still open | plan-level treatment exists, but no dedicated finished artifact set | yes | `CHIGOZIE_PrivSearch_IEEE_Strengthening_File.md` |
| Reproducibility section | partially addressed | scripts and artifacts exist, but no PrivSearch-specific final reproducibility section file yet | yes, manuscript-side completion needed, experiment rerun not necessarily needed | `CHIGOZIE_PrivSearch_IEEE_Strengthening_File.md` |

## 3. Concerns Already Addressed Well

These concerns are now in good shape and do not require new experiments for the current paper claims.

### 3.1 Security and Formal-Argument Concerns

- OR-query correctness theorem is drafted
- range-query correctness theorem is drafted
- replay-protection proof sketch is drafted
- latency-independence argument is drafted
- broader formal theorem set and mathematical cost model are drafted
- explicit threat model material exists

Primary files:

- `CHIGOZIE_PrivSearch_IEEE_Strengthening_File.md`
- `Results/paper_assets/privsearch_formal_claims.md`
- `CHIGOZIE_PrivSearch_All_Tables.md`

### 3.2 Statistical-Rigor Concerns

These have materially improved:

- Enron and healthcare are both now at `100` trials per workload
- raw per-trial samples are preserved for both aligned reruns
- bootstrap confidence intervals are included
- hierarchical bootstrap confidence intervals are included
- IQR reporting is included
- workload-level significance testing remains conservative by design

Primary files:

- `Results/paper_assets/privsearch_statistical_rigor.md`
- `Results/paper_assets/privsearch_recent_aligned_updates.md`

### 3.3 Directly Completed Experimental Concerns

The following are already backed by executable experiments:

- authenticated conjunctive benchmarking
- OR, OR-of-AND, range, fuzzy, and semantic_v1 query-family benchmarking
- replay-attack rejection benchmarking
- WAN-style distributed-validation benchmarking across 2, 4, 7, and 10 nodes
- healthcare-corpus benchmarking on eICU demo, MedCD, and openFDA
- ablation benchmarking refreshed on July 16, 2026
- cryptographic-overhead benchmarking refreshed on July 16, 2026
- resource-overhead benchmarking refreshed on July 16, 2026
- scalability benchmarking refreshed on July 16, 2026 for posting-list, clause-count, and concurrent-user axes

Important note:

- the replay benchmark itself remains experimentally valid from the persisted artifact, but its fresh rerun on July 16, 2026 was blocked by missing MongoDB / Docker infrastructure

## 4. Concerns Partially Open After the July 16, 2026 Refresh

These are the concerns that still remain open after running the currently feasible benchmark refresh set.

### 4.1 Replay Benchmark Refresh Is Blocked by Local Infrastructure

Current state:

- the persisted replay benchmark artifact still exists and remains valid for the current manuscript claim
- a fresh rerun was attempted on July 16, 2026

Blocker:

- MongoDB was not reachable on `localhost:27017`
- Docker was not running, so the local stack could not be started through the existing container path

What should be done next:

1. bring MongoDB and the API stack back up
2. rerun `scripts/benchmark-replay-protection.js`
3. replace the older replay artifact with a fresh aligned refresh-cycle artifact

Primary file:

- `Results/paper_assets/privsearch_replay_protection.md`

## 5. Concerns Still Open Because They Need New Experiments

These remain genuine open items if the paper wants to claim them strongly.

### 5.1 Sensitivity Analysis

This is still one of the clearest remaining experimental gaps.

Recommended sensitivity axes:

1. replay-window size
2. Bloom-filter or false-positive target where applicable
3. proof size / verification sample size
4. accumulator or witness sample size
5. validator count
6. blockchain confirmation delay

Current status:

- discussed in `CHIGOZIE_PrivSearch_IEEE_Strengthening_File.md`
- validator-count behavior is now refreshed through `distributed_validation_wan.md` and `distributed_validation_scaling.md`
- but a dedicated PrivSearch sensitivity artifact still does not exist
- replay-window and blockchain-confirmation-delay sensitivity are still not experimentally completed

Needed next artifact:

- `Results/paper_assets/privsearch_sensitivity_analysis.md`

### 5.2 Richer Scalability Along Corpus Size and Vocabulary Size

Current state:

- posting-list scaling is measured
- clause-count scaling is measured
- concurrent-user scaling is measured
- those three measured axes were refreshed on July 16, 2026 with `10` trials per query

Open gap:

- corpus-size scaling is still disabled
- vocabulary-size scaling is still disabled

Needed next experiments:

1. prepare sliced indexes for at least two corpus-size checkpoints
2. prepare reduced-vocabulary checkpoints
3. run the existing scalability driver over those slices

Primary file showing the gap:

- `Results/paper_assets/privsearch_scalability_summary.md`

### 5.3 Full Physical Multi-Host / Geographically Separated Validation

Current state:

- WAN-style distributed validation exists with latency-profile injection

Open gap:

- not yet a physically separate multi-host deployment across distinct sites

Needed next experiment:

1. deploy validator and query nodes across genuinely separate machines or regions
2. rerun the 2, 4, 7, and 10 validator-node matrix
3. compare results against the present latency-profile emulation

### 5.4 Stronger Healthcare Generalization

Current state:

- healthcare validation already uses three sources: eICU demo, MedCD, and openFDA

Open gap:

- a stronger generalization claim would still benefit from one more substantial healthcare dataset

Needed next experiment if desired:

1. add one more large healthcare-style corpus
2. regenerate the healthcare validation pack
3. rerun a reduced but representative query-family matrix

### 5.5 Strong Semantic Search

Current state:

- `semantic_v1` is real and benchmarked
- it is concept-expanded authenticated retrieval

Open gap:

- it is not embedding-based or neural semantic retrieval

Needed next work:

1. new implementation
2. new semantic benchmark design
3. new evaluation against current semantic_v1 baseline

This is not a minor rerun. It is a substantive future-work extension.

## 6. Concerns That Are Primarily Writing / Integration Work, Not New Experiments

These need to be wired into the paper carefully, but they do not require new benchmarking first.

### 6.1 Formal Security Section

Insert:

1. definitions
2. theorem / proof pairs
3. cost-model equations
4. explicit trust and adversary model

Primary source files:

- `CHIGOZIE_PrivSearch_IEEE_Strengthening_File.md`
- `Results/paper_assets/privsearch_formal_claims.md`

### 6.2 Deployment Discussion

Insert a deployment subsection using:

- hospitals
- pharmaceutical supply chains
- IoMT systems
- cross-institution data sharing

Primary source file:

- `CHIGOZIE_PrivSearch_Deployment_Discussion.md`

### 6.3 Broader Baseline Positioning

Insert the broader baseline comparison table and keep the distinction clear:

- SeaCQ and PureSearch-derived components are direct comparison paths
- TELEX, EAQ, VQL, and MSTDB are literature-based baselines

Primary source file:

- `CHIGOZIE_PrivSearch_Stronger_Baselines.md`

### 6.4 Reproducibility Section

This is partly prepared but still should be written as a PrivSearch-specific subsection.

It should cover:

1. hardware
2. software versions
3. scripts
4. benchmark archives
5. seeds and configuration flags
6. repository paths for figures and tables

This is mostly manuscript work, not a new experiment.

## 7. Current Best Experimental Story

If the paper had to be defended today, the strongest experimentally supported claims are:

1. PrivSearch extends authenticated search beyond conjunctive-only querying with implemented OR, OR-of-AND, range, fuzzy, and semantic_v1 paths.
2. Replay protection is implemented and benchmarked with perfect rejection in the tested replay suite.
3. Enron and healthcare are now benchmarked on aligned `100`-trial reruns with raw per-trial persistence.
4. Statistical reporting is now much stronger than a means-only evaluation.
5. WAN-style distributed validation has been experimentally exercised for 2, 4, 7, and 10 nodes.
6. Healthcare validation is no longer single-source; it now spans eICU demo, MedCD, and openFDA.

## 8. Current Best Next Experimental Priorities

If the goal is to strengthen the paper further with the highest return on effort, the next experiments should be:

1. restore MongoDB / API availability and rerun the replay benchmark
2. complete sensitivity analysis
3. enable corpus-size and vocabulary-size scalability slices
4. complete a true physical multi-host / geographically separated validation run
5. add one more substantial healthcare corpus if a stronger generalization claim is desired

## 9. Superseded Older Artifacts

Some older files are still useful structurally but should not be treated as the primary aligned quantitative source where their numbers conflict with the latest reruns.

The main aligned source of truth is now:

- `Results/paper_assets/privsearch_statistical_rigor.md`
- `Results/paper_assets/privsearch_recent_aligned_updates.md`
- `CHIGOZIE_PrivSearch_Implementation_paper.md`

Older experiment-side files that may contain lighter-run or pre-alignment numbers include:

- `Results/paper_assets/privsearch_healthcare_validation_summary.md`
- `Results/paper_assets/privsearch_healthcare_phase_breakdown.md`

These files remain useful, but if a number differs from the aligned rerun summaries, prefer the aligned rerun summaries.

## 10. Best One-File Reference

If one single file is needed to answer:

"Which concerns are already addressed, which are experimentally backed, and which still need new experiments?"

use:

`Results/paper_assets/privsearch_all_concerns_resolution.md`
