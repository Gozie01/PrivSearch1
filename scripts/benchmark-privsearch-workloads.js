require('dotenv/config');

// PrivSearch workload benchmark harness.
//
// Current default engine:
//   - postings-baseline
//
// Purpose:
//   - validates the generated Enron workload pack
//   - provides the reporting/output structure for future PrivSearch runs
//   - exposes a clean adapter seam for the real encrypted search engine
//
// Example:
//   $env:PRIVSEARCH_TRIALS='100'
//   $env:PRIVSEARCH_ENGINE='postings-baseline'
//   node .\scripts\benchmark-privsearch-workloads.js

const fs = require('fs');
const path = require('path');
const { loadWorkloads, writeCsv } = require('./privsearch/workload-lib');
const { createEngine } = require('./privsearch/engine-registry');

const ROOT = path.resolve(__dirname, '..');
const DATASET = process.env.PRIVSEARCH_DATASET || 'enron';
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
const WORKLOAD_ROOT = process.env.PRIVSEARCH_WORKLOAD_ROOT || datasetDefaults.workloadRoot;
const INDEX_ROOT = process.env.PRIVSEARCH_INDEX_ROOT || datasetDefaults.indexRoot;
const CORPUS_FILE = process.env.PRIVSEARCH_CORPUS_FILE || datasetDefaults.corpusFile;
const PROCESSED_ROOT = process.env.PRIVSEARCH_PROCESSED_ROOT || datasetDefaults.processedRoot;
const OUTPUT_ROOT = process.env.PRIVSEARCH_OUTPUT_ROOT || path.join(ROOT, 'NweDB', 'benchmark_runs');
const ENGINE_NAME = process.env.PRIVSEARCH_ENGINE || 'postings-baseline';
const TRIALS = Number(process.env.PRIVSEARCH_TRIALS || '100');
const WORKLOAD_LIMIT = Number(process.env.PRIVSEARCH_WORKLOAD_LIMIT || '0');
const INCLUDE_RAW_TRIAL_SAMPLES = String(process.env.PRIVSEARCH_INCLUDE_RAW_TRIAL_SAMPLES || 'true').toLowerCase() !== 'false';
const CRYPTO_PHASE_KEYS = [
  'query_normalization_ms',
  'trapdoor_generation_ms',
  'encrypted_postings_retrieval_ms',
  'proof_construction_ms',
  'proof_verification_ms',
  'blockchain_verification_ms',
  'crypto_total_ms',
];

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

async function benchmarkQuery(engine, query, trials) {
  const runs = [];

  for (let i = 0; i < trials; i += 1) {
    const result = await engine.runQuery(query);
    runs.push(result);
  }

  const setupValues = runs.map((run) => run.setup_ms);
  const searchValues = runs.map((run) => run.search_ms);
  const verifyValues = runs.map((run) => run.verify_ms);
  const totalValues = runs.map((run) => run.total_ms);
  const resultCounts = runs.map((run) => run.result_count);
  const proofSizeValues = runs.map((run) => run.resource_hints?.proof_size_bytes || 0);
  const verificationFailures = runs.filter((run) => !run.verified).length;
  const hasCryptoBreakdown = runs.some((run) => run.crypto_breakdown);
  const cryptoBreakdownStats = {};
  const rawCryptoBreakdown = {};
  if (hasCryptoBreakdown) {
    for (const phaseKey of CRYPTO_PHASE_KEYS) {
      const phaseValues = runs.map((run) => Number(run.crypto_breakdown?.[phaseKey] || 0));
      cryptoBreakdownStats[phaseKey] = computeStats(phaseValues);
      if (INCLUDE_RAW_TRIAL_SAMPLES) {
        rawCryptoBreakdown[phaseKey] = phaseValues;
      }
    }
  }

  return {
    query_id: query.query_id,
    query_type: query.query_type,
    bucket_profile: query.bucket_profile,
    expected_result_count: query.expected_result_count,
    observed_result_count: resultCounts[0] || 0,
    trials,
    verification_failures: verificationFailures,
    setup_stats: computeStats(setupValues),
    search_stats: computeStats(searchValues),
    verify_stats: computeStats(verifyValues),
    total_stats: computeStats(totalValues),
    proof_size_bytes_mean: proofSizeValues.reduce((s, v) => s + v, 0) / proofSizeValues.length,
    crypto_breakdown_stats: hasCryptoBreakdown ? cryptoBreakdownStats : undefined,
    crypto_breakdown_mode: runs[0]?.crypto_breakdown_mode || 'not-instrumented',
    phase_hints: runs[0]?.phase_hints || {},
    verification_mode: runs[0]?.verification_mode || 'unknown',
    raw_trial_samples: INCLUDE_RAW_TRIAL_SAMPLES ? {
      setup_ms: setupValues,
      search_ms: searchValues,
      verify_ms: verifyValues,
      total_ms: totalValues,
      result_count: resultCounts,
      verified: runs.map((run) => Boolean(run.verified)),
      crypto_breakdown: hasCryptoBreakdown ? rawCryptoBreakdown : undefined,
    } : undefined,
  };
}

