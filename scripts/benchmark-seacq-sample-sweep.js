// benchmark-seacq-sample-sweep.js
//
// R3/R4: PrivSearch vs SeaCQ head-to-head with a sweep over accumulator sample
// size s ∈ {5, 10, 25, 50, 99999} (99999 degrades to full verification).
//
// Matrix: k ∈ {2,4,6,8,10} × s ∈ SAMPLE_SIZES, 3 workloads per k, 100 trials
// after 5 warmups, alternating PS/SQ order per workload.
//
// Usage:
//   node scripts/benchmark-seacq-sample-sweep.js              # Enron
//   $env:H2H_DATASET='healthcare'; node scripts/benchmark-seacq-sample-sweep.js

require('dotenv/config');
const fs   = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { loadWorkloads, writeCsv } = require('./privsearch/workload-lib');
const { createEngine }            = require('./privsearch/engine-registry');

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT        = path.resolve(__dirname, '..');
const DATASET     = process.env.H2H_DATASET || 'enron';
const TRIALS      = Number(process.env.H2H_TRIALS  || '100');
const WARMUP      = Number(process.env.H2H_WARMUP  || '5');
const PER_K       = Number(process.env.H2H_PER_K   || '3');
const OUT_ROOT    = path.join(ROOT, 'Results', 'paper_assets');
const K_VALUES    = [2, 4, 6, 8, 10];
const SAMPLE_SIZES = [5, 10, 25, 50, 99999];

const DATASET_PATHS = {
  enron: {
    workloadRoot: path.join(ROOT, 'NweDB', 'enron_query_workloads'),
    indexRoot:    path.join(ROOT, 'NweDB', 'enron_inverted_index'),
    label: 'Enron-derived',
  },
  healthcare: {
    workloadRoot: path.join(ROOT, 'NweDB', 'healthcare', 'query_workloads'),
    indexRoot:    path.join(ROOT, 'NweDB', 'healthcare', 'inverted_index'),
    label: 'Healthcare (281,042 records)',
  },
};

const { workloadRoot, indexRoot, label } = DATASET_PATHS[DATASET] || DATASET_PATHS.enron;

// ── Helpers ───────────────────────────────────────────────────────────────────

function stats(arr) {
  if (!arr.length) return { n:0, mean:0, median:0, p95:0, stddev:0, ci95_low:0, ci95_high:0, min:0, max:0 };
  const s = [...arr].sort((a,b) => a-b);
  const n = s.length;
  const pick = q => s[Math.min(Math.floor((n-1)*q), n-1)];
  const mean = s.reduce((a,v)=>a+v,0)/n;
  const sd   = n>1 ? Math.sqrt(s.reduce((a,v)=>a+(v-mean)**2,0)/(n-1)) : 0;
  const mg   = n>1 ? 1.96*sd/Math.sqrt(n) : 0;
  return { n, mean, median:pick(0.5), p95:pick(0.95), min:s[0], max:s[n-1],
           stddev:sd, ci95_low:mean-mg, ci95_high:mean+mg };
}

