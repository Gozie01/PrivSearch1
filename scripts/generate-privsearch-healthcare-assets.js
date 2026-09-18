require('dotenv/config');

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BENCHMARK_ROOT = path.join(ROOT, 'NweDB', 'benchmark_runs');
const HEALTHCARE_ROOT = path.join(ROOT, 'NweDB', 'healthcare');
const PAPER_ASSETS_ROOT = path.join(ROOT, 'Results', 'paper_assets');
const FIGURES = path.join(PAPER_ASSETS_ROOT, 'figures');
const RUN_PREFIX = process.env.PRIVSEARCH_HEALTHCARE_RUN_PREFIX || 'healthcare_privsearch-prototype_';
const MIN_WORKLOAD_COUNT = Number(process.env.PRIVSEARCH_HEALTHCARE_MIN_WORKLOAD_COUNT || '200');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeText(filePath, value) {
  fs.writeFileSync(filePath, value, 'utf8');
}

function writeCsv(filePath, rows) {
  const output = rows.map((row) => row.map((value) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',')).join('\n');
  fs.writeFileSync(filePath, `${output}\n`, 'utf8');
}

function fmt(value, digits = 4) {
  return Number(value || 0).toFixed(digits);
}

function wrapSvg(title, width, height, body) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<style>',
    'text { font-family: Arial, sans-serif; fill: #1f2933; }',
    '.title { font-size: 18px; font-weight: 700; }',
    '.label { font-size: 12px; }',
    '.small { font-size: 11px; }',
    '.axisLabel { font-size: 12px; font-weight: 700; }',
    '.axis { stroke: #5b6570; stroke-width: 1; }',
    '</style>',
    `<text x="24" y="28" class="title">${title}</text>`,
    body,
    '</svg>',
  ].join('\n');
}

function barChartSvg(title, categories, series, options = {}) {
  const width = 920;
  const height = 470;
  const chartX = 70;
  const chartY = 70;
  const chartWidth = 800;
  const chartHeight = 250;
  const colors = options.colors || ['#0f766e', '#d97706', '#2563eb', '#dc2626'];
  const maxValue = Math.max(...series.flatMap((item) => item.values), 1);
  const groupWidth = chartWidth / Math.max(categories.length, 1);
  const barWidth = Math.min(36, groupWidth / (series.length + 1));
  const lines = [
    `<line x1="${chartX}" y1="${chartY}" x2="${chartX}" y2="${chartY + chartHeight}" class="axis" />`,
    `<line x1="${chartX}" y1="${chartY + chartHeight}" x2="${chartX + chartWidth}" y2="${chartY + chartHeight}" class="axis" />`,
  ];

  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (maxValue / 4) * tick;
    const y = chartY + chartHeight - (chartHeight * tick) / 4;
    lines.push(`<line x1="${chartX}" y1="${y}" x2="${chartX + chartWidth}" y2="${y}" stroke="#d9e2ec" stroke-width="1" />`);
    lines.push(`<text x="${chartX - 10}" y="${y + 4}" text-anchor="end" class="small">${fmt(value, options.tickDigits ?? 1)}</text>`);
  }

  categories.forEach((category, index) => {
    const baseX = chartX + index * groupWidth + groupWidth / 2;
    lines.push(`<text x="${baseX}" y="${chartY + chartHeight + 24}" text-anchor="middle" class="label">${category}</text>`);
    series.forEach((item, seriesIndex) => {
      const value = item.values[index];
      const barHeight = (value / maxValue) * chartHeight;
      const x = baseX - (series.length * barWidth) / 2 + seriesIndex * barWidth;
      const y = chartY + chartHeight - barHeight;
      lines.push(`<rect x="${x}" y="${y}" width="${barWidth - 4}" height="${barHeight}" fill="${colors[seriesIndex % colors.length]}" rx="3" />`);
    });
  });

  series.forEach((item, index) => {
    const legendX = 80 + index * 180;
    lines.push(`<rect x="${legendX}" y="408" width="14" height="14" fill="${colors[index % colors.length]}" rx="2" />`);
    lines.push(`<text x="${legendX + 22}" y="420" class="label">${item.name}</text>`);
  });

  if (options.xAxisLabel) {
    lines.push(`<text x="${chartX + chartWidth / 2}" y="${chartY + chartHeight + 50}" text-anchor="middle" class="axisLabel">${options.xAxisLabel}</text>`);
  }
  if (options.yAxisLabel) {
    lines.push(`<text x="22" y="${chartY + chartHeight / 2}" text-anchor="middle" transform="rotate(-90 22 ${chartY + chartHeight / 2})" class="axisLabel">${options.yAxisLabel}</text>`);
  }

  return wrapSvg(title, width, height, lines.join('\n'));
}

