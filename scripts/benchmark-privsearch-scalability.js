require('dotenv/config');

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { loadWorkloads, writeCsv } = require('./privsearch/workload-lib');
const { createEngine } = require('./privsearch/engine-registry');

const ROOT = path.resolve(__dirname, '..');
const RESULTS_ROOT = path.join(ROOT, 'Results', 'paper_assets');
const OUTPUT_STEM = 'privsearch_scalability';
const DATASET = process.env.PRIVSEARCH_SCALABILITY_DATASET || 'enron';
const ENGINE_NAME = process.env.PRIVSEARCH_SCALABILITY_ENGINE || 'privsearch-prototype';
const TRIALS = Number(process.env.PRIVSEARCH_SCALABILITY_TRIALS || '5');
const POSTING_BUCKET_SAMPLE = Number(process.env.PRIVSEARCH_SCALABILITY_POSTING_SAMPLE || '5');
const CLAUSE_GROUP_SAMPLE = Number(process.env.PRIVSEARCH_SCALABILITY_CLAUSE_SAMPLE || '5');
const CONCURRENCY_REQUESTS = Number(process.env.PRIVSEARCH_SCALABILITY_CONCURRENCY_REQUESTS || '24');
const CONCURRENCY_LEVELS = String(process.env.PRIVSEARCH_SCALABILITY_LEVELS || '1,5,10,25')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);
const CONCURRENCY_QUERY_TYPES = String(
  process.env.PRIVSEARCH_SCALABILITY_CONCURRENCY_TYPES || 'and_2,or_2,range_month_1',
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const MANIFEST_PATH = process.env.PRIVSEARCH_SCALABILITY_MANIFEST
  || path.join(RESULTS_ROOT, 'privsearch_scalability_manifest.json');

const DATASET_DEFAULTS = {
  enron: {
    workloadRoot: path.join(ROOT, 'NweDB', 'enron_query_workloads'),
    indexRoot: path.join(ROOT, 'NweDB', 'enron_inverted_index'),
    corpusFile: '',
    processedRoot: path.join(ROOT, 'NweDB', 'enron_processed'),
  },
  healthcare: {
    workloadRoot: path.join(ROOT, 'NweDB', 'healthcare', 'query_workloads'),
    indexRoot: path.join(ROOT, 'NweDB', 'healthcare', 'inverted_index'),
    corpusFile: path.join(ROOT, 'NweDB', 'healthcare', 'combined', 'healthcare_privsearch_corpus.jsonl'),
    processedRoot: '',
  },
};

const datasetDefaults = DATASET_DEFAULTS[DATASET] || DATASET_DEFAULTS.enron;
const WORKLOAD_ROOT = process.env.PRIVSEARCH_SCALABILITY_WORKLOAD_ROOT || datasetDefaults.workloadRoot;
const INDEX_ROOT = process.env.PRIVSEARCH_SCALABILITY_INDEX_ROOT || datasetDefaults.indexRoot;
const CORPUS_FILE = process.env.PRIVSEARCH_SCALABILITY_CORPUS_FILE || datasetDefaults.corpusFile;
const PROCESSED_ROOT = process.env.PRIVSEARCH_SCALABILITY_PROCESSED_ROOT || datasetDefaults.processedRoot;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function formatNumber(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'n/a';
  }
  return Number(value).toFixed(digits);
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
  const percentile = (q) => {
    const index = Math.min(Math.floor((n - 1) * q), n - 1);
    return sorted[index];
  };
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const variance = n > 1
    ? sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)
    : 0;
  const stddev = Math.sqrt(variance);
  const margin = n > 1 ? 1.96 * (stddev / Math.sqrt(n)) : 0;

  return {
    n,
    mean,
    median: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    min: sorted[0],
    max: sorted[n - 1],
    stddev,
    ci95_low: mean - margin,
    ci95_high: mean + margin,
  };
}

