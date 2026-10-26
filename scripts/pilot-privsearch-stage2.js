'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const S=require('./privsearch/stage1-state'),C=require('./privsearch/stage2-completeness'),audit=require('./privsearch/audit-v2-protocol');
const {ABI,RpcTransport,IndependentStateReader,block,quantity}=require('./privsearch/stage1-chain-reader');
const {Stage1Client}=require('./privsearch/stage1-client');
const {restoreServer}=require('./pilot-privsearch-stage1');
const {ROOT,envConfig,reportPath}=require('./preflight-privsearch-stage1');
const clone=v=>JSON.parse(S.canonical(v));
async function bufferStream(stream) {const chunks=[];for await(const c of stream)chunks.push(Buffer.from(c));return Buffer.concat(chunks);}
function options(args) {
  S.check(args[0]==='--deployment'&&args[1]&&(args.length===2||args.length===4&&args[2]==='--visibility-timeout-ms'),'Usage: node scripts/pilot-privsearch-stage2.js --deployment LOCAL_JSON [--visibility-timeout-ms 180000]');
  const timeout=Number(args[3]||180000);S.check(Number.isSafeInteger(timeout)&&timeout>=1000&&timeout<=600000,'Visibility timeout must be 1000..600000 ms');
  return {deployment:path.resolve(args[1]),timeout};
}
async function main(args=process.argv.slice(2)) {
  const o=options(args),c=envConfig(),out=reportPath('stage2_live_completeness'),runId=crypto.randomUUID(),datasetId=S.hash('stage2-pilot-dataset',runId),record=JSON.parse(fs.readFileSync(o.deployment,'utf8')),pins=record.pins;
  const summary={schema:'privsearch-stage2-full-posting-pilot-1',status:'STAGE2_PILOT_INCOMPLETE',run_id:runId,dataset_id:datasetId,generated_at:new Date().toISOString(),pins,cases:[],setup:[],receipts:[],
    scope:{source:'Synthetic six-document, five-posting snapshot; AND, OR and OR-of-AND including empty/disjoint cases. No healthcare/Enron workload.',services:'Actual MongoDB, MinIO and PureChain in the live runner; no REST API or process isolation.',storage:'New run namespace in privsearch_stage2_states and MinIO privsearch-stage2 prefix; no existing objects or records are changed or removed.',completeness:'Exact clause and final-set recomputation from full authenticated postings, for prepared tokens in the anchored snapshot. Honest owner and SHA-256 binding assumed.',proof_cost:'Full posting disclosure to the authorized client; linear opening size. Not a compact intersection proof.',encrypted_search_privacy:false,expansion_completeness:false,expanded_query_boundary:'Range, fuzzy and semantic expansion are outside this token-DNF checkpoint.',finality:pins.finality,provider_trust:'Single trusted RPC; no consensus light-client proof or quorum. Confirmation depth is provisional.',rollback:'Existing in-memory reader watermarks; no persisted cross-restart watermark.',timing:'Total includes MongoDB reads, signature and state checks, full posting proof creation/verification, sampled RSA challenge/proof verification, two chain observations, MinIO retrieval and authenticated decryption. Anchoring/setup are separate.',wire_bytes:'JSON component sizes and retrieved encrypted object bytes; no HTTP headers, request/challenge bytes or compression. Client is in the harness process.',stable_latency_tail_estimates:false},node:process.version,
    code_sha256:Object.fromEntries(['pilot-privsearch-stage2.js','privsearch/stage2-completeness.js','pilot-privsearch-stage1.js','privsearch/stage1-state.js','privsearch/stage1-chain-reader.js','privsearch/stage1-client.js','privsearch/audit-v2-protocol.js','privsearch/audit-v2-batch-witness.js'].map(n=>[n,S.sha(fs.readFileSync(path.join(__dirname,n)))]))};
  const save=()=>fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2));save();
  let mongo,provider;
  try {
    S.check(record.schema==='privsearch-stage1-deployment-1','Existing Stage1 owner deployment record required');
    S.check(record.contract_source_sha256===S.sha(fs.readFileSync(path.join(ROOT,'contracts','PrivSearchStateAnchor.sol'))),'Contract source differs from deployment record');
    S.check(String(pins.chainId)===c.chainId,'Deployment chain differs from configuration');
    S.check(S.canonical(pins.finality)===S.canonical(c.finality)&&pins.blockSelector===c.blockSelector,'Visibility policy differs from deployment record');
    S.check(pins.contract.toLowerCase()!==(process.env.LIFEDB_ANCHOR_CONTRACT||'').toLowerCase(),'Use the separate PrivSearch state contract');
    const {ethers}=require('ethers'),{MongoClient}=require('mongodb'),{Client}=require('minio');
    const clientRpc=new RpcTransport(c.clientRpc),ownerRpc=new RpcTransport(c.ownerRpc);provider=new ethers.JsonRpcProvider(c.ownerRpc);
    for(const rpc of [clientRpc,ownerRpc]) {
      S.check(quantity(await rpc.send('eth_chainId',[]))===BigInt(pins.chainId),'Chain mismatch');
      S.check(block(await rpc.send('eth_getBlockByNumber',['0x0',false])).hash.toLowerCase()==='0x'+pins.genesisHash,'Genesis mismatch');
    }
    const wallet=new ethers.Wallet(process.env.PURECHAIN_PRIVATE_KEY,provider);S.check(wallet.address.toLowerCase()===pins.owner.toLowerCase(),'Configured signer is not pinned owner');
    const contract=new ethers.Contract(pins.contract,ABI,wallet),runtime=await ownerRpc.send('eth_getCode',[pins.contract,'latest']);
    S.check(S.sha(Buffer.from(runtime.slice(2),'hex'))===pins.codeHash,'Owner contract code mismatch');S.check((await contract.owner()).toLowerCase()===pins.owner.toLowerCase(),'Owner contract authority mismatch');
    S.check((await contract.getState('0x'+datasetId))[0]===0n,'Stage2 namespace already used');
    mongo=new MongoClient(c.mongoUri,{serverSelectionTimeoutMS:10000});await mongo.connect();const collection=mongo.db(c.mongoDb).collection('privsearch_stage2_states'),minio=new Client(c.minio);S.check(await minio.bucketExists(c.bucket),'Existing MinIO bucket required');
    const reader=new IndependentStateReader(pins,clientRpc),decryptionKey=crypto.randomBytes(32),ownerKeys=crypto.generateKeyPairSync('ed25519'),tokens=Array.from({length:5},()=>crypto.randomBytes(32).toString('hex'));
    function queries(sequence) {
      return [
        {name:'and_2',query:[[tokens[0],tokens[1]]],expected:sequence==='1'?['fixture-b','fixture-c']:['fixture-c']},
        {name:'and_3',query:[[tokens[0],tokens[1],tokens[2]]],expected:['fixture-c']},
        {name:'or',query:[[tokens[0]],[tokens[1]]],expected:sequence==='1'?['fixture-a','fixture-b','fixture-c','fixture-d','fixture-e']:['fixture-a','fixture-b','fixture-c','fixture-d','fixture-e','fixture-f']},
        {name:'or_of_and',query:[[tokens[0],tokens[1]],[tokens[1],tokens[2]]],expected:sequence==='1'?['fixture-b','fixture-c']:['fixture-c']},
        {name:'overlapping_branches',query:[[tokens[0]],[tokens[0],tokens[1]]],expected:sequence==='1'?['fixture-a','fixture-b','fixture-c','fixture-d']:['fixture-a','fixture-c','fixture-d','fixture-f']},
        {name:'prepared_empty',query:[[tokens[3]]],expected:[]},
        {name:'disjoint_and',query:[[tokens[1],tokens[4]]],expected:[]},
        {name:'or_with_empty',query:[[tokens[1]],[tokens[3]]],expected:['fixture-b','fixture-c','fixture-e']}
      ];
    }
    async function prepare(sequence,previous) {
      const start=performance.now(),docs=['fixture-a','fixture-b','fixture-c','fixture-d','fixture-e','fixture-f'];
      const postings=new Map([[tokens[0],sequence==='1'?docs.slice(0,4):['fixture-a','fixture-c','fixture-d','fixture-f']],[tokens[1],['fixture-b','fixture-c','fixture-e']],[tokens[2],['fixture-c','fixture-d','fixture-f']],[tokens[3],[]],[tokens[4],['fixture-f']]]);
      const owner=audit.buildOwnerState(postings,{version:'stage2-'+runId+'-'+sequence,sequence:Number(sequence),keyPair:ownerKeys}),metadata={families:['token-dnf'],expansion:'none',completeness:clone(C.POLICY),payload_source:'synthetic fixture',namespace:runId};
      const descriptors=[],expected=Object.fromEntries(docs.map(id=>[id,S.canonical({fixture:true,document_id:id,revision:sequence,text:'synthetic payload'})]));let publicationMs=0;
      for(const id of docs) {
        const context={dataset_id:datasetId,document_id:id,revision:sequence,key_id:'stage2-pilot'},e=S.encryptPayload(Buffer.from(expected[id]),decryptionKey,context),key='privsearch-stage2/'+runId+'/'+S.hash('document-handle',id)+'/'+S.hash('ciphertext-envelope',e)+'.json',encoded=Buffer.from(S.canonical(e)),t=performance.now();
        await minio.putObject(c.bucket,key,encoded,encoded.length,{'content-type':'application/json'});publicationMs+=performance.now()-t;descriptors.push(S.descriptor(context,e,key));
      }
      const built=S.buildState({pins,datasetId,sequence,auditManifest:owner.envelope.manifest,ownerPublicKey:owner.publicKey,metadata,payloadDescriptors:descriptors,previousCommitment:previous}),packed={manifest:owner.serverData.manifest,lists:[...owner.serverData.lists].map(([token,e])=>[token,{docs:e.docs,primes:e.primes.map(String)}])};
      const snapshot={run_id:runId,sequence,state:built.state,envelope:owner.envelope,metadata,payloads:built.payloads,payload_proofs:built.payloadProofs,server_data:packed},t=performance.now();await collection.insertOne(snapshot);
      summary.setup.push({sequence,preparation_and_publication_ms:performance.now()-start,minio_publication_ms:publicationMs,mongodb_publication_ms:performance.now()-t,posting_references:[...postings.values()].reduce((n,ds)=>n+ds.length,0),posting_count:postings.size,payload_count:docs.length});save();
      return {...built,expected,ownerPublicKey:owner.publicKey};
    }
    async function waitVisible(candidate) {
      const start=performance.now(),events=[];let attempts=0;
      while(performance.now()-start<o.timeout) {
        attempts++;
        try {const observation=await reader.observe(candidate.state);return {wait_ms:performance.now()-start,attempts,observation,pending_observations:events};}
        catch(e) {
          // Poll only a not-yet-visible candidate. Persistent RPC availability
          // or any integrity error still stops after the reader's bounded budget.
          if(e.message!=='Response is not latest visible anchored sequence')throw e;
          events.push({attempt:attempts,rpc_calls:e.rpc_calls||0,reader_attempts:e.observation_attempts||0,retry_events:e.retry_events||[],reason:'Candidate sequence not yet visible'});
        }
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      throw new Error('Visibility timeout; no result passed the pinned visibility policy');
    }
    async function anchor(candidate) {
      const start=performance.now(),overrides={};if(process.env.PURECHAIN_GAS_PRICE)overrides.gasPrice=BigInt(process.env.PURECHAIN_GAS_PRICE);
      const tx=await contract.anchorState('0x'+datasetId,BigInt(candidate.state.sequence),'0x'+candidate.commitment,'0x'+candidate.state.previous_commitment,overrides),receipt=await tx.wait();S.check(receipt&&receipt.status===1,'Anchor transaction failed');
      const row={sequence:candidate.state.sequence,commitment:candidate.commitment,transaction_hash:tx.hash,gas_used:receipt.gasUsed.toString(),receipt_block:receipt.blockNumber,submission_to_receipt_ms:performance.now()-start,visibility_status:'pending'};summary.receipts.push(row);save();
      const visible=await waitVisible(candidate);Object.assign(row,{visibility_status:'verified',receipt_to_visible_ms:visible.wait_ms,visibility_attempts:visible.attempts,observation:visible.observation,pending_observations:visible.pending_observations});save();
    }
    async function exchange(candidate,spec,{mutateSnapshot,mutateAnswer,mutateProof,mutateCoverage,retrieveTransform,legacy=false,replay=false}={}) {
      const start=performance.now(),readStart=performance.now(),snap=await collection.findOne({run_id:runId,sequence:candidate.state.sequence});S.check(snap,'Snapshot unavailable');const dbMs=performance.now()-readStart;if(mutateSnapshot)mutateSnapshot(snap);
      const client=new (legacy?Stage1Client:C.Stage2Client)({state:snap.state,envelope:snap.envelope,ownerPublicKey:candidate.ownerPublicKey,metadata:snap.metadata,reader,decryptionKey,sampleSize:1}),server=restoreServer(snap.server_data),answer=server.createAnswer(spec.query);
      const coverageStart=performance.now(),coverage=legacy?null:C.buildCoveragePacket(snap.state,server,spec.query),coverageCreationMs=legacy?0:performance.now()-coverageStart;
      if(mutateCoverage)mutateCoverage(coverage,snap);if(mutateAnswer)mutateAnswer(answer);
      const challenge=legacy?client.createChallenge(answer,spec.query):client.createChallenge(answer,spec.query,coverage),proof=server.createProof(answer,spec.query,challenge);if(mutateProof)mutateProof(proof);
      const packets=answer.result_docs.map(id=>{const i=snap.payloads.findIndex(d=>d.context.document_id===id);S.check(i>=0,'Payload absent');return {descriptor:snap.payloads[i],proof:snap.payload_proofs[i]};});let objectBytes=0;
      const retrieve=async key=>{const bytes=await bufferStream(await minio.getObject(c.bucket,key));objectBytes+=bytes.length;return retrieveTransform?retrieveTransform(bytes,key,snap):bytes;};
      const r=await client.verify(proof,packets,retrieve);if(replay)await client.verify(proof,packets,retrieve);
      const exact=S.canonical(r.result_docs)===S.canonical(spec.expected);for(const p of r.payloads)S.check(p.plaintext.toString()===candidate.expected[p.document_id],'Plaintext reference mismatch');
      const byteCounts={answer:Buffer.byteLength(JSON.stringify(answer)),rsa_proof:Buffer.byteLength(JSON.stringify(proof)),coverage_packet:legacy?0:Buffer.byteLength(S.canonical(coverage)),payload_packets:Buffer.byteLength(JSON.stringify(packets)),encrypted_objects:objectBytes};
      return {verified:r.verified,omission_completeness:r.omission_completeness,query_result_soundness:r.query_result_soundness||false,exact_reference_match:exact,result_count:r.result_docs.length,total_verified_query_ms:performance.now()-start,mongodb_snapshot_read_ms:dbMs,coverage_proof_creation_ms:coverageCreationMs,completeness_verification_ms:r.completeness_verification_ms||0,opened_tokens:r.opened_tokens||0,opened_posting_references:r.opened_posting_references||0,serialized_response_component_bytes:byteCounts,serialized_response_component_bytes_total:Object.values(byteCounts).reduce((a,b)=>a+b,0),blockchain_verification_ms:r.blockchain_verification_ms,payload_retrieval_ms:r.payload_retrieval_ms,payload_verification_and_decryption_ms:r.payload_verification_and_decryption_ms,checked_witnesses:r.checked_witnesses,first_observation:r.first_observation,release_observation:r.release_observation,rpc_calls:r.first_observation.rpc_calls+r.release_observation.rpc_calls,chain_retry_events:[...r.first_observation.retry_events.map(e=>({phase:'before-payloads',...e})),...r.release_observation.retry_events.map(e=>({phase:'before-release',...e}))]};
    }
    async function honest(name,candidate,spec) {
      const r=await exchange(candidate,spec);S.check(r.verified&&r.omission_completeness&&r.query_result_soundness&&r.exact_reference_match,'Honest completeness/reference result failed');summary.cases.push({name,passed:true,...r});save();console.log('PASS '+name);
    }
    async function rejection(name,candidate,spec,mutation,reason) {
      let matched=false;try {await exchange(candidate,spec,mutation);}catch(e){if(!reason.test(e.message))throw new Error('Unexpected failure in '+name+': '+e.message);matched=true;}
      S.check(matched,'Attack unexpectedly accepted: '+name);summary.cases.push({name,passed:true,expected:'reject',reason_category:reason.source});save();console.log('PASS '+name);
    }
    console.log('Preparing and anchoring Stage2 synthetic version 1.');const v1=await prepare('1',S.ZERO);await anchor(v1);const q1=queries('1'),and2=q1[0],dnf=q1[3],empty=q1[5];
    for(const spec of q1)await honest('honest_v1_'+spec.name,v1,spec);
    const omit=a=>{const id=a.result_docs[0];a.result_docs=a.result_docs.filter(d=>d!==id);a.clause_docs=a.clause_docs.map(ds=>ds.filter(d=>d!==id));};
    const control=await exchange(v1,and2,{legacy:true,mutateAnswer:omit});S.check(control.verified&&!control.exact_reference_match&&!control.omission_completeness,'Legacy omission control changed');summary.cases.push({name:'legacy_omission_negative_control',passed:true,expected:'Legacy client accepts an incomplete answer; Stage2 must reject the same mutation',...control});save();console.log('CONTROL legacy client accepts omission');
    await rejection('omitted_matching_result',v1,and2,{mutateAnswer:omit},/Completeness clause result mismatch/);
    await rejection('omitted_all_results',v1,and2,{mutateAnswer:a=>{a.result_docs=[];a.clause_docs=[[]];}},/Completeness clause result mismatch/);
    await rejection('inserted_nonmatching_valid_identity',v1,and2,{mutateAnswer:a=>{a.result_docs=['fixture-a',...a.result_docs];a.clause_docs=[a.result_docs.slice()];}},/Completeness clause result mismatch/);
    await rejection('branch_omission_preserving_union',v1,dnf,{mutateAnswer:a=>{a.clause_docs[0]=['fixture-b'];}},/Completeness clause result mismatch/);
    await rejection('missing_posting_opening',v1,and2,{mutateCoverage:p=>p.openings.pop()},/Completeness missing/);
    await rejection('duplicated_posting_opening',v1,and2,{mutateCoverage:p=>p.openings[1]=clone(p.openings[0])},/Completeness duplicate/);
    await rejection('extra_posting_opening',v1,and2,{mutateCoverage:p=>p.openings.push(clone(p.openings[0]))},/Completeness missing or extra/);
    await rejection('truncated_posting_opening',v1,and2,{mutateCoverage:p=>p.openings[0].docs.pop()},/Completeness posting count mismatch/);
    await rejection('recomputed_forged_opening',v1,and2,{mutateCoverage:p=>{const o=p.openings[0];o.docs.pop();o.leaf.count=o.docs.length;o.leaf.posting_digest=C.postingDigest(o.docs);}},/Completeness coverage membership failed/);
    await rejection('changed_coverage_path',v1,and2,{mutateCoverage:p=>p.openings[0].proof.siblings[0]='f'.repeat(64)},/Completeness coverage membership failed/);
    await rejection('changed_coverage_count',v1,and2,{mutateCoverage:p=>p.openings[0].proof.count++},/Completeness coverage manifest count mismatch/);
    await rejection('missing_empty_posting_opening',v1,empty,{mutateCoverage:p=>p.openings=[]},/Completeness missing/);
    await rejection('wrong_query_coverage_packet',v1,and2,{mutateCoverage:p=>p.query_digest=audit.digest(q1[1].query)},/Completeness query binding mismatch/);
    await rejection('wrong_dataset_coverage_packet',v1,and2,{mutateCoverage:p=>p.dataset_id='f'.repeat(64)},/Completeness state binding mismatch/);
    await rejection('wrong_revision_coverage_packet',v1,and2,{mutateCoverage:p=>p.sequence='2'},/Completeness state binding mismatch/);
    await rejection('forged_RSA_witness',v1,and2,{mutateProof:p=>p.witnesses[0].witness_hex='0'.repeat(audit.WITNESS_BYTES*2)},/RSA membership/);
    await rejection('changed_coverage_root',v1,and2,{mutateSnapshot:s=>s.state.coverage_root='f'.repeat(64)},/Coverage root mismatch/);
    await rejection('changed_query_metadata',v1,and2,{mutateSnapshot:s=>s.metadata.expansion='modified'},/Query metadata mismatch/);
    await rejection('changed_object_locator',v1,and2,{mutateSnapshot:s=>{const d=s.payloads.find(x=>x.context.document_id==='fixture-b');d.object_key=s.payloads[0].object_key;}},/Manifest membership/);
    await rejection('tampered_ciphertext_envelope',v1,and2,{retrieveTransform:b=>{const e=JSON.parse(b);e.tag_hex='0'.repeat(32);return Buffer.from(JSON.stringify(e));}},/envelope digest mismatch/);
    await rejection('valid_other_object_swap',v1,and2,{retrieveTransform:async(b,key,s)=>bufferStream(await minio.getObject(c.bucket,s.payloads.find(d=>d.object_key!==key).object_key))},/envelope digest mismatch/);
    await rejection('challenge_replay',v1,and2,{replay:true},/Completeness unknown or consumed challenge/);
    await honest('honest_v1_after_attacks',v1,and2);
    console.log('Publishing Stage2 synthetic version 2 before anchoring.');const v2=await prepare('2',v1.commitment),q2=queries('2');
    await rejection('signed_but_unanchored_v2',v2,q2[0],{},/latest visible/);await honest('pending_update_preserves_anchored_v1',v1,and2);
    console.log('Anchoring version 2 during a version 1 payload exchange.');let anchored=false;
    await rejection('update_during_payload_retrieval',v1,and2,{retrieveTransform:async b=>{if(!anchored){await anchor(v2);anchored=true;}return b;}},/latest visible/);S.check(anchored,'Concurrent update control did not anchor version 2');
    for(const spec of q2)await honest('honest_v2_'+spec.name,v2,spec);
    await rejection('stale_v1_after_visible_v2',v1,and2,{},/latest visible/);await honest('honest_v2_after_stale_injection',v2,q2[0]);
    summary.snapshot_commitments=[v1.commitment,v2.commitment];summary.status='STAGE2_FULL_POSTING_COMPLETENESS_FIXTURE_PILOT_PASSED';summary.counts={cases:summary.cases.length,honest_exact_results:summary.cases.filter(c=>c.omission_completeness&&c.exact_reference_match).length,expected_rejections:summary.cases.filter(c=>c.expected==='reject').length,legacy_negative_controls:1};save();console.log(summary.status);console.log('STAGE2_REPORT_DIRECTORY: '+out);
  } catch(e) {
    summary.status='STAGE2_PILOT_STOPPED';summary.failed_reason=String(e.message).replace(/https?:\/\/\S+/g,'[endpoint]').replace(/mongodb(?:\+srv)?:\/\/\S+/g,'[endpoint]').replace(/(?:0x)?[0-9a-f]{64,}/gi,'[hex-value]');summary.rpc_failure_diagnostics={code:e.code??null,stage:e.stage||null,method:e.rpc_method||null,provider_message:e.provider_message||null,selector:e.selector||null,observation_attempts:e.observation_attempts||null,rpc_calls:e.rpc_calls||null,retry_events:e.retry_events||[]};save();console.error('STAGE2_PILOT_STOPPED: '+summary.failed_reason);console.error('PARTIAL_REPORT_DIRECTORY: '+out);process.exitCode=1;
  } finally {if(mongo)await mongo.close();if(provider)provider.destroy();}
}
if(require.main===module)main().catch(()=>{console.error('STAGE2_PILOT_FAILED: Check arguments, deployment file, installed dependencies and configuration.');process.exitCode=1;});
module.exports={options,main};
