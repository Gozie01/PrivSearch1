// ─────────────────────────────────────────────────────────────
// Master experiment runner
//
// Usage (from lifedb/ directory):
//   npx ts-node --project tsconfig.json scripts/run_experiments.ts
//
// Runs all 5 experiments + 3 baselines in sequence, then writes
// Results/summary_report.md.
// ─────────────────────────────────────────────────────────────
import fs   from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../.env') });

import { timedReq, RESULTS } from './experiments/lib';
import { run as runExp1 }    from './experiments/exp1';
import { run as runExp2 }    from './experiments/exp2';
import { run as runExp3 }    from './experiments/exp3';
import { run as runExp4 }    from './experiments/exp4';
import { run as runExp5 }    from './experiments/exp5';
import { run as runBaselines } from './experiments/baselines';

// ── Types ─────────────────────────────────────────────────────

interface StepResult {
  name:      string;
  status:    'pass' | 'fail' | 'skip';
  durationMs: number;
  error?:    string;
}

// ── Health check ──────────────────────────────────────────────

async function checkHealth(): Promise<boolean> {
  for (let attempt = 1; attempt <= 12; attempt++) {
    const r = await timedReq('GET', '/health').catch(() => ({ status: 0 }));
    if (r.status === 200) {
      console.log('  ✔ Server healthy');
      return true;
    }
    console.log(`  Waiting for server (attempt ${attempt}/12)...`);
    await new Promise(res => setTimeout(res, 5000));
  }
  return false;
}

// ── Runner wrapper ────────────────────────────────────────────

async function step(name: string, fn: () => Promise<void>): Promise<StepResult> {
  const t0 = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - t0;
    console.log(`\n  ✔ ${name} finished in ${(durationMs / 1000).toFixed(1)}s\n`);
    return { name, status: 'pass', durationMs };
  } catch (err: unknown) {
    const durationMs = Date.now() - t0;
    const message = (err as Error).message ?? String(err);
    console.error(`\n  ✗ ${name} FAILED: ${message}\n`);
    return { name, status: 'fail', durationMs, error: message };
  }
}

// ── Summary report ────────────────────────────────────────────

function writeSummary(steps: StepResult[], totalMs: number): void {
  const ts  = new Date().toISOString();
  const pass = steps.filter(s => s.status === 'pass').length;
  const fail = steps.filter(s => s.status === 'fail').length;

  const rows = steps.map(s => {
    const dur  = (s.durationMs / 1000).toFixed(1) + 's';
    const icon = s.status === 'pass' ? '✓' : s.status === 'skip' ? '—' : '✗';
    const err  = s.error ? ` — _${s.error.slice(0, 80)}_` : '';
    return `| ${icon} ${s.name} | ${s.status} | ${dur} |${err}`;
  });

  // Collect output files that exist
  const artifacts = fs.readdirSync(RESULTS)
    .filter(f => f !== 'summary_report.md')
    .map(f => `- [${f}](${f})`).join('\n');

  const md = [
    `# LifeDB Research Experiment Suite — Results`,
    `_Generated: ${ts}_\n`,
    '## Run Summary',
    `| Step | Status | Duration |`,
    `|------|--------|----------|`,
    ...rows,
    '',
    `**Total: ${pass} passed, ${fail} failed — wall time ${(totalMs / 1000).toFixed(1)}s**`,
    '\n## Output Files',
    artifacts,
    '\n## System Configuration',
    '| Parameter | Value |',
    '|-----------|-------|',
    `| MongoDB | ${process.env['MONGODB_URI']?.split('@').pop() ?? 'localhost:27017'} |`,
    `| MinIO   | ${process.env['MINIO_ENDPOINT'] ?? 'localhost:9000'} |`,
    `| Rate limit | ${process.env['RATE_LIMIT_MAX'] ?? '200'} req/min |`,
    `| Node.js | ${process.version} |`,
    `| Timestamp | ${ts} |`,
  ].join('\n');

  const outPath = path.join(RESULTS, 'summary_report.md');
  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`\n  → summary_report.md`);
}

// ── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const bar = '═'.repeat(60);
  console.log(`\n${bar}`);
  console.log('  LifeDB Research Experiment Suite');
  console.log(`${bar}\n`);

  // 1. Health check
  const healthy = await checkHealth();
  if (!healthy) {
    console.error('  ✗ Server not reachable on http://localhost:3000 — aborting.');
    process.exit(1);
  }

  const t0    = Date.now();
  const steps: StepResult[] = [];

  // 2. Baselines first (no server dependency for A/B/C; gives Exp1 a comparison point)
  steps.push(await step('Baselines A·B·C', runBaselines));

  // 3. Experiments
  steps.push(await step('Experiment 1 — Performance',          runExp1));
  steps.push(await step('Experiment 2 — Blockchain Integrity', runExp2));
  steps.push(await step('Experiment 3 — Governance Agents',    runExp3));
  steps.push(await step('Experiment 4 — Storage Efficiency',   runExp4));
  steps.push(await step('Experiment 5 — RBAC Correctness',     runExp5));

  const totalMs = Date.now() - t0;

  // 4. Summary
  console.log(`\n${bar}`);
  console.log('  Writing summary report...');
  writeSummary(steps, totalMs);

  const pass = steps.filter(s => s.status === 'pass').length;
  const fail = steps.filter(s => s.status === 'fail').length;
  console.log(`\n  DONE — ${pass} passed, ${fail} failed — ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`  Results saved to: ${RESULTS}`);
  console.log(`${bar}\n`);

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