function resultEnvelope(result, rssBefore, rssAfter) {
  return {
    setup_ms: Number(result.setup_ms || 0),
    search_ms: Number(result.search_ms || 0),
    verify_ms: Number(result.verify_ms || 0),
    total_ms: Number(result.total_ms || 0),
    proof_size_bytes: result.proof_hints
      ? Buffer.byteLength(JSON.stringify(result.proof_hints), 'utf8')
      : 0,
    memory_delta_bytes: rssAfter - rssBefore,
    verified: Boolean(result.verified),
  };
}

async function runTrials(engine, query, trials) {
  const runs = [];
  for (let i = 0; i < trials; i += 1) {
    const rssBefore = process.memoryUsage().rss;
    const result = await engine.runQuery(query);
    const rssAfter = process.memoryUsage().rss;
    runs.push(resultEnvelope(result, rssBefore, rssAfter));
  }
  return runs;
}

function aggregateRuns(runs) {
  const totalStats = computeStats(runs.map((run) => run.total_ms));
  const searchStats = computeStats(runs.map((run) => run.search_ms));
  const verifyStats = computeStats(runs.map((run) => run.verify_ms));
  const memoryStats = computeStats(runs.map((run) => run.memory_delta_bytes));
  const proofStats = computeStats(runs.map((run) => run.proof_size_bytes));
  return {
    total_stats: totalStats,
    search_stats: searchStats,
    verify_stats: verifyStats,
    memory_stats: memoryStats,
    proof_stats: proofStats,
    verification_failures: runs.filter((run) => !run.verified).length,
  };
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    return { corpus_size_points: [], vocabulary_size_points: [] };
  }
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function deriveClauseInfo(query) {
  if (query.query_type === 'single_keyword') {
    return { mode: 'single', clause_count: 1 };
  }
  if (query.query_type.startsWith('and_')) {
    return { mode: 'conjunctive', clause_count: (query.keywords || []).length || 1 };
  }
  if (query.query_type === 'or_2' || query.query_type === 'or_3') {
    return { mode: 'disjunctive', clause_count: (query.keywords || []).length || 1 };
  }
  if (query.query_type === 'or_of_and') {
    return { mode: 'dnf', clause_count: 2 };
  }
  if (query.query_type.startsWith('range_')) {
    return { mode: 'range', clause_count: (query.range_values || []).length || 1 };
  }
  if (query.query_type === 'fuzzy_1') {
    return { mode: 'fuzzy', clause_count: (query.keywords || []).length || 1 };
  }
  if (query.query_type === 'semantic_v1') {
    return { mode: 'semantic_v1', clause_count: (query.matched_keywords || query.keywords || []).length || 1 };
  }
  return { mode: 'unknown', clause_count: 1 };
}

function postingBucket(docFreq) {
  const freq = Number(docFreq || 0);
  if (freq <= 10) {
    return 'P1_1_10';
  }
  if (freq <= 100) {
    return 'P2_11_100';
  }
  if (freq <= 1000) {
    return 'P3_101_1000';
  }
  if (freq <= 10000) {
    return 'P4_1001_10000';
  }
  return 'P5_10001_plus';
}

function representativeWorkloads(workloads, sampleSize, keyFn) {
  const grouped = new Map();
  for (const workload of workloads) {
    const key = keyFn(workload);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(workload);
  }

  const selected = new Map();
  for (const [key, group] of grouped.entries()) {
    selected.set(key, group.slice(0, sampleSize));
  }
  return selected;
}

async function prepareEngine(workloads, options = {}) {
  const engine = createEngine(ENGINE_NAME, {
    indexRoot: options.indexRoot || INDEX_ROOT,
    corpusFile: options.corpusFile || CORPUS_FILE || undefined,
    processedRoot: options.processedRoot || PROCESSED_ROOT || undefined,
  });
  await engine.prepare(workloads, options.prepareOptions || {});
  return engine;
}

