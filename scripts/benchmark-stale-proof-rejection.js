// benchmark-stale-proof-rejection.js
//
// R3: Measures how quickly PrivSearch detects a stale (pre-update) accumulator
// proof when the index changes between proof generation and verification.
//
// Protocol:
//   Phase 1 (I₁): Prepare engine from live index.  Run each workload query,
//     capture the accumulator root and one membership witness from the returned
//     proof_hints (P₁).
//   Phase 2 (update): Inject `delta` fake doc IDs into the relevant posting
//     list to simulate an honest index update.  Recompute the new accumulator
//     root A₂ from scratch (O(|list|+delta) modPow operations).
//   Phase 3 (rejection check): Verify the OLD witness from P₁ against A₂.
//     This must fail — the witness was valid for A₁ but not A₂.
//   Sweep delta ∈ {1, 5, 10, 25, 50} across k ∈ {2,4,6,8,10}.
//
// Outputs: Results/paper_assets/stale_proof_rejection.*
//
// Usage:
//   node scripts/benchmark-stale-proof-rejection.js
//   H2H_DATASET=healthcare node scripts/benchmark-stale-proof-rejection.js

require('dotenv/config');

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { performance } = require('perf_hooks');
const { loadWorkloads, writeCsv } = require('./privsearch/workload-lib');
const { createEngine }            = require('./privsearch/engine-registry');

// ── Config ────────────────────────────────────────────────────────────────────
const ROOT        = path.resolve(__dirname, '..');
const DATASET     = process.env.H2H_DATASET || 'enron';
const TRIALS      = Number(process.env.SPR_TRIALS || '50');
const OUTPUT_ROOT = path.join(ROOT, 'Results', 'paper_assets');
const UPDATE_SIZES = [1, 5, 10, 25, 50];
const CONJUNCTIVE_SIZES = [2, 4, 6, 8, 10];
const PER_K = Number(process.env.SPR_PER_K || '2');

const DATASET_PATHS = {
  enron: {
    workloadRoot: path.join(ROOT, 'NweDB', 'enron_query_workloads'),
    indexRoot:    path.join(ROOT, 'NweDB', 'enron_inverted_index'),
    corpusLabel:  'Enron-derived',
  },
  healthcare: {
    workloadRoot: path.join(ROOT, 'NweDB', 'healthcare', 'query_workloads'),
    indexRoot:    path.join(ROOT, 'NweDB', 'healthcare', 'inverted_index'),
    corpusLabel:  'Healthcare (281,042 records)',
  },
};

const { workloadRoot, indexRoot, corpusLabel } = DATASET_PATHS[DATASET] || DATASET_PATHS.enron;

// ── RSA accumulator constants (must match engine) ──────────────────────────────
// 2048-bit RSA accumulator modulus (product of two 1024-bit primes; factors discarded).
const ACCUMULATOR_MODULUS   = 21619096241149106944198064176012845267474146912799435543840066799609824807872458451164932298732969327451665891370724119674704689602655616655183655863148660544426735184751056510303931724990717171890718395134776999605428156933577128331266626506454148707350768496797675823300858666984776263564910634201436738912649326839152652138901860445102767217958976509703955707411089458040495687821355184097773154587786097493354138273408398927586945579360474775419118904663850293880092848361645585097768459001594869314275648156708656378259072576843335864502808624467547488490102960304305213364034711017640989096983108511677259039881n;
const ACCUMULATOR_GENERATOR = 5n;
const PRIME_SEARCH_MASK     = (1n << 61n) - 1n;
const MILLER_RABIN_BASES    = [2n, 3n, 5n, 7n, 11n, 13n, 17n];

function modPow(base, exponent, modulus) {
  let result = 1n, power = base % modulus, exp = exponent;
  while (exp > 0n) {
    if (exp & 1n) result = (result * power) % modulus;
    power = (power * power) % modulus;
    exp >>= 1n;
  }
  return result;
}

function isProbablePrime(n) {
  if (n < 2n) return false;
  const small = [2n,3n,5n,7n,11n,13n,17n,19n,23n,29n];
  for (const p of small) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n, r = 0n;
  while ((d & 1n) === 0n) { d >>= 1n; r += 1n; }
  for (const base of MILLER_RABIN_BASES) {
    if (base >= n - 2n) continue;
    let x = modPow(base, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let i = 1n; i < r; i += 1n) {
      x = modPow(x, 2n, n);
      if (x === n - 1n) { composite = false; break; }
    }
    if (composite) return false;
  }
  return true;
}

function nextProbablePrime(start) {
  let c = start | 1n;
  while (!isProbablePrime(c)) c += 2n;
  return c;
}

function sha256Buffer(...parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) Buffer.isBuffer(p) ? h.update(p) : h.update(String(p), 'utf8');
  return h.digest();
}

