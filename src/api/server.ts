// ─────────────────────────────────────────────────────────────
// LifeDB API Server — Express + WebSocket
//
// Boot sequence:
//   1. Connect to MongoDB
//   2. Ensure MongoDB indexes
//   3. Initialise MinIO bucket
//   4. Bootstrap blockchain (load or create genesis)
//   5. Bootstrap validator keys
//   6. Wire agents and CRUD operations
//   7. Start HTTP + WebSocket servers
// ─────────────────────────────────────────────────────────────
import 'dotenv/config';
import http from 'http';
import crypto from 'crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { WebSocketServer } from 'ws';

import { config } from '../config';
import { logger } from '../utils/logger';

// Storage
import { connectMongo, DocumentStore } from '../storage/document-store';
import { BlobStore, initBlobStore } from '../storage/blob-store';
import { IpfsStore } from '../storage/ipfs-store';
import { IndexEngine } from '../storage/index-engine';

// Blockchain
import { ValidatorRegistry, generateValidatorKeyPair } from '../blockchain/validator';
import { LifeDBChain, ChainValidator } from '../blockchain/chain';
import { ConsensusEngine } from '../blockchain/consensus';

// Agents
import { ValidationAgent } from '../agents/validation-agent';
import { AuditAgent } from '../agents/audit-agent';
import { RetentionAgent } from '../agents/retention-agent';

// CRUD
import { CreateOperation } from '../crud/create';
import { ReadOperation } from '../crud/read';
import { UpdateOperation } from '../crud/update';
import { DeleteOperation } from '../crud/delete';
import { SupplyChainCRUD } from '../crud/supplychain-crud';

// API
import { authRouter } from './routes/auth';
import { recordsRouter } from './routes/records';
import { filesRouter } from './routes/files';
import { auditRouter } from './routes/audit';
import { supplyChainRouter } from './routes/supplychain';
import { setDb } from './middleware/db';
import { setServices } from './middleware/services';
import { ReplayProtection } from './middleware/replay-protection';

import { deriveDidFromPublicKey } from '../access/did-auth';

