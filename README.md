# PrivSearch

**Privacy-Preserving Authenticated Search over Hybrid Blockchain**

PrivSearch is a searchable symmetric encryption (SSE) system that integrates an OXT-style encrypted inverted index with an RSA accumulator anchored to an external EVM blockchain. It enables verifiable, privacy-preserving full-text search over encrypted medical and enterprise document corpora, with cryptographic proof that every returned result is genuine and complete.

This repository contains the complete source, benchmark suite, workload manifests, and raw results accompanying the manuscript:

> C. Nadiekwe, "PrivSearch: Privacy-Preserving Authenticated Search with RSA Accumulators for Hybrid Blockchain Systems," *IEEE Transactions on Dependable and Secure Computing* (under review), 2026.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Repository Structure](#repository-structure)
3. [Prerequisites](#prerequisites)
4. [Installation](#installation)
5. [Dataset Acquisition](#dataset-acquisition)
6. [Data Preparation](#data-preparation)
7. [Running the Benchmarks](#running-the-benchmarks)
8. [Generating Paper Figures and Tables](#generating-paper-figures-and-tables)
9. [Corrected Tamper-Detection Theory](#corrected-tamper-detection-theory)
10. [Reproducibility Notes](#reproducibility-notes)
11. [Experiment Index](#experiment-index)
12. [Citation](#citation)

---

## System Overview

```
┌────────────────────────────────────────────────────────────┐
│  Client                                                     │
│   HMAC-SHA256 trapdoor  ──►  AES-256-GCM posting decrypt   │
└───────────────────┬────────────────────────────────────────┘
                    │ encrypted query
┌───────────────────▼────────────────────────────────────────┐
│  PrivSearch Server  (Node.js + MongoDB)                     │
│   Encrypted inverted index  ──►  RSA accumulator check     │
└───────────────────┬────────────────────────────────────────┘
                    │ accumulator root + Merkle witness
┌───────────────────▼────────────────────────────────────────┐
│  PureChain (external EVM, chain ID 900520900520)            │
│   Solidity 0.8.24  ·  Hardhat 2.22.19                      │
└────────────────────────────────────────────────────────────┘
```

**Key properties:**
- *Confidentiality* — keyword trapdoors are one-way HMAC-SHA256 tokens; postings are AES-256-GCM encrypted.
- *Authenticity* — each result set is verified against an RSA accumulator root committed on-chain; tampered results are detected with high probability (Table IX of the manuscript).
- *Replay resistance* — per-query nonces prevent replayed or stale proofs from being accepted.
- *Six query families* — `single_keyword`, `AND-k` (k ∈ {2,4,6,8,10}), `OR-2`, `OR-3`, `OR-of-AND`, `fuzzy` (edit distance 1), `range` (calendar window), `semantic` (top-10 concept expansion).

---

## Repository Structure

```
PrivSearch/
├── scripts/
│   ├── privsearch/                  # Engine library
│   │   ├── engines/
│   │   │   ├── privsearch-prototype-engine.js   # Core PrivSearch engine
│   │   │   ├── seacq-baseline-engine.js         # SeaCQ baseline
│   │   │   └── postings-baseline-engine.js      # Plaintext baseline
│   │   ├── engine-registry.js
│   │   ├── healthcare-tokenizer.js              # English + Han n-gram tokenizer
│   │   ├── semantic-lib.js                      # 12-concept semantic expansion
│   │   └── workload-lib.js
│   │
│   ├── prepare-enron*.js            # Enron data preparation pipeline
│   ├── prepare-healthcare*.js       # Healthcare corpus pipeline
│   ├── prepare-openfda.js           # openFDA drug/recall pipeline
│   ├── generate-healthcare-and-workloads.js
│   │
│   ├── benchmark-privsearch-workloads.js        # Main Enron latency benchmark
│   ├── benchmark-privsearch-ablation.js         # Ablation study
│   ├── benchmark-privsearch-scalability.js      # Scalability sweep
│   ├── benchmark-privsearch-resource-overhead.js
│   ├── benchmark-privsearch-witness-profiling.js# RSA witness timing
│   ├── benchmark-replay-protection.js
│   ├── benchmark-seacq-headtohead.js            # SeaCQ head-to-head
│   ├── benchmark-seacq-sample-sweep.js
│   ├── benchmark-tamper-injection.js            # Tamper detection experiment
│   ├── benchmark-tamper-small-extra.js
│   ├── benchmark-security-fuzzing.js
│   ├── benchmark-stale-proof-rejection.js
│   ├── benchmark-index-overhead.js
│   │
│   ├── analyze-privsearch-crypto-overhead.js
│   ├── analyze-privsearch-phase-breakdown.js
│   ├── generate-privsearch-paper-assets.js
│   ├── generate-privsearch-healthcare-assets.js
│   ├── generate-privsearch-statistical-rigor.js
│   ├── generate-final-privsearch-journal-tables.js
│   ├── generate-privsearch-ieee-pub-figures.py
│   ├── generate-privsearch-ieee-figures.py
│   ├── generate-privsearch-requested-figures.py
│   ├── generate-seacq-style-figure.py
│   ├── compute_corrected_tamper_table.py        # Corrected p̄_det (Table IX)
│   ├── fill-seacq-published-columns.js
│   └── run-seacq-comparison.js
│
├── src/                             # TypeScript API server and blockchain layer
│   ├── access/                      # DID auth, RBAC, field encryption
│   ├── api/                         # Express server + middleware
│   ├── blockchain/                  # Chain, consensus, validator, transactions
│   ├── crud/                        # Document CRUD
│   ├── schemas/                     # Mongoose schemas
│   ├── storage/                     # MongoDB, MinIO, IPFS, index engine
│   └── utils/
│
├── NweDB/
│   ├── enron_query_workloads/       # 310-workload Enron manifest (all families)
│   └── healthcare/
│       └── query_workloads/         # Healthcare workload manifest
│
├── Results/paper_assets/            # All benchmark output (CSV + JSON + MD)
│   ├── privsearch_*.csv/json/md     # Main latency, resource, scalability
│   ├── seacq_*.csv/json/md          # SeaCQ comparison
│   ├── tamper_*.csv/json            # Tamper injection results
│   ├── witness_profiling_*.csv/json # RSA witness timing
│   ├── stale_proof_rejection_*      # Replay / stale proof
│   ├── security_fuzzing.*           # Fuzzing results
│   ├── index_overhead.*             # Index storage overhead
│   ├── *.log                        # Raw run logs
│   └── figures/                     # Publication figures (PNG + SVG)
│
├── PrivSearch_TDSC_Manuscript/      # LaTeX manuscript
│   ├── main.tex
│   ├── new_references.bib
│   ├── sections/                    # Per-section .tex files
│   ├── pics/                        # All manuscript figures
│   └── main.pdf                     # Compiled submission PDF
│
├── docker-compose.yml               # MongoDB + MinIO services
├── hardhat.config.js                # PureChain connection
├── package.json
└── tsconfig.json
```

---

## Prerequisites

| Component | Version used | Notes |
|---|---|---|
| Node.js | v24.15.0 (OpenSSL 3.5.0) | Engine and benchmarks |
| Python | 3.11.9 | Figure generation, tamper analysis |
| Docker + Docker Compose | v29.4.0 / v5.1.1 | MongoDB and MinIO services |
| MongoDB | v7.0.31 (via `mongo:7` image) | Document store |
| MinIO | RELEASE.2025-09-07T16-13-09Z | Object store |
| Hardhat | 2.22.19 | PureChain contract deployment |
| matplotlib, numpy, scipy | latest | Python figure generation |

Install Node.js dependencies:
```bash
npm install
```

Install Python dependencies:
```bash
pip install matplotlib numpy scipy
```

---

## Installation

```bash
git clone git@github.com:Gozie01/PrivSearch-.git
cd PrivSearch-
npm install
cp .env.example .env          # edit .env with your chain RPC and keys
docker compose up -d          # starts MongoDB (port 27017) and MinIO (port 9000)
```

### Environment variables (`.env`)

| Variable | Description |
|---|---|
| `MONGO_URI` | MongoDB connection string (default: `mongodb://localhost:27017/lifedb`) |
| `MINIO_ENDPOINT` | MinIO endpoint (default: `localhost`) |
| `MINIO_PORT` | MinIO port (default: `9000`) |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | MinIO credentials |
| `CHAIN_RPC_URL` | PureChain EVM RPC endpoint |
| `DEPLOYER_PRIVATE_KEY` | Private key for contract deployment |
| `CONTRACT_ADDRESS` | Deployed accumulator contract address (set after `npx hardhat run scripts/deploy-purechain.js`) |
| `PRIVSEARCH_SECRET` | Master secret for HMAC trapdoor derivation |

---

## Dataset Acquisition

Large raw datasets are not committed to this repository. Download them separately:

### Enron Email Corpus
```bash
# Download from CMU (approx. 432 MB tar.gz)
wget https://www.cs.cmu.edu/~enron/enron_mail_20150507.tar.gz -P NweDB/
tar -xzf NweDB/enron_mail_20150507.tar.gz -C NweDB/
```
Citation: Klimt & Yang, *ECML 2004*, DOI: [10.1007/978-3-540-30115-8_22](https://doi.org/10.1007/978-3-540-30115-8_22)

### eICU Collaborative Research Database (v2.0.1)
Access requires credentialing via PhysioNet:
1. Complete CITI training and register at [physionet.org](https://physionet.org)
2. Request access to [eICU-CRD v2.0.1](https://physionet.org/content/eicu-crd/2.0.1/)
3. Download and place CSVs in `NweDB/healthcare/eicu_demo/`

Citation: Pollard et al., *Scientific Data* 5, 180178 (2018), DOI: [10.1038/sdata.2018.178](https://doi.org/10.1038/sdata.2018.178)

### MedCD (TigerResearch)
```bash
git clone https://github.com/TigerResearch/MedCD NweDB/healthcare/medcd
# Use the medcd-annotations split
```
Chinese clinical text tokenized with 2–3-gram Han character extraction (see `scripts/privsearch/healthcare-tokenizer.js`).

### openFDA
```bash
node scripts/prepare-openfda.js   # downloads drug enforcement, NDC, and recall data
```
Snapshot retrieved: 2026-06-15. Endpoints: `/drug/enforcement`, `/drug/ndc`, `/drug/recall`.

---

## Data Preparation

Run the preparation scripts in order. Each step is idempotent.

### Enron pipeline
```bash
node scripts/prepare-enron.js                  # parse raw mailboxes → JSON documents
node scripts/prepare-enron-inverted-index.js   # build encrypted inverted index → MongoDB
node scripts/prepare-enron-keywords.js         # build keyword frequency table
node scripts/prepare-enron-query-workloads.js  # generate 310-workload manifest
```

Output: `NweDB/enron_query_workloads/` (workload CSVs and JSONL) — already committed.

### Healthcare pipeline
```bash
node scripts/generate-healthcare-and-workloads.js   # combined pipeline for all three sources
# OR step by step:
node scripts/prepare-healthcare-datasets.js
node scripts/prepare-healthcare-inverted-index.js
node scripts/prepare-healthcare-keywords.js
node scripts/prepare-healthcare-query-workloads.js
```

### openFDA pipeline
```bash
node scripts/prepare-openfda.js
```

---

## Running the Benchmarks

All benchmarks require a running MongoDB + MinIO (`docker compose up -d`) and a reachable PureChain RPC.

### Main latency benchmark (Enron, all six query families)
```bash
node scripts/benchmark-privsearch-workloads.js
```
Output: `Results/paper_assets/privsearch_*.csv/json`

### Healthcare corpus benchmark
```bash
node scripts/generate-privsearch-healthcare-assets.js
```

### SeaCQ head-to-head comparison
```bash
node scripts/run-seacq-comparison.js
# or separately:
node scripts/benchmark-seacq-headtohead.js
node scripts/benchmark-seacq-sample-sweep.js
```

### Tamper detection (Table IX)
```bash
node scripts/benchmark-tamper-injection.js    # 100 trials × 48 (t, s, bucket) cells
node scripts/benchmark-tamper-small-extra.js  # additional small-bucket cells
```

> **Note on PROFILE_TRIALS**: The witness-profiling benchmark uses `PROFILE_TRIALS=1` for 2048-bit RSA to avoid a 12+ hour runtime:
> ```bash
> PROFILE_TRIALS=1 node scripts/benchmark-privsearch-witness-profiling.js
> ```

### Ablation study
```bash
node scripts/benchmark-privsearch-ablation.js
```

### Scalability sweeps
```bash
node scripts/benchmark-privsearch-scalability.js
```

### Replay and stale-proof rejection
```bash
node scripts/benchmark-replay-protection.js
node scripts/benchmark-stale-proof-rejection.js
```

### Resource overhead and index storage
```bash
node scripts/benchmark-privsearch-resource-overhead.js
node scripts/benchmark-index-overhead.js
```

### Security fuzzing
```bash
node scripts/benchmark-security-fuzzing.js
```

---

## Generating Paper Figures and Tables

```bash
# Statistical rigor tables (bootstrap CIs, permutation tests)
node scripts/generate-privsearch-statistical-rigor.js

# Final journal tables (LaTeX-ready)
node scripts/generate-final-privsearch-journal-tables.js

# Publication figures (IEEE style, PDF + PNG)
python scripts/generate-privsearch-ieee-pub-figures.py
python scripts/generate-privsearch-ieee-figures.py
python scripts/generate-privsearch-requested-figures.py
python scripts/generate-seacq-style-figure.py

# Healthcare figures
python PrivSearch_TDSC_Manuscript/pics/figure_02_redrawn/make_fig.py
```

Pre-generated figures are in `Results/paper_assets/figures/` and `PrivSearch_TDSC_Manuscript/pics/`.

---

## Corrected Tamper-Detection Theory

Table IX uses a corrected theoretical detection rate p̄_det that accounts for the nonlinearity of the hypergeometric distribution across workloads. The original approach evaluated p_det at the bucket mean result size, which overestimates detection probability for small-bucket cells. The correction:

```
p̄_det = (1/P) × Σᵢ p_det(nᵢ, t, s)
```

where the sum runs over all P eligible workloads in the cell (those with nᵢ > t), using log-space evaluation to avoid large binomial coefficients.

To recompute from the Enron benchmark CSV and the existing tamper JSON:

```bash
python scripts/compute_corrected_tamper_table.py
```

This validates that the 7-type Enron filter reconstructs exactly **310 workloads** (140 small + 84 medium + 86 large), prints the full comparison table, and writes `Results/paper_assets/tamper_corrected_theory.json`.

---

## Reproducibility Notes

| Parameter | Value |
|---|---|
| CPU | AMD Ryzen 7 7700 (8c/16t, 3.8 GHz base) |
| RAM | 32 GB DDR5 |
| Storage | NVMe SSD (Crucial CT1000T500SSD8, 1 TB PCIe) |
| OS | Windows 11 Pro 64-bit, build 26200 |
| Node.js | v24.15.0, OpenSSL 3.5.0 |
| MongoDB | v7.0.31 (Docker `mongo:7`) |
| MinIO | RELEASE.2025-09-07T16-13-09Z |
| Docker | v29.4.0 / Compose v5.1.1 |
| PureChain | External EVM, chain ID 900520900520 |
| TypeScript | 5.4.3 |
| ethers.js | v6.13.5 |
| CPU freq. scaling | Not controlled (Windows Balanced power plan) |
| Measurement | Sequential; one HTTP request per trial |
| Bootstrap CIs | 3,000 resamples; seeds 314,159 (flat), 271,828 (hierarchical) |
| Permutation tests | 10,000 resamples, two-sided; seed 42 |
| Tamper trials | 100 per (t, s, bucket) cell; OS entropy via `crypto.randomBytes()` |

Run logs for all major experiments are in `Results/paper_assets/*.log`.

---

## Experiment Index

| Experiment | Script | Output | Paper section |
|---|---|---|---|
| Main Enron latency | `benchmark-privsearch-workloads.js` | `privsearch_extension_summary.*` | §5A |
| Healthcare latency | `generate-privsearch-healthcare-assets.js` | `privsearch_healthcare_phase_breakdown.*` | §5B |
| Ablation | `benchmark-privsearch-ablation.js` | `privsearch_ablation_results.*` | §5C |
| SeaCQ head-to-head | `benchmark-seacq-headtohead.js` | `seacq_headtohead_enron.*` | §5D |
| Scalability (postings) | `benchmark-privsearch-scalability.js` | `privsearch_scalability_postings.csv` | §5E |
| Scalability (clauses) | `benchmark-privsearch-scalability.js` | `privsearch_scalability_clause_count.csv` | §5E |
| Scalability (corpus) | `benchmark-privsearch-scalability.js` | `privsearch_scalability_corpus.csv` | §5E |
| Resource overhead | `benchmark-privsearch-resource-overhead.js` | `privsearch_resource_overhead_results.*` | §5F |
| Crypto overhead | `analyze-privsearch-crypto-overhead.js` | `privsearch_crypto_overhead_results.*` | §5F |
| Tamper detection | `benchmark-tamper-injection.js` | `tamper_injection.*` | §5G |
| RSA witness profiling | `benchmark-privsearch-witness-profiling.js` | `witness_profiling_enron.*` | §5H |
| Replay / stale proof | `benchmark-replay-protection.js` | `privsearch_replay_protection.*` | §5I |
| Security fuzzing | `benchmark-security-fuzzing.js` | `security_fuzzing.*` | §5J |
| Index overhead | `benchmark-index-overhead.js` | `index_overhead.*` | §5K |
| Statistical rigor | `generate-privsearch-statistical-rigor.js` | `privsearch_statistical_rigor.*` | §5L |

---

## Citation

If you use this code or data, please cite:

```bibtex
@article{Nadiekwe2026PrivSearch,
  author  = {Chigozie Nadiekwe},
  title   = {{PrivSearch}: Privacy-Preserving Authenticated Search
             with {RSA} Accumulators for Hybrid Blockchain Systems},
  journal = {IEEE Transactions on Dependable and Secure Computing},
  year    = {2026},
  note    = {Under review}
}
```

---

## License

Source code is released under the MIT License.
Benchmark data and manuscript figures are released under CC BY 4.0.
The Enron email corpus and eICU database are subject to their own terms of use — consult their respective sources before redistribution.
