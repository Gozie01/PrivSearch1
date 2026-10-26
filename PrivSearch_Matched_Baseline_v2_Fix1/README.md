# Matched baseline experiment v2

Fix1 repairs Windows PowerShell 5.1 handling of normal native stderr. All native commands now pass through a Python subprocess logger that merges output into the retained UTF-8 log and preserves the actual exit status. Successful unittest progress no longer triggers PowerShell's terminating-error policy. True nonzero exits still stop the experiment. Benchmark/workload code is unchanged.

Extract this package inside your existing `lifedb ICMIC` project. Open the extracted folder containing `Start-MatchedBaseline-Fix1.ps1` and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-MatchedBaseline-Fix1.ps1
```

The project directory defaults to `C:\Users\Gozie\Desktop\Search Functionality in Blockchain\lifedb ICMIC`. The runner reuses the existing baseline Python environment. Pass `-Python`, `-Node`, `-ProjectRoot` or `-AuditRoot` if necessary. Real measurement requires PyCryptodome 3.23.0 native P256, already installed in the earlier baseline environment. No packages are installed automatically. No services or original project code are changed.

The final output line starts `MATCHED_BASELINE_REPORT_ZIP:`. Return that ZIP for review. It is created under `Results/revision_v3` in the project.

## Corrected experiment

The former 1,000-document limit is removed. The exporter now uses the existing audited Stage11 complete-posting loader, its 30,000-document/reference limits and corpus-specific payload budgets. Positive audited conjunctions and a real-keyword disjoint conjunction are mandatory in BOTH healthcare and Enron. A missing positive category, empty category or corpus stops the run before timing. No fixture replaces a failed real-data run.

All implementations use identical source records, full prepared vocabulary, query schedule, exact identifier/body oracle and common payload Merkle root. No postings or results are truncated. Requested positive arities 2,4,6,8,10 that are not admitted remain explicitly listed as missing. Setup refers to the selected vocabulary projection, not a full-vocabulary index.

| Profile | Meaning |
|---|---|
| privsearch-merkle-v2 | Frozen full-row Merkle PrivSearch with native encrypted-payload verification and an offline trusted state pin reader |
| seacq-basic-derived | Existing modified hardened Stage13 SeaCQBasic-derived RSA identifier implementation |
| daks-paper-reconstruction | Independent offset-object/CMPS reconstruction with greedy covering and P256; authorized clients share the owner verification secret |

Use these exact qualifications in tables. The original SeaCQ author's failed controls remain recorded. This experiment does not relabel that code as repaired or solve its dynamic HMAC/blinding problem. The DAKS code is independent implementation work, rather than the authors' C++ artifact. Its greedy cover is checked against exact shortest paths on small datasets. Its dynamic updates still rebuild positional lists with tag reuse, so update efficiency is outside the measured scope.

Prepared-empty keyword queries in DAKS's qualification fixtures use extra trusted count provisioning. The matched benchmark excludes them. Its empty-result queries use genuine nonempty postings with an empty intersection.

## Common measurement boundary

Each profile performs native verification and returns the exact original record bytes. A common independently pinned Merkle payload wrapper establishes the same final body-authentication contract. Additional wrapper material is charged. Bodies already returned by PrivSearch or DAKS are reused; there is no second body transfer. SeaCQ-derived obtains bodies through the wrapper. Native costs remain visible.

By default: three fresh owner/key setups per corpus/profile, one excluded warmup per query/setup, ten measured repetitions per query/setup. Each block has an identical query schedule across profiles and a randomized profile order. Workers run sequentially to bound memory and avoid inter-profile CPU contention. Each profile has its own worker process; its owner/server/client objects are logical roles within that worker, not an OS-sandboxed deployment.

Query time includes request generation, JSON encoding/decoding, local server computation, native verification and shared payload authentication. Exact oracle checks are outside that timer. Setup is separate. Component timers may nest: use the directly measured total. Response bytes include native retrieval packets and additional wrapper proofs. Started jobs, completed jobs and partial failures are retained atomically.

This is an **offline matched static implementation comparison**. It does not measure MongoDB, MinIO, actual HTTP transport, live blockchain observations, finality, WAN latency, multi-client throughput or dynamic updates. Actual worker process wall time is recorded separately from the local algorithm timer. Warm measurements are not described as cold-disk costs.

Node/Python runtimes and arithmetic backends differ. The frozen profiles also use different native parameter strengths: 2048-bit RSA/MODP14 versus P256. Their confidentiality/leakage properties differ. Therefore these data compare the declared implementations at their recorded settings; they do not establish equal privacy, equal security strength or a ranking of unchanged published protocols. Published graph values are not merged with these measurements.

## Reading the result

`matched/summary.json` must have status `MATCHED_STATIC_IMPLEMENTATION_COMPARISON_COMPLETE` and `matched_implementation_comparison_complete: true`. Its separate `published_system_comparison_qualified` flag remains false because modified/reconstructed implementations are being measured.

`matched/comparison.csv` places per-query medians and response bytes for all three profiles side by side. `matched/attempts.csv` contains warmup and measured rows. Each profile JSON contains setup, query timings, byte counts, input digest, payload root and job accounting. `source-selection.json` retains audit identity and exclusions. Any STOPPED status or incomplete accounting must be resolved before interpreting a comparison table.

Use descriptive per-query paired results. Repetitions of the same queries are not independent samples from a query population. No general speedup, confidence interval or deployed end-to-end claim is generated automatically.

Private corpus exports and private query plans are removed before report packaging. Keys, raw records, body bytes and returned identifiers are excluded from the ZIP. Aggregate counts and digests remain.

The earlier 32 native-profile and 63 DAKS controls are retained as successful prior evidence. This runner executes the new shared-boundary/coverage tests and the updated greedy DAKS qualification, rather than repeating the entire earlier study. Included local evidence is synthetic. Your audited Windows corpus comparison still needs to run.
