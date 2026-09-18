const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const readline = require('readline');
const {
  collectKeywords,
  loadKeywordPostings,
  intersectPostingLists,
} = require('../workload-lib');
const {
  buildSemanticTermWeights,
  rankSemanticCandidates,
} = require('../semantic-lib');

const AES_ALGORITHM = 'aes-256-gcm';
const AES_IV_BYTES = 12;
const AES_TAG_BYTES = 16;
// 2048-bit RSA accumulator modulus (product of two 1024-bit primes; factors discarded).
const ACCUMULATOR_MODULUS = 21619096241149106944198064176012845267474146912799435543840066799609824807872458451164932298732969327451665891370724119674704689602655616655183655863148660544426735184751056510303931724990717171890718395134776999605428156933577128331266626506454148707350768496797675823300858666984776263564910634201436738912649326839152652138901860445102767217958976509703955707411089458040495687821355184097773154587786097493354138273408398927586945579360474775419118904663850293880092848361645585097768459001594869314275648156708656378259072576843335864502808624467547488490102960304305213364034711017640989096983108511677259039881n;
const ACCUMULATOR_GENERATOR = 5n;
const PRIME_SEARCH_MASK = (1n << 61n) - 1n;
const MILLER_RABIN_BASES = [2n, 3n, 5n, 7n, 11n, 13n, 17n];

function modPow(base, exponent, modulus) {
  let result = 1n;
  let power = base % modulus;
  let exp = exponent;

  while (exp > 0n) {
    if (exp & 1n) {
      result = (result * power) % modulus;
    }
    power = (power * power) % modulus;
    exp >>= 1n;
  }

  return result;
}

function isProbablePrime(n) {
  if (n < 2n) {
    return false;
  }

  const smallPrimes = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n];
  for (const prime of smallPrimes) {
    if (n === prime) {
      return true;
    }
    if (n % prime === 0n) {
      return false;
    }
  }

  let d = n - 1n;
  let r = 0n;
  while ((d & 1n) === 0n) {
    d >>= 1n;
    r += 1n;
  }

  for (const base of MILLER_RABIN_BASES) {
    if (base >= n - 2n) {
      continue;
    }

    let x = modPow(base, d, n);
    if (x === 1n || x === n - 1n) {
      continue;
    }

    let witnessFound = true;
    for (let i = 1n; i < r; i += 1n) {
      x = modPow(x, 2n, n);
      if (x === n - 1n) {
        witnessFound = false;
        break;
      }
    }

    if (witnessFound) {
      return false;
    }
  }

  return true;
}

function nextProbablePrime(start) {
  let candidate = start | 1n;
  while (!isProbablePrime(candidate)) {
    candidate += 2n;
  }
  return candidate;
}

function sha256Buffer(...parts) {
  const hash = crypto.createHash('sha256');
  for (const part of parts) {
    if (Buffer.isBuffer(part)) {
      hash.update(part);
    } else {
      hash.update(String(part), 'utf8');
    }
  }
  return hash.digest();
}

function sha256Hex(...parts) {
  return sha256Buffer(...parts).toString('hex');
}

function computeMerkleRootHex(values) {
  if (!values.length) {
    return sha256Hex('empty');
  }

  let layer = values.map((value) => sha256Buffer(value));
  while (layer.length > 1) {
    const nextLayer = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] || left;
      nextLayer.push(sha256Buffer(left, right));
    }
    layer = nextLayer;
  }
  return layer[0].toString('hex');
}

function deriveMasterKeyHex(options = {}) {
  if (options.masterKeyHex && options.masterKeyHex.length >= 64) {
    return options.masterKeyHex.slice(0, 64);
  }

  if (process.env.PRIVSEARCH_MASTER_KEY && process.env.PRIVSEARCH_MASTER_KEY.length >= 64) {
    return process.env.PRIVSEARCH_MASTER_KEY.slice(0, 64);
  }

  if (process.env.MASTER_ENCRYPTION_KEY && process.env.MASTER_ENCRYPTION_KEY.length >= 64) {
    return process.env.MASTER_ENCRYPTION_KEY.slice(0, 64);
  }

  return sha256Hex('privsearch-prototype-default-master-key');
}

function encryptJson(plaintextValue, key) {
  const iv = crypto.randomBytes(AES_IV_BYTES);
  const cipher = crypto.createCipheriv(AES_ALGORITHM, key, iv, {
    authTagLength: AES_TAG_BYTES,
  });

  const plaintext = Buffer.from(JSON.stringify(plaintextValue), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
    tag: tag.toString('hex'),
  };
}

function decryptJson(payload, key) {
  const decipher = crypto.createDecipheriv(
    AES_ALGORITHM,
    key,
    Buffer.from(payload.iv, 'hex'),
    { authTagLength: AES_TAG_BYTES },
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'hex')),
    decipher.final(),
  ]);

  return JSON.parse(plaintext.toString('utf8'));
}

