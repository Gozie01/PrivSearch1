'use strict';
const { AuditServer, MODULUS, GENERATOR, WITNESS_BYTES, canonicalQuery, digest } = require('./audit-v2-protocol');

function check(ok, message) { if (!ok) throw new Error(message); }
// Scan exponent bits once. Repeatedly shifting a very large BigInt would copy
// it at every step; this implementation handles whole posting products.
function modPowBits(base, exponent, modulus = MODULUS) {
  check(typeof exponent === 'bigint' && exponent >= 0n, 'Invalid exponent');
  check(modulus > 1n, 'Invalid modulus');
  let value = 1n; const power = ((base % modulus) + modulus) % modulus;
  for (const bit of exponent.toString(2)) {
    value = (value * value) % modulus;
    if (bit === '1') value = (value * power) % modulus;
  }
  return value;
}
function product(values, start = 0, end = values.length) {
  if (end === start) return 1n;
  if (end - start === 1) return values[start];
  const middle = start + Math.floor((end - start) / 2);
  return product(values, start, middle) * product(values, middle, end);
}
function selectedTree(items, start = 0, end = items.length) {
  if (end - start === 1) return { product: items[start].prime, item: items[start] };
  const middle = start + Math.floor((end - start) / 2), left = selectedTree(items, start, middle), right = selectedTree(items, middle, end);
  return { product: left.product * right.product, left, right };
}

class BatchAuditServer extends AuditServer {
  constructor(serverData) {
    super(serverData); this.products = new Map(); this.resetBatchStats();
  }
  resetBatchStats() { this.batchStats = { posting_products_built: 0, modular_exponentiations: 0, exponent_bits_processed: 0, witnesses_generated: 0 }; }
  resetWitnessCache({ keepProducts = false } = {}) {
    super.resetWitnessCache(); if (!keepProducts) this.products.clear(); this.resetBatchStats();
  }
  pow(base, exponent) {
    this.batchStats.modular_exponentiations++; this.batchStats.exponent_bits_processed += exponent.toString(2).length;
    return modPowBits(base, exponent);
  }
  prepareRequests(requests) {
    const groups = new Map();
    for (const { token, doc } of requests) {
      const entry = this.lists.get(token); check(entry, 'posting not prepared');
      if (!entry.positions.has(doc) || entry.witnesses.has(doc)) continue;
      const targets = groups.get(token) || new Map();
      targets.set(doc, { doc, prime: entry.primes[entry.positions.get(doc)] }); groups.set(token, targets);
    }
    let generated = 0;
    for (const [token, targets] of groups) {
      const entry = this.lists.get(token), tree = selectedTree([...targets.values()]);
      if (!this.products.has(token)) { this.products.set(token, product(entry.primes)); this.batchStats.posting_products_built++; }
      const full = this.products.get(token); check(full % tree.product === 0n, 'Selected primes do not divide posting product');
      // Every selected witness shares the exponent from all unselected records.
      const outside = this.pow(GENERATOR, full / tree.product);
      const split = (node, base) => {
        if (node.item) { entry.witnesses.set(node.item.doc, base.toString(16).padStart(WITNESS_BYTES * 2, '0')); generated++; return; }
        split(node.left, this.pow(base, node.right.product));
        split(node.right, this.pow(base, node.left.product));
      };
      split(tree, outside);
    }
    this.cacheStats.misses += generated; this.batchStats.witnesses_generated += generated; return generated;
  }
  witness(token, doc) {
    const entry = this.lists.get(token); check(entry, 'posting not prepared');
    if (!entry.positions.has(doc)) return null;
    if (entry.witnesses.has(doc)) { this.cacheStats.hits++; return entry.witnesses.get(doc); }
    this.prepareRequests([{ token, doc }]); return entry.witnesses.get(doc);
  }
  createProof(answer, query, challenge) {
    query = canonicalQuery(query);
    check(challenge.answer_digest === digest(answer), 'answer changed after challenge');
    check(challenge.query_digest === digest(query), 'query changed after challenge');
    const requests = challenge.positions.flatMap(({ position, clause_index }) => {
      const doc = answer.result_docs[position]; check(typeof doc === 'string' && query[clause_index], 'invalid challenge position');
      return query[clause_index].map(token => ({ token, doc }));
    });
    const generated = this.prepareRequests(requests);
    const proof = super.createProof(answer, query, challenge);
    // First retrievals of just-generated entries are misses, not warm hits.
    this.cacheStats.hits -= generated; return proof;
  }
  prewarm(query, answer) {
    query = canonicalQuery(query); const before = { ...this.cacheStats };
    const requests = answer.result_docs.flatMap(doc => {
      const index = answer.clause_docs.findIndex(docs => docs.includes(doc)); check(query[index], 'invalid answer clause');
      return query[index].map(token => ({ token, doc }));
    });
    const generated = this.prepareRequests(requests);
    for (const { token, doc } of requests) this.witness(token, doc);
    this.cacheStats.hits -= generated;
    return { cache_misses: this.cacheStats.misses - before.misses, cache_hits: this.cacheStats.hits - before.hits };
  }
  resourceStats() {
    return { ...this.batchStats, cached_posting_products: this.products.size,
      mathematical_product_bytes: [...this.products.values()].reduce((n, p) => n + Math.ceil(p.toString(2).length / 8), 0) };
  }
}
module.exports = { BatchAuditServer, modPowBits, product };
