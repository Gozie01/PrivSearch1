require('dotenv/config');

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT_ROOT = path.join(ROOT, 'NweDB', 'enron_mail_20150507', 'maildir');
const OUTPUT_ROOT = path.join(ROOT, 'NweDB', 'enron_processed');
const CSV_OUTPUT = path.join(OUTPUT_ROOT, 'enron_emails.csv');
const JSONL_BASENAME = 'enron_emails';
const SUMMARY_OUTPUT = path.join(OUTPUT_ROOT, 'enron_summary.json');
const JSONL_SHARD_SIZE = 100000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function toExtendedPath(filePath) {
  if (filePath.startsWith('\\\\?\\')) {
    return filePath;
  }
  return `\\\\?\\${path.resolve(filePath)}`;
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/\u0000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHeaderValue(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/\n[ \t]+/g, ' ')
    .replace(/\n/g, ' ')
    .trim();
}

function parseEmail(rawText) {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const headers = {};
  const bodyLines = [];
  let inHeaders = true;
  let currentHeader = null;

  for (const line of lines) {
    if (inHeaders) {
      if (line === '') {
        inHeaders = false;
        continue;
      }

      if ((line.startsWith(' ') || line.startsWith('\t')) && currentHeader) {
        headers[currentHeader] += ` ${line.trim()}`;
        continue;
      }

      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) {
        continue;
      }

      currentHeader = line.slice(0, colonIndex).toLowerCase();
      headers[currentHeader] = line.slice(colonIndex + 1).trim();
      continue;
    }

    bodyLines.push(line);
  }

  const body = bodyLines.join('\n');
  return {
    headers,
    body,
  };
}

function buildRow(docId, employee, mailboxFolder, fileName, email) {
  const headers = email.headers;
  const body = normalizeText(email.body);
  const subject = normalizeHeaderValue(headers.subject || '');
  const searchText = normalizeText(`${subject} ${body}`);

  return {
    doc_id: docId,
    employee,
    mailbox_folder: mailboxFolder,
    file_name: fileName,
    message_id: normalizeHeaderValue(headers['message-id'] || ''),
    date_raw: normalizeHeaderValue(headers.date || ''),
    from: normalizeHeaderValue(headers.from || ''),
    to: normalizeHeaderValue(headers.to || ''),
    cc: normalizeHeaderValue(headers.cc || ''),
    bcc: normalizeHeaderValue(headers.bcc || ''),
    subject,
    x_folder: normalizeHeaderValue(headers['x-folder'] || ''),
    x_origin: normalizeHeaderValue(headers['x-origin'] || ''),
    x_filename: normalizeHeaderValue(headers['x-filename'] || ''),
    content_type: normalizeHeaderValue(headers['content-type'] || ''),
    body_char_count: body.length,
    search_text: searchText,
    body,
  };
}

function* walkFiles(root) {
  const stack = [{ rawDir: toExtendedPath(root), relativeDir: '' }];

  while (stack.length) {
    const { rawDir, relativeDir } = stack.pop();
    const entries = fs.readdirSync(rawDir, { withFileTypes: true });

    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i];
      const nextRelative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      const nextRaw = path.join(rawDir, entry.name);

      if (entry.isDirectory()) {
        stack.push({ rawDir: nextRaw, relativeDir: nextRelative });
      } else if (entry.isFile()) {
        yield {
          rawPath: nextRaw,
          relativePath: nextRelative,
          fileName: entry.name,
        };
      }
    }
  }
}

function writeSummary(summary) {
  fs.writeFileSync(SUMMARY_OUTPUT, JSON.stringify(summary, null, 2), 'utf8');
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

function finishStream(stream) {
  return new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.end(resolve);
  });
}

function createJsonlShard(index) {
  const shardName = `${JSONL_BASENAME}_part_${String(index).padStart(3, '0')}.jsonl`;
  return {
    index,
    rowCount: 0,
    filePath: path.join(OUTPUT_ROOT, shardName),
    stream: fs.createWriteStream(path.join(OUTPUT_ROOT, shardName), { encoding: 'utf8' }),
  };
}

