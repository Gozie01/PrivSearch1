require('dotenv/config');

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BENCHMARK_ROOT = path.join(ROOT, 'NweDB', 'benchmark_runs');
const PAPER_ASSETS_ROOT = path.join(ROOT, 'Results', 'paper_assets');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function selectRunDir(prefix, options = {}) {
  const preferLargestWorkloadCount = Boolean(options.preferLargestWorkloadCount);
  const requiredQueryType = options.requiredQueryType || null;
  const candidates = fs.readdirSync(BENCHMARK_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => {
      const fullPath = path.join(BENCHMARK_ROOT, entry.name);
      let benchmarkResults = null;
      try {
        benchmarkResults = loadJson(path.join(fullPath, 'benchmark_results.json'));
      } catch {
        benchmarkResults = null;
      }
      return {
        name: entry.name,
        fullPath,
        mtimeMs: fs.statSync(fullPath).mtimeMs,
        workloadCount: Number(benchmarkResults?.workload_count || 0),
        queryTypes: new Set((benchmarkResults?.summary_by_query_type || []).map((row) => row.query_type)),
      };
    })
    .filter((candidate) => !requiredQueryType || candidate.queryTypes.has(requiredQueryType))
    .sort((a, b) => {
      if (preferLargestWorkloadCount && b.workloadCount !== a.workloadCount) {
        return b.workloadCount - a.workloadCount;
      }
      return b.mtimeMs - a.mtimeMs;
    });

  if (!candidates.length) {
    throw new Error(`No run directories found for prefix ${prefix}`);
  }

  return candidates[0];
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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

function fmt(value, digits = 4) {
  return Number(value).toFixed(digits);
}

function queryTypeMap(summaryRows) {
  return new Map(summaryRows.map((row) => [row.query_type, row]));
}

function main() {
  ensureDir(PAPER_ASSETS_ROOT);

  const privsearchRun = selectRunDir('enron_privsearch-prototype_', { preferLargestWorkloadCount: true });
  const semanticRun = selectRunDir('enron_privsearch-prototype_', { requiredQueryType: 'semantic_v1' });
  const seacqRun = selectRunDir('seacq_comparison_privsearch-prototype_');

  const privsearch = loadJson(path.join(privsearchRun.fullPath, 'benchmark_results.json'));
  const semantic = loadJson(path.join(semanticRun.fullPath, 'benchmark_results.json'));
  const replay = loadJson(path.join(PAPER_ASSETS_ROOT, 'privsearch_replay_protection.json'));
  const distributedWan = fs.existsSync(path.join(PAPER_ASSETS_ROOT, 'distributed_validation_wan.json'))
    ? loadJson(path.join(PAPER_ASSETS_ROOT, 'distributed_validation_wan.json'))
    : null;
  const seacqRows = fs.readFileSync(path.join(seacqRun.fullPath, 'seacq_comparison_table.csv'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(1)
    .map((line) => {
      const values = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i += 1;
          } else {
            inQuotes = !inQuotes;
          }
          continue;
        }
        if (char === ',' && !inQuotes) {
          values.push(current);
          current = '';
          continue;
        }
        current += char;
      }
      values.push(current);
      return {
        query_type: values[0],
        privsearch_mean_search_ms: Number(values[3]),
        privsearch_mean_verify_ms: Number(values[4]),
        privsearch_mean_total_ms: Number(values[5]),
        seacq_published_search_ms: Number(values[9]),
        seacq_published_verify_ms: Number(values[10]),
        seacq_published_total_ms: Number(values[11]),
      };
    });

  const privMap = queryTypeMap(privsearch.summary_by_query_type);
  const semanticMap = queryTypeMap(semantic.summary_by_query_type);
  if (!privMap.has('semantic_v1') && semanticMap.has('semantic_v1')) {
    privMap.set('semantic_v1', semanticMap.get('semantic_v1'));
  }
  const families = [
    'single_keyword',
    'and_2',
    'and_4',
    'and_6',
    'and_8',
    'and_10',
    'or_2',
    'or_3',
    'or_of_and',
    'fuzzy_1',
    'semantic_v1',
    'range_month_1',
    'range_month_3',
    'range_month_6',
    'range_year_2',
    'range_year_3',
    'range_year_5',
  ].filter((queryType) => privMap.has(queryType));

  const outputJson = {
    generatedAt: new Date().toISOString(),
    privsearch_run_id: privsearch.run_id,
    seacq_run_id: seacqRun.name,
    workload_count: privsearch.workload_count,
    trials_per_query: privsearch.trials_per_query,
    summary_by_query_type: families.map((queryType) => privMap.get(queryType)),
    replay_protection: replay.results,
    seacq_comparison: seacqRows,
    semantic_run_id: semantic.run_id,
    distributed_validation_wan: distributedWan?.results || [],
  };

  fs.writeFileSync(
    path.join(PAPER_ASSETS_ROOT, 'privsearch_extension_summary.json'),
    JSON.stringify(outputJson, null, 2),
    'utf8',
  );

  writeCsv(path.join(PAPER_ASSETS_ROOT, 'privsearch_extension_summary.csv'), [
    ['query_type', 'query_count', 'mean_total_ms', 'mean_search_ms', 'mean_verify_ms', 'verification_failures'],
    ...families.map((queryType) => {
      const row = privMap.get(queryType);
      return [
        row.query_type,
        row.query_count,
        row.mean_total_ms,
        row.mean_search_ms,
        row.mean_verify_ms,
        row.total_verification_failures,
      ];
    }),
  ]);

  const md = [
    '# PrivSearch Extension Summary',
    '',
    `Generated: ${outputJson.generatedAt}`,
    '',
    `PrivSearch run: ${privsearch.run_id}`,
    '',
    `Semantic v1 run: ${semantic.run_id}`,
    '',
    `SeaCQ-aligned run: ${seacqRun.name}`,
    '',
    `Workloads benchmarked: ${privsearch.workload_count}`,
    '',
    `Trials per workload: ${privsearch.trials_per_query}`,
    '',
    '## Query-Family Results',
    '',
    '| Query Type | Query Count | Mean Total ms | Mean Search ms | Mean Verify ms | Verification Failures |',
    '|---|---:|---:|---:|---:|---:|',
    ...families.map((queryType) => {
      const row = privMap.get(queryType);
      return `| ${row.query_type} | ${row.query_count} | ${fmt(row.mean_total_ms)} | ${fmt(row.mean_search_ms)} | ${fmt(row.mean_verify_ms)} | ${row.total_verification_failures} |`;
    }),
    '',
    '## Replay Protection',
    '',
    '| Metric | Value |',
    '|---|---:|',
    `| Attempted | ${replay.results.attempted} |`,
    `| Accepted first requests | ${replay.results.accepted} |`,
    `| Replayed requests rejected | ${replay.results.rejected} |`,
    `| Replay rejection rate | ${(replay.results.replayRejectionRate * 100).toFixed(2)}% |`,
    `| Mean replay rejection latency (ms) | ${fmt(replay.results.replayLatencyMs.mean)} |`,
    `| P95 replay rejection latency (ms) | ${fmt(replay.results.replayLatencyMs.p95)} |`,
    '',
    '## SeaCQ Comparison',
    '',
    '| Query Type | PrivSearch Total ms | SeaCQ Total ms | PrivSearch Search ms | SeaCQ Search ms | PrivSearch Verify ms | SeaCQ Verify ms |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...seacqRows.map((row) =>
      `| ${row.query_type} | ${fmt(row.privsearch_mean_total_ms)} | ${fmt(row.seacq_published_total_ms, 1)} | ${fmt(row.privsearch_mean_search_ms)} | ${fmt(row.seacq_published_search_ms, 1)} | ${fmt(row.privsearch_mean_verify_ms)} | ${fmt(row.seacq_published_verify_ms, 1)} |`,
    ),
    '',
    ...(distributedWan ? [
      '## WAN Distributed Validation',
      '',
      '| Profile | Nodes | Success Rate | Threshold Mean ms | Full Mean ms |',
      '|---|---:|---:|---:|---:|',
      ...distributedWan.results.map((row) =>
        `| ${row.profileLabel} | ${row.nodeCount} | ${(row.successRate * 100).toFixed(2)}% | ${fmt(row.endToEndThresholdMs.mean)} | ${fmt(row.endToEndFullMs.mean)} |`,
      ),
      '',
    ] : []),
    '## Notes',
    '',
    '- Month-level range workloads strengthen the temporal-range experiment by covering fine-grained windows inside the dense 1999-2002 interval.',
    '- Year-range workloads remain useful for large-result stress cases.',
    '- Semantic v1 currently uses authenticated concept-expanded retrieval rather than embeddings or neural encoders.',
    '- The consolidated summary uses the largest full PrivSearch workload run plus the latest semantic_v1 run so semantic evidence is not lost when run separately.',
    '- Replay-prevention evidence now reflects live API-layer freshness enforcement rather than paper-only design intent.',
  ].join('\n');

  fs.writeFileSync(path.join(PAPER_ASSETS_ROOT, 'privsearch_extension_summary.md'), md, 'utf8');

  console.log(`PrivSearch extension summary written to ${path.join(PAPER_ASSETS_ROOT, 'privsearch_extension_summary.md')}`);
}

main();