function selectHealthcareRun() {
  const candidates = fs.readdirSync(BENCHMARK_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(RUN_PREFIX))
    .map((entry) => {
      const fullPath = path.join(BENCHMARK_ROOT, entry.name);
      const benchmark = readJson(path.join(fullPath, 'benchmark_results.json'));
      return {
        name: entry.name,
        fullPath,
        benchmark,
        mtimeMs: fs.statSync(fullPath).mtimeMs,
      };
    });

  const eligible = candidates.filter((candidate) => Number(candidate.benchmark.workload_count || 0) >= MIN_WORKLOAD_COUNT);
  const pool = eligible.length ? eligible : candidates;
  pool.sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (!pool.length) {
    throw new Error(`No healthcare benchmark runs found for prefix ${RUN_PREFIX}`);
  }

  return pool[0];
}

function representativeFamilies(phaseRows) {
  const preferred = [
    'single_keyword',
    'and_2',
    'and_4',
    'or_2',
    'fuzzy_1',
    'semantic_v1',
    'range_month_1',
    'range_year_2',
  ];
  const phaseMap = new Map(phaseRows.map((row) => [row.query_type, row]));
  return preferred.filter((queryType) => phaseMap.has(queryType)).map((queryType) => phaseMap.get(queryType));
}

function familyLabel(queryType) {
  const labels = {
    single_keyword: 'single',
    and_2: 'and_2',
    and_4: 'and_4',
    or_2: 'or_2',
    or_3: 'or_3',
    or_of_and: 'or_of_and',
    fuzzy_1: 'fuzzy',
    semantic_v1: 'semantic',
    range_month_1: 'month_1',
    range_month_3: 'month_3',
    range_year_2: 'year_2',
    range_year_3: 'year_3',
  };
  return labels[queryType] || queryType;
}

