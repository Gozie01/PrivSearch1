'use strict';
const crypto = require('node:crypto');
const SCHEMA = 'privsearch-state-v3.1';
const ZERO = '0'.repeat(64);
function check(ok, message) { if (!ok) throw new Error(message); }
function exact(value, names) {
  check(value && Object.getPrototypeOf(value) === Object.prototype, 'Expected plain object');
  check(Object.keys(value).sort().join('|') === names.slice().sort().join('|'), 'Unexpected or missing fields');
}
function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { check(Number.isSafeInteger(value), 'Only safe integer JSON numbers supported'); return String(value); }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  check(value && Object.getPrototypeOf(value) === Object.prototype, 'Noncanonical JSON type');
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function hash(domain, value) { return sha(Buffer.from(canonical([SCHEMA, domain, value]))); }
function hex(value, bytes = 32) { check(typeof value === 'string' && new RegExp('^[0-9a-f]{' + bytes * 2 + '}$').test(value), 'Invalid canonical hex'); return value; }
function uint(value, max = (1n << 64n) - 1n, zero = false) {
  check(typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value), 'Invalid canonical integer string');
  check(BigInt(value) <= max && (zero || BigInt(value) > 0n), 'Integer out of range'); return value;
}
function text(value) { check(typeof value === 'string' && value.length > 0 && value.length <= 1024, 'Invalid identifier'); return value; }
function tree(values, domain) {
  check(Array.isArray(values) && values.length > 0 && values.length <= 1000000, 'Nonempty bounded manifest required');
  const levels = [values.map(v => hash(domain + '/leaf', v))];
  while (levels.at(-1).length > 1) {
    const level = levels.at(-1), next = [];
    for (let i = 0; i < level.length; i += 2) next.push(hash(domain + '/node', [level[i], level[i+1] || level[i]]));
    levels.push(next);
  }
  const root = hash(domain + '/root', [values.length, levels.at(-1)[0]]);
  return { root, proof(index) {
    check(Number.isSafeInteger(index) && index >= 0 && index < values.length, 'Invalid leaf index');
    const siblings = []; let cursor = index;
    for (const level of levels.slice(0,-1)) { siblings.push(level[cursor ^ 1] || level[cursor]); cursor = Math.floor(cursor/2); }
    return { index, count: values.length, siblings };
  }};
}
function verifyLeaf(value, proof, domain, root) {
  exact(proof, ['index','count','siblings']); hex(root);
  const { index, count, siblings } = proof;
  check(Number.isSafeInteger(count) && count > 0 && count <= 1000000 && Number.isSafeInteger(index) && index >= 0 && index < count, 'Invalid proof position/count');
  check(Array.isArray(siblings), 'Invalid sibling list');
  let cursor = index, width = count, h = hash(domain + '/leaf', value), i = 0;
  while (width > 1) {
    const sibling = hex(siblings[i++]);
    if (!(cursor & 1) && cursor + 1 >= width) check(sibling === h, 'Noncanonical odd-node proof');
    h = hash(domain + '/node', cursor & 1 ? [sibling,h] : [h,sibling]);
    cursor = Math.floor(cursor/2); width = Math.ceil(width/2);
  }
  check(i === siblings.length, 'Wrong proof depth');
  check(hash(domain + '/root', [count,h]) === root, 'Manifest membership failed');
  return true;
}
function context(c) {
  exact(c, ['dataset_id','document_id','revision','key_id']);
  hex(c.dataset_id); text(c.document_id); uint(c.revision); text(c.key_id); return c;
}
function keyFor(master, c) {
  check(Buffer.isBuffer(master) && master.length === 32, '32-byte client key required'); context(c);
  return Buffer.from(crypto.hkdfSync('sha256', master, Buffer.from(c.dataset_id,'hex'), Buffer.from(canonical([SCHEMA,'payload-key',c.key_id])),32));
}
function encryptPayload(plaintext, master, c) {
  check(Buffer.isBuffer(plaintext), 'Payload must be bytes'); context(c);
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm',keyFor(master,c),iv,{authTagLength:16});
  cipher.setAAD(Buffer.from(canonical([SCHEMA,'payload-aad',c])));
  const ciphertext = Buffer.concat([cipher.update(plaintext),cipher.final()]);
  return { schema: SCHEMA, iv_hex:iv.toString('hex'), tag_hex:cipher.getAuthTag().toString('hex'), ciphertext_b64:ciphertext.toString('base64') };
}
function validateEnvelope(e) {
  exact(e,['schema','iv_hex','tag_hex','ciphertext_b64']); check(e.schema===SCHEMA,'Unsupported payload schema'); hex(e.iv_hex,12); hex(e.tag_hex,16);
  check(typeof e.ciphertext_b64==='string' && Buffer.from(e.ciphertext_b64,'base64').toString('base64')===e.ciphertext_b64,'Noncanonical payload encoding');
}
function descriptor(c,e,objectKey) {
  context(c); validateEnvelope(e); text(objectKey);
  return { context: JSON.parse(canonical(c)), object_key:objectKey, envelope_digest:hash('ciphertext-envelope',e), ciphertext_bytes:Buffer.from(e.ciphertext_b64,'base64').length, status:'active' };
}
function validateDescriptor(d) {
  exact(d,['context','object_key','envelope_digest','ciphertext_bytes','status']); context(d.context); text(d.object_key); hex(d.envelope_digest);
  check(Number.isSafeInteger(d.ciphertext_bytes) && d.ciphertext_bytes>=0,'Invalid payload size'); check(d.status==='active','Inactive payload');
}
function decryptPayload(e,master,d,proof,state,requestedDocumentId) {
  validateState(state); validateDescriptor(d); validateEnvelope(e);
  check(d.context.document_id===requestedDocumentId && d.context.dataset_id===state.dataset_id,'Requested payload identity mismatch');
  check(proof.count===state.payload_count,'Payload manifest count mismatch');
  verifyLeaf(d,proof,'payload-manifest',state.payload_root);
  check(hash('ciphertext-envelope',e)===d.envelope_digest,'Ciphertext envelope digest mismatch');
  check(Buffer.from(e.ciphertext_b64,'base64').length===d.ciphertext_bytes,'Ciphertext length mismatch');
  const decipher=crypto.createDecipheriv('aes-256-gcm',keyFor(master,d.context),Buffer.from(e.iv_hex,'hex'),{authTagLength:16});
  decipher.setAAD(Buffer.from(canonical([SCHEMA,'payload-aad',d.context]))); decipher.setAuthTag(Buffer.from(e.tag_hex,'hex'));
  // Never return update() plaintext before final() authenticates the entire payload.
  return Buffer.concat([decipher.update(Buffer.from(e.ciphertext_b64,'base64')),decipher.final()]);
}
const STATE_FIELDS=['schema','chain_id','genesis_hash','contract','owner','dataset_id','sequence','snapshot_version','index_snapshot_digest','owner_signing_key_digest','parameters_digest','authentication_root','coverage_root','metadata_digest','payload_root','posting_count','payload_count','previous_commitment'];
function validateState(s) {
  exact(s,STATE_FIELDS); check(s.schema===SCHEMA,'Unsupported state schema'); uint(s.chain_id,(1n<<256n)-1n); uint(s.sequence); text(s.snapshot_version);
  hex(s.contract,20); hex(s.owner,20); check(s.contract!=='0'.repeat(40)&&s.owner!=='0'.repeat(40),'Zero identity'); hex(s.dataset_id); check(s.dataset_id!==ZERO,'Zero dataset');
  for(const field of ['genesis_hash','index_snapshot_digest','owner_signing_key_digest','parameters_digest','authentication_root','coverage_root','metadata_digest','payload_root','previous_commitment']) hex(s[field]);
  for(const field of ['posting_count','payload_count']) check(Number.isSafeInteger(s[field])&&s[field]>0&&s[field]<=1000000,'Invalid manifest count');
}
function commitment(s) { validateState(s); return hash('state-commitment',s); }
function buildState({pins,datasetId,sequence,auditManifest,ownerPublicKey,metadata,payloadDescriptors,previousCommitment=ZERO}) {
  check(auditManifest&&Array.isArray(auditManifest.entries)&&auditManifest.entries.length>0,'Audit manifest required');
  const entries=auditManifest.entries.slice().sort((a,b)=>a.token<b.token?-1:a.token>b.token?1:0);
  check(new Set(entries.map(e=>e.token)).size===entries.length,'Duplicate posting token');
  for(const e of entries) { hex(e.token);hex(e.posting_digest);check(Number.isSafeInteger(e.count)&&e.count>=0,'Invalid posting count');check(typeof e.accumulator_hex==='string'&&/^[0-9a-f]+$/.test(e.accumulator_hex),'Invalid accumulator'); }
  const payloads=payloadDescriptors.slice().sort((a,b)=>a.context.document_id<b.context.document_id?-1:a.context.document_id>b.context.document_id?1:0);
  payloads.forEach(validateDescriptor); check(new Set(payloads.map(d=>d.context.document_id)).size===payloads.length,'Duplicate payload identity');
  check(payloads.every(d=>d.context.dataset_id===datasetId),'Cross-dataset payload');
  const ad=tree(entries.map(e=>({token:e.token,accumulator_hex:e.accumulator_hex})),'authentication');
  const cd=tree(entries.map(e=>({token:e.token,count:e.count,posting_digest:e.posting_digest})),'coverage');
  const pd=tree(payloads,'payload-manifest');
  const state={schema:SCHEMA,chain_id:String(pins.chainId),genesis_hash:pins.genesisHash.toLowerCase().replace(/^0x/,''),contract:pins.contract.toLowerCase().replace(/^0x/,''),owner:pins.owner.toLowerCase().replace(/^0x/,''),dataset_id:datasetId,sequence:String(sequence),snapshot_version:auditManifest.version,
    // Keep audit-v2's exact signed JSON encoding here so answers bind to the same digest.
    index_snapshot_digest:sha(Buffer.from(JSON.stringify(auditManifest))),owner_signing_key_digest:sha(Buffer.from(ownerPublicKey)),parameters_digest:hash('parameters',auditManifest.parameters),authentication_root:ad.root,coverage_root:cd.root,metadata_digest:hash('query-metadata',metadata),payload_root:pd.root,posting_count:entries.length,payload_count:payloads.length,previous_commitment:previousCommitment};
  return {state,commitment:commitment(state),payloads,payloadProofs:payloads.map((_,i)=>pd.proof(i))};
}
function bindAuditState(state,envelope,ownerPublicKey,metadata) {
  validateState(state);
  check(sha(Buffer.from(JSON.stringify(envelope.manifest)))===state.index_snapshot_digest,'Index snapshot differs from anchored state');
  check(sha(Buffer.from(ownerPublicKey))===state.owner_signing_key_digest,'Wrong signing authority');
  check(hash('parameters',envelope.manifest.parameters)===state.parameters_digest,'Accumulator parameter mismatch');
  check(hash('query-metadata',metadata)===state.metadata_digest,'Query metadata mismatch');
  check(envelope.manifest.version===state.snapshot_version,'Snapshot version mismatch');
  const entries=envelope.manifest.entries.slice().sort((a,b)=>a.token<b.token?-1:a.token>b.token?1:0);
  check(entries.length===state.posting_count,'Posting manifest count mismatch');
  check(tree(entries.map(e=>({token:e.token,accumulator_hex:e.accumulator_hex})),'authentication').root===state.authentication_root,'Authentication root mismatch');
  check(tree(entries.map(e=>({token:e.token,count:e.count,posting_digest:e.posting_digest})),'coverage').root===state.coverage_root,'Coverage root mismatch');
  // Signature verification is separately required via the unchanged AuditClient.
}
module.exports={SCHEMA,ZERO,check,exact,canonical,sha,hash,hex,uint,tree,verifyLeaf,context,encryptPayload,descriptor,decryptPayload,validateState,commitment,buildState,bindAuditState};
