'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const S=require('./privsearch/stage1-state');
const {ABI,RpcTransport,IndependentStateReader,block,quantity}=require('./privsearch/stage1-chain-reader');
const {Stage1Client}=require('./privsearch/stage1-client');
const audit=require('./privsearch/audit-v2-protocol');
const {BatchAuditServer}=require('./privsearch/audit-v2-batch-witness');
const {ROOT,envConfig,reportPath}=require('./preflight-privsearch-stage1');
function options(args) {
  S.check(args[0]==='--deployment'&&args[1]&&(args.length===2||args.length===4&&args[2]==='--visibility-timeout-ms'),'Usage: node scripts/pilot-privsearch-stage1.js --deployment LOCAL_DEPLOYMENT_JSON [--visibility-timeout-ms 180000]');
  const timeout=Number(args[3]||180000);S.check(Number.isSafeInteger(timeout)&&timeout>=1000&&timeout<=600000,'Visibility timeout must be 1000..600000 ms');
  return {deployment:path.resolve(args[1]),timeout};
}
function restoreServer(packed) {
  return new BatchAuditServer({manifest:packed.manifest,lists:new Map(packed.lists.map(([token,e])=>[token,{docs:e.docs,primes:e.primes.map(BigInt)}]))});
}
async function bufferStream(stream) {const parts=[];for await(const part of stream)parts.push(Buffer.from(part));return Buffer.concat(parts);}
async function main() {
  const o=options(process.argv.slice(2)),c=envConfig(),out=reportPath('stage1_live_pilot'),cases=[],setup=[],receipts=[];
  const runId=crypto.randomUUID(),datasetId=S.hash('pilot-dataset',runId),record=JSON.parse(fs.readFileSync(o.deployment,'utf8')),pins=record.pins;
  S.check(record.schema==='privsearch-stage1-deployment-1','Local owner deployment record required');
  S.check(record.contract_source_sha256===S.sha(fs.readFileSync(path.join(ROOT,'contracts','PrivSearchStateAnchor.sol'))),'Contract source differs from deployment record');
  S.check(String(pins.chainId)===c.chainId,'Deployment chain differs from configuration');
  S.check(S.canonical(pins.finality)===S.canonical(c.finality)&&pins.blockSelector===c.blockSelector,'Visibility policy differs from deployment record; create a fresh explicit deployment record under the desired policy');
  S.check(pins.contract.toLowerCase()!==(process.env.LIFEDB_ANCHOR_CONTRACT||'').toLowerCase(),'Use a separate PrivSearch state contract');
  const {ethers}=require('ethers'),{MongoClient}=require('mongodb'),{Client}=require('minio');
  const clientRpc=new RpcTransport(c.clientRpc),ownerRpc=new RpcTransport(c.ownerRpc),provider=new ethers.JsonRpcProvider(c.ownerRpc);
  let mongo;
  const summary={schema:'privsearch-stage1-live-pilot-1',status:'STAGE1_PILOT_INCOMPLETE',run_id:runId,dataset_id:datasetId,generated_at:new Date().toISOString(),pins,cases,setup,receipts,
    scope:{source:'Synthetic three-result AND-2 fixture; no healthcare or Enron payload data.',services:'Actual MongoDB, MinIO and PureChain RPC. Explicit diagnostic runner; no REST API or WAN claim.',roles:'Owner/server/client objects in one harness process. Client state and keys are private members; no process isolation or OS sandbox claim.',storage:'New run namespace in privsearch_stage1_states collection and MinIO privsearch-stage1 prefix; no existing records or objects are changed or removed.',freshness:'Latest head at the independently selected visibility block, checked before payload retrieval and again before result release.',finality:pins.finality,provider_trust:'RPC node is trusted for canonical state and finality. No quorum or consensus light-client proof.',rollback:'In-memory reader watermarks detect rollback within a reader lifetime. Persisted cross-restart rollback protection is not implemented.',query_timing:'MongoDB snapshot and server-data reads, client signature/state installation, server initialization, answer/proof creation, RSA verification, two live chain observations, MinIO reads, manifest checks and authenticated decryption. Owner preparation, storage publication, deployment and anchoring are separate.',completeness:false,encrypted_search_privacy:false,stable_latency_tail_estimates:false},
    node:process.version,code_sha256:Object.fromEntries(['pilot-privsearch-stage1.js','privsearch/stage1-state.js','privsearch/stage1-chain-reader.js','privsearch/stage1-client.js','privsearch/audit-v2-protocol.js','privsearch/audit-v2-batch-witness.js'].map(n=>[n,S.sha(fs.readFileSync(path.join(__dirname,n)))]))};
  function save() {fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2));}
  save();
  try {
    for(const rpc of [clientRpc,ownerRpc]) {
      S.check(quantity(await rpc.send('eth_chainId',[]))===BigInt(pins.chainId),'Chain mismatch');
      S.check(block(await rpc.send('eth_getBlockByNumber',['0x0',false])).hash.toLowerCase()==='0x'+pins.genesisHash,'Genesis mismatch');
    }
    const wallet=new ethers.Wallet(process.env.PURECHAIN_PRIVATE_KEY,provider);S.check(wallet.address.toLowerCase()===pins.owner.toLowerCase(),'Configured signer is not pinned state owner');
    const contract=new ethers.Contract(pins.contract,ABI,wallet),runtime=await ownerRpc.send('eth_getCode',[pins.contract,'latest']);S.check(S.sha(Buffer.from(runtime.slice(2),'hex'))===pins.codeHash,'Owner contract code mismatch');
    S.check((await contract.owner()).toLowerCase()===pins.owner.toLowerCase(),'Owner contract authority mismatch');
    S.check((await contract.getState('0x'+datasetId))[0]===0n,'Pilot namespace already used');
    mongo=new MongoClient(c.mongoUri,{serverSelectionTimeoutMS:10000});await mongo.connect();const collection=mongo.db(c.mongoDb).collection('privsearch_stage1_states');
    const minio=new Client(c.minio);S.check(await minio.bucketExists(c.bucket),'Existing MinIO bucket required');
    const reader=new IndependentStateReader(pins,clientRpc),decryptionKey=crypto.randomBytes(32),ownerKeys=crypto.generateKeyPairSync('ed25519'),tokens=[crypto.randomBytes(32).toString('hex'),crypto.randomBytes(32).toString('hex')],query=[tokens];
    async function prepare(sequence,previous) {
      const start=performance.now(),docs=sequence==='1'?['fixture-a','fixture-b','fixture-c']:['fixture-a','fixture-b','fixture-d'];
      const owner=audit.buildOwnerState(new Map(tokens.map(t=>[t,docs])),{version:'stage1-'+runId+'-'+sequence,sequence:Number(sequence),keyPair:ownerKeys});
      const metadata={families:['and_2'],token_derivation:'random fixture tokens',expansion:'none',payload_source:'synthetic fixture',namespace:runId};
      const descriptors=[],expected=Object.fromEntries(docs.map(id=>[id,S.canonical({fixture:true,document_id:id,revision:sequence,measurement:'synthetic-healthcare-domain-text'})]));
      let minioPublishMs=0;
      for(const id of docs) {
        const ctx={dataset_id:datasetId,document_id:id,revision:sequence,key_id:'stage1-pilot'},e=S.encryptPayload(Buffer.from(expected[id]),decryptionKey,ctx);
        const key='privsearch-stage1/'+runId+'/'+S.hash('document-handle',id)+'/'+S.hash('ciphertext-envelope',e)+'.json',encoded=Buffer.from(S.canonical(e)),t=performance.now();
        await minio.putObject(c.bucket,key,encoded,encoded.length,{'content-type':'application/json'});minioPublishMs+=performance.now()-t;descriptors.push(S.descriptor(ctx,e,key));
      }
      const built=S.buildState({pins,datasetId,sequence,auditManifest:owner.envelope.manifest,ownerPublicKey:owner.publicKey,metadata,payloadDescriptors:descriptors,previousCommitment:previous});
      const packed={manifest:owner.serverData.manifest,lists:[...owner.serverData.lists].map(([token,e])=>[token,{docs:e.docs,primes:e.primes.map(String)}])};
      const snapshot={run_id:runId,sequence,state:built.state,envelope:owner.envelope,metadata,payloads:built.payloads,payload_proofs:built.payloadProofs,server_data:packed};
      const t=performance.now();await collection.insertOne(snapshot);setup.push({sequence,preparation_and_publication_ms:performance.now()-start,minio_publication_ms:minioPublishMs,mongodb_publication_ms:performance.now()-t,posting_references:docs.length*tokens.length,result_count:docs.length});
      return {...built,expected,ownerPublicKey:owner.publicKey};
    }
    async function waitVisible(candidate) {
      const start=performance.now();let attempts=0;
      while(performance.now()-start<o.timeout) {
        attempts++;
        try {const observation=await reader.observe(candidate.state);return {wait_ms:performance.now()-start,attempts,observation};}
        catch(e) {if(!/latest visible|code unavailable|contract code differs|RPC method rejected|Block unavailable/.test(e.message))throw e;}
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      throw new Error('Visibility timeout; state never passed the explicit client policy');
    }
    async function anchor(candidate) {
      const start=performance.now(),overrides={};if(process.env.PURECHAIN_GAS_PRICE)overrides.gasPrice=BigInt(process.env.PURECHAIN_GAS_PRICE);
      const tx=await contract.anchorState('0x'+datasetId,BigInt(candidate.state.sequence),'0x'+candidate.commitment,'0x'+candidate.state.previous_commitment,overrides);
      const receipt=await tx.wait();S.check(receipt&&receipt.status===1,'Anchor transaction failed');
      const confirmationMs=performance.now()-start,visible=await waitVisible(candidate);
      receipts.push({sequence:candidate.state.sequence,commitment:candidate.commitment,transaction_hash:tx.hash,gas_used:receipt.gasUsed.toString(),receipt_block:receipt.blockNumber,submission_to_receipt_ms:confirmationMs,receipt_to_visible_ms:visible.wait_ms,visibility_attempts:visible.attempts,observation:visible.observation});save();
    }
    async function exchange(candidate,{mutateSnapshot,mutateAnswer,mutateProof,retrieveTransform}={}) {
      const start=performance.now(),readStart=performance.now(),snap=await collection.findOne({run_id:runId,sequence:candidate.state.sequence});S.check(snap,'Snapshot unavailable');
      const dbMs=performance.now()-readStart;
      if(mutateSnapshot)mutateSnapshot(snap);
      const client=new Stage1Client({state:snap.state,envelope:snap.envelope,ownerPublicKey:candidate.ownerPublicKey,metadata:snap.metadata,reader,decryptionKey,sampleSize:5}),server=restoreServer(snap.server_data);
      const answer=server.createAnswer(query);if(mutateAnswer)mutateAnswer(answer);
      const challenge=client.createChallenge(answer,query),proof=server.createProof(answer,query,challenge);if(mutateProof)mutateProof(proof);
      const packets=answer.result_docs.map(id=>{const i=snap.payloads.findIndex(d=>d.context.document_id===id);S.check(i>=0,'Payload absent');return {descriptor:snap.payloads[i],proof:snap.payload_proofs[i]};});
      const r=await client.verify(proof,packets,async key=>{const encoded=await bufferStream(await minio.getObject(c.bucket,key));return retrieveTransform?retrieveTransform(encoded,key,snap):encoded;});
      const exact=Object.keys(candidate.expected).sort().join('|')===r.result_docs.slice().sort().join('|');
      for(const p of r.payloads)S.check(p.plaintext.toString()===candidate.expected[p.document_id],'Plaintext reference mismatch');
      return {verified:r.verified,exact_reference_match:exact,result_count:r.result_docs.length,total_verified_query_ms:performance.now()-start,mongodb_snapshot_read_ms:dbMs,blockchain_verification_ms:r.blockchain_verification_ms,payload_retrieval_ms:r.payload_retrieval_ms,payload_verification_and_decryption_ms:r.payload_verification_and_decryption_ms,checked_witnesses:r.checked_witnesses,first_observation:r.first_observation,release_observation:r.release_observation,rpc_calls:r.first_observation.rpc_calls+r.release_observation.rpc_calls,chain_retry_events:[...r.first_observation.retry_events.map(e=>({phase:'before-payloads',...e})),...r.release_observation.retry_events.map(e=>({phase:'before-release',...e}))]};
    }
    async function honest(name,candidate) {const r=await exchange(candidate);S.check(r.verified&&r.exact_reference_match,'Honest result differs from fixture reference');cases.push({name,passed:true,...r});save();console.log('PASS '+name);}
    async function rejection(name,candidate,mutation,reason) {
      let matched=false;
      try{await exchange(candidate,mutation);}catch(e){if(!reason.test(e.message))throw new Error('Unexpected failure in '+name);matched=true;}
      S.check(matched,'Attack unexpectedly accepted: '+name);cases.push({name,passed:true,expected:'reject',reason_category:reason.source});save();console.log('PASS '+name);
    }
    console.log('Preparing and anchoring synthetic fixture version 1.');
    const v1=await prepare('1',S.ZERO);await anchor(v1);await honest('honest_v1',v1);
    await rejection('forged_RSA_witness',v1,{mutateProof:p=>p.witnesses[0].witness_hex='0'.repeat(audit.WITNESS_BYTES*2)},/RSA membership/);
    await rejection('changed_coverage_root',v1,{mutateSnapshot:s=>s.state.coverage_root='1'.repeat(64)},/Coverage root mismatch/);
    await rejection('changed_query_metadata',v1,{mutateSnapshot:s=>s.metadata.expansion='server-modified'},/Query metadata mismatch/);
    await rejection('changed_object_locator',v1,{mutateSnapshot:s=>s.payloads[0].object_key=s.payloads[1].object_key},/Manifest membership/);
    await rejection('tampered_ciphertext_envelope',v1,{retrieveTransform:b=>{const e=JSON.parse(b);e.tag_hex='0'.repeat(32);return Buffer.from(JSON.stringify(e));}},/envelope digest mismatch/);
    await rejection('valid_other_object_swap',v1,{retrieveTransform:async(b,key,s)=>{const other=s.payloads.find(d=>d.object_key!==key);return bufferStream(await minio.getObject(c.bucket,other.object_key));}},/envelope digest mismatch/);
    await honest('honest_v1_after_attacks',v1);
    const omission=await exchange(v1,{mutateAnswer:a=>{const omitted=a.result_docs[0];a.result_docs=a.result_docs.filter(id=>id!==omitted);a.clause_docs=a.clause_docs.map(ds=>ds.filter(id=>id!==omitted));}});
    S.check(omission.verified&&!omission.exact_reference_match,'Omission negative-control behavior changed');cases.push({name:'omission_negative_control',passed:true,expected:'cryptographic acceptance with harness reference mismatch; no completeness claim',...omission});save();
    console.log('Publishing synthetic version 2 before anchoring.');const v2=await prepare('2',v1.commitment);
    await rejection('signed_but_unanchored_v2',v2,{},/latest visible/);await honest('pending_update_preserves_anchored_v1',v1);
    console.log('Anchoring version 2 and checking stale version 1.');await anchor(v2);await honest('honest_v2',v2);await rejection('stale_v1_after_visible_v2',v1,{},/latest visible/);await honest('honest_v2_after_stale_injection',v2);
    summary.status=pins.finality.kind==='finalized'?'STAGE1_LIVE_FIXTURE_PILOT_PASSED':'STAGE1_DEPTH_CONFIRMED_FIXTURE_PILOT_PASSED';summary.snapshot_commitments=[v1.commitment,v2.commitment];save();console.log(summary.status);console.log('STAGE1_REPORT_DIRECTORY: '+out);
  } catch(e) {summary.status='STAGE1_PILOT_STOPPED';summary.failed_reason=String(e.message).replace(/https?:\/\/\S+/g,'[endpoint]').replace(/mongodb(?:\+srv)?:\/\/\S+/g,'[endpoint]').replace(/(?:0x)?[0-9a-f]{64,}/gi,'[hex-value]');summary.rpc_failure_diagnostics={code:e.code??null,stage:e.stage||null,method:e.rpc_method||null,provider_message:e.provider_message||null,selector:e.selector||null,observation_attempts:e.observation_attempts||null,rpc_calls:e.rpc_calls||null,retry_events:e.retry_events||[]};save();console.error('STAGE1_PILOT_STOPPED: '+summary.failed_reason);console.error('PARTIAL_REPORT_DIRECTORY: '+out);process.exitCode=1;}
  finally {if(mongo)await mongo.close();provider.destroy();}
}
if(require.main===module)main().catch(()=>{console.error('STAGE1_PILOT_FAILED: Invalid deployment file, arguments, installed dependencies or configuration.');process.exitCode=1;});
module.exports={options,restoreServer,main};
