require('dotenv/config');

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BENCHMARK_ROOT = path.join(ROOT, 'NweDB', 'benchmark_runs');
const PAPER_ASSETS_ROOT = path.join(ROOT, 'Results', 'paper_assets');
const DATASET = process.env.PRIVSEARCH_CRYPTO_DATASET || 'enron';
const RUN_PREFIX = process.env.PRIVSEARCH_CRYPTO_RUN_PREFIX || `${DATASET}_privsearch-prototype_`;
const OUTPUT_STEM = process.env.PRIVSEARCH_CRYPTO_OUTPUT_STEM || 'privsearch_crypto_overhead_results';
const MIN_WORKLOAD_COUNT = Number(process.env.PRIVSEARCH_CRYPTO_MIN_WORKLOAD_COUNT || '1');
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

function fmt(value, digits = 4) {
  return Number(value || 0).toFixed(digits);
}

function writeCsv(filePath, rows) {
  const output = rows
    .map((row) => row.map((value) => {
      const text = String(value ?? '');
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(','))
    .join('\n');
  fs.writeFileSync(filePath, `${output}\n`, 'utf8');
}

function selectLatestRun(prefix) {
  const candidates = fs.readdirSync(BENCHMARK_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => {
      const fullPath = path.join(BENCHMARK_ROOT, entry.name);
      let workloadCount = 0;
      try {
        const benchmark = JSON.parse(fs.readFileSync(path.join(fullPath, 'benchmark_results.json'), 'utf8'));
        workloadCount = Number(benchmark.workload_count || 0);
      } catch {
        workloadCount = 0;
      }
      return {
        name: entry.name,
        fullPath,
        mtimeMs: fs.statSync(fullPath).mtimeMs,
        workloadCount,
      };
    });

  const eligible = candidates.filter((candidate) => candidate.workloadCount >= MIN_WORKLOAD_COUNT);
  const pool = eligible.length ? eligible : candidates;
  pool.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!pool.length) {
    throw new Error(`No benchmark runs found for prefix ${prefix}`);
  }
  return pool[0];
}

function buildRows(queryResults) {
  const grouped = new Map();
  for (const row of queryResults) {
    if (!grouped.has(row.query_type)) {
      grouped.set(row.query_type, []);
    }
    grouped.get(row.query_type).push(row);
  }

  return [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([queryType, rows]) => {
    const queryCount = rows.length;
    const phaseMeans = {};
    for (const key of CRYPTO_PHASE_KEYS) {
      phaseMeans[key] = rows.reduce(
        (sum, row) => sum + Number(row.crypto_breakdown_stats?.[key]?.mean || 0),
        0,
      ) / queryCount;
    }

    const meanTotalMs = rows.reduce((sum, row) => sum + Number(row.total_stats?.mean || 0), 0) / queryCount;
    const cryptoSharePct = meanTotalMs > 0 ? (phaseMeans.crypto_total_ms / meanTotalMs) * 100 : 0;

    return {
      query_type: queryType,
      query_count: queryCount,
      mean_total_ms: meanTotalMs,
      mean_query_normalization_ms: phaseMeans.query_normalization_ms,
      mean_trapdoor_generation_ms: phaseMeans.trapdoor_generation_ms,
      mean_encrypted_postings_retrieval_ms: phaseMeans.encrypted_postings_retrieval_ms,
      mean_proof_construction_ms: phaseMeans.proof_construction_ms,
      mean_proof_verification_ms: phaseMeans.proof_verification_ms,
      mean_blockchain_verification_ms: phaseMeans.blockchain_verification_ms,
      mean_crypto_total_ms: phaseMeans.crypto_total_ms,
      crypto_share_pct: cryptoSharePct,
      crypto_breakdown_mode: rows[0]?.crypto_breakdown_mode || 'not-instrumented',
    };
  });
}

function buildGlobalSummary(rows) {
  const totalQueries = rows.reduce((sum, row) => sum + row.query_count, 0);
  const weighted = (field) => {
    if (!totalQueries) {
      return 0;
    }
    return rows.reduce((sum, row) => sum + (row[field] * row.query_count), 0) / totalQueries;
  };

  return {
    total_query_families: rows.length,
    total_queries: totalQueries,
    weighted_mean_total_ms: weighted('mean_total_ms'),
    weighted_mean_query_normalization_ms: weighted('mean_query_normalization_ms'),
    weighted_mean_trapdoor_generation_ms: weighted('mean_trapdoor_generation_ms'),
    weighted_mean_encrypted_postings_retrieval_ms: weighted('mean_encrypted_postings_retrieval_ms'),
    weighted_mean_proof_construction_ms: weighted('mean_proof_construction_ms'),
    weighted_mean_proof_verification_ms: weighted('mean_proof_verification_ms'),
    weighted_mean_blockchain_verification_ms: weighted('mean_blockchain_verification_ms'),
    weighted_mean_crypto_total_ms: weighted('mean_crypto_total_ms'),
    weighted_crypto_share_pct: weighted('crypto_share_pct'),
  };
}

function main() {
  ensureDir(PAPER_ASSETS_ROOT);

  const run = selectLatestRun(RUN_PREFIX);
  const benchmark = JSON.parse(fs.readFileSync(path.join(run.fullPath, 'benchmark_results.json'), 'utf8'));
  const rows = buildRows((benchmark.query_results || []).filter((row) => row.crypto_breakdown_stats));
  const globalSummary = buildGlobalSummary(rows);

  const outputJson = {
    generated_at: new Date().toISOString(),
    dataset: benchmark.dataset || DATASET,
    run_id: benchmark.run_id,
    workload_count: benchmark.workload_count,
    trials_per_query: benchmark.trials_per_query,
    global_summary: globalSummary,
    crypto_overhead_breakdown: rows,
    notes: [
      'Blockchain verification remains zero in inline query results because it is still measured in the separate distributed-validation benchmark.',
      'Use Results/paper_assets/distributed_validation_wan.csv as the current external reference for validator-side verification cost.',
    ],
  };

  fs.writeFileSync(
    path.join(PAPER_ASSETS_ROOT, `${OUTPUT_STEM}.json`),
    JSON.stringify(outputJson, null, 2),
    'utf8',
  );

  writeCsv(path.join(PAPER_ASSETS_ROOT, `${OUTPUT_STEM}.csv`), [
    [
      'query_type',
      'query_count',
      'mean_total_ms',
      'mean_query_normalization_ms',
      'mean_trapdoor_generation_ms',
      'mean_encrypted_postings_retrieval_ms',
      'mean_proof_construction_ms',
      'mean_proof_verification_ms',
      'mean_blockchain_verification_ms',
      'mean_crypto_total_ms',
      'crypto_share_pct',
      'crypto_breakdown_mode',
    ],
    ...rows.map((row) => [
      row.query_type,
      row.query_count,
      row.mean_total_ms,
      row.mean_query_normalization_ms,
      row.mean_trapdoor_generation_ms,
      row.mean_encrypted_postings_retrieval_ms,
      row.mean_proof_construction_ms,
      row.mean_proof_verification_ms,
      row.mean_blockchain_verification_ms,
      row.mean_crypto_total_ms,
      row.crypto_share_pct,
      row.crypto_breakdown_mode,
    ]),
  ]);

  const md = [
    '# PrivSearch Cryptographic Overhead Results',
    '',
    `Generated: ${outputJson.generated_at}`,
    '',
    `Run ID: ${benchmark.run_id}`,
    '',
    `Dataset: ${benchmark.dataset || DATASET}`,
    '',
    `Workloads benchmarked: ${benchmark.workload_count}`,
    '',
    `Trials per workload: ${benchmark.trials_per_query}`,
    '',
    '## Global Summary',
    '',
    '| Metric | Value |',
    '|---|---:|',
    `| Weighted mean total ms | ${fmt(globalSummary.weighted_mean_total_ms)} |`,
    `| Weighted mean query normalization ms | ${fmt(globalSummary.weighted_mean_query_normalization_ms)} |`,
    `| Weighted mean trapdoor generation ms | ${fmt(globalSummary.weighted_mean_trapdoor_generation_ms)} |`,
    `| Weighted mean encrypted postings retrieval ms | ${fmt(globalSummary.weighted_mean_encrypted_postings_retrieval_ms)} |`,
    `| Weighted mean proof construction ms | ${fmt(globalSummary.weighted_mean_proof_construction_ms)} |`,
    `| Weighted mean proof verification ms | ${fmt(globalSummary.weighted_mean_proof_verification_ms)} |`,
    `| Weighted mean blockchain verification ms | ${fmt(globalSummary.weighted_mean_blockchain_verification_ms)} |`,
    `| Weighted mean crypto total ms | ${fmt(globalSummary.weighted_mean_crypto_total_ms)} |`,
    `| Weighted crypto share % | ${fmt(globalSummary.weighted_crypto_share_pct, 2)} |`,
    '',
    '## Query-Family Breakdown',
    '',
    '| Query Type | Count | Total ms | Trapdoor ms | Encrypted retrieval ms | Proof construction ms | Proof verification ms | Blockchain verification ms | Crypto total ms | Crypto share % |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows.map((row) => `| ${row.query_type} | ${row.query_count} | ${fmt(row.mean_total_ms)} | ${fmt(row.mean_trapdoor_generation_ms)} | ${fmt(row.mean_encrypted_postings_retrieval_ms)} | ${fmt(row.mean_proof_construction_ms)} | ${fmt(row.mean_proof_verification_ms)} | ${fmt(row.mean_blockchain_verification_ms)} | ${fmt(row.mean_crypto_total_ms)} | ${fmt(row.crypto_share_pct, 2)} |`),
    '',
    '## Notes',
    '',
    '- Query normalization is reported separately for completeness, but the main cryptographic path is trapdoor generation -> encrypted retrieval -> proof construction -> proof verification -> blockchain verification.',
    '- Inline blockchain verification remains zero in the current prototype because validator-side commitment checking is still benchmarked separately.',
    '- External blockchain verification reference: `Results/paper_assets/distributed_validation_wan.csv`.',
  ].join('\n');

  fs.writeFileSync(path.join(PAPER_ASSETS_ROOT, `${OUTPUT_STEM}.md`), md, 'utf8');

  console.log(`PrivSearch crypto overhead written to ${path.join(PAPER_ASSETS_ROOT, `${OUTPUT_STEM}.md`)}`);
}

main();
