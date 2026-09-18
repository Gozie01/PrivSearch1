require('dotenv/config');

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const INPUT_ROOT = path.join(ROOT, 'NweDB', 'enron_processed');
const OUTPUT_ROOT = path.join(ROOT, 'NweDB', 'enron_keywords');
const DOC_KEYWORDS_BASENAME = 'enron_doc_keywords';
const DOC_KEYWORDS_SHARD_SIZE = 100000;
const KEYWORD_STATS_CSV = path.join(OUTPUT_ROOT, 'enron_keyword_document_frequency.csv');
const QUERY_SAMPLES_CSV = path.join(OUTPUT_ROOT, 'enron_query_samples.csv');
const SUMMARY_JSON = path.join(OUTPUT_ROOT, 'enron_keywords_summary.json');

const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'could',
  'did', 'do', 'does', 'doing', 'down', 'during',
  'each',
  'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'just',
  'me', 'more', 'most', 'my', 'myself',
  'no', 'nor', 'not', 'now',
  'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'same', 'she', 'should', 'so', 'some', 'such',
  'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this',
  'those', 'through', 'to', 'too',
  'under', 'until', 'up',
  'very',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'subject', 'from', 'sent', 'message', 'original', 'forwarded', 'please', 'thanks', 'thank',
  'enron', 'com', 'http', 'https', 'www',
  'will', 'know', 'may', 'let', 'get', 'new', 'need', 'call', 'also', 'one', 'information',
  'attached', 'like', 'see', 'questions', 'mail', 'make', 'today', 'email', 'day', 'contact',
  'week', 'last', 'date', 'use', 'work', 'want', 'help', 'meeting', 'review', 'following',
  'back', 'take', 'group', 'well',
]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function createDocKeywordShard(index) {
  const name = `${DOC_KEYWORDS_BASENAME}_part_${String(index).padStart(3, '0')}.jsonl`;
  return {
    index,
    rowCount: 0,
    path: path.join(OUTPUT_ROOT, name),
    stream: fs.createWriteStream(path.join(OUTPUT_ROOT, name), { encoding: 'utf8' }),
  };
}

function finishStream(stream) {
  return new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.end(resolve);
  });
}

function writeWithBackpressure(stream, text) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      stream.off('drain', onDrain);
      reject(error);
    };

    const onDrain = () => {
      stream.off('error', onError);
      resolve();
    };

    stream.once('error', onError);
    const canContinue = stream.write(text, 'utf8', () => {
      if (canContinue) {
        stream.off('error', onError);
        resolve();
      }
    });

    if (!canContinue) {
      stream.once('drain', onDrain);
    }
  });
}

function tokenize(text) {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const keywords = [];
  const seen = new Set();

  for (const token of tokens) {
    if (token.length < 3 || token.length > 32) {
      continue;
    }
    if (STOPWORDS.has(token)) {
      continue;
    }
    if (!/^[a-z][a-z0-9]*$/.test(token)) {
      continue;
    }
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    keywords.push(token);
  }

  return keywords;
}

function chooseQuerySamples(statsRows) {
  const rare = statsRows.filter((row) => row.doc_freq >= 5 && row.doc_freq <= 20).slice(0, 20);
  const medium = statsRows.filter((row) => row.doc_freq >= 50 && row.doc_freq <= 200).slice(0, 20);
  const frequent = statsRows.filter((row) => row.doc_freq >= 500 && row.doc_freq <= 2000).slice(0, 20);

  const samples = [];
  for (const row of rare) samples.push({ bucket: 'rare', keyword: row.keyword, doc_freq: row.doc_freq });
  for (const row of medium) samples.push({ bucket: 'medium', keyword: row.keyword, doc_freq: row.doc_freq });
  for (const row of frequent) samples.push({ bucket: 'frequent', keyword: row.keyword, doc_freq: row.doc_freq });
  return samples;
}

