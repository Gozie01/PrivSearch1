require('dotenv/config');

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {
  DEFAULT_SEMANTIC_TOP_K,
  SEMANTIC_CONCEPTS,
  resolveSemanticConcepts,
} = require('./privsearch/semantic-lib');

const ROOT = path.resolve(__dirname, '..');
const INPUT_ROOT = path.join(ROOT, 'NweDB', 'enron_inverted_index');
const OUTPUT_ROOT = path.join(ROOT, 'NweDB', 'enron_query_workloads');
const PROCESSED_ROOT = path.join(ROOT, 'NweDB', 'enron_processed');

const HIGH_MAX_DOC_FREQ = 15000;
// Minimum intersection size for conjunctive workloads.  Queries with |R|<10 are
// uninformative for the SeaCQ comparison (trivial for both engines) and produce the
// "≈1-2 across the whole sweep" artefact flagged by the reviewer.
const MIN_RESULT_FLOOR = 10;
const NOISE_KEYWORDS = new Set([
  'ect',
  'hou',
  'corp',
  'doc',
  'fax',
  'net',
  'per',
  'com',
  'www',
  'http',
  'https',
]);

const CANDIDATE_SAMPLE_COUNTS = {
  rare: 30,
  low: 30,
  medium: 40,
  high: 50,
};

const TARGET_QUERY_COUNTS = {
  and2: 40,
  and4: 20,
  and5: 20,
  and6: 20,
  and8: 20,
  and10: 20,
  or2: 40,
  or3: 20,
  orOfAnd: 20,
  rangeYear2: 10,
  rangeYear3: 10,
  rangeYear5: 8,
  rangeMonth1: 12,
  rangeMonth3: 10,
  rangeMonth6: 8,
  fuzzy1: 24,
  semantic1: 12,
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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
  if (docFreq >= 1001 && docFreq <= HIGH_MAX_DOC_FREQ) {
    return 'high';
  }
  return null;
}

function isEligibleKeyword(keyword) {
  return /^[a-z][a-z0-9]*$/.test(keyword)
    && keyword.length >= 4
    && keyword.length <= 24
    && !NOISE_KEYWORDS.has(keyword);
}

function bucketForResultCount(resultCount) {
  if (resultCount > HIGH_MAX_DOC_FREQ) {
    return 'high';
  }
  return bucketForDocFreq(resultCount) || 'high';
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
        used.add(i);
      }
    }
  }

  return selected;
}

function lastCommaSplit(line) {
  const commaIndex = line.lastIndexOf(',');
  if (commaIndex === -1) {
    return null;
  }
  return [
    line.slice(0, commaIndex),
    line.slice(commaIndex + 1),
  ];
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
    const split = lastCommaSplit(line);
    if (!split) {
      continue;
    }

    const [keyword, docFreqText] = split;
    const docFreq = Number(docFreqText);
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
    const targetCount = CANDIDATE_SAMPLE_COUNTS[bucket];
    const sampled = sampleEvenly(items, targetCount);
    candidates[bucket] = sampled;
  }

  return candidates;
}

function getPostingsFiles() {
  return fs.readdirSync(INPUT_ROOT)
    .filter((name) => /^keyword_postings_part_\d+\.jsonl$/.test(name))
    .sort()
    .map((name) => path.join(INPUT_ROOT, name));
}

function getProcessedFiles() {
  return fs.readdirSync(PROCESSED_ROOT)
    .filter((name) => /^enron_emails_part_\d+\.jsonl$/.test(name))
    .sort()
    .map((name) => path.join(PROCESSED_ROOT, name));
}

async function loadPostingsIndex(targetKeywords, keywordMetadata) {
  const postingsFiles = getPostingsFiles();
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
    acc[item.bucket] = (acc[item.bucket] || 0) + 1;
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
      return [];
    }
    for (const docId of entry.postings) {
      docs.add(docId);
    }
  }
  return [...docs];
}

