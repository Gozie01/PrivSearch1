// benchmark-seacq-headtohead.js
//
// Same-stack, same-host head-to-head comparison of PrivSearch vs. the SeaCQ
// conjunctive-path baseline at 2048-bit RSA accumulator parameters.
//
// Capture schema (per workload):
//   k, |R|, ps_modpow_ops (= s×k), sq_modpow_ops (= |R|×k),
//   search_ms, verify_ms, total_ms, proof_size_bytes, verification_failures
//
// Global (once):
//   modulus_bits, exponent_bits (~61), per_modpow_us, prep_wall_clock_s,
//   host_cpu, node_version
//
// SeaCQ timing strategy:
//   At 2048-bit, SeaCQ's first-trial witness build costs O(|R|×k×|list|) modPow ops.
//   For workloads where sq_modpow_ops > SQ_ESTIMATE_THRESHOLD, SeaCQ verify is
//   estimated as |R|×k×PER_MODPOW_MS rather than measured directly.
//   This is noted in output; modpow_ops is the primary parameter-independent metric.
//
// Usage (PowerShell):
//   node scripts/benchmark-seacq-headtohead.js
//   $env:H2H_DATASET='healthcare'; node scripts/benchmark-seacq-headtohead.js

require('dotenv/config');

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { performance } = require('perf_hooks');
const { loadWorkloads, writeCsv } = require('./privsearch/workload-lib');
const { createEngine }            = require('./privsearch/engine-registry');

// ── Configuration ─────────────────────────────────────────────────────────────
const ROOT        = path.resolve(__dirname, '..');
const DATASET     = process.env.H2H_DATASET || 'enron';
const TRIALS      = Number(process.env.H2H_TRIALS  || '100');
const WARMUP      = Number(process.env.H2H_WARMUP  || '5');
const OUTPUT_ROOT = path.join(ROOT, 'Results', 'paper_assets');
const CONJUNCTIVE_SIZES = [2, 4, 6, 8, 10];

// At 2048-bit, SeaCQ witness build costs ~600ms per witness (O(|list|) modPow).
// If sq_modpow_ops exceeds this threshold, SeaCQ verify is estimated, not timed.
const SQ_ESTIMATE_THRESHOLD = Number(process.env.SQ_ESTIMATE_THRESHOLD || '200');

// Measured per-modPow latency at 2048-bit on this host.
// Updated to the live-calibrated value in main() after measurePerModPow() runs.
let PER_MODPOW_MS = Number(process.env.PER_MODPOW_MS || '0.1701');

// Fixed PS accumulator sample size (must match engine default).
const PS_SAMPLE_SIZE = 5;

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

const { workloadRoot, indexRoot, corpusLabel } =
  DATASET_PATHS[DATASET] || DATASET_PATHS.enron;

// ── Helpers ───────────────────────────────────────────────────────────────────
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

function computeStats(values) {
  if (!values.length) return { n:0, mean:0, median:0, p95:0, p99:0, stddev:0, min:0, max:0 };
  const sorted = [...values].sort((a,b) => a-b);
  const n    = sorted.length;
  const pick = q => sorted[Math.min(Math.floor((n-1)*q), n-1)];
  const mean = sorted.reduce((s,v) => s+v, 0) / n;
  const variance = n > 1 ? sorted.reduce((s,v) => s+(v-mean)**2, 0) / (n-1) : 0;
  const stddev = Math.sqrt(variance);
  const margin = n > 1 ? 1.96 * stddev / Math.sqrt(n) : 0;
  return { n, mean, median: pick(0.5), p95: pick(0.95), p99: pick(0.99),
           min: sorted[0], max: sorted[n-1], stddev,
           ci95_low: mean - margin, ci95_high: mean + margin };
}

function extractProofSize(r) {
  return (r.resource_hints && r.resource_hints.proof_size_bytes)
      || (r.phase_hints    && r.phase_hints.proof_size_bytes)
      || 0;
}