async function runPostingListAxis(allWorkloads) {
  const candidates = allWorkloads
    .filter((workload) => workload.query_type === 'single_keyword' && Number(workload.doc_freq || 0) > 0)
    .sort((left, right) => Number(left.doc_freq || 0) - Number(right.doc_freq || 0));
  const groups = representativeWorkloads(candidates, POSTING_BUCKET_SAMPLE, (workload) => postingBucket(workload.doc_freq));
  const engine = await prepareEngine(candidates);
  const rows = [];

  for (const [bucket, group] of groups.entries()) {
    const aggregates = [];
    for (const query of group) {
      const runs = await runTrials(engine, query, TRIALS);
      aggregates.push({
        query,
        aggregate: aggregateRuns(runs),
      });
    }

    const totalMeans = aggregates.map((row) => row.aggregate.total_stats.mean);
    const searchMeans = aggregates.map((row) => row.aggregate.search_stats.mean);
    const verifyMeans = aggregates.map((row) => row.aggregate.verify_stats.mean);
    const proofMeans = aggregates.map((row) => row.aggregate.proof_stats.mean);
    const memoryMeans = aggregates.map((row) => row.aggregate.memory_stats.mean);
    const docFreqs = aggregates.map((row) => Number(row.query.doc_freq || 0));

    rows.push({
      axis: 'posting_list_size',
      bucket,
      query_count: group.length,
      mean_doc_freq: computeStats(docFreqs).mean,
      total_stats: computeStats(totalMeans),
      search_stats: computeStats(searchMeans),
      verify_stats: computeStats(verifyMeans),
      proof_stats: computeStats(proofMeans),
      memory_stats: computeStats(memoryMeans),
      total_verification_failures: aggregates.reduce((sum, row) => sum + row.aggregate.verification_failures, 0),
    });
  }

  return rows.sort((left, right) => left.bucket.localeCompare(right.bucket));
}

async function runClauseCountAxis(allWorkloads) {
  const supported = allWorkloads.filter((workload) => (
    workload.query_type === 'single_keyword'
    || workload.query_type.startsWith('and_')
    || workload.query_type === 'or_2'
    || workload.query_type === 'or_3'
    || workload.query_type === 'or_of_and'
  ));
  const groups = representativeWorkloads(supported, CLAUSE_GROUP_SAMPLE, (workload) => {
    const info = deriveClauseInfo(workload);
    return `${info.mode}:${info.clause_count}`;
  });
  // Skip eager witness precompute for ALL supported workloads (very slow at 2048-bit).
  // Witnesses will be built lazily during the warmup pass below, which only
  // covers the sampled queries actually measured (CLAUSE_GROUP_SAMPLE per group).
  const engine = await prepareEngine(supported, { prepareOptions: { noWitnesses: true } });

  // Warmup: run each sampled query once to build its witnesses lazily and warm JIT.
  process.stdout.write('[scalability] Warming up clause-count workloads (lazy witness build)...\n');
  for (const [, group] of groups.entries()) {
    for (const query of group) {
      await engine.runQuery(query);
    }
  }
  process.stdout.write('[scalability] Warmup done.\n');

  const rows = [];

  for (const [key, group] of groups.entries()) {
    const [mode, clauseCountText] = key.split(':');
    const aggregates = [];
    for (const query of group) {
      const runs = await runTrials(engine, query, TRIALS);
      aggregates.push({
        query,
        aggregate: aggregateRuns(runs),
      });
    }

    rows.push({
      axis: 'clause_count',
      mode,
      clause_count: Number(clauseCountText || '0'),
      query_count: group.length,
      total_stats: computeStats(aggregates.map((row) => row.aggregate.total_stats.mean)),
      verify_stats: computeStats(aggregates.map((row) => row.aggregate.verify_stats.mean)),
      proof_stats: computeStats(aggregates.map((row) => row.aggregate.proof_stats.mean)),
      memory_stats: computeStats(aggregates.map((row) => row.aggregate.memory_stats.mean)),
      total_verification_failures: aggregates.reduce((sum, row) => sum + row.aggregate.verification_failures, 0),
    });
  }

  return rows.sort((left, right) => {
    if (left.mode !== right.mode) {
      return left.mode.localeCompare(right.mode);
    }
    return left.clause_count - right.clause_count;
  });
}

