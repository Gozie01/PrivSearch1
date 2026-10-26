# Fix2: isolate self-tests from real-corpus execution

Test 16 in the prior package called the main workflow without `--fixture` and assumed approved evidence would be absent. In a populated project, the workflow correctly found approved evidence and completed the offline real-corpus experiment inside that negative test. The test then asserted that the exit code should have been 1. This explains the `0 !== 1` assertion after approximately 593 seconds. The test's temporary report is cleaned up by its test hook; it is not a retained, reviewed research result. The wrapper's separately scheduled real-corpus phase was never launched. No MongoDB, MinIO, RPC or transaction path is used by this offline experiment.

Fix2 corrects the test setup and adds three independent execution boundaries:

1. Test 16 now supplies an explicit unapproved privacy-summary directory and uses evidence-only mode. A supplied directory never falls back to other reports.
2. Self-tests reject all non-synthetic source preparation, including a simulation flag pointing at the real project. They also forbid real-corpus mode before output creation, source-module loading or scanning.
3. A deliberate workflow must select exactly one of `--fixture`, `--evidence-only` or `--real-corpus`. The PowerShell wrapper selects real-corpus mode only after successful checks and restoration of the self-test environment.

Evidence-only mode validates frozen code and exact approved report hashes, then returns `PRIVACY_MITIGATION_EVIDENCE_VALIDATED` with all 1,584 result cells unstarted and `real_corpus_source_attempted: false`. It does not scan a corpus, prepare cryptography, start storage or call an attacker. It is a separate diagnostic status, not completion of the research experiment.

The added regression creates an isolated shadow project with synthetic approved reports already present. It checks that valid evidence-only validation and explicit rejection of privacy, Stage20 and audit folders all leave the source reader uncalled. The test changes only its own copied package pins for these synthetic reports; installed production pins remain fixed. This tests the populated-project condition that was missing from the previous builder checks.

The shutdown correction from Fix1 is retained. The original 193 application files and protocol/attack/verification modules remain unchanged. This is a separate package folder, so prior packages and failed reports remain available.

**Download and run this Fix2 package. Do not skip the failed check or edit its expected exit code to zero.** The checks must print their final TAP summary before the retained real-corpus phase starts. The new wrapper passes `--real-corpus` explicitly. Direct CLI users must also choose a mode; invoking the old argument list without a mode now fails immediately.

---

# PrivSearch: measured privacy versus private-replica cost

This is one mitigation experiment following the completed real-corpus attack study. It is not another production deployment or a claim that the original server-side protocol is now inference-resistant.

## What changes, and why

The current server-side manifest exposes exact posting counts. Selective payload requests expose which opaque objects are accessed. Merely adding bytes to a response would leave these attack inputs available. A test in this package demonstrates that negative control.

The comparison has two modes:

| Mode | Remote store sees | Query execution | Main cost |
|---|---|---|---|
| `baseline` | Existing manifest counts, query labels and result access handles | Original frozen server/client API, exercised locally | Selective logical query/locator/object traffic |
| `private_replica` | One opaque AES-256-GCM encrypted file, its length and bootstrap timing | Entire selected snapshot and all encrypted payloads are downloaded once; searches run entirely inside the trusted client | Full replica transfer per revision, client cache and local computation |

**The replica is a different architecture.** It is a useful strong privacy control and cost bound, not a scalable server-side encrypted-search optimization. An authorized client must be allowed to hold the entire selected snapshot and payload collection. It is unsuitable when authorization grants only restricted subsets. It does not add ORAM, PIR, a trusted enclave or a faithful implementation of a published defense.

The outer encrypted file contains the complete existing encrypted snapshot, its authentication material and every existing encrypted payload object. The outer key and exact current-revision digest are supplied by the trusted owner directly to the client in this offline experiment. The ciphertext storage child gets only a randomized file path. The client checks exact download length and digest, authenticates the outer AEAD container and checks the original snapshot commitment before constructing its local server/client. The original full-posting, Merkle, payload AEAD and plaintext identity checks still run.

No application file is installed or modified. No existing report is overwritten. The package stays in its extracted directory and loads hash-pinned project modules.

## Run on the existing Windows project

Download **this package**, then paste the following into PowerShell. A file picker prevents the recurring missing-download-path problem. Select `PrivSearch_Privacy_Mitigation_Fix2.zip`.

