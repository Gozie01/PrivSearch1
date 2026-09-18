require('dotenv/config');

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { DEFAULT_SEMANTIC_TOP_K } = require('./privsearch/semantic-lib');
const { tokenizeMixedHealthcareText } = require('./privsearch/healthcare-tokenizer');

const ROOT = path.resolve(__dirname, '..');
const INPUT_ROOT = process.env.HEALTHCARE_INDEX_ROOT
  || path.join(ROOT, 'NweDB', 'healthcare', 'inverted_index');
const CORPUS_FILE = process.env.HEALTHCARE_CORPUS_FILE
  || path.join(ROOT, 'NweDB', 'healthcare', 'combined', 'healthcare_privsearch_corpus.jsonl');
const MEDCD_QUERY_FILE = process.env.HEALTHCARE_MEDCD_QUERY_FILE
  || path.join(ROOT, 'NweDB', 'healthcare', 'medcd', 'search_queries.csv');
const OUTPUT_ROOT = process.env.HEALTHCARE_WORKLOAD_ROOT
  || path.join(ROOT, 'NweDB', 'healthcare', 'query_workloads');

const CANDIDATE_SAMPLE_COUNTS = {
  rare: 25,
  low: 30,
  medium: 35,
  high: 150,  // increased: h2h conjunctive search needs a large high-freq pool
};

const TARGET_QUERY_COUNTS = {
  and2: 24,
  and4: 12,
  and6: 6,   // added for SeaCQ head-to-head (large-|R| sweep)
  and8: 6,
  and10: 6,
  or2: 24,
  or3: 12,
  orOfAnd: 12,
  rangeYear2: 4,
  rangeYear3: 2,
  rangeMonth1: 8,
  rangeMonth3: 6,
  fuzzy1: 12,
  semantic1: 12,
};

// Minimum intersection size for conjunctive workloads used in the SeaCQ head-to-head.
// A floor of 50 ensures SeaCQ's O(|R|×k×t_exp) verification cost is non-trivial at all k levels.
const MIN_H2H_RESULT_FLOOR = 50;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

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

function writeWorkloadFiles(name, rows, columns) {
  const filePath = path.join(OUTPUT_ROOT, `${name}.csv`);
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => {
      const value = Array.isArray(row[column]) ? row[column].join('|') : row[column];
      return csvEscape(value ?? '');
    }).join(','));
  }
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function sampleEvenly(items, count) {
  if (items.length <= count) {
    return items.slice();
  }

  const selected = [];
  const used = new Set();
  for (let i = 0; i < count; i += 1) {
    const index = Math.round((i * (items.length - 1)) / (count - 1));
    if (!used.has(index)) {
      selected.push(items[index]);
      used.add(index);
    }
  }
  if (selected.length < count) {
    for (let i = 0; i < items.length && selected.length < count; i += 1) {
      if (!used.has(i)) {
        selected.push(items[i]);
      }
    }
  }
  return selected;
}

function attachQueryIds(rows, prefix) {
  return rows.map((row, index) => ({
    query_id: `${prefix}_${String(index + 1).padStart(3, '0')}`,
    ...row,
  }));
}

function selectQueries(candidates, targetCount) {
  if (!candidates.length) {
    return [];
  }
  return sampleEvenly(candidates, Math.min(targetCount, candidates.length));
}

function bucketForDocFreq(docFreq) {
  if (docFreq >= 5 && docFreq <= 20) {
    return 'rare';
  }
  if (docFreq >= 21 && docFreq <= 100) {
    return 'low';
  }
  if (docFreq >= 101 && docFreq <= 1000) {
    return 'medium';
  }
  if (docFreq > 1000) {
    return 'high';
  }
  return null;
}

function isEligibleKeyword(keyword) {
  const text = String(keyword || '').trim();
  if (!text) {
    return false;
  }
  if (/^[a-z][a-z0-9]{2,39}$/i.test(text)) {
    return true;
  }
  return /^[\p{Script=Han}]{2,16}$/u.test(text);
}

function bucketForResultCount(resultCount) {
  return bucketForDocFreq(resultCount) || 'high';
}

