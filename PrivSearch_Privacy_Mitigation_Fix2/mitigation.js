'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),E=require('./experiment'),C=require('./capsule');
const check=C.check,MODES=['baseline','private_replica'];
function plan(datasets=['healthcare','enron'],repetitions=3){return E.plan(datasets,repetitions).flatMap(j=>MODES.map(mode=>({...j,mode,job_id:mode+'/'+j.job_id,cell_id:mode+'/'+j.cell_id})));}
function aggregate(rows,jobs){return MODES.flatMap(mode=>E.aggregate(rows.filter(r=>r.mode===mode),jobs.filter(j=>j.mode===mode)).map(a=>({...a,mode,group:mode+'/'+a.group})));}
function percentile(values,q){if(!values.length)return null;return values.slice().sort((a,b)=>a-b)[Math.max(0,Math.ceil(q*values.length)-1)];}
function summaryTimes(values){return {trial_ms:values.slice(),attempts:values.length,total_ms:values.reduce((a,b)=>a+b,0),median_ms:percentile(values,.5),empirical_p95_ms:values.length>=20?percentile(values,.95):null};}
async function probe(P,S,client,server,objects,w,documents){
  const start=performance.now(),request=client.createRequest([[w]]),response=server.search(request);let handles=null,reads=0,objectBytes=0,locatorBytes=0;const located=[];
  const result=await client.verifyResponse(response,{preparePayloads:h=>{check(handles===null,'REPLICA_DUPLICATE_PREPARATION');handles=h.slice();},locate:h=>{located.push(h);const packet=server.locate(h);locatorBytes+=Buffer.byteLength(JSON.stringify(packet));return packet;},retrieve:k=>{reads++;const b=objects.get(k);check(Buffer.isBuffer(b),'REPLICA_MISSING_OBJECT');objectBytes+=b.length;return b;}});
  const expected=documents.filter(d=>d.keywords.includes(w)).map(d=>d.id).sort(),actual=result.payloads.map(d=>d.document_id).sort(),originals=new Map(documents.map(d=>[d.id,S.sha(d.body)]));
  check(JSON.stringify(expected)===JSON.stringify(actual)&&result.payloads.every(d=>S.sha(d.plaintext)===originals.get(d.document_id)),'REPLICA_PRIVATE_REFERENCE_MISMATCH');
  check(result.verified&&result.omission_completeness&&result.query_result_soundness&&handles?.length===expected.length&&reads===expected.length&&JSON.stringify(located)===JSON.stringify(handles),'REPLICA_NOT_VERIFIED');
  return {label:request.coverage_labels[0],handles:located,duration_ms:performance.now()-start,logical_response_bytes:Buffer.byteLength(JSON.stringify(response))+objectBytes+locatorBytes,results:expected.length};
}
function makeClient(P,keys,prepared){return new P.Stage3Client({keys,state:prepared.snapshot.state,envelope:prepared.snapshot.envelope,ownerPublicKey:prepared.ownerPublicKey,metadata:prepared.snapshot.metadata,reader:{async observe(){return {verified:true,blockchain_verification_ms:0,offline_privacy_model_only:true};}}});}
async function observe(P,S,documents,allWords,realWords,pins,datasetId,log=()=>{},{actorRoot,hooks={}}={}){
  check(actorRoot&&fs.statSync(actorRoot).isDirectory(),'REPLICA_PRIVATE_DIRECTORY');
  const keys=P.generateKeys(),owner=new P.Stage3Owner({keys,pins,datasetId}),start=performance.now(),prepared=owner.prepare(documents,allWords,{version:'privacy-mitigation-'+crypto.randomUUID()}),setupMs=performance.now()-start;
  const index=prepared.snapshot.envelope.manifest.entries.map(e=>({label:e.token,count:e.count})),snapshotHash=S.sha(Buffer.from(JSON.stringify(prepared.snapshot))),truth=new Map(),observations=[],order=E.shuffled(realWords),baselineTrials=[];
  const server=new P.Stage3Server(prepared.snapshot),client=makeClient(P,keys,prepared);
  for(const w of order){const p=await probe(P,S,client,server,prepared.objects,w,documents);check(!truth.has(p.label),'REPLICA_LABEL_COLLISION');truth.set(p.label,w);observations.push({label:p.label,handles:p.handles});baselineTrials.push({duration_ms:p.duration_ms,logical_response_bytes:p.logical_response_bytes});log('Verified baseline probe '+observations.length+'/'+realWords.length+'.');}
  const sealedFile=path.join(actorRoot,crypto.randomUUID()+'.capsule'),receivedFile=path.join(actorRoot,crypto.randomUUID()+'.download');let store,restored,sealed;
  try{
    const sealStart=performance.now();sealed=await C.seal(sealedFile,prepared);const sealMs=performance.now()-sealStart;
    // The original payload map is released before the second full copy is received.
    prepared.objects.clear();
    store=await C.startStore(sealedFile,actorRoot);const bootStart=performance.now();const transfer=await C.download(store.port,receivedFile,sealed.pin);
    if(hooks.afterDownload)await hooks.afterDownload({receivedFile,sealed});
    restored=await C.restore(receivedFile,sealed.key,sealed.pin);
    check(S.sha(Buffer.from(JSON.stringify(restored.snapshot)))===snapshotHash&&S.commitment(restored.snapshot.state)===sealed.pin.commitment,'REPLICA_SNAPSHOT_PIN');
    check(restored.objects.size===sealed.objectCount,'REPLICA_OBJECT_INVENTORY');
    const bootstrapMs=performance.now()-bootStart,before=await store.stats();
    check(before.pid===store.pid&&before.requests===1&&before.completed_downloads===1&&before.body_bytes===sealed.pin.bytes&&!before.rejected_requests&&!before.keys_received&&!before.application_imported&&!before.records_received,'REPLICA_BOOTSTRAP_TRACE');
    check(!before.environment_names.some(n=>/KEY|TOKEN|SECRET|MONGO|MINIO|RPC|PASS|NODE_OPTIONS|DOTENV/i.test(n)),'REPLICA_STORAGE_ENVIRONMENT');
    const localStart=performance.now(),localServer=new P.Stage3Server(restored.snapshot),localClient=makeClient(P,keys,{snapshot:restored.snapshot,ownerPublicKey:prepared.ownerPublicKey}),localInitMs=performance.now()-localStart,replicaTrials=[];
    for(const w of order){const p=await probe(P,S,localClient,localServer,restored.objects,w,documents);const expected=observations.find(o=>truth.get(o.label)===w);check(p.label===expected.label&&JSON.stringify(p.handles)===JSON.stringify(expected.handles),'REPLICA_PAIRED_QUERY_MISMATCH');replicaTrials.push({duration_ms:p.duration_ms,logical_response_bytes:p.logical_response_bytes});log('Verified private-replica probe '+replicaTrials.length+'/'+realWords.length+'.');}
    if(hooks.afterQueries)await hooks.afterQueries({store});
    const after=await store.stats();check(JSON.stringify(after)===JSON.stringify(before),'REPLICA_QUERY_DEPENDENT_REMOTE_ACTIVITY');
    const slotByLabel=new Map(observations.map(o=>[o.label,crypto.randomBytes(32).toString('hex')])),slotTruth=new Map(observations.map(o=>[slotByLabel.get(o.label),truth.get(o.label)]));
    const baselineTotal=baselineTrials.reduce((n,t)=>n+t.logical_response_bytes,0);
    return {index,observations,truth,slotByLabel,slotTruth,replicaPublic:{document_count:documents.length,capsule_bytes:sealed.pin.bytes,bootstrap_requests:1,query_phase_requests:0,opaque_capsule_sha256:sealed.pin.sha256},metadata:{documents:documents.length,real_prepared_tokens:realWords.length,total_prepared_tokens:allWords.length,posting_references:documents.reduce((n,d)=>n+d.keywords.length,0),verified_local_probes:observations.length,replica_verified_local_probes:replicaTrials.length,zero_result_probes:observations.filter(o=>!o.handles.length).length,cryptographic_setup_ms:setupMs,public_snapshot_sha256:snapshotHash,state_commitment:prepared.commitment,anchored:false,chain_observations_simulated:true,keys_persisted:false,source_records_exported:false},cost:{schema:'private-replica-cost-1',cryptographic_setup_ms:setupMs,outer_sealing_ms:sealMs,cold_download_and_authentication_ms:bootstrapMs,local_server_client_construction_ms:localInitMs,cold_ready_ms:bootstrapMs+localInitMs,ciphertext_snapshot_bytes:sealed.snapshotBytes,inner_encrypted_object_bytes:sealed.objectBytes,replica_plaintext_container_bytes:sealed.plaintextBytes,outer_encrypted_replica_bytes:sealed.pin.bytes,peak_temporary_encrypted_file_bytes:sealed.pin.bytes*2,object_count:sealed.objectCount,download_requests:after.requests,completed_downloads:after.completed_downloads,actual_http_body_bytes:after.body_bytes,actual_http_body_sha256:transfer.sha256,owner_pinned_capsule_sha256:sealed.pin.sha256,query_phase_remote_requests:after.requests-before.requests,query_phase_remote_body_bytes:after.body_bytes-before.body_bytes,baseline_remote_transport_measured:false,baseline_logical_response_and_object_bytes_for_all_probes:baselineTotal,bootstrap_bytes_over_baseline_logical_total:baselineTotal?sealed.pin.bytes/baselineTotal:null,baseline_local_computation:summaryTimes(baselineTrials.map(t=>t.duration_ms)),replica_cached_local_computation:summaryTimes(replicaTrials.map(t=>t.duration_ms)),trial_boundary:'Actual frozen local search+verification, including local encrypted-object reads. Baseline is in-process; only replica bootstrap uses real loopback HTTP. No deployed latency or RSS measurement.',storage_audit:{pid:after.pid,keys_received:after.keys_received,application_imported:after.application_imported,records_received:after.records_received,sensitive_environment_names:[]},query_timing_observed_by_storage:false,query_order_and_timing_attack_excluded:true}};
  }finally{
    if(store)await store.close();if(restored)restored.objects.clear();if(prepared.objects)prepared.objects.clear();if(sealed)sealed.key.fill(0);
    // Clearing a Buffer is hygiene, not a general memory-erasure guarantee.
    for(const f of [sealedFile,receivedFile])fs.rmSync(f,{force:true,maxRetries:3});
  }
}
function packet(base,view){return {schema:'privsearch-query-blind-replica-view-1',target:view.replicaPublic,observations:base.observations.map(o=>({label:view.slotByLabel.get(o.label)})),reference:base.reference,known_queries:base.known_queries.map(o=>({label:view.slotByLabel.get(o.label),word:o.word})),methods:base.methods};}
module.exports={plan,aggregate,observe,packet,MODES,probe,makeClient,summaryTimes};
