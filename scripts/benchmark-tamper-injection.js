// benchmark-tamper-injection.js
//
// R5: Tamper-detection experiment.
//
// A fabricator injects t fake document IDs into the result set (substitution
// model: replace t legitimate docs with fake IDs not present in any posting
// list).  The verifier samples s documents randomly and checks accumulator
// membership.  We compare empirical detection rate against the theoretical
// hypergeometric bound 1 − C(|R|−t, s) / C(|R|, s).
//
// Matrix: t ∈ {1,2,5,10}  ×  s ∈ {5,10,25,50}
// Per-cell: ≥ 100 trials across workloads stratified by |R| bucket.
// Workload buckets: small (|R| < 50), medium (50–500), large (> 500).
//
// Usage: node scripts/benchmark-tamper-injection.js

require('dotenv/config');
const fs   = require('fs');
const path = require('path');
const { loadWorkloads, writeCsv } = require('./privsearch/workload-lib');
const { createEngine }            = require('./privsearch/engine-registry');

const ROOT     = path.resolve(__dirname, '..');
const OUT_ROOT = path.join(ROOT, 'Results', 'paper_assets');
const IDX_ROOT = path.join(ROOT, 'NweDB', 'enron_inverted_index');
const WL_ROOT  = path.join(ROOT, 'NweDB', 'enron_query_workloads');

const T_VALUES = [1, 2, 5, 10];
const S_VALUES = [5, 10, 25, 50];
const TRIALS_PER_CELL = 100;
const BUCKET_DEFS = [
  { label: 'small',  min: 1,   max: 49  },
  { label: 'medium', min: 50,  max: 499 },
  { label: 'large',  min: 500, max: Infinity },
];

// ── BigInt combinatorics ──────────────────────────────────────────────────────

function binomCoeff(n, k) {
  if (k < 0 || k > n) return 0n;
  if (k === 0 || k === n) return 1n;
  k = Math.min(k, n - k);
  let r = 1n;
  for (let i = 0; i < k; i++) r = r * BigInt(n - i) / BigInt(i + 1);
  return r;
}