function parseFrequencyCsv() {
  const filePath = path.join(INPUT_ROOT, 'keyword_postings_document_frequency.csv');
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);

  const buckets = {
    rare: [],
    low: [],
    medium: [],
    high: [],
  };

  for (const line of lines.slice(1)) {
    const split = line.lastIndexOf(',');
    if (split === -1) {
      continue;
    }

    const keyword = line.slice(0, split);
    const docFreq = Number(line.slice(split + 1));
    const bucket = bucketForDocFreq(docFreq);
    if (!bucket || !isEligibleKeyword(keyword)) {
      continue;
    }

    buckets[bucket].push({
      keyword,
      doc_freq: docFreq,
      bucket,
    });
  }

  return buckets;
}

function pickCandidateKeywords(bucketedKeywords) {
  const candidates = {};
  for (const [bucket, items] of Object.entries(bucketedKeywords)) {
    candidates[bucket] = sampleEvenly(items, CANDIDATE_SAMPLE_COUNTS[bucket]);
  }
  return candidates;
}

async function loadPostingsIndex(targetKeywords, keywordMetadata) {
  const postingsFiles = fs.readdirSync(INPUT_ROOT)
    .filter((name) => /^keyword_postings_part_\d+\.jsonl$/.test(name))
    .sort()
    .map((name) => path.join(INPUT_ROOT, name));

  const targetSet = new Set(targetKeywords);
  const postingsIndex = new Map();

  for (const file of postingsFiles) {
    const rl = readline.createInterface({
      input: fs.createReadStream(file, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }
      const row = JSON.parse(line);
      if (!targetSet.has(row.keyword)) {
        continue;
      }

      const metadata = keywordMetadata.get(row.keyword);
      postingsIndex.set(row.keyword, {
        keyword: row.keyword,
        doc_freq: row.doc_freq,
        bucket: metadata?.bucket || bucketForResultCount(row.doc_freq),
        postings: row.postings,
        postingsSet: new Set(row.postings),
      });
      if (postingsIndex.size === targetSet.size) {
        return postingsIndex;
      }
    }
  }

  return postingsIndex;
}

function summarizeBucketCounts(items) {
  return items.reduce((acc, item) => {
    acc[item.bucket_profile || item.bucket] = (acc[item.bucket_profile || item.bucket] || 0) + 1;
    return acc;
  }, {});
}

function arrayIntersection(baseDocs, lookupSet) {
  const result = [];
  for (const docId of baseDocs) {
    if (lookupSet.has(docId)) {
      result.push(docId);
    }
  }
  return result;
}

function intersectKeywords(keywords, postingsIndex) {
  const entries = keywords
    .map((keyword) => postingsIndex.get(keyword))
    .filter(Boolean)
    .sort((a, b) => a.postings.length - b.postings.length);

  if (entries.length !== keywords.length || !entries.length) {
    return [];
  }

  let docs = entries[0].postings.slice();
  for (let i = 1; i < entries.length; i += 1) {
    docs = arrayIntersection(docs, entries[i].postingsSet);
    if (!docs.length) {
      break;
    }
  }
  return docs;
}

function unionKeywords(keywords, postingsIndex) {
  const docs = new Set();
  for (const keyword of keywords) {
    const entry = postingsIndex.get(keyword);
    if (!entry) {
      continue;
    }
    for (const docId of entry.postings) {
      docs.add(docId);
    }
  }
  return [...docs];
}

function buildSingleKeywordQueries(candidates) {
  return attachQueryIds(Object.values(candidates).flat().map((row) => ({
    query_type: 'single_keyword',
    bucket: row.bucket,
    keyword: row.keyword,
    doc_freq: row.doc_freq,
    expected_result_count: row.doc_freq,
  })), 'HKW');
}

function generateConjunctiveCandidates(candidates, postingsIndex, clauseSize, minResultFloor = 1) {
  // Use only high-freq keywords for large-floor runs so intersections stay meaningful.
  const pool = minResultFloor > 1
    ? (candidates.high || []).filter((row) => postingsIndex.has(row.keyword))
    : Object.values(candidates).flat().filter((row) => postingsIndex.has(row.keyword));

  const seen = new Set();
  const rows = [];

  for (let i = 0; i < pool.length; i += 1) {
    const seed = pool[i];
    if (!postingsIndex.has(seed.keyword)) continue;

    // Sort descending by doc_freq: high-frequency keywords preserve larger intersections.
    const compatible = pool
      .filter((row) => row.keyword !== seed.keyword && postingsIndex.has(row.keyword))
      .sort((a, b) => b.doc_freq - a.doc_freq);

    const keywords = [seed.keyword];
    let currentDocs = postingsIndex.get(seed.keyword).postings.slice();

    for (const row of compatible) {
      if (keywords.length >= clauseSize) break;
      if (keywords.includes(row.keyword)) continue;
      const candidateEntry = postingsIndex.get(row.keyword);
      const newDocs = arrayIntersection(currentDocs, candidateEntry.postingsSet);
      // Enforce result-size floor at every step so the final intersection stays ≥ floor.
      if (newDocs.length < minResultFloor) continue;
      keywords.push(row.keyword);
      currentDocs = newDocs;
    }

    if (keywords.length !== clauseSize || currentDocs.length < minResultFloor) continue;

    const normalized = keywords.slice().sort().join('|');
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    rows.push({
      query_type: `and_${clauseSize}`,
      bucket_profile: bucketForResultCount(currentDocs.length),
      keywords,
      expected_result_count: currentDocs.length,
      example_doc_ids: currentDocs.slice(0, 3),
    });
  }

  rows.sort((a, b) => a.expected_result_count - b.expected_result_count);
  return rows;
}

function generateOrCandidates(candidates, postingsIndex, clauseSize) {
  const pool = Object.values(candidates).flat();
  const rows = [];

  for (let i = 0; i < pool.length; i += 1) {
    const keywords = [pool[i].keyword];
    for (let j = i + 1; j < pool.length && keywords.length < clauseSize; j += 1) {
      keywords.push(pool[j].keyword);
    }

    if (keywords.length !== clauseSize) {
      continue;
    }

    const docs = unionKeywords(keywords, postingsIndex);
    if (!docs.length) {
      continue;
    }

    rows.push({
      query_type: `or_${clauseSize}`,
      bucket_profile: bucketForResultCount(docs.length),
      keywords,
      expected_result_count: docs.length,
      overlap_count: keywords.reduce((sum, keyword) => sum + (postingsIndex.get(keyword)?.doc_freq || 0), 0) - docs.length,
    });
  }

  rows.sort((a, b) => a.expected_result_count - b.expected_result_count);
  return rows;
}

function generateOrOfAndCandidates(and2Queries, postingsIndex) {
  const rows = [];
  const seen = new Set();

  for (let i = 0; i < and2Queries.length; i += 1) {
    for (let j = i + 1; j < and2Queries.length; j += 1) {
      const left = and2Queries[i];
      const right = and2Queries[j];
      const normalized = [
        left.keywords.slice().sort().join('&'),
        right.keywords.slice().sort().join('&'),
      ].sort().join('||');
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);

      const leftDocs = intersectKeywords(left.keywords, postingsIndex);
      const rightDocs = intersectKeywords(right.keywords, postingsIndex);
      const unionDocs = new Set([...leftDocs, ...rightDocs]);
      if (!unionDocs.size) {
        continue;
      }

      rows.push({
        query_type: 'or_of_and',
        clause_1_keywords: left.keywords,
        clause_2_keywords: right.keywords,
        clause_1_result_count: leftDocs.length,
        clause_2_result_count: rightDocs.length,
        expected_result_count: unionDocs.size,
      });
    }
  }

  rows.sort((a, b) => a.expected_result_count - b.expected_result_count);
  return rows;
}