function accumulatePrimes(primeValues) {
  let accumulator = ACCUMULATOR_GENERATOR;
  for (const primeValue of primeValues) {
    accumulator = modPow(accumulator, primeValue, ACCUMULATOR_MODULUS);
  }
  return accumulator;
}

function sameOrderedDocList(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

const CRYPTO_PHASE_KEYS = [
  'query_normalization_ms',
  'trapdoor_generation_ms',
  'encrypted_postings_retrieval_ms',
  'proof_construction_ms',
  'proof_verification_ms',
  'blockchain_verification_ms',
];

function createCryptoBreakdown() {
  return {
    query_normalization_ms: 0,
    trapdoor_generation_ms: 0,
    encrypted_postings_retrieval_ms: 0,
    proof_construction_ms: 0,
    proof_verification_ms: 0,
    blockchain_verification_ms: 0,
    crypto_total_ms: 0,
  };
}

function finalizeCryptoBreakdown(breakdown) {
  breakdown.crypto_total_ms = CRYPTO_PHASE_KEYS.reduce(
    (sum, key) => sum + Number(breakdown[key] || 0),
    0,
  );
  return breakdown;
}

function estimateSerializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function captureResourceSnapshot() {
  const memory = process.memoryUsage();
  return {
    rss_bytes: memory.rss,
    heap_used_bytes: memory.heapUsed,
    external_bytes: memory.external,
    cpu_usage: process.cpuUsage(),
  };
}

function diffCpuMs(startUsage, endUsage) {
  return (
    (endUsage.user - startUsage.user + endUsage.system - startUsage.system) / 1000
  );
}

function buildResourceHints({
  snapshotStart,
  snapshotEnd,
  proofHints,
  requestPayload,
  resultDocs,
  blockchainReference,
}) {
  const proofSizeBytes = estimateSerializedBytes(proofHints);
  const requestPayloadBytes = estimateSerializedBytes(requestPayload);
  const resultPayloadBytes = estimateSerializedBytes(resultDocs);
  const responsePayloadBytes = estimateSerializedBytes({
    verified: true,
    result_docs: resultDocs,
    proof_hints: proofHints,
  });
  const blockchainReferenceBytes = estimateSerializedBytes(blockchainReference);

  return {
    cpu_ms: diffCpuMs(snapshotStart.cpu_usage, snapshotEnd.cpu_usage),
    rss_delta_bytes: snapshotEnd.rss_bytes - snapshotStart.rss_bytes,
    heap_delta_bytes: snapshotEnd.heap_used_bytes - snapshotStart.heap_used_bytes,
    external_delta_bytes: snapshotEnd.external_bytes - snapshotStart.external_bytes,
    proof_size_bytes: proofSizeBytes,
    request_payload_bytes: requestPayloadBytes,
    result_payload_bytes: resultPayloadBytes,
    response_payload_bytes: responsePayloadBytes,
    blockchain_reference_bytes: blockchainReferenceBytes,
    network_total_bytes: requestPayloadBytes + responsePayloadBytes,
  };
}

class PrivSearchPrototypeEngine {
  constructor(options = {}) {
    this.name = 'privsearch-prototype';
    this.options = options;
    this.masterKeyHex = deriveMasterKeyHex(options);
    this.masterKey = Buffer.from(this.masterKeyHex, 'hex');
    this.indexRoot = options.indexRoot;
    this.accumulatorSampleSize = Number(
      options.accumulatorSampleSize
      || process.env.PRIVSEARCH_ACCUMULATOR_SAMPLE
      || '5',
    );
    this.corpusFile = options.corpusFile || process.env.PRIVSEARCH_CORPUS_FILE || '';
    this.processedRoot = options.processedRoot
      || path.join(path.resolve(__dirname, '..', '..', '..'), 'NweDB', 'enron_processed');
    this.encryptedIndexByToken = new Map();
    this.postingCacheByToken = new Map();
    this.docPrimeCache = new Map();
    this.semanticWitnessDocSampleSize = Number(
      options.semanticWitnessDocSampleSize
      || process.env.PRIVSEARCH_SEMANTIC_WITNESS_DOC_SAMPLE
      || '2',
    );
    this.semanticWitnessKeywordSampleSize = Number(
      options.semanticWitnessKeywordSampleSize
      || process.env.PRIVSEARCH_SEMANTIC_WITNESS_KEYWORD_SAMPLE
      || '2',
    );
    this.preparedResourceSummary = {
      keyword_count: 0,
      posting_count: 0,
      posting_doc_total: 0,
      raw_postings_bytes: 0,
      encrypted_payload_bytes: 0,
      encrypted_entry_bytes: 0,
      blockchain_commitment_bytes: 0,
    };
  }

  deriveTrapdoor(keyword) {
    return crypto
      .createHmac('sha256', this.masterKey)
      .update(`kw:${keyword}`, 'utf8')
      .digest('hex');
  }

  derivePostingKey(tokenHex) {
    return sha256Buffer(this.masterKey, `posting:${tokenHex}`);
  }

  hashDocIdToPrime(docId) {
    const cached = this.docPrimeCache.get(docId);
    if (cached) {
      return cached;
    }

    const digest = sha256Buffer(this.masterKey, `doc:${docId}`);
    let candidate = (BigInt(`0x${digest.toString('hex')}`) & PRIME_SEARCH_MASK) | 1n | (1n << 60n);
    if (candidate % 2n === 0n) {
      candidate += 1n;
    }

    const primeValue = nextProbablePrime(candidate);
    this.docPrimeCache.set(docId, primeValue);
    return primeValue;
  }

  storePostingForKeyword(keyword, docs) {
    const tokenHex = this.deriveTrapdoor(keyword);
    const postingKey = this.derivePostingKey(tokenHex);
    const sortedPostings = docs.slice().sort();
    const postingPrimes = sortedPostings.map((docId) => this.hashDocIdToPrime(docId));
    const encryptedPayload = encryptJson(sortedPostings, postingKey);
    const authRootHex = computeMerkleRootHex(sortedPostings);
    const accumulatorRoot = accumulatePrimes(postingPrimes);

    this.encryptedIndexByToken.set(tokenHex, {
      token_hex: tokenHex,
      posting_key_hash: sha256Hex(postingKey),
      posting_count: sortedPostings.length,
      encrypted_payload: encryptedPayload,
      auth_root_hex: authRootHex,
      accumulator_root_dec: accumulatorRoot.toString(10),
    });

    this.preparedResourceSummary.keyword_count += 1;
    this.preparedResourceSummary.posting_count += 1;
    this.preparedResourceSummary.posting_doc_total += sortedPostings.length;
    this.preparedResourceSummary.raw_postings_bytes += estimateSerializedBytes(sortedPostings);
    this.preparedResourceSummary.encrypted_payload_bytes += estimateSerializedBytes(encryptedPayload);
    this.preparedResourceSummary.encrypted_entry_bytes += estimateSerializedBytes(
      this.encryptedIndexByToken.get(tokenHex),
    );
    this.preparedResourceSummary.blockchain_commitment_bytes += estimateSerializedBytes({
      auth_root_hex: authRootHex,
      accumulator_root_dec: accumulatorRoot.toString(10),
    });
  }

  getProcessedFiles() {
    if (!fs.existsSync(this.processedRoot)) {
      return [];
    }

    return fs.readdirSync(this.processedRoot)
      .filter((name) => /^enron_emails_part_\d+\.jsonl$/.test(name))
      .sort()
      .map((name) => path.join(this.processedRoot, name));
  }

  parseYearFromDateRaw(dateRaw) {
    if (!dateRaw) {
      return null;
    }

    const parsed = Date.parse(dateRaw);
    if (Number.isNaN(parsed)) {
      return null;
    }

    const year = new Date(parsed).getUTCFullYear();
    if (!Number.isFinite(year)) {
      return null;
    }

    return String(year);
  }

  parseMonthKeyFromDateRaw(dateRaw) {
    if (!dateRaw) {
      return null;
    }

    const parsed = Date.parse(dateRaw);
    if (Number.isNaN(parsed)) {
      return null;
    }

    const date = new Date(parsed);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  buildRangePostingToken(fieldName, value) {
    return `meta:${fieldName}:${value}`;
  }

  async prepareRangeIndexesFromCorpus(workloads) {
    if (!this.corpusFile || !fs.existsSync(this.corpusFile)) {
      return false;
    }

    const yearFields = new Set();
    const monthFields = new Set();

    for (const workload of workloads) {
      const queryType = String(workload.query_type || '');
      if (queryType.startsWith('range_year_')) {
        yearFields.add(String(workload.range_field || 'email_year'));
      } else if (queryType.startsWith('range_month_')) {
        monthFields.add(String(workload.range_field || 'email_month'));
      }
    }

    if (!yearFields.size && !monthFields.size) {
      return true;
    }

    const fieldDocMaps = new Map();
    for (const fieldName of yearFields) {
      fieldDocMaps.set(fieldName, new Map());
    }
    for (const fieldName of monthFields) {
      fieldDocMaps.set(fieldName, new Map());
    }

    const rl = readline.createInterface({
      input: fs.createReadStream(this.corpusFile, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }

      const row = JSON.parse(line);
      if (!row.doc_id) {
        continue;
      }

      const rawDate = row.date || row.date_raw || row.event_date || '';
      const parsed = Date.parse(rawDate);
      if (Number.isNaN(parsed)) {
        continue;
      }

      const date = new Date(parsed);
      const year = String(date.getUTCFullYear());
      const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

      for (const fieldName of yearFields) {
        const map = fieldDocMaps.get(fieldName);
        if (!map.has(year)) {
          map.set(year, []);
        }
        map.get(year).push(row.doc_id);
      }

      for (const fieldName of monthFields) {
        const map = fieldDocMaps.get(fieldName);
        if (!map.has(monthKey)) {
          map.set(monthKey, []);
        }
        map.get(monthKey).push(row.doc_id);
      }
    }

    for (const [fieldName, valueMap] of fieldDocMaps.entries()) {
      for (const [value, docs] of valueMap.entries()) {
        this.storePostingForKeyword(this.buildRangePostingToken(fieldName, value), docs);
      }
    }

    return true;
  }

  async prepareRangeIndexes(workloads) {
    const preparedFromCorpus = await this.prepareRangeIndexesFromCorpus(workloads);
    if (preparedFromCorpus) {
      return;
    }

    const yearValues = new Set();
    const monthValues = new Set();

    for (const workload of workloads) {
      const queryType = String(workload.query_type || '');
      if (queryType.startsWith('range_year_')) {
        for (const value of workload.range_values || []) {
          yearValues.add(String(value));
        }
        continue;
      }
      if (queryType.startsWith('range_month_')) {
        for (const value of workload.range_values || []) {
          monthValues.add(String(value));
        }
      }
    }

    if (!yearValues.size && !monthValues.size) {
      return;
    }

    const yearToDocs = new Map([...yearValues].map((value) => [value, []]));
    const monthToDocs = new Map([...monthValues].map((value) => [value, []]));
    const processedFiles = this.getProcessedFiles();
    for (const filePath of processedFiles) {
      const rl = readline.createInterface({
        input: fs.createReadStream(filePath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) {
          continue;
        }

        const row = JSON.parse(line);
        const year = this.parseYearFromDateRaw(row.date_raw);
        const monthKey = this.parseMonthKeyFromDateRaw(row.date_raw);
        if (!row.doc_id) {
          continue;
        }
        if (year && yearToDocs.has(year)) {
          yearToDocs.get(year).push(row.doc_id);
        }
        if (monthKey && monthToDocs.has(monthKey)) {
          monthToDocs.get(monthKey).push(row.doc_id);
        }
      }
    }

    for (const [year, docs] of yearToDocs.entries()) {
      this.storePostingForKeyword(this.buildRangePostingToken('email_year', year), docs);
    }
    for (const [monthKey, docs] of monthToDocs.entries()) {
      this.storePostingForKeyword(this.buildRangePostingToken('email_month', monthKey), docs);
    }
  }

  async prepare(workloads, options = {}) {
    const prepStart = performance.now();

    const keywords = collectKeywords(workloads);
    const postings = await loadKeywordPostings(keywords, { indexRoot: this.indexRoot });

    for (const keyword of keywords) {
      const entry = postings.get(keyword);
      if (!entry) {
        throw new Error(`Missing postings for keyword "${keyword}" during prepare()`);
      }
      const tokenHex = this.deriveTrapdoor(keyword);
      if (tokenHex) {
        this.storePostingForKeyword(keyword, entry.postings);
      }
    }

    // Eagerly precompute membership witnesses for all (sampled_doc, keyword) pairs
    // across every conjunctive workload.  Moves the O(|posting_list| × s × k) witness
    // construction cost out of runQuery and into the one-time prepare phase, so that
    // measured verify_ms reflects only the marginal O(s × k) modPow verification cost.
    // Pass options.noWitnesses = true to skip (for benchmarks that do not verify
    // accumulator membership, e.g. tamper-detection probability experiments).
    let wCount = 0;
    if (!options.noWitnesses) {
      const conjunctiveWorkloads = workloads.filter(w => (w.query_type || '').startsWith('and_'));
      process.stdout.write(`[ps] Precomputing witnesses for ${conjunctiveWorkloads.length} conjunctive workloads...`);
      for (const workload of conjunctiveWorkloads) {
        const kwds = workload.keywords || [];
        if (!kwds.length) continue;
        const tokens  = kwds.map(kw => this.deriveTrapdoor(kw));
        const entries = tokens.map(tok => this.decryptPostingByToken(tok));
        const sorted  = entries.slice().sort((a, b) => a.postings.length - b.postings.length);
        let resultDocs = sorted[0].postings.slice();
        if (sorted.length > 1) resultDocs = intersectPostingLists(sorted);
        const sampledDocs = this.selectVerificationDocs(resultDocs);
        for (const docId of sampledDocs) {
          for (const entry of entries) {
            if (!entry.postingsSet.has(docId)) continue;
            this.buildMembershipWitness(entry, docId);
            wCount++;
          }
        }
      }
      process.stdout.write(` ${wCount} witnesses precomputed.\n`);
    } else {
      process.stdout.write('[ps] Witness precompute skipped (noWitnesses=true).\n');
    }

    const prepWallClockMs = performance.now() - prepStart;
    this.prepWallClockMs = prepWallClockMs;
    this.prepWitnessCount = wCount;

    await this.prepareRangeIndexes(workloads);
  }

  getPreparedResourceSummary() {
    const summary = { ...this.preparedResourceSummary };
    summary.storage_overhead_ratio = summary.raw_postings_bytes > 0
      ? summary.encrypted_entry_bytes / summary.raw_postings_bytes
      : 0;
    summary.encrypted_index_size_bytes = summary.encrypted_entry_bytes;
    summary.prep_wall_clock_s = (this.prepWallClockMs || 0) / 1000;
    summary.prep_witness_count = this.prepWitnessCount || 0;
    summary.accumulator_modulus_bits = ACCUMULATOR_MODULUS.toString(2).length;
    return summary;
  }

  decryptPostingByToken(tokenHex) {
    const cached = this.postingCacheByToken.get(tokenHex);
    if (cached) {
      return cached;
    }

    const entry = this.encryptedIndexByToken.get(tokenHex);
    if (!entry) {
      throw new Error(`Trapdoor token not found: ${tokenHex.slice(0, 12)}...`);
    }

    const postingKey = this.derivePostingKey(tokenHex);
    const postings = decryptJson(entry.encrypted_payload, postingKey);
    const postingPrimes = postings.map((docId) => this.hashDocIdToPrime(docId));
    const docIndexMap = new Map(postings.map((docId, index) => [docId, index]));
    const accumulatorRoot = BigInt(entry.accumulator_root_dec);
    const postingEntry = {
      token_hex: tokenHex,
      auth_root_hex: entry.auth_root_hex,
      accumulator_root: accumulatorRoot,
      postings,
      postingsSet: new Set(postings),
      stored_posting_count: entry.posting_count,
      posting_primes: postingPrimes,
      doc_index_map: docIndexMap,
      auth_root_valid: computeMerkleRootHex(postings) === entry.auth_root_hex,
      accumulator_root_valid: accumulatePrimes(postingPrimes) === accumulatorRoot,
      membership_witness_cache: new Map(),
    };
    this.postingCacheByToken.set(tokenHex, postingEntry);
    return postingEntry;
  }

  normalizeQueryToClauses(query) {
    if (query.query_type === 'single_keyword') {
      return {
        boolean_mode: 'single',
        clauses: [query.keywords],
      };
    }

    if (query.query_type.startsWith('and_')) {
      return {
        boolean_mode: 'conjunctive',
        clauses: [query.keywords],
      };
    }

    if (query.query_type === 'or_2' || query.query_type === 'or_3') {
      return {
        boolean_mode: 'disjunctive',
        clauses: (query.keywords || []).map((keyword) => [keyword]),
      };
    }

    if (query.query_type === 'fuzzy_1') {
      return {
        boolean_mode: 'disjunctive',
        clauses: (query.keywords || []).map((keyword) => [keyword]),
      };
    }

    if (query.query_type.startsWith('range_year_')) {
      const fieldName = String(query.range_field || 'email_year');
      return {
        boolean_mode: 'disjunctive',
        clauses: (query.range_values || []).map((value) => [this.buildRangePostingToken(fieldName, value)]),
      };
    }

    if (query.query_type.startsWith('range_month_')) {
      const fieldName = String(query.range_field || 'email_month');
      return {
        boolean_mode: 'disjunctive',
        clauses: (query.range_values || []).map((value) => [this.buildRangePostingToken(fieldName, value)]),
      };
    }

    if (query.query_type === 'or_of_and') {
      return {
        boolean_mode: 'dnf',
        clauses: [query.clause_1_keywords, query.clause_2_keywords],
      };
    }

    throw new Error(`Unsupported query type ${query.query_type}`);
  }

  evaluateClause(postingEntries) {
    if (postingEntries.length === 1) {
      return postingEntries[0].postings.slice();
    }
    return intersectPostingLists(postingEntries);
  }

  executeSemanticRanking(query, semanticPostingEntries) {
    const termWeights = buildSemanticTermWeights(query);
    const topK = Number(query.semantic_top_k || query.expected_result_count || 10);
    return rankSemanticCandidates(
      semanticPostingEntries.map(({ keyword, entry }) => ({
        keyword,
        postings: entry.postings,
        stored_posting_count: entry.stored_posting_count,
      })),
      termWeights,
      topK,
    );
  }

  buildMembershipWitness(postingEntry, targetDocId) {
    const cached = postingEntry.membership_witness_cache.get(targetDocId);
    if (cached !== undefined) {
      return cached;
    }

    const targetIndex = postingEntry.doc_index_map.get(targetDocId);
    if (targetIndex === undefined) {
      postingEntry.membership_witness_cache.set(targetDocId, null);
      return null;
    }

    let witness = ACCUMULATOR_GENERATOR;
    for (let i = 0; i < postingEntry.posting_primes.length; i += 1) {
      if (i === targetIndex) {
        continue;
      }
      witness = modPow(witness, postingEntry.posting_primes[i], ACCUMULATOR_MODULUS);
    }

    const witnessBundle = {
      witness,
      prime: postingEntry.posting_primes[targetIndex],
    };
    postingEntry.membership_witness_cache.set(targetDocId, witnessBundle);
    return witnessBundle;
  }

  verifyMembershipWitness(postingEntry, targetDocId) {
    const witnessBundle = this.buildMembershipWitness(postingEntry, targetDocId);
    if (!witnessBundle) {
      return false;
    }

    const recomputed = modPow(witnessBundle.witness, witnessBundle.prime, ACCUMULATOR_MODULUS);
    return recomputed === postingEntry.accumulator_root;
  }

  selectVerificationDocs(clauseDocs) {
    if (!clauseDocs.length) {
      return [];
    }
    if (this.accumulatorSampleSize <= 1) {
      return [clauseDocs[0]];
    }
    if (clauseDocs.length <= this.accumulatorSampleSize) {
      return clauseDocs.slice();
    }

    const selected = [];
    for (let i = 0; i < this.accumulatorSampleSize; i += 1) {
      const index = Math.round((i * (clauseDocs.length - 1)) / (this.accumulatorSampleSize - 1));
      selected.push(clauseDocs[index]);
    }
    return [...new Set(selected)];
  }

  // Random sample of sampleSize docs from docs array (Fisher-Yates).
  // Used by tamper-injection trials so placement of fakes is not deterministic.
  selectVerificationDocsRandom(docs, sampleSize) {
    if (!docs.length) return [];
    if (sampleSize >= docs.length) return docs.slice();
    const copy = docs.slice();
    for (let i = 0; i < sampleSize; i += 1) {
      const j = i + Math.floor(Math.random() * (copy.length - i));
      const tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp;
    }
    return copy.slice(0, sampleSize);
  }

  // Run a single tamper-detection trial.
  // Returns {detected, legitimate_count, fake_in_sample, sample_size}.
  // Tamper model: substitution — replace last `tamperCount` docs with fabricated IDs.
  async runTamperTrial(query, tamperCount, sampleSize) {
    const normalized = this.normalizeQueryToClauses(query);
    const clausePostingEntries = [];
    const clauseResults = [];

    for (let clauseIndex = 0; clauseIndex < normalized.clauses.length; clauseIndex += 1) {
      const tokens = normalized.clauses[clauseIndex].map((kw) => this.deriveTrapdoor(kw));
      const postingEntries = tokens.map((tok) => this.decryptPostingByToken(tok));
      clausePostingEntries.push(postingEntries);
      clauseResults.push(this.evaluateClause(postingEntries));
    }

    // Legitimate result set (conjunctive intersection or union per mode)
    let legitDocs;
    if (normalized.boolean_mode === 'single' || normalized.boolean_mode === 'conjunctive') {
      legitDocs = clauseResults[0] ? clauseResults[0].slice() : [];
    } else {
      legitDocs = [...new Set(clauseResults.flat())];
    }

    const legitCount = legitDocs.length;
    if (legitCount === 0) {
      return { detected: false, legitimate_count: 0, fake_in_sample: 0, sample_size: 0, skipped: true };
    }

    // Substitution: replace last min(tamperCount, legitCount) docs with fake IDs.
    const actualTamper = Math.min(tamperCount, legitCount);
    const tamperedDocs = legitDocs.slice();
    for (let i = 0; i < actualTamper; i += 1) {
      tamperedDocs[tamperedDocs.length - 1 - i] = `_tamper_fake_${i}_${Math.random().toString(36).slice(2)}`;
    }
    // Shuffle to randomise fake positions before sampling.
    for (let i = tamperedDocs.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = tamperedDocs[i]; tamperedDocs[i] = tamperedDocs[j]; tamperedDocs[j] = tmp;
    }

    const sampled = this.selectVerificationDocsRandom(tamperedDocs, sampleSize);
    const fakeInSample = sampled.filter((d) => d.startsWith('_tamper_fake_')).length;

    return {
      detected: fakeInSample > 0,
      legitimate_count: legitCount,
      fake_in_sample: fakeInSample,
      sample_size: sampled.length,
      actual_tamper: actualTamper,
      skipped: false,
    };
  }

  async runQuery(query) {
    if (query.query_type === 'semantic_v1') {
      return this.runSemanticQuery(query);
    }

    const resourceStart = captureResourceSnapshot();
    const cryptoBreakdown = createCryptoBreakdown();
    const setupStart = performance.now();
    const normalizeStart = performance.now();
    const normalized = this.normalizeQueryToClauses(query);
    cryptoBreakdown.query_normalization_ms += performance.now() - normalizeStart;

    const trapdoorStart = performance.now();
    const clauseTokens = normalized.clauses
      .map((keywords) => keywords.map((keyword) => this.deriveTrapdoor(keyword)));
    cryptoBreakdown.trapdoor_generation_ms += performance.now() - trapdoorStart;
    const trapdoorCount = clauseTokens.reduce((sum, clause) => sum + clause.length, 0);
    const setupMs = performance.now() - setupStart;

    const searchStart = performance.now();
    const clauseResults = [];
    const clauseProofs = [];
    const clausePostingEntries = [];

    for (let clauseIndex = 0; clauseIndex < clauseTokens.length; clauseIndex += 1) {
      const retrievalStart = performance.now();
      const postingEntries = clauseTokens[clauseIndex]
        .map((tokenHex) => this.decryptPostingByToken(tokenHex));
      cryptoBreakdown.encrypted_postings_retrieval_ms += performance.now() - retrievalStart;
      clausePostingEntries.push(postingEntries);

      const clauseDocs = this.evaluateClause(postingEntries);
      clauseResults.push(clauseDocs);

      const proofConstructionStart = performance.now();
      clauseProofs.push({
        clause_index: clauseIndex,
        posting_auth_roots: postingEntries.map((entry) => entry.auth_root_hex),
        posting_accumulators: postingEntries.map((entry) => entry.accumulator_root.toString(10)),
        posting_counts: postingEntries.map((entry) => entry.stored_posting_count),
      });
      cryptoBreakdown.proof_construction_ms += performance.now() - proofConstructionStart;
    }

    let resultDocs = [];
    if (normalized.boolean_mode === 'single' || normalized.boolean_mode === 'conjunctive') {
      resultDocs = clauseResults[0] || [];
    } else {
      resultDocs = [...new Set(clauseResults.flat())];
    }
    const searchMs = performance.now() - searchStart;

    const verifyStart = performance.now();
    let verified = true;
    for (let clauseIndex = 0; clauseIndex < clausePostingEntries.length; clauseIndex += 1) {
      const postingEntries = clausePostingEntries[clauseIndex];
      const proofVerificationStart = performance.now();
      const authRootsValid = postingEntries.every((entry) => entry.auth_root_valid);
      const accumulatorRootsValid = postingEntries.every((entry) => entry.accumulator_root_valid);
      const countsValid = postingEntries.every((entry) => entry.postings.length === entry.stored_posting_count);
      const clauseRecomputed = this.evaluateClause(postingEntries);
      const clauseMatches = sameOrderedDocList(clauseRecomputed, clauseResults[clauseIndex]);
      const sampledDocs = this.selectVerificationDocs(clauseResults[clauseIndex]);
      const membershipValid = sampledDocs.every((docId) => postingEntries.every((entry) => {
        if (!entry.postingsSet.has(docId)) {
          return false;
        }
        return this.verifyMembershipWitness(entry, docId);
      }));
      cryptoBreakdown.proof_verification_ms += performance.now() - proofVerificationStart;

      const proofConstructionStart = performance.now();
      clauseProofs[clauseIndex].membership_sample_docs = sampledDocs;
      clauseProofs[clauseIndex].membership_sample_count = sampledDocs.length;
      cryptoBreakdown.proof_construction_ms += performance.now() - proofConstructionStart;
      verified = verified && authRootsValid && accumulatorRootsValid && countsValid && clauseMatches && membershipValid;
    }

    const expectedCountVerificationStart = performance.now();
    const expectedCountMatches = resultDocs.length === query.expected_result_count;
    cryptoBreakdown.proof_verification_ms += performance.now() - expectedCountVerificationStart;
    verified = verified && expectedCountMatches;
    const verifyMs = performance.now() - verifyStart;
    finalizeCryptoBreakdown(cryptoBreakdown);
    const resourceEnd = captureResourceSnapshot();
    const requestPayload = {
      query_type: query.query_type,
      trapdoors: clauseTokens,
      mode: normalized.boolean_mode,
    };
    const blockchainReference = clauseProofs.map((proof) => ({
      posting_auth_roots: proof.posting_auth_roots,
      posting_accumulators: proof.posting_accumulators,
      posting_counts: proof.posting_counts,
    }));
    const resourceHints = buildResourceHints({
      snapshotStart: resourceStart,
      snapshotEnd: resourceEnd,
      proofHints: clauseProofs,
      requestPayload,
      resultDocs,
      blockchainReference,
    });

    return {
      setup_ms: setupMs,
      search_ms: searchMs,
      verify_ms: verifyMs,
      total_ms: setupMs + searchMs + verifyMs,
      result_count: resultDocs.length,
      verified,
      crypto_breakdown: cryptoBreakdown,
      crypto_breakdown_mode: 'inline_query_crypto_phases_with_external_blockchain_reference',
      phase_hints: {
        mode: normalized.boolean_mode,
        clauseCount: normalized.clauses.length,
        trapdoorCount,
        clauseResultSizes: clauseResults.map((docs) => docs.length),
        accumulatorSampleSize: this.accumulatorSampleSize,
      },
      verification_mode: 'hmac-aes-merkle-accumulator-cached-prototype',
      proof_hints: clauseProofs,
      resource_hints: resourceHints,
      resource_overhead_mode: 'process-delta-and-serialized-payload-estimate',
    };
  }

  async runSemanticQuery(query) {
    const resourceStart = captureResourceSnapshot();
    const cryptoBreakdown = createCryptoBreakdown();
    const setupStart = performance.now();
    const normalizeStart = performance.now();
    const semanticKeywords = [...new Set(query.matched_keywords || query.keywords || [])];
    const topK = Number(query.semantic_top_k || query.expected_result_count || 10);
    cryptoBreakdown.query_normalization_ms += performance.now() - normalizeStart;

    const trapdoorStart = performance.now();
    const semanticTokens = semanticKeywords.map((keyword) => ({
      keyword,
      tokenHex: this.deriveTrapdoor(keyword),
    }));
    cryptoBreakdown.trapdoor_generation_ms += performance.now() - trapdoorStart;

    const retrievalStart = performance.now();
    const semanticPostingEntries = semanticTokens.map(({ keyword, tokenHex }) => ({
      keyword,
      entry: this.decryptPostingByToken(tokenHex),
    }));
    cryptoBreakdown.encrypted_postings_retrieval_ms += performance.now() - retrievalStart;
    const setupMs = performance.now() - setupStart;

    const searchStart = performance.now();
    const ranking = this.executeSemanticRanking(query, semanticPostingEntries);
    const resultDocs = ranking.ranked_docs.map((row) => row.doc_id);
    const searchMs = performance.now() - searchStart;

    const verifyStart = performance.now();
    const proofVerificationStart = performance.now();
    const authRootsValid = semanticPostingEntries.every(({ entry }) => entry.auth_root_valid);
    const accumulatorRootsValid = semanticPostingEntries.every(({ entry }) => entry.accumulator_root_valid);
    const countsValid = semanticPostingEntries.every(({ entry }) => entry.postings.length === entry.stored_posting_count);
    const recomputedRanking = this.executeSemanticRanking(query, semanticPostingEntries);
    const recomputedDocs = recomputedRanking.ranked_docs.map((row) => row.doc_id);
    const rankingMatches = sameOrderedDocList(resultDocs, recomputedDocs);
    const sampledDocs = this.selectVerificationDocs(
      resultDocs.slice(0, Math.max(1, this.semanticWitnessDocSampleSize)),
    );
    const scoreMap = new Map(recomputedRanking.all_ranked_docs.map((row) => [row.doc_id, row]));
    const keywordEntryMap = new Map(semanticPostingEntries.map(({ keyword, entry }) => [keyword, entry]));
    const membershipValid = sampledDocs.every((docId) => {
      const scoreRow = scoreMap.get(docId);
      if (!scoreRow) {
        return false;
      }
      const matchedKeywordsToVerify = scoreRow.matched_keywords
        .slice(0, Math.max(1, this.semanticWitnessKeywordSampleSize));
      return matchedKeywordsToVerify.every((keyword) => {
        const entry = keywordEntryMap.get(keyword);
        if (!entry || !entry.postingsSet.has(docId)) {
          return false;
        }
        return this.verifyMembershipWitness(entry, docId);
      });
    });
    const expectedCountMatches = resultDocs.length === query.expected_result_count;
    const topKMatches = resultDocs.length <= topK;
    cryptoBreakdown.proof_verification_ms += performance.now() - proofVerificationStart;

    const verified = authRootsValid
      && accumulatorRootsValid
      && countsValid
      && rankingMatches
      && membershipValid
      && expectedCountMatches
      && topKMatches;

    const proofConstructionStart = performance.now();
    const proofHints = {
      semantic_concept: query.semantic_concept || '',
      query_text: query.query_text || '',
      semantic_keywords: query.semantic_keywords || [],
      matched_keywords: semanticKeywords,
      membership_sample_docs: sampledDocs,
      semantic_witness_keyword_sample_size: this.semanticWitnessKeywordSampleSize,
      candidate_count: ranking.candidate_count,
    };
    cryptoBreakdown.proof_construction_ms += performance.now() - proofConstructionStart;
    const verifyMs = performance.now() - verifyStart;
    finalizeCryptoBreakdown(cryptoBreakdown);
    const resourceEnd = captureResourceSnapshot();
    const requestPayload = {
      query_type: query.query_type,
      semantic_concept: query.semantic_concept || '',
      trapdoors: semanticTokens.map((row) => row.tokenHex),
      top_k: topK,
    };
    const blockchainReference = semanticPostingEntries.map(({ keyword, entry }) => ({
      keyword,
      auth_root_hex: entry.auth_root_hex,
      accumulator_root_dec: entry.accumulator_root.toString(10),
      posting_count: entry.stored_posting_count,
    }));
    const resourceHints = buildResourceHints({
      snapshotStart: resourceStart,
      snapshotEnd: resourceEnd,
      proofHints,
      requestPayload,
      resultDocs,
      blockchainReference,
    });

    return {
      setup_ms: setupMs,
      search_ms: searchMs,
      verify_ms: verifyMs,
      total_ms: setupMs + searchMs + verifyMs,
      result_count: resultDocs.length,
      verified,
      crypto_breakdown: cryptoBreakdown,
      crypto_breakdown_mode: 'inline_query_crypto_phases_with_external_blockchain_reference',
      phase_hints: {
        mode: 'semantic_v1',
        termCount: semanticKeywords.length,
        primaryTermCount: (query.semantic_keywords || []).length,
        candidateCount: ranking.candidate_count,
        topK,
        topScore: ranking.ranked_docs[0]?.score || 0,
      },
      verification_mode: 'authenticated-semantic-concept-expansion-prototype',
      proof_hints: proofHints,
      resource_hints: resourceHints,
      resource_overhead_mode: 'process-delta-and-serialized-payload-estimate',
    };
  }
}

module.exports = { PrivSearchPrototypeEngine };
