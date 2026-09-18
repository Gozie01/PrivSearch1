require('dotenv/config');

const fs = require('fs');
const path = require('path');
const { loadWorkloads, writeCsv } = require('./privsearch/workload-lib');
const { createEngine } = require('./privsearch/engine-registry');

const ROOT = path.resolve(__dirname, '..');
const WORKLOAD_ROOT = path.join(ROOT, 'NweDB', 'enron_query_workloads');
const INDEX_ROOT = path.join(ROOT, 'NweDB', 'enron_inverted_index');
const OUTPUT_ROOT = path.join(ROOT, 'NweDB', 'benchmark_runs');

const ENGINE_NAME = process.env.PRIVSEARCH_ENGINE || 'privsearch-prototype';
const TRIALS = Number(process.env.SEACQ_COMPARISON_TRIALS || '10');
const WARMUP_TRIALS = Number(process.env.SEACQ_COMPARISON_WARMUP_TRIALS || '5');
const SINGLE_TOTAL = Number(process.env.SEACQ_COMPARISON_SINGLE_TOTAL || '0');
const DIRECT_COMPARISON_SIZES = [2, 4, 6, 8, 10];
const QUERY_TOTALS = {
  and_2: Number(process.env.SEACQ_COMPARISON_AND2_TOTAL || '3'),
  and_4: Number(process.env.SEACQ_COMPARISON_AND4_TOTAL || '3'),
  and_6: Number(process.env.SEACQ_COMPARISON_AND6_TOTAL || '3'),
  and_8: Number(process.env.SEACQ_COMPARISON_AND8_TOTAL || '3'),
  and_10: Number(process.env.SEACQ_COMPARISON_AND10_TOTAL || '3'),
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function formatTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function computeStats(values) {
  if (!values.length) {
    return {
      n: 0,
      mean: 0,
      median: 0,
      p95: 0,
      p99: 0,
      min: 0,
      max: 0,
      stddev: 0,
      ci95_low: 0,
      ci95_high: 0,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const pick = (q) => sorted[Math.min(Math.floor((n - 1) * q), n - 1)];
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const variance = n > 1
    ? sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)
    : 0;
  const stddev = Math.sqrt(variance);
  const margin = n > 1 ? 1.96 * (stddev / Math.sqrt(n)) : 0;

  return {
    n,
    mean,
    median: pick(0.5),
    p95: pick(0.95),
    p99: pick(0.99),
    min: sorted[0],
    max: sorted[n - 1],
    stddev,
    ci95_low: mean - margin,
    ci95_high: mean + margin,
  };
}

function sampleEvenly(items, count) {
  if (count <= 0) {
    return [];
  }

  if (items.length <= count) {
    return items.slice();
  }

  if (count <= 1) {
    return [items[0]];
  }

  const selected = [];
  const used = new Set();
  for (let i = 0; i < count; i += 1) {
    const index = Math.round((i * (items.length - 1)) / (count - 1));
    if (!used.has(index)) {
      selected.push(items[index]);
      used.add(index);
    }
  }

  if (selected.length < count) {
    for (let i = 0; i < items.length && selected.length < count; i += 1) {
      if (!used.has(i)) {
        selected.push(items[i]);
        used.add(i);
      }
    }
  }

  return selected;
}

function benchmarkBucketLabel(queryType) {
  if (queryType === 'single_keyword') {
    return 'PrivSearch internal baseline; SeaCQ published keyword-sweep figures do not directly report single-keyword timing';
  }
  const match = /^and_(\d+)$/.exec(queryType);
  if (match && DIRECT_COMPARISON_SIZES.includes(Number(match[1]))) {
    return `SeaCQ direct published comparable (${match[1]}-keyword conjunctive)`;
  }
  if (queryType === 'and_5') {
    return 'PrivSearch internal interpolation point; SeaCQ published keyword sweep does not report exactly 5 keywords';
  }
  return 'non-comparable';
}

function selectRepresentativeWorkloads(workloads) {
  const singles = workloads.filter((row) => row.query_type === 'single_keyword');
  const selectedConjunctive = DIRECT_COMPARISON_SIZES.flatMap((size) => {
    const queryType = `and_${size}`;
    const rows = workloads.filter((row) => row.query_type === queryType);
    return sampleEvenly(rows, QUERY_TOTALS[queryType]);
  });

  if (SINGLE_TOTAL <= 0) {
    return selectedConjunctive;
  }

  const singlesByBucket = {
    rare: singles.filter((row) => row.bucket_profile === 'rare'),
    low: singles.filter((row) => row.bucket_profile === 'low'),
    medium: singles.filter((row) => row.bucket_profile === 'medium'),
    high: singles.filter((row) => row.bucket_profile === 'high'),
  };

  const perBucketSingleCount = Math.max(1, Math.floor(SINGLE_TOTAL / 4));
  const selectedSingles = [
    ...sampleEvenly(singlesByBucket.rare, perBucketSingleCount),
    ...sampleEvenly(singlesByBucket.low, perBucketSingleCount),
    ...sampleEvenly(singlesByBucket.medium, perBucketSingleCount),
    ...sampleEvenly(singlesByBucket.high, perBucketSingleCount),
  ].slice(0, SINGLE_TOTAL);

  return [...selectedSingles, ...selectedConjunctive];
}

async function benchmarkQuery(engine, query, trials, warmupTrials) {
  for (let i = 0; i < warmupTrials; i += 1) {
    await engine.runQuery(query);
  }

  const runs = [];

  for (let i = 0; i < trials; i += 1) {
    runs.push(await engine.runQuery(query));
  }

  return {
    query_id: query.query_id,
    query_type: query.query_type,
    bucket_profile: query.bucket_profile,
    expected_result_count: query.expected_result_count,
    observed_result_count: runs[0]?.result_count || 0,
    trials,
    warmup_trials: warmupTrials,
    verification_failures: runs.filter((run) => !run.verified).length,
    setup_stats: computeStats(runs.map((run) => run.setup_ms)),
    search_stats: computeStats(runs.map((run) => run.search_ms)),
    verify_stats: computeStats(runs.map((run) => run.verify_ms)),
    total_stats: computeStats(runs.map((run) => run.total_ms)),
    verification_mode: runs[0]?.verification_mode || 'unknown',
  };
}

function summarizeByQueryType(results) {
  const grouped = new Map();
  for (const row of results) {
    if (!grouped.has(row.query_type)) {
      grouped.set(row.query_type, []);
    }
    grouped.get(row.query_type).push(row);
  }

  const summary = [];
  for (const [queryType, rows] of grouped.entries()) {
    summary.push({
      query_type: queryType,
      query_count: rows.length,
      mean_setup_ms: rows.reduce((sum, row) => sum + row.setup_stats.mean, 0) / rows.length,
      mean_search_ms: rows.reduce((sum, row) => sum + row.search_stats.mean, 0) / rows.length,
      mean_verify_ms: rows.reduce((sum, row) => sum + row.verify_stats.mean, 0) / rows.length,
      mean_total_ms: rows.reduce((sum, row) => sum + row.total_stats.mean, 0) / rows.length,
      p95_total_ms: rows.reduce((sum, row) => sum + row.total_stats.p95, 0) / rows.length,
      verification_failures: rows.reduce((sum, row) => sum + row.verification_failures, 0),
    });
  }

  return summary.sort((a, b) => a.query_type.localeCompare(b.query_type));
}

async function main() {
  ensureDir(OUTPUT_ROOT);

  const workloads = loadWorkloads({ workloadRoot: WORKLOAD_ROOT }).filter((row) =>
    row.query_type === 'single_keyword'
    || DIRECT_COMPARISON_SIZES.some((size) => row.query_type === `and_${size}`));

  const selectedWorkloads = selectRepresentativeWorkloads(workloads);
  const engine = createEngine(ENGINE_NAME, { indexRoot: INDEX_ROOT, workloadRoot: WORKLOAD_ROOT });

  console.log(`Preparing engine "${engine.name}" for ${selectedWorkloads.length} SeaCQ-comparable workloads...`);
  await engine.prepare(selectedWorkloads);

  const results = [];
  for (const query of selectedWorkloads) {
    console.log(`Benchmarking ${query.query_id} (${query.query_type}) with ${TRIALS} measured trials after ${WARMUP_TRIALS} warmup runs...`);
    results.push(await benchmarkQuery(engine, query, TRIALS, WARMUP_TRIALS));
  }

  const generatedAt = new Date().toISOString();
  const runId = `seacq_comparison_${ENGINE_NAME}_${formatTimestamp(new Date())}`;
  const runDir = path.join(OUTPUT_ROOT, runId);
  ensureDir(runDir);

  const summary = summarizeByQueryType(results);

  fs.writeFileSync(path.join(runDir, 'seacq_comparison_results.json'), JSON.stringify({
    generated_at: generatedAt,
    run_id: runId,
    engine: engine.name,
    trials_per_query: TRIALS,
    warmup_trials_per_query: WARMUP_TRIALS,
    selected_workload_count: selectedWorkloads.length,
    summary_by_query_type: summary,
    query_results: results,
    notes: [
      'This comparison pack covers Enron conjunctive workloads intended for SeaCQ-side comparison.',
      `Each query is warmed up for ${WARMUP_TRIALS} runs before measurement to avoid conflating cache construction with steady-state latency.`,
      'SeaCQ published keyword-count figures are reported for 2, 4, 6, 8, and 10 keywords.',
      'The query families and_2, and_4, and_6, and_8, and_10 are the direct published comparison points in the SeaCQ keyword sweep.',
      'The single_keyword row is optional and useful for PrivSearch internal scaling, but it is not a direct published SeaCQ figure match.',
      'SeaCQ published values still need to be entered manually from the paper unless a cleaner extraction path becomes available.',
      'OR-query workloads are intentionally excluded here because SeaCQ does not support them.',
    ],
  }, null, 2), 'utf8');

  writeCsv(path.join(runDir, 'selected_workloads.csv'), [
    ['query_id', 'query_type', 'bucket_profile', 'expected_result_count', 'comparison_role'],
    ...selectedWorkloads.map((row) => [
      row.query_id,
      row.query_type,
      row.bucket_profile,
      row.expected_result_count,
      benchmarkBucketLabel(row.query_type),
    ]),
  ]);

  writeCsv(path.join(runDir, 'seacq_comparison_table.csv'), [
    [
      'query_type',
      'privsearch_query_count',
      'privsearch_mean_setup_ms',
      'privsearch_mean_search_ms',
      'privsearch_mean_verify_ms',
      'privsearch_mean_total_ms',
      'privsearch_mean_p95_total_ms',
      'privsearch_verification_failures',
      'seacq_published_setup_ms',
      'seacq_published_search_ms',
      'seacq_published_verify_ms',
      'seacq_published_total_ms',
      'notes',
    ],
    ...summary.map((row) => [
      row.query_type,
      row.query_count,
      row.mean_setup_ms,
      row.mean_search_ms,
      row.mean_verify_ms,
      row.mean_total_ms,
      row.p95_total_ms,
      row.verification_failures,
      '',
      '',
      '',
      '',
      benchmarkBucketLabel(row.query_type),
    ]),
  ]);

  writeCsv(path.join(runDir, 'seacq_comparison_query_results.csv'), [
    [
      'query_id',
      'query_type',
      'bucket_profile',
      'expected_result_count',
      'observed_result_count',
      'trials',
      'warmup_trials',
      'verification_failures',
      'setup_mean_ms',
      'search_mean_ms',
      'verify_mean_ms',
      'total_mean_ms',
      'total_p95_ms',
    ],
    ...results.map((row) => [
      row.query_id,
      row.query_type,
      row.bucket_profile,
      row.expected_result_count,
      row.observed_result_count,
      row.trials,
      row.warmup_trials,
      row.verification_failures,
      row.setup_stats.mean,
      row.search_stats.mean,
      row.verify_stats.mean,
      row.total_stats.mean,
      row.total_stats.p95,
    ]),
  ]);

  const md = [
    '# SeaCQ Comparison Pack',
    '',
    `Generated: ${generatedAt}`,
    '',
    `Run ID: ${runId}`,
    '',
    `Engine: ${engine.name}`,
    '',
    `Trials per query: ${TRIALS}`,
    '',
    `Warmup trials per query: ${WARMUP_TRIALS}`,
    '',
    `Selected workloads: ${selectedWorkloads.length}`,
    '',
    '| Query Type | Queries | Setup ms | Search ms | Verify ms | Total ms | P95 total ms | SeaCQ Published |',
    '|---|---:|---:|---:|---:|---:|---:|---|',
    ...summary.map((row) => `| ${row.query_type} | ${row.query_count} | ${row.mean_setup_ms.toFixed(4)} | ${row.mean_search_ms.toFixed(4)} | ${row.mean_verify_ms.toFixed(4)} | ${row.mean_total_ms.toFixed(4)} | ${row.p95_total_ms.toFixed(4)} | pending manual entry |`),
    '',
    'Notes:',
    '- This pack is intentionally limited to Enron conjunctive workloads intended for SeaCQ-side comparison.',
    `- Each query is warmed up for ${WARMUP_TRIALS} runs before the measured trials are recorded.`,
    '- SeaCQ published keyword-count plots use 2, 4, 6, 8, and 10 keywords.',
    '- `and_2`, `and_4`, `and_6`, `and_8`, and `and_10` are the direct published comparison points.',
    '- `single_keyword` is optional as a PrivSearch internal baseline, not a direct published SeaCQ plot point.',
    '- OR queries are excluded from this table because SeaCQ cannot execute them.',
    '- Fill `seacq_comparison_table.csv` with the published SeaCQ phase timings once the paper values are extracted.',
  ].join('\n');
  fs.writeFileSync(path.join(runDir, 'seacq_comparison_report.md'), md, 'utf8');

  console.log(`SeaCQ comparison pack written to ${runDir}`);
}

main().catch((error) => {
  console.error('SeaCQ comparison run failed:', error);
  process.exitCode = 1;
});
