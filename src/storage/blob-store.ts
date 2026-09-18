// ─────────────────────────────────────────────────────────────
// BlobStore — MinIO wrapper for binary medical files.
//
// Content-addressed storage: the MinIO object key IS the
// SHA-256 hash of the raw file bytes.  This guarantees:
//   • Deduplication — identical files share one object.
//   • Integrity — the key verifies the content at any time.
//
// Soft-delete: the object is moved to a "deleted/" prefix
// (MinIO object tags are an alternative, but copy+remove is
// more universally supported across S3-compatible stores).
// ─────────────────────────────────────────────────────────────
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { Client as MinioClient } from 'minio';

import { config } from '../config';
import type { FileMeta } from '../schemas/file-meta.schema';
import { logger } from '../utils/logger';

// ── Client singleton ──────────────────────────────────────────

let _client: MinioClient | null = null;

export function getMinioClient(): MinioClient {
  if (!_client) {
    _client = new MinioClient({
      endPoint: config.minio.endPoint,
      port: config.minio.port,
      useSSL: config.minio.useSSL,
      accessKey: config.minio.accessKey,
      secretKey: config.minio.secretKey,
    });
  }
  return _client;
}

/** Ensure the configured bucket exists, creating it if necessary */
export async function initBlobStore(): Promise<void> {
  const client = getMinioClient();
  const exists = await client.bucketExists(config.minio.bucket);
  if (!exists) {
    await client.makeBucket(config.minio.bucket, 'us-east-1');
    logger.info('[BlobStore] Created MinIO bucket', { bucket: config.minio.bucket });
  }
}

// ── BlobStore ─────────────────────────────────────────────────

export class BlobStore {
  private readonly client: MinioClient;
  private readonly bucket: string;

  constructor() {
    this.client = getMinioClient();
    this.bucket = config.minio.bucket;
  }

  /**
   * Upload a binary file.
   * Returns the content-addressed key (SHA-256 hex of file bytes).
   * If an object with the same hash already exists, the upload is skipped
   * (safe deduplication).
   */
  async uploadFile(file: Buffer, meta: FileMeta): Promise<string> {
    const fileHash = createHash('sha256').update(file).digest('hex');

    const alreadyExists = await this.fileExists(fileHash);
    if (!alreadyExists) {
      const stream = Readable.from(file);
      await this.client.putObject(
        this.bucket,
        fileHash,
        stream,
        file.length,
        {
          'content-type': meta.mimeType,
          'x-amz-meta-original-name': encodeURIComponent(meta.originalName),
          'x-amz-meta-uploaded-by': meta.uploadedBy,
          'x-amz-meta-patient-id': meta.patientId ?? '',
        },
      );
      logger.info('[BlobStore] File uploaded', { fileHash, size: file.length });
    }

    return fileHash;
  }

  /**
   * Download a file by its content-addressed hash.
   * Returns the raw buffer.
   */
  async downloadFile(fileHash: string): Promise<Buffer> {
    const stream = await this.client.getObject(this.bucket, fileHash);
    return streamToBuffer(stream as Readable);
  }

  /**
   * Soft-delete: copy the object to "deleted/<hash>" then remove the
   * live object.  The metadata record in MongoDB is tombstoned separately
   * by the CRUD layer.
   */
  async deleteFile(fileHash: string): Promise<void> {
    const data = await this.downloadFile(fileHash);
    const stream = Readable.from(data);
    const tombstoneKey = `deleted/${fileHash}`;

    await this.client.putObject(this.bucket, tombstoneKey, stream, data.length);
    await this.client.removeObject(this.bucket, fileHash);
    logger.info('[BlobStore] File soft-deleted', { fileHash });
  }

  /**
   * Retrieve the object metadata stored in MinIO headers.
   * Returns a minimal stat object; the full FileMeta is in MongoDB.
   */
  async getFileMeta(fileHash: string): Promise<{
    fileHash: string;
    sizeBytes: number;
    lastModified: Date;
    mimeType: string;
  }> {
    const stat = await this.client.statObject(this.bucket, fileHash);
    return {
      fileHash,
      sizeBytes: stat.size,
      lastModified: stat.lastModified,
      mimeType: stat.metaData?.['content-type'] ?? 'application/octet-stream',
    };
  }

  async fileExists(fileHash: string): Promise<boolean> {
    try {
      await this.client.statObject(this.bucket, fileHash);
      return true;
    } catch {
      return false;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