async function runConcurrencyLevel(engine, query, totalRequests, concurrency) {
  // Warmup: run sequential requests to heat JIT and ensure witnesses are cached,
  // so that both wall_time_ms (throughput denominator) and latency samples
  // come from the same post-warmup measurement window.
  const CONCURRENCY_WARMUP = 5;
  for (let w = 0; w < CONCURRENCY_WARMUP; w++) await engine.runQuery(query);

  const latencies = [];
  const proofSizes = [];
  const memoryDeltas = [];
  let failures = 0;
  let nextIndex = 0;
  const wallStart = performance.now();

  async function worker() {
    while (true) {
      const taskIndex = nextIndex;
      if (taskIndex >= totalRequests) {
        break;
      }
      nextIndex += 1;
      const rssBefore = process.memoryUsage().rss;
      const result = await engine.runQuery(query);
      const rssAfter = process.memoryUsage().rss;
      const envelope = resultEnvelope(result, rssBefore, rssAfter);
      latencies.push(envelope.total_ms);
      proofSizes.push(envelope.proof_size_bytes);
      memoryDeltas.push(envelope.memory_delta_bytes);
      if (!envelope.verified) {
        failures += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, totalRequests) }, () => worker()));
  const wallTimeMs = performance.now() - wallStart;
  const latencyStats = computeStats(latencies);
  return {
    concurrency,
    requests: totalRequests,
    success_rate: latencies.length ? (latencies.length - failures) / latencies.length : 0,
    timeout_rate: 0,
    throughput_rps: latencies.length ? (latencies.length - failures) / (wallTimeMs / 1000) : 0,
    queueing_delay_ms: Math.max(0, latencyStats.mean - (wallTimeMs / Math.max(latencies.length, 1))),
    wall_time_ms: wallTimeMs,
    latency_stats: latencyStats,
    proof_stats: computeStats(proofSizes),
    memory_stats: computeStats(memoryDeltas),
    verification_failures: failures,
  };
}

async function runConcurrencyAxis(allWorkloads) {
  const selectedQueries = [];
  const chosenTypes = new Set(CONCURRENCY_QUERY_TYPES);
  for (const queryType of chosenTypes) {
    const match = allWorkloads.find((workload) => workload.query_type === queryType);
    if (match) {
      selectedQueries.push(match);
    }
  }
  const engine = await prepareEngine(selectedQueries);
  const rows = [];

  for (const query of selectedQueries) {
    for (const concurrency of CONCURRENCY_LEVELS) {
      const result = await runConcurrencyLevel(engine, query, CONCURRENCY_REQUESTS, concurrency);
      rows.push({
        axis: 'concurrent_users',
        query_type: query.query_type,
        concurrency,
        ...result,
      });
    }
  }

  return rows.sort((left, right) => {
    if (left.query_type !== right.query_type) {
      return left.query_type.localeCompare(right.query_type);
    }
    return left.concurrency - right.concurrency;
  });
}

