// generate-healthcare-and-workloads.js
//
// Constructs healthcare conjunctive workloads for k ∈ {6, 8, 10} by finding
// sets of k high-frequency keywords whose posting-list intersection is non-empty.
// Appends the new rows to NweDB/healthcare/query_workloads/and_queries.csv.
//
// Usage: node scripts/generate-healthcare-and-workloads.js

const fs   = require('fs');
const path = require('path');
const rl   = require('readline');

const ROOT      = path.resolve(__dirname, '..');
const IDX_ROOT  = path.join(ROOT, 'NweDB', 'healthcare', 'inverted_index');
const WL_ROOT   = path.join(ROOT, 'NweDB', 'healthcare', 'query_workloads');
const AND_CSV   = path.join(WL_ROOT, 'and_queries.csv');

const TARGET_K       = [6, 8, 10];
const WORKLOADS_PER_K = 3;
const TOP_N_KEYWORDS = 120; // load this many high-freq keywords to build combinations

// ── helpers ──────────────────────────────────────────────────────────────────

function intersection(setA, arrB) {
  const out = [];
  for (const x of arrB) { if (setA.has(x)) out.push(x); }
  return out;
}

function csvRow(fields) {
  return fields.map((f) => {
    const s = String(f ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',');
}

function loadExistingIds() {
  if (!fs.existsSync(AND_CSV)) return new Set();
  const lines = fs.readFileSync(AND_CSV, 'utf8').split(/\r?\n/).slice(1);
  const ids = new Set();
  for (const l of lines) {
    const id = l.split(',')[0];
    if (id) ids.add(id.trim());
  }
  return ids;
}

function nextId(prefix, existing, seq) {
  let id;
  do { id = `${prefix}${String(seq++).padStart(3, '0')}`; } while (existing.has(id));
  existing.add(id);
  return { id, seq };
}

// ── Step 1: read top-N keywords by doc_freq ──────────────────────────────────

function readTopKeywords(n) {
  const csvPath = path.join(IDX_ROOT, 'keyword_postings_document_frequency.csv');
  const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);
  // skip header; format: keyword,doc_freq
  const rows = lines.slice(1).map((l) => {
    const [kw, df] = l.split(',');
    return { keyword: kw.trim(), doc_freq: Number(df) };
  }).filter((r) => r.keyword && r.doc_freq > 0);
  rows.sort((a, b) => b.doc_freq - a.doc_freq);
  return rows.slice(0, n).map((r) => r.keyword);
}

// ── Step 2: stream JSONL files and collect posting lists for target keywords ──

async function loadPostings(targetKeywords) {
  const target = new Set(targetKeywords);
  const postings = new Map(); // keyword → string[]

  const parts = fs.readdirSync(IDX_ROOT)
    .filter((n) => /^keyword_postings_part_\d+\.jsonl$/.test(n))
    .sort()
    .map((n) => path.join(IDX_ROOT, n));

  for (const part of parts) {
    const stream = fs.createReadStream(part, { encoding: 'utf8' });
    const iface  = rl.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of iface) {
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (target.has(obj.keyword)) {
        postings.set(obj.keyword, obj.postings || []);
        if (postings.size === target.size) break; // got all we need from this part
      }
    }
    if (postings.size === target.size) break;
  }
  return postings;
}

// ── Step 3: find keyword combinations with non-empty intersection ─────────────
// Strategy: try top-k keywords first, then slide a window for variety.

function findCombinations(keywords, postings, k, needed) {
  // keywords is ordered by doc_freq desc — start with the highest-freq ones.
  // Greedily build sets: start from position i, pick k consecutive keywords
  // (wrapping combinations) that all have the required doc-count.
  const results = [];
  const n = keywords.length;

  outer:
  for (let start = 0; start <= n - k && results.length < needed * 4; start++) {
    const kwSet = keywords.slice(start, start + k);
    // compute intersection step by step
    let inter = new Set(postings.get(kwSet[0]) || []);
    for (let j = 1; j < kwSet.length; j++) {
      const next = postings.get(kwSet[j]);
      if (!next || next.length === 0) continue outer;
      inter = new Set(intersection(inter, next));
      if (inter.size === 0) continue outer;
    }
    if (inter.size === 0) continue;
    const docs = [...inter];
    results.push({ keywords: kwSet, docs, expected: docs.length });
    if (results.length >= needed) break;
  }
  return results;
}

// ── Step 4: append to and_queries.csv ────────────────────────────────────────

function appendWorkloads(workloads) {
  const existing = loadExistingIds();
  const lines = [];

  for (const { k, entries } of workloads) {
    const prefix = `HA${k}_`;
    let seq = 1;
    for (const entry of entries) {
      const { id, seq: nextSeq } = nextId(prefix, existing, seq);
      seq = nextSeq;
      lines.push(csvRow([
        id,
        `and_${k}`,
        'high',
        entry.keywords.join('|'),
        entry.expected,
        entry.docs.slice(0, 3).join('|'),
      ]));
    }
  }

  if (!lines.length) {
    console.log('No new workloads to append.');
    return 0;
  }

  const header = !fs.existsSync(AND_CSV)
    ? 'query_id,query_type,bucket_profile,keywords,expected_result_count,example_doc_ids\n'
    : '';
  fs.appendFileSync(AND_CSV, header + lines.join('\n') + '\n', 'utf8');
  return lines.length;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Loading top-${TOP_N_KEYWORDS} keywords by document frequency...`);
  const topKeywords = readTopKeywords(TOP_N_KEYWORDS);
  console.log(`Top-5: ${topKeywords.slice(0, 5).join(', ')}  ...`);

  console.log('Streaming inverted-index JSONL parts to collect posting lists...');
  const postings = await loadPostings(topKeywords);
  console.log(`Loaded posting lists for ${postings.size} / ${topKeywords.length} keywords.`);

  // Filter to keywords we actually found in the index
  const available = topKeywords.filter((kw) => postings.has(kw));
  console.log(`Available for combination: ${available.length} keywords`);

  const allWorkloads = [];
  for (const k of TARGET_K) {
    if (available.length < k) {
      console.log(`Not enough keywords for k=${k} — skipping.`);
      continue;
    }
    const combos = findCombinations(available, postings, k, WORKLOADS_PER_K);
    console.log(`k=${k}: found ${combos.length} valid combinations (target ${WORKLOADS_PER_K})`);
    for (const c of combos.slice(0, WORKLOADS_PER_K)) {
      console.log(`  keywords: [${c.keywords.join(', ')}]  |R|=${c.expected}`);
    }
    if (combos.length > 0) {
      allWorkloads.push({ k, entries: combos.slice(0, WORKLOADS_PER_K) });
    }
  }

  const added = appendWorkloads(allWorkloads);
  console.log(`\nAppended ${added} new workload rows to ${AND_CSV}`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
