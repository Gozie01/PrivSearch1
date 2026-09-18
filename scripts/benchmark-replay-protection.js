require('dotenv/config');
require('ts-node/register');

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { timedReq, seedAndAuth, makePatient } = require('./experiments/lib.ts');

const ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(ROOT, 'Results', 'paper_assets');
const OUTPUT_JSON = path.join(RESULTS_DIR, 'privsearch_replay_protection.json');
const OUTPUT_MD = path.join(RESULTS_DIR, 'privsearch_replay_protection.md');
const OUTPUT_CSV = path.join(RESULTS_DIR, 'privsearch_replay_protection.csv');

const N = Number(process.env.PRIVSEARCH_REPLAY_TRIALS || '200');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function summarize(values) {
  if (!values.length) {
    return { count: 0, mean: 0, p50: 0, p95: 0, min: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value);
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(','),
    )
    .join('\n');
}

function makeReplayProtectedRecord(trialId) {
  return {
    ...makePatient(`did:key:zprivsearch-replay-patient-${trialId}`, 'did:key:zprivsearch-replay-doc'),
    metadata: {
      benchmark: 'privsearch_replay',
      trialId,
      nonceSalt: crypto.randomBytes(8).toString('hex'),
    },
  };
}

async function getReplayStatus(token) {
  const result = await timedReq('GET', '/api/audit/security/replay-status', undefined, token, {}, 200);
  return result.body;
}

async function main() {
  ensureDir(RESULTS_DIR);

  const { tokens } = await seedAndAuth(['SUPER_ADMIN']);
  const token = tokens.SUPER_ADMIN;
  if (!token) {
    throw new Error('Failed to acquire SUPER_ADMIN token for replay benchmark.');
  }

  const acceptedLatencies = [];
  const replayLatencies = [];
  let accepted = 0;
  let rejected = 0;
  let headerFailures = 0;

  for (let i = 0; i < N; i += 1) {
    const payload = {
      recordType: 'PATIENT',
      ...makeReplayProtectedRecord(i),
    };
    const headers = {
      'X-Request-Nonce': crypto.randomUUID(),
      'X-Request-Timestamp': String(Date.now()),
    };

    const first = await timedReq('POST', '/api/records', payload, token, headers, 201);
    if (first.status !== 201) {
      headerFailures += 1;
      continue;
    }

    accepted += 1;
    acceptedLatencies.push(first.latency);

    const second = await timedReq('POST', '/api/records', payload, token, headers, 409);
    replayLatencies.push(second.latency);
    if (second.status === 409) {
      rejected += 1;
    }
  }

  const acceptanceStats = summarize(acceptedLatencies);
  const replayStats = summarize(replayLatencies);
  const replayRejectionRate = replayLatencies.length ? rejected / replayLatencies.length : 0;
  const status = await getReplayStatus(token);

  const output = {
    generatedAt: new Date().toISOString(),
    config: {
      trials: N,
    },
    results: {
      attempted: N,
      accepted,
      rejected,
      headerFailures,
      replayRejectionRate,
      acceptedLatencyMs: acceptanceStats,
      replayLatencyMs: replayStats,
      acceptedLatencySamplesMs: acceptedLatencies,
      replayLatencySamplesMs: replayLatencies,
    },
    replayStatus: status,
  };

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), 'utf8');

  const md = [
    '# PrivSearch Replay Protection Benchmark',
    '',
    `Generated: ${output.generatedAt}`,
    '',
    `Trials: ${N}`,
    '',
    '| Metric | Value |',
    '|---|---:|',
    `| Accepted first requests | ${accepted} |`,
    `| Replayed requests rejected | ${rejected} |`,
    `| Header/setup failures | ${headerFailures} |`,
    `| Replay rejection rate | ${(replayRejectionRate * 100).toFixed(2)}% |`,
    `| Mean accepted latency (ms) | ${acceptanceStats.mean.toFixed(4)} |`,
    `| P95 accepted latency (ms) | ${acceptanceStats.p95.toFixed(4)} |`,
    `| Mean replay rejection latency (ms) | ${replayStats.mean.toFixed(4)} |`,
    `| P95 replay rejection latency (ms) | ${replayStats.p95.toFixed(4)} |`,
    '',
    'Replay status snapshot:',
    '',
    '```json',
    JSON.stringify(status, null, 2),
    '```',
  ].join('\n');
  fs.writeFileSync(OUTPUT_MD, md, 'utf8');

  fs.writeFileSync(OUTPUT_CSV, toCsv([
    ['attempted', 'accepted', 'rejected', 'header_failures', 'replay_rejection_rate', 'accepted_mean_ms', 'accepted_p95_ms', 'replay_mean_ms', 'replay_p95_ms'],
    [N, accepted, rejected, headerFailures, replayRejectionRate, acceptanceStats.mean, acceptanceStats.p95, replayStats.mean, replayStats.p95],
  ]), 'utf8');

  console.log(`Replay protection benchmark written to ${OUTPUT_JSON}`);
}

main().catch((error) => {
  console.error('Replay protection benchmark failed:', error);
  process.exitCode = 1;
});
