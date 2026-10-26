# PrivSearch real-corpus privacy attack study

This package runs an **offline query-inference study on the audited healthcare and Enron data**. It extracts the same complete selected-vocabulary source projections used by the reviewed Stage20 experiment, creates fresh encrypted targets locally and evaluates separate attack processes. It does not install application files, rebuild a deployed index, publish to MongoDB/MinIO, contact an RPC, deploy a contract or submit a transaction.

**A completed study does not mean privacy is secure.** High correct-recovery rates indicate inference risk under the stated attacker knowledge. Low recovery measures these attacks and conditions, not every possible attack or a formal privacy theorem.

## Run

Keep the existing project files and passed audit/Stage20 report directories in place. Extract this ZIP into:

```
C:\Users\Gozie\Desktop\Search Functionality in Blockchain\lifedb ICMIC
```

Then run:

```powershell
$root = "C:\Users\Gozie\Desktop\Search Functionality in Blockchain\lifedb ICMIC"
powershell -NoProfile -ExecutionPolicy Bypass `
  -File "$root\PrivSearch_Real_Corpus_Privacy\Start-PrivSearchPrivacyAttacks.ps1" `
  -ProjectRoot $root
```

The launcher prefers the previously checked portable Node v24.22.0 x64 under `Tools\PrivSearchNode`. It checks 193 frozen project files and the package hashes, runs 19 synthetic workflow checks, then starts the real-data matrix. **MongoDB, MinIO and blockchain access are not needed.** The pipeline does not load `.env` or service configuration.

The first source hashing/extraction and each cryptographic setup can be quiet while CPU/disk work is synchronous. Let the command finish. It records a new report directory and prints a ZIP to upload, including partial results if the study stops. Source records, clinical text, raw identifiers, keyword strings, client keys and truth mappings are not written into that report. Keys and ciphertext objects exist only during the local evaluation; no memory-erasure guarantee is asserted.

To run only the workflow checks, add `-ChecksOnly`. For relocated evidence folders, the launcher accepts `-Stage20Directory` and `-AuditDirectory`; exact approved hashes are still required. It does not select an unrelated report because its status happens to say passed.

## Why fresh encryption is necessary

The benchmark's search keys and private keyword-to-label truth were ephemeral. Public snapshots alone cannot independently establish whether an inferred word is correct. Using the same frequency match as both the attack and its truth scorer would be circular.

This study therefore privately provisions fresh owner/client keys for the **same audited full selected-posting projection**, records genuine request labels and object-access handles through the frozen API, and keeps the truth mapping exclusively in the scorer. The historical Stage20 snapshot, ciphertext objects, roots, transactions and 959/960 measured success count are left intact. Its one connection failure and the three older Stage11 performance failures remain recorded as historical evidence, not attack measurements.

## Fixed experiment matrix

The full run predeclares **792 attack-result cells**, grouped into 264 configurations with three repetitions. It uses **12 fresh encrypted targets** and **216 separate attacker-process invocations**. A cell is one method/condition result, not a new live query or blockchain transaction. Three document partition seeds are fixed: `42`, `1729`, `2026`. Encryption keys, probe ordering and the selected known-query subsets are fresh private randomness; they are not derived from an attacker-visible lexical ordering.

| Factor | Values and interpretation |
| --- | --- |
| Corpora | Healthcare and Enron |
| Full target | Same complete selected-vocabulary posting closure as Stage20, with full original-record payloads |
| Held-out target | Deterministic half of those projected records; complete postings **within that explicitly defined half** |
| Query observation coverage | Half or all of the real prepared single-keyword queries |
| Granted known queries | 0, 1 or 3 observed keyword/label pairs; excluded from recovery denominators |
| In-scope candidate vocabulary | All real prepared lexical tokens assumed known; artificial prepared-empty token excluded and unscored |
| Broad candidate vocabulary | Entire audited source keyword-frequency catalog; prepared vocabulary not supplied as a separate list |

For the reviewed full target, the expected source projection is 8,364 healthcare documents/27,717 posting references and 7,726 Enron documents/8,325 references, with 24 and 14 real prepared tokens respectively. These are **selected-vocabulary encrypted targets**, not full-vocabulary encrypted indexes. The broad attack can have hundreds of thousands of reference candidates while the encrypted target retains the fixed prepared vocabulary. The source projection counts and hashes must match the approved evidence; no target posting or payload is silently truncated.

The held-out construction is a separate privacy experiment, not a relabeling of the Stage20 target. Its reference and target records are disjoint. Selection of the prepared vocabulary originated in the earlier workload design; this study explicitly grants the small candidate vocabulary to those attackers rather than claiming a vocabulary-selection holdout.

## Attacker knowledge models

| Reference model | Target | Information granted |
| --- | --- | --- |
| `exact_in_scope` | Full projection | Exact keyword counts and pairwise document co-occurrences for the known prepared vocabulary; a strong query-recovery upper-bound setting |
| `known_documents_10pct` | Full projection | Moments computed from a deterministic 10% subset of target records, scaled by the reference document count |
| `known_documents_50pct` | Full projection | Moments computed from a deterministic 50% subset of target records |
| `shuffled_reference_control` | Full projection | Counts/co-occurrences assigned to cyclically permuted lexical words; a deliberately incorrect-knowledge control, **not a real distribution-shift benchmark** |
| `disjoint_reference_half` | Held-out half | Moments from the other half of the selected records, with no shared document IDs |
| `full_corpus_frequency_catalog` | Full projection | Every keyword and its audited full-source document frequency; no pairwise matrix or prepared-word list |