```powershell
$root = "C:\Users\Gozie\Desktop\Search Functionality in Blockchain\lifedb ICMIC"
Set-Location -LiteralPath $root
Add-Type -AssemblyName System.Windows.Forms
$picker = New-Object System.Windows.Forms.OpenFileDialog
$picker.Title = "Select PrivSearch_Privacy_Mitigation_Fix2.zip"
$picker.Filter = "ZIP archives (*.zip)|*.zip"
$picker.InitialDirectory = Join-Path $env:USERPROFILE "Downloads"
if ($picker.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw "No ZIP selected." }
$selectedZip = $picker.FileName
$packageFolder = Join-Path $root "PrivSearch_Privacy_Mitigation_Fix2"
if (Test-Path -LiteralPath $packageFolder) { throw "The package folder already exists. Use the existing runner, or move that folder before extracting a new copy." }
Expand-Archive -LiteralPath $selectedZip -DestinationPath $root
powershell -NoProfile -ExecutionPolicy Bypass `
    -File "$root\PrivSearch_Privacy_Mitigation_Fix2\Start-PrivSearchPrivacyMitigationFix2.ps1" `
    -ProjectRoot $root
```

The previously checked portable Node v24.22.0 x64 is preferred automatically. The wrapper runs all workflow checks before real corpus preparation. `-ChecksOnly` runs those checks without a real-corpus study. The runner automatically finds the exact approved Stage20, corpus-audit and completed privacy-attack reports by their summary hashes. Preserve those existing report directories. The prior privacy summary must hash to `72e6ae53746daff0777057d7ee691a9a957fbe3a7c14db87fdc3d83d3ceeb6db`.

Expected real completion marker:

```text
PRIVACY_MITIGATION_REAL_CORPUS_COMPLETED
```

Upload the ZIP printed by the wrapper. A stopped run is also archived when a report directory exists. Completion means execution and accounting completed; it does not mean universal privacy has been proven.

## Fixed experiment

The approved healthcare and Enron source bytes, tokenizer, catalog and complete selected posting closures are checked against the passed audit and Stage20 source plans. This is not an encrypted full-vocabulary index experiment.

| Scope | Healthcare | Enron |
|---|---:|---:|
| Original corpus records scanned/pinned | 281,042 | 517,401 |
| Full selected target documents | 8,364 | 7,726 |
| Full selected posting references | 27,717 | 8,325 |
| Real prepared terms | 24 | 14 |
| Original selected record bytes | 11,840,296 | 218,037,112 |

Three fresh-key repetitions, partition seeds `42`, `1729`, `2026`, full and held-out-half targets, query observation coverage 50%/100%, granted known-query counts 0/1/3, and the same reference settings as the attack study are used. The full targets use exact in-scope statistics, known 10%/50% documents, deliberately shuffled negative-control statistics and the broad whole-corpus frequency catalog. Held-out targets use a disjoint reference half.

The matrix predeclares **1,584 method-result cells: 792 per mode**, 432 fresh attacker child processes and 12 fresh encrypted targets. Each target is shared by the two modes. Every prepared real single-keyword query is independently checked against the original document IDs and body hashes in both modes. Selections and granted examples are paired across modes; known examples are excluded from recovery denominators. Boolean AND/OR and empty-result behavior are also checked in the workflow tests.

The small-candidate settings explicitly grant the real prepared vocabulary. Broad settings grant the full corpus catalog instead. The deliberately permuted reference is a negative control, not a realistic distribution-shift benchmark. The artificial empty-control term is unscored; real terms that become empty after partitioning remain scored.

Fresh encryptions are necessary because old benchmark keys and truth mappings were not retained. Historical attack rates and performance measurements are not silently reused as new measurements. The Stage20 one measured failure and Stage11 three failures remain explicitly retained in the summary.

## What the replica attack result means

The original attacker receives the actual existing manifest and selective access observations. The replica attacker receives the same auxiliary knowledge, the actual opaque-file size/digest and measured bootstrap/query request counts. It is additionally granted anonymous evaluator query slots and the same number of known-query examples. It receives **no original token labels, posting counts, handles, plaintext records, application keys or truth mappings**.

The slots are fresh random aliases created by the evaluator. They are not labels sent over the network. A warmed storage observer would not even see these local query events; the extra slots make it possible to score the same unknown-query challenge without pretending that query messages still exist.

Count/frequency/co-occurrence rules have no keyword-dependent feature in this view. They are explicitly marked **inapplicable and abstain**, rather than fed fabricated zero counts. Uniform random guessing remains executed and scored. If auxiliary knowledge leaves exactly one candidate, every rule infers that candidate; the workflow does not claim protection from information already logically determined by the supplied examples.

Thus a zero feature-rule recovery rate is an applicability result under this transport, not an experimental proof against every inference algorithm. Three repetitions of small selected vocabularies do not provide a population privacy guarantee. Wrong guesses, abstentions, failed cells and unfinished cells retain their denominators. No confidence intervals are manufactured.

## Wire-trace and trust scope

The replica storage process serves only `GET /snapshot`, with the same complete opaque file. The bootstrap must have exactly one successful request and exactly the pinned number of bytes. Storage counters before and after all local queries must be identical. An injected query-dependent request makes the study stop before scoring attacks for that target.

