// ─────────────────────────────────────────────────────────────
// Services container — single source of truth for wired-up
// CRUD / blockchain / storage singletons injected into routes.
// ─────────────────────────────────────────────────────────────
import type { CreateOperation } from '../../crud/create';
import type { ReadOperation } from '../../crud/read';
import type { UpdateOperation } from '../../crud/update';
import type { DeleteOperation } from '../../crud/delete';
import type { AuditAgent } from '../../agents/audit-agent';
import type { DocumentStore } from '../../storage/document-store';
import type { BlobStore } from '../../storage/blob-store';
import type { IpfsStore } from '../../storage/ipfs-store';
import type { LifeDBChain } from '../../blockchain/chain';
import type { ChainValidator } from '../../blockchain/chain';
import type { ConsensusEngine } from '../../blockchain/consensus';
import type { SupplyChainCRUD } from '../../crud/supplychain-crud';
import type { ReplayProtection } from './replay-protection';

export interface Services {
  createOp: CreateOperation;
  readOp: ReadOperation;
  updateOp: UpdateOperation;
  deleteOp: DeleteOperation;
  auditAgent: AuditAgent;
  documentStore: DocumentStore;
  fileMetaStore: DocumentStore;
  hashLogStore: DocumentStore;
  blobStore: BlobStore;
  ipfsStore?: IpfsStore;
  chain: LifeDBChain;
  chainValidator: ChainValidator;
  consensus: ConsensusEngine;
  supplyChainCrud: SupplyChainCRUD;
  replayProtection: ReplayProtection;
}

let _services: Services | null = null;

export function setServices(s: Services): void {
  _services = s;
}

export function getServices(): Services {
  if (!_services) throw new Error('[Services] Not initialised yet');
  return _services;
}