async function runManifestAxis(points, axisName) {
  const rows = [];
  for (const point of points || []) {
    if (point.enabled === false) {
      rows.push({
        axis: axisName,
        label: point.label || 'disabled',
        status: 'disabled',
        configured_value: Number(point.configured_value || point.records || point.vocabulary || 0),
        notes: point.notes || 'Manifest entry disabled.',
      });
      continue;
    }

    const pointWorkloads = loadWorkloads({
      workloadRoot: point.workloadRoot || WORKLOAD_ROOT,
      queryTypes: point.queryTypes || ['single_keyword', 'and_2', 'and_4'],
    }).slice(0, Number(point.sampleQueries || 6));

    if (!pointWorkloads.length) {
      rows.push({
        axis: axisName,
        label: point.label || 'empty',
        status: 'empty',
        configured_value: Number(point.configured_value || point.records || point.vocabulary || 0),
        notes: point.notes || 'No workloads found for manifest point.',
      });
      continue;
    }

    const engine = await prepareEngine(pointWorkloads, {
      indexRoot: point.indexRoot || INDEX_ROOT,
      corpusFile: point.corpusFile || CORPUS_FILE || undefined,
      processedRoot: point.processedRoot || PROCESSED_ROOT || undefined,
    });
    const measured = [];
    for (const query of pointWorkloads) {
      const runs = await runTrials(engine, query, Number(point.trials || TRIALS));
      measured.push(aggregateRuns(runs));
    }

    rows.push({
      axis: axisName,
      label: point.label || `${axisName}_point`,
      status: 'measured',
      configured_value: Number(point.configured_value || point.records || point.vocabulary || 0),
      query_count: pointWorkloads.length,
      total_stats: computeStats(measured.map((row) => row.total_stats.mean)),
      verify_stats: computeStats(measured.map((row) => row.verify_stats.mean)),
      proof_stats: computeStats(measured.map((row) => row.proof_stats.mean)),
      memory_stats: computeStats(measured.map((row) => row.memory_stats.mean)),
      total_verification_failures: measured.reduce((sum, row) => sum + row.verification_failures, 0),
      notes: point.notes || '',
    });
  }
  return rows;
}

function renderCi(stats) {
  return `[${formatNumber(stats.ci95_low)}, ${formatNumber(stats.ci95_high)}]`;
}