// Derive the same doc prime the engine would use (must match engine's masterKey).
// We re-derive from the engine's master key exposed via a helper call.
function hashDocIdToPrime(docId, masterKey) {
  const digest    = sha256Buffer(masterKey, `doc:${docId}`);
  let   candidate = (BigInt(`0x${digest.toString('hex')}`) & PRIME_SEARCH_MASK) | 1n | (1n << 60n);
  if (candidate % 2n === 0n) candidate += 1n;
  return nextProbablePrime(candidate);
}

function accumulatePrimes(primes) {
  let acc = ACCUMULATOR_GENERATOR;
  for (const p of primes) acc = modPow(acc, p, ACCUMULATOR_MODULUS);
  return acc;
}

function computeStats(values) {
  if (!values.length) return { n:0, mean:0, median:0, min:0, max:0 };
  const sorted = [...values].sort((a,b) => a-b);
  const n = sorted.length;
  const mean = sorted.reduce((s,v) => s+v, 0) / n;
  return { n, mean, median: sorted[Math.floor(n/2)], min: sorted[0], max: sorted[n-1] };
}

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  ensureDir(OUTPUT_ROOT);
  console.log(`\n=== Stale-proof rejection benchmark (${corpusLabel}) ===`);
  console.log(`Trials: ${TRIALS}  |  delta ∈ {${UPDATE_SIZES.join(',')}}  |  k ∈ {${CONJUNCTIVE_SIZES.join(',')}}`);

  // Load workloads
  const allWorkloads = loadWorkloads({ workloadRoot });
  const selected = CONJUNCTIVE_SIZES.flatMap(k => {
    const qt = `and_${k}`;
    return allWorkloads.filter(w => w.query_type === qt).slice(0, PER_K);
  }).filter(w => (w.expected_result_count || 0) > 0);

  if (!selected.length) {
    console.error('No conjunctive workloads found. Check workloadRoot:', workloadRoot);
    process.exitCode = 1; return;
  }
  console.log(`Selected ${selected.length} workloads.\n`);

  // Prepare engine
  console.log('Preparing PrivSearch engine …');
  const engine = createEngine('privsearch-prototype', { indexRoot });
  await engine.prepare(selected);

  // Expose masterKey for prime derivation (engine stores it as Buffer)
  const masterKey = engine.masterKey;

  const results = [];

  for (const query of selected) {
    process.stdout.write(`  ${query.query_id} (k=${query.keywords.length}) … `);

    // Phase 1: run query at I₁, extract proof P₁
    const r1 = await engine.runQuery(query);
    if (!r1.proof_hints || !r1.proof_hints[0]) {
      process.stdout.write('no proof_hints, skip\n');
      continue;
    }

    const clause0 = r1.proof_hints[0];
    // Need the live postingEntry for the first keyword to get its primes + accumulator
    const kw0     = query.keywords[0];
    const tok0    = engine.deriveTrapdoor(kw0);
    const entry0  = engine.decryptPostingByToken(tok0);

    if (!entry0 || !entry0.posting_primes || !entry0.posting_primes.length) {
      process.stdout.write('no primes, skip\n');
      continue;
    }

    // Capture old accumulator root (A₁) and one valid witness from P₁
    const oldRoot = entry0.accumulator_root;

    // Pick the first sampled doc and its precomputed witness
    const sampleDoc = clause0.membership_sample_docs && clause0.membership_sample_docs[0];
    if (!sampleDoc) {
      process.stdout.write('no sample doc, skip\n');
      continue;
    }

    // Build witness for sampleDoc at I₁
    const witnessBundle = engine.buildMembershipWitness(entry0, sampleDoc);
    if (!witnessBundle) {
      process.stdout.write('no witness, skip\n');
      continue;
    }

    // Sanity check: old witness should verify against old root
    const sanity = modPow(witnessBundle.witness, witnessBundle.prime, ACCUMULATOR_MODULUS) === oldRoot;
    if (!sanity) {
      process.stdout.write('sanity FAIL (witness invalid at I₁!)\n');
      continue;
    }

    const rowsByDelta = [];

    for (const delta of UPDATE_SIZES) {
      // Phase 2: compute new accumulator A₂ by adding delta fake doc primes
      const fakeDocs = Array.from({ length: delta }, (_, i) => `__fake_doc_${query.query_id}_${i}__`);
      const fakesPrimes = fakeDocs.map(d => hashDocIdToPrime(d, masterKey));
      const newPrimes = [...entry0.posting_primes, ...fakesPrimes];
      const newRoot = accumulatePrimes(newPrimes);

      // Phase 3: check stale witness against A₂ — must fail TRIALS times
      let rejections = 0;
      const detectionLatencies = [];

      for (let t = 0; t < TRIALS; t++) {
        const t0 = performance.now();
        const recomputed = modPow(witnessBundle.witness, witnessBundle.prime, ACCUMULATOR_MODULUS);
        const rejected = recomputed !== newRoot;
        const latencyMs = performance.now() - t0;
        detectionLatencies.push(latencyMs);
        if (rejected) rejections++;
      }

      const stats = computeStats(detectionLatencies);
      rowsByDelta.push({
        delta,
        rejection_rate: rejections / TRIALS,
        detection_ms_mean: stats.mean,
        detection_ms_median: stats.median,
        detection_ms_min: stats.min,
        detection_ms_max: stats.max,
      });
    }

    const allRejected = rowsByDelta.every(r => r.rejection_rate === 1.0);
    process.stdout.write(`${allRejected ? 'all rejected ✓' : 'PARTIAL REJECT!'} | detect ~${rowsByDelta[0].detection_ms_mean.toFixed(3)}ms\n`);

    results.push({
      query_id:     query.query_id,
      query_type:   query.query_type,
      keyword_count: query.keywords.length,
      result_count: r1.result_count,
      posting_list_size: entry0.posting_primes.length,
      by_delta:     rowsByDelta,
    });
  }

  // ── Aggregate by k ─────────────────────────────────────────────────────────
  const summaryByK = CONJUNCTIVE_SIZES.map(k => {
    const group = results.filter(r => r.keyword_count === k);
    if (!group.length) return null;
    return {
      keyword_count: k,
      workload_count: group.length,
      by_delta: UPDATE_SIZES.map(delta => {
        const rows = group.map(g => g.by_delta.find(d => d.delta === delta)).filter(Boolean);
        if (!rows.length) return { delta, rejection_rate: null, detection_ms_mean: null };
        return {
          delta,
          rejection_rate: rows.every(r => r.rejection_rate === 1.0) ? 1.0 : rows.reduce((s,r) => s+r.rejection_rate,0)/rows.length,
          detection_ms_mean: rows.reduce((s,r) => s+r.detection_ms_mean,0)/rows.length,
        };
      }),
    };
  }).filter(Boolean);

  // ── Write outputs ──────────────────────────────────────────────────────────
  const jsonOut = {
    generated_at:    new Date().toISOString(),
    dataset:         DATASET,
    corpus_label:    corpusLabel,
    trials:          TRIALS,
    update_sizes:    UPDATE_SIZES,
    description:     'Stale-proof rejection: old witness verified against updated accumulator root. rejection_rate=1 means the old proof is always correctly rejected.',
    summary_by_keyword_count: summaryByK,
    per_workload_results: results,
  };

  fs.writeFileSync(
    path.join(OUTPUT_ROOT, `stale_proof_rejection_${DATASET}.json`),
    JSON.stringify(jsonOut, null, 2), 'utf8',
  );

  // CSV: one row per (k, delta)
  const csvRows = [['k', 'delta_docs_added', 'workloads', 'rejection_rate', 'detection_ms_mean']];
  for (const s of summaryByK) {
    for (const d of s.by_delta) {
      csvRows.push([s.keyword_count, d.delta, s.workload_count,
        d.rejection_rate !== null ? d.rejection_rate.toFixed(4) : '',
        d.detection_ms_mean !== null ? d.detection_ms_mean.toFixed(4) : '']);
    }
  }
  writeCsv(path.join(OUTPUT_ROOT, `stale_proof_rejection_${DATASET}.csv`), csvRows);

  // Markdown
  const f = (v, d=3) => (v == null ? 'N/A' : Number(v).toFixed(d));
  const mdLines = [
    `# Stale-Proof Rejection Benchmark (${corpusLabel})`,
    '',
    `**Run:** ${new Date().toISOString()}`,
    `**Trials:** ${TRIALS}  |  **delta ∈ {${UPDATE_SIZES.join(',')}}** (docs added to posting list)`,
    '',
    '## Interpretation',
    'rejection_rate = 1.0 means the stale witness was correctly rejected 100% of trials.',
    'detection_ms is the time to run one modPow check and compare against the updated root.',
    '',
    '## Summary',
    '',
    '| k | delta | rejection_rate | detect_ms (mean) |',
    '|---|---:|---:|---:|',
    ...summaryByK.flatMap(s => s.by_delta.map(d =>
      `| ${s.keyword_count} | +${d.delta} | ${f(d.rejection_rate,4)} | ${f(d.detection_ms_mean,4)} |`
    )),
  ];
  fs.writeFileSync(path.join(OUTPUT_ROOT, `stale_proof_rejection_${DATASET}.md`), mdLines.join('\n'), 'utf8');

  // Console summary
  console.log('\n── Stale-Proof Rejection Summary ────────────────────────────────');
  console.log('k'.padEnd(4) + 'delta'.padStart(8) + 'reject_rate'.padStart(14) + 'detect_ms'.padStart(12));
  for (const s of summaryByK) {
    for (const d of s.by_delta) {
      console.log(
        String(s.keyword_count).padEnd(4) +
        String(`+${d.delta}`).padStart(8) +
        f(d.rejection_rate,4).padStart(14) +
        f(d.detection_ms_mean,4).padStart(12),
      );
    }
  }
  console.log(`\nOutputs written to ${OUTPUT_ROOT}/stale_proof_rejection_${DATASET}.*`);
}

main().catch(err => { console.error('Stale-proof rejection benchmark failed:', err); process.exitCode = 1; });
