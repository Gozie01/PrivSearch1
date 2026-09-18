require('dotenv/config');
require('ts-node/register');

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { performance } = require('perf_hooks');

const { MerkleTree, computeBlockHash } = require('../src/blockchain/block.ts');
const { LifeDBChain } = require('../src/blockchain/chain.ts');
const { ValidatorRegistry } = require('../src/blockchain/validator.ts');
const { connectMongo, disconnectMongo } = require('../src/storage/document-store.ts');
const { SupplyChainCRUD } = require('../src/crud/supplychain-crud.ts');
const { generateSupplyChainTestData } = require('../src/utils/supplychain-test-data.ts');
const { timedReq } = require('./experiments/lib.ts');

const ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(ROOT, 'Results', 'paper_assets');
const OUTPUT_JSON = path.join(RESULTS_DIR, 'security_fuzzing.json');
const OUTPUT_MD = path.join(RESULTS_DIR, 'security_fuzzing.md');
const OUTPUT_CSV = path.join(RESULTS_DIR, 'security_fuzzing.csv');

const CHAIN_PATH = path.resolve(
  ROOT,
  process.env.SEC_CHAIN_PATH || process.env.BLOCKCHAIN_PERSIST_PATH || path.join('data', 'chain.json'),
);

const N_CHAIN_TAMPER = Number(process.env.SEC_N_CHAIN_TAMPER || '1000');
const N_MONGO_TAMPER = Number(process.env.SEC_N_MONGO_TAMPER || '500');
const N_REPLAY = Number(process.env.SEC_N_REPLAY || '200');
const N_MERKLE_TREES = Number(process.env.SEC_N_MERKLE_TREES || '100');
const N_MERKLE_PROOFS_PER_TREE = Number(process.env.SEC_N_MERKLE_PROOFS_PER_TREE || '10');

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function fmt(value, digits = 4) {
  return Number(value).toFixed(digits);
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

function summarize(values) {
  if (!values.length) {
    return { count: 0, mean: 0, p50: 0, p95: 0, min: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    mean: values.reduce((sum, v) => sum + v, 0) / values.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

/**
 * Wilson 95% confidence interval for a proportion.
 * Returns { lo, hi } clamped to [0, 1].
 */
function ci95(p, n) {
  if (n === 0) return { lo: 0, hi: 0 };
  const z = 1.96;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const margin = (z / (1 + (z * z) / n)) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return {
    lo: Math.max(0, centre - margin),
    hi: Math.min(1, centre + margin),
  };
}

/**
 * Flip the first hex character of a hash string to produce a deterministically
 * corrupted value.  Wraps 0â†’f so the result is always a different valid hex string.
 */
function corruptHex(hexStr) {
  if (!hexStr || hexStr.length === 0) return hexStr;
  const first = hexStr.charCodeAt(0);
  // Rotate within [0-9a-f]: increment by 1, wrap within the set
  const hexChars = '0123456789abcdef';
  const idx = hexChars.indexOf(hexStr[0].toLowerCase());
  const newChar = hexChars[(idx + 1) % 16];
  return newChar + hexStr.slice(1);
}

function issueToken() {
  return jwt.sign(
    { sub: 'did:key:zsecurityfuzzing', role: 'SUPER_ADMIN', sessionId: crypto.randomUUID() },
    process.env.JWT_SECRET,
    { expiresIn: '8h', algorithm: 'HS256' },
  );
}

// â”€â”€ EXP-4.1a: Audit Chain Tampering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function runAuditChainTamper() {
  console.log('[EXP-4.1a] Starting audit chain tamper experiment â€¦');

  if (!fs.existsSync(CHAIN_PATH)) {
    return { skipped: true, reason: 'chain.json not found at ' + CHAIN_PATH };
  }

  let rawChain;
  try {
    rawChain = JSON.parse(fs.readFileSync(CHAIN_PATH, 'utf8'));
  } catch (err) {
    return { skipped: true, reason: 'Failed to parse chain.json: ' + err.message };
  }

  if (!Array.isArray(rawChain) || rawChain.length < 2) {
    return {
      skipped: true,
      reason: `chain.json has ${Array.isArray(rawChain) ? rawChain.length : 0} block(s); need â‰¥ 2 (genesis + 1)`,
    };
  }

  const nonGenesisCount = rawChain.length - 1; // blocks with index >= 1

  // â”€â”€ Sub-experiment: blockHash corruption â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let blockHashDetections = 0;
  const blockHashTimes = [];

  for (let trial = 0; trial < N_CHAIN_TAMPER; trial++) {
    // Pick a random non-genesis block
    const targetIdx = 1 + (trial % nonGenesisCount);
    const cloned = rawChain.map((b) => ({ ...b }));
    cloned[targetIdx] = {
      ...cloned[targetIdx],
      blockHash: corruptHex(cloned[targetIdx].blockHash),
    };

    const t0 = performance.now();
    // Validate manually: walk the chain and check hash linkage + recompute
    let detected = false;
    for (let i = 1; i < cloned.length; i++) {
      const curr = cloned[i];
      const prev = cloned[i - 1];
      // Hash linkage check
      if (curr.previousBlockHash !== prev.blockHash) {
        detected = true;
        break;
      }
      // Block hash integrity check
      const expected = computeBlockHash({
        index: curr.index,
        previousBlockHash: curr.previousBlockHash,
        merkleRoot: curr.merkleRoot,
        transactions: curr.transactions,
        timestamp: curr.timestamp,
        validatorSignatures: curr.validatorSignatures,
      });
      if (curr.blockHash !== expected) {
        detected = true;
        break;
      }
    }
    blockHashTimes.push(performance.now() - t0);
    if (detected) blockHashDetections++;
  }

  // â”€â”€ Sub-experiment: merkleRoot field tampering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let merkleRootDetections = 0;
  const merkleRootTimes = [];

  for (let trial = 0; trial < N_CHAIN_TAMPER; trial++) {
    const targetIdx = 1 + (trial % nonGenesisCount);
    const cloned = rawChain.map((b) => ({ ...b }));
    cloned[targetIdx] = {
      ...cloned[targetIdx],
      merkleRoot: corruptHex(cloned[targetIdx].merkleRoot),
    };

    const t0 = performance.now();
    let detected = false;
    for (let i = 1; i < cloned.length; i++) {
      const curr = cloned[i];
      const prev = cloned[i - 1];
      if (curr.previousBlockHash !== prev.blockHash) {
        detected = true;
        break;
      }
      // Re-derive block hash â€” merkleRoot is included in computeBlockHash input
      const expected = computeBlockHash({
        index: curr.index,
        previousBlockHash: curr.previousBlockHash,
        merkleRoot: curr.merkleRoot,
        transactions: curr.transactions,
        timestamp: curr.timestamp,
        validatorSignatures: curr.validatorSignatures,
      });
      if (curr.blockHash !== expected) {
        detected = true;
        break;
      }
    }
    merkleRootTimes.push(performance.now() - t0);
    if (detected) merkleRootDetections++;
  }

  // â”€â”€ Sub-experiment: index field tampering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let indexDetections = 0;
  const indexTimes = [];

  for (let trial = 0; trial < N_CHAIN_TAMPER; trial++) {
    const targetIdx = 1 + (trial % nonGenesisCount);
    const cloned = rawChain.map((b) => ({ ...b }));
    // Shift the index by +100 â€” changes canonical JSON used by computeBlockHash
    cloned[targetIdx] = {
      ...cloned[targetIdx],
      index: cloned[targetIdx].index + 100,
    };

    const t0 = performance.now();
    let detected = false;
    for (let i = 1; i < cloned.length; i++) {
      const curr = cloned[i];
      const prev = cloned[i - 1];
      if (curr.previousBlockHash !== prev.blockHash) {
        detected = true;
        break;
      }
      const expected = computeBlockHash({
        index: curr.index,
        previousBlockHash: curr.previousBlockHash,
        merkleRoot: curr.merkleRoot,
        transactions: curr.transactions,
        timestamp: curr.timestamp,
        validatorSignatures: curr.validatorSignatures,
      });
      if (curr.blockHash !== expected) {
        detected = true;
        break;
      }
    }
    indexTimes.push(performance.now() - t0);
    if (detected) indexDetections++;
  }

  const blockHashRate = blockHashDetections / N_CHAIN_TAMPER;
  const merkleRootRate = merkleRootDetections / N_CHAIN_TAMPER;
  const indexRate = indexDetections / N_CHAIN_TAMPER;
  const blockHashCI = ci95(blockHashRate, N_CHAIN_TAMPER);
  const merkleRootCI = ci95(merkleRootRate, N_CHAIN_TAMPER);
  const indexCI = ci95(indexRate, N_CHAIN_TAMPER);
  const blockHashStats = summarize(blockHashTimes);
  const merkleRootStats = summarize(merkleRootTimes);
  const indexStats = summarize(indexTimes);

  console.log(
    `[EXP-4.1a] blockHash tamper detection: ${(blockHashRate * 100).toFixed(2)}% | merkleRoot: ${(merkleRootRate * 100).toFixed(2)}% | index: ${(indexRate * 100).toFixed(2)}%`,
  );

  return {
    skipped: false,
    chainBlocks: rawChain.length,
    n: N_CHAIN_TAMPER,
    blockHashTamper: {
      n: N_CHAIN_TAMPER,
      detections: blockHashDetections,
      detectionRate: blockHashRate,
      detectionCI95lo: blockHashCI.lo,
      detectionCI95hi: blockHashCI.hi,
      meanDetectionTimeMs: blockHashStats.mean,
      p95DetectionTimeMs: blockHashStats.p95,
    },
    merkleRootTamper: {
      n: N_CHAIN_TAMPER,
      detections: merkleRootDetections,
      detectionRate: merkleRootRate,
      detectionCI95lo: merkleRootCI.lo,
      detectionCI95hi: merkleRootCI.hi,
      meanDetectionTimeMs: merkleRootStats.mean,
      p95DetectionTimeMs: merkleRootStats.p95,
    },
    indexTamper: {
      n: N_CHAIN_TAMPER,
      detections: indexDetections,
      detectionRate: indexRate,
      detectionCI95lo: indexCI.lo,
      detectionCI95hi: indexCI.hi,
      meanDetectionTimeMs: indexStats.mean,
      p95DetectionTimeMs: indexStats.p95,
    },
    // Aggregate (combined over all three sub-experiments for summary table)
    detectionRate:
      (blockHashDetections + merkleRootDetections + indexDetections) / (3 * N_CHAIN_TAMPER),
    detectionCI95lo: ci95(
      (blockHashDetections + merkleRootDetections + indexDetections) / (3 * N_CHAIN_TAMPER),
      3 * N_CHAIN_TAMPER,
    ).lo,
    detectionCI95hi: ci95(
      (blockHashDetections + merkleRootDetections + indexDetections) / (3 * N_CHAIN_TAMPER),
      3 * N_CHAIN_TAMPER,
    ).hi,
    meanDetectionTimeMs:
      (blockHashStats.mean + merkleRootStats.mean + indexStats.mean) / 3,
    p95DetectionTimeMs: Math.max(
      blockHashStats.p95,
      merkleRootStats.p95,
      indexStats.p95,
    ),
  };
}

// â”€â”€ EXP-4.1b: MongoDB Record Tampering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function runMongoTamper(db) {
  console.log('[EXP-4.1b] Starting MongoDB record tamper experiment â€¦');

  const crud = new SupplyChainCRUD(db);
  await crud.initializeCollections({ ensureIndexes: false });

  const benchmarkTag = `sec-fuzzing-tamper-${Date.now()}`;
  const collection = db.collection('shipments');

  // Generate test data
  const generated = generateSupplyChainTestData({
    medicalsShipments: Math.ceil(N_MONGO_TAMPER / 2),
    militaryShipments: Math.floor(N_MONGO_TAMPER / 2),
    eventsPerShipment: 0,
    includeTemperatureLogs: false,
    includeInspections: false,
  });

  const shipments = generated.shipments.slice(0, N_MONGO_TAMPER).map((s, i) => ({
    ...s,
    _id: crypto.randomUUID(),
    shipmentId: `${s.shipmentId}-${benchmarkTag}-${i}`,
    trackingNumber: `${s.trackingNumber}-${benchmarkTag}-${i}`,
    metadata: {
      ...(s.metadata || {}),
      benchmarkTag,
      benchmarkOrdinal: i,
    },
  }));

  // Bulk insert
  const inserted = [];
  for (const shipment of shipments) {
    try {
      const created = await crud.createShipment({
        shipmentId: shipment.shipmentId,
        trackingNumber: shipment.trackingNumber,
        productId: shipment.productId,
        sku: shipment.sku,
        batchNumber: shipment.batchNumber,
        quantity: shipment.quantity,
        unitOfMeasure: shipment.unitOfMeasure,
        origin: shipment.origin,
        originDepartureTime: shipment.originDepartureTime,
        status: shipment.status,
        currentLocation: shipment.currentLocation,
        lastLocationUpdate: shipment.lastLocationUpdate,
        destination: shipment.destination,
        manufacturerId: shipment.manufacturerId,
        carrierName: shipment.carrierName,
        transportMode: shipment.transportMode,
        requiresInspection: shipment.requiresInspection,
        certifications: shipment.certifications,
        tags: shipment.tags,
        metadata: shipment.metadata,
      });
      inserted.push(created);
    } catch {
      // Skip duplicates if any
    }
  }

  console.log(`[EXP-4.1b] Inserted ${inserted.length} shipments; now running tamper trials â€¦`);

  let detections = 0;
  const times = [];

  for (const shipment of inserted) {
    const t0 = performance.now();

    // Read stored _contentHash
    const stored = await collection.findOne({ _id: shipment._id });
    if (!stored) {
      times.push(performance.now() - t0);
      continue;
    }
    const storedHash = stored._contentHash;

    // Directly mutate sku in MongoDB, bypassing the CRUD API
    const tamperedSku = (stored.sku || 'TAMPERED') + '-TAMPERED';
    await collection.updateOne(
      { _id: shipment._id },
      { $set: { sku: tamperedSku } },
    );

    // Re-read and recompute hash over the tampered document
    const tampered = await collection.findOne({ _id: shipment._id });
    if (!tampered) {
      times.push(performance.now() - t0);
      continue;
    }

    // Replicate the contentHash logic from DocumentStore:
    // exclude _id, _contentHash, _createdAt, _updatedAt, _version
    const { _id, _contentHash, _createdAt, _updatedAt, _version, ...body } = tampered;
    const recomputedHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(body), 'utf8')
      .digest('hex');

    const elapsed = performance.now() - t0;
    times.push(elapsed);

    if (recomputedHash !== storedHash) {
      detections++;
    }
  }

  // Cleanup
  try {
    await collection.deleteMany({ 'metadata.benchmarkTag': benchmarkTag });
  } catch {
    // Best-effort cleanup
  }

  const n = inserted.length;
  const detectionRate = n > 0 ? detections / n : 0;
  const { lo, hi } = ci95(detectionRate, n);
  const stats = summarize(times);

  console.log(`[EXP-4.1b] Tamper detections: ${detections}/${n} (${(detectionRate * 100).toFixed(2)}%)`);

  return {
    skipped: false,
    n,
    detections,
    detectionRate,
    detectionCI95lo: lo,
    detectionCI95hi: hi,
    meanDetectionTimeMs: stats.mean,
    p95DetectionTimeMs: stats.p95,
  };
}

// â”€â”€ EXP-4.2: Replay Attack Detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


async function runReplayAttack(db) {
  console.log('[EXP-4.2] Starting replay attack detection experiment Ã¢â‚¬Â¦');

  const benchmarkTag = `sec-fuzzing-replay-${Date.now()}`;
  const collection = db.collection('supply_chain_events');
  const token = issueToken();

  let rejections = 0;
  const rejectionTimes = [];

  for (let i = 0; i < N_REPLAY; i++) {
    const shipmentId = `replay-ship-${benchmarkTag}-${i}`;
    const eventId = crypto.randomUUID();
    const eventTimestamp = new Date().toISOString();

    const baseEvent = {
      eventId,
      shipmentId,
      eventType: 'CUSTODY_TRANSFER',
      eventTimestamp,
      actorId: `ACT-REPLAY-${i}`,
      actorRole: 'RECEIVING_CLERK',
      locationId: 'FAC-REPLAY',
      details: { fromActor: 'ACT-A', toActor: 'ACT-B', trial: i },
      signatureHash: '0x' + crypto.randomBytes(16).toString('hex'),
    };
    const headers = {
      'X-Request-Nonce': crypto.randomUUID(),
      'X-Request-Timestamp': String(Date.now()),
    };

    const first = await timedReq(
      'POST',
      '/api/supply-chain/events',
      baseEvent,
      token,
      headers,
      201,
    );
    if (first.status !== 201) {
      continue;
    }

    const t0 = performance.now();
    const replay = await timedReq(
      'POST',
      '/api/supply-chain/events',
      baseEvent,
      token,
      headers,
      409,
    );
    const elapsed = performance.now() - t0;
    rejectionTimes.push(elapsed);
    if (replay.status === 409) {
      rejections++;
    }
  }

  try {
    await collection.deleteMany({ shipmentId: { $regex: `replay-ship-${benchmarkTag}` } });
  } catch {
    // Best-effort cleanup
  }

  const n = rejectionTimes.length;
  const rejectionRate = n > 0 ? rejections / n : 0;
  const { lo, hi } = ci95(rejectionRate, n);
  const stats = summarize(rejectionTimes);

  console.log(`[EXP-4.2] Replay rejections: ${rejections}/${n} (${(rejectionRate * 100).toFixed(2)}%)`);

  return {
    skipped: false,
    n,
    rejections,
    detectionRate: rejectionRate,
    detectionCI95lo: lo,
    detectionCI95hi: hi,
    meanDetectionTimeMs: stats.mean,
    p95DetectionTimeMs: stats.p95,
  };
}

// â”€â”€ EXP-4.4: Merkle Proof Verification at Scale â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function runMerkleProof() {
  console.log('[EXP-4.4] Starting Merkle proof verification experiment â€¦');

  const validTimes = [];
  const corruptedTimes = [];
  let validSuccesses = 0;
  let corruptedRejections = 0;
  let totalValidProofs = 0;
  let totalCorruptedProofs = 0;

  for (let treeIdx = 0; treeIdx < N_MERKLE_TREES; treeIdx++) {
    // Generate 10â€“50 random leaves
    const leafCount = 10 + Math.floor(Math.random() * 41);
    const leaves = Array.from({ length: leafCount }, () =>
      crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex'),
    );

    const tree = new MerkleTree(leaves);
    const root = tree.getRoot();

    // â”€â”€ Valid proofs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    for (let p = 0; p < N_MERKLE_PROOFS_PER_TREE; p++) {
      const leafIdx = Math.floor(Math.random() * leaves.length);
      const leaf = leaves[leafIdx];
      const proof = tree.getProof(leaf);

      const t0 = performance.now();
      const valid = MerkleTree.verifyProof(leaf, proof, root);
      validTimes.push(performance.now() - t0);
      totalValidProofs++;
      if (valid) validSuccesses++;
    }

    // â”€â”€ Corrupted proofs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    for (let p = 0; p < N_MERKLE_PROOFS_PER_TREE; p++) {
      const leafIdx = Math.floor(Math.random() * leaves.length);
      const leaf = leaves[leafIdx];
      const proof = tree.getProof(leaf);

      if (proof.length === 0) {
        // Single-leaf tree â€” flip the leaf itself
        const corruptedLeaf = corruptHex(leaf);
        const t0 = performance.now();
        const valid = MerkleTree.verifyProof(corruptedLeaf, proof, root);
        corruptedTimes.push(performance.now() - t0);
        totalCorruptedProofs++;
        if (!valid) corruptedRejections++;
      } else {
        // Flip one sibling hash in the proof path
        const corruptedProof = proof.map((step, idx) =>
          idx === 0
            ? { ...step, sibling: corruptHex(step.sibling) }
            : step,
        );
        const t0 = performance.now();
        const valid = MerkleTree.verifyProof(leaf, corruptedProof, root);
        corruptedTimes.push(performance.now() - t0);
        totalCorruptedProofs++;
        if (!valid) corruptedRejections++;
      }
    }
  }

  const validRate = totalValidProofs > 0 ? validSuccesses / totalValidProofs : 0;
  const corruptedRate = totalCorruptedProofs > 0 ? corruptedRejections / totalCorruptedProofs : 0;
  const validCI = ci95(validRate, totalValidProofs);
  const corruptedCI = ci95(corruptedRate, totalCorruptedProofs);
  const allTimes = [...validTimes, ...corruptedTimes];
  const overallStats = summarize(allTimes);
  const validStats = summarize(validTimes);
  const corruptedStats = summarize(corruptedTimes);

  console.log(
    `[EXP-4.4] Valid proofs: ${validSuccesses}/${totalValidProofs} (${(validRate * 100).toFixed(2)}%) | Corrupted rejected: ${corruptedRejections}/${totalCorruptedProofs} (${(corruptedRate * 100).toFixed(2)}%)`,
  );

  return {
    skipped: false,
    trees: N_MERKLE_TREES,
    proofsPerTree: N_MERKLE_PROOFS_PER_TREE,
    n: totalValidProofs + totalCorruptedProofs,
    validProofs: {
      n: totalValidProofs,
      successes: validSuccesses,
      successRate: validRate,
      successCI95lo: validCI.lo,
      successCI95hi: validCI.hi,
      meanTimeMs: validStats.mean,
      p95TimeMs: validStats.p95,
    },
    corruptedProofs: {
      n: totalCorruptedProofs,
      rejections: corruptedRejections,
      rejectionRate: corruptedRate,
      rejectionCI95lo: corruptedCI.lo,
      rejectionCI95hi: corruptedCI.hi,
      meanTimeMs: corruptedStats.mean,
      p95TimeMs: corruptedStats.p95,
    },
    // Summary fields for the common schema
    detectionRate: corruptedRate,
    detectionCI95lo: corruptedCI.lo,
    detectionCI95hi: corruptedCI.hi,
    meanDetectionTimeMs: overallStats.mean,
    p95DetectionTimeMs: overallStats.p95,
  };
}

