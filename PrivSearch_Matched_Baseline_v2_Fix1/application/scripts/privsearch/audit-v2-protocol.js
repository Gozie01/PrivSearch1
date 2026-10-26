'use strict';

// Phase-1 sampled set auditing. No OXT, HTTP, blockchain freshness, or
// omission-completeness claim is made by this module.
const crypto = require('node:crypto');

// Public modulus inherited from the supplied prototype. Its generation and
// factorization-disposal claim have not been independently established.
const MODULUS = 21619096241149106944198064176012845267474146912799435543840066799609824807872458451164932298732969327451665891370724119674704689602655616655183655863148660544426735184751056510303931724990717171890718395134776999605428156933577128331266626506454148707350768496797675823300858666984776263564910634201436738912649326839152652138901860445102767217958976509703955707411089458040495687821355184097773154587786097493354138273408398927586945579360474775419118904663850293880092848361645585097768459001594869314275648156708656378259072576843335864502808624467547488490102960304305213364034711017640989096983108511677259039881n;
const GENERATOR = 5n;
const SCHEMA = 'privsearch-audit-v2';
const WITNESS_BYTES = Math.ceil(MODULUS.toString(2).length / 8);
const primeCache = new Map();

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function bytes(value) { return Buffer.from(JSON.stringify(value), 'utf8'); }
function digest(value) { return crypto.createHash('sha256').update(bytes(value)).digest('hex'); }
function requireCondition(ok, message) { if (!ok) throw new Error(message); }
function modPow(base, exponent, modulus = MODULUS) {
  let out = 1n;
  for (let power = base % modulus, exp = exponent; exp > 0n; exp >>= 1n) {
    if (exp & 1n) out = out * power % modulus;
    power = power * power % modulus;
  }
  return out;
}
function canonicalDocs(docs) {
  requireCondition(Array.isArray(docs) && docs.every(d => typeof d === 'string' && d.length > 0), 'invalid document list');
  return [...new Set(docs)].sort();
}
function assertCanonicalDocs(docs) {
  requireCondition(JSON.stringify(docs) === JSON.stringify(canonicalDocs(docs)), 'documents must be unique and canonically ordered');
}
function canonicalQuery(query) {
  requireCondition(Array.isArray(query) && query.length > 0, 'query must contain clauses');
  return query.map(clause => {
    requireCondition(Array.isArray(clause) && clause.length > 0, 'empty query clause');
    requireCondition(clause.every(t => typeof t === 'string' && /^[0-9a-f]{64}$/.test(t)), 'invalid posting token');
    requireCondition(new Set(clause).size === clause.length, 'duplicate query token');
    return clause.slice();
  });
}
function representative(version, token, doc) {
  const key = JSON.stringify([version, token, doc]);
  if (primeCache.has(key)) return primeCache.get(key);
  const hash = digest([SCHEMA, 'representative-256', version, token, doc]);
  let candidate = (BigInt('0x' + hash) | (1n << 255n) | 1n);
  const ceiling = 1n << 256n;
  while (candidate < ceiling) {
    const encoded = Buffer.from(candidate.toString(16).padStart(64, '0'), 'hex');
    // OpenSSL probable-prime test; do not describe this as a deterministic proof.
    if (crypto.checkPrimeSync(encoded, { checks: 64 })) {
      primeCache.set(key, candidate);
      return candidate;
    }
    candidate += 2n;
  }
  throw new Error('256-bit representative search overflow');
}
function samplePositions(n, requestedSize) {
  requireCondition(Number.isSafeInteger(n) && n >= 0 && n < 2 ** 48, 'invalid answer size');
  requireCondition(Number.isSafeInteger(requestedSize) && requestedSize > 0, 'sample size must be a positive integer');
  const count = Math.min(n, requestedSize);
  const swaps = new Map();
  const out = [];
  for (let i = 0; i < count; i++) {
    const j = crypto.randomInt(i, n);
    const selected = swaps.has(j) ? swaps.get(j) : j;
    const replacement = swaps.has(i) ? swaps.get(i) : i;
    swaps.set(j, replacement);
    swaps.delete(i);
    out.push(selected);
  }
  return out.sort((a, b) => a - b);
}
function hashDocs(docs) { return digest([SCHEMA, 'posting-list', docs]); }

