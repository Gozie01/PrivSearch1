// ─────────────────────────────────────────────────────────────
// scripts/e2e.ts — end-to-end integration tests against the live
// LifeDB API server (must be running on localhost:3000).
//
// Run with:  npx ts-node --project tsconfig.json scripts/e2e.ts
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';
import http from 'http';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

const BASE = 'http://localhost:3000';

// ── ANSI helpers ─────────────────────────────────────────────
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

let passed = 0, failed = 0;

function ok(label: string, detail = '') {
  passed++;
  console.log(`  ${GREEN}✔${RESET}  ${label}${detail ? `  ${YELLOW}${detail}${RESET}` : ''}`);
}
function fail(label: string, detail = '') {
  failed++;
  console.log(`  ${RED}✖${RESET}  ${RED}${label}${RESET}${detail ? `\n       ${detail}` : ''}`);
}
function section(title: string) {
  console.log(`\n${BOLD}${CYAN}━━  ${title}  ━━${RESET}`);
}

// ── HTTP helpers ──────────────────────────────────────────────

async function req(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const raw = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extraHeaders,
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (raw) headers['Content-Length'] = Buffer.byteLength(raw).toString();

    const url = new URL(path, BASE);
    const opts: http.RequestOptions = {
      hostname: url.hostname,
      port: parseInt(url.port || '80', 10),
      path: url.pathname + url.search,
      method,
      headers,
    };

    const r = http.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    r.on('error', reject);
    if (raw) r.write(raw);
    r.end();
  });
}

async function upload(
  path: string,
  fileBuffer: Buffer,
  mimeType: string,
  token: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'Content-Type': mimeType,
      'Content-Length': fileBuffer.length.toString(),
      'Authorization': `Bearer ${token}`,
      ...extraHeaders,
    };
    const url = new URL(path, BASE);
    const opts: http.RequestOptions = {
      hostname: url.hostname, port: parseInt(url.port || '80', 10),
      path: url.pathname, method: 'POST', headers,
    };
    const r = http.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { parsed = text; }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    r.on('error', reject);
    r.write(fileBuffer);
    r.end();
  });
}

// ── DID key pair for the test actor ──────────────────────────

function makeDID(): { did: string; publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const fingerprint = crypto.createHash('sha256').update(publicKey, 'utf8').digest('base64url');
  return { did: `did:key:z${fingerprint}`, publicKeyPem: publicKey, privateKeyPem: privateKey };
}

function signChallenge(nonce: string, privateKeyPem: string): string {
  const s = crypto.createSign('SHA256');
  s.update(nonce, 'utf8');
  return s.sign(privateKeyPem, 'hex');
}

