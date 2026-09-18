require('dotenv/config');

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BENCHMARK_ROOT = path.join(ROOT, 'NweDB', 'benchmark_runs');
const PAPER_ASSETS_ROOT = path.join(ROOT, 'Results', 'paper_assets');
const DATASET = process.env.PRIVSEARCH_DATASET || 'healthcare';
const RUN_PREFIX = process.env.PRIVSEARCH_PHASE_RUN_PREFIX || `${DATASET}_privsearch-prototype_`;
const OUTPUT_STEM = process.env.PRIVSEARCH_PHASE_OUTPUT_STEM || `privsearch_${DATASET}_phase_breakdown`;
const MIN_WORKLOAD_COUNT = Number(process.env.PRIVSEARCH_PHASE_MIN_WORKLOAD_COUNT || '50');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function fmt(value, digits = 4) {
  return Number(value || 0).toFixed(digits);
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

function writeCsv(filePath, rows) {
  const output = rows
    .map((row) => row.map((value) => {
      const text = String(value ?? '');
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join(','))
    .join('\n');
  fs.writeFileSync(filePath, `${output}\n`, 'utf8');
}

function buildPhaseRows(queryResults) {
  const grouped = new Map();

  for (const row of queryResults) {
    const queryType = row.query_type;
    if (!grouped.has(queryType)) {
      grouped.set(queryType, []);
    }
    grouped.get(queryType).push(row);
  }

  return [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([queryType, rows]) => {
    const queryCount = rows.length;
    const meanSetupMs = rows.reduce((sum, row) => sum + Number(row.setup_stats?.mean || 0), 0) / queryCount;
    const meanSearchMs = rows.reduce((sum, row) => sum + Number(row.search_stats?.mean || 0), 0) / queryCount;
    const meanVerifyMs = rows.reduce((sum, row) => sum + Number(row.verify_stats?.mean || 0), 0) / queryCount;
    const meanTotalMs = rows.reduce((sum, row) => sum + Number(row.total_stats?.mean || 0), 0) / queryCount;
    const authOverheadMs = meanSetupMs + meanVerifyMs;
    const searchSharePct = meanTotalMs > 0 ? (meanSearchMs / meanTotalMs) * 100 : 0;
    const verifySharePct = meanTotalMs > 0 ? (meanVerifyMs / meanTotalMs) * 100 : 0;
    const authSharePct = meanTotalMs > 0 ? (authOverheadMs / meanTotalMs) * 100 : 0;

    return {
      query_type: queryType,
      query_count: queryCount,
      mean_setup_ms: meanSetupMs,
      mean_search_ms: meanSearchMs,
      mean_verify_ms: meanVerifyMs,
      mean_total_ms: meanTotalMs,
      auth_overhead_ms: authOverheadMs,
      search_share_pct: searchSharePct,
      verify_share_pct: verifySharePct,
      auth_share_pct: authSharePct,
      total_verification_failures: rows.reduce((sum, row) => sum + Number(row.verification_failures || 0), 0),
    };
  });
}

function buildGlobalSummary(phaseRows) {
  const totalQueries = phaseRows.reduce((sum, row) => sum + row.query_count, 0);
  const weighted = (field) => {
    if (!totalQueries) {
      return 0;
    }
    return phaseRows.reduce((sum, row) => sum + (row[field] * row.query_count), 0) / totalQueries;
  };

  return {
    total_query_families: phaseRows.length,
    total_queries: totalQueries,
    weighted_mean_setup_ms: weighted('mean_setup_ms'),
    weighted_mean_search_ms: weighted('mean_search_ms'),
    weighted_mean_verify_ms: weighted('mean_verify_ms'),
    weighted_mean_total_ms: weighted('mean_total_ms'),
    weighted_mean_auth_overhead_ms: weighted('auth_overhead_ms'),
    weighted_search_share_pct: weighted('search_share_pct'),
    weighted_verify_share_pct: weighted('verify_share_pct'),
    weighted_auth_share_pct: weighted('auth_share_pct'),
    total_verification_failures: phaseRows.reduce((sum, row) => sum + row.total_verification_failures, 0),
  };
}

function main() {
  ensureDir(PAPER_ASSETS_ROOT);

  const run = selectLatestRun(RUN_PREFIX);
  const benchmark = JSON.parse(fs.readFileSync(path.join(run.fullPath, 'benchmark_results.json'), 'utf8'));
  const phaseRows = buildPhaseRows(benchmark.query_results || []);
  const globalSummary = buildGlobalSummary(phaseRows);

  const outputJson = {
    generated_at: new Date().toISOString(),
    dataset: benchmark.dataset || DATASET,
    run_id: benchmark.run_id,
    workload_count: benchmark.workload_count,
    trials_per_query: benchmark.trials_per_query,
    global_summary: globalSummary,
    phase_breakdown: phaseRows,
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
      'mean_setup_ms',
      'mean_search_ms',
      'mean_verify_ms',
      'mean_total_ms',
      'auth_overhead_ms',
      'search_share_pct',
      'verify_share_pct',
      'auth_share_pct',
      'total_verification_failures',
    ],
    ...phaseRows.map((row) => [
      row.query_type,
      row.query_count,
      row.mean_setup_ms,
      row.mean_search_ms,
      row.mean_verify_ms,
      row.mean_total_ms,
      row.auth_overhead_ms,
      row.search_share_pct,
      row.verify_share_pct,
      row.auth_share_pct,
      row.total_verification_failures,
    ]),
  ]);

  const authDominant = phaseRows
    .filter((row) => row.auth_share_pct >= 50)
    .sort((a, b) => b.auth_share_pct - a.auth_share_pct)
    .map((row) => `${row.query_type} (${fmt(row.auth_share_pct, 2)}%)`);

  const md = [
    `# PrivSearch ${benchmark.dataset || DATASET} Phase Breakdown`,
    '',
    `Generated: ${outputJson.generated_at}`,
    '',
    `Run ID: ${benchmark.run_id}`,
    '',
    `Workloads benchmarked: ${benchmark.workload_count}`,
    '',
    `Trials per workload: ${benchmark.trials_per_query}`,
    '',
    '## Global Summary',
    '',
    '| Metric | Value |',
    '|---|---:|',
    `| Weighted mean setup ms | ${fmt(globalSummary.weighted_mean_setup_ms)} |`,
    `| Weighted mean search ms | ${fmt(globalSummary.weighted_mean_search_ms)} |`,
    `| Weighted mean verify ms | ${fmt(globalSummary.weighted_mean_verify_ms)} |`,
    `| Weighted mean total ms | ${fmt(globalSummary.weighted_mean_total_ms)} |`,
    `| Weighted auth-overhead ms | ${fmt(globalSummary.weighted_mean_auth_overhead_ms)} |`,
    `| Weighted search share % | ${fmt(globalSummary.weighted_search_share_pct, 2)} |`,
    `| Weighted verify share % | ${fmt(globalSummary.weighted_verify_share_pct, 2)} |`,
    `| Weighted auth share % | ${fmt(globalSummary.weighted_auth_share_pct, 2)} |`,
    `| Total verification failures | ${globalSummary.total_verification_failures} |`,
    '',
    '## Query-Family Breakdown',
    '',
    '| Query Type | Count | Setup ms | Search ms | Verify ms | Total ms | Auth Overhead ms | Search Share % | Verify Share % | Auth Share % | Failures |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...phaseRows.map((row) => `| ${row.query_type} | ${row.query_count} | ${fmt(row.mean_setup_ms)} | ${fmt(row.mean_search_ms)} | ${fmt(row.mean_verify_ms)} | ${fmt(row.mean_total_ms)} | ${fmt(row.auth_overhead_ms)} | ${fmt(row.search_share_pct, 2)} | ${fmt(row.verify_share_pct, 2)} | ${fmt(row.auth_share_pct, 2)} | ${row.total_verification_failures} |`),
    '',
    '## Notes',
    '',
    `- Authentication overhead is defined here as setup plus verification: trapdoor derivation / encrypted-postings preparation plus proof checking.`,
    `- Auth-dominant families in this run: ${authDominant.length ? authDominant.join(', ') : 'none'}.`,
    '- This artifact is intended to support encrypted latency-separation and authentication-overhead discussion directly from the executable benchmark outputs.',
  ].join('\n');

  fs.writeFileSync(path.join(PAPER_ASSETS_ROOT, `${OUTPUT_STEM}.md`), md, 'utf8');

  console.log(`PrivSearch phase breakdown written to ${path.join(PAPER_ASSETS_ROOT, `${OUTPUT_STEM}.md`)}`);
}

main();
