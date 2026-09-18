require('dotenv/config');

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const INPUT_ROOT = path.join(ROOT, 'NweDB', 'enron_keywords');
const OUTPUT_ROOT = path.join(ROOT, 'NweDB', 'enron_inverted_index');
const TEMP_ROOT = path.join(OUTPUT_ROOT, '_tmp_pair_buckets');

const BUCKET_COUNT = 64;
const BUFFER_FLUSH_BYTES = 1024 * 1024;
const POSTINGS_PER_SHARD = 20000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function hashKeyword(keyword) {
  let hash = 2166136261;
  for (let i = 0; i < keyword.length; i += 1) {
    hash ^= keyword.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % BUCKET_COUNT;
}

function getInputFiles() {
  return fs.readdirSync(INPUT_ROOT)
    .filter((name) => /^enron_doc_keywords_part_\d+\.jsonl$/.test(name))
    .sort()
    .map((name) => path.join(INPUT_ROOT, name));
}

function resetOutputDirs() {
  fs.rmSync(OUTPUT_ROOT, { recursive: true, force: true });
  ensureDir(OUTPUT_ROOT);
  ensureDir(TEMP_ROOT);
}

function initBucketWriters() {
  const writers = [];
  for (let i = 0; i < BUCKET_COUNT; i += 1) {
    const bucketPath = path.join(TEMP_ROOT, `bucket_${String(i).padStart(3, '0')}.tsv`);
    const fd = fs.openSync(bucketPath, 'w');
    writers.push({
      path: bucketPath,
      fd,
      buffer: '',
      bufferedBytes: 0,
      lineCount: 0,
    });
  }
  return writers;
}

function flushBucket(writer) {
  if (!writer.buffer) {
    return;
  }
  fs.writeSync(writer.fd, writer.buffer, null, 'utf8');
  writer.buffer = '';
  writer.bufferedBytes = 0;
}

function closeBucketWriters(writers) {
  for (const writer of writers) {
    flushBucket(writer);
    fs.closeSync(writer.fd);
  }
}

async function bucketKeywordPairs(inputFiles, summary) {
  const writers = initBucketWriters();

  try {
    for (const file of inputFiles) {
      const rl = readline.createInterface({
        input: fs.createReadStream(file, { encoding: 'utf8' }),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line.trim()) {
          continue;
        }

        const row = JSON.parse(line);
        const docId = row.doc_id;
        const keywords = Array.isArray(row.keywords) ? row.keywords : [];

        summary.counts.documents += 1;
        summary.counts.total_keyword_assignments += keywords.length;

        if (summary.counts.documents % 50000 === 0) {
          console.log(`Bucketed ${summary.counts.documents} documents...`);
        }

        for (const keyword of keywords) {
          const bucket = hashKeyword(keyword);
          const writer = writers[bucket];
          const record = `${keyword}\t${docId}\n`;
          writer.buffer += record;
          writer.bufferedBytes += Buffer.byteLength(record);
          writer.lineCount += 1;

          if (writer.bufferedBytes >= BUFFER_FLUSH_BYTES) {
            flushBucket(writer);
          }
        }
      }
    }
  } finally {
    closeBucketWriters(writers);
  }

  summary.counts.bucket_files = BUCKET_COUNT;
  summary.counts.bucket_pair_rows = writers.reduce((sum, writer) => sum + writer.lineCount, 0);
}

function createPostingsShard(index) {
  const filePath = path.join(OUTPUT_ROOT, `keyword_postings_part_${String(index).padStart(3, '0')}.jsonl`);
  return {
    index,
    rowCount: 0,
    stream: fs.createWriteStream(filePath, { encoding: 'utf8' }),
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

function updateBucketBreakdown(summary, docFreq) {
  if (docFreq >= 5 && docFreq <= 20) {
    summary.keyword_frequency_buckets.rare_5_20 += 1;
  } else if (docFreq >= 21 && docFreq <= 100) {
    summary.keyword_frequency_buckets.low_21_100 += 1;
  } else if (docFreq >= 101 && docFreq <= 1000) {
    summary.keyword_frequency_buckets.medium_101_1000 += 1;
  } else if (docFreq > 1000) {
    summary.keyword_frequency_buckets.high_gt_1000 += 1;
  }
}

async function aggregateBuckets(summary) {
  let postingsShard = createPostingsShard(1);
  const keywordStats = [];

  for (let bucketIndex = 0; bucketIndex < BUCKET_COUNT; bucketIndex += 1) {
    const bucketPath = path.join(TEMP_ROOT, `bucket_${String(bucketIndex).padStart(3, '0')}.tsv`);
    if (!fs.existsSync(bucketPath)) {
      continue;
    }

    const postings = new Map();
    const rl = readline.createInterface({
      input: fs.createReadStream(bucketPath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line) {
        continue;
      }
      const tabIndex = line.indexOf('\t');
      if (tabIndex === -1) {
        continue;
      }

      const keyword = line.slice(0, tabIndex);
      const docId = line.slice(tabIndex + 1);

      let entry = postings.get(keyword);
      if (!entry) {
        entry = [];
        postings.set(keyword, entry);
      }
      entry.push(docId);
    }

    const sortedKeywords = [...postings.keys()].sort();
    for (const keyword of sortedKeywords) {
      const docIds = postings.get(keyword);
      const docFreq = docIds.length;
      const record = {
        keyword,
        doc_freq: docFreq,
        postings: docIds,
      };

      if (postingsShard.rowCount >= POSTINGS_PER_SHARD) {
        await finishStream(postingsShard.stream);
        postingsShard = createPostingsShard(postingsShard.index + 1);
      }

      await writeWithBackpressure(postingsShard.stream, `${JSON.stringify(record)}\n`);
      postingsShard.rowCount += 1;

      keywordStats.push({ keyword, doc_freq: docFreq });
      updateBucketBreakdown(summary, docFreq);
    }

    summary.counts.aggregated_buckets += 1;
    summary.counts.unique_keywords += postings.size;

    console.log(`Aggregated bucket ${bucketIndex + 1}/${BUCKET_COUNT} with ${postings.size} keywords`);
  }

  await finishStream(postingsShard.stream);
  summary.counts.postings_shards = postingsShard.index;
  return keywordStats.sort((a, b) => b.doc_freq - a.doc_freq || a.keyword.localeCompare(b.keyword));
}

function writeKeywordStats(keywordStats, summary) {
  const keywordStatsPath = path.join(OUTPUT_ROOT, 'keyword_postings_document_frequency.csv');
  const lines = ['keyword,doc_freq'];
  for (const row of keywordStats) {
    lines.push(`${csvEscape(row.keyword)},${row.doc_freq}`);
  }
  fs.writeFileSync(keywordStatsPath, lines.join('\n'), 'utf8');

  const benchmarkPath = path.join(OUTPUT_ROOT, 'benchmark_keywords.csv');
  const benchmarkLines = ['bucket,keyword,doc_freq'];
  const samples = [
    ...keywordStats.filter((row) => row.doc_freq >= 5 && row.doc_freq <= 20).slice(0, 50).map((row) => ({ bucket: 'rare_5_20', ...row })),
    ...keywordStats.filter((row) => row.doc_freq >= 21 && row.doc_freq <= 100).slice(0, 50).map((row) => ({ bucket: 'low_21_100', ...row })),
    ...keywordStats.filter((row) => row.doc_freq >= 101 && row.doc_freq <= 1000).slice(0, 50).map((row) => ({ bucket: 'medium_101_1000', ...row })),
    ...keywordStats.filter((row) => row.doc_freq > 1000).slice(0, 50).map((row) => ({ bucket: 'high_gt_1000', ...row })),
  ];
  for (const sample of samples) {
    benchmarkLines.push(`${sample.bucket},${csvEscape(sample.keyword)},${sample.doc_freq}`);
  }
  fs.writeFileSync(benchmarkPath, benchmarkLines.join('\n'), 'utf8');

  summary.top_keywords = keywordStats.slice(0, 100);
}

async function main() {
  const inputFiles = getInputFiles();
  if (!inputFiles.length) {
    throw new Error(`No keyword shards found in ${INPUT_ROOT}`);
  }

  resetOutputDirs();

  const summary = {
    generated_at: new Date().toISOString(),
    source_files: inputFiles.map((file) => path.relative(ROOT, file)),
    counts: {
      documents: 0,
      total_keyword_assignments: 0,
      bucket_files: 0,
      bucket_pair_rows: 0,
      aggregated_buckets: 0,
      unique_keywords: 0,
      postings_shards: 0,
    },
    keyword_frequency_buckets: {
      rare_5_20: 0,
      low_21_100: 0,
      medium_101_1000: 0,
      high_gt_1000: 0,
    },
    top_keywords: [],
  };

  await bucketKeywordPairs(inputFiles, summary);
  const keywordStats = await aggregateBuckets(summary);
  writeKeywordStats(keywordStats, summary);
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
  fs.writeFileSync(path.join(OUTPUT_ROOT, 'enron_inverted_index_summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  console.log(`Prepared Enron inverted index outputs in ${OUTPUT_ROOT}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('prepare-enron-inverted-index failed:', error);
  process.exitCode = 1;
});
