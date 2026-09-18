require('dotenv/config');
require('ts-node/register');

// ─────────────────────────────────────────────────────────────
// benchmark-index-overhead.js
// EXP-8.1  MongoDB index maintenance write overhead at multiple scales
// EXP-8.2  MongoDB explain() output for each query class
// ─────────────────────────────────────────────────────────────

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { v4: uuidv4 } = require('uuid');

const { connectMongo, disconnectMongo } = require('../src/storage/document-store.ts');

const ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(ROOT, 'Results', 'paper_assets');
const OUTPUT_JSON = path.join(RESULTS_DIR, 'index_overhead.json');
const OUTPUT_MD = path.join(RESULTS_DIR, 'index_overhead.md');
const OUTPUT_CSV = path.join(RESULTS_DIR, 'index_overhead.csv');

// ── Config ────────────────────────────────────────────────────
const N_DEFAULT = Number(process.env.INDEX_OVERHEAD_N || '5000');
const SCALES = (process.env.INDEX_OVERHEAD_SCALES || '5000,20000,50000')
  .split(',')
  .map((v) => Number(v.trim()))
  .filter((v) => Number.isFinite(v) && v > 0);

// Benchmark collection name (separate from live data)
const BENCH_COLLECTION = 'shipments_index_bench';
// Live collection used for EXP-8.2 explain()
const LIVE_COLLECTION = 'shipments';

// The 6 standard shipment search indexes (matches paper Table 8 / supplychain-crud.ts)
const STANDARD_INDEXES = [
  { key: { sku: 1 } },
  { key: { batchNumber: 1 } },
  { key: { 'currentLocation.facilityId': 1 } },
  { key: { status: 1 } },
  { key: { actorType: 1 } },               // used in supply_chain_actors; mirrored on shipments for actor queries
  { key: { _createdAt: -1 } },             // time-range scan index
];

// ── Helpers ───────────────────────────────────────────────────

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function fmt(v, d = 2) {
  return Number(v).toFixed(d);
}

function toCsv(rows) {
  return rows.map((row) => row.map((v) => {
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  }).join(',')).join('\n');
}

