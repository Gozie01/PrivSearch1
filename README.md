# PrivSearch

Complete-result authentication for expressive encrypted search in hybrid blockchain systems.

This revision packages the hash-pinned complete-posting implementation used by the Stage20 live study, the fixed matched-baseline package, and the private-replica privacy experiment. It replaces the previous README's sampled-RSA description. Historical files already in the repository are retained; only the files enumerated in `release/files.sha256.json` belong to this reviewed source batch. “Verified” here means the stated source-hash and test checks, not journal acceptance or a blanket security certification.

## Mechanism and boundaries

The owner commits encrypted posting manifests, query-planning policy, and payload descriptors to a versioned state. The trusted client authenticates complete posting openings, reconstructs exact token-DNF results, and verifies the corresponding original payload bytes. MongoDB stores the encrypted index and descriptors; MinIO stores encrypted payloads. An independent client-side reader checks the intended PureChain state before verification and before release. Querying an established revision requires no new anchoring transaction.

Supported planning operations are conjunction, disjunction, OR-of-AND, prepared temporal ranges, bounded fuzzy expansion, and owner-declared alias unions. Alias retrieval is not embedding ranking or unrestricted semantic recall. Completeness assumes honest indexing and trusted planning. Depth-one RPC observations establish conditional state consistency, not deterministic consensus finality. Client-local request binding is not durable distributed replay prevention.

Remote encrypted search retains structural leakage. The separate private replica downloads the complete selected encrypted snapshot and executes queries locally. Its empty query-phase HTTP projection applies only to the capsule endpoint after trusted bootstrap; whole-system timing privacy, live replica freshness, incremental refresh, and revocation are not established.

## Selected source batch

| Location | Purpose |
|---|---|
| `contracts/PrivSearchStateAnchor.sol` | Owner-authorized versioned state anchoring |
| `scripts/privsearch/stage17-*` | Complete-row Merkle authentication, planning, and payload binding |
| `scripts/privsearch/stage19-*` | Parallel group arithmetic |
| `scripts/privsearch/stage20-*` and `scripts/benchmark-privsearch-stage20.js` | Live serial/parallel study |
| Earlier files listed in the release manifest | Frozen dependencies and qualification history required by evidence gates; not alternative current claims |
| `PrivSearch_Matched_Baseline_v2_Fix1/` | Static comparison against hardened SeaCQ-derived and independently reconstructed DAKS profiles |
| `PrivSearch_Real_Corpus_Privacy/` | Prior offline query-inference study |
| `PrivSearch_Privacy_Mitigation_Fix2/` | Fixed private-replica experiment and isolated self-tests |
| `release/` | Source inventory, verification utility, report catalogue, and packaging notes |

The matched package includes its separately pinned `application/` snapshot. This duplication preserves its original relative paths and integrity checks. Superseded standalone Fix1/base privacy and matched packages were not added in this batch.

## Evidence retained in the supplied reports

| Study | Recorded outcome |
|---|---|
| Stage20 live serial/parallel | 960 measured attempts; 959 verified and one failure; 319 successful measurement pairs with identical normalized packets |
| Matched static comparison | 900 measured attempts and 90 excluded warmups; completion status `MATCHED_STATIC_IMPLEMENTATION_COMPARISON_COMPLETE` |
| Private-replica study | 1,584 completed successful experiment cells, 792 per mode; this is experiment completion, not proof of inference resistance |

`release/report-catalogue.json` records original summary hashes and selected accounting fields. It is a derived catalogue, not a substitute for the original evidence files accepted by the runners' exact-hash gates. Raw report summaries, datasets, returned records, secrets, and local environment files are not published by this batch. Real runs require original source data and the approved evidence directories; do not edit pins or bypass gates to accommodate missing inputs.

The manuscript's 103 expressive cases are not claimed as newly reproduced by this release: the standalone expressive-validation implementation was not supplied. The committed planning implementation and its tests are included.

## Environment

Reported Windows evaluation host: AMD Ryzen 7 7700 (8 cores/16 threads), 32 GiB RAM, Windows 11 Pro 25H2 build 26200.9711; project on a Crucial CT1000T500SSD8 NVMe SSD. Docker volume physical placement and Docker-wide resource limits were not confirmed.

