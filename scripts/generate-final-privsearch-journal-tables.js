require('dotenv/config');

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAPER_ASSETS = path.join(ROOT, 'Results', 'paper_assets');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fmt(value, digits = 4) {
  return Number(value || 0).toFixed(digits);
}

function main() {
  const extension = readJson(path.join(PAPER_ASSETS, 'privsearch_extension_summary.json'));
  const replay = readJson(path.join(PAPER_ASSETS, 'privsearch_replay_protection.json'));
  const healthcarePhase = readJson(path.join(PAPER_ASSETS, 'privsearch_healthcare_phase_breakdown.json'));
  const healthcareSummary = readJson(path.join(ROOT, 'NweDB', 'healthcare', 'healthcare_dataset_summary.json'));
  const distributedWan = readJson(path.join(PAPER_ASSETS, 'distributed_validation_wan.json'));

  const extensionRows = extension.summary_by_query_type || [];
  const healthcareRows = healthcarePhase.phase_breakdown || [];
  const healthcareGlobal = healthcarePhase.global_summary || {};
  const seacqRows = extension.seacq_comparison || [];

  const lines = [
    '# Final PrivSearch Journal Tables',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Table 1. Enron-Derived PrivSearch Query-Family Summary',
    '',
    '| Query Type | Query Count | Mean Total ms | Mean Search ms | Mean Verify ms | Verification Failures |',
    '|---|---:|---:|---:|---:|---:|',
    ...extensionRows.map((row) => `| ${row.query_type} | ${row.query_count} | ${fmt(row.mean_total_ms)} | ${fmt(row.mean_search_ms)} | ${fmt(row.mean_verify_ms)} | ${row.total_verification_failures} |`),
    '',
    '## Table 2. SeaCQ-Aligned Conjunctive Comparison',
    '',
    '| Query Type | PrivSearch Total ms | SeaCQ Total ms | PrivSearch Search ms | SeaCQ Search ms | PrivSearch Verify ms | SeaCQ Verify ms |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...seacqRows.map((row) => `| ${row.query_type} | ${fmt(row.privsearch_mean_total_ms)} | ${fmt(row.seacq_published_total_ms, 1)} | ${fmt(row.privsearch_mean_search_ms)} | ${fmt(row.seacq_published_search_ms, 1)} | ${fmt(row.privsearch_mean_verify_ms)} | ${fmt(row.seacq_published_verify_ms, 1)} |`),
    '',
    '## Table 3. Healthcare Dataset Scope',
    '',
    '| Source | Records |',
    '|---|---:|',
    `| eICU demo | ${healthcareSummary.eicu.corpus_documents} |`,
    `| MedCD | ${healthcareSummary.medcd.notes} |`,
    `| openFDA | ${healthcareSummary.openfda.corpus_documents} |`,
    `| Total | ${healthcareSummary.combined.total_documents} |`,
    '',
    '## Table 4. Healthcare Global Metrics',
    '',
    '| Metric | Value |',
    '|---|---:|',
    `| Workloads | ${healthcarePhase.workload_count} |`,
    `| Trials per workload | ${healthcarePhase.trials_per_query} |`,
    `| Weighted mean total latency (ms) | ${fmt(healthcareGlobal.weighted_mean_total_ms)} |`,
    `| Weighted mean search latency (ms) | ${fmt(healthcareGlobal.weighted_mean_search_ms)} |`,
    `| Weighted mean verify latency (ms) | ${fmt(healthcareGlobal.weighted_mean_verify_ms)} |`,
    `| Weighted mean auth overhead (ms) | ${fmt(healthcareGlobal.weighted_mean_auth_overhead_ms)} |`,
    `| Weighted auth share (%) | ${fmt(healthcareGlobal.weighted_auth_share_pct, 2)} |`,
    `| Verification failures | ${healthcareGlobal.total_verification_failures} |`,
    '',
    '## Table 5. Healthcare Query-Family Summary',
    '',
    '| Query Type | Query Count | Mean Total ms | Mean Search ms | Mean Verify ms | Auth Share % |',
    '|---|---:|---:|---:|---:|---:|',
    ...healthcareRows.map((row) => `| ${row.query_type} | ${row.query_count} | ${fmt(row.mean_total_ms)} | ${fmt(row.mean_search_ms)} | ${fmt(row.mean_verify_ms)} | ${fmt(row.auth_share_pct, 2)} |`),
    '',
    '## Table 6. Replay Protection',
    '',
    '| Metric | Value |',
    '|---|---:|',
    `| Attempted | ${replay.results.attempted} |`,
    `| Accepted first requests | ${replay.results.accepted} |`,
    `| Replayed requests rejected | ${replay.results.rejected} |`,
    `| Replay rejection rate (%) | ${fmt(replay.results.replayRejectionRate * 100, 2)} |`,
    `| Mean replay rejection latency (ms) | ${fmt(replay.results.replayLatencyMs.mean)} |`,
    `| P95 replay rejection latency (ms) | ${fmt(replay.results.replayLatencyMs.p95)} |`,
    '',
    '## Table 7. WAN-Style Distributed Validation',
    '',
    '| Profile | Nodes | Success Rate | Threshold Mean ms | Full Mean ms |',
    '|---|---:|---:|---:|---:|',
    ...(distributedWan.results || []).map((row) => `| ${row.profileLabel} | ${row.nodeCount} | ${fmt(row.successRate * 100, 2)}% | ${fmt(row.endToEndThresholdMs.mean)} | ${fmt(row.endToEndFullMs.mean)} |`),
  ];

  fs.writeFileSync(path.join(PAPER_ASSETS, 'final_privsearch_journal_tables.md'), `${lines.join('\n')}\n`, 'utf8');
  console.log(`Final PrivSearch journal tables written to ${path.join(PAPER_ASSETS, 'final_privsearch_journal_tables.md')}`);
}

main();