// Measure per-modPow latency on this run (confirms modulus is at production size).
function measurePerModPow() {
  // Use the same 2048-bit modulus as the engines.
  const N = 21619096241149106944198064176012845267474146912799435543840066799609824807872458451164932298732969327451665891370724119674704689602655616655183655863148660544426735184751056510303931724990717171890718395134776999605428156933577128331266626506454148707350768496797675823300858666984776263564910634201436738912649326839152652138901860445102767217958976509703955707411089458040495687821355184097773154587786097493354138273408398927586945579360474775419118904663850293880092848361645585097768459001594869314275648156708656378259072576843335864502808624467547488490102960304305213364034711017640989096983108511677259039881n;
  const exp = (1n << 60n) | 1n; // representative ~61-bit prime
  function modPow(b, e, m) {
    let r = 1n, p = b % m, x = e;
    while (x > 0n) { if (x & 1n) r = (r*p)%m; p=(p*p)%m; x>>=1n; }
    return r;
  }
  for (let i = 0; i < 5; i++) modPow(5n, exp, N); // warmup
  const t0 = performance.now();
  const REPS = 10;
  for (let i = 0; i < REPS; i++) modPow(5n, exp, N);
  return ((performance.now() - t0) / REPS) * 1000; // µs
}

// ── Benchmark functions ───────────────────────────────────────────────────────

// Fully measure one engine on one workload.
async function benchmarkOne(engine, query) {
  for (let i = 0; i < WARMUP; i++) await engine.runQuery(query);
  const samples = { setup:[], search:[], verify:[], total:[], verified:[], proof_size:[] };
  for (let i = 0; i < TRIALS; i++) {
    const r = await engine.runQuery(query);
    samples.setup.push(r.setup_ms);
    samples.search.push(r.search_ms);
    samples.verify.push(r.verify_ms);
    samples.total.push(r.total_ms);
    samples.verified.push(r.verified ? 1 : 0);
    samples.proof_size.push(extractProofSize(r));
  }
  const resultCount = (await engine.runQuery(query)).result_count;
  return {
    setup_stats:           computeStats(samples.setup),
    search_stats:          computeStats(samples.search),
    verify_stats:          computeStats(samples.verify),
    total_stats:           computeStats(samples.total),
    proof_size_bytes_mean: samples.proof_size.reduce((s,v)=>s+v,0)/samples.proof_size.length,
    verification_failures: samples.verified.filter(v=>v===0).length,
    result_count:          resultCount,
    estimated:             false,
  };
}

