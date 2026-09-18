// benchmark-tamper-small-extra.js
//
// Supplemental R5 cells: s ∈ {1,2} × t ∈ {1,2,5,10} × small-|R| bucket only.
//
// The main benchmark (benchmark-tamper-injection.js) used S_VALUES=[5,10,25,50].
// For small |R| (R̄≈17) and s=25, the verifier returns ALL docs (full verification,
// not sampling).  These two new s values fill genuine sampling territory.

require('dotenv/config');
const fs   = require('fs');
const path = require('path');
const { loadWorkloads, writeCsv } = require('./privsearch/workload-lib');
const { createEngine }            = require('./privsearch/engine-registry');

const ROOT     = path.resolve(__dirname, '..');
const OUT_ROOT = path.join(ROOT, 'Results', 'paper_assets');
const IDX_ROOT = path.join(ROOT, 'NweDB', 'enron_inverted_index');
const WL_ROOT  = path.join(ROOT, 'NweDB', 'enron_query_workloads');

const T_VALUES        = [1, 2, 5, 10];
const S_VALUES_EXTRA  = [1, 2];
const TRIALS_PER_CELL = 100;
const SMALL_MAX       = 49;

function theoreticalDetect(R, t, s) {
  if (t <= 0 || s <= 0 || R <= 0) return 0;
  if (t >= R) return 1;
  if (s >= R) return t > 0 ? 1 : 0;
  let logRatio = 0;
  for (let i = 0; i < s; i++) logRatio += Math.log(R - t - i) - Math.log(R - i);
  return 1 - Math.exp(logRatio);
}

function mean(arr) { return arr.length ? arr.reduce((a, v) => a + v, 0) / arr.length : 0; }

async function main() {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  console.log('\n=== Tamper-Injection Supplemental (s∈{1,2}, small |R| only) ===');
  console.log(`t ∈ {${T_VALUES.join(',')}}  ×  s ∈ {${S_VALUES_EXTRA.join(',')}}  ×  ${TRIALS_PER_CELL} trials/cell`);

  const queryTypes = ['and_2','and_4','and_6','and_8','and_10','single_keyword','or_2'];
  const allWL = loadWorkloads({ workloadRoot: WL_ROOT, queryTypes });
  console.log(`Loaded ${allWL.length} workloads.`);

  console.log('Preparing PrivSearch engine...');
  const engine = createEngine('privsearch-prototype', { indexRoot: IDX_ROOT });
  await engine.prepare(allWL);
  console.log('Engine ready.\n');

  console.log('Probing workloads for result set sizes...');
  const smallPool = [];
  for (const q of allWL) {
    try {
      const r = await engine.runQuery(q);
      if (r.result_count >= 1 && r.result_count <= SMALL_MAX)
        smallPool.push({ query: q, R: r.result_count });
    } catch { /* skip */ }
  }
  console.log(`  small (1–${SMALL_MAX}): ${smallPool.length} workloads  R̄=${Math.round(mean(smallPool.map(p=>p.R)))}\n`);

  const results = [];

  for (const t of T_VALUES) {
    for (const s of S_VALUES_EXTRA) {
      const pool = smallPool.filter(p => p.R > t);
      if (!pool.length) { console.log(`  t=${t} s=${s} small: no valid workloads — skip`); continue; }

      const detections = [];
      let trialsRun = 0, wlIdx = 0;
      while (trialsRun < TRIALS_PER_CELL) {
        const item = pool[wlIdx++ % pool.length];
        try {
          const r = await engine.runTamperTrial(item.query, t, s);
          if (r.skipped) continue;
          detections.push(r.detected ? 1 : 0);
          trialsRun++;
        } catch { continue; }
      }

      const R_mean      = Math.round(mean(pool.map(p => p.R)));
      const empirical   = mean(detections);
      const theoretical = theoreticalDetect(R_mean, t, s);
      const gap         = empirical - theoretical;

      results.push({ t, s, bucket: 'small', trials: trialsRun, R_mean,
        empirical_detect_rate: empirical, theoretical_detect_rate: theoretical, gap });

      console.log(
        `  t=${t} s=${s} small    R̄=${String(R_mean).padStart(5)}` +
        `  empirical=${(empirical*100).toFixed(1).padStart(5)}%` +
        `  theory=${(theoretical*100).toFixed(1).padStart(5)}%` +
        `  gap=${(gap*100).toFixed(1).padStart(6)}%`,
      );
    }
  }

  fs.writeFileSync(path.join(OUT_ROOT, 'tamper_injection_small_extra.json'),
    JSON.stringify({ generated_at: new Date().toISOString(),
      note: 'Supplemental: s∈{1,2} × small bucket only',
      t_values: T_VALUES, s_values: S_VALUES_EXTRA,
      trials_per_cell: TRIALS_PER_CELL, results }, null, 2), 'utf8');

  writeCsv(path.join(OUT_ROOT, 'tamper_injection_small_extra.csv'), [
    ['t','s','bucket','trials','R_mean','empirical_detect_pct','theoretical_detect_pct','gap_pct'],
    ...results.map(r => [r.t, r.s, r.bucket, r.trials, r.R_mean,
      (r.empirical_detect_rate*100).toFixed(2),
      (r.theoretical_detect_rate*100).toFixed(2),
      (r.gap*100).toFixed(2)]),
  ]);

  console.log(`\nOutputs: ${OUT_ROOT}/tamper_injection_small_extra.*`);
}

main().catch(err => { console.error('Supplemental tamper experiment failed:', err); process.exitCode = 1; });
