# PrivSearch Cryptographic Overhead Analysis Plan

This file defines the stronger cryptographic-overhead decomposition for the PrivSearch paper. Rather than reporting only a single number such as:

`verification = 33 ms`

the cost should be broken into the major cryptographic and authenticated-search components:

`trapdoor generation`

`encrypted postings retrieval`

`proof construction`

`proof verification`

`blockchain verification`

## 1. Why This Decomposition Matters

A single verification number hides where the real cost comes from. For a stronger systems paper, we should show whether overhead is dominated by:

- client-side cryptographic query preparation
- encrypted posting access
- server-side proof assembly
- client-side proof checking
- blockchain-backed validator or threshold verification

This lets the paper make a much sharper claim about where PrivSearch spends time and why.

## 2. Target Phase Decomposition

The recommended phase breakdown for each query is:

| Phase | Meaning |
|---|---|
| trapdoor generation | deriving HMAC- or key-based query trapdoors from user keywords or clauses |
| encrypted postings retrieval | locating and decrypting the encrypted posting entries for the trapdoors |
| proof construction | assembling authenticated roots, accumulator witnesses, counts, membership samples, and response proof object |
| proof verification | verifying auth roots, accumulator consistency, membership witnesses, and result completeness checks |
| blockchain verification | verifying blockchain-backed commitment, validator threshold confirmation, or equivalent on-chain trust anchor evidence |

For paper wording, this is much better than saying only "verification latency."

## 3. Current State of the PrivSearch Prototype

The current prototype directly measures only:

| Current Metric | What It Covers |
|---|---|
| `setup_ms` | trapdoor derivation and query normalization |
| `search_ms` | encrypted posting retrieval, clause evaluation, and some proof-object assembly |
| `verify_ms` | local proof verification and membership checking |

This is visible in the current engine:

- [privsearch-prototype-engine.js](</C:/Users/Gozie/Desktop/Search Functionality in Blockchain/lifedb ICMIC/scripts/privsearch/engines/privsearch-prototype-engine.js>)

So the present benchmark is already useful, but it is still too coarse for a full cryptographic-overhead analysis.

## 4. Honest Mapping from Current Measurements

With the current implementation, the best honest approximation is:

| Desired Phase | Current Measured Location |
|---|---|
| trapdoor generation | mostly inside `setup_ms` |
| encrypted postings retrieval | mostly inside `search_ms` |
| proof construction | currently mixed into `search_ms` |
| proof verification | mostly inside `verify_ms` |
| blockchain verification | measured separately in distributed-validation benchmarks, not inline in query timing |

This means the paper should not yet claim that proof construction is already independently measured unless we instrument it directly.

## 5. Current Evidence Already Available

### 5.1 Query-side phase evidence

From the current healthcare phase breakdown:

- weighted mean setup ms: `0.3293`
- weighted mean search ms: `5.1857`
- weighted mean verify ms: `33.4175`
- weighted mean total ms: `38.9325`

Source:

- [privsearch_healthcare_phase_breakdown.md](</C:/Users/Gozie/Desktop/Search Functionality in Blockchain/lifedb ICMIC/Results/paper_assets/privsearch_healthcare_phase_breakdown.md>)

This already tells us that the dominant cost in the healthcare benchmark is proof/authentication-side verification rather than raw postings lookup.

### 5.2 Blockchain verification evidence

Blockchain-backed validation cost is already measured separately in the WAN/distributed-validation artifacts.

Relevant source:

- [distributed_validation_wan.csv](</C:/Users/Gozie/Desktop/Search Functionality in Blockchain/lifedb ICMIC/Results/paper_assets/distributed_validation_wan.csv>)

Those artifacts already expose metrics such as:

- `threshold_verify_mean_ms`
- `full_verify_mean_ms`
- end-to-end threshold/full validation latency

So the blockchain verification stage is not missing from the project; it is simply measured in a separate benchmark path rather than inline with each query result.

## 6. Recommended New Reporting Table

The paper should add a table like this:

| Query Family | Trapdoor Gen (ms) | Encrypted Postings Retrieval (ms) | Proof Construction (ms) | Proof Verification (ms) | Blockchain Verification (ms) | Total (ms) |
|---|---:|---:|---:|---:|---:|---:|
| single_keyword |  |  |  |  |  |  |
| and_2 |  |  |  |  |  |  |
| and_4 |  |  |  |  |  |  |
| or_2 |  |  |  |  |  |  |
| or_3 |  |  |  |  |  |  |
| or_of_and |  |  |  |  |  |  |
| range_month_1 |  |  |  |  |  |  |
| range_month_3 |  |  |  |  |  |  |
| range_year_2 |  |  |  |  |  |  |
| range_year_3 |  |  |  |  |  |  |
| semantic_v1 |  |  |  |  |  |  |

## 7. Strongest Figure to Plot

The cleanest figure is a stacked bar chart:

| Bar Segment | Meaning |
|---|---|
| trapdoor generation | client cryptographic preparation cost |
| encrypted postings retrieval | encrypted index access cost |
| proof construction | server authentication-assembly cost |
| proof verification | client verifier cost |
| blockchain verification | commitment-validation cost |

One stacked bar per query family will immediately show which component dominates.

## 8. How to Instrument the Prototype

The next step is to instrument the query engine with explicit timers around each cryptographic stage.

### 8.1 Trapdoor generation timer

Inside `runQuery`, isolate:

- query normalization
- `deriveTrapdoor(keyword)` calls

This should produce:

`trapdoor_generation_ms`

### 8.2 Encrypted postings retrieval timer

Inside the clause loop, isolate:

- `decryptPostingByToken(tokenHex)` calls

This should produce:

`encrypted_postings_retrieval_ms`

### 8.3 Proof construction timer

Inside the clause loop, isolate the work that builds:

- `posting_auth_roots`
- `posting_accumulators`
- `posting_counts`
- membership sample metadata
- response proof object

This should produce:

`proof_construction_ms`

### 8.4 Proof verification timer

Inside the verification section, isolate:

- auth-root checks
- accumulator-root checks
- posting-count checks
- clause recomputation checks
- membership witness verification

This should produce:

`proof_verification_ms`

### 8.5 Blockchain verification timer

This depends on how tightly you want to couple query verification to blockchain validation.

There are two acceptable approaches:

| Approach | Meaning |
|---|---|
| inline mode | validate the query proof against a current blockchain commitment during the query benchmark |
| linked-benchmark mode | report blockchain verification from the WAN/distributed-validation benchmark as a separate but attached phase |

For the current project, linked-benchmark mode is the safer immediate path because the blockchain verification machinery is already benchmarked there.

## 9. Recommended Output Fields

The benchmark result rows should eventually include:

| Output Field | Meaning |
|---|---|
| `trapdoor_generation_ms` | keyword-to-trapdoor derivation time |
| `encrypted_postings_retrieval_ms` | token lookup and posting decryption time |
| `proof_construction_ms` | proof assembly time |
| `proof_verification_ms` | local proof-checking time |
| `blockchain_verification_ms` | validator/commitment verification time |
| `crypto_total_ms` | sum of the five components |

This gives the paper a clean cryptographic-overhead dataset rather than a single black-box verification number.

## 10. How to Interpret the Results

The strongest interpretation framework is:

| If This Phase Dominates | Likely Meaning |
|---|---|
| trapdoor generation | cryptographic query preparation is the bottleneck |
| encrypted postings retrieval | encrypted index access is the bottleneck |
| proof construction | server-side authenticated response assembly is the bottleneck |
| proof verification | client-side authentication checks dominate |
| blockchain verification | trust-anchor or distributed-validation cost dominates |

This is much stronger than simply saying "verification was expensive."

## 11. Manuscript-Ready Summary Sentence

If you want a short paper sentence for this section, use:

> To expose the true source of authentication overhead, we decompose PrivSearch latency into trapdoor generation, encrypted-postings retrieval, proof construction, proof verification, and blockchain-backed verification, rather than reporting only a single aggregate verification time.

## 12. Best Next Step

The next implementation-grade artifact should be:

`Results/paper_assets/privsearch_crypto_overhead_results.md`

backed by:

- one CSV with the five cryptographic phases per query family
- one stacked-bar figure for query-family comparison
- one summary table for manuscript insertion

Until that instrumentation is added, the paper should describe the current `setup/search/verify` results as a coarse precursor to the finer cryptographic-overhead decomposition.

## 13. Current Executable Artifact

This project now has the first executable timer-enabled crypto-overhead path:

- benchmark command:
  `node scripts/benchmark-privsearch-workloads.js`
- analysis command:
  `npm run privsearch:analyze:crypto`

The current implementation now measures inline query-side phases in:

- [privsearch-prototype-engine.js](</C:/Users/Gozie/Desktop/Search Functionality in Blockchain/lifedb ICMIC/scripts/privsearch/engines/privsearch-prototype-engine.js>)

and generates:

- [privsearch_crypto_overhead_results.md](</C:/Users/Gozie/Desktop/Search Functionality in Blockchain/lifedb ICMIC/Results/paper_assets/privsearch_crypto_overhead_results.md>)
- [privsearch_crypto_overhead_results.csv](</C:/Users/Gozie/Desktop/Search Functionality in Blockchain/lifedb ICMIC/Results/paper_assets/privsearch_crypto_overhead_results.csv>)
- [privsearch_crypto_overhead_results.json](</C:/Users/Gozie/Desktop/Search Functionality in Blockchain/lifedb ICMIC/Results/paper_assets/privsearch_crypto_overhead_results.json>)

The current executable interpretation is:

1. trapdoor generation is measured directly
2. encrypted-postings retrieval is measured directly
3. proof construction is measured directly
4. proof verification is measured directly
5. blockchain verification remains an external reference phase from `Results/paper_assets/distributed_validation_wan.csv`
