const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_WORKLOAD_ROOT = path.join(ROOT, 'NweDB', 'enron_query_workloads');
const DEFAULT_INDEX_ROOT = path.join(ROOT, 'NweDB', 'enron_inverted_index');

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(filePath, rows) {
  const output = rows.map((row) => row.map((value) => csvEscape(value)).join(',')).join('\n');
  fs.writeFileSync(filePath, `${output}\n`, 'utf8');
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

function parseKeywordList(value) {
  if (!value) {
    return [];
  }
  return String(value).split('|').filter(Boolean);
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

function normalizeWorkloadRow(row) {
  const query = {
    query_id: row.query_id,
    query_type: row.query_type,
    bucket_profile: row.bucket_profile || row.bucket || '',
    expected_result_count: Number(row.expected_result_count || '0'),
  };

  if (row.bucket) {
    query.bucket = row.bucket;
  }
  if (row.doc_freq) {
    query.doc_freq = Number(row.doc_freq || '0');
  }
  if (row.overlap_count) {
    query.overlap_count = Number(row.overlap_count || '0');
  }

  if (row.keyword) {
    query.keywords = [row.keyword];
  } else if (row.keywords) {
    query.keywords = parseKeywordList(row.keywords);
  } else {
    query.keywords = [];
  }

  if (row.clause_1_keywords) {
    query.clause_1_keywords = parseKeywordList(row.clause_1_keywords);
  }
  if (row.clause_2_keywords) {
    query.clause_2_keywords = parseKeywordList(row.clause_2_keywords);
  }
  if (row.matched_keywords) {
    query.matched_keywords = parseKeywordList(row.matched_keywords);
    if (!query.keywords.length) {
      query.keywords = query.matched_keywords.slice();
    }
  }
  if (row.semantic_keywords) {
    query.semantic_keywords = parseKeywordList(row.semantic_keywords);
  }
  if (row.semantic_concept) {
    query.semantic_concept = row.semantic_concept;
  }
  if (row.query_text) {
    query.query_text = row.query_text;
  }
  if (row.semantic_top_k) {
    query.semantic_top_k = Number(row.semantic_top_k || '0');
  }
  if (row.range_values) {
    query.range_values = parseKeywordList(row.range_values);
  }
  if (row.range_field) {
    query.range_field = row.range_field;
  }
  if (row.range_start) {
    query.range_start = row.range_start;
  }
  if (row.range_end) {
    query.range_end = row.range_end;
  }
  if (row.fuzzy_term) {
    query.fuzzy_term = row.fuzzy_term;
  }
  if (row.max_edit_distance) {
    query.max_edit_distance = Number(row.max_edit_distance || '0');
  }

  return query;
}

function loadWorkloads(options = {}) {
  const workloadRoot = options.workloadRoot || DEFAULT_WORKLOAD_ROOT;
  const workloadLimit = Number(options.workloadLimit || 0);
  const queryTypes = options.queryTypes
    || String(process.env.PRIVSEARCH_QUERY_TYPES || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  const files = [
    'single_keyword_queries.csv',
    'and_queries.csv',
    'or_queries.csv',
    'or_of_and_queries.csv',
    'range_queries.csv',
    'fuzzy_queries.csv',
    'semantic_queries.csv',
  ];

  let workloads = files.flatMap((name) => loadCsvObjects(path.join(workloadRoot, name)).map(normalizeWorkloadRow));
  if (queryTypes.length) {
    const queryTypeSet = new Set(queryTypes);
    workloads = workloads.filter((workload) => queryTypeSet.has(workload.query_type));
  }
  if (workloadLimit > 0) {
    return workloads.slice(0, workloadLimit);
  }
  return workloads;
}

function collectKeywords(workloads) {
  const keywords = new Set();
  for (const workload of workloads) {
    for (const keyword of workload.keywords || []) {
      keywords.add(keyword);
    }
    for (const keyword of workload.clause_1_keywords || []) {
      keywords.add(keyword);
    }
    for (const keyword of workload.clause_2_keywords || []) {
      keywords.add(keyword);
    }
    for (const keyword of workload.semantic_keywords || []) {
      keywords.add(keyword);
    }
  }
  return [...keywords];
}

function getPostingsFiles(indexRoot = DEFAULT_INDEX_ROOT) {
  return fs.readdirSync(indexRoot)
    .filter((name) => /^keyword_postings_part_\d+\.jsonl$/.test(name))
    .sort()
    .map((name) => path.join(indexRoot, name));
}

async function loadKeywordPostings(targetKeywords, options = {}) {
  const indexRoot = options.indexRoot || DEFAULT_INDEX_ROOT;
  const targetSet = new Set(targetKeywords);
  const postings = new Map();

  for (const filePath of getPostingsFiles(indexRoot)) {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf8' }),
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

      postings.set(row.keyword, {
        keyword: row.keyword,
        doc_freq: row.doc_freq,
        postings: row.postings,
        postingsSet: new Set(row.postings),
      });

      if (postings.size === targetSet.size) {
        return postings;
      }
    }
  }

  return postings;
}

function intersectPostingLists(entries) {
  if (!entries.length) {
    return [];
  }

  const sortedEntries = entries.slice().sort((a, b) => a.postings.length - b.postings.length);
  let docs = sortedEntries[0].postings.slice();

  for (let i = 1; i < sortedEntries.length; i += 1) {
    const lookup = sortedEntries[i].postingsSet;
    docs = docs.filter((docId) => lookup.has(docId));
    if (!docs.length) {
      break;
    }
  }

  return docs;
}

function unionPostingLists(entries) {
  const docs = new Set();
  for (const entry of entries) {
    for (const docId of entry.postings) {
      docs.add(docId);
    }
  }
  return [...docs];
}

module.exports = {
  ROOT,
  DEFAULT_WORKLOAD_ROOT,
  DEFAULT_INDEX_ROOT,
  writeCsv,
  loadWorkloads,
  collectKeywords,
  loadKeywordPostings,
  intersectPostingLists,
  unionPostingLists,
};