async function main() {
  if (!fs.existsSync(INPUT_ROOT)) {
    throw new Error(`Missing Enron input directory: ${INPUT_ROOT}`);
  }

  ensureDir(OUTPUT_ROOT);

  const csvColumns = [
    'doc_id',
    'employee',
    'mailbox_folder',
    'file_name',
    'message_id',
    'date_raw',
    'from',
    'to',
    'cc',
    'bcc',
    'subject',
    'x_folder',
    'x_origin',
    'x_filename',
    'content_type',
    'body_char_count',
    'search_text',
  ];

  const csvStream = fs.createWriteStream(CSV_OUTPUT, { encoding: 'utf8' });
  await writeWithBackpressure(csvStream, `${csvColumns.join(',')}\n`);
  let jsonlShard = createJsonlShard(1);

  const summary = {
    generated_at: new Date().toISOString(),
    source: INPUT_ROOT,
    counts: {
      emails: 0,
      employees: 0,
      folders: 0,
      with_subject: 0,
      with_body: 0,
      parse_errors: 0,
      jsonl_shards: 0,
    },
    top_employees: {},
    top_mailbox_folders: {},
    content_types: {},
  };

  const employeeCounts = new Map();
  const folderCounts = new Map();
  const contentTypeCounts = new Map();
  const employeesSeen = new Set();
  const foldersSeen = new Set();

  for (const file of walkFiles(INPUT_ROOT)) {
    try {
      const rawText = fs.readFileSync(file.rawPath, 'utf8');
      const email = parseEmail(rawText);
      const parts = file.relativePath.split(path.sep);
      const employee = parts[0] || '';
      const mailboxFolder = parts.length > 2 ? parts.slice(1, -1).join('/') : (parts[1] || '');
      const docId = file.relativePath.replace(/\\/g, '/');
      const row = buildRow(docId, employee, mailboxFolder, file.fileName, email);

      await writeWithBackpressure(csvStream, `${csvColumns.map((column) => csvEscape(row[column])).join(',')}\n`);

      if (jsonlShard.rowCount >= JSONL_SHARD_SIZE) {
        await finishStream(jsonlShard.stream);
        jsonlShard = createJsonlShard(jsonlShard.index + 1);
      }

      await writeWithBackpressure(jsonlShard.stream, `${JSON.stringify(row)}\n`);
      jsonlShard.rowCount += 1;

      summary.counts.emails += 1;
      if (row.subject) {
        summary.counts.with_subject += 1;
      }
      if (row.body_char_count > 0) {
        summary.counts.with_body += 1;
      }

      employeesSeen.add(employee);
      foldersSeen.add(mailboxFolder);
      employeeCounts.set(employee, (employeeCounts.get(employee) || 0) + 1);
      folderCounts.set(mailboxFolder, (folderCounts.get(mailboxFolder) || 0) + 1);
      contentTypeCounts.set(row.content_type || 'UNKNOWN', (contentTypeCounts.get(row.content_type || 'UNKNOWN') || 0) + 1);

      if (summary.counts.emails % 50000 === 0) {
        console.log(`Processed ${summary.counts.emails} emails...`);
      }
    } catch (error) {
      summary.counts.parse_errors += 1;
      if (summary.counts.parse_errors <= 10) {
        console.warn(`Parse error for ${file.relativePath}: ${error.message}`);
      }
    }
  }

  await finishStream(csvStream);
  await finishStream(jsonlShard.stream);

  summary.counts.employees = employeesSeen.size;
  summary.counts.folders = foldersSeen.size;
  summary.counts.jsonl_shards = jsonlShard.index;

  summary.top_employees = Object.fromEntries(
    [...employeeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20),
  );

  summary.top_mailbox_folders = Object.fromEntries(
    [...folderCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20),
  );

  summary.content_types = Object.fromEntries(
    [...contentTypeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20),
  );

  writeSummary(summary);

  console.log(`Prepared Enron outputs in ${OUTPUT_ROOT}`);
  console.log(JSON.stringify(summary, null, 2));
}

main();
