import dotenv from 'dotenv';
dotenv.config({ path: process.env.LIFEDB_ENV_PATH ?? '.env' });

function opt(key: string, defaultVal: string): string {
  return process.env[key] ?? defaultVal;
}

export const config = {
  mongodb: {
    uri: opt('MONGODB_URI', 'mongodb://localhost:27017/lifedb'),
    dbName: opt('MONGODB_DB', 'lifedb'),
  },

  minio: {
    endPoint: opt('MINIO_ENDPOINT', 'localhost'),
    port: parseInt(opt('MINIO_PORT', '9000'), 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: opt('MINIO_ACCESS_KEY', 'minioadmin'),
    secretKey: opt('MINIO_SECRET_KEY', 'minioadmin'),
    bucket: opt('MINIO_BUCKET', 'lifedb-files'),
  },

  ipfs: {
    enabled: process.env.IPFS_ENABLED === 'true',
    apiUrl: opt('IPFS_API_URL', 'http://localhost:5001'),
    gatewayUrl: opt('IPFS_GATEWAY_URL', 'http://localhost:8080'),
    pinUploads: process.env.IPFS_PIN_UPLOADS !== 'false',
    cidVersion: parseInt(opt('IPFS_CID_VERSION', '1'), 10),
  },

  jwt: {
    secret: opt('JWT_SECRET', 'dev-secret-change-in-production-32chars!!'),
    expiresIn: opt('JWT_EXPIRES_IN', '8h'),
  },

  blockchain: {
    blockIntervalMs: parseInt(opt('BLOCK_INTERVAL_MS', '5000'), 10),
    maxTxPerBlock: parseInt(opt('MAX_TX_PER_BLOCK', '50'), 10),
    validatorThreshold: parseFloat(opt('VALIDATOR_THRESHOLD', '0.51')),
    persistPath: opt('BLOCKCHAIN_PERSIST_PATH', './data/chain.json'),
  },

  anchorScheduler: {
    mode: opt('ANCHOR_SCHEDULER_MODE', 'fixed'),
    baseDelayMs: parseInt(opt('ANCHOR_SCHEDULER_BASE_DELAY_MS', '1500'), 10),
    congestedDelayMs: parseInt(opt('ANCHOR_SCHEDULER_CONGESTED_DELAY_MS', '100'), 10),
    backlogThreshold: parseInt(opt('ANCHOR_SCHEDULER_BACKLOG_THRESHOLD', '3'), 10),
    pendingTxThreshold: parseInt(opt('ANCHOR_SCHEDULER_PENDING_TX_THRESHOLD', '100'), 10),
    retryDelayMs: parseInt(opt('ANCHOR_SCHEDULER_RETRY_DELAY_MS', '5000'), 10),
  },

  purechain: {
    enabled: process.env.PURECHAIN_ANCHOR_ENABLED === 'true',
    rpcUrl: opt('PURECHAIN_RPC_URL', 'https://purechainnode.com'),
    chainId: BigInt(opt('PURECHAIN_CHAIN_ID', '900520900520')),
    gasPrice: BigInt(opt('PURECHAIN_GAS_PRICE', '0')),
    privateKey: opt('PURECHAIN_PRIVATE_KEY', ''),
    contractAddress: opt('LIFEDB_ANCHOR_CONTRACT', ''),
  },

  encryption: {
    masterKeyHex: opt('MASTER_ENCRYPTION_KEY', ''),
  },

  replayProtection: {
    mode: opt('REPLAY_PROTECTION_MODE', 'optional'),
    ttlMs: parseInt(opt('REPLAY_PROTECTION_TTL_MS', '300000'), 10),
    allowedSkewMs: parseInt(opt('REPLAY_PROTECTION_ALLOWED_SKEW_MS', '300000'), 10),
    maxEntries: parseInt(opt('REPLAY_PROTECTION_MAX_ENTRIES', '50000'), 10),
  },

  server: {
    port: parseInt(opt('PORT', '3000'), 10),
    host: opt('HOST', '0.0.0.0'),
    corsOrigin: opt('CORS_ORIGIN', 'http://localhost:5173'),
    rateLimitMax: parseInt(opt('RATE_LIMIT_MAX', '200'), 10),
  },

  /** Immutable retention policy constants */
  retention: {
    patientMinYears: 10,
    labResultMinYears: 7,
    auditLogPermanent: true,
  },

  logLevel: opt('LOG_LEVEL', 'info'),
} as const;

export type AppConfig = typeof config;
