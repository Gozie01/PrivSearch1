// ─────────────────────────────────────────────────────────────
// Files routes — binary upload / download via MinIO
//
// POST   /api/files/upload       multipart binary upload
// GET    /api/files/:hash        download file bytes
// DELETE /api/files/:hash        soft-delete (tombstone)
// GET    /api/files/:hash/meta   fetch FileMeta from MongoDB
// ─────────────────────────────────────────────────────────────
import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';

import { authenticate } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import { getServices } from '../middleware/services';
import { requirePermission, hasPermission } from '../../access/rbac';
import { ALLOWED_MIME_TYPES } from '../../schemas/file-meta.schema';
import type { FileMeta } from '../../schemas/file-meta.schema';
import { config } from '../../config';
import { encryptBuffer, decryptBuffer } from '../../access/field-encryption';

export const filesRouter = Router();

// Maximum upload size enforced at the route level (also set in server.ts)
const MAX_FILE_BYTES = 512 * 1024 * 1024; // 512 MB

// ── GET /api/files/search ─────────────────────────────────────
filesRouter.get('/search', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;

  if (!hasPermission(actor.role, 'files:download:own') && !hasPermission(actor.role, 'files:download:all')) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const {
    fileHash,
    plaintextHash,
    ipfsCid,
    patientId,
    recordId,
    mimeType,
    limit = '50',
    skip = '0',
  } = req.query as Record<string, string | undefined>;

  const query: Record<string, unknown> = {};
  if (fileHash) query.fileHash = fileHash;
  if (plaintextHash) query.plaintextHash = plaintextHash;
  if (ipfsCid) query.ipfsCid = ipfsCid;
  if (patientId) query.patientId = patientId;
  if (recordId) query.recordId = recordId;
  if (mimeType) query.mimeType = mimeType;

  const canReadAll = ['SUPER_ADMIN', 'ADMIN', 'PHYSICIAN', 'NURSE', 'AUDITOR', 'RESEARCHER'].includes(actor.role);
  if (!canReadAll) query.patientId = actor.did;

  try {
    const { fileMetaStore } = getServices();
    const files = await fileMetaStore.findByQuery(query, {
      limit: Math.min(parseInt(limit, 10) || 50, 500),
      skip: parseInt(skip, 10) || 0,
    });
    return res.json({ files, count: files.length });
  } catch (err: unknown) {
    const e = err as Error;
    return res.status(500).json({ error: e.message });
  }
});