async function runOne(engine, query) {
  for (let i=0;i<WARMUP;i++) await engine.runQuery(query);
  const total=[], search=[], verify=[], resultCounts=[];
  for (let i=0;i<TRIALS;i++) {
    const r = await engine.runQuery(query);
    total.push(r.total_ms); search.push(r.search_ms);
    verify.push(r.verify_ms); resultCounts.push(r.result_count || 0);
  }
  return {
    total_stats:  stats(total),
    search_stats: stats(search),
    verify_stats: stats(verify),
    result_count: Math.round(resultCounts.reduce((a,v)=>a+v,0)/resultCounts.length),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT_ROOT, { recursive: true });

  console.log(`\n=== SeaCQ sample-size sweep (${label}) ===`);
  console.log(`Trials: ${TRIALS}+${WARMUP}w | k: [${K_VALUES.join(',')}] | s: [${SAMPLE_SIZES.join(',')}]`);

  // Load workloads — need k=6,8,10 to exist for healthcare
  const allWL = loadWorkloads({ workloadRoot });
  const selectedByK = {};
  for (const k of K_VALUES) {
    const qt = `and_${k}`;
    const rows = allWL.filter(w => w.query_type === qt);
    selectedByK[k] = rows.slice(0, PER_K);
    if (selectedByK[k].length === 0) {
      console.log(`  k=${k}: no workloads found — skipping.`);
    } else {
      console.log(`  k=${k}: ${selectedByK[k].length} workload(s) selected.`);
    }
  }

  const activeK = K_VALUES.filter(k => selectedByK[k].length > 0);
  const allSelected = activeK.flatMap(k => selectedByK[k]);

  if (!allSelected.length) {
    console.error('No workloads found. Exiting.');
    process.exitCode = 1; return;
  }

  // Prepare SeaCQ engine once (full verification — s doesn't apply)
  console.log('\nPreparing SeaCQ baseline engine...');
  const sqEngine = createEngine('seacq-baseline', { indexRoot });
  await sqEngine.prepare(allSelected);
  console.log('SeaCQ ready.');

  // Prepare one PS engine per sample size
  console.log(`Preparing ${SAMPLE_SIZES.length} PrivSearch engine instances...`);
  const psEngines = {};
  for (const s of SAMPLE_SIZES) {
    const eng = createEngine('privsearch-prototype', { indexRoot, accumulatorSampleSize: s });
    await eng.prepare(allSelected);
    psEngines[s] = eng;
  }
  console.log('All engines ready.\n');

  // ── Benchmark loop ────────────────────────────────────────────────────────
  // For each (k, workload): run SeaCQ once, run PS at each s; alternate PS/SQ
  // alternation is across (k, workload) index to reduce JIT bias.

  const cellResults = []; // {k, query_id, s, ps, sq}

  let globalIdx = 0;
  for (const k of activeK) {
    for (const query of selectedByK[k]) {
      const label2 = `${query.query_id}(k=${k})`;
      process.stdout.write(`  ${label2} ...`);

      // SeaCQ for this workload
      let sqResult;
      if (globalIdx % 2 === 0) {
        sqResult = await runOne(sqEngine, query);
        process.stdout.write(` SQ=${sqResult.total_stats.mean.toFixed(3)}ms`);
      }

      // PS at each s
      const psResults = {};
      for (const s of SAMPLE_SIZES) {
        const ps = await runOne(psEngines[s], query);
        psResults[s] = ps;
      }

      if (globalIdx % 2 !== 0) {
        sqResult = await runOne(sqEngine, query);
        process.stdout.write(` SQ=${sqResult.total_stats.mean.toFixed(3)}ms`);
      }

      process.stdout.write(`  |R|=${sqResult.result_count}\n`);

      for (const s of SAMPLE_SIZES) {
        cellResults.push({ k, query_id: query.query_id, s, ps: psResults[s], sq: sqResult });
      }
      globalIdx++;
    }
  }

  // ── Aggregate: mean over workloads per (k, s) ─────────────────────────────
  const summary = [];
  for (const k of activeK) {
    for (const s of SAMPLE_SIZES) {
      const cells = cellResults.filter(c => c.k === k && c.s === s);
      if (!cells.length) continue;
      const avg = (fn) => cells.reduce((a,c)=>a+fn(c),0)/cells.length;
      summary.push({
        k, s,
        workload_count: selectedByK[k].length,
        result_count:   Math.round(avg(c => c.sq.result_count)),
        ps_search_ms:   avg(c => c.ps.search_stats.mean),
        ps_verify_ms:   avg(c => c.ps.verify_stats.mean),
        ps_total_ms:    avg(c => c.ps.total_stats.mean),
        sq_search_ms:   avg(c => c.sq.search_stats.mean),
        sq_verify_ms:   avg(c => c.sq.verify_stats.mean),
        sq_total_ms:    avg(c => c.sq.total_stats.mean),
        speedup_total:  avg(c => c.sq.total_stats.mean) / avg(c => c.ps.total_stats.mean),
        speedup_verify: avg(c => c.sq.verify_stats.mean) / avg(c => c.ps.verify_stats.mean),
      });
    }
  }

  // ── Write outputs ─────────────────────────────────────────────────────────
  const tag = `seacq_sample_sweep_${DATASET}`;
  const f4  = (v) => Number(v).toFixed(4);
  const f1  = (v) => Number(v).toFixed(1);

  fs.writeFileSync(path.join(OUT_ROOT, `${tag}.json`), JSON.stringify({
    generated_at: new Date().toISOString(), dataset: DATASET, corpus_label: label,
    trials: TRIALS, warmup: WARMUP, k_values: activeK, sample_sizes: SAMPLE_SIZES,
    fairness_protocol: {
      same_host_process: true, same_index_data: true,
      ps_engine: 'privsearch-prototype (sampled accumulator, swept s)',
      sq_engine: 'seacq-baseline (full per-doc × per-posting-list accumulator)',
    },
    summary,
  }, null, 2), 'utf8');

  writeCsv(path.join(OUT_ROOT, `${tag}.csv`), [
    ['k','s','workloads','trials','result_count',
     'PS_search_ms','PS_verify_ms','PS_total_ms',
     'SQ_search_ms','SQ_verify_ms','SQ_total_ms',
     'speedup_total','speedup_verify'],
    ...summary.map(r => [
      r.k, r.s, r.workload_count, TRIALS, r.result_count,
      f4(r.ps_search_ms), f4(r.ps_verify_ms), f4(r.ps_total_ms),
      f4(r.sq_search_ms), f4(r.sq_verify_ms), f4(r.sq_total_ms),
      f1(r.speedup_total), f1(r.speedup_verify),
    ]),
  ]);

  // Console summary pivot: rows = k, cols = s
  console.log('\n── Sample-Size Sweep Summary ───────────────────────────────────────');
  console.log('           ' + SAMPLE_SIZES.map(s => String(s==='99999'?'full':s).padStart(10)).join(''));
  console.log('           ' + SAMPLE_SIZES.map(() => '  PS_tot(ms)').join(''));
  for (const k of activeK) {
    const row = SAMPLE_SIZES.map(s => {
      const r = summary.find(x => x.k===k && x.s===s);
      return r ? f4(r.ps_total_ms).padStart(10) : '       n/a';
    }).join('');
    const sq = summary.find(x => x.k===k && x.s===SAMPLE_SIZES[0]);
    const sqStr = sq ? `  SQ=${f4(sq.sq_total_ms)}ms` : '';
    console.log(`  k=${k}   ${row}${sqStr}`);
  }
  console.log(`\nOutputs: ${OUT_ROOT}/${tag}.*`);
}

main().catch(err => { console.error('Sweep failed:', err); process.exitCode = 1; });