// ─────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  // ── 1. MongoDB ─────────────────────────────────────────────
  const db = await connectMongo();
  setDb(db);

  // ── 2. Indexes ─────────────────────────────────────────────
  const indexEngine = new IndexEngine(db);
  await indexEngine.ensureAll();

  // ── 3. MinIO bucket ────────────────────────────────────────
  await initBlobStore();
  const ipfsStore = new IpfsStore();
  await ipfsStore.healthCheck();

  // ── 4. Blockchain ──────────────────────────────────────────
  const registry = new ValidatorRegistry();

  // Generate a local ephemeral validator key pair if none is configured.
  // In production, load these from a secure secrets manager / HSM.
  let localPublicKeyPem: string;
  let localPrivateKeyPem: string;

  if (process.env.LOCAL_VALIDATOR_PRIVATE_KEY_PEM) {
    localPrivateKeyPem = process.env.LOCAL_VALIDATOR_PRIVATE_KEY_PEM;
    localPublicKeyPem = process.env.LOCAL_VALIDATOR_PUBLIC_KEY_PEM ?? '';
  } else {
    logger.warn(
      '[Server] LOCAL_VALIDATOR_PRIVATE_KEY_PEM not set — generating ephemeral key pair. ' +
        'DO NOT use this in production.',
    );
    const kp = generateValidatorKeyPair();
    localPublicKeyPem = kp.publicKeyPem;
    localPrivateKeyPem = kp.privateKeyPem;
  }

  const localDid = deriveDidFromPublicKey(localPublicKeyPem);

  // Register the local node as BOTH tier-1 (tx signing) and tier-2 (block signing)
  registry.register({
    did: localDid,
    publicKeyPem: localPublicKeyPem,
    privateKeyPem: localPrivateKeyPem,
    tier: 1,
    addedAt: Date.now(),
    isActive: true,
  });
  registry.register({
    did: localDid + '#block',
    publicKeyPem: localPublicKeyPem,
    privateKeyPem: localPrivateKeyPem,
    tier: 2,
    addedAt: Date.now(),
    isActive: true,
  });

  const chain = new LifeDBChain(registry);
  await chain.load();
  const chainValidator = new ChainValidator(chain, registry);

  const consensus = new ConsensusEngine(
    registry,
    (block) => chain.addBlock(block),
    () => chain.getLastBlock(),
    localDid,
    localPrivateKeyPem,
  );
  chain.setAnchorPendingCountSource(() => consensus.getPendingCount());

  // ── 5. Document stores ─────────────────────────────────────
  const documentStore = new DocumentStore('records');
  const fileMetaStore = new DocumentStore('file_meta');
  const hashLogStore  = new DocumentStore('hash_logs');
  const blobStore     = new BlobStore();

  const supplyChainCrud = new SupplyChainCRUD(db);
  await supplyChainCrud.initializeCollections();
  const replayProtection = new ReplayProtection();

  // ── 6. Agents ──────────────────────────────────────────────
  const validationAgent = new ValidationAgent();
  const retentionAgent  = new RetentionAgent();
  const auditAgent      = new AuditAgent(consensus, localDid, localPrivateKeyPem, hashLogStore);

  // ── 7. CRUD operations ─────────────────────────────────────
  const createOp = new CreateOperation(documentStore, validationAgent, auditAgent);
  const readOp   = new ReadOperation(documentStore, auditAgent);
  const updateOp = new UpdateOperation(documentStore, validationAgent, auditAgent);
  const deleteOp = new DeleteOperation(documentStore, retentionAgent, auditAgent);

  // Inject singletons into route middleware
  setServices({
    createOp,
    readOp,
    updateOp,
    deleteOp,
    auditAgent,
    documentStore,
    fileMetaStore,
    hashLogStore,
    blobStore,
    ipfsStore,
    chain,
    chainValidator,
    consensus,
    supplyChainCrud,
    replayProtection,
  });

  // ── 8. Express setup ───────────────────────────────────────
  const app = express();

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  }));

  // CORS
  app.use(cors({
    origin: config.server.corsOrigin,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization', 'Content-Type',
      'X-Original-Name', 'X-Patient-Id', 'X-Record-Id',
      'X-Request-Nonce', 'X-Request-Timestamp',
    ],
    credentials: true,
  }));

  // Global rate limit — configurable via RATE_LIMIT_MAX env var
  app.use(rateLimit({
    windowMs: 60_000,
    max: config.server.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests — please slow down' },
  }));

  // Body parsing — JSON for API, raw binary for file uploads
  app.use((req, _res, next) => {
    if (req.path.startsWith('/api/files/upload')) return next();
    express.json({ limit: '4mb' })(req, _res, next);
  });

  // ── Routes ──────────────────────────────────────────────────
  app.use('/api/auth',    authRouter);
  app.use('/api/records', recordsRouter);
  app.use('/api/files',   filesRouter);
  app.use('/api/audit',   auditRouter);
  app.use('/api/supply-chain', supplyChainRouter);

  // Health check (no auth required)
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      chainLength: chain.getChainLength(),
      pendingTxs: consensus.getPendingCount(),
      anchor: chain.getAnchorStatus(),
      replayProtection: replayProtection.getStatus(),
      timestamp: Date.now(),
    });
  });

  // 404 catch-all
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // Global error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error('[Server] Unhandled error', { err });
    res.status(500).json({ error: 'Internal server error' });
  });

  // ── HTTP + WebSocket ────────────────────────────────────────
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'CONNECTED', timestamp: Date.now() }));

    // Push block-committed events to all connected clients
    consensus.on('block:committed', (block) => {
      const msg = JSON.stringify({
        type: 'BLOCK_COMMITTED',
        index: block.index,
        txCount: block.transactions.length,
        blockHash: block.blockHash,
        timestamp: block.timestamp,
      });
      if (ws.readyState === ws.OPEN) ws.send(msg);
    });
  });

  const { port, host } = config.server;
  server.listen(port, host, () => {
    logger.info(`[Server] LifeDB API listening on http://${host}:${port}`);
  });

  // ── Graceful shutdown ────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`[Server] Received ${signal} — shutting down`);
    consensus.stop();
    chain.stopAnchoring();
    server.close(() => {
      logger.info('[Server] HTTP server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('[Server] Fatal boot error', { err });
  process.exit(1);
});