function buildOwnerState(postings, { version = 'v1', sequence = 1, keyPair = crypto.generateKeyPairSync('ed25519') } = {}) {
  requireCondition(typeof version === 'string' && version.length > 0, 'invalid version');
  requireCondition(Number.isSafeInteger(sequence) && sequence > 0, 'invalid owner sequence');
  requireCondition(postings instanceof Map && postings.size > 0, 'owner postings required');
  const lists = new Map();
  const entries = [];
  for (const [token, documents] of [...postings.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    canonicalQuery([[token]]);
    const docs = canonicalDocs(documents);
    const primes = docs.map(doc => representative(version, token, doc));
    requireCondition(new Set(primes.map(String)).size === primes.length, 'representative collision');
    let accumulator = GENERATOR;
    for (const prime of primes) accumulator = modPow(accumulator, prime);
    const metadata = { token, count: docs.length, posting_digest: hashDocs(docs), accumulator_hex: accumulator.toString(16).padStart(WITNESS_BYTES * 2, '0') };
    entries.push(metadata);
    lists.set(token, { docs, primes });
  }
  const manifest = {
    schema: SCHEMA, version, sequence,
    parameters: { modulus_hex: MODULUS.toString(16), generator: String(GENERATOR), witness_bytes: WITNESS_BYTES, representative_bits: 256, primality_checks: 64 },
    entries,
  };
  const envelope = { manifest, signature: crypto.sign(null, bytes(manifest), keyPair.privateKey).toString('base64') };
  const publicKey = keyPair.publicKey.export({ type: 'spki', format: 'pem' });
  // Signing keys are never placed in serverData or the client verifier.
  return { envelope, publicKey, keyPair, serverData: { manifest: clone(manifest), lists } };
}

class AuditServer {
  constructor(serverData) {
    this.manifest = clone(serverData.manifest);
    this.lists = new Map([...serverData.lists].map(([token, entry]) => [token, {
      docs: entry.docs.slice(), primes: entry.primes.slice(),
      positions: new Map(entry.docs.map((d, i) => [d, i])), witnesses: new Map(),
    }]));
    this.cacheStats = { hits: 0, misses: 0 };
  }
  resetWitnessCache() {
    for (const entry of this.lists.values()) entry.witnesses.clear();
    this.cacheStats = { hits: 0, misses: 0 };
  }
  createAnswer(query) {
    query = canonicalQuery(query);
    const clauseDocs = query.map(clause => {
      const lists = clause.map(token => {
        const entry = this.lists.get(token);
        requireCondition(entry, 'posting not prepared');
        return entry;
      }).sort((a, b) => a.docs.length - b.docs.length);
      return lists[0].docs.filter(doc => lists.every(entry => entry.positions.has(doc)));
    });
    return {
      schema: SCHEMA, version: this.manifest.version,
      owner_commitment: digest(this.manifest), query_digest: digest(query),
      clause_docs: clauseDocs, result_docs: canonicalDocs(clauseDocs.flat()),
    };
  }
  witness(token, doc) {
    const entry = this.lists.get(token);
    requireCondition(entry, 'posting not prepared');
    const target = entry.positions.get(doc);
    if (target === undefined) return null;
    if (entry.witnesses.has(doc)) { this.cacheStats.hits++; return entry.witnesses.get(doc); }
    this.cacheStats.misses++;
    let value = GENERATOR;
    for (let i = 0; i < entry.primes.length; i++) if (i !== target) value = modPow(value, entry.primes[i]);
    const encoded = value.toString(16).padStart(WITNESS_BYTES * 2, '0');
    entry.witnesses.set(doc, encoded);
    return encoded;
  }
  createProof(answer, query, challenge) {
    query = canonicalQuery(query);
    requireCondition(challenge.answer_digest === digest(answer), 'answer changed after challenge');
    requireCondition(challenge.query_digest === digest(query), 'query changed after challenge');
    const witnesses = challenge.positions.flatMap(({ position, clause_index }) => {
      const doc = answer.result_docs[position];
      requireCondition(typeof doc === 'string' && query[clause_index], 'invalid challenge position');
      return query[clause_index].map(token => ({ position, clause_index, token, witness_hex: this.witness(token, doc) }));
    });
    return {
      schema: SCHEMA, version: this.manifest.version,
      nonce: challenge.nonce, query_digest: challenge.query_digest,
      answer_digest: challenge.answer_digest, witnesses,
    };
  }
  prewarm(query, answer) {
    const before = { ...this.cacheStats };
    for (const doc of answer.result_docs) {
      const clauseIndex = answer.clause_docs.findIndex(docs => docs.includes(doc));
      for (const token of query[clauseIndex]) this.witness(token, doc);
    }
    return { cache_misses: this.cacheStats.misses - before.misses, cache_hits: this.cacheStats.hits - before.hits };
  }
}

class AuditClient {
  #manifest;
  #entries;
  #publicKey;
  #pending;
  constructor(envelope, pinnedPublicKey, { sampleSize = 5 } = {}) {
    requireCondition(Number.isSafeInteger(sampleSize) && sampleSize > 0, 'sample size must be a positive integer');
    this.sampleSize = sampleSize;
    this.#publicKey = crypto.createPublicKey(pinnedPublicKey);
    this.#pending = new Map();
    this.installOwnerSnapshot(envelope);
  }
  installOwnerSnapshot(envelope) {
    const copy = clone(envelope);
    requireCondition(crypto.verify(null, bytes(copy.manifest), this.#publicKey, Buffer.from(copy.signature, 'base64')), 'owner signature invalid');
    const m = copy.manifest;
    requireCondition(m.schema === SCHEMA && typeof m.version === 'string' && m.version.length > 0, 'invalid owner manifest');
    requireCondition(Number.isSafeInteger(m.sequence) && m.sequence > 0, 'invalid owner sequence');
    if (this.#manifest && digest(m) !== digest(this.#manifest)) {
      requireCondition(m.sequence > this.#manifest.sequence, 'owner snapshot rollback or conflicting sequence');
    }
    requireCondition(m.parameters.modulus_hex === MODULUS.toString(16) && m.parameters.generator === String(GENERATOR) && m.parameters.witness_bytes === WITNESS_BYTES && m.parameters.representative_bits === 256 && m.parameters.primality_checks === 64, 'unsupported accumulator parameters');
    requireCondition(Array.isArray(m.entries), 'invalid owner entries');
    const entries = new Map();
    for (const entry of m.entries) {
      canonicalQuery([[entry.token]]);
      requireCondition(!entries.has(entry.token) && Number.isSafeInteger(entry.count) && entry.count >= 0, 'invalid owner posting metadata');
      requireCondition(typeof entry.accumulator_hex === 'string' && /^[0-9a-f]+$/.test(entry.accumulator_hex) && entry.accumulator_hex.length === WITNESS_BYTES * 2, 'invalid owner accumulator');
      const acc = BigInt('0x' + entry.accumulator_hex);
      requireCondition(acc > 0n && acc < MODULUS, 'owner accumulator out of range');
      entries.set(entry.token, entry);
    }
    // Caller must obtain the currently authorized version independently. A valid
    // signature alone does not establish chain freshness or prevent rollback.
    this.#manifest = m;
    this.#entries = entries;
    this.#pending.clear();
  }
  createChallenge(answer, query) {
    answer = clone(answer); query = canonicalQuery(query);
    requireCondition(answer.schema === SCHEMA && answer.version === this.#manifest.version && answer.owner_commitment === digest(this.#manifest), 'commitment or version mismatch');
    requireCondition(answer.query_digest === digest(query), 'answer query mismatch');
    requireCondition(Array.isArray(answer.clause_docs) && answer.clause_docs.length === query.length, 'clause count mismatch');
    query.flat().forEach(token => requireCondition(this.#entries.has(token), 'query posting not in owner snapshot'));
    answer.clause_docs.forEach(assertCanonicalDocs);
    assertCanonicalDocs(answer.result_docs);
    requireCondition(JSON.stringify(answer.result_docs) === JSON.stringify(canonicalDocs(answer.clause_docs.flat())), 'answer union mismatch');
    const positions = samplePositions(answer.result_docs.length, this.sampleSize).map(position => ({
      position, clause_index: answer.clause_docs.findIndex(docs => docs.includes(answer.result_docs[position])),
    }));
    const challenge = {
      schema: SCHEMA, version: this.#manifest.version, nonce: crypto.randomBytes(32).toString('hex'),
      query_digest: digest(query), answer_digest: digest(answer), positions,
    };
    this.#pending.set(challenge.nonce, { answer, query, challenge: clone(challenge) });
    return challenge;
  }
  verify(proof) {
    const pending = proof && this.#pending.get(proof.nonce);
    if (!pending) return { verified: false, reason: 'unknown or consumed challenge' };
    this.#pending.delete(proof.nonce);
    try {
      proof = clone(proof);
      const { answer, query, challenge } = pending;
      requireCondition(proof.schema === SCHEMA && proof.version === this.#manifest.version, 'proof version mismatch');
      requireCondition(proof.answer_digest === challenge.answer_digest && proof.query_digest === challenge.query_digest, 'proof binding mismatch');
      const expected = challenge.positions.flatMap(p => query[p.clause_index].map(token => ({ ...p, token })));
      requireCondition(Array.isArray(proof.witnesses) && proof.witnesses.length === expected.length, 'witness count mismatch');
      for (let i = 0; i < expected.length; i++) {
        const e = expected[i], w = proof.witnesses[i];
        requireCondition(w && w.position === e.position && w.clause_index === e.clause_index && w.token === e.token, 'witness identity mismatch');
        requireCondition(typeof w.witness_hex === 'string' && /^[0-9a-f]+$/.test(w.witness_hex) && w.witness_hex.length === WITNESS_BYTES * 2, 'missing or malformed witness');
        const value = BigInt('0x' + w.witness_hex);
        requireCondition(value > 0n && value < MODULUS, 'witness out of range');
        const doc = answer.result_docs[e.position];
        const prime = representative(this.#manifest.version, e.token, doc);
        const root = BigInt('0x' + this.#entries.get(e.token).accumulator_hex);
        requireCondition(modPow(value, prime) === root, 'membership equation failed');
      }
      return { verified: true, result_docs: answer.result_docs.slice(), checked_documents: challenge.positions.length, checked_witnesses: expected.length, omission_completeness: false };
    } catch (error) { return { verified: false, reason: error.message }; }
  }
}

module.exports = { SCHEMA, MODULUS, GENERATOR, WITNESS_BYTES, bytes, clone, digest, representative, samplePositions, canonicalDocs, canonicalQuery, buildOwnerState, AuditServer, AuditClient, modPow };
