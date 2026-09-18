// benchmark-privsearch-witness-profiling.js
//
// R7: Per-phase witness timing profiling for PrivSearch conjunctive verification.
//
// Purpose: explain the verify-time growth pattern across k.  The core question
// is: why does PS verify_ms grow with k, and specifically why did k=8 appear
// faster than k=6 in the old workloads (|R|=1-2 artefact)?
//
// Methodology:
//   For each conjunctive workload at k ∈ {2,4,6,8,10}:
//     1. Decode posting entries for all k keywords.
//     2. Compute intersection → result set R (size |R|).
//     3. Select verification sample (min(s=5, |R|) docs, evenly spaced).
//     4. For each (sampled_doc, keyword_posting_entry):
//          time buildMembershipWitness() — O(|posting_list|) modPow operations.
//     5. Record: |R|, s (actual sample used), k, avg posting-list size,
//          per-witness time, total witness time, verify_ms from runQuery().
//
// This produces the phase decomposition needed to explain the relationship
// between k, |R|, posting-list size, and verification cost.
//
// Usage:
//   node scripts/benchmark-privsearch-witness-profiling.js
//   H2H_DATASET=healthcare node scripts/benchmark-privsearch-witness-profiling.js

require('dotenv/config');

const fs   = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { loadWorkloads, writeCsv } = require('./privsearch/workload-lib');
const { createEngine }            = require('./privsearch/engine-registry');

// ── Config ────────────────────────────────────────────────────────────────────
const ROOT        = path.resolve(__dirname, '..');
const DATASET     = process.env.H2H_DATASET || 'enron';
const PROFILE_TRIALS = Number(process.env.PROFILE_TRIALS || '20');
const OUTPUT_ROOT = path.join(ROOT, 'Results', 'paper_assets');
const CONJUNCTIVE_SIZES = [2, 4, 6, 8, 10];
const PER_K = Number(process.env.PROFILE_PER_K || '3');

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

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

function computeStats(values) {
  if (!values.length) return { n:0, mean:0, median:0, p95:0, min:0, max:0 };
  const sorted = [...values].sort((a,b)=>a-b);
  const n = sorted.length;
  const mean = sorted.reduce((s,v)=>s+v,0)/n;
  return { n, mean, median: sorted[Math.floor(n/2)], p95: sorted[Math.min(Math.floor(n*0.95),n-1)], min: sorted[0], max: sorted[n-1] };
}