async function buildTemporalIndexes() {
  const yearToDocs = new Map();
  const monthToDocs = new Map();

  const rl = readline.createInterface({
    input: fs.createReadStream(CORPUS_FILE, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }
    const row = JSON.parse(line);
    if (!row.doc_id || !row.date) {
      continue;
    }
    const parsed = Date.parse(row.date);
    if (Number.isNaN(parsed)) {
      continue;
    }
    const date = new Date(parsed);
    const year = String(date.getUTCFullYear());
    const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

    if (!yearToDocs.has(year)) {
      yearToDocs.set(year, []);
    }
    if (!monthToDocs.has(month)) {
      monthToDocs.set(month, []);
    }
    yearToDocs.get(year).push(row.doc_id);
    monthToDocs.get(month).push(row.doc_id);
  }

  return { yearToDocs, monthToDocs };
}

function monthKeyToIndex(monthKey) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ''));
  if (!match) {
    return Number.NaN;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  return (year * 12) + (month - 1);
}

function buildContiguousWindows(sortedValues, width, queryTypePrefix, lookupMap, isContiguous) {
  const rows = [];
  for (let i = 0; i <= sortedValues.length - width; i += 1) {
    const windowValues = sortedValues.slice(i, i + width);
    let contiguous = true;
    for (let j = 1; j < windowValues.length; j += 1) {
      if (!isContiguous(windowValues[j - 1], windowValues[j])) {
        contiguous = false;
        break;
      }
    }
    if (!contiguous) {
      continue;
    }

    const docs = new Set();
    for (const value of windowValues) {
      for (const docId of lookupMap.get(String(value)) || []) {
        docs.add(docId);
      }
    }
    if (!docs.size) {
      continue;
    }
    rows.push({
      query_type: `${queryTypePrefix}_${width}`,
      bucket_profile: bucketForResultCount(docs.size),
      range_field: 'event_date',
      range_start: windowValues[0],
      range_end: windowValues[windowValues.length - 1],
      range_values: windowValues,
      expected_result_count: docs.size,
    });
  }
  rows.sort((a, b) => a.expected_result_count - b.expected_result_count);
  return rows;
}