function summarizeByQueryType(results) {
  const grouped = new Map();

  for (const result of results) {
    const key = result.query_type;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(result);
  }

  const summary = [];
  for (const [queryType, rows] of grouped.entries()) {
    const cryptoBreakdownSummary = {};
    const hasCryptoBreakdown = rows.some((row) => row.crypto_breakdown_stats);
    if (hasCryptoBreakdown) {
      for (const phaseKey of CRYPTO_PHASE_KEYS) {
        cryptoBreakdownSummary[`mean_${phaseKey}`] = rows.reduce(
          (sum, row) => sum + Number(row.crypto_breakdown_stats?.[phaseKey]?.mean || 0),
          0,
        ) / rows.length;
      }
    }

    summary.push({
      query_type: queryType,
      query_count: rows.length,
      mean_setup_ms: rows.reduce((sum, row) => sum + row.setup_stats.mean, 0) / rows.length,
      mean_total_ms: rows.reduce((sum, row) => sum + row.total_stats.mean, 0) / rows.length,
      mean_search_ms: rows.reduce((sum, row) => sum + row.search_stats.mean, 0) / rows.length,
      mean_verify_ms: rows.reduce((sum, row) => sum + row.verify_stats.mean, 0) / rows.length,
      mean_proof_size_bytes: rows.reduce((sum, row) => sum + (row.proof_size_bytes_mean || 0), 0) / rows.length,
      total_verification_failures: rows.reduce((sum, row) => sum + row.verification_failures, 0),
      crypto_breakdown_mode: hasCryptoBreakdown ? rows[0].crypto_breakdown_mode : 'not-instrumented',
      ...cryptoBreakdownSummary,
    });
  }

  return summary.sort((a, b) => a.query_type.localeCompare(b.query_type));
}

function buildEngineNotes(engineName) {
  if (engineName === 'privsearch-prototype') {
    return [
      'The privsearch-prototype engine measures a runnable encrypted-search prototype using HMAC trapdoors, AES-encrypted postings, and Merkle-style integrity verification.',
      'The prototype now exposes fine-grained crypto timers for query normalization, trapdoor generation, encrypted-postings retrieval, proof construction, and proof verification.',
      'Blockchain verification is still treated as an external reference phase from the dedicated distributed-validation benchmark rather than inline per-query timing.',
      `Raw per-trial latency arrays are ${INCLUDE_RAW_TRIAL_SAMPLES ? 'persisted' : 'not persisted'} in benchmark_results.json for stronger skew-aware post-analysis.`,
      'This prototype is suitable for architecture validation and early benchmark collection, but it is not yet the final paper-grade authenticated cryptographic implementation.',
    ];
  }

  return [
    'The postings-baseline engine is a benchmark harness adapter, not the final PrivSearch cryptographic engine.',
    'Verification in this baseline mode checks expected result counts only and does not measure cryptographic proof generation or verification.',
    `Raw per-trial latency arrays are ${INCLUDE_RAW_TRIAL_SAMPLES ? 'persisted' : 'not persisted'} in benchmark_results.json for stronger skew-aware post-analysis.`,
  ];
}