// ── POST /api/files/upload ────────────────────────────────────
filesRouter.post('/upload', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;

  try {
    requirePermission(actor.role, 'files:upload');
  } catch {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  // Expect raw binary body + metadata headers
  const originalName = decodeURIComponent(req.get('X-Original-Name') ?? 'upload');
  const mimeType = req.get('Content-Type') ?? 'application/octet-stream';
  const patientId = req.get('X-Patient-Id');
  const recordId = req.get('X-Record-Id');

  // MIME type allow-list
  const baseMime = mimeType.split(';')[0].trim().toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(baseMime)) {
    return res.status(415).json({
      error: `MIME type '${baseMime}' is not permitted`,
      allowed: [...ALLOWED_MIME_TYPES],
    });
  }

  // Collect body into buffer
  const chunks: Buffer[] = [];
  let totalSize = 0;

  req.on('data', (chunk: Buffer) => {
    totalSize += chunk.length;
    if (totalSize > MAX_FILE_BYTES) {
      req.destroy(new Error('File too large'));
    }
    chunks.push(chunk);
  });

  await new Promise<void>((resolve, reject) => {
    req.on('end', resolve);
    req.on('error', reject);
  });

  const fileBuffer = Buffer.concat(chunks);
  const plaintextHash = createHash('sha256').update(fileBuffer).digest('hex');
  const encrypted = encryptBuffer(fileBuffer, config.encryption.masterKeyHex);
  const encryptedFileBuffer = encrypted.ciphertext;
  const fileHash = createHash('sha256').update(encryptedFileBuffer).digest('hex');

  const meta: FileMeta = {
    fileHash,
    originalName,
    mimeType: baseMime,
    sizeBytes: fileBuffer.length,
    uploadedBy: actor.did,
    uploadedAt: Date.now(),
    patientId: patientId ?? undefined,
    recordId: recordId ?? undefined,
    isDeleted: false,
    plaintextHash,
    encryptionIv: encrypted.iv,
    encryptionTag: encrypted.tag,
    encryptionKeyId: encrypted.keyId,
  };

  try {
    const { blobStore, fileMetaStore, ipfsStore, auditAgent } = getServices();

    const storedHash = await blobStore.uploadFile(encryptedFileBuffer, meta);
    const ipfsMode = (req.get('X-IPFS-Mode') ?? 'auto').toLowerCase();
    if (ipfsMode !== 'off' && ipfsStore?.enabled) {
      const ipfs = await ipfsStore.addFile(encryptedFileBuffer, originalName);
      meta.ipfsCid = ipfs.cid;
      meta.ipfsPinned = true;
      meta.ipfsGatewayUrl = ipfsStore.gatewayUrlForCid(ipfs.cid);
    }

    // Upsert metadata record in MongoDB
    const existing = await fileMetaStore.findByQuery({ fileHash: storedHash }, { limit: 1 });
    let metadataId = existing[0]?._id as string | undefined;
    if (existing.length === 0) {
      metadataId = await fileMetaStore.insertRecord(meta as unknown as Record<string, unknown>);
    }

    await auditAgent.execute({
      operation: 'CREATE',
      actorDID: actor.did,
      actorRole: actor.role,
      recordType: 'FILE',
      payload: {
        _id: metadataId,
        fileHash: storedHash,
        plaintextHash,
        ipfsCid: meta.ipfsCid,
        ipfsPinned: meta.ipfsPinned,
        ipfsGatewayUrl: meta.ipfsGatewayUrl,
        originalName,
        mimeType: baseMime,
        sizeBytes: fileBuffer.length,
      },
      meta: {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        storage: 'MINIO+IPFS',
        fileHash: storedHash,
        plaintextHash,
        ipfsCid: meta.ipfsCid,
        ipfsPinned: meta.ipfsPinned,
        ipfsGatewayUrl: meta.ipfsGatewayUrl,
      },
    });

    return res.status(201).json({
      fileHash: storedHash,
      plaintextHash,
      ipfsCid: meta.ipfsCid,
      ipfsGatewayUrl: meta.ipfsGatewayUrl,
      sizeBytes: fileBuffer.length,
    });
  } catch (err: unknown) {
    const e = err as Error;
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /api/files/ipfs/:cid ──────────────────────────────────
filesRouter.get('/ipfs/:cid', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  const { cid } = req.params;

  if (!hasPermission(actor.role, 'files:download:own') && !hasPermission(actor.role, 'files:download:all')) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  try {
    const { fileMetaStore, ipfsStore } = getServices();
    if (!ipfsStore?.enabled) return res.status(503).json({ error: 'IPFS is disabled' });

    const metaDocs = await fileMetaStore.findByQuery({ ipfsCid: cid }, { limit: 1 });
    if (metaDocs.length === 0) return res.status(404).json({ error: 'IPFS file not found' });

    const meta = metaDocs[0] as unknown as FileMeta;
    if (meta.isDeleted) return res.status(410).json({ error: 'File has been deleted' });

    const canReadAll = ['SUPER_ADMIN', 'ADMIN', 'PHYSICIAN', 'NURSE', 'AUDITOR', 'RESEARCHER'].includes(actor.role);
    if (!canReadAll && meta.patientId !== actor.did) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const encryptedBuffer = await ipfsStore.catFile(cid);
    const fileBuffer = decryptBuffer(
      encryptedBuffer,
      config.encryption.masterKeyHex,
      meta.encryptionIv ?? '',
      meta.encryptionTag ?? '',
      meta.encryptionKeyId ?? 'file-default',
    );
    res.setHeader('Content-Type', meta.mimeType);
    res.setHeader('Content-Length', fileBuffer.length);
    res.setHeader('X-IPFS-CID', cid);
    return res.send(fileBuffer);
  } catch (err: unknown) {
    const e = err as Error;
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /api/files/:hash ──────────────────────────────────────
filesRouter.get('/:hash', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  const { hash } = req.params;

  // Validate hash format (64 hex chars)
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return res.status(400).json({ error: 'Invalid file hash format' });
  }

  // Allow both :own and :all permissions (roles with :all can always download)
  if (!hasPermission(actor.role, 'files:download:own') && !hasPermission(actor.role, 'files:download:all')) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  try {
    const { blobStore, fileMetaStore } = getServices();

    const metaDocs = await fileMetaStore.findByQuery({ fileHash: hash }, { limit: 1 });
    if (metaDocs.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }
    const meta = metaDocs[0] as unknown as FileMeta;

    if (meta.isDeleted) {
      return res.status(410).json({ error: 'File has been deleted' });
    }

    // Scope check: PATIENT role may only download their own files
    const canReadAll = ['SUPER_ADMIN', 'ADMIN', 'PHYSICIAN', 'NURSE', 'AUDITOR', 'RESEARCHER'].includes(actor.role);
    if (!canReadAll && meta.patientId !== actor.did) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const encryptedBuffer = await blobStore.downloadFile(hash);
    const fileBuffer = decryptBuffer(
      encryptedBuffer,
      config.encryption.masterKeyHex,
      meta.encryptionIv ?? '',
      meta.encryptionTag ?? '',
      meta.encryptionKeyId ?? 'file-default',
    );

    res.setHeader('Content-Type', meta.mimeType);
    res.setHeader('Content-Length', fileBuffer.length);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(meta.originalName)}"`,
    );
    return res.send(fileBuffer);
  } catch (err: unknown) {
    const e = err as Error;
    return res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/files/:hash ───────────────────────────────────
filesRouter.delete('/:hash', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  const { hash } = req.params;

  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return res.status(400).json({ error: 'Invalid file hash format' });
  }

  try {
    requirePermission(actor.role, 'files:delete');
  } catch {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  try {
    const { blobStore, fileMetaStore } = getServices();

    const metaDocs = await fileMetaStore.findByQuery({ fileHash: hash }, { limit: 1 });
    if (metaDocs.length === 0) return res.status(404).json({ error: 'File not found' });

    const meta = metaDocs[0];
    if (meta.isDeleted) return res.status(410).json({ error: 'File already deleted' });

    // Soft-delete the blob
    await blobStore.deleteFile(hash);

    // Tombstone the metadata record
    await fileMetaStore.updateRecord(meta._id as string, {
      isDeleted: true,
      deletedAt: Date.now(),
      deletedBy: actor.did,
    });

    return res.json({ fileHash: hash, deletedAt: Date.now() });
  } catch (err: unknown) {
    const e = err as Error;
    return res.status(500).json({ error: e.message });
  }
});

// ── GET /api/files/:hash/meta ─────────────────────────────────
filesRouter.get('/:hash/meta', authenticate, async (req: Request, res: Response) => {
  const actor = (req as AuthRequest).principal;
  const { hash } = req.params;

  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return res.status(400).json({ error: 'Invalid file hash format' });
  }

  try {
    const { fileMetaStore } = getServices();
    const metaDocs = await fileMetaStore.findByQuery({ fileHash: hash }, { limit: 1 });
    if (metaDocs.length === 0) return res.status(404).json({ error: 'File not found' });
    return res.json(metaDocs[0]);
  } catch (err: unknown) {
    const e = err as Error;
    return res.status(500).json({ error: e.message });
  }
});