function main() {
  ensureDir(PAPER_ASSETS_ROOT);
  ensureDir(FIGURES);

  const selectedRun = selectHealthcareRun();
  const benchmark = selectedRun.benchmark;
  const phaseBreakdown = readJson(path.join(PAPER_ASSETS_ROOT, 'privsearch_healthcare_phase_breakdown.json'));
  const datasetSummary = readJson(path.join(HEALTHCARE_ROOT, 'healthcare_dataset_summary.json'));
  const phaseRows = phaseBreakdown.phase_breakdown || [];
  const global = phaseBreakdown.global_summary || {};
  const reps = representativeFamilies(phaseRows);

  const datasetRows = [
    ['dataset', 'record_count'],
    ['eICU demo', datasetSummary.eicu.corpus_documents],
    ['MedCD', datasetSummary.medcd.notes],
    ['openFDA', datasetSummary.openfda.corpus_documents],
  ];
  writeCsv(path.join(PAPER_ASSETS_ROOT, 'table_privsearch_healthcare_dataset_scope.csv'), datasetRows);

  writeCsv(path.join(PAPER_ASSETS_ROOT, 'table_privsearch_healthcare_query_families.csv'), [
    ['query_type', 'query_count', 'mean_setup_ms', 'mean_search_ms', 'mean_verify_ms', 'mean_total_ms', 'auth_overhead_ms', 'auth_share_pct'],
    ...phaseRows.map((row) => [
      row.query_type,
      row.query_count,
      row.mean_setup_ms,
      row.mean_search_ms,
      row.mean_verify_ms,
      row.mean_total_ms,
      row.auth_overhead_ms,
      row.auth_share_pct,
    ]),
  ]);

  writeCsv(path.join(PAPER_ASSETS_ROOT, 'table_privsearch_healthcare_global_metrics.csv'), [
    ['metric', 'value'],
    ['run_id', benchmark.run_id],
    ['workload_count', benchmark.workload_count],
    ['trials_per_query', benchmark.trials_per_query],
    ['total_records', datasetSummary.combined.total_documents],
    ['weighted_mean_total_ms', global.weighted_mean_total_ms],
    ['weighted_mean_search_ms', global.weighted_mean_search_ms],
    ['weighted_mean_verify_ms', global.weighted_mean_verify_ms],
    ['weighted_mean_setup_ms', global.weighted_mean_setup_ms],
    ['weighted_mean_auth_overhead_ms', global.weighted_mean_auth_overhead_ms],
    ['weighted_auth_share_pct', global.weighted_auth_share_pct],
    ['verification_failures', global.total_verification_failures],
  ]);

  writeText(
    path.join(FIGURES, 'figure_10_privsearch_healthcare_dataset_composition.svg'),
    barChartSvg(
      'Figure 10. Healthcare Corpus Composition',
      ['eICU demo', 'MedCD', 'openFDA'],
      [
        {
          name: 'Records',
          values: [
            datasetSummary.eicu.corpus_documents,
            datasetSummary.medcd.notes,
            datasetSummary.openfda.corpus_documents,
          ],
        },
      ],
      {
        xAxisLabel: 'Healthcare source',
        yAxisLabel: 'Normalized records',
        tickDigits: 0,
        colors: ['#2563eb'],
      },
    ),
  );

  writeText(
    path.join(FIGURES, 'figure_11_privsearch_healthcare_latency_components.svg'),
    barChartSvg(
      'Figure 11. Healthcare Query-Family Latency Components',
      reps.map((row) => familyLabel(row.query_type)),
      [
        { name: 'Search ms', values: reps.map((row) => row.mean_search_ms) },
        { name: 'Verify ms', values: reps.map((row) => row.mean_verify_ms) },
      ],
      {
        xAxisLabel: 'Representative query families',
        yAxisLabel: 'Mean latency (ms)',
        colors: ['#0f766e', '#d97706'],
      },
    ),
  );

  writeText(
    path.join(FIGURES, 'figure_12_privsearch_healthcare_auth_share.svg'),
    barChartSvg(
      'Figure 12. Authentication Overhead Share by Query Family',
      phaseRows.map((row) => familyLabel(row.query_type)),
      [
        { name: 'Auth share %', values: phaseRows.map((row) => row.auth_share_pct) },
      ],
      {
        xAxisLabel: 'Query family',
        yAxisLabel: 'Authentication share (%)',
        tickDigits: 0,
        colors: ['#7c3aed'],
      },
    ),
  );

  const md = [
    '# PrivSearch Healthcare Paper Assets',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Benchmark run: ${benchmark.run_id}`,
    '',
    `Corpus size: ${datasetSummary.combined.total_documents}`,
    '',
    `Workloads: ${benchmark.workload_count}`,
    '',
    `Trials per workload: ${benchmark.trials_per_query}`,
    '',
    '## Tables',
    '',
    '- `table_privsearch_healthcare_dataset_scope.csv`',
    '- `table_privsearch_healthcare_query_families.csv`',
    '- `table_privsearch_healthcare_global_metrics.csv`',
    '',
    '## Figures',
    '',
    '![Figure 10. Healthcare corpus composition](paper_assets/figures/figure_10_privsearch_healthcare_dataset_composition.svg)',
    '',
    '*Figure 10. Record counts across the three healthcare sources used in the broadened PrivSearch validation corpus.*',
    '',
    '![Figure 11. Healthcare latency components](paper_assets/figures/figure_11_privsearch_healthcare_latency_components.svg)',
    '',
    '*Figure 11. Mean search versus verification latency for representative healthcare query families.*',
    '',
    '![Figure 12. Authentication overhead share](paper_assets/figures/figure_12_privsearch_healthcare_auth_share.svg)',
    '',
    '*Figure 12. Authentication-overhead share as a percentage of total latency across healthcare query families.*',
    '',
    '## Notes',
    '',
    '- The latency-component figure focuses on representative families so the chart remains legible while still showing the contrast between lightweight disjunctive/fuzzy queries and heavier conjunctive/range families.',
    '- The authentication-share figure supports the manuscript claim that verification dominates the runtime profile on the broadened healthcare corpus.',
  ].join('\n');
  writeText(path.join(PAPER_ASSETS_ROOT, 'privsearch_healthcare_assets.md'), md);

  console.log(`PrivSearch healthcare paper assets written to ${PAPER_ASSETS_ROOT}`);
}

main();