For one fixed revision, after successful bootstrap, the modeled storage interaction during any sequence of local queries is empty. This structural observation explains the missing attack features. It does not establish a general composed security theorem for the application.

The observer still learns the outer file length, bootstrap occurrence/timing, failures and whatever auxiliary information is explicitly granted. The experiment excludes local CPU/memory compromise, OS side channels, query-related application telemetry, query-dependent refresh scheduling, active attacks beyond the tested integrity controls, cross-revision inference, forward/backward privacy and access-policy enforcement. Storage and attacker roles are separate child processes with sanitized environments, **not an OS sandbox**.

Replica initialization must happen independently of the secret query. If a query triggers a refresh or a query-specific network request, this model no longer applies. A cache that is stale relative to the owner can only be rejected when the client has an independent current digest. This prototype obtains that pin from trusted owner setup; it does not establish live-chain freshness or replace the original chain policy. Chain observations inside the unchanged verifier are explicitly simulated. No transaction or anchor is created.

## Measured costs and limits

For every fresh target, `costs` records:

- Original cryptographic preparation and outer sealing time.
- Actual loopback HTTP body bytes, request count and completed download count.
- Cold download plus digest/AEAD/container authentication time, local server/client construction and their sum.
- Outer encrypted replica bytes, encrypted snapshot bytes, encrypted payload-object bytes and serialized container bytes.
- Two temporary encrypted files at peak (store and downloaded copy), plus the in-memory client cache. The package reports byte sizes, **not measured peak RAM/RSS**.
- Local search plus unchanged verification timings for both modes, including every anonymous probe duration and empirical p95 only when at least 20 successful probes exist. These trusted analysis timings are not supplied to the storage attacker.
- Baseline serialized search-response, locator and encrypted-object bytes across all probes, and the replica bootstrap-byte ratio against that logical total.

The baseline is in-process, while replica bootstrap uses real loopback HTTP. Their timings are **not a matched deployed end-to-end latency comparison**. Cached queries have no remote body bytes. Bootstrap is paid once per revision, not charged again to each cached query. The ratio to the full probe set is not a per-query bandwidth multiplier or an amortization guarantee for arbitrary workloads. Query count, cache reuse and revision frequency determine that tradeoff.

The encrypted capsule is capped at **1 GiB**, each object at 512 MiB, snapshot JSON at 128 MiB and restored object inventory at 100,000. These are explicit fail-closed experiment limits, not permission to truncate a posting, omit a payload or silently switch modes. Source corpus objects for one target are released before the restored second object map is loaded. Runtime/application heaps can retain other copies; no general memory-erasure guarantee is claimed.

Temporary files contain only the outer encrypted replica. Plaintext records, keys, keyword-to-label mappings and full access lists are not saved in output. Temporary ciphertexts and child roles are cleaned up. Disk or transport failure stops the affected target; there is no retry that replaces a failed measurement.

## Reports and provenance

`summary.json`, `attack_cells.jsonl`, `attack_cells.csv` and `aggregate.csv` retain mode-separated results. `costs` and `target_attempts` distinguish setup/transport failure from an attacker-method failure. Exclusive, sequential `progress_records` preserve the plan, starts, committed rows, target verification, costs and final status without overwriting prior checkpoints. If output writing fails, only successfully committed rows count as completed.

The package pins the same 193 project files, the approved corpus audit, Stage20 and prior privacy evidence. Its own runtime hashes are checked after execution. It loads no `.env`, MongoDB, MinIO or RPC configuration and sends no network request beyond its own loopback storage process. The wrapper archives its checks and console alongside the report.

Builder checks use small audited synthetic corpora and real local processes. **No healthcare or Enron mitigation measurements have been made in the builder environment.** The Windows run supplies those results. See `BUILD_VALIDATION.json` for the exact builder checks.

## Research context

Access-pattern and volume leakage are separate attack inputs; reducing one does not establish inference resistance against the other. Search-pattern leakage can remain exploitable even when access patterns are hidden. Relevant primary sources include:

- Cash, Grubbs, Perry and Ristenpart, *Leakage-Abuse Attacks Against Searchable Encryption*, CCS 2015: <https://www.cs.lewisu.edu/~perryjn/ccs15.pdf>.
- Oya and Kerschbaum, *Hiding the Access Pattern is Not Enough: Exploiting Search Pattern Leakage in Searchable Encryption*, USENIX Security 2021: <https://www.usenix.org/conference/usenixsecurity21/presentation/oya>.

This package implements neither paper's full attacker or defense. Its baseline methods are the explicitly documented count, normalized-frequency, seeded co-occurrence and random rules from the completed local study. Future efficient server-side defenses must be evaluated against their own actual observable traces, preserve verification and report remaining leakage rather than borrowing the private-replica result.