function makeFuzzyVariant(keyword) {
  const text = String(keyword || '');
  if (text.length < 4 || !/^[a-z][a-z0-9]+$/i.test(text)) {
    return text;
  }
  const pivot = Math.floor(text.length / 2);
  return `${text.slice(0, pivot)}x${text.slice(pivot + 1)}`.toLowerCase();
}

function buildFuzzyQueries(candidates) {
  const pool = Object.values(candidates)
    .flat()
    .filter((row) => /^[a-z][a-z0-9]+$/i.test(row.keyword));

  const rows = pool.map((row) => ({
    query_type: 'fuzzy_1',
    bucket_profile: row.bucket,
    fuzzy_term: makeFuzzyVariant(row.keyword),
    matched_keywords: [row.keyword],
    expected_result_count: row.doc_freq,
    max_edit_distance: 1,
  }));

  return attachQueryIds(selectQueries(rows, TARGET_QUERY_COUNTS.fuzzy1), 'HFQ');
}

function buildSemanticQueries(postingsIndex) {
  const medcdQueries = loadCsvObjects(MEDCD_QUERY_FILE);
  const rows = [];

  for (const row of medcdQueries) {
    const queryText = String(row.query_text || row.query || '').trim();
    if (!queryText) {
      continue;
    }
    const matchedKeywords = tokenizeMixedHealthcareText(queryText)
      .filter((keyword) => postingsIndex.has(keyword));
    const uniqueKeywords = [...new Set(matchedKeywords)];
    if (uniqueKeywords.length < 3) {
      continue;
    }

    const candidateDocs = unionKeywords(uniqueKeywords, postingsIndex);
    if (candidateDocs.length < DEFAULT_SEMANTIC_TOP_K) {
      continue;
    }

    rows.push({
      query_type: 'semantic_v1',
      bucket_profile: bucketForResultCount(candidateDocs.length),
      semantic_concept: `healthcare_query_${rows.length + 1}`,
      query_text: queryText,
      semantic_keywords: uniqueKeywords.slice(0, 4),
      matched_keywords: uniqueKeywords,
      semantic_top_k: DEFAULT_SEMANTIC_TOP_K,
      candidate_result_count: candidateDocs.length,
      expected_result_count: DEFAULT_SEMANTIC_TOP_K,
    });
  }

  return attachQueryIds(selectQueries(rows, TARGET_QUERY_COUNTS.semantic1), 'HSQ');
}

