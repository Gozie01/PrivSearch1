import http from 'http';
import https from 'https';

import { config } from '../config';
import { logger } from '../utils/logger';

export interface IpfsAddResult {
  cid: string;
  sizeBytes: number;
}

function requestBuffer(url: URL, options: http.RequestOptions, body?: Buffer): Promise<Buffer> {
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(url, options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`IPFS API ${res.statusCode}: ${data.toString('utf8')}`));
          return;
        }
        resolve(data);
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

export class IpfsStore {
  private readonly apiUrl: URL;
  private readonly gatewayUrl: URL;

  constructor() {
    this.apiUrl = new URL(config.ipfs.apiUrl);
    this.gatewayUrl = new URL(config.ipfs.gatewayUrl);
  }

  get enabled(): boolean {
    return config.ipfs.enabled;
  }

  async healthCheck(): Promise<void> {
    if (!this.enabled) return;
    const url = new URL('/api/v0/id', this.apiUrl);
    await requestBuffer(url, {
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
    });
    logger.info('[IPFS] API reachable', { apiUrl: this.apiUrl.toString() });
  }

  async addFile(file: Buffer, filename: string): Promise<IpfsAddResult> {
    if (!this.enabled) throw new Error('[IPFS] Store is disabled');

    const boundary = `lifedb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const safeName = filename.replace(/"/g, '');
    const prefix = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
      'utf8',
    );
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const body = Buffer.concat([prefix, file, suffix]);
    const url = new URL('/api/v0/add', this.apiUrl);
    url.searchParams.set('pin', String(config.ipfs.pinUploads));
    url.searchParams.set('cid-version', String(config.ipfs.cidVersion));

    const response = await requestBuffer(
      url,
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
      },
      body,
    );

    const lines = response.toString('utf8').trim().split(/\r?\n/);
    const last = JSON.parse(lines[lines.length - 1]) as { Hash?: string; Size?: string };
    if (!last.Hash) throw new Error('[IPFS] Add response did not include a CID');

    return {
      cid: last.Hash,
      sizeBytes: Number(last.Size ?? file.length),
    };
  }

  async catFile(cid: string): Promise<Buffer> {
    if (!this.enabled) throw new Error('[IPFS] Store is disabled');
    const url = new URL('/api/v0/cat', this.apiUrl);
    url.searchParams.set('arg', cid);
    return requestBuffer(url, {
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
    });
  }

  gatewayUrlForCid(cid: string): string {
    return new URL(`/ipfs/${cid}`, this.gatewayUrl).toString();
  }
}