// â”€â”€ Main â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function main() {
  ensureDir(RESULTS_DIR);

  const generatedAt = new Date().toISOString();
  const notes = [];
  const experiments = {};

  // â”€â”€ EXP-4.1a â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  try {
    experiments.auditChainTamper = await runAuditChainTamper();
    if (experiments.auditChainTamper.skipped) {
      notes.push(`EXP-4.1a skipped: ${experiments.auditChainTamper.reason}`);
    }
  } catch (err) {
    experiments.auditChainTamper = { skipped: true, reason: String(err.message) };
    notes.push(`EXP-4.1a error: ${err.message}`);
    console.error('[EXP-4.1a] Error:', err.message);
  }

  // â”€â”€ MongoDB experiments (EXP-4.1b + EXP-4.2) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let db = null;
  try {
    db = await connectMongo();
    console.log('[DB] Connected to MongoDB');
  } catch (err) {
    notes.push(`MongoDB connection failed â€” EXP-4.1b and EXP-4.2 skipped: ${err.message}`);
    console.warn('[DB] MongoDB unavailable:', err.message);
  }

  if (db) {
    // EXP-4.1b
    try {
      experiments.mongoTamper = await runMongoTamper(db);
    } catch (err) {
      experiments.mongoTamper = { skipped: true, reason: String(err.message) };
      notes.push(`EXP-4.1b error: ${err.message}`);
      console.error('[EXP-4.1b] Error:', err.message);
    }

    // EXP-4.2
    try {
      experiments.replayAttack = await runReplayAttack(db);
    } catch (err) {
      experiments.replayAttack = { skipped: true, reason: String(err.message) };
      notes.push(`EXP-4.2 error: ${err.message}`);
      console.error('[EXP-4.2] Error:', err.message);
    }

    try {
      await disconnectMongo();
    } catch {
      // Ignore disconnect errors
    }
  } else {
    experiments.mongoTamper = { skipped: true, reason: 'MongoDB not available' };
    experiments.replayAttack = { skipped: true, reason: 'MongoDB not available' };
  }

  // â”€â”€ EXP-4.4 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  try {
    experiments.merkleProof = await runMerkleProof();
  } catch (err) {
    experiments.merkleProof = { skipped: true, reason: String(err.message) };
    notes.push(`EXP-4.4 error: ${err.message}`);
    console.error('[EXP-4.4] Error:', err.message);
  }

  // â”€â”€ Write JSON â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const output = { generatedAt, notes, experiments };
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(output, null, 2), 'utf8');

  // â”€â”€ Write Markdown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const E = experiments;

  function pct(rate) {
    return rate != null ? `${(rate * 100).toFixed(2)}%` : 'n/a';
  }
  function ciStr(lo, hi) {
    return lo != null && hi != null
      ? `[${pct(lo)}, ${pct(hi)}]`
      : 'n/a';
  }

  const md = [
    '# Experiment EXP-4: Security Fuzzing Benchmark',
    '',
    `Generated: ${generatedAt}`,
    '',
    notes.length ? ['## Notes', '', ...notes.map((n) => `- ${n}`), ''].join('\n') : '',
    '## Summary Table',
    '',
    '| Experiment | N | Detection / Rejection Rate | 95% CI | Mean Time (ms) | P95 Time (ms) |',
    '|---|---:|---:|---|---:|---:|',
    E.auditChainTamper && !E.auditChainTamper.skipped
      ? `| EXP-4.1a blockHash tamper | ${E.auditChainTamper.blockHashTamper.n} | ${pct(E.auditChainTamper.blockHashTamper.detectionRate)} | ${ciStr(E.auditChainTamper.blockHashTamper.detectionCI95lo, E.auditChainTamper.blockHashTamper.detectionCI95hi)} | ${fmt(E.auditChainTamper.blockHashTamper.meanDetectionTimeMs)} | ${fmt(E.auditChainTamper.blockHashTamper.p95DetectionTimeMs)} |`
      : `| EXP-4.1a blockHash tamper | â€” | skipped | â€” | â€” | â€” |`,
    E.auditChainTamper && !E.auditChainTamper.skipped
      ? `| EXP-4.1a merkleRoot tamper | ${E.auditChainTamper.merkleRootTamper.n} | ${pct(E.auditChainTamper.merkleRootTamper.detectionRate)} | ${ciStr(E.auditChainTamper.merkleRootTamper.detectionCI95lo, E.auditChainTamper.merkleRootTamper.detectionCI95hi)} | ${fmt(E.auditChainTamper.merkleRootTamper.meanDetectionTimeMs)} | ${fmt(E.auditChainTamper.merkleRootTamper.p95DetectionTimeMs)} |`
      : `| EXP-4.1a merkleRoot tamper | â€” | skipped | â€” | â€” | â€” |`,
    E.auditChainTamper && !E.auditChainTamper.skipped
      ? `| EXP-4.1a index tamper | ${E.auditChainTamper.indexTamper.n} | ${pct(E.auditChainTamper.indexTamper.detectionRate)} | ${ciStr(E.auditChainTamper.indexTamper.detectionCI95lo, E.auditChainTamper.indexTamper.detectionCI95hi)} | ${fmt(E.auditChainTamper.indexTamper.meanDetectionTimeMs)} | ${fmt(E.auditChainTamper.indexTamper.p95DetectionTimeMs)} |`
      : `| EXP-4.1a index tamper | â€” | skipped | â€” | â€” | â€” |`,
    E.mongoTamper && !E.mongoTamper.skipped
      ? `| EXP-4.1b MongoDB contentHash tamper | ${E.mongoTamper.n} | ${pct(E.mongoTamper.detectionRate)} | ${ciStr(E.mongoTamper.detectionCI95lo, E.mongoTamper.detectionCI95hi)} | ${fmt(E.mongoTamper.meanDetectionTimeMs)} | ${fmt(E.mongoTamper.p95DetectionTimeMs)} |`
      : `| EXP-4.1b MongoDB contentHash tamper | â€” | skipped | â€” | â€” | â€” |`,
    E.replayAttack && !E.replayAttack.skipped
      ? `| EXP-4.2 Replay attack rejection | ${E.replayAttack.n} | ${pct(E.replayAttack.detectionRate)} | ${ciStr(E.replayAttack.detectionCI95lo, E.replayAttack.detectionCI95hi)} | ${fmt(E.replayAttack.meanDetectionTimeMs)} | ${fmt(E.replayAttack.p95DetectionTimeMs)} |`
      : `| EXP-4.2 Replay attack rejection | â€” | skipped | â€” | â€” | â€” |`,
    E.merkleProof && !E.merkleProof.skipped
      ? `| EXP-4.4 Valid Merkle proofs | ${E.merkleProof.validProofs.n} | ${pct(E.merkleProof.validProofs.successRate)} | ${ciStr(E.merkleProof.validProofs.successCI95lo, E.merkleProof.validProofs.successCI95hi)} | ${fmt(E.merkleProof.validProofs.meanTimeMs)} | ${fmt(E.merkleProof.validProofs.p95TimeMs)} |`
      : `| EXP-4.4 Valid Merkle proofs | â€” | skipped | â€” | â€” | â€” |`,
    E.merkleProof && !E.merkleProof.skipped
      ? `| EXP-4.4 Corrupted proof rejection | ${E.merkleProof.corruptedProofs.n} | ${pct(E.merkleProof.corruptedProofs.rejectionRate)} | ${ciStr(E.merkleProof.corruptedProofs.rejectionCI95lo, E.merkleProof.corruptedProofs.rejectionCI95hi)} | ${fmt(E.merkleProof.corruptedProofs.meanTimeMs)} | ${fmt(E.merkleProof.corruptedProofs.p95TimeMs)} |`
      : `| EXP-4.4 Corrupted proof rejection | â€” | skipped | â€” | â€” | â€” |`,
    '',
    '## EXP-4.1a: Audit Chain Tampering',
    '',
    E.auditChainTamper && !E.auditChainTamper.skipped
      ? [
          `Chain blocks: ${E.auditChainTamper.chainBlocks} | Trials per sub-experiment: ${E.auditChainTamper.n}`,
          '',
          '| Sub-experiment | Detections | Rate | 95% CI |',
          '|---|---:|---:|---|',
          `| blockHash corruption | ${E.auditChainTamper.blockHashTamper.detections} | ${pct(E.auditChainTamper.blockHashTamper.detectionRate)} | ${ciStr(E.auditChainTamper.blockHashTamper.detectionCI95lo, E.auditChainTamper.blockHashTamper.detectionCI95hi)} |`,
          `| merkleRoot field tamper | ${E.auditChainTamper.merkleRootTamper.detections} | ${pct(E.auditChainTamper.merkleRootTamper.detectionRate)} | ${ciStr(E.auditChainTamper.merkleRootTamper.detectionCI95lo, E.auditChainTamper.merkleRootTamper.detectionCI95hi)} |`,
          `| index field tamper | ${E.auditChainTamper.indexTamper.detections} | ${pct(E.auditChainTamper.indexTamper.detectionRate)} | ${ciStr(E.auditChainTamper.indexTamper.detectionCI95lo, E.auditChainTamper.indexTamper.detectionCI95hi)} |`,
        ].join('\n')
      : `Skipped: ${E.auditChainTamper ? E.auditChainTamper.reason : 'unknown'}`,
    '',
    '## EXP-4.1b: MongoDB Record Tampering',
    '',
    E.mongoTamper && !E.mongoTamper.skipped
      ? [
          `N=${E.mongoTamper.n} | Detections: ${E.mongoTamper.detections} | Rate: ${pct(E.mongoTamper.detectionRate)}`,
          `95% CI: ${ciStr(E.mongoTamper.detectionCI95lo, E.mongoTamper.detectionCI95hi)}`,
          `Mean detection time: ${fmt(E.mongoTamper.meanDetectionTimeMs)} ms | P95: ${fmt(E.mongoTamper.p95DetectionTimeMs)} ms`,
        ].join('  \n')
      : `Skipped: ${E.mongoTamper ? E.mongoTamper.reason : 'unknown'}`,
    '',
    '## EXP-4.2: Replay Attack Detection',
    '',
    E.replayAttack && !E.replayAttack.skipped
      ? [
          `N=${E.replayAttack.n} | Rejections: ${E.replayAttack.rejections} | Rate: ${pct(E.replayAttack.detectionRate)}`,
          `95% CI: ${ciStr(E.replayAttack.detectionCI95lo, E.replayAttack.detectionCI95hi)}`,
          `Mean rejection time: ${fmt(E.replayAttack.meanDetectionTimeMs)} ms | P95: ${fmt(E.replayAttack.p95DetectionTimeMs)} ms`,
        ].join('  \n')
      : `Skipped: ${E.replayAttack ? E.replayAttack.reason : 'unknown'}`,
    '',
    '## EXP-4.4: Merkle Proof Verification at Scale',
    '',
    E.merkleProof && !E.merkleProof.skipped
      ? [
          `Trees: ${E.merkleProof.trees} | Proofs per tree: ${E.merkleProof.proofsPerTree}`,
          '',
          '| Type | N | Rate | 95% CI | Mean ms | P95 ms |',
          '|---|---:|---:|---|---:|---:|',
          `| Valid proofs (should pass) | ${E.merkleProof.validProofs.n} | ${pct(E.merkleProof.validProofs.successRate)} | ${ciStr(E.merkleProof.validProofs.successCI95lo, E.merkleProof.validProofs.successCI95hi)} | ${fmt(E.merkleProof.validProofs.meanTimeMs)} | ${fmt(E.merkleProof.validProofs.p95TimeMs)} |`,
          `| Corrupted proofs (should reject) | ${E.merkleProof.corruptedProofs.n} | ${pct(E.merkleProof.corruptedProofs.rejectionRate)} | ${ciStr(E.merkleProof.corruptedProofs.rejectionCI95lo, E.merkleProof.corruptedProofs.rejectionCI95hi)} | ${fmt(E.merkleProof.corruptedProofs.meanTimeMs)} | ${fmt(E.merkleProof.corruptedProofs.p95TimeMs)} |`,
        ].join('\n')
      : `Skipped: ${E.merkleProof ? E.merkleProof.reason : 'unknown'}`,
  ]
    .filter((line) => line !== '')
    .join('\n');

  fs.writeFileSync(OUTPUT_MD, md, 'utf8');

  // â”€â”€ Write CSV â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const csvRows = [
    [
      'experiment',
      'sub_experiment',
      'n',
      'detections_or_rejections',
      'detection_rate',
      'ci95_lo',
      'ci95_hi',
      'mean_detection_ms',
      'p95_detection_ms',
    ],
  ];

  function addRow(exp, sub, result, nOverride) {
    if (!result || result.skipped) {
      csvRows.push([exp, sub, 'skipped', '', '', '', '', '', '']);
      return;
    }
    const n = nOverride != null ? nOverride : result.n;
    csvRows.push([
      exp,
      sub,
      n,
      result.detections ?? result.rejections ?? result.successes ?? '',
      result.detectionRate != null ? result.detectionRate : result.rejectionRate ?? '',
      result.detectionCI95lo ?? result.rejectionCI95lo ?? '',
      result.detectionCI95hi ?? result.rejectionCI95hi ?? '',
      result.meanDetectionTimeMs ?? result.meanTimeMs ?? '',
      result.p95DetectionTimeMs ?? result.p95TimeMs ?? '',
    ]);
  }

  if (E.auditChainTamper && !E.auditChainTamper.skipped) {
    addRow('EXP-4.1a', 'blockHash_tamper', E.auditChainTamper.blockHashTamper, null);
    addRow('EXP-4.1a', 'merkleRoot_tamper', E.auditChainTamper.merkleRootTamper, null);
    addRow('EXP-4.1a', 'index_tamper', E.auditChainTamper.indexTamper, null);
  } else {
    addRow('EXP-4.1a', 'all', E.auditChainTamper, null);
  }

  addRow('EXP-4.1b', 'mongo_contentHash_tamper', E.mongoTamper, null);
  addRow('EXP-4.2', 'replay_rejection', E.replayAttack, null);

  if (E.merkleProof && !E.merkleProof.skipped) {
    csvRows.push([
      'EXP-4.4',
      'valid_proofs',
      E.merkleProof.validProofs.n,
      E.merkleProof.validProofs.successes,
      E.merkleProof.validProofs.successRate,
      E.merkleProof.validProofs.successCI95lo,
      E.merkleProof.validProofs.successCI95hi,
      E.merkleProof.validProofs.meanTimeMs,
      E.merkleProof.validProofs.p95TimeMs,
    ]);
    csvRows.push([
      'EXP-4.4',
      'corrupted_proof_rejection',
      E.merkleProof.corruptedProofs.n,
      E.merkleProof.corruptedProofs.rejections,
      E.merkleProof.corruptedProofs.rejectionRate,
      E.merkleProof.corruptedProofs.rejectionCI95lo,
      E.merkleProof.corruptedProofs.rejectionCI95hi,
      E.merkleProof.corruptedProofs.meanTimeMs,
      E.merkleProof.corruptedProofs.p95TimeMs,
    ]);
  } else {
    addRow('EXP-4.4', 'merkle_proof', E.merkleProof, null);
  }

  fs.writeFileSync(OUTPUT_CSV, toCsv(csvRows), 'utf8');

  console.log(`\nSecurity fuzzing benchmark complete.`);
  console.log(`  JSON  â†’ ${OUTPUT_JSON}`);
  console.log(`  MD    â†’ ${OUTPUT_MD}`);
  console.log(`  CSV   â†’ ${OUTPUT_CSV}`);
  if (notes.length) {
    console.log('\nNotes:');
    notes.forEach((n) => console.log('  ' + n));
  }
}

main().catch((err) => {
  console.error('Security fuzzing benchmark failed:', err);
  process.exitCode = 1;
});