// ═════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n${BOLD}LifeDB End-to-End Integration Suite${RESET}`);
  console.log(`Target: ${BASE}\n`);

  // ── 0. Health ─────────────────────────────────────────────
  section('0 · Health Check');
  {
    const r = await req('GET', '/health');
    if (r.status === 200 && (r.body as any).status === 'ok') {
      ok('GET /health → 200 ok', `chainLength=${(r.body as any).chainLength}`);
    } else {
      fail('GET /health', JSON.stringify(r.body));
    }
  }

  // ── 1. Auth — register + challenge-response ────────────────
  section('1 · Auth');

  const adminDID = makeDID();
  const physicianDID = makeDID();
  const patientDID = makeDID();

  // 1a. Register the admin by directly inserting via the register endpoint
  // We need to bootstrap: first register a SUPER_ADMIN without auth (allowed once for seed).
  // Since the /register endpoint requires ADMIN role, we'll call a helper endpoint
  // that inserts directly into MongoDB. For e2e purposes we pre-seed by:
  //  — bootstrapping an admin DID via the register endpoint using a "first-run" trick
  // Actually, the register endpoint requires auth. We need a seed script approach.
  // We'll insert the admin identity directly into MongoDB using mongosh, then auth normally.

  // Seed identities directly via MongoDB driver
  {
    const mongoUri = process.env['MONGODB_URI'] ?? 'mongodb://admin:changeme@localhost:27017/lifedb?authSource=admin';
    const mongoClient = new MongoClient(mongoUri);
    try {
      await mongoClient.connect();
      const db = mongoClient.db();
      const col = db.collection('identities');
      await col.deleteMany({});
      await col.insertMany([
        { _id: adminDID.did,     did: adminDID.did,     publicKeyPem: adminDID.publicKeyPem,     role: 'SUPER_ADMIN', createdAt: Date.now(), isActive: true, label: 'e2e-admin' },
        { _id: physicianDID.did, did: physicianDID.did, publicKeyPem: physicianDID.publicKeyPem, role: 'PHYSICIAN',   createdAt: Date.now(), isActive: true, label: 'e2e-physician' },
        { _id: patientDID.did,   did: patientDID.did,   publicKeyPem: patientDID.publicKeyPem,   role: 'PATIENT',     createdAt: Date.now(), isActive: true, label: 'e2e-patient' },
      ] as any[]);
      ok('Seeded 3 DID identities (SUPER_ADMIN, PHYSICIAN, PATIENT) into MongoDB');
    } catch (e: any) {
      fail('MongoDB seed', e.message.slice(0, 200));
    } finally {
      await mongoClient.close();
    }
  }

  // 1b. Challenge + verify for each role
  let adminToken = '', physicianToken = '', patientToken = '';

  for (const [label, kp, tokenVar] of [
    ['SUPER_ADMIN', adminDID, 'admin'],
    ['PHYSICIAN',   physicianDID, 'physician'],
    ['PATIENT',     patientDID, 'patient'],
  ] as const) {
    const chalR = await req('POST', '/api/auth/challenge', { did: kp.did });
    if (chalR.status !== 200) { fail(`${label} challenge`, JSON.stringify(chalR.body)); continue; }
    const nonce = (chalR.body as any).nonce as string;

    const sig = signChallenge(nonce, kp.privateKeyPem);
    const verR = await req('POST', '/api/auth/verify', { did: kp.did, signature: sig });
    if (verR.status !== 200) { fail(`${label} verify`, JSON.stringify(verR.body)); continue; }
    const token = (verR.body as any).token as string;
    if (label === 'SUPER_ADMIN')    adminToken     = token;
    if (label === 'PHYSICIAN')      physicianToken = token;
    if (label === 'PATIENT')        patientToken   = token;
    ok(`${label} auth → JWT issued`, `...${token.slice(-12)}`);
  }

  // 1c. GET /api/auth/me
  const meR = await req('GET', '/api/auth/me', undefined, physicianDID ? physicianToken : adminToken);
  if (meR.status === 200 && (meR.body as any).principal?.role) {
    ok('GET /api/auth/me → principal decoded', `role=${(meR.body as any).principal.role}`);
  } else {
    fail('GET /api/auth/me', JSON.stringify(meR.body));
  }

  // 1d. Bad token
  const badR = await req('GET', '/api/auth/me', undefined, 'bad.token.here');
  if (badR.status === 401) ok('Rejects invalid token → 401');
  else fail('Expected 401 for bad token', `got ${badR.status}`);

  // ── 2. Records — CRUD ─────────────────────────────────────
  section('2 · Records CRUD');

  // 2a. CREATE patient record
  const patientPayload = {
    recordType: 'PATIENT',
    patientId: patientDID.did,
    firstName: 'Alice',
    lastName: 'Wonderland',
    dateOfBirth: '1985-04-12',
    gender: 'FEMALE',
    bloodType: 'A+',
    primaryPhysicianDID: physicianDID.did,
  };
  const createR = await req('POST', '/api/records', patientPayload, physicianToken);
  let recordId = '';
  if (createR.status === 201 && (createR.body as any).id) {
    recordId = (createR.body as any).id;
    ok('POST /api/records → 201 created', `id=${recordId.slice(0,8)}…`);
  } else {
    fail('POST /api/records', JSON.stringify(createR.body));
  }

  // 2b. CREATE lab result
  const labPayload = {
    recordType: 'LAB_RESULT',
    patientId: patientDID.did,
    authorDID: physicianDID.did,
    title: 'Complete Blood Count',
    date: '2026-03-01',
    confidentialityLevel: 'CONFIDENTIAL',
    content: { wbc: 7.2, rbc: 4.8, hemoglobin: 14.1 },
  };
  const labR = await req('POST', '/api/records', labPayload, physicianToken);
  let labId = '';
  if (labR.status === 201 && (labR.body as any).id) {
    labId = (labR.body as any).id;
    ok('POST /api/records LAB_RESULT → 201 created', `id=${labId.slice(0,8)}…`);
  } else {
    fail('POST /api/records LAB_RESULT', JSON.stringify(labR.body));
  }

  // 2c. READ by ID
  if (recordId) {
    const readR = await req('GET', `/api/records/${recordId}?recordType=PATIENT`, undefined, physicianToken);
    if (readR.status === 200 && (readR.body as any).patientId) {
      ok(`GET /api/records/:id → 200`, `version=${(readR.body as any)._version}`);
    } else {
      fail('GET /api/records/:id', JSON.stringify(readR.body));
    }
  }

  // 2d. READ all (query)
  const qR = await req('GET', '/api/records?limit=10', undefined, physicianToken);
  if (qR.status === 200 && Array.isArray((qR.body as any).records)) {
    ok(`GET /api/records (query) → 200`, `count=${(qR.body as any).count}`);
  } else {
    fail('GET /api/records', JSON.stringify(qR.body));
  }

  // 2e. UPDATE
  if (recordId) {
    const updR = await req('PATCH', `/api/records/${recordId}`, {
      recordType: 'PATIENT',
      allergies: ['penicillin', 'aspirin'],
    }, physicianToken);
    if (updR.status === 200 && (updR.body as any).version >= 2) {
      ok('PATCH /api/records/:id → 200 (versioned)', `v${(updR.body as any).version}`);
    } else {
      fail('PATCH /api/records/:id', JSON.stringify(updR.body));
    }
  }

  // 2f. Version history
  if (recordId) {
    const histR = await req('GET', `/api/records/${recordId}/history`, undefined, physicianToken);
    if (histR.status === 200 && (histR.body as any).versions) {
      ok(`GET /api/records/:id/history → 200`, `archived versions=${(histR.body as any).versions.length}`);
    } else {
      fail('GET /api/records/:id/history', JSON.stringify(histR.body));
    }
  }

  // 2g. ValidationAgent rejects bad payload
  const badPayload = { recordType: 'PATIENT', firstName: 'Only' };
  const badCreateR = await req('POST', '/api/records', badPayload, physicianToken);
  if (badCreateR.status === 422) {
    ok('ValidationAgent rejects missing fields → 422');
  } else {
    fail('Expected 422 for bad payload', `got ${badCreateR.status}: ${JSON.stringify(badCreateR.body)}`);
  }

  // 2h. PATIENT role cannot create records
  const patientCreateR = await req('POST', '/api/records', patientPayload, patientToken);
  if (patientCreateR.status === 403) {
    ok('RBAC: PATIENT cannot create records → 403');
  } else {
    fail('Expected 403 for PATIENT role creating', `got ${patientCreateR.status}`);
  }

  // 2i. Soft-DELETE
  if (recordId) {
    const delR = await req('DELETE', `/api/records/${recordId}?recordType=PATIENT`, undefined, physicianToken);
    if (delR.status === 200 && (delR.body as any).deleteType === 'soft') {
      ok('DELETE /api/records/:id (soft) → 200', `tombstoned`);
    } else {
      fail('DELETE /api/records/:id', JSON.stringify(delR.body));
    }
  }

  // 2j. RetentionAgent blocks hard-DELETE within window on a NEW record
  const freshR = await req('POST', '/api/records', patientPayload, physicianToken);
  const freshId = (freshR.body as any).id;
  if (freshId) {
    const hardDelR = await req('DELETE', `/api/records/${freshId}?recordType=PATIENT&hard=true`, undefined, adminToken);
    if (hardDelR.status === 451) {
      ok('RetentionAgent blocks hard-DELETE within 10yr window → 451');
    } else {
      fail('Expected 451 for retention block', `got ${hardDelR.status}: ${JSON.stringify(hardDelR.body)}`);
    }
  }

  // ── 3. File upload / download ─────────────────────────────
  section('3 · File Upload / Download');

  // Use a unique salt so each run gets a distinct hash (avoids stale deleted-state from prior runs)
  const pdfSalt = crypto.randomBytes(6).toString('hex');
  const pdfContent = Buffer.from(`%PDF-1.4 fake-medical-pdf-for-e2e-${pdfSalt}`);
  let fileHash = '';

  const uploadR = await upload(
    '/api/files/upload',
    pdfContent,
    'application/pdf',
    physicianToken,
    { 'X-Original-Name': 'lab-report.pdf', 'X-Patient-Id': patientDID.did },
  );
  if (uploadR.status === 201 && (uploadR.body as any).fileHash) {
    fileHash = (uploadR.body as any).fileHash;
    ok('POST /api/files/upload → 201', `hash=${fileHash.slice(0,16)}…`);
  } else {
    fail('POST /api/files/upload', JSON.stringify(uploadR.body));
  }

  // Duplicate upload → should also return 201 (deduplication, no error)
  if (fileHash) {
    const dup = await upload('/api/files/upload', pdfContent, 'application/pdf', physicianToken,
      { 'X-Original-Name': 'lab-report-dup.pdf' });
    if (dup.status === 201 && (dup.body as any).fileHash === fileHash) {
      ok('Duplicate upload deduplicated → same hash');
    } else {
      fail('Duplicate upload', JSON.stringify(dup.body));
    }
  }

  // File meta
  if (fileHash) {
    const metaR = await req('GET', `/api/files/${fileHash}/meta`, undefined, physicianToken);
    if (metaR.status === 200 && (metaR.body as any).mimeType === 'application/pdf') {
      ok('GET /api/files/:hash/meta → 200', `size=${(metaR.body as any).sizeBytes}B`);
    } else {
      fail('GET /api/files/:hash/meta', JSON.stringify(metaR.body));
    }
  }

  // Download
  if (fileHash) {
    const dlR = await req('GET', `/api/files/${fileHash}`, undefined, physicianToken);
    if (dlR.status === 200) {
      ok('GET /api/files/:hash (download) → 200');
    } else {
      fail('GET /api/files/:hash download', `status=${dlR.status}`);
    }
  }

  // Disallowed MIME type
  const badMime = await upload('/api/files/upload', Buffer.from('<html>'), 'text/html', adminToken,
    { 'X-Original-Name': 'xss.html' });
  if (badMime.status === 415) {
    ok('Disallowed MIME type (text/html) → 415');
  } else {
    fail('Expected 415 for disallowed MIME', `got ${badMime.status}`);
  }

  // Invalid hash format
  const badHash = await req('GET', '/api/files/notahash/meta', undefined, adminToken);
  if (badHash.status === 400) {
    ok('Invalid file hash format → 400');
  } else {
    fail('Expected 400 for bad hash', `got ${badHash.status}`);
  }

  // Soft-delete the file
  if (fileHash) {
    // Only ADMIN/PHYSICIAN has files:delete; use adminToken
    const fDelR = await req('DELETE', `/api/files/${fileHash}`, undefined, adminToken);
    if (fDelR.status === 200) {
      ok('DELETE /api/files/:hash (soft) → 200');
    } else {
      fail('DELETE /api/files/:hash', JSON.stringify(fDelR.body));
    }
    // Re-download should 410
    const afterDel = await req('GET', `/api/files/${fileHash}`, undefined, adminToken);
    if (afterDel.status === 410) {
      ok('Deleted file returns 410 on re-download');
    } else {
      fail('Expected 410 for deleted file', `got ${afterDel.status}`);
    }
  }

  // ── 4. Audit / Blockchain ─────────────────────────────────
  section('4 · Audit & Blockchain');

  // Wait briefly for the consensus engine to seal any pending txs
  await new Promise(r => setTimeout(r, 2000));

  // Chain stats
  const statsR = await req('GET', '/api/audit/chain/stats', undefined, adminToken);
  if (statsR.status === 200 && typeof (statsR.body as any).chainLength === 'number') {
    ok('GET /api/audit/chain/stats → 200', `length=${(statsR.body as any).chainLength}, pending=${(statsR.body as any).pendingTransactions}`);
  } else {
    fail('GET /api/audit/chain/stats', JSON.stringify(statsR.body));
  }

  // Chain validation
  const validR = await req('GET', '/api/audit/chain/validate', undefined, adminToken);
  if (validR.status === 200 && (validR.body as any).valid === true) {
    ok('GET /api/audit/chain/validate → chain VALID', `blocks=${(validR.body as any).blocksChecked}`);
  } else {
    fail('Chain validation failed', JSON.stringify(validR.body));
  }

  // Record provenance (using the fresh record created earlier that wasn't deleted)
  if (freshId) {
    const provR = await req('GET', `/api/audit/record/${freshId}`, undefined, adminToken);
    if (provR.status === 200 && Array.isArray((provR.body as any).history)) {
      ok('GET /api/audit/record/:id → blockchain provenance', `txCount=${(provR.body as any).transactionCount}`);
    } else {
      fail('GET /api/audit/record/:id', JSON.stringify(provR.body));
    }
  }

  // Hash logs
  const logsR = await req('GET', '/api/audit/logs?limit=10', undefined, adminToken);
  if (logsR.status === 200 && Array.isArray((logsR.body as any).logs)) {
    ok('GET /api/audit/logs → 200', `count=${(logsR.body as any).count}`);
  } else {
    fail('GET /api/audit/logs', JSON.stringify(logsR.body));
  }

  // Auditor cannot access admin:users
  const auditorChk = await req('GET', '/api/audit/chain/stats', undefined, patientToken);
  if (auditorChk.status === 403) {
    ok('PATIENT role denied blockchain:read → 403');
  } else {
    fail('Expected 403 for PATIENT on chain stats', `got ${auditorChk.status}`);
  }

  // ── 5. Block seal check ───────────────────────────────────
  section('5 · Block seal (consensus timer)');
  console.log('  Waiting 6s for consensus engine to seal a block…');
  await new Promise(r => setTimeout(r, 6000));

  const statsAfter = await req('GET', '/api/audit/chain/stats', undefined, adminToken);
  const lenAfter = (statsAfter.body as any).chainLength as number;
  if (lenAfter >= 2) {
    ok('Chain grew after consensus interval', `chainLength=${lenAfter}`);
  } else {
    fail('Chain did not grow beyond genesis', `length=${lenAfter} (expected ≥2)`);
  }

  const validAfter = await req('GET', '/api/audit/chain/validate', undefined, adminToken);
  if ((validAfter.body as any).valid === true) {
    ok('Chain integrity still VALID after ops', `blocks=${(validAfter.body as any).blocksChecked}`);
  } else {
    fail('Chain corrupted!', JSON.stringify(validAfter.body));
  }

  // ── Summary ───────────────────────────────────────────────
  const total = passed + failed;
  console.log(`\n${'─'.repeat(52)}`);
  if (failed === 0) {
    console.log(`${BOLD}${GREEN}  ALL ${total} CHECKS PASSED${RESET}`);
  } else {
    console.log(`${BOLD}  ${GREEN}${passed} passed${RESET}  ${RED}${failed} FAILED${RESET}  (${total} total)`);
  }
  console.log('─'.repeat(52) + '\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`${RED}Fatal:${RESET}`, err);
  process.exit(1);
});