async function main() {
  ensureDir(OUTPUT_ROOT);

  const workloads = loadWorkloads({
    workloadRoot: WORKLOAD_ROOT,
    workloadLimit: WORKLOAD_LIMIT,
  });
  if (!workloads.length) {
    throw new Error(`No workloads found in ${WORKLOAD_ROOT}`);
  }

  const engine = createEngine(ENGINE_NAME, {
    indexRoot: INDEX_ROOT,
    workloadRoot: WORKLOAD_ROOT,
    corpusFile: CORPUS_FILE || undefined,
    processedRoot: PROCESSED_ROOT || undefined,
  });
  console.log(`Preparing engine "${engine.name}" for ${workloads.length} workloads...`);
  await engine.prepare(workloads);

  const results = [];
  for (const query of workloads) {
    console.log(`Benchmarking ${query.query_id} (${query.query_type}) with ${TRIALS} trials...`);
    const result = await benchmarkQuery(engine, query, TRIALS);
    results.push(result);
  }

  const generatedAt = new Date().toISOString();
  const runId = `${DATASET}_${ENGINE_NAME}_${formatTimestamp(new Date())}`;
  const runDir = path.join(OUTPUT_ROOT, runId);
  ensureDir(runDir);

  const summaryByType = summarizeByQueryType(results);
  const engineNotes = buildEngineNotes(engine.name);
  const output = {
    generated_at: generatedAt,
    run_id: runId,
    dataset: DATASET,
    engine: engine.name,
    trials_per_query: TRIALS,
    workload_count: workloads.length,
    workload_root: path.relative(ROOT, WORKLOAD_ROOT),
    index_root: path.relative(ROOT, INDEX_ROOT),
    corpus_file: CORPUS_FILE ? path.relative(ROOT, CORPUS_FILE) : '',
    processed_root: PROCESSED_ROOT ? path.relative(ROOT, PROCESSED_ROOT) : '',
    summary_by_query_type: summaryByType,
    query_results: results,
    notes: engineNotes,
  };

  fs.writeFileSync(path.join(runDir, 'benchmark_results.json'), JSON.stringify(output, null, 2), 'utf8');

  writeCsv(path.join(runDir, 'benchmark_summary.csv'), [
    [
      'query_type',
      'query_count',
      'mean_setup_ms',
      'mean_total_ms',
      'mean_search_ms',
      'mean_verify_ms',
      'mean_proof_size_bytes',
      'mean_query_normalization_ms',
      'mean_trapdoor_generation_ms',
      'mean_encrypted_postings_retrieval_ms',
      'mean_proof_construction_ms',
      'mean_proof_verification_ms',
      'mean_blockchain_verification_ms',
      'mean_crypto_total_ms',
      'total_verification_failures',
    ],
    ...summaryByType.map((row) => [
      row.query_type,
      row.query_count,
      row.mean_setup_ms,
      row.mean_total_ms,
      row.mean_search_ms,
      row.mean_verify_ms,
      row.mean_proof_size_bytes ?? 0,
      row.mean_query_normalization_ms ?? 0,
      row.mean_trapdoor_generation_ms ?? 0,
      row.mean_encrypted_postings_retrieval_ms ?? 0,
      row.mean_proof_construction_ms ?? 0,
      row.mean_proof_verification_ms ?? 0,
      row.mean_blockchain_verification_ms ?? 0,
      row.mean_crypto_total_ms ?? 0,
      row.total_verification_failures,
    ]),
  ]);

  writeCsv(path.join(runDir, 'benchmark_query_results.csv'), [
    [
      'query_id',
      'query_type',
      'bucket_profile',
      'expected_result_count',
      'observed_result_count',
      'trials',
      'verification_failures',
      'setup_mean_ms',
      'search_mean_ms',
      'verify_mean_ms',
      'total_mean_ms',
      'total_p95_ms',
      'total_p99_ms',
      'proof_size_bytes_mean',
      'trapdoor_generation_mean_ms',
      'encrypted_postings_retrieval_mean_ms',
      'proof_construction_mean_ms',
      'proof_verification_mean_ms',
      'blockchain_verification_mean_ms',
      'crypto_total_mean_ms',
    ],
    ...results.map((row) => [
      row.query_id,
      row.query_type,
      row.bucket_profile,
      row.expected_result_count,
      row.observed_result_count,
      row.trials,
      row.verification_failures,
      row.setup_stats.mean,
      row.search_stats.mean,
      row.verify_stats.mean,
      row.total_stats.mean,
      row.total_stats.p95,
      row.total_stats.p99,
      row.proof_size_bytes_mean ?? 0,
      row.crypto_breakdown_stats?.trapdoor_generation_ms?.mean ?? 0,
      row.crypto_breakdown_stats?.encrypted_postings_retrieval_ms?.mean ?? 0,
      row.crypto_breakdown_stats?.proof_construction_ms?.mean ?? 0,
      row.crypto_breakdown_stats?.proof_verification_ms?.mean ?? 0,
      row.crypto_breakdown_stats?.blockchain_verification_ms?.mean ?? 0,
      row.crypto_breakdown_stats?.crypto_total_ms?.mean ?? 0,
    ]),
  ]);

  writeCsv(path.join(runDir, 'benchmark_crypto_breakdown.csv'), [
    [
      'query_type',
      'query_count',
      'crypto_breakdown_mode',
      'mean_query_normalization_ms',
      'mean_trapdoor_generation_ms',
      'mean_encrypted_postings_retrieval_ms',
      'mean_proof_construction_ms',
      'mean_proof_verification_ms',
      'mean_blockchain_verification_ms',
      'mean_crypto_total_ms',
    ],
    ...summaryByType.map((row) => [
      row.query_type,
      row.query_count,
      row.crypto_breakdown_mode || 'not-instrumented',
      row.mean_query_normalization_ms ?? 0,
      row.mean_trapdoor_generation_ms ?? 0,
      row.mean_encrypted_postings_retrieval_ms ?? 0,
      row.mean_proof_construction_ms ?? 0,
      row.mean_proof_verification_ms ?? 0,
      row.mean_blockchain_verification_ms ?? 0,
      row.mean_crypto_total_ms ?? 0,
    ]),
  ]);

  const md = [
    '# PrivSearch Workload Benchmark',
    '',
    `Generated: ${generatedAt}`,
    '',
    `Run ID: ${runId}`,
    '',
    `Dataset: ${DATASET}`,
    '',
    `Engine: ${engine.name}`,
    '',
    `Trials per query: ${TRIALS}`,
    '',
    `Workloads benchmarked: ${workloads.length}`,
    '',
    '| Query type | Query count | Mean setup ms | Mean total ms | Mean search ms | Mean verify ms | Verification failures |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...summaryByType.map((row) => `| ${row.query_type} | ${row.query_count} | ${row.mean_setup_ms.toFixed(4)} | ${row.mean_total_ms.toFixed(4)} | ${row.mean_search_ms.toFixed(4)} | ${row.mean_verify_ms.toFixed(4)} | ${row.total_verification_failures} |`),
    '',
    '## Cryptographic Overhead',
    '',
    '| Query type | Trapdoor gen ms | Encrypted postings retrieval ms | Proof construction ms | Proof verification ms | Blockchain verification ms | Crypto total ms |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...summaryByType.map((row) => `| ${row.query_type} | ${(row.mean_trapdoor_generation_ms ?? 0).toFixed(4)} | ${(row.mean_encrypted_postings_retrieval_ms ?? 0).toFixed(4)} | ${(row.mean_proof_construction_ms ?? 0).toFixed(4)} | ${(row.mean_proof_verification_ms ?? 0).toFixed(4)} | ${(row.mean_blockchain_verification_ms ?? 0).toFixed(4)} | ${(row.mean_crypto_total_ms ?? 0).toFixed(4)} |`),
    '',
    'Notes:',
    ...engineNotes.map((note) => `- ${note}`),
  ].join('\n');
  fs.writeFileSync(path.join(runDir, 'benchmark_report.md'), md, 'utf8');

  console.log(`PrivSearch workload benchmark written to ${runDir}`);
}

main().catch((error) => {
  console.error('PrivSearch workload benchmark failed:', error);
  process.exitCode = 1;
});