| Component | Reported version or boundary |
|---|---|
| Live Node.js / libuv | v24.22.0 / v1.52.1 |
| Matched Node.js | v24.15.0 |
| DAKS Python / PyCryptodome | v3.10.11 / v3.23.0, native P256 |
| MongoDB | v7.0.31, separate Linux Docker container |
| MinIO | RELEASE.2025-09-07T16-13-09Z, separate Linux Docker container |
| Container limits | No explicit per-container CPU or memory limits; persistent Docker volumes |
| PureChain | Chain ID 900520900520; consensus, validator count, and host placement remain unconfirmed |

A subsequent RPC diagnostic reported `PureChain/PureChain-Idle-Hub/v1.13.15-purechain-1.0.1-e797061c-20261013/linux-amd64/go1.21.12`; this is not independently established as the historical version for every measured run.

The reader's default RPC transport timeout is 15 s. Its bounded policy allows at most three whole-observation attempts with 250 ms delay for specified block/header errors. It does not retry whole queries or fall back to a weaker selector/finality policy. The intervening RPC gate and provider topology must be considered separately.

`package-lock.json` pins the supplied dependency snapshot. Its versions are dependency records, not proof of which modules were loaded in past measurements. The package and lockfile dependency declarations agree.

## Verify and run synthetic checks

```sh
git clone https://github.com/Gozie01/PrivSearch1.git
cd PrivSearch1
python release/verify_release.py
```

The core synthetic checks below use Node's built-in test runner and do not require live service credentials:

```sh
node --test scripts/test-privsearch-stage19.js
node --test scripts/test-privsearch-stage20.js
python PrivSearch_Matched_Baseline_v2_Fix1/verify-package.py
python -m unittest discover -s PrivSearch_Matched_Baseline_v2_Fix1 -p "test*.py"
```

Run the privacy self-tests from the repository root in PowerShell:

```powershell
$env:PRIVSEARCH_PRIVACY_PROJECT_ROOT = (Get-Location).Path
node --test --test-reporter=tap .\PrivSearch_Privacy_Mitigation_Fix2\test-mitigation.js
Remove-Item Env:PRIVSEARCH_PRIVACY_PROJECT_ROOT
```

The privacy test harness enforces synthetic-source isolation. Do not disable it. Running its PowerShell study wrapper is a separate real-corpus operation, not just a test.

For live services, install the supplied locked Node dependencies with `npm ci` and provision MongoDB, MinIO, and the appropriate owner/client RPC configuration separately. Never commit private keys or `.env` files. Read `scripts/preflight-privsearch-stage1.js` for the exact supported configuration rather than reusing the obsolete environment-variable table from the previous README.

## Real-data reproduction

Live execution requires audited Enron/healthcare source collections, an existing MinIO bucket, approved authority pins, the deployed contract, authorized owner signing material, and the exact approved prior report directories. Source-selection and cryptographic-preparation costs are distinct from warmed query timing. Obtain source datasets under their own terms; the repository does not grant redistribution rights.

The live command accepts explicit evidence directories:

```sh
node scripts/benchmark-privsearch-stage20.js --stage19 PATH_TO_APPROVED_STAGE19_REPORT --stage18 PATH_TO_APPROVED_STAGE18_REPORT
```

Consult the runner's parser and its evidence gates for other required paths/configuration. Successful synthetic checks do not reproduce live timings.

For the matched experiment, read `PrivSearch_Matched_Baseline_v2_Fix1/README.md` and pass your project, audit, Node, and Python paths explicitly when using its Windows wrapper. PyCryptodome 3.23.0 is required for the native DAKS arithmetic. For privacy, read `PrivSearch_Privacy_Mitigation_Fix2/README.md`; select `--fixture`, `--evidence-only`, or `--real-corpus` explicitly. Evidence-only validation is not experiment completion.

## Interpretation

The comparison aligns selected records, static predicates, original output bytes, and charged local work. The profiles differ in leakage, trust, runtimes, and cryptographic parameter strengths. They do not establish equal-security superiority over the published SeaCQ or DAKS protocols. Matched timings exclude live storage, transport, and chain observation. Live results use a single application host and loopback HTTP; small-query concurrency is not wide-conjunction throughput. Full-vocabulary scalability and WAN deployment performance are not established.

Lower measured native client-stage time can coexist with larger responses and slower total queries. Complete posting verification has posting-dependent communication and computation costs. The private replica trades selective remote requests for full bootstrap and client storage.

## Publication and licensing

This README does not assert journal submission or acceptance status. Cite the final published article or an identified preprint when available. The previous README's statement of MIT/CC BY licensing was not backed by supplied licence files; this update does not grant or change licences. Review applicable project and third-party terms before reuse or redistribution.
