require('dotenv/config');

const fs = require('fs');
const path = require('path');
const { loadWorkloads, writeCsv } = require('./privsearch/workload-lib');
const { createEngine } = require('./privsearch/engine-registry');

const ROOT = path.resolve(__dirname, '..');
const DATASET = process.env.PRIVSEARCH_RESOURCE_DATASET || process.env.PRIVSEARCH_DATASET || 'enron';
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
const WORKLOAD_ROOT = process.env.PRIVSEARCH_RESOURCE_WORKLOAD_ROOT || datasetDefaults.workloadRoot;
const INDEX_ROOT = process.env.PRIVSEARCH_RESOURCE_INDEX_ROOT || datasetDefaults.indexRoot;
const CORPUS_FILE = process.env.PRIVSEARCH_RESOURCE_CORPUS_FILE || datasetDefaults.corpusFile;
const PROCESSED_ROOT = process.env.PRIVSEARCH_RESOURCE_PROCESSED_ROOT || datasetDefaults.processedRoot;
const ENGINE_NAME = process.env.PRIVSEARCH_RESOURCE_ENGINE || process.env.PRIVSEARCH_ENGINE || 'privsearch-prototype';
const TRIALS = Number(process.env.PRIVSEARCH_RESOURCE_TRIALS || '1');
const WORKLOAD_LIMIT = Number(process.env.PRIVSEARCH_RESOURCE_WORKLOAD_LIMIT || '0');
const PER_TYPE_LIMIT = Number(process.env.PRIVSEARCH_RESOURCE_PER_TYPE_LIMIT || '0');
const QUERY_TYPES_FILTER = (process.env.PRIVSEARCH_RESOURCE_QUERY_TYPES || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const OUTPUT_ROOT = path.join(ROOT, 'Results', 'paper_assets');
const OUTPUT_STEM = 'privsearch_resource_overhead_results';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
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
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const pick = (q) => sorted[Math.min(Math.floor((n - 1) * q), n - 1)];
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const variance = n > 1
    ? sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)
    : 0;

  return {
    n,
    mean,
    median: pick(0.5),
    p95: pick(0.95),
    p99: pick(0.99),
    min: sorted[0],
    max: sorted[n - 1],
    stddev: Math.sqrt(variance),
  };
}

function formatTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function fmt(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

async function benchmarkResourceQuery(engine, query, trials) {
  const runs = [];
  for (let i = 0; i < trials; i += 1) {
    runs.push(await engine.runQuery(query));
  }

  const metric = (key) => computeStats(runs.map((run) => Number(run.resource_hints?.[key] || 0)));

  return {
    query_id: query.query_id,
    query_type: query.query_type,
    bucket_profile: query.bucket_profile,
    expected_result_count: query.expected_result_count,
    observed_result_count: runs[0]?.result_count || 0,
    trials,
    verification_failures: runs.filter((run) => !run.verified).length,
    cpu_ms: metric('cpu_ms'),
    rss_delta_bytes: metric('rss_delta_bytes'),
    heap_delta_bytes: metric('heap_delta_bytes'),
    proof_size_bytes: metric('proof_size_bytes'),
    request_payload_bytes: metric('request_payload_bytes'),
    response_payload_bytes: metric('response_payload_bytes'),
    network_total_bytes: metric('network_total_bytes'),
    blockchain_reference_bytes: metric('blockchain_reference_bytes'),
    resource_overhead_mode: runs[0]?.resource_overhead_mode || 'not-instrumented',
  };
}

function summarizeByQueryType(results) {
  const grouped = new Map();
  for (const result of results) {
    if (!grouped.has(result.query_type)) {
      grouped.set(result.query_type, []);
    }
    grouped.get(result.query_type).push(result);
  }

  return [...grouped.entries()]
    .map(([queryType, rows]) => ({
      query_type: queryType,
      query_count: rows.length,
      mean_cpu_ms: rows.reduce((sum, row) => sum + row.cpu_ms.mean, 0) / rows.length,
      mean_rss_delta_bytes: rows.reduce((sum, row) => sum + row.rss_delta_bytes.mean, 0) / rows.length,
      mean_heap_delta_bytes: rows.reduce((sum, row) => sum + row.heap_delta_bytes.mean, 0) / rows.length,
      mean_proof_size_bytes: rows.reduce((sum, row) => sum + row.proof_size_bytes.mean, 0) / rows.length,
      p95_proof_size_bytes: rows.reduce((sum, row) => sum + row.proof_size_bytes.p95, 0) / rows.length,
      mean_request_payload_bytes: rows.reduce((sum, row) => sum + row.request_payload_bytes.mean, 0) / rows.length,
      mean_response_payload_bytes: rows.reduce((sum, row) => sum + row.response_payload_bytes.mean, 0) / rows.length,
      mean_network_total_bytes: rows.reduce((sum, row) => sum + row.network_total_bytes.mean, 0) / rows.length,
      mean_blockchain_reference_bytes: rows.reduce((sum, row) => sum + row.blockchain_reference_bytes.mean, 0) / rows.length,
    }))
    .sort((a, b) => a.query_type.localeCompare(b.query_type));
}

function applyPerTypeLimit(workloads, limit) {
  if (!limit || limit <= 0) {
    return workloads;
  }

  const counts = new Map();
  const selected = [];
  for (const workload of workloads) {
    const count = counts.get(workload.query_type) || 0;
    if (count >= limit) {
      continue;
    }
    selected.push(workload);
    counts.set(workload.query_type, count + 1);
  }
  return selected;
}

async function main() {
  ensureDir(OUTPUT_ROOT);

  let workloads = loadWorkloads({
    workloadRoot: WORKLOAD_ROOT,
    workloadLimit: WORKLOAD_LIMIT,
  });
  if (QUERY_TYPES_FILTER.length) {
    workloads = workloads.filter((workload) => QUERY_TYPES_FILTER.includes(workload.query_type));
  }
  workloads = applyPerTypeLimit(workloads, PER_TYPE_LIMIT);
  if (!workloads.length) {
    throw new Error(`No workloads found for resource benchmark in ${WORKLOAD_ROOT}`);
  }

  const engine = createEngine(ENGINE_NAME, {
    indexRoot: INDEX_ROOT,
    workloadRoot: WORKLOAD_ROOT,
    corpusFile: CORPUS_FILE || undefined,
    processedRoot: PROCESSED_ROOT || undefined,
  });

  console.log(`Preparing ${engine.name} resource benchmark for ${workloads.length} workloads...`);
  await engine.prepare(workloads);
  const preparedResources = typeof engine.getPreparedResourceSummary === 'function'
    ? engine.getPreparedResourceSummary()
    : {};

  const results = [];
  for (const query of workloads) {
    console.log(`Resource benchmarking ${query.query_id} (${query.query_type}) with ${TRIALS} trial(s)...`);
    results.push(await benchmarkResourceQuery(engine, query, TRIALS));
  }

  const summaryByQueryType = summarizeByQueryType(results);
  const output = {
    generated_at: new Date().toISOString(),
    run_id: `${DATASET}_${ENGINE_NAME}_resource_${formatTimestamp(new Date())}`,
    dataset: DATASET,
    engine: engine.name,
    trials_per_query: TRIALS,
    workload_count: workloads.length,
    per_type_limit: PER_TYPE_LIMIT,
    workload_root: path.relative(ROOT, WORKLOAD_ROOT),
    index_root: path.relative(ROOT, INDEX_ROOT),
    prepared_resources: preparedResources,
    summary_by_query_type: summaryByQueryType,
    query_results: results,
    notes: [
      'CPU and memory metrics are process-delta measurements around each prototype query run.',
      'Proof size, blockchain reference size, and network traffic are serialized-payload estimates derived from the runnable prototype proof objects.',
      'Encrypted index size and storage overhead are measured from the prepared PrivSearch prototype encrypted postings held by the benchmark engine.',
    ],
  };

  fs.writeFileSync(
    path.join(OUTPUT_ROOT, `${OUTPUT_STEM}.json`),
    JSON.stringify(output, null, 2),
    'utf8',
  );

  writeCsv(path.join(OUTPUT_ROOT, `${OUTPUT_STEM}.csv`), [
    [
      'query_type',
      'query_count',
      'mean_cpu_ms',
      'mean_rss_delta_bytes',
      'mean_heap_delta_bytes',
      'mean_proof_size_bytes',
      'p95_proof_size_bytes',
      'mean_request_payload_bytes',
      'mean_response_payload_bytes',
      'mean_network_total_bytes',
      'mean_blockchain_reference_bytes',
    ],
    ...summaryByQueryType.map((row) => [
      row.query_type,
      row.query_count,
      row.mean_cpu_ms,
      row.mean_rss_delta_bytes,
      row.mean_heap_delta_bytes,
      row.mean_proof_size_bytes,
      row.p95_proof_size_bytes,
      row.mean_request_payload_bytes,
      row.mean_response_payload_bytes,
      row.mean_network_total_bytes,
      row.mean_blockchain_reference_bytes,
    ]),
  ]);

  const md = [
    '# PrivSearch Resource Overhead Results',
    '',
    `Generated: ${output.generated_at}`,
    '',
    `Run ID: ${output.run_id}`,
    '',
    `Dataset: ${DATASET}`,
    '',
    `Engine: ${engine.name}`,
    '',
    `Workloads benchmarked: ${workloads.length}`,
    '',
    `Trials per query: ${TRIALS}`,
    '',
    '## Global Deployment-Cost Summary',
    '',
    '| Metric | Value |',
    '|---|---:|',
    `| Prepared posting sets | ${preparedResources.posting_count || 0} |`,
    `| Indexed document references | ${preparedResources.posting_doc_total || 0} |`,
    `| Raw postings bytes | ${preparedResources.raw_postings_bytes || 0} |`,
    `| Encrypted payload bytes | ${preparedResources.encrypted_payload_bytes || 0} |`,
    `| Encrypted index size bytes | ${preparedResources.encrypted_index_size_bytes || 0} |`,
    `| Blockchain commitment bytes | ${preparedResources.blockchain_commitment_bytes || 0} |`,
    `| Storage overhead ratio | ${fmt(preparedResources.storage_overhead_ratio || 0, 4)}x |`,
    '',
    '## Query-Family Resource Overhead',
    '',
    '| Query Type | Count | CPU ms | RSS delta bytes | Heap delta bytes | Mean proof bytes | P95 proof bytes | Request bytes | Response bytes | Network bytes | Blockchain ref bytes |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...summaryByQueryType.map((row) => `| ${row.query_type} | ${row.query_count} | ${fmt(row.mean_cpu_ms, 4)} | ${Math.round(row.mean_rss_delta_bytes)} | ${Math.round(row.mean_heap_delta_bytes)} | ${fmt(row.mean_proof_size_bytes, 2)} | ${fmt(row.p95_proof_size_bytes, 2)} | ${fmt(row.mean_request_payload_bytes, 2)} | ${fmt(row.mean_response_payload_bytes, 2)} | ${fmt(row.mean_network_total_bytes, 2)} | ${fmt(row.mean_blockchain_reference_bytes, 2)} |`),
    '',
    '## Notes',
    '',
    ...output.notes.map((note) => `- ${note}`),
  ].join('\n');
  fs.writeFileSync(path.join(OUTPUT_ROOT, `${OUTPUT_STEM}.md`), `${md}\n`, 'utf8');

  console.log(`PrivSearch resource overhead written to ${path.join(OUTPUT_ROOT, `${OUTPUT_STEM}.md`)}`);
}

main().catch((error) => {
  console.error('PrivSearch resource overhead benchmark failed:', error);
  process.exitCode = 1;
});