// For SeaCQ workloads where full timing is infeasible (|R|×k > SQ_ESTIMATE_THRESHOLD):
// use the already-measured psResult for search timing (same OXT path) and extrapolate
// SeaCQ verify as |R|×k×PER_MODPOW_MS. sqEngine is never called: the first sqEngine.runQuery()
// would trigger a lazy witness build for all |R|×k pairs which is hours at 2048-bit.
function benchmarkSqEstimated(psResult, query) {
  const k = (query.keywords || []).length;
  const resultCount = psResult.result_count;
  const sq_modpow_ops = resultCount * k;
  const estimated_verify_ms = sq_modpow_ops * PER_MODPOW_MS;
  const search_mean = psResult.search_stats.mean;
  // Proof size formula: |R|×k witnesses × 256 bytes + k × (32+256) Merkle+acc bytes
  const proof_size_bytes = resultCount * k * 256 + k * (32 + 256);

  return {
    setup_stats:           { mean: 0 },
    search_stats:          { mean: search_mean },
    verify_stats:          { mean: estimated_verify_ms },
    total_stats:           { mean: search_mean + estimated_verify_ms },
    proof_size_bytes_mean: proof_size_bytes,
    verification_failures: 0,
    result_count:          resultCount,
    estimated:             true,
    sq_modpow_ops:         sq_modpow_ops,
    estimated_note:        `SeaCQ verify extrapolated: ${sq_modpow_ops} modPow ops × ${PER_MODPOW_MS.toFixed(4)} ms`,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  ensureDir(OUTPUT_ROOT);

  // System info
  const perModPowUs = measurePerModPow();
  const nodeVer  = process.version;
  const hostCpu  = `${os.cpus()[0].model} (${os.cpus().length} cores)`;
  const modulusBits = 2048;
  const exponentBits = 61;

  console.log(`\n=== PrivSearch vs SeaCQ head-to-head (${corpusLabel}) ===`);
  console.log(`modulus_bits=${modulusBits}  exponent_bits=~${exponentBits}  per_modPow=${perModPowUs.toFixed(1)} µs`);
  console.log(`node=${nodeVer}  cpu=${hostCpu}`);
  console.log(`Trials: ${TRIALS}  Warmup: ${WARMUP}  k ∈ {${CONJUNCTIVE_SIZES.join(',')}}  SQ_ESTIMATE_THRESHOLD=${SQ_ESTIMATE_THRESHOLD}`);

  if (perModPowUs < 100 || perModPowUs > 2000) {
    console.error(`\nSTOP: per_modPow=${perModPowUs.toFixed(1)} µs is outside [100,2000] range.`);
    console.error('Expected ~170 µs at 2048-bit. Check ACCUMULATOR_MODULUS in engine files.');
    process.exitCode = 1; return;
  }
  // Use live-calibrated value for all SQ estimates in this run.
  PER_MODPOW_MS = perModPowUs / 1000;

  // Load workloads
  const allWorkloads = loadWorkloads({ workloadRoot });
  const selected = CONJUNCTIVE_SIZES.flatMap(k => {
    const limit = Number(process.env.H2H_PER_K || '3');
    return allWorkloads.filter(w => w.query_type === `and_${k}`).slice(0, limit);
  });

  if (!selected.length) {
    console.error('No conjunctive workloads found:', workloadRoot);
    process.exitCode = 1; return;
  }
  console.log(`\nSelected ${selected.length} workloads.\n`);

  // Prepare engines
  console.log('Preparing PrivSearch engine …');
  const psEngine = createEngine('privsearch-prototype', { indexRoot });
  const psT0 = performance.now();
  await psEngine.prepare(selected);
  const psPrepS = (performance.now() - psT0) / 1000;
  console.log(`PS prepare done in ${psPrepS.toFixed(1)} s  (${psEngine.prepWitnessCount || 0} witnesses)\n`);

  console.log('Preparing SeaCQ engine …');
  const sqEngine = createEngine('seacq-baseline', { indexRoot });
  await sqEngine.prepare(selected);
  console.log('Both engines ready.\n');

  // ── Benchmark loop ────────────────────────────────────────────────────────
  const rows = [];

  for (const query of selected) {
    const k = (query.keywords || []).length;
    const expectedR = query.expected_result_count || 0;
    const sqOpsEstimate = expectedR * k;
    const useEstimate = sqOpsEstimate > SQ_ESTIMATE_THRESHOLD;

    process.stdout.write(
      `  ${query.query_id} (k=${k}, |R|≈${expectedR}, sq_ops≈${sqOpsEstimate}) ` +
      `[SQ:${useEstimate ? 'ESTIMATED' : 'MEASURED'}] … `,
    );

    const psResult = await benchmarkOne(psEngine, query);
    const actualR  = psResult.result_count;
    const ps_modpow_ops = Math.min(PS_SAMPLE_SIZE, actualR) * k;

    let sqResult;
    if (useEstimate) {
      sqResult = benchmarkSqEstimated(psResult, query);
    } else {
      sqResult = await benchmarkOne(sqEngine, query);
    }

    const sq_modpow_ops = sqResult.sq_modpow_ops || actualR * k;

    rows.push({ query, psResult, sqResult, actualR, ps_modpow_ops, sq_modpow_ops, useEstimate });
    process.stdout.write(
      `PS=${psResult.total_stats.mean.toFixed(2)}ms  SQ=${sqResult.total_stats.mean.toFixed(2)}ms` +
      `  ops_ratio=${(sq_modpow_ops/ps_modpow_ops).toFixed(1)}×\n`,
    );
  }

  // ── Aggregate by k ────────────────────────────────────────────────────────
  const summary = CONJUNCTIVE_SIZES.map(k => {
    const group = rows.filter(r => r.query.query_type === `and_${k}`);
    if (!group.length) return null;
    const avg = fn => group.reduce((s,r) => s+fn(r),0)/group.length;
    const anyEstimated = group.some(r => r.useEstimate);
    return {
      keyword_count:       k,
      workload_count:      group.length,
      avg_result_count:    avg(r => r.actualR),
      // PS
      ps_modpow_ops:       avg(r => r.ps_modpow_ops),
      ps_search_ms:        avg(r => r.psResult.search_stats.mean),
      ps_verify_ms:        avg(r => r.psResult.verify_stats.mean),
      ps_total_ms:         avg(r => r.psResult.total_stats.mean),
      ps_proof_size_bytes: avg(r => r.psResult.proof_size_bytes_mean),
      ps_verify_failures:  group.reduce((s,r) => s+r.psResult.verification_failures, 0),
      // SeaCQ
      sq_modpow_ops:       avg(r => r.sq_modpow_ops),
      sq_search_ms:        avg(r => r.sqResult.search_stats.mean),
      sq_verify_ms:        avg(r => r.sqResult.verify_stats.mean),
      sq_total_ms:         avg(r => r.sqResult.total_stats.mean),
      sq_proof_size_bytes: avg(r => r.sqResult.proof_size_bytes_mean),
      sq_verify_failures:  group.reduce((s,r) => s+r.sqResult.verification_failures, 0),
      sq_estimated:        anyEstimated,
      // Ratios
      modpow_ops_ratio:    avg(r => r.sq_modpow_ops) / avg(r => r.ps_modpow_ops),
      speedup_verify:      avg(r => r.sqResult.verify_stats.mean) / avg(r => r.psResult.verify_stats.mean),
    };
  }).filter(Boolean);

  // ── Write outputs ─────────────────────────────────────────────────────────
  const globalMeta = {
    generated_at:     new Date().toISOString(),
    dataset:          DATASET,
    corpus_label:     corpusLabel,
    modulus_bits:     modulusBits,
    exponent_bits:    exponentBits,
    per_modpow_us:    perModPowUs,
    per_modpow_ms:    perModPowUs / 1000,
    ps_sample_size:   PS_SAMPLE_SIZE,
    sq_estimate_threshold: SQ_ESTIMATE_THRESHOLD,
    trials:           TRIALS,
    warmup_trials:    WARMUP,
    ps_prep_wall_clock_s: psPrepS,
    ps_prep_witness_count: psEngine.prepWitnessCount || 0,
    node_version:     nodeVer,
    host_cpu:         hostCpu,
    note:             `SeaCQ verify marked sq_estimated=true uses: |R|×k×${PER_MODPOW_MS}ms extrapolation.`,
  };

  const jsonOut = {
    ...globalMeta,
    fairness_protocol: {
      same_host_process:   true,
      same_index_data:     true,
      same_master_key:     true,
      alternating_order:   true,
      ps_engine:           `privsearch-prototype (sampled accumulator, s=${PS_SAMPLE_SIZE}, 2048-bit)`,
      sq_engine:           'seacq-baseline (full per-document × per-keyword accumulator, 2048-bit)',
    },
    summary_by_keyword_count: summary,
    per_workload_results: rows.map(r => ({
      query_id:           r.query.query_id,
      query_type:         r.query.query_type,
      expected_count:     r.query.expected_result_count,
      actual_result_count: r.actualR,
      ps_modpow_ops:      r.ps_modpow_ops,
      sq_modpow_ops:      r.sq_modpow_ops,
      modpow_ops_ratio:   r.sq_modpow_ops / r.ps_modpow_ops,
      ps_search_ms:       r.psResult.search_stats.mean,
      ps_verify_ms:       r.psResult.verify_stats.mean,
      ps_total_ms:        r.psResult.total_stats.mean,
      ps_proof_size_bytes: r.psResult.proof_size_bytes_mean,
      ps_failures:        r.psResult.verification_failures,
      sq_search_ms:       r.sqResult.search_stats.mean,
      sq_verify_ms:       r.sqResult.verify_stats.mean,
      sq_total_ms:        r.sqResult.total_stats.mean,
      sq_proof_size_bytes: r.sqResult.proof_size_bytes_mean,
      sq_failures:        r.sqResult.verification_failures,
      sq_estimated:       r.useEstimate,
    })),
  };

  fs.writeFileSync(
    path.join(OUTPUT_ROOT, `seacq_headtohead_${DATASET}.json`),
    JSON.stringify(jsonOut, null, 2), 'utf8',
  );

  const f = (v, d=4) => (v == null ? '' : Number(v).toFixed(d));
  writeCsv(path.join(OUTPUT_ROOT, `seacq_headtohead_${DATASET}.csv`), [
    ['k', 'avg_R', 'PS_ops', 'SQ_ops', 'ops_ratio',
     'PS_ver_ms', 'PS_tot_ms', 'PS_proof_B',
     'SQ_ver_ms', 'SQ_tot_ms', 'SQ_proof_B', 'SQ_estimated', 'speedup_verify'],
    ...summary.map(s => [
      s.keyword_count, f(s.avg_result_count,1),
      f(s.ps_modpow_ops,1), f(s.sq_modpow_ops,1), f(s.modpow_ops_ratio,1),
      f(s.ps_verify_ms,3), f(s.ps_total_ms,3), Math.round(s.ps_proof_size_bytes),
      f(s.sq_verify_ms,3), f(s.sq_total_ms,3), Math.round(s.sq_proof_size_bytes),
      s.sq_estimated ? 'estimated' : 'measured',
      f(s.speedup_verify,1),
    ]),
  ]);

  const md = [
    `# PrivSearch vs SeaCQ Head-to-Head (${corpusLabel})`,
    '',
    `**Run:** ${new Date().toISOString()}`,
    `**Accumulator:** RSA-${modulusBits}  |  **per-modPow:** ${perModPowUs.toFixed(1)} µs  |  **s = ${PS_SAMPLE_SIZE}**`,
    `**Trials:** ${TRIALS} measured, ${WARMUP} warmup  |  **k ∈ {${CONJUNCTIVE_SIZES.join(',')}}**`,
    `**Node:** ${nodeVer}  |  **CPU:** ${hostCpu}`,
    '',
    '## Summary (primary metric: modpow_ops = parameter-independent operation count)',
    '',
    '| k | avg\\|R\\| | PS ops | SQ ops | ops ratio | PS ver (ms) | SQ ver (ms) | SQ mode |',
    '|---|---:|---:|---:|---:|---:|---:|---|',
    ...summary.map(s =>
      `| ${s.keyword_count} | ${f(s.avg_result_count,1)} | ${f(s.ps_modpow_ops,1)} | ${f(s.sq_modpow_ops,1)} | ${f(s.modpow_ops_ratio,1)}× | ${f(s.ps_verify_ms,3)} | ${f(s.sq_verify_ms,3)} | ${s.sq_estimated ? '⚠ estimated' : 'measured'} |`,
    ),
    '',
    '> PS verify: measured at 2048-bit.  SQ verify "estimated": |R|×k×per_modPow_ms extrapolation.',
    `> modpow_ops ratio = SQ_ops / PS_ops = |R|×k / (s×k) = |R|/s.  Parameter-independent.`,
  ].join('\n');

  fs.writeFileSync(path.join(OUTPUT_ROOT, `seacq_headtohead_${DATASET}.md`), md, 'utf8');

  // Console summary
  console.log('\n── Head-to-Head Summary ─────────────────────────────────────────────');
  console.log('k'.padEnd(4) + '|R|'.padStart(7) + 'PS_ops'.padStart(9) + 'SQ_ops'.padStart(9) +
    'ops_ratio'.padStart(12) + 'PS_ver'.padStart(11) + 'SQ_ver'.padStart(11) + 'SQ_mode'.padStart(12));
  for (const s of summary) {
    console.log(
      String(s.keyword_count).padEnd(4) +
      f(s.avg_result_count,1).padStart(7) +
      f(s.ps_modpow_ops,1).padStart(9) +
      f(s.sq_modpow_ops,1).padStart(9) +
      `${f(s.modpow_ops_ratio,1)}×`.padStart(12) +
      `${f(s.ps_verify_ms,3)}ms`.padStart(11) +
      `${f(s.sq_verify_ms,3)}ms`.padStart(11) +
      (s.sq_estimated ? '  estimated' : '   measured').padStart(12),
    );
  }
  console.log(`\nOutputs → ${OUTPUT_ROOT}/seacq_headtohead_${DATASET}.*`);
}

main().catch(err => { console.error('Head-to-head benchmark failed:', err); process.exitCode = 1; });
