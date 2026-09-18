# PrivSearch Formal Claims

This note collects the main proof-oriented claims for the current PrivSearch manuscript in one place so they can be inserted directly into the paper.

## 1. Theorem for OR-Query Correctness

**Setting.** Let the query be a disjunctive keyword query

`Q_or = w1 OR w2 OR ... OR wm`

or, more generally, a disjunction of authenticated clauses. For each keyword or clause `ci`, let `R(ci)` be the true result set over the outsourced dataset, and let the server return an authenticated answer `A(ci)` together with the verification object `Pi(ci)`. Let client verification accept exactly when `A(ci) = R(ci)`.

**Theorem 1 (Authenticated OR-query correctness).** If every returned clause answer `A(ci)` is accepted by the verifier and the final OR result is computed by deduplicated union,

`A_or = A(c1) U A(c2) U ... U A(cm),`

then `A_or` is exactly the true OR-query result

`R_or = R(c1) U R(c2) U ... U R(cm).`

**Proof sketch.**

1. By per-clause authenticated correctness, verifier acceptance implies `A(ci) = R(ci)` for each clause `ci`.
2. Substitute equal sets into the union expression:
   `A_or = R(c1) U R(c2) U ... U R(cm)`.
3. Deduplication removes repeated document identifiers but does not remove any unique valid result.
4. Therefore every document satisfying at least one clause appears in `A_or`, and no document failing all clauses appears in `A_or`.
5. Hence `A_or = R_or`.

**Consequence.** PrivSearch OR search is correct provided each contributing authenticated clause is individually correct and the union step is deterministic and duplicate-safe.

## 2. Theorem for Range-Query Correctness

**Setting.** Let records carry authenticated metadata values from a totally ordered domain, such as year or month. Let the query be a closed interval

`Q_range = [a, b]`

and let `R_range` denote the set of records whose authenticated metadata value `t(d)` satisfies `a <= t(d) <= b`. Let the server answer with `A_range` and proof object `P_range`, and let verification accept only if every returned record is within the interval and the authenticated coverage for the requested interval is complete.

**Theorem 2 (Authenticated range-query correctness).** If the range proof verifies, then the accepted answer set `A_range` is exactly the true range result set `R_range`.

**Proof sketch.**

1. **Soundness:** verifier checks each returned record against authenticated metadata bindings, so any accepted record must satisfy `a <= t(d) <= b`.
2. **Completeness:** verifier also checks the authenticated coverage structure for the interval, so no valid record in the indexed range can be omitted without causing verification failure.
3. From soundness, `A_range` contains no false positives.
4. From completeness, `A_range` contains no false negatives.
5. Therefore `A_range = R_range`.

**Consequence.** PrivSearch temporal range search is correct as long as the metadata index and its authenticated coverage proof are derived from the same committed dataset snapshot.

## 3. Proof Sketch for Replay Protection

**Claim.** A replayed write request that reuses previously accepted freshness material cannot cause a second accepted state mutation within the active freshness window.

**Mechanism.** PrivSearch binds each request to freshness metadata, including a nonce and timestamp. The server checks freshness before mutation and caches previously accepted nonces for the configured time-to-live window.

**Proof sketch.**

1. Let an original request `req = (payload, nonce, ts)` be accepted.
2. Acceptance inserts `nonce` into the replay cache for the active freshness window.
3. Any replayed request reusing the same `nonce` within that window is checked before state mutation.
4. Because the nonce is already marked as seen, the replay check rejects the request before the write path executes.
5. Therefore the replay cannot produce a second valid mutation from the same freshness token.

**Empirical support from current PrivSearch artifacts.**

- `Results/paper_assets/privsearch_replay_protection.md` reports:
- 200 accepted first requests
- 200 replayed requests rejected
- 100.00% replay-rejection rate
- 0.8019 ms mean replay rejection latency

These measurements do not replace the logical argument, but they do show that the replay-prevention logic is active in the implemented stack rather than only described conceptually.

## 4. Proof of Latency Independence

**Claim.** Search latency is independent of blockchain anchoring queue backlog under the PrivSearch hybrid architecture, up to ordinary measurement noise and fixed-system effects.

**Reasoning.**

1. PrivSearch search executes against the off-chain authenticated search structures rather than waiting on immediate on-chain anchoring completion.
2. The anchoring queue affects background commitment progress, but not the lookup path used to answer a read query against the current committed/searchable state.
3. Therefore backlog depth should not materially change read-query latency unless queue management shares a bottlenecked resource strongly enough to interfere with search execution.
4. In the measured system, the observed correlation between backlog level and search latency stays close to zero across tested load ratios, which is consistent with independence of the search path from queue depth.

**Experimental evidence from current artifacts.**

From `Results/paper_assets/queue_drain.md`, the reported Spearman correlations between backlog conditions and search latency were:

| lambda/mu | Spearman rho |
|---:|---:|
| 0.5 | -0.6000 |
| 1.0 | -0.1091 |
| 1.5 | -0.1000 |
| 2.0 | -0.3818 |

The manuscript-level interpretation already recorded in that artifact is:

> Spearman rho approximately equal to 0 confirms search latency is independent of queue backlog depth.

**Interpretation for the paper.** The formal claim should be stated carefully as architectural latency independence of the search path from anchoring backlog, supported by near-zero correlation in the central operating region, rather than as an absolute statement that no implementation could ever exhibit interference.

## 5. Recommended Manuscript Use

These four items are strong candidates for a short "Formal Properties and Security Arguments" subsection in the PrivSearch manuscript:

1. Theorem 1 for OR-query correctness
2. Theorem 2 for range-query correctness
3. Replay-protection proof sketch
4. Latency-independence argument with queue-drain evidence

If needed, each theorem can be shortened further into theorem-style IEEE prose for direct insertion into `CHIGOZIE_PrivSearch_Implementation_paper.md`.