function keywordMetaRow(keyword, postingsIndex) {
  const entry = postingsIndex.get(keyword);
  return {
    keyword,
    bucket: entry.bucket,
    doc_freq: entry.doc_freq,
  };
}

function buildSingleKeywordQueries(candidates, postingsIndex) {
  const rows = [];
  let counter = 1;

  for (const bucket of ['rare', 'low', 'medium', 'high']) {
    for (const keywordRow of candidates[bucket]) {
      if (!postingsIndex.has(keywordRow.keyword)) {
        continue;
      }

      rows.push({
        query_id: `SQ_${String(counter).padStart(3, '0')}`,
        query_type: 'single_keyword',
        bucket,
        keyword: keywordRow.keyword,
        doc_freq: keywordRow.doc_freq,
        expected_result_count: keywordRow.doc_freq,
      });
      counter += 1;
    }
  }

  return rows;
}

function buildConjunctivePool(candidates, postingsIndex) {
  return [...candidates.medium, ...candidates.high].filter((row) => postingsIndex.has(row.keyword));
}

function targetOverlapRatio(clauseSize) {
  if (clauseSize >= 10) {
    return 0.7;
  }
  if (clauseSize >= 8) {
    return 0.62;
  }
  if (clauseSize >= 6) {
    return 0.5;
  }
  return 0.35;
}

function generatePairwiseConjunctiveCandidates(pool, postingsIndex, clauseSize) {
  const rows = [];

  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const keywords = [pool[i].keyword, pool[j].keyword];
      const intersection = intersectKeywords(keywords, postingsIndex);
      if (intersection.length < MIN_RESULT_FLOOR) {
        continue;
      }

      rows.push({
        query_type: `and_${clauseSize}`,
        keywords,
        bucket_profile: `${pool[i].bucket}+${pool[j].bucket}`,
        expected_result_count: intersection.length,
        example_doc_ids: intersection.slice(0, 5),
      });
    }
  }

  rows.sort((a, b) => a.expected_result_count - b.expected_result_count || a.keywords.join('|').localeCompare(b.keywords.join('|')));
  return rows;
}

function generateGreedyConjunctiveCandidates(pool, postingsIndex, clauseSize) {
  const rows = [];
  const seen = new Set();
  const overlapRatio = targetOverlapRatio(clauseSize);

  for (const seed of pool) {
    const selected = [seed.keyword];
    let currentDocs = postingsIndex.get(seed.keyword).postings.slice();
    const remaining = pool.filter((row) => row.keyword !== seed.keyword);

    while (selected.length < clauseSize) {
      let best = null;

      for (const candidate of remaining) {
        if (selected.includes(candidate.keyword)) {
          continue;
        }

        const overlapDocs = arrayIntersection(currentDocs, postingsIndex.get(candidate.keyword).postingsSet);
        if (overlapDocs.length < MIN_RESULT_FLOOR) {
          continue;
        }

        const targetSize = Math.max(1, Math.floor(currentDocs.length * overlapRatio));
        const score = Math.abs(overlapDocs.length - targetSize);

        if (!best || score < best.score || (score === best.score && overlapDocs.length < best.overlapDocs.length)) {
          best = {
            keyword: candidate.keyword,
            overlapDocs,
            score,
          };
        }
      }

      if (!best) {
        break;
      }

      selected.push(best.keyword);
      currentDocs = best.overlapDocs;
    }

    if (selected.length !== clauseSize || currentDocs.length < MIN_RESULT_FLOOR) {
      continue;
    }

    const normalized = selected.slice().sort().join('|');
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);

    rows.push({
      query_type: `and_${clauseSize}`,
      keywords: selected,
      bucket_profile: selected.map((keyword) => postingsIndex.get(keyword).bucket).join('+'),
      expected_result_count: currentDocs.length,
      example_doc_ids: currentDocs.slice(0, 5),
    });
  }

  rows.sort((a, b) => a.expected_result_count - b.expected_result_count || a.keywords.join('|').localeCompare(b.keywords.join('|')));
  return rows;
}