async function processShard(filePath, keywordDf, summary, queryPairExamples, shardState) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    const row = JSON.parse(line);
    const keywords = tokenize(`${row.subject || ''} ${row.body || ''}`);

    summary.counts.documents += 1;
    summary.counts.documents_with_keywords += keywords.length > 0 ? 1 : 0;
    summary.counts.total_keyword_assignments += keywords.length;

    if (summary.counts.documents % 50000 === 0) {
      console.log(`Tokenized ${summary.counts.documents} documents...`);
    }

    for (const keyword of keywords) {
      keywordDf.set(keyword, (keywordDf.get(keyword) || 0) + 1);
    }

    if (keywords.length >= 2 && queryPairExamples.length < 200) {
      queryPairExamples.push({
        keyword_1: keywords[0],
        keyword_2: keywords[1],
        doc_id: row.doc_id,
      });
    }

    const outputRow = {
      doc_id: row.doc_id,
      employee: row.employee,
      mailbox_folder: row.mailbox_folder,
      subject: row.subject,
      keyword_count: keywords.length,
      keywords,
    };

    if (shardState.current.rowCount >= DOC_KEYWORDS_SHARD_SIZE) {
      await finishStream(shardState.current.stream);
      shardState.current = createDocKeywordShard(shardState.current.index + 1);
    }

    await writeWithBackpressure(shardState.current.stream, `${JSON.stringify(outputRow)}\n`);
    shardState.current.rowCount += 1;
  }
}

async function main() {
  ensureDir(OUTPUT_ROOT);

  const inputFiles = fs.readdirSync(INPUT_ROOT)
    .filter((name) => /^enron_emails_part_\d+\.jsonl$/.test(name))
    .sort()
    .map((name) => path.join(INPUT_ROOT, name));

  if (!inputFiles.length) {
    throw new Error(`No Enron JSONL shards found in ${INPUT_ROOT}`);
  }

  const keywordDf = new Map();
  const queryPairExamples = [];
  const summary = {
    generated_at: new Date().toISOString(),
    source_files: inputFiles.map((file) => path.relative(ROOT, file)),
    counts: {
      documents: 0,
      documents_with_keywords: 0,
      total_keyword_assignments: 0,
      unique_keywords: 0,
      doc_keyword_shards: 0,
    },
    top_keywords: [],
  };

  const shardState = {
    current: createDocKeywordShard(1),
  };

  for (const file of inputFiles) {
    await processShard(file, keywordDf, summary, queryPairExamples, shardState);
  }

  await finishStream(shardState.current.stream);
  summary.counts.doc_keyword_shards = shardState.current.index;

  const statsRows = [...keywordDf.entries()]
    .map(([keyword, docFreq]) => ({ keyword, doc_freq: docFreq }))
    .sort((a, b) => b.doc_freq - a.doc_freq || a.keyword.localeCompare(b.keyword));

  summary.counts.unique_keywords = statsRows.length;
  summary.top_keywords = statsRows.slice(0, 50);

  const keywordStatsCsv = [
    'keyword,doc_freq',
    ...statsRows.map((row) => `${csvEscape(row.keyword)},${row.doc_freq}`),
  ].join('\n');
  fs.writeFileSync(KEYWORD_STATS_CSV, keywordStatsCsv, 'utf8');

  const querySamples = chooseQuerySamples(statsRows);
  const queryCsvLines = ['bucket,query_type,keyword_1,keyword_2,doc_freq_1,doc_freq_2,example_doc_id'];
  for (const sample of querySamples) {
    queryCsvLines.push([
      sample.bucket,
      'single',
      csvEscape(sample.keyword),
      '',
      sample.doc_freq,
      '',
      '',
    ].join(','));
  }

  for (const pair of queryPairExamples.slice(0, 100)) {
    const df1 = keywordDf.get(pair.keyword_1) || 0;
    const df2 = keywordDf.get(pair.keyword_2) || 0;
    queryCsvLines.push([
      df1 <= 20 && df2 <= 20 ? 'rare_pair' : 'mixed_pair',
      'conjunctive_pair',
      csvEscape(pair.keyword_1),
      csvEscape(pair.keyword_2),
      df1,
      df2,
      csvEscape(pair.doc_id),
    ].join(','));
  }
  fs.writeFileSync(QUERY_SAMPLES_CSV, queryCsvLines.join('\n'), 'utf8');

  fs.writeFileSync(SUMMARY_JSON, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`Prepared Enron keyword outputs in ${OUTPUT_ROOT}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('prepare-enron-keywords failed:', error);
  process.exitCode = 1;
});
