'use strict';
const {performance}=require('node:perf_hooks');
const stateCore=require('./stage1-state');
const {AuditClient}=require('./audit-v2-protocol');
class Stage1Client {
  #state;#reader;#audit;#key;
  constructor({state,envelope,ownerPublicKey,metadata,reader,decryptionKey,sampleSize=5}) {
    this.#state=JSON.parse(stateCore.canonical(state));
    // Existing independent signature and RSA verification remain in use.
    this.#audit=new AuditClient(envelope,ownerPublicKey,{sampleSize});
    stateCore.bindAuditState(this.#state,envelope,ownerPublicKey,metadata);
    stateCore.check(Buffer.isBuffer(decryptionKey)&&decryptionKey.length===32,'32-byte client decryption key required');
    this.#key=Buffer.from(decryptionKey);this.#reader=reader;
  }
  createChallenge(answer,query) { return this.#audit.createChallenge(answer,query); }
  async verify(proof,payloadProofs,retrieve) {
    const start=performance.now(),membership=this.#audit.verify(proof);
    stateCore.check(membership.verified,'RSA membership verification failed: '+membership.reason);
    const first=await this.#reader.observe(this.#state);
    stateCore.check(Array.isArray(payloadProofs)&&payloadProofs.length===membership.result_docs.length,'Payload response count mismatch');
    const map=new Map(payloadProofs.map(p=>[p.descriptor.context.document_id,p]));
    stateCore.check(map.size===payloadProofs.length,'Duplicate payload response');
    const payloadStart=performance.now(),payloads=[];let retrievalMs=0;
    for(const id of membership.result_docs) {
      const packet=map.get(id);stateCore.check(packet,'Missing payload response');
      stateCore.check(packet.descriptor.context.document_id===id&&packet.descriptor.context.dataset_id===this.#state.dataset_id,'Payload response identity mismatch');
      stateCore.check(packet.proof.count===this.#state.payload_count,'Payload response manifest count mismatch');
      // Verify the handle before using it for an object-store lookup.
      stateCore.verifyLeaf(packet.descriptor,packet.proof,'payload-manifest',this.#state.payload_root);
      const fetchStart=performance.now(),encoded=await retrieve(packet.descriptor.object_key);retrievalMs+=performance.now()-fetchStart;
      const envelope=Buffer.isBuffer(encoded)?JSON.parse(encoded.toString('utf8')):encoded;
      const plaintext=stateCore.decryptPayload(envelope,this.#key,packet.descriptor,packet.proof,this.#state,id);
      payloads.push({document_id:id,plaintext});
    }
    const payloadMs=performance.now()-payloadStart;
    // State changes during payload I/O must not release an obsolete result.
    const release=await this.#reader.observe(this.#state);
    return {verified:true,result_docs:membership.result_docs,payloads,checked_documents:membership.checked_documents,checked_witnesses:membership.checked_witnesses,
      omission_completeness:false,encrypted_search_privacy:false,first_observation:first,release_observation:release,
      blockchain_verification_ms:first.blockchain_verification_ms+release.blockchain_verification_ms,payload_retrieval_ms:retrievalMs,payload_verification_and_decryption_ms:payloadMs-retrievalMs,client_verified_exchange_ms:performance.now()-start};
  }
}
module.exports={Stage1Client};