function generateConjunctiveCandidates(candidates, postingsIndex, clauseSize) {
  const pool = buildConjunctivePool(candidates, postingsIndex);
  if (clauseSize === 2) {
    return generatePairwiseConjunctiveCandidates(pool, postingsIndex, clauseSize);
  }
  return generateGreedyConjunctiveCandidates(pool, postingsIndex, clauseSize);
}

function generateOr2Candidates(candidates, postingsIndex) {
  const pool = Object.values(candidates).flat().filter((row) => postingsIndex.has(row.keyword));
  const rows = [];

  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const keywords = [pool[i].keyword, pool[j].keyword];
      const intersectionCount = intersectKeywords(keywords, postingsIndex).length;
      const unionCount = postingsIndex.get(pool[i].keyword).doc_freq
        + postingsIndex.get(pool[j].keyword).doc_freq
        - intersectionCount;

      rows.push({
        query_type: 'or_2',
        keywords,
        bucket_profile: `${pool[i].bucket}+${pool[j].bucket}`,
        expected_result_count: unionCount,
        overlap_count: intersectionCount,
      });
    }
  }

  rows.sort((a, b) => a.expected_result_count - b.expected_result_count || a.keywords.join('|').localeCompare(b.keywords.join('|')));
  return rows;
}

function generateOr3Candidates(candidates, postingsIndex) {
  const perBucketPool = [
    ...sampleEvenly(candidates.rare, 6),
    ...sampleEvenly(candidates.low, 6),
    ...sampleEvenly(candidates.medium, 8),
    ...sampleEvenly(candidates.high, 8),
  ].filter((row) => postingsIndex.has(row.keyword));

  const rows = [];

  for (let i = 0; i < perBucketPool.length; i += 1) {
    for (let j = i + 1; j < perBucketPool.length; j += 1) {
      for (let k = j + 1; k < perBucketPool.length; k += 1) {
        const keywords = [
          perBucketPool[i].keyword,
          perBucketPool[j].keyword,
          perBucketPool[k].keyword,
        ];
        const unionDocs = unionKeywords(keywords, postingsIndex);
        rows.push({
          query_type: 'or_3',
          keywords,
          bucket_profile: [
            perBucketPool[i].bucket,
            perBucketPool[j].bucket,
            perBucketPool[k].bucket,
          ].join('+'),
          expected_result_count: unionDocs.length,
        });
      }
    }
  }

  rows.sort((a, b) => a.expected_result_count - b.expected_result_count || a.keywords.join('|').localeCompare(b.keywords.join('|')));
  return rows;
}