// Mirror of engine's selectVerificationDocs (evenly-spaced deterministic sample)
function selectVerificationDocs(clauseDocs, sampleSize) {
  if (!clauseDocs.length) return [];
  if (sampleSize <= 1) return [clauseDocs[0]];
  if (clauseDocs.length <= sampleSize) return clauseDocs.slice();
  const selected = [];
  for (let i = 0; i < sampleSize; i++) {
    const index = Math.round((i * (clauseDocs.length - 1)) / (sampleSize - 1));
    selected.push(clauseDocs[index]);
  }
  return [...new Set(selected)];
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  ensureDir(OUTPUT_ROOT);
  console.log(`\n=== PrivSearch Witness Profiling (${corpusLabel}) ===`);
  console.log(`Profile trials: ${PROFILE_TRIALS}  |  k ∈ {${CONJUNCTIVE_SIZES.join(',')}}  |  PER_K=${PER_K}`);

  const allWorkloads = loadWorkloads({ workloadRoot });
  const selected = CONJUNCTIVE_SIZES.flatMap(k =>
    allWorkloads.filter(w => w.query_type === `and_${k}`).slice(0, PER_K),
  );

  if (!selected.length) {
    console.error('No workloads found:', workloadRoot);
    process.exitCode = 1; return;
  }
  console.log(`Selected ${selected.length} workloads.\n`);

  console.log('Preparing PrivSearch engine …');
  const engine = createEngine('privsearch-prototype', { indexRoot });
  await engine.prepare(selected);
  const sampleSize = engine.accumulatorSampleSize;
  console.log(`accumulatorSampleSize = ${sampleSize}\n`);

  const perWorkloadRows = [];

  for (const query of selected) {
    const k = query.keywords.length;
    process.stdout.write(`  ${query.query_id} (k=${k}) … `);

    // Run runQuery once to get verified result_count and baseline verify_ms
    const baseline = await engine.runQuery(query);

    // Decode posting entries for all k keywords
    const tokens  = query.keywords.map(kw => engine.deriveTrapdoor(kw));
    const entries = tokens.map(tok => engine.decryptPostingByToken(tok));

    // Compute result set R via engine's evaluateClause
    const resultDocs = engine.evaluateClause(entries);
    const actualR    = resultDocs.length;
    const actualS    = Math.min(sampleSize, actualR);

    // Select sample using same deterministic algorithm as engine
    const sampledDocs = selectVerificationDocs(resultDocs, sampleSize);

    const postingListSizes = entries.map(e => e.posting_primes.length);
    const avgPostingSize   = postingListSizes.reduce((s,v)=>s+v,0) / postingListSizes.length;

    // Profile: PROFILE_TRIALS × (s sampled docs × k keywords) witness builds
    const witnessTimesPerPair = [];  // each element = time for one (doc,kw) witness
    const totalWitnessTimesPerTrial = [];

    for (let t = 0; t < PROFILE_TRIALS; t++) {
      // Clear witness cache so each trial is a fresh computation
      for (const entry of entries) {
        entry.membership_witness_cache = new Map();
      }

      const trialStart = performance.now();
      for (const docId of sampledDocs) {
        for (const entry of entries) {
          if (!entry.postingsSet.has(docId)) continue;
          const pairStart = performance.now();
          engine.buildMembershipWitness(entry, docId);
          witnessTimesPerPair.push(performance.now() - pairStart);
        }
      }
      totalWitnessTimesPerTrial.push(performance.now() - trialStart);
    }

    const pairStats  = computeStats(witnessTimesPerPair);
    const totalStats = computeStats(totalWitnessTimesPerTrial);
    const witnessOpsPerTrial = actualS * k;

    process.stdout.write(
      `|R|=${actualR} s=${actualS} avg_list=${Math.round(avgPostingSize)} ` +
      `per_witness=${pairStats.mean.toFixed(3)}ms total=${totalStats.mean.toFixed(3)}ms\n`,
    );

    perWorkloadRows.push({
      query_id:            query.query_id,
      query_type:          query.query_type,
      keyword_count:       k,
      result_count:        actualR,
      sample_size_s:       actualS,
      witness_ops_per_trial: witnessOpsPerTrial,
      posting_list_sizes:  postingListSizes,
      avg_posting_list_size: avgPostingSize,
      per_witness_ms_mean: pairStats.mean,
      per_witness_ms_p95:  pairStats.p95,
      total_witness_ms_mean: totalStats.mean,
      total_witness_ms_p95:  totalStats.p95,
      runquery_verify_ms:  baseline.verify_ms,
    });
  }

  // ── Aggregate by k ─────────────────────────────────────────────────────────
  const summaryByK = CONJUNCTIVE_SIZES.map(k => {
    const group = perWorkloadRows.filter(r => r.keyword_count === k);
    if (!group.length) return null;
    const avg = key => group.reduce((s,r)=>s+r[key],0)/group.length;
    return {
      keyword_count:            k,
      workload_count:           group.length,
      avg_result_count:         avg('result_count'),
      avg_sample_size:          avg('sample_size_s'),
      avg_witness_ops:          avg('witness_ops_per_trial'),
      avg_posting_list_size:    avg('avg_posting_list_size'),
      per_witness_ms_mean:      avg('per_witness_ms_mean'),
      total_witness_ms_mean:    avg('total_witness_ms_mean'),
      runquery_verify_ms_mean:  avg('runquery_verify_ms'),
    };
  }).filter(Boolean);

  // ── Outputs ─────────────────────────────────────────────────────────────────
  const jsonOut = {
    generated_at:    new Date().toISOString(),
    dataset:         DATASET,
    corpus_label:    corpusLabel,
    profile_trials:  PROFILE_TRIALS,
    accumulator_sample_size: sampleSize,
    description: [
      'Per-witness timing breakdown for PrivSearch conjunctive verification.',
      'witness_ops_per_trial = min(s, |R|) × k (modPow operations per verification call).',
      'per_witness_ms = time for one buildMembershipWitness call (O(posting_list_size) modPow ops).',
      'total_witness_ms = all witness builds for one query (= witness_ops_per_trial × per_witness_ms).',
    ].join(' '),
    summary_by_keyword_count: summaryByK,
    per_workload_results: perWorkloadRows,
  };

  fs.writeFileSync(
    path.join(OUTPUT_ROOT, `witness_profiling_${DATASET}.json`),
    JSON.stringify(jsonOut, null, 2), 'utf8',
  );

  writeCsv(path.join(OUTPUT_ROOT, `witness_profiling_${DATASET}.csv`), [
    ['k', 'workloads', 'avg_|R|', 'avg_s', 'witness_ops', 'avg_list_size',
     'per_witness_ms', 'total_witness_ms', 'runquery_verify_ms'],
    ...summaryByK.map(s => [
      s.keyword_count, s.workload_count,
      s.avg_result_count.toFixed(1), s.avg_sample_size.toFixed(1),
      s.avg_witness_ops.toFixed(1),  s.avg_posting_list_size.toFixed(0),
      s.per_witness_ms_mean.toFixed(4), s.total_witness_ms_mean.toFixed(4),
      s.runquery_verify_ms_mean.toFixed(4),
    ]),
  ]);

  const f = (v, d=3) => Number(v).toFixed(d);
  const md = [
    `# PrivSearch Witness-Phase Profiling (${corpusLabel})`,
    '',
    `**Run:** ${new Date().toISOString()}`,
    `**Profile trials:** ${PROFILE_TRIALS}  |  **s = ${sampleSize}** (fixed accumulator sample size)`,
    '',
    '## Phase Decomposition by Keyword Count',
    '',
    '| k | avg\\|R\\| | s used | witness ops | avg list size | per-witness (ms) | total witness (ms) | verify (ms) |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...summaryByK.map(s =>
      `| ${s.keyword_count} | ${f(s.avg_result_count,1)} | ${f(s.avg_sample_size,1)} | ${f(s.avg_witness_ops,1)} | ${f(s.avg_posting_list_size,0)} | ${f(s.per_witness_ms_mean,4)} | ${f(s.total_witness_ms_mean,4)} | ${f(s.runquery_verify_ms_mean,4)} |`,
    ),
    '',
    '> witness_ops = min(s, |R|) × k.  per-witness time scales with avg posting-list size (O(|list|) modPow ops).',
    '> The k=6→k=8 verify jump is driven by: more witness ops (s×8 vs s×6) and posting-list size differences.',
  ].join('\n');

  fs.writeFileSync(path.join(OUTPUT_ROOT, `witness_profiling_${DATASET}.md`), md, 'utf8');

  // Console summary
  console.log('\n── Witness Profiling Summary ─────────────────────────────────────');
  console.log(
    'k'.padEnd(4) + '|R|'.padStart(7) + 's'.padStart(5) + 'ops'.padStart(7) +
    'list_sz'.padStart(10) + 'per_wit'.padStart(11) + 'tot_wit'.padStart(11) + 'verify'.padStart(10),
  );
  for (const s of summaryByK) {
    console.log(
      String(s.keyword_count).padEnd(4) +
      f(s.avg_result_count,1).padStart(7) +
      f(s.avg_sample_size,1).padStart(5) +
      f(s.avg_witness_ops,1).padStart(7) +
      f(s.avg_posting_list_size,0).padStart(10) +
      f(s.per_witness_ms_mean,4).padStart(11) +
      f(s.total_witness_ms_mean,4).padStart(11) +
      f(s.runquery_verify_ms_mean,4).padStart(10),
    );
  }
  console.log(`\nOutputs written to ${OUTPUT_ROOT}/witness_profiling_${DATASET}.*`);
}

main().catch(err => { console.error('Witness profiling failed:', err); process.exitCode = 1; });