/** Population stddev */
function stddev(values, mean) {
  if (values.length < 2) return 0;
  const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

/** Generate a minimal but realistic shipment document for the bench collection. */
function makeShipmentDoc(i, tag) {
  const statuses = ['CREATED', 'IN_TRANSIT', 'IN_STORAGE', 'RECEIVED', 'DELIVERED'];
  const actorTypes = ['MANUFACTURER', 'DISTRIBUTOR', 'PHARMACY', 'HOSPITAL', 'REGULATOR'];
  return {
    _id: uuidv4(),
    shipmentId: `bench-${tag}-${i}-${crypto.randomBytes(4).toString('hex')}`,
    trackingNumber: `TRK-${tag}-${i}`,
    productId: `PROD-BENCH-${(i % 10) + 1}`,
    sku: `SKU-BENCH-${(i % 20) + 1}`,
    batchNumber: `BATCH-${tag}-${Math.floor(i / 10)}`,
    quantity: (i % 100) + 1,
    unitOfMeasure: 'UNIT',
    status: statuses[i % statuses.length],
    actorType: actorTypes[i % actorTypes.length],
    origin: {
      facilityId: `FAC-ORIG-${(i % 5) + 1}`,
      facilityName: `Origin Facility ${(i % 5) + 1}`,
      facilityType: 'MANUFACTURER',
    },
    currentLocation: {
      facilityId: `FAC-CURR-${(i % 8) + 1}`,
      facilityName: `Current Facility ${(i % 8) + 1}`,
      facilityType: 'WAREHOUSE',
    },
    manufacturerId: `MFR-${(i % 5) + 1}`,
    transportMode: 'GROUND',
    _version: 1,
    _contentHash: crypto.randomBytes(8).toString('hex'),
    _isDeleted: false,
    _createdAt: new Date(Date.now() - i * 60000),
    _updatedAt: new Date(),
    _deletedAt: null,
  };
}

// ── EXP-8.1: Write overhead measurement ──────────────────────

async function measureWriteLatencies(collection, docs) {
  const latencies = [];
  for (const doc of docs) {
    const t0 = performance.now();
    await collection.insertOne(doc);
    latencies.push(performance.now() - t0);
  }
  return latencies;
}

async function runExp81(db) {
  const scaleResults = [];

  for (const n of SCALES) {
    console.log(`  EXP-8.1: scale N=${n}`);
    const coll = db.collection(BENCH_COLLECTION);

    // ── Round 1: WITH indexes ──
    // Reset collection
    await coll.drop().catch(() => undefined);

    // Create all 6 standard indexes
    for (const idx of STANDARD_INDEXES) {
      await coll.createIndex(idx.key);
    }

    const docsWithIndexes = Array.from({ length: n }, (_, i) => makeShipmentDoc(i, 'wi'));
    const latenciesWithIndexes = await measureWriteLatencies(coll, docsWithIndexes);
    const withMean = latenciesWithIndexes.reduce((s, v) => s + v, 0) / latenciesWithIndexes.length;
    const withSd = stddev(latenciesWithIndexes, withMean);
    console.log(`    WITH indexes: mean=${fmt(withMean)} ms  sd=${fmt(withSd)} ms`);

    // ── Round 2: WITHOUT indexes ──
    await coll.drop().catch(() => undefined);
    // No explicit indexes; only _id is auto-created by MongoDB

    const docsNoIndexes = Array.from({ length: n }, (_, i) => makeShipmentDoc(i, 'ni'));
    const latenciesNoIndexes = await measureWriteLatencies(coll, docsNoIndexes);
    const noMean = latenciesNoIndexes.reduce((s, v) => s + v, 0) / latenciesNoIndexes.length;
    const noSd = stddev(latenciesNoIndexes, noMean);
    console.log(`    WITHOUT indexes: mean=${fmt(noMean)} ms  sd=${fmt(noSd)} ms`);

    const overheadPct = noMean > 0 ? ((withMean / noMean) - 1) * 100 : 0;
    console.log(`    Overhead: ${fmt(overheadPct, 2)}%`);

    scaleResults.push({
      n,
      withIndexesMeanMs: withMean,
      withIndexesStddev: withSd,
      noIndexesMeanMs: noMean,
      noIndexesStddev: noSd,
      overheadPct,
    });

    // Clean up bench collection after each scale
    await coll.drop().catch(() => undefined);
  }

  return { scales: scaleResults };
}

// ── EXP-8.2: explain() for each query class ──────────────────

async function runExp82(db) {
  const coll = db.collection(LIVE_COLLECTION);

  // If collection is empty, seed 1000 docs so explain() has real stats
  const existingCount = await coll.countDocuments();
  let seeded = false;
  if (existingCount === 0) {
    console.log('  EXP-8.2: live collection empty — seeding 1000 test shipments');
    const seedDocs = Array.from({ length: 1000 }, (_, i) => makeShipmentDoc(i, 'exp82'));
    await coll.insertMany(seedDocs);
    seeded = true;
  } else {
    console.log(`  EXP-8.2: using ${existingCount} existing documents in '${LIVE_COLLECTION}'`);
  }

  // Query classes that map to the indexed fields
  const queryClasses = [
    {
      queryType: 'SKU',
      filter: { sku: 'SKU-BENCH-1', _isDeleted: false },
    },
    {
      queryType: 'Batch',
      filter: { batchNumber: 'BATCH-exp82-0', _isDeleted: false },
    },
    {
      queryType: 'Facility',
      filter: { 'currentLocation.facilityId': 'FAC-CURR-1', _isDeleted: false },
    },
    {
      queryType: 'Status',
      filter: { status: 'IN_TRANSIT', _isDeleted: false },
    },
    {
      queryType: 'ActorType',
      filter: { actorType: 'DISTRIBUTOR', _isDeleted: false },
    },
  ];

  const queryPlans = [];
  for (const qc of queryClasses) {
    let explainResult;
    try {
      explainResult = await coll.find(qc.filter).explain('executionStats');
    } catch (err) {
      console.warn(`    explain() failed for ${qc.queryType}:`, err.message);
      queryPlans.push({
        queryType: qc.queryType,
        filter: JSON.stringify(qc.filter),
        stage: 'ERROR',
        keysExamined: 0,
        docsExamined: 0,
        executionTimeMs: 0,
        nReturned: 0,
        error: err.message,
      });
      continue;
    }

    const stats = explainResult.executionStats || {};
    const winningPlan = explainResult.queryPlanner?.winningPlan || {};

    // Find the input stage (may be nested)
    function findStage(plan) {
      if (!plan) return 'UNKNOWN';
      if (plan.stage) return plan.stage;
      if (plan.inputStage) return findStage(plan.inputStage);
      return 'UNKNOWN';
    }

    const stage = findStage(winningPlan.inputStage || winningPlan);
    const keysExamined = stats.totalKeysExamined || 0;
    const docsExamined = stats.totalDocsExamined || 0;
    const executionTimeMs = stats.executionTimeMillis || 0;
    const nReturned = stats.nReturned || 0;

    console.log(
      `    ${qc.queryType.padEnd(12)} stage=${stage.padEnd(10)} keys=${keysExamined}  docs=${docsExamined}  time=${executionTimeMs}ms  returned=${nReturned}`,
    );

    queryPlans.push({
      queryType: qc.queryType,
      filter: JSON.stringify(qc.filter),
      stage,
      keysExamined,
      docsExamined,
      executionTimeMs,
      nReturned,
    });
  }

  return { queryPlans, seeded };
}

// ── Output writers ────────────────────────────────────────────

function writeMarkdown(output) {
  const { exp81, exp82 } = output;
  const lines = [
    '# EXP-8: MongoDB Index Overhead and Query Plan Analysis',
    '',
    `Generated: ${output.generatedAt}`,
    '',
    '## EXP-8.1: Index Maintenance Write Overhead',
    '',
    '| N (docs) | With Indexes Mean (ms) | With Indexes Stddev | Without Indexes Mean (ms) | Without Indexes Stddev | Overhead (%) |',
    '|---:|---:|---:|---:|---:|---:|',
  ];

  for (const s of exp81.scales) {
    lines.push(
      `| ${s.n} | ${fmt(s.withIndexesMeanMs, 4)} | ${fmt(s.withIndexesStddev, 4)} | ${fmt(s.noIndexesMeanMs, 4)} | ${fmt(s.noIndexesStddev, 4)} | ${fmt(s.overheadPct, 2)}% |`,
    );
  }

  lines.push(
    '',
    '> Overhead = (mean_with_indexes / mean_without_indexes − 1) × 100%',
    '',
    '## EXP-8.2: MongoDB explain() — Query Execution Plans',
    '',
  );

  if (exp82.seeded) {
    lines.push('> *Collection was empty; 1000 test documents were seeded for this experiment.*', '');
  }

  lines.push(
    '| Query Type | Stage | Keys Examined | Docs Examined | Exec Time (ms) | N Returned |',
    '|:---|:---|---:|---:|---:|---:|',
  );

  for (const qp of exp82.queryPlans) {
    lines.push(
      `| ${qp.queryType} | \`${qp.stage}\` | ${qp.keysExamined} | ${qp.docsExamined} | ${qp.executionTimeMs} | ${qp.nReturned} |`,
    );
  }

  lines.push(
    '',
    '> IXSCAN = index scan (efficient); COLLSCAN = collection scan (no index hit).',
  );

  return lines.join('\n');
}

function writeCsv(output) {
  const { exp81, exp82 } = output;

  const rows81 = [
    ['exp', 'n', 'with_indexes_mean_ms', 'with_indexes_stddev_ms', 'no_indexes_mean_ms', 'no_indexes_stddev_ms', 'overhead_pct'],
    ...exp81.scales.map((s) => [
      'EXP-8.1',
      s.n,
      fmt(s.withIndexesMeanMs, 6),
      fmt(s.withIndexesStddev, 6),
      fmt(s.noIndexesMeanMs, 6),
      fmt(s.noIndexesStddev, 6),
      fmt(s.overheadPct, 4),
    ]),
  ];

  const rows82 = [
    ['exp', 'query_type', 'stage', 'keys_examined', 'docs_examined', 'execution_time_ms', 'n_returned'],
    ...exp82.queryPlans.map((qp) => [
      'EXP-8.2',
      qp.queryType,
      qp.stage,
      qp.keysExamined,
      qp.docsExamined,
      qp.executionTimeMs,
      qp.nReturned,
    ]),
  ];

  return toCsv(rows81) + '\n\n' + toCsv(rows82);
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  ensureDir(RESULTS_DIR);

  console.log('Connecting to MongoDB...');
  const db = await connectMongo();

  console.log('\n=== EXP-8.1: Index maintenance write overhead ===');
  const exp81 = await runExp81(db);

  console.log('\n=== EXP-8.2: explain() for each query class ===');
  const exp82 = await runExp82(db);

  const output = {
    generatedAt: new Date().toISOString(),
    config: {
      scales: SCALES,
      benchCollection: BENCH_COLLECTION,
      liveCollection: LIVE_COLLECTION,
      standardIndexes: STANDARD_INDEXES.map((idx) => JSON.stringify(idx.key)),
    },
    exp81,
    exp82,
  };

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), 'utf8');
  fs.writeFileSync(OUTPUT_MD, writeMarkdown(output), 'utf8');
  fs.writeFileSync(OUTPUT_CSV, writeCsv(output), 'utf8');

  await disconnectMongo();
  console.log(`\nIndex overhead results written to ${OUTPUT_JSON}`);
}

main().catch((err) => {
  console.error('benchmark-index-overhead failed:', err);
  process.exitCode = 1;
});
