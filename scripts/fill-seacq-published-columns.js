require('dotenv/config');

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BENCHMARK_ROOT = path.join(ROOT, 'NweDB', 'benchmark_runs');
const PUBLISHED_DATA_FILE = process.env.SEACQ_PUBLISHED_SWEEP_FILE
  || path.join(ROOT, 'NweDB', 'PDFs', 'SeaCQ_digitized_keyword_sweep.json');
const RUN_ID = process.env.SEACQ_RUN_ID || '';
const RUN_DIR = process.env.SEACQ_RUN_DIR || '';

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsvLine(line) {
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
  return values;
}

function loadCsvObjects(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  if (!lines.length) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    for (let i = 0; i < headers.length; i += 1) {
      row[headers[i]] = values[i] ?? '';
    }
    return row;
  });
}

function writeCsvObjects(filePath, rows, headers) {
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header] ?? '')).join(',')),
  ];
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function resolveRunDir() {
  if (RUN_DIR) {
    return path.resolve(ROOT, RUN_DIR);
  }

  if (RUN_ID) {
    return path.join(BENCHMARK_ROOT, RUN_ID);
  }

  const candidates = fs.readdirSync(BENCHMARK_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('seacq_comparison_'))
    .map((entry) => ({
      name: entry.name,
      fullPath: path.join(BENCHMARK_ROOT, entry.name),
      mtimeMs: fs.statSync(path.join(BENCHMARK_ROOT, entry.name)).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (!candidates.length) {
    throw new Error(`No SeaCQ comparison run directories found in ${BENCHMARK_ROOT}`);
  }

  return candidates[0].fullPath;
}

function loadPublishedSweep() {
  const payload = JSON.parse(fs.readFileSync(PUBLISHED_DATA_FILE, 'utf8'));
  const byQueryType = new Map();

  for (const row of payload.keyword_sweep || []) {
    byQueryType.set(row.query_type, {
      ...row,
      total_ms: Number(row.search_ms) + Number(row.verify_ms),
    });
  }

  return {
    meta: payload,
    byQueryType,
  };
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatMs(value) {
  if (!Number.isFinite(value)) {
    return '';
  }
  if (value >= 1000) {
    return value.toFixed(1);
  }
  if (value >= 10) {
    return value.toFixed(2);
  }
  return value.toFixed(4);
}

function computeLogTicks(minValue, maxValue) {
  const minPower = Math.floor(Math.log10(minValue));
  const maxPower = Math.ceil(Math.log10(maxValue));
  const ticks = [];

  for (let power = minPower; power <= maxPower; power += 1) {
    ticks.push(10 ** power);
  }

  return ticks;
}

function createLinePath(points, xScale, yScale) {
  return points.map((point, index) => {
    const x = xScale(point.keyword_count);
    const y = yScale(point.value_ms);
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

function buildOverlaySvg(metrics) {
  const panelWidth = 320;
  const panelHeight = 240;
  const margin = { top: 36, right: 20, bottom: 44, left: 62 };
  const gap = 24;
  const totalWidth = panelWidth * metrics.length + gap * (metrics.length - 1);
  const totalHeight = panelHeight;

  const colors = {
    privsearch: '#0f766e',
    seacq: '#b45309',
    grid: '#d6d3d1',
    axis: '#44403c',
    text: '#1c1917',
    bg: '#fffdf8',
  };

  const panels = metrics.map((metric, index) => {
    const xOffset = index * (panelWidth + gap);
    const plotLeft = xOffset + margin.left;
    const plotTop = margin.top;
    const plotWidth = panelWidth - margin.left - margin.right;
    const plotHeight = panelHeight - margin.top - margin.bottom;
    const xMin = 2;
    const xMax = 10;
    const yMin = Math.min(...metric.points.map((point) => point.value_ms));
    const yMax = Math.max(...metric.points.map((point) => point.value_ms));
    const paddedMin = 10 ** Math.floor(Math.log10(Math.max(0.01, yMin / 1.4)));
    const paddedMax = 10 ** Math.ceil(Math.log10(yMax * 1.4));
    const logTicks = computeLogTicks(paddedMin, paddedMax);

    const xScale = (value) => plotLeft + ((value - xMin) / (xMax - xMin)) * plotWidth;
    const yScale = (value) => {
      const minLog = Math.log10(paddedMin);
      const maxLog = Math.log10(paddedMax);
      const valueLog = Math.log10(value);
      const normalized = (valueLog - minLog) / (maxLog - minLog);
      return plotTop + plotHeight - normalized * plotHeight;
    };

    const gridLines = logTicks.map((tick) => {
      const y = yScale(tick);
      return `
        <line x1="${plotLeft}" y1="${y.toFixed(2)}" x2="${(plotLeft + plotWidth).toFixed(2)}" y2="${y.toFixed(2)}" stroke="${colors.grid}" stroke-width="1" />
        <text x="${(plotLeft - 8).toFixed(2)}" y="${(y + 4).toFixed(2)}" text-anchor="end" font-size="11" fill="${colors.text}">${tick >= 1000 ? `${tick / 1000}k` : tick}</text>
      `;
    }).join('');

    const xTicks = [2, 4, 6, 8, 10].map((tick) => `
      <line x1="${xScale(tick).toFixed(2)}" y1="${plotTop}" x2="${xScale(tick).toFixed(2)}" y2="${(plotTop + plotHeight).toFixed(2)}" stroke="${colors.grid}" stroke-width="1" />
      <text x="${xScale(tick).toFixed(2)}" y="${(plotTop + plotHeight + 20).toFixed(2)}" text-anchor="middle" font-size="11" fill="${colors.text}">${tick}</text>
    `).join('');

    const series = [
      {
        name: 'PrivSearch',
        color: colors.privsearch,
        path: createLinePath(metric.points.filter((point) => point.scheme === 'PrivSearch'), xScale, yScale),
        points: metric.points.filter((point) => point.scheme === 'PrivSearch'),
      },
      {
        name: 'SeaCQ',
        color: colors.seacq,
        path: createLinePath(metric.points.filter((point) => point.scheme === 'SeaCQ'), xScale, yScale),
        points: metric.points.filter((point) => point.scheme === 'SeaCQ'),
      },
    ];

    const circles = series.map((serie) => serie.points.map((point) => `
      <circle cx="${xScale(point.keyword_count).toFixed(2)}" cy="${yScale(point.value_ms).toFixed(2)}" r="3.5" fill="${serie.color}" />
    `).join('')).join('');

    const legend = `
      <line x1="${(plotLeft + 6).toFixed(2)}" y1="${(plotTop - 16).toFixed(2)}" x2="${(plotLeft + 26).toFixed(2)}" y2="${(plotTop - 16).toFixed(2)}" stroke="${colors.privsearch}" stroke-width="2.5" />
      <circle cx="${(plotLeft + 16).toFixed(2)}" cy="${(plotTop - 16).toFixed(2)}" r="3.5" fill="${colors.privsearch}" />
      <text x="${(plotLeft + 32).toFixed(2)}" y="${(plotTop - 12).toFixed(2)}" font-size="11" fill="${colors.text}">PrivSearch</text>
      <line x1="${(plotLeft + 110).toFixed(2)}" y1="${(plotTop - 16).toFixed(2)}" x2="${(plotLeft + 130).toFixed(2)}" y2="${(plotTop - 16).toFixed(2)}" stroke="${colors.seacq}" stroke-width="2.5" />
      <circle cx="${(plotLeft + 120).toFixed(2)}" cy="${(plotTop - 16).toFixed(2)}" r="3.5" fill="${colors.seacq}" />
      <text x="${(plotLeft + 136).toFixed(2)}" y="${(plotTop - 12).toFixed(2)}" font-size="11" fill="${colors.text}">SeaCQ</text>
    `;

    return `
      <g>
        <rect x="${xOffset}" y="0" width="${panelWidth}" height="${panelHeight}" rx="12" fill="${colors.bg}" />
        <text x="${(xOffset + panelWidth / 2).toFixed(2)}" y="18" text-anchor="middle" font-size="14" font-weight="700" fill="${colors.text}">${metric.title}</text>
        ${gridLines}
        ${xTicks}
        <rect x="${plotLeft}" y="${plotTop}" width="${plotWidth}" height="${plotHeight}" fill="none" stroke="${colors.axis}" stroke-width="1.2" />
        <text x="${(plotLeft + plotWidth / 2).toFixed(2)}" y="${(panelHeight - 10).toFixed(2)}" text-anchor="middle" font-size="12" fill="${colors.text}">Query keywords</text>
        <text x="${(xOffset + 18).toFixed(2)}" y="${(plotTop + plotHeight / 2).toFixed(2)}" text-anchor="middle" transform="rotate(-90 ${(xOffset + 18).toFixed(2)} ${(plotTop + plotHeight / 2).toFixed(2)})" font-size="12" fill="${colors.text}">Latency (ms, log scale)</text>
        ${legend}
        ${series.map((serie) => `<path d="${serie.path}" fill="none" stroke="${serie.color}" stroke-width="2.5" />`).join('')}
        ${circles}
      </g>
    `;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}">
  <rect width="${totalWidth}" height="${totalHeight}" fill="#fafaf9" />
  ${panels}
</svg>`;
}

function buildOverlayMetrics(summaryRows, publishedByQueryType) {
  const keywordCounts = [2, 4, 6, 8, 10];
  const metrics = [
    { key: 'search', title: 'Search Phase' },
    { key: 'verify', title: 'Verify Phase' },
    { key: 'total', title: 'Search + Verify' },
  ];

  return metrics.map((metric) => {
    const points = [];
    for (const keywordCount of keywordCounts) {
      const queryType = `and_${keywordCount}`;
      const summaryRow = summaryRows.find((row) => row.query_type === queryType);
      const publishedRow = publishedByQueryType.get(queryType);
      if (!summaryRow || !publishedRow) {
        continue;
      }

      const privValue = metric.key === 'search'
        ? Number(summaryRow.privsearch_mean_search_ms)
        : metric.key === 'verify'
          ? Number(summaryRow.privsearch_mean_verify_ms)
          : Number(summaryRow.privsearch_mean_total_ms);

      const seacqValue = metric.key === 'search'
        ? Number(publishedRow.search_ms)
        : metric.key === 'verify'
          ? Number(publishedRow.verify_ms)
          : Number(publishedRow.total_ms);

      points.push(
        { scheme: 'PrivSearch', keyword_count: keywordCount, value_ms: privValue },
        { scheme: 'SeaCQ', keyword_count: keywordCount, value_ms: seacqValue },
      );
    }

    return {
      title: metric.title,
      points,
    };
  });
}

function main() {
  const runDir = resolveRunDir();
  const tablePath = path.join(runDir, 'seacq_comparison_table.csv');
  const resultsPath = path.join(runDir, 'seacq_comparison_results.json');
  const reportPath = path.join(runDir, 'seacq_comparison_report.md');

  const summaryRows = loadCsvObjects(tablePath);
  const resultsJson = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const { meta, byQueryType } = loadPublishedSweep();

  const headers = [
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
  ];

  const mergedRows = summaryRows.map((row) => {
    const published = byQueryType.get(row.query_type);
    if (!published) {
      return row;
    }

    const searchSpeedup = Number(published.search_ms) / Number(row.privsearch_mean_search_ms);
    const verifySpeedup = Number(published.verify_ms) / Number(row.privsearch_mean_verify_ms);
    const totalSpeedup = Number(published.total_ms) / Number(row.privsearch_mean_total_ms);

    return {
      ...row,
      seacq_published_setup_ms: 'not reported',
      seacq_published_search_ms: published.search_ms.toFixed(1),
      seacq_published_verify_ms: published.verify_ms.toFixed(1),
      seacq_published_total_ms: published.total_ms.toFixed(1),
      notes: `${row.notes}; digitized SeaCQ points from Fig. 6(a)/7(a); PrivSearch speedup x${searchSpeedup.toFixed(1)} search, x${verifySpeedup.toFixed(1)} verify, x${totalSpeedup.toFixed(1)} total`,
    };
  });

  writeCsvObjects(tablePath, mergedRows, headers);

  resultsJson.seacq_published_keyword_sweep = meta.keyword_sweep;
  resultsJson.seacq_digitization_method = meta.digitization_method;
  resultsJson.notes = [
    ...(resultsJson.notes || []),
    'SeaCQ published search and verify columns were filled using approximate manual digitization from Fig. 6(a) and Fig. 7(a).',
    'SeaCQ does not publish an explicit setup phase for the keyword-count sweep, so setup remains marked as not reported.',
  ];
  fs.writeFileSync(resultsPath, JSON.stringify(resultsJson, null, 2), 'utf8');

  const overlayMetrics = buildOverlayMetrics(mergedRows, byQueryType);
  const overlaySvg = buildOverlaySvg(overlayMetrics);
  const overlaySvgPath = path.join(runDir, 'seacq_privsearch_overlay.svg');
  fs.writeFileSync(overlaySvgPath, overlaySvg, 'utf8');

  const overlayDataRows = [
    ['metric', 'scheme', 'keyword_count', 'value_ms'],
    ...overlayMetrics.flatMap((metric) => metric.points.map((point) => [
      metric.title,
      point.scheme,
      point.keyword_count,
      formatMs(point.value_ms),
    ])),
  ];
  const overlayDataPath = path.join(runDir, 'seacq_privsearch_overlay_data.csv');
  fs.writeFileSync(
    overlayDataPath,
    `${overlayDataRows.map((row) => row.map((value) => csvEscape(value)).join(',')).join('\n')}\n`,
    'utf8',
  );

  const reportLines = [
    '# SeaCQ Comparison Pack',
    '',
    `Generated: ${resultsJson.generated_at}`,
    '',
    `Run ID: ${resultsJson.run_id}`,
    '',
    `Engine: ${resultsJson.engine}`,
    '',
    `Trials per query: ${resultsJson.trials_per_query}`,
    '',
    `Warmup trials per query: ${resultsJson.warmup_trials_per_query || 0}`,
    '',
    `Selected workloads: ${resultsJson.selected_workload_count}`,
    '',
    '| Query Type | PrivSearch Search ms | SeaCQ Search ms | PrivSearch Verify ms | SeaCQ Verify ms | PrivSearch Total ms | SeaCQ Total ms |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...mergedRows.map((row) => `| ${row.query_type} | ${Number(row.privsearch_mean_search_ms).toFixed(4)} | ${row.seacq_published_search_ms} | ${Number(row.privsearch_mean_verify_ms).toFixed(4)} | ${row.seacq_published_verify_ms} | ${Number(row.privsearch_mean_total_ms).toFixed(4)} | ${row.seacq_published_total_ms} |`),
    '',
    'Notes:',
    '- SeaCQ published values are approximate digitized points from Fig. 6(a) and Fig. 7(a), because the paper does not provide the keyword-sweep numbers in a machine-readable table.',
    '- SeaCQ setup phase values are marked as not reported because the published keyword-count sweep does not isolate a setup phase.',
    '- `seacq_privsearch_overlay.svg` plots search, verify, and total latency on a log-scale y-axis for clearer side-by-side comparison.',
  ];
  fs.writeFileSync(reportPath, `${reportLines.join('\n')}\n`, 'utf8');

  console.log(`Filled SeaCQ published columns in ${tablePath}`);
  console.log(`Overlay figure written to ${overlaySvgPath}`);
  console.log(`Overlay data written to ${overlayDataPath}`);
}

main();