async function main() {
  ensureDir(OUTPUT_ROOT);

  const bucketedKeywords = parseFrequencyCsv();
  const candidates = pickCandidateKeywords(bucketedKeywords);
  const candidateRows = Object.values(candidates).flat();
  const keywordMetadata = new Map(candidateRows.map((row) => [row.keyword, row]));

  const medcdQueries = loadCsvObjects(MEDCD_QUERY_FILE);
  const semanticKeywords = new Set(
    medcdQueries.flatMap((row) => tokenizeMixedHealthcareText(row.query_text || row.query || '')),
  );

  const targetKeywords = [...new Set([
    ...candidateRows.map((row) => row.keyword),
    ...semanticKeywords,
  ])];
  const postingsIndex = await loadPostingsIndex(targetKeywords, keywordMetadata);

  const singleKeywordQueries = buildSingleKeywordQueries(candidates);
  const and2Queries = attachQueryIds(selectQueries(generateConjunctiveCandidates(candidates, postingsIndex, 2, MIN_H2H_RESULT_FLOOR), TARGET_QUERY_COUNTS.and2), 'HA2');
  const and4Queries = attachQueryIds(selectQueries(generateConjunctiveCandidates(candidates, postingsIndex, 4, MIN_H2H_RESULT_FLOOR), TARGET_QUERY_COUNTS.and4), 'HA4');
  // all k levels use MIN_H2H_RESULT_FLOOR so SeaCQ verification cost is non-trivial across the full sweep
  const and6Queries = attachQueryIds(selectQueries(generateConjunctiveCandidates(candidates, postingsIndex, 6, MIN_H2H_RESULT_FLOOR), TARGET_QUERY_COUNTS.and6), 'HA6');
  const and8Queries = attachQueryIds(selectQueries(generateConjunctiveCandidates(candidates, postingsIndex, 8, MIN_H2H_RESULT_FLOOR), TARGET_QUERY_COUNTS.and8), 'HA8');
  const and10Queries = attachQueryIds(selectQueries(generateConjunctiveCandidates(candidates, postingsIndex, 10, MIN_H2H_RESULT_FLOOR), TARGET_QUERY_COUNTS.and10), 'HA10');
  const or2Queries = attachQueryIds(selectQueries(generateOrCandidates(candidates, postingsIndex, 2), TARGET_QUERY_COUNTS.or2), 'HO2');
  const or3Queries = attachQueryIds(selectQueries(generateOrCandidates(candidates, postingsIndex, 3), TARGET_QUERY_COUNTS.or3), 'HO3');
  const orOfAndQueries = attachQueryIds(selectQueries(generateOrOfAndCandidates(and2Queries, postingsIndex), TARGET_QUERY_COUNTS.orOfAnd), 'HOO');
  const { yearToDocs, monthToDocs } = await buildTemporalIndexes();
  const sortedYears = [...yearToDocs.keys()].sort((a, b) => Number(a) - Number(b));
  const sortedMonths = [...monthToDocs.keys()].sort();
  const rangeYear2Queries = attachQueryIds(
    selectQueries(
      buildContiguousWindows(sortedYears, 2, 'range_year', yearToDocs, (left, right) => Number(right) === Number(left) + 1),
      TARGET_QUERY_COUNTS.rangeYear2,
    ),
    'HRY2',
  );
  const rangeYear3Queries = attachQueryIds(
    selectQueries(
      buildContiguousWindows(sortedYears, 3, 'range_year', yearToDocs, (left, right) => Number(right) === Number(left) + 1),
      TARGET_QUERY_COUNTS.rangeYear3,
    ),
    'HRY3',
  );
  const rangeMonth1Queries = attachQueryIds(
    selectQueries(
      buildContiguousWindows(sortedMonths, 1, 'range_month', monthToDocs, () => true),
      TARGET_QUERY_COUNTS.rangeMonth1,
    ),
    'HRM1',
  );
  const rangeMonth3Queries = attachQueryIds(
    selectQueries(
      buildContiguousWindows(sortedMonths, 3, 'range_month', monthToDocs, (left, right) => monthKeyToIndex(right) === monthKeyToIndex(left) + 1),
      TARGET_QUERY_COUNTS.rangeMonth3,
    ),
    'HRM3',
  );
  const fuzzyQueries = buildFuzzyQueries(candidates);
  const semanticQueries = buildSemanticQueries(postingsIndex);

  writeWorkloadFiles('single_keyword_queries', singleKeywordQueries, [
    'query_id', 'query_type', 'bucket', 'keyword', 'doc_freq', 'expected_result_count',
  ]);
  writeWorkloadFiles('and_queries', [...and2Queries, ...and4Queries, ...and6Queries, ...and8Queries, ...and10Queries], [
    'query_id', 'query_type', 'bucket_profile', 'keywords', 'expected_result_count', 'example_doc_ids',
  ]);
  writeWorkloadFiles('or_queries', [...or2Queries, ...or3Queries], [
    'query_id', 'query_type', 'bucket_profile', 'keywords', 'expected_result_count', 'overlap_count',
  ]);
  writeWorkloadFiles('or_of_and_queries', orOfAndQueries, [
    'query_id', 'query_type', 'clause_1_keywords', 'clause_2_keywords', 'clause_1_result_count', 'clause_2_result_count', 'expected_result_count',
  ]);
  writeWorkloadFiles('range_queries', [...rangeYear2Queries, ...rangeYear3Queries, ...rangeMonth1Queries, ...rangeMonth3Queries], [
    'query_id', 'query_type', 'bucket_profile', 'range_field', 'range_start', 'range_end', 'range_values', 'expected_result_count',
  ]);
  writeWorkloadFiles('fuzzy_queries', fuzzyQueries, [
    'query_id', 'query_type', 'bucket_profile', 'fuzzy_term', 'matched_keywords', 'max_edit_distance', 'expected_result_count',
  ]);
  writeWorkloadFiles('semantic_queries', semanticQueries, [
    'query_id', 'query_type', 'bucket_profile', 'semantic_concept', 'query_text', 'semantic_keywords', 'matched_keywords', 'semantic_top_k', 'candidate_result_count', 'expected_result_count',
  ]);

  const summary = {
    generated_at: new Date().toISOString(),
    input_root: path.relative(ROOT, INPUT_ROOT),
    output_root: path.relative(ROOT, OUTPUT_ROOT),
    candidate_keywords: {
      total: candidateRows.length,
      by_bucket: summarizeBucketCounts(candidateRows),
    },
    workloads: {
      single_keyword_queries: {
        total: singleKeywordQueries.length,
        by_bucket: summarizeBucketCounts(singleKeywordQueries),
      },
      and_queries: {
        total: and2Queries.length + and4Queries.length + and6Queries.length + and8Queries.length + and10Queries.length,
        and_2: and2Queries.length,
        and_4: and4Queries.length,
        and_6: and6Queries.length,
        and_8: and8Queries.length,
        and_10: and10Queries.length,
        h2h_result_floor: MIN_H2H_RESULT_FLOOR,
      },
      or_queries: {
        total: or2Queries.length + or3Queries.length,
        or_2: or2Queries.length,
        or_3: or3Queries.length,
      },
      or_of_and_queries: {
        total: orOfAndQueries.length,
      },
      range_queries: {
        total: rangeYear2Queries.length + rangeYear3Queries.length + rangeMonth1Queries.length + rangeMonth3Queries.length,
        range_year_2: rangeYear2Queries.length,
        range_year_3: rangeYear3Queries.length,
        range_month_1: rangeMonth1Queries.length,
        range_month_3: rangeMonth3Queries.length,
      },
      fuzzy_queries: {
        total: fuzzyQueries.length,
      },
      semantic_queries: {
        total: semanticQueries.length,
      },
    },
  };

  fs.writeFileSync(path.join(OUTPUT_ROOT, 'healthcare_query_workloads_summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(`Prepared healthcare query workloads in ${OUTPUT_ROOT}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('prepare-healthcare-query-workloads failed:', error);
  process.exitCode = 1;
});