For the broad catalog, each truly prepared token has its complete full-source posting count in the full target. The attacker matches those raw counts; dividing by the full corpus size and comparing that ratio with the smaller projected target would be incorrect. Nonprepared words remain competing reference candidates. This auxiliary model is privileged knowledge of full-source frequencies, not a claim that a deployment's adversary naturally has it.

The moment-based attacks receive reference statistics rather than raw known records. More powerful adversaries might exploit additional record properties or auxiliary data; those are not evaluated here.

## Actual public observations and role boundary

The trusted coordinator runs the frozen owner, server and complete client verifier. Each single-token probe verifies exact original record IDs/body hashes privately. Public observations are opaque request coverage labels, manifest counts and the handles actually passed to the public server's payload-location interface. No plaintext result or source ID is used as an attacker input. Probe order is randomized privately. Attack roles receive unordered logical observations, not workload names or timing traces.

A separate fresh Node process receives only the declared public projection, reference statistics and explicitly granted known-query pairs for **that condition**. A 0-known-query process cannot read another condition's seed pairs. Different observation-coverage roles are not given the omitted access traces. Environment variables are restricted to basic process paths; search keys, storage credentials, RPC endpoints, `NODE_OPTIONS` and truth are not passed. This is controlled process/input separation under one OS user, **not an OS sandbox**.

The offline verifier receives a clearly marked synthetic state-observation interface for its freshly generated, unanchored state. All row/payload cryptography and exact-result checks remain the actual frozen implementation. This experiment therefore measures the scheme's metadata/access inference, not live chain freshness, RPC availability, deployed latency or consensus finality.

## Attack algorithms

1. **Unique scaled frequency:** match observed count to a unique candidate count after target/reference-size adjustment; abstain if no match or a tie. The wide-catalog variant uses raw exact counts.
2. **Normalized nearest frequency:** select a unique closest reference document-frequency proportion; abstain on ties.
3. **Frequency plus seeded co-occurrence:** compare each unknown token's frequency and its object-set intersections with the known-query tokens against corresponding reference moments. Use squared differences of normalized counts, with unique-minimum selection. At zero seeds it reduces to the frequency baseline; no hidden co-occurrence anchors are provided.
4. **Uniform random baseline:** choose uniformly among remaining reference candidates, excluding the explicitly known words. This provides an empirical chance baseline, not a privacy defense.

The broad-catalog condition runs only unique-count matching and the random baseline; it does not fabricate a whole-vocabulary co-occurrence matrix. No global optimization, learned attacker, active record injection, original-ID re-identification, record-body recovery or timing attack is claimed. These are transparent counting/co-occurrence baselines, not a full reproduction of every published leakage-abuse attack.

The methodology is motivated by Cash, Grubbs, Perry and Ristenpart, *Leakage-Abuse Attacks Against Searchable Encryption*, CCS 2015:
https://www.cs.lewisu.edu/~perryjn/ccs15.pdf

## Metrics and interpretation

Every result records unknown-query denominator, guessed/correct/wrong counts, abstentions, correct-recovery rate, guessing coverage, precision conditional on guessing, and a candidate-set-size histogram. Granted seeds never count as recovered queries. Observed incidence edges, distinct opaque objects and incidence coverage quantify the access linkage disclosed by the measured probes. They do not identify original patient/document IDs.

At complete single-token coverage, all prepared real-token posting associations become linked to opaque object handles through the recorded access pattern. At partial coverage, the reported association fraction is explicitly lower. This is measured query-dependent linkage; it does not claim the full graph is available before any query.

Aggregate rates pool denominators across the three specified repetitions **within the same condition**. Different attack/knowledge conditions reuse data and are not independent samples. No confidence interval, inferential population claim or guaranteed privacy level is produced. `attacker_cell_wall_ms` includes process startup and all methods in that cell; it is not a per-method or deployed-query latency.

Wrong-reference conditions are allowed to produce incorrect guesses. Exact-reference nonrandom controls may abstain on ties but cannot legitimately make wrong unique matches; an inconsistency stops the workflow. Any attack-role error stops with retained failed cells and not-started/unfinished denominators. Missing groups remain explicit in the aggregate plan. No replacement trials are run to obtain favorable rates.

## Reports and preservation

The report contains `summary.json`, `attack_cells.jsonl`, `attack_cells.csv`, `aggregate.csv`, exclusive immutable progress records, runtime checks and this protocol description. Progress is recorded without replacing/renaming an existing checkpoint. Aggregate reports exclude lexical terms, original records/IDs, complete access-handle lists, ciphertext bodies, private inputs and keys. Only fixed allowlisted error codes are retained; arbitrary provider/error text is not exported.

Inputs are checked against the passed Stage5 audit before/after extraction and at final source checking. All 193 runtime file hashes are checked before/after the run; the new experiment modules are also hashed. Existing output directories, corpus-overlapping output and linked output parents are refused.

Builder validation: 19/19 checks passed on Linux Node v24.19.0, including a complete 264-cell/72-role audited fixture, Unicode transport, role deadlines, wrong identity/input refusal, independent scoring, source changes, partial results and a checkpoint write failure. The launcher repeats them on Windows before the real run. **The real healthcare/Enron attack rates have not yet been measured here.** Windows PowerShell execution was not available in the builder; its launcher was inspected against the existing runner conventions.

`PRIVACY_REAL_CORPUS_ATTACK_STUDY_COMPLETED` means the declared matrix finished with consistent records. It does not mean every attack failed, a privacy proof is complete, or defenses are unnecessary. Upload the printed report ZIP so we can assess the actual inference risks and decide whether the construction needs changes.