function theoreticalDetect(R, t, s) {
  // Substitution model: |R| docs, t replaced with fakes.
  // P(no detect) = C(R-t, s) / C(R, s)
  if (t <= 0 || s <= 0 || R <= 0) return 0;
  if (t >= R) return 1;
  if (s >= R) return t > 0 ? 1 : 0;
  const num = binomCoeff(R - t, s);
  const den = binomCoeff(R, s);
  if (den === 0n) return 0;
  // Compute as float via ratio of logs to avoid overflow
  // log C(R-t,s) - log C(R,s)
  let logRatio = 0;
  for (let i = 0; i < s; i++) {
    logRatio += Math.log(R - t - i) - Math.log(R - i);
  }
  return 1 - Math.exp(logRatio);
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function mean(arr) { return arr.length ? arr.reduce((a,v)=>a+v,0)/arr.length : 0; }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  console.log('\n=== Tamper-Injection Detection Experiment ===');
  console.log(`t ∈ {${T_VALUES.join(',')}}  ×  s ∈ {${S_VALUES.join(',')}}  ×  ${TRIALS_PER_CELL} trials/cell`);

  // Load conjunctive workloads (and_2..and_10) — these give variety in |R|
  const queryTypes = ['and_2','and_4','and_6','and_8','and_10',
                      'single_keyword','or_2'];
  const allWL = loadWorkloads({ workloadRoot: WL_ROOT, queryTypes });
  console.log(`Loaded ${allWL.length} workloads.`);

  // Prepare engine — noWitnesses=true because runTamperTrial detects via random
  // sampling (hypergeometric), not via accumulator witness verification.
  console.log('Preparing PrivSearch engine (no witness precompute — not needed for tamper detection)...');
  const engine = createEngine('privsearch-prototype', { indexRoot: IDX_ROOT });
  await engine.prepare(allWL, { noWitnesses: true });
  console.log('Engine ready.\n');

  // ── Bucket workloads by expected |R| ─────────────────────────────────────
  // Use expected_result_count from workload JSON (pre-computed from same index).
  // Avoids calling runQuery() for probing, which would lazily build witnesses
  // that runTamperTrial never uses (detection is purely statistical).
  console.log('Bucketing workloads by expected result set size...');
  const probed = [];
  for (const q of allWL) {
    const R = q.expected_result_count;
    if (R && R > 0) probed.push({ query: q, R });
  }
  console.log(`${probed.length} workloads with non-empty expected results.`);

  // Stratify into buckets
  const buckets = {};
  for (const bd of BUCKET_DEFS) {
    buckets[bd.label] = probed.filter(p => p.R >= bd.min && p.R <= bd.max);
    console.log(`  ${bd.label} (${bd.min}–${bd.max === Infinity ? '∞' : bd.max}): ${buckets[bd.label].length} workloads`);
  }

  // ── Trial loop ────────────────────────────────────────────────────────────
  const results = [];

  for (const t of T_VALUES) {
    for (const s of S_VALUES) {
      for (const bd of BUCKET_DEFS) {
        const pool = buckets[bd.label].filter(p => p.R > t); // need R > t to substitute
        if (!pool.length) {
          console.log(`  t=${t} s=${s} ${bd.label}: no valid workloads — skip`);
          continue;
        }

        const detections = [];
        let trialsRun = 0;
        let workloadIdx = 0;

        while (trialsRun < TRIALS_PER_CELL) {
          const item = pool[workloadIdx % pool.length];
          workloadIdx++;
          try {
            const r = await engine.runTamperTrial(item.query, t, s);
            if (r.skipped) continue;
            detections.push(r.detected ? 1 : 0);
            trialsRun++;
          } catch { continue; }
        }

        const R_mean = Math.round(mean(pool.map(p => p.R)));
        const empirical = mean(detections);
        const theoretical = theoreticalDetect(R_mean, t, s);
        const gap = empirical - theoretical;

        results.push({
          t, s,
          bucket: bd.label,
          trials: trialsRun,
          R_mean,
          empirical_detect_rate: empirical,
          theoretical_detect_rate: theoretical,
          gap,
          workloads_used: Math.min(pool.length, Math.ceil(TRIALS_PER_CELL / pool.length) * pool.length),
        });

        console.log(
          `  t=${t} s=${s} ${bd.label.padEnd(7)} R̄=${String(R_mean).padStart(5)}` +
          `  empirical=${(empirical*100).toFixed(1).padStart(5)}%` +
          `  theory=${(theoretical*100).toFixed(1).padStart(5)}%` +
          `  gap=${(gap*100).toFixed(1).padStart(6)}%`,
        );
      }
    }
  }

  // ── Write outputs ─────────────────────────────────────────────────────────
  fs.writeFileSync(path.join(OUT_ROOT, 'tamper_injection.json'), JSON.stringify({
    generated_at: new Date().toISOString(),
    t_values: T_VALUES, s_values: S_VALUES,
    trials_per_cell: TRIALS_PER_CELL,
    tamper_model: 'substitution: replace t of |R| legitimate docs with fake IDs',
    theoretical_formula: '1 - C(|R|-t, s) / C(|R|, s)',
    results,
  }, null, 2), 'utf8');

  writeCsv(path.join(OUT_ROOT, 'tamper_injection.csv'), [
    ['t','s','bucket','trials','R_mean',
     'empirical_detect_pct','theoretical_detect_pct','gap_pct'],
    ...results.map(r => [
      r.t, r.s, r.bucket, r.trials, r.R_mean,
      (r.empirical_detect_rate*100).toFixed(2),
      (r.theoretical_detect_rate*100).toFixed(2),
      (r.gap*100).toFixed(2),
    ]),
  ]);

  // Markdown table
  const md = [
    '# Tamper-Injection Detection Results',
    '',
    `**Tamper model:** substitution — replace t of |R| result docs with fabricated IDs`,
    `**Detection:** verifier samples s docs randomly; tamper detected iff ≥1 fake is sampled`,
    `**Theoretical rate:** 1 − C(|R|−t, s) / C(|R|, s)`,
    '',
    '| t | s | bucket | R̄ | empirical | theoretical | gap |',
    '|---|---|--------|---|-----------|-------------|-----|',
    ...results.map(r =>
      `| ${r.t} | ${r.s} | ${r.bucket} | ${r.R_mean} ` +
      `| ${(r.empirical_detect_rate*100).toFixed(1)}% ` +
      `| ${(r.theoretical_detect_rate*100).toFixed(1)}% ` +
      `| ${(r.gap*100).toFixed(1)}% |`,
    ),
  ].join('\n');
  fs.writeFileSync(path.join(OUT_ROOT, 'tamper_injection.md'), md, 'utf8');

  console.log(`\nOutputs: ${OUT_ROOT}/tamper_injection.*`);
}

main().catch(err => { console.error('Tamper experiment failed:', err); process.exitCode = 1; });
