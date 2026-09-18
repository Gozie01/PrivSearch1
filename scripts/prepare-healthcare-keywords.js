require('dotenv/config');

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { tokenizeMixedHealthcareText } = require('./privsearch/healthcare-tokenizer');

const ROOT = path.resolve(__dirname, '..');
const INPUT_FILE = process.env.HEALTHCARE_CORPUS_FILE
  || path.join(ROOT, 'NweDB', 'healthcare', 'combined', 'healthcare_privsearch_corpus.jsonl');
const OUTPUT_ROOT = process.env.HEALTHCARE_KEYWORDS_ROOT
  || path.join(ROOT, 'NweDB', 'healthcare', 'keywords');
const DOC_KEYWORDS_BASENAME = 'healthcare_doc_keywords';
const DOC_KEYWORDS_SHARD_SIZE = 50000;

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

function chooseQuerySamples(statsRows) {
  const rare = statsRows.filter((row) => row.doc_freq >= 5 && row.doc_freq <= 20).slice(0, 20);
  const medium = statsRows.filter((row) => row.doc_freq >= 21 && row.doc_freq <= 100).slice(0, 20);
  const frequent = statsRows.filter((row) => row.doc_freq >= 101 && row.doc_freq <= 2000).slice(0, 20);

  return [
    ...rare.map((row) => ({ bucket: 'rare', ...row })),
    ...medium.map((row) => ({ bucket: 'medium', ...row })),
    ...frequent.map((row) => ({ bucket: 'frequent', ...row })),
  ];
}

async function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(`Healthcare corpus file not found: ${INPUT_FILE}`);
  }

  ensureDir(OUTPUT_ROOT);

  const keywordDf = new Map();
  const summary = {
    generated_at: new Date().toISOString(),
    source_file: path.relative(ROOT, INPUT_FILE),
    counts: {
      documents: 0,
      documents_with_keywords: 0,
      total_keyword_assignments: 0,
      unique_keywords: 0,
      doc_keyword_shards: 0,
    },
    dataset_breakdown: {},
    top_keywords: [],
  };

  const shardState = {
    current: createDocKeywordShard(1),
  };

  const rl = readline.createInterface({
    input: fs.createReadStream(INPUT_FILE, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    const row = JSON.parse(line);
    const keywords = tokenizeMixedHealthcareText(row.search_text || row.title || '');
    summary.counts.documents += 1;
    summary.counts.documents_with_keywords += keywords.length > 0 ? 1 : 0;
    summary.counts.total_keyword_assignments += keywords.length;
    summary.dataset_breakdown[row.dataset] = (summary.dataset_breakdown[row.dataset] || 0) + 1;

    if (summary.counts.documents % 25000 === 0) {
      console.log(`Tokenized ${summary.counts.documents} healthcare documents...`);
    }

    for (const keyword of keywords) {
      keywordDf.set(keyword, (keywordDf.get(keyword) || 0) + 1);
    }

    const outputRow = {
      doc_id: row.doc_id,
      dataset: row.dataset,
      patient_id: row.patient_id,
      facility_id: row.facility_id,
      record_type: row.record_type,
      date: row.date,
      title: row.title,
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

  await finishStream(shardState.current.stream);
  summary.counts.doc_keyword_shards = shardState.current.index;

  const statsRows = [...keywordDf.entries()]
    .map(([keyword, docFreq]) => ({ keyword, doc_freq: docFreq }))
    .sort((a, b) => b.doc_freq - a.doc_freq || a.keyword.localeCompare(b.keyword));

  summary.counts.unique_keywords = statsRows.length;
  summary.top_keywords = statsRows.slice(0, 100);

  const keywordStatsCsv = [
    'keyword,doc_freq',
    ...statsRows.map((row) => `${csvEscape(row.keyword)},${row.doc_freq}`),
  ].join('\n');
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'healthcare_keyword_document_frequency.csv'), `${keywordStatsCsv}\n`, 'utf8');

  const querySamples = chooseQuerySamples(statsRows);
  const queryCsvLines = ['bucket,query_type,keyword,doc_freq'];
  for (const sample of querySamples) {
    queryCsvLines.push([
      sample.bucket,
      'single',
      csvEscape(sample.keyword),
      sample.doc_freq,
    ].join(','));
  }
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'healthcare_query_samples.csv'), `${queryCsvLines.join('\n')}\n`, 'utf8');

  fs.writeFileSync(path.join(OUTPUT_ROOT, 'healthcare_keywords_summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  console.log(`Prepared healthcare keyword outputs in ${OUTPUT_ROOT}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('prepare-healthcare-keywords failed:', error);
  process.exitCode = 1;
});