function generateOrOfAndCandidates(and2Rows, postingsIndex) {
  const rows = [];
  const seen = new Set();

  for (let i = 0; i < and2Rows.length; i += 1) {
    const left = and2Rows[i];
    const leftKeywords = new Set(left.keywords);
    const leftDocs = intersectKeywords(left.keywords, postingsIndex);

    for (let j = i + 1; j < and2Rows.length; j += 1) {
      const right = and2Rows[j];
      if (right.keywords.some((keyword) => leftKeywords.has(keyword))) {
        continue;
      }

      const rightDocs = intersectKeywords(right.keywords, postingsIndex);
      if (!leftDocs.length || !rightDocs.length) {
        continue;
      }

      const normalized = [
        left.keywords.slice().sort().join('&'),
        right.keywords.slice().sort().join('&'),
      ].sort().join('||');

      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);

      const unionDocs = new Set([...leftDocs, ...rightDocs]);
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

function selectQueries(candidates, targetCount) {
  if (!candidates.length) {
    return [];
  }
  return sampleEvenly(candidates, Math.min(targetCount, candidates.length));
}

function attachQueryIds(rows, prefix) {
  return rows.map((row, index) => ({
    query_id: `${prefix}_${String(index + 1).padStart(3, '0')}`,
    ...row,
  }));
}

function writeCsv(filePath, rows, columns) {
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => {
      const value = Array.isArray(row[column]) ? row[column].join('|') : row[column];
      return csvEscape(value ?? '');
    }).join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function writeJsonl(filePath, rows) {
  const lines = rows.map((row) => JSON.stringify(row));
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function writeCandidateKeywords(candidates) {
  const rows = Object.values(candidates).flat();
  writeCsv(path.join(OUTPUT_ROOT, 'candidate_keywords.csv'), rows, ['bucket', 'keyword', 'doc_freq']);
  return rows;
}

function writeWorkloadFiles(fileStem, rows, columns) {
  writeCsv(path.join(OUTPUT_ROOT, `${fileStem}.csv`), rows, columns);
  writeJsonl(path.join(OUTPUT_ROOT, `${fileStem}.jsonl`), rows);
}

function parseYearFromDateRaw(dateRaw) {
  if (!dateRaw) {
    return null;
  }
  const parsed = Date.parse(dateRaw);
  if (Number.isNaN(parsed)) {
    return null;
  }
  const year = new Date(parsed).getUTCFullYear();
  if (!Number.isFinite(year) || year < 1970 || year > 2035) {
    return null;
  }
  return year;
}

function formatMonthKeyFromDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthKeyToIndex(monthKey) {
  const [yearText, monthText] = String(monthKey).split('-');
  return Number(yearText) * 12 + (Number(monthText) - 1);
}

function isCoreMonthKey(monthKey) {
  const [yearText] = String(monthKey).split('-');
  const year = Number(yearText);
  return year >= 1999 && year <= 2002;
}

async function buildTemporalIndexes() {
  const yearToDocs = new Map();
  const monthToDocs = new Map();

  for (const filePath of getProcessedFiles()) {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }

      const row = JSON.parse(line);
      const year = parseYearFromDateRaw(row.date_raw);
      if (year == null || !row.doc_id) {
        continue;
      }
      const parsed = Date.parse(row.date_raw);
      if (Number.isNaN(parsed)) {
        continue;
      }
      const monthKey = formatMonthKeyFromDate(new Date(parsed));

      let docs = yearToDocs.get(year);
      if (!docs) {
        docs = [];
        yearToDocs.set(year, docs);
      }
      docs.push(row.doc_id);

      let monthDocs = monthToDocs.get(monthKey);
      if (!monthDocs) {
        monthDocs = [];
        monthToDocs.set(monthKey, monthDocs);
      }
      monthDocs.push(row.doc_id);
    }
  }

  return { yearToDocs, monthToDocs };
}

function buildRangeYearQueries(yearToDocs) {
  const windows = [2, 3, 5];
  const sortedYears = [...yearToDocs.keys()].sort((a, b) => a - b);
  const groupedRows = {
    rangeYear2: [],
    rangeYear3: [],
    rangeYear5: [],
  };

  for (const windowSize of windows) {
    for (let i = 0; i <= sortedYears.length - windowSize; i += 1) {
      const years = sortedYears.slice(i, i + windowSize);
      let contiguous = true;
      for (let j = 1; j < years.length; j += 1) {
        if (years[j] !== years[j - 1] + 1) {
          contiguous = false;
          break;
        }
      }
      if (!contiguous) {
        continue;
      }

      const expectedResultCount = years.reduce((sum, year) => sum + (yearToDocs.get(year)?.length || 0), 0);
      groupedRows[`rangeYear${windowSize}`].push({
        query_type: `range_year_${windowSize}`,
        bucket_profile: `${years[0]}-${years[years.length - 1]}`,
        range_field: 'email_year',
        range_start: String(years[0]),
        range_end: String(years[years.length - 1]),
        range_values: years.map((year) => String(year)),
        expected_result_count: expectedResultCount,
      });
    }
  }

  const rangeYear2Queries = attachQueryIds(selectQueries(groupedRows.rangeYear2, TARGET_QUERY_COUNTS.rangeYear2), 'RY2');
  const rangeYear3Queries = attachQueryIds(selectQueries(groupedRows.rangeYear3, TARGET_QUERY_COUNTS.rangeYear3), 'RY3');
  const rangeYear5Queries = attachQueryIds(selectQueries(groupedRows.rangeYear5, TARGET_QUERY_COUNTS.rangeYear5), 'RY5');

  return [
    ...rangeYear2Queries,
    ...rangeYear3Queries,
    ...rangeYear5Queries,
  ];
}

function buildRangeMonthQueries(monthToDocs) {
  const windows = [
    { size: 1, targetCount: TARGET_QUERY_COUNTS.rangeMonth1, prefix: 'RM1', type: 'range_month_1' },
    { size: 3, targetCount: TARGET_QUERY_COUNTS.rangeMonth3, prefix: 'RM3', type: 'range_month_3' },
    { size: 6, targetCount: TARGET_QUERY_COUNTS.rangeMonth6, prefix: 'RM6', type: 'range_month_6' },
  ];

  const sortedMonths = [...monthToDocs.keys()]
    .filter((monthKey) => isCoreMonthKey(monthKey) && (monthToDocs.get(monthKey)?.length || 0) >= 20)
    .sort();

  const outputRows = [];

  for (const window of windows) {
    const candidates = [];

    for (let i = 0; i <= sortedMonths.length - window.size; i += 1) {
      const months = sortedMonths.slice(i, i + window.size);
      let contiguous = true;
      for (let j = 1; j < months.length; j += 1) {
        if (monthKeyToIndex(months[j]) !== monthKeyToIndex(months[j - 1]) + 1) {
          contiguous = false;
          break;
        }
      }
      if (!contiguous) {
        continue;
      }

      const expectedResultCount = months.reduce((sum, monthKey) => sum + (monthToDocs.get(monthKey)?.length || 0), 0);
      candidates.push({
        query_type: window.type,
        bucket_profile: `${months[0]}..${months[months.length - 1]}`,
        range_field: 'email_month',
        range_start: months[0],
        range_end: months[months.length - 1],
        range_values: months,
        expected_result_count: expectedResultCount,
      });
    }

    outputRows.push(
      ...attachQueryIds(selectQueries(candidates, window.targetCount), window.prefix),
    );
  }

  return outputRows;
}

function makeFuzzyVariant(keyword) {
  if (keyword.length <= 4) {
    return `${keyword}x`;
  }
  return `${keyword.slice(0, keyword.length - 2)}${keyword.slice(keyword.length - 1)}`;
}

function buildFuzzyQueries(candidates, postingsIndex) {
  const pool = [
    ...sampleEvenly(candidates.rare, 6),
    ...sampleEvenly(candidates.low, 6),
    ...sampleEvenly(candidates.medium, 6),
    ...sampleEvenly(candidates.high, 6),
  ].filter((row) => postingsIndex.has(row.keyword));

  const rows = pool.map((row) => ({
    query_type: 'fuzzy_1',
    bucket_profile: row.bucket,
    fuzzy_term: makeFuzzyVariant(row.keyword),
    matched_keywords: [row.keyword],
    expected_result_count: row.doc_freq,
    max_edit_distance: 1,
  }));

  return attachQueryIds(selectQueries(rows, TARGET_QUERY_COUNTS.fuzzy1), 'FQ1');
}

function buildSemanticQueries(postingsIndex) {
  const concepts = resolveSemanticConcepts(new Set(postingsIndex.keys()));
  const rows = [];

  for (const concept of concepts) {
    const candidateDocs = new Set();
    for (const keyword of concept.matched_keywords) {
      const entry = postingsIndex.get(keyword);
      if (!entry) {
        continue;
      }
      for (const docId of entry.postings) {
        candidateDocs.add(docId);
      }
    }

    const expectedResultCount = Math.min(DEFAULT_SEMANTIC_TOP_K, candidateDocs.size);
    if (expectedResultCount === 0) {
      continue;
    }

    rows.push({
      query_type: 'semantic_v1',
      bucket_profile: bucketForResultCount(candidateDocs.size),
      semantic_concept: concept.concept_id,
      query_text: concept.query_text,
      semantic_keywords: concept.primary_terms,
      matched_keywords: concept.matched_keywords,
      semantic_top_k: expectedResultCount,
      candidate_result_count: candidateDocs.size,
      expected_result_count: expectedResultCount,
    });
  }

  return attachQueryIds(selectQueries(rows, TARGET_QUERY_COUNTS.semantic1), 'SQ1');
}

async function main() {
  ensureDir(OUTPUT_ROOT);

  const bucketedKeywords = parseFrequencyCsv();
  const candidates = pickCandidateKeywords(bucketedKeywords);
  const candidateRows = writeCandidateKeywords(candidates);

  const keywordMetadata = new Map(candidateRows.map((row) => [row.keyword, row]));
  const semanticLexiconTerms = new Set(
    SEMANTIC_CONCEPTS.flatMap((concept) => [
      ...(concept.primary_terms || []),
      ...(concept.expansion_terms || []),
    ]),
  );
  const targetKeywords = [...new Set([
    ...candidateRows.map((row) => row.keyword),
    ...semanticLexiconTerms,
  ])];
  const postingsIndex = await loadPostingsIndex(targetKeywords, keywordMetadata);

  const singleKeywordQueries = buildSingleKeywordQueries(candidates, postingsIndex);
  const and2Queries = attachQueryIds(selectQueries(generateConjunctiveCandidates(candidates, postingsIndex, 2), TARGET_QUERY_COUNTS.and2), 'AQ2');
  const and4Queries = attachQueryIds(selectQueries(generateConjunctiveCandidates(candidates, postingsIndex, 4), TARGET_QUERY_COUNTS.and4), 'AQ4');
  const and5Queries = attachQueryIds(selectQueries(generateConjunctiveCandidates(candidates, postingsIndex, 5), TARGET_QUERY_COUNTS.and5), 'AQ5');
  const and6Queries = attachQueryIds(selectQueries(generateConjunctiveCandidates(candidates, postingsIndex, 6), TARGET_QUERY_COUNTS.and6), 'AQ6');
  const and8Queries = attachQueryIds(selectQueries(generateConjunctiveCandidates(candidates, postingsIndex, 8), TARGET_QUERY_COUNTS.and8), 'AQ8');
  const and10Queries = attachQueryIds(selectQueries(generateConjunctiveCandidates(candidates, postingsIndex, 10), TARGET_QUERY_COUNTS.and10), 'AQ10');
  const or2Queries = attachQueryIds(selectQueries(generateOr2Candidates(candidates, postingsIndex), TARGET_QUERY_COUNTS.or2), 'OQ2');
  const or3Queries = attachQueryIds(selectQueries(generateOr3Candidates(candidates, postingsIndex), TARGET_QUERY_COUNTS.or3), 'OQ3');
  const orOfAndQueries = attachQueryIds(selectQueries(generateOrOfAndCandidates(and2Queries, postingsIndex), TARGET_QUERY_COUNTS.orOfAnd), 'OOA');
  const { yearToDocs, monthToDocs } = await buildTemporalIndexes();
  const rangeQueries = buildRangeYearQueries(yearToDocs);
  const rangeMonthQueries = buildRangeMonthQueries(monthToDocs);
  const fuzzyQueries = buildFuzzyQueries(candidates, postingsIndex);
  const semanticQueries = buildSemanticQueries(postingsIndex);

  writeWorkloadFiles('single_keyword_queries', singleKeywordQueries, [
    'query_id',
    'query_type',
    'bucket',
    'keyword',
    'doc_freq',
    'expected_result_count',
  ]);

  writeWorkloadFiles('and_queries', [
    ...and2Queries,
    ...and4Queries,
    ...and5Queries,
    ...and6Queries,
    ...and8Queries,
    ...and10Queries,
  ], [
    'query_id',
    'query_type',
    'bucket_profile',
    'keywords',
    'expected_result_count',
    'example_doc_ids',
  ]);

  writeWorkloadFiles('or_queries', [...or2Queries, ...or3Queries], [
    'query_id',
    'query_type',
    'bucket_profile',
    'keywords',
    'expected_result_count',
    'overlap_count',
  ]);

  writeWorkloadFiles('or_of_and_queries', orOfAndQueries, [
    'query_id',
    'query_type',
    'clause_1_keywords',
    'clause_2_keywords',
    'clause_1_result_count',
    'clause_2_result_count',
    'expected_result_count',
  ]);

  writeWorkloadFiles('range_queries', [...rangeQueries, ...rangeMonthQueries], [
    'query_id',
    'query_type',
    'bucket_profile',
    'range_field',
    'range_start',
    'range_end',
    'range_values',
    'expected_result_count',
  ]);

  writeWorkloadFiles('fuzzy_queries', fuzzyQueries, [
    'query_id',
    'query_type',
    'bucket_profile',
    'fuzzy_term',
    'matched_keywords',
    'max_edit_distance',
    'expected_result_count',
  ]);

  writeWorkloadFiles('semantic_queries', semanticQueries, [
    'query_id',
    'query_type',
    'bucket_profile',
    'semantic_concept',
    'query_text',
    'semantic_keywords',
    'matched_keywords',
    'semantic_top_k',
    'candidate_result_count',
    'expected_result_count',
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
        total: and2Queries.length + and4Queries.length + and5Queries.length + and6Queries.length + and8Queries.length + and10Queries.length,
        and_2: and2Queries.length,
        and_4: and4Queries.length,
        and_5: and5Queries.length,
        and_6: and6Queries.length,
        and_8: and8Queries.length,
        and_10: and10Queries.length,
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
        total: rangeQueries.length + rangeMonthQueries.length,
        range_year_2: rangeQueries.filter((row) => row.query_type === 'range_year_2').length,
        range_year_3: rangeQueries.filter((row) => row.query_type === 'range_year_3').length,
        range_year_5: rangeQueries.filter((row) => row.query_type === 'range_year_5').length,
        range_month_1: rangeMonthQueries.filter((row) => row.query_type === 'range_month_1').length,
        range_month_3: rangeMonthQueries.filter((row) => row.query_type === 'range_month_3').length,
        range_month_6: rangeMonthQueries.filter((row) => row.query_type === 'range_month_6').length,
      },
      fuzzy_queries: {
        total: fuzzyQueries.length,
        fuzzy_1: fuzzyQueries.length,
      },
      semantic_queries: {
        total: semanticQueries.length,
        semantic_v1: semanticQueries.length,
      },
    },
  };

  const manifest = {
    generated_at: summary.generated_at,
    dataset: 'Enron Email Corpus',
    dataset_root: 'NweDB/enron_processed',
    index_root: 'NweDB/enron_inverted_index',
    workload_root: 'NweDB/enron_query_workloads',
    experiment_mapping: [
      {
        experiment_set: 'EXP-2 Part B',
        paper_role: 'SeaCQ-style encrypted conjunctive baseline',
        recommended_files: [
          'single_keyword_queries.csv',
          'and_queries.csv',
        ],
        recommended_query_types: [
          'single_keyword',
          'and_2',
          'and_4',
          'and_6',
          'and_8',
          'and_10',
          'and_5',
        ],
        counts: {
          single_keyword: singleKeywordQueries.length,
          and_2: and2Queries.length,
          and_4: and4Queries.length,
          and_5: and5Queries.length,
          and_6: and6Queries.length,
          and_8: and8Queries.length,
          and_10: and10Queries.length,
        },
        notes: [
          'Use and_2, and_4, and_6, and_8, and_10 for direct SeaCQ keyword-count sweep alignment.',
          'Keep and_5 for internal interpolation and continuity with earlier PrivSearch prototype runs.',
        ],
      },
      {
        experiment_set: 'EXP-2 Part C',
        paper_role: 'PrivSearch encrypted disjunctive extension',
        recommended_files: [
          'or_queries.csv',
          'or_of_and_queries.csv',
        ],
        recommended_query_types: [
          'or_2',
          'or_3',
          'or_of_and',
        ],
        counts: {
          or_2: or2Queries.length,
          or_3: or3Queries.length,
          or_of_and: orOfAndQueries.length,
        },
      },
      {
        experiment_set: 'EXP-4 Part A',
        paper_role: 'Clause-count sweep for authenticated OR search',
        recommended_files: [
          'or_queries.csv',
          'or_of_and_queries.csv',
        ],
        recommended_query_types: [
          'or_2',
          'or_3',
          'or_of_and',
        ],
        notes: [
          'Use or_2 rows for 2-clause measurements',
          'Use or_3 rows for 3-clause measurements',
          'Use or_of_and rows for DNF-style OR-of-conjunction evaluation',
        ],
      },
      {
        experiment_set: 'EXP-4 Part B',
        paper_role: 'PrivSearch authenticated range-search extension',
        recommended_files: [
          'range_queries.csv',
        ],
        recommended_query_types: [
          'range_year_2',
          'range_year_3',
          'range_year_5',
          'range_month_1',
          'range_month_3',
          'range_month_6',
        ],
        counts: {
          range_year_2: rangeQueries.filter((row) => row.query_type === 'range_year_2').length,
          range_year_3: rangeQueries.filter((row) => row.query_type === 'range_year_3').length,
          range_year_5: rangeQueries.filter((row) => row.query_type === 'range_year_5').length,
          range_month_1: rangeMonthQueries.filter((row) => row.query_type === 'range_month_1').length,
          range_month_3: rangeMonthQueries.filter((row) => row.query_type === 'range_month_3').length,
          range_month_6: rangeMonthQueries.filter((row) => row.query_type === 'range_month_6').length,
        },
        notes: [
          'These queries evaluate contiguous year-range retrieval over Enron email metadata.',
          'Each range is represented as a union over authenticated per-year postings.',
          'Month-level windows provide a finer-grained cardinality sweep inside the dense 1999-2002 interval.',
        ],
      },
      {
        experiment_set: 'EXP-4 Part C',
        paper_role: 'PrivSearch fuzzy keyword extension',
        recommended_files: [
          'fuzzy_queries.csv',
        ],
        recommended_query_types: [
          'fuzzy_1',
        ],
        counts: {
          fuzzy_1: fuzzyQueries.length,
        },
        notes: [
          'Each fuzzy query uses a one-edit variant and resolves to a curated authenticated keyword-expansion set.',
          'This benchmark isolates fuzzy trapdoor-expansion cost from later semantic-search work.',
        ],
      },
      {
        experiment_set: 'EXP-4 Part D',
        paper_role: 'PrivSearch semantic search v1 extension',
        recommended_files: [
          'semantic_queries.csv',
        ],
        recommended_query_types: [
          'semantic_v1',
        ],
        counts: {
          semantic_v1: semanticQueries.length,
        },
        notes: [
          'Semantic v1 uses concept-expanded authenticated retrieval rather than embeddings or neural encoders.',
          'This makes semantic search executable in the current PrivSearch prototype while keeping verification tractable.',
        ],
      },
    ],
  };

  fs.writeFileSync(path.join(OUTPUT_ROOT, 'enron_query_workloads_summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'experiment_workload_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  console.log(`Prepared Enron query workloads in ${OUTPUT_ROOT}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('prepare-enron-query-workloads failed:', error);
  process.exitCode = 1;
});
