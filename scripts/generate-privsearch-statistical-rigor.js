require('dotenv/config');

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BENCHMARK_ROOT = path.join(ROOT, 'NweDB', 'benchmark_runs');
const PAPER_ASSETS_ROOT = path.join(ROOT, 'Results', 'paper_assets');
const OUTPUT_STEM = 'privsearch_statistical_rigor';
const PERMUTATION_ITERATIONS = Number(process.env.PRIVSEARCH_STATS_PERMUTATIONS || '5000');
const BOOTSTRAP_ITERATIONS = Number(process.env.PRIVSEARCH_STATS_BOOTSTRAPS || '3000');

const DATASET_CONFIGS = [
  {
    key: 'enron',
    prefix: 'enron_privsearch-prototype_',
    minWorkloadCount: 400,
    minTrials: 50,
  },
  {
    key: 'healthcare',
    prefix: 'healthcare_privsearch-prototype_',
    minWorkloadCount: 200,
    minTrials: 10,
  },
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
  const percentile = (q) => sorted[Math.min(Math.floor((n - 1) * q), n - 1)];
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

function bootstrapCi(values, iterations = BOOTSTRAP_ITERATIONS, seed = 314159) {
  if (!values.length) {
    return { low: 0, high: 0, iterations: 0 };
  }
  if (values.length === 1) {
    return { low: values[0], high: values[0], iterations: 1 };
  }

  const rng = createRng(seed);
  const means = [];
  for (let i = 0; i < iterations; i += 1) {
    const sample = [];
    for (let j = 0; j < values.length; j += 1) {
      sample.push(values[Math.floor(rng() * values.length)]);
    }
    means.push(mean(sample));
  }
  means.sort((a, b) => a - b);
  const lowIndex = Math.max(0, Math.floor((means.length - 1) * 0.025));
  const highIndex = Math.min(means.length - 1, Math.floor((means.length - 1) * 0.975));
  return {
    low: means[lowIndex],
    high: means[highIndex],
    iterations,
  };
}

function interquartileRange(values) {
  if (!values.length) {
    return { q1: 0, q3: 0, iqr: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const percentile = (q) => sorted[Math.min(Math.floor((n - 1) * q), n - 1)];
  const q1 = percentile(0.25);
  const q3 = percentile(0.75);
  return {
    q1,
    q3,
    iqr: q3 - q1,
  };
}

function hierarchicalBootstrapMeanCi(rows, sampleKey, iterations = BOOTSTRAP_ITERATIONS, seed = 271828) {
  const sampleRows = rows
    .map((row) => row.raw_trial_samples?.[sampleKey])
    .filter((samples) => Array.isArray(samples) && samples.length);

  if (!sampleRows.length) {
    return null;
  }
  if (sampleRows.length === 1 && sampleRows[0].length === 1) {
    return { low: sampleRows[0][0], high: sampleRows[0][0], iterations: 1 };
  }

  const rng = createRng(seed);
  const means = [];
  for (let i = 0; i < iterations; i += 1) {
    const workloadMeans = [];
    for (let workloadIndex = 0; workloadIndex < sampleRows.length; workloadIndex += 1) {
      const chosenWorkload = sampleRows[Math.floor(rng() * sampleRows.length)];
      let sampleSum = 0;
      for (let trialIndex = 0; trialIndex < chosenWorkload.length; trialIndex += 1) {
        sampleSum += chosenWorkload[Math.floor(rng() * chosenWorkload.length)];
      }
      workloadMeans.push(sampleSum / chosenWorkload.length);
    }
    means.push(mean(workloadMeans));
  }
  means.sort((a, b) => a - b);
  const lowIndex = Math.max(0, Math.floor((means.length - 1) * 0.025));
  const highIndex = Math.min(means.length - 1, Math.floor((means.length - 1) * 0.975));
  return {
    low: means[lowIndex],
    high: means[highIndex],
    iterations,
  };
}

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleInPlace(values, rng) {
  const arr = values.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function permutationTestMean(left, right, iterations = PERMUTATION_ITERATIONS, seed = 42) {
  if (!left.length || !right.length) {
    return { p_value: 1, observed_mean_diff: 0, iterations: 0 };
  }

  const observed = mean(left) - mean(right);
  const combined = [...left, ...right];
  const leftSize = left.length;
  const rng = createRng(seed);
  let extremeCount = 0;

  for (let i = 0; i < iterations; i += 1) {
    const shuffled = shuffleInPlace(combined, rng);
    const permLeft = shuffled.slice(0, leftSize);
    const permRight = shuffled.slice(leftSize);
    const diff = mean(permLeft) - mean(permRight);
    if (Math.abs(diff) >= Math.abs(observed)) {
      extremeCount += 1;
    }
  }

  return {
    p_value: (extremeCount + 1) / (iterations + 1),
    observed_mean_diff: observed,
    iterations,
  };
}

function cliffsDelta(left, right) {
  if (!left.length || !right.length) {
    return 0;
  }
  let greater = 0;
  let less = 0;
  for (const x of left) {
    for (const y of right) {
      if (x > y) {
        greater += 1;
      } else if (x < y) {
        less += 1;
      }
    }
  }
  return (greater - less) / (left.length * right.length);
}

function significanceLabel(pValue) {
  return pValue < 0.05 ? 'yes' : 'no';
}

function effectMagnitude(delta) {
  const abs = Math.abs(delta);
  if (abs < 0.147) {
    return 'negligible';
  }
  if (abs < 0.33) {
    return 'small';
  }
  if (abs < 0.474) {
    return 'medium';
  }
  return 'large';
}

function selectLatestRun(config) {
  const candidates = fs.readdirSync(BENCHMARK_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(config.prefix))
    .map((entry) => {
      const fullPath = path.join(BENCHMARK_ROOT, entry.name);
      let benchmark = null;
      try {
        benchmark = JSON.parse(fs.readFileSync(path.join(fullPath, 'benchmark_results.json'), 'utf8'));
      } catch {
        benchmark = null;
      }
      return {
        name: entry.name,
        fullPath,
        mtimeMs: fs.statSync(fullPath).mtimeMs,
        workloadCount: Number(benchmark?.workload_count || 0),
        trialsPerQuery: Number(benchmark?.trials_per_query || 0),
        benchmark,
      };
    });

  const eligible = candidates.filter((candidate) => (
    candidate.workloadCount >= config.minWorkloadCount
    && candidate.trialsPerQuery >= config.minTrials
  ));
  const pool = eligible.length ? eligible : candidates;
  pool.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!pool.length) {
    throw new Error(`No benchmark run found for ${config.key}`);
  }
  return pool[0];
}

function buildDatasetSummary(datasetKey, benchmark) {
  const grouped = new Map();
  for (const row of benchmark.query_results || []) {
    if (!grouped.has(row.query_type)) {
      grouped.set(row.query_type, []);
    }
    grouped.get(row.query_type).push(row);
  }

  const familyRows = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([queryType, rows]) => {
    const totalMeans = rows.map((row) => Number(row.total_stats?.mean || 0));
    const totalMedians = rows.map((row) => Number(row.total_stats?.median || 0));
    const totalStddevs = rows.map((row) => Number(row.total_stats?.stddev || 0));
    const searchMeans = rows.map((row) => Number(row.search_stats?.mean || 0));
    const verifyMeans = rows.map((row) => Number(row.verify_stats?.mean || 0));
    const rawTotalTrials = rows.flatMap((row) => Array.isArray(row.raw_trial_samples?.total_ms) ? row.raw_trial_samples.total_ms : []);
    const workloadMeanBootstrap = bootstrapCi(totalMeans);
    const hierarchicalBootstrap = hierarchicalBootstrapMeanCi(rows, 'total_ms');
    const iqrStats = interquartileRange(totalMeans);
    return {
      dataset: datasetKey,
      query_type: queryType,
      query_count: rows.length,
      benchmark_trials_per_query: benchmark.trials_per_query,
      total_latency_stats: computeStats(totalMeans),
      median_latency_stats: computeStats(totalMedians),
      total_stddev_stats: computeStats(totalStddevs),
      search_latency_stats: computeStats(searchMeans),
      verify_latency_stats: computeStats(verifyMeans),
      total_latency_iqr: iqrStats,
      workload_bootstrap_ci: workloadMeanBootstrap,
      hierarchical_trial_bootstrap_ci: hierarchicalBootstrap,
      pooled_trial_count: rawTotalTrials.length,
      raw_trial_samples_available: rawTotalTrials.length > 0,
      pooled_trial_total_stats: rawTotalTrials.length ? computeStats(rawTotalTrials) : null,
      significance_samples: totalMeans,
    };
  });

  return {
    dataset: datasetKey,
    run_id: benchmark.run_id,
    workload_count: benchmark.workload_count,
    trials_per_query: benchmark.trials_per_query,
    families: familyRows,
  };
}

function createComparison(leftDataset, leftType, rightDataset, rightType, leftSamples, rightSamples, note) {
  if (!leftSamples.length || !rightSamples.length) {
    return null;
  }
  const permutation = permutationTestMean(leftSamples, rightSamples);
  const delta = cliffsDelta(leftSamples, rightSamples);
  return {
    left_dataset: leftDataset,
    left_query_type: leftType,
    right_dataset: rightDataset,
    right_query_type: rightType,
    sample_count_left: leftSamples.length,
    sample_count_right: rightSamples.length,
    observed_mean_diff_ms: permutation.observed_mean_diff,
    p_value: permutation.p_value,
    effect_size_cliffs_delta: delta,
    effect_magnitude: effectMagnitude(delta),
    significant_alpha_0_05: significanceLabel(permutation.p_value),
    test: 'two-sided permutation test on workload-level mean total latency',
    note,
  };
}

function buildComparisons(datasetSummaries) {
  const familyMap = new Map();
  for (const summary of datasetSummaries) {
    for (const family of summary.families) {
      familyMap.set(`${summary.dataset}:${family.query_type}`, family);
    }
  }

  const planned = [
    ['enron', 'single_keyword', 'enron', 'and_2', 'single_keyword vs and_2 within Enron'],
    ['enron', 'and_2', 'enron', 'or_2', 'and_2 vs or_2 within Enron'],
    ['enron', 'or_2', 'enron', 'fuzzy_1', 'or_2 vs fuzzy_1 within Enron'],
    ['healthcare', 'single_keyword', 'healthcare', 'and_2', 'single_keyword vs and_2 within healthcare'],
    ['healthcare', 'and_2', 'healthcare', 'or_2', 'and_2 vs or_2 within healthcare'],
    ['healthcare', 'range_month_1', 'healthcare', 'range_year_2', 'range_month_1 vs range_year_2 within healthcare'],
    ['healthcare', 'semantic_v1', 'healthcare', 'fuzzy_1', 'semantic_v1 vs fuzzy_1 within healthcare'],
    ['enron', 'single_keyword', 'healthcare', 'single_keyword', 'single_keyword across datasets'],
    ['enron', 'and_2', 'healthcare', 'and_2', 'and_2 across datasets'],
    ['enron', 'or_2', 'healthcare', 'or_2', 'or_2 across datasets'],
    ['enron', 'fuzzy_1', 'healthcare', 'fuzzy_1', 'fuzzy_1 across datasets'],
  ];

  return planned
    .map(([leftDataset, leftType, rightDataset, rightType, note]) => {
      const left = familyMap.get(`${leftDataset}:${leftType}`);
      const right = familyMap.get(`${rightDataset}:${rightType}`);
      if (!left || !right) {
        return null;
      }
      return createComparison(
        leftDataset,
        leftType,
        rightDataset,
        rightType,
        left.significance_samples,
        right.significance_samples,
        note,
      );
    })
    .filter(Boolean);
}

function main() {
  ensureDir(PAPER_ASSETS_ROOT);

  const datasetSummaries = DATASET_CONFIGS.map((config) => {
    const run = selectLatestRun(config);
    return buildDatasetSummary(config.key, run.benchmark);
  });
  const comparisons = buildComparisons(datasetSummaries);

  const output = {
    generated_at: new Date().toISOString(),
    method_note: 'Descriptive statistics are computed over workload-level benchmark instances from stored runs. Significance testing uses workload-level mean total latency to avoid treating repeated trials from the same workload as fully independent. Where raw per-trial samples are available, the summary also reports workload-level bootstrap confidence intervals and hierarchical bootstrap confidence intervals.',
    dataset_summaries: datasetSummaries,
    significance_comparisons: comparisons,
  };

  const jsonPath = path.join(PAPER_ASSETS_ROOT, `${OUTPUT_STEM}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2), 'utf8');

  const descriptiveCsv = path.join(PAPER_ASSETS_ROOT, `${OUTPUT_STEM}_descriptive.csv`);
  writeCsv(descriptiveCsv, [
    [
      'dataset',
      'run_id',
      'query_type',
      'query_count',
      'trials_per_query',
      'mean_total_ms',
      'median_total_ms',
      'stddev_total_ms',
      'ci95_low_total_ms',
      'ci95_high_total_ms',
      'bootstrap_ci95_low_total_ms',
      'bootstrap_ci95_high_total_ms',
      'hierarchical_bootstrap_ci95_low_total_ms',
      'hierarchical_bootstrap_ci95_high_total_ms',
      'q1_total_ms',
      'q3_total_ms',
      'iqr_total_ms',
      'p95_total_ms',
      'p99_total_ms',
      'mean_search_ms',
      'mean_verify_ms',
      'pooled_trial_count',
      'raw_trial_samples_available',
    ],
    ...datasetSummaries.flatMap((summary) => summary.families.map((family) => [
      summary.dataset,
      summary.run_id,
      family.query_type,
      family.query_count,
      summary.trials_per_query,
      family.total_latency_stats.mean,
      family.total_latency_stats.median,
      family.total_latency_stats.stddev,
      family.total_latency_stats.ci95_low,
      family.total_latency_stats.ci95_high,
      family.workload_bootstrap_ci.low,
      family.workload_bootstrap_ci.high,
      family.hierarchical_trial_bootstrap_ci?.low ?? '',
      family.hierarchical_trial_bootstrap_ci?.high ?? '',
      family.total_latency_iqr.q1,
      family.total_latency_iqr.q3,
      family.total_latency_iqr.iqr,
      family.total_latency_stats.p95,
      family.total_latency_stats.p99,
      family.search_latency_stats.mean,
      family.verify_latency_stats.mean,
      family.pooled_trial_count,
      family.raw_trial_samples_available ? 'yes' : 'no',
    ])),
  ]);

  const significanceCsv = path.join(PAPER_ASSETS_ROOT, `${OUTPUT_STEM}_significance.csv`);
  writeCsv(significanceCsv, [
    [
      'left_dataset',
      'left_query_type',
      'right_dataset',
      'right_query_type',
      'sample_count_left',
      'sample_count_right',
      'observed_mean_diff_ms',
      'p_value',
      'effect_size_cliffs_delta',
      'effect_magnitude',
      'significant_alpha_0_05',
      'test',
      'note',
    ],
    ...comparisons.map((row) => [
      row.left_dataset,
      row.left_query_type,
      row.right_dataset,
      row.right_query_type,
      row.sample_count_left,
      row.sample_count_right,
      row.observed_mean_diff_ms,
      row.p_value,
      row.effect_size_cliffs_delta,
      row.effect_magnitude,
      row.significant_alpha_0_05,
      row.test,
      row.note,
    ]),
  ]);

  const mdLines = [
    '# PrivSearch Statistical Rigor Summary',
    '',
    `Generated: ${output.generated_at}`,
    '',
    output.method_note,
    '',
    ...datasetSummaries.flatMap((summary) => [
      `## ${summary.dataset[0].toUpperCase()}${summary.dataset.slice(1)} Descriptive Statistics`,
      '',
      `Run ID: ${summary.run_id}`,
      '',
      `Workloads benchmarked: ${summary.workload_count}`,
      '',
      `Trials per query: ${summary.trials_per_query}`,
      '',
      '| Query Type | N | Mean Total ms | Median Total ms | Std Dev ms | 95% CI ms | Bootstrap 95% CI ms | IQR ms | P95 ms | P99 ms | Mean Search ms | Mean Verify ms |',
      '|---|---:|---:|---:|---:|---|---|---|---:|---:|---:|---:|',
      ...summary.families.map((family) => `| ${family.query_type} | ${family.query_count} | ${fmt(family.total_latency_stats.mean)} | ${fmt(family.total_latency_stats.median)} | ${fmt(family.total_latency_stats.stddev)} | [${fmt(family.total_latency_stats.ci95_low)}, ${fmt(family.total_latency_stats.ci95_high)}] | [${fmt(family.workload_bootstrap_ci.low)}, ${fmt(family.workload_bootstrap_ci.high)}] | [${fmt(family.total_latency_iqr.q1)}, ${fmt(family.total_latency_iqr.q3)}] (IQR ${fmt(family.total_latency_iqr.iqr)}) | ${fmt(family.total_latency_stats.p95)} | ${fmt(family.total_latency_stats.p99)} | ${fmt(family.search_latency_stats.mean)} | ${fmt(family.verify_latency_stats.mean)} |`),
      '',
      'Raw-trial availability:',
      '',
      '| Query Type | Raw Trial Samples Available | Pooled Trial Count | Hierarchical Bootstrap 95% CI ms |',
      '|---|---|---:|---|',
      ...summary.families.map((family) => `| ${family.query_type} | ${family.raw_trial_samples_available ? 'yes' : 'no'} | ${family.pooled_trial_count} | ${family.hierarchical_trial_bootstrap_ci ? `[${fmt(family.hierarchical_trial_bootstrap_ci.low)}, ${fmt(family.hierarchical_trial_bootstrap_ci.high)}]` : 'not available'} |`),
      '',
    ]),
    '## Significance Comparisons',
    '',
    "| Left | Right | Sample Sizes | Mean Diff ms | p-value | Cliff's delta | Effect | Significant at 0.05? | Note |",
    '|---|---|---:|---:|---:|---:|---|---|---|',
    ...comparisons.map((row) => `| ${row.left_dataset}:${row.left_query_type} | ${row.right_dataset}:${row.right_query_type} | ${row.sample_count_left}/${row.sample_count_right} | ${fmt(row.observed_mean_diff_ms)} | ${fmt(row.p_value, 6)} | ${fmt(row.effect_size_cliffs_delta, 4)} | ${row.effect_magnitude} | ${row.significant_alpha_0_05} | ${row.note} |`),
    '',
    '## Notes',
    '',
    '- Significance testing here is based on workload-level mean total latency samples extracted from stored benchmark runs.',
    '- Bootstrap confidence intervals are included because latency distributions are often right-skewed and mean-based normal intervals can become misleading for sparse or noisy families.',
    '- Where raw per-trial samples are available, the report now includes hierarchical bootstrap confidence intervals that resample workloads and trials without treating repeated trials from the same workload as fully independent.',
    '- Very small workload-family counts should still be interpreted cautiously even when bootstrap intervals are reported.',
  ];

  const mdPath = path.join(PAPER_ASSETS_ROOT, `${OUTPUT_STEM}.md`);
  fs.writeFileSync(mdPath, `${mdLines.join('\n')}\n`, 'utf8');

  console.log(`PrivSearch statistical rigor written to ${mdPath}`);
}

main();