async function main() {
  ensureDir(RESULTS_ROOT);

  const allWorkloads = loadWorkloads({ workloadRoot: WORKLOAD_ROOT });
  if (!allWorkloads.length) {
    throw new Error(`No workloads found in ${WORKLOAD_ROOT}`);
  }

  const manifest = loadManifest();
  const postingRows = await runPostingListAxis(allWorkloads);
  const clauseRows = await runClauseCountAxis(allWorkloads);
  const concurrencyRows = await runConcurrencyAxis(allWorkloads);
  const corpusRows = await runManifestAxis(manifest.corpus_size_points, 'corpus_size');
  const vocabularyRows = await runManifestAxis(manifest.vocabulary_size_points, 'vocabulary_size');

  const summary = {
    generated_at: new Date().toISOString(),
    dataset: DATASET,
    engine: ENGINE_NAME,
    trials_per_query: TRIALS,
    posting_list_rows: postingRows,
    clause_count_rows: clauseRows,
    concurrency_rows: concurrencyRows,
    corpus_size_rows: corpusRows,
    vocabulary_size_rows: vocabularyRows,
    notes: [
      'This is the first executable PrivSearch scalability skeleton.',
      'Posting-list, clause-count, and concurrent-user axes are measured directly on the current prototype.',
      'Corpus-size and vocabulary-size axes are manifest-driven so prepared slice indexes can be added without changing the script.',
      'Concurrent-user scaling here is same-process engine-level stress, not a full multi-host distributed deployment.',
    ],
  };

  const postingCsv = path.join(RESULTS_ROOT, `${OUTPUT_STEM}_postings.csv`);
  writeCsv(postingCsv, [
    ['bucket', 'query_count', 'mean_doc_freq', 'mean_total_ms', 'mean_search_ms', 'mean_verify_ms', 'mean_proof_size_bytes', 'mean_memory_delta_bytes', 'verification_failures'],
    ...postingRows.map((row) => [
      row.bucket,
      row.query_count,
      row.mean_doc_freq,
      row.total_stats.mean,
      row.search_stats.mean,
      row.verify_stats.mean,
      row.proof_stats.mean,
      row.memory_stats.mean,
      row.total_verification_failures,
    ]),
  ]);

  const clauseCsv = path.join(RESULTS_ROOT, `${OUTPUT_STEM}_clause_count.csv`);
  writeCsv(clauseCsv, [
    ['mode', 'clause_count', 'query_count', 'mean_total_ms', 'mean_verify_ms', 'mean_proof_size_bytes', 'mean_memory_delta_bytes', 'verification_failures'],
    ...clauseRows.map((row) => [
      row.mode,
      row.clause_count,
      row.query_count,
      row.total_stats.mean,
      row.verify_stats.mean,
      row.proof_stats.mean,
      row.memory_stats.mean,
      row.total_verification_failures,
    ]),
  ]);

  const concurrencyCsv = path.join(RESULTS_ROOT, `${OUTPUT_STEM}_concurrency.csv`);
  writeCsv(concurrencyCsv, [
    ['query_type', 'concurrency', 'requests', 'mean_total_ms', 'median_total_ms', 'p95_total_ms', 'throughput_rps', 'success_rate', 'queueing_delay_ms', 'mean_proof_size_bytes', 'mean_memory_delta_bytes', 'verification_failures'],
    ...concurrencyRows.map((row) => [
      row.query_type,
      row.concurrency,
      row.requests,
      row.latency_stats.mean,
      row.latency_stats.median,
      row.latency_stats.p95,
      row.throughput_rps,
      row.success_rate,
      row.queueing_delay_ms,
      row.proof_stats.mean,
      row.memory_stats.mean,
      row.verification_failures,
    ]),
  ]);

  const corpusCsv = path.join(RESULTS_ROOT, `${OUTPUT_STEM}_corpus.csv`);
  writeCsv(corpusCsv, [
    ['label', 'status', 'configured_value', 'query_count', 'mean_total_ms', 'mean_verify_ms', 'mean_proof_size_bytes', 'mean_memory_delta_bytes', 'verification_failures', 'notes'],
    ...corpusRows.map((row) => [
      row.label,
      row.status,
      row.configured_value,
      row.query_count || 0,
      row.total_stats ? row.total_stats.mean : '',
      row.verify_stats ? row.verify_stats.mean : '',
      row.proof_stats ? row.proof_stats.mean : '',
      row.memory_stats ? row.memory_stats.mean : '',
      row.total_verification_failures || 0,
      row.notes || '',
    ]),
  ]);

  const vocabularyCsv = path.join(RESULTS_ROOT, `${OUTPUT_STEM}_vocabulary.csv`);
  writeCsv(vocabularyCsv, [
    ['label', 'status', 'configured_value', 'query_count', 'mean_total_ms', 'mean_verify_ms', 'mean_proof_size_bytes', 'mean_memory_delta_bytes', 'verification_failures', 'notes'],
    ...vocabularyRows.map((row) => [
      row.label,
      row.status,
      row.configured_value,
      row.query_count || 0,
      row.total_stats ? row.total_stats.mean : '',
      row.verify_stats ? row.verify_stats.mean : '',
      row.proof_stats ? row.proof_stats.mean : '',
      row.memory_stats ? row.memory_stats.mean : '',
      row.total_verification_failures || 0,
      row.notes || '',
    ]),
  ]);

  const summaryJson = path.join(RESULTS_ROOT, `${OUTPUT_STEM}_summary.json`);
  fs.writeFileSync(summaryJson, JSON.stringify(summary, null, 2), 'utf8');

  const mdLines = [
    '# PrivSearch Scalability Summary',
    '',
    `Generated: ${summary.generated_at}`,
    '',
    `Dataset: ${DATASET}`,
    '',
    `Engine: ${ENGINE_NAME}`,
    '',
    `Trials per query: ${TRIALS}`,
    '',
    '## Posting-List Size',
    '',
    '| Bucket | Query Count | Mean Doc Freq | Mean Total (ms) | Mean Search (ms) | Mean Verify (ms) | Mean Proof Size (bytes) | Mean Memory Delta (bytes) |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...postingRows.map((row) => `| ${row.bucket} | ${row.query_count} | ${formatNumber(row.mean_doc_freq, 1)} | ${formatNumber(row.total_stats.mean)} | ${formatNumber(row.search_stats.mean)} | ${formatNumber(row.verify_stats.mean)} | ${formatNumber(row.proof_stats.mean, 0)} | ${formatNumber(row.memory_stats.mean, 0)} |`),
    '',
    '## Clause Count',
    '',
    '| Mode | Clause Count | Query Count | Mean Total (ms) | Mean Verify (ms) | Mean Proof Size (bytes) | 95% CI Total (ms) |',
    '|---|---:|---:|---:|---:|---:|---|',
    ...clauseRows.map((row) => `| ${row.mode} | ${row.clause_count} | ${row.query_count} | ${formatNumber(row.total_stats.mean)} | ${formatNumber(row.verify_stats.mean)} | ${formatNumber(row.proof_stats.mean, 0)} | ${renderCi(row.total_stats)} |`),
    '',
    '## Concurrent Users',
    '',
    '| Query Type | Concurrency | Mean Total (ms) | Median (ms) | P95 (ms) | Throughput (req/s) | Success Rate | Queueing Delay (ms) |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
    ...concurrencyRows.map((row) => `| ${row.query_type} | ${row.concurrency} | ${formatNumber(row.latency_stats.mean)} | ${formatNumber(row.latency_stats.median)} | ${formatNumber(row.latency_stats.p95)} | ${formatNumber(row.throughput_rps, 2)} | ${formatNumber(row.success_rate * 100, 2)}% | ${formatNumber(row.queueing_delay_ms)} |`),
    '',
    '## Corpus Size',
    '',
    '| Label | Status | Configured Value | Query Count | Mean Total (ms) | Mean Verify (ms) | Notes |',
    '|---|---|---:|---:|---:|---:|---|',
    ...(corpusRows.length
      ? corpusRows.map((row) => `| ${row.label} | ${row.status} | ${row.configured_value} | ${row.query_count || 0} | ${row.total_stats ? formatNumber(row.total_stats.mean) : 'n/a'} | ${row.verify_stats ? formatNumber(row.verify_stats.mean) : 'n/a'} | ${row.notes || ''} |`)
      : ['| pending | pending | 0 | 0 | n/a | n/a | Add enabled corpus_size_points in the manifest. |']),
    '',
    '## Vocabulary Size',
    '',
    '| Label | Status | Configured Value | Query Count | Mean Total (ms) | Mean Verify (ms) | Notes |',
    '|---|---|---:|---:|---:|---:|---|',
    ...(vocabularyRows.length
      ? vocabularyRows.map((row) => `| ${row.label} | ${row.status} | ${row.configured_value} | ${row.query_count || 0} | ${row.total_stats ? formatNumber(row.total_stats.mean) : 'n/a'} | ${row.verify_stats ? formatNumber(row.verify_stats.mean) : 'n/a'} | ${row.notes || ''} |`)
      : ['| pending | pending | 0 | 0 | n/a | n/a | Add enabled vocabulary_size_points in the manifest. |']),
    '',
    '## Notes',
    '',
    ...summary.notes.map((note) => `- ${note}`),
    '',
    'Generated files:',
    `- \`${path.relative(ROOT, summaryJson).replace(/\\/g, '/') }\``,
    `- \`${path.relative(ROOT, postingCsv).replace(/\\/g, '/') }\``,
    `- \`${path.relative(ROOT, clauseCsv).replace(/\\/g, '/') }\``,
    `- \`${path.relative(ROOT, concurrencyCsv).replace(/\\/g, '/') }\``,
    `- \`${path.relative(ROOT, corpusCsv).replace(/\\/g, '/') }\``,
    `- \`${path.relative(ROOT, vocabularyCsv).replace(/\\/g, '/') }\``,
    `- Manifest: \`${path.relative(ROOT, MANIFEST_PATH).replace(/\\/g, '/') }\``,
  ];

  const summaryMd = path.join(RESULTS_ROOT, `${OUTPUT_STEM}_summary.md`);
  fs.writeFileSync(summaryMd, `${mdLines.join('\n')}\n`, 'utf8');

  console.log(`PrivSearch scalability summary written to ${RESULTS_ROOT}`);
}

main().catch((error) => {
  console.error('PrivSearch scalability benchmark failed:', error);
  process.exitCode = 1;
});
