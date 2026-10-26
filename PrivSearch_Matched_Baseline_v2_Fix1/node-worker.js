'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),{performance}=require('node:perf_hooks');
const S=require('./application/scripts/privsearch/stage1-state'),E=require('./application/scripts/privsearch/stage13-hardened-basic'),X=require('./application/scripts/privsearch/stage17-isolated-boundary'),Study=require('./application/scripts/privsearch/stage17-study'),Common=require('./common-payload');
let progress,outputPath;const save=()=>{if(progress&&outputPath){fs.writeFileSync(outputPath+'.tmp',JSON.stringify(progress,null,2));fs.renameSync(outputPath+'.tmp',outputPath);}};
async function main(){
 const [inputFile,planFile,profile,output]=process.argv.slice(2),inputBytes=fs.readFileSync(inputFile),data=JSON.parse(inputBytes),plan=JSON.parse(fs.readFileSync(planFile));
 S.check(S.sha(inputBytes)===plan.input_sha256,'input file changed');
 const docs=data.documents.map(d=>({id:d.id,keywords:d.keywords,body:Buffer.from(d.body,'base64')})),records=new Map(docs.map(d=>[d.id,d]));
 let t=performance.now();const payload=Common.build(docs),sharedSetup=performance.now()-t;S.check(payload.root===plan.payload_root,'shared payload root mismatch');
 t=performance.now();let prepared,server,client;
 if(profile==='privsearch-merkle-v2'){
  prepared=X.prepare(docs,data.words,{profile,pins:Study.PINS,datasetId:plan.dataset_id});server=X.server(prepared.publicSnapshot);
  const expected=S.commitment(prepared.state),reader={async observe(state){S.check(S.commitment(state)===expected,'offline state pin changed');return {offline_trusted_pin:true,commitment:expected};}};
  client=X.client(prepared.provision,reader);
 }else if(profile==='seacq-basic-derived'){
  prepared=E.prepare(docs,data.words,{datasetId:plan.dataset_id});server=new E.Server(prepared.serverData);client=new E.Client(prepared.clientProvision,prepared.authorityPins);
 }else throw Error('unknown profile');
 const setupMs=performance.now()-t,rows=[];outputPath=output;progress={status:'RUNNING',profile,input_sha256:plan.input_sha256,payload_root:payload.root,dataset_id:plan.dataset_id,setup_ms:setupMs,shared_payload_setup_ms:sharedSetup,measurements:rows,started_jobs:[],language:process.version,offline:true};save();
 for(const job of plan.jobs){
  const q=data.queries[job.query_index];let sent=0,received=0;
  progress.started_jobs.push(job.job_id);save();
  const wire=(x,request=false)=>{const encoded=JSON.stringify(x);if(request)sent+=Buffer.byteLength(encoded);else received+=Buffer.byteLength(encoded);return JSON.parse(encoded);};
  const start=performance.now();t=performance.now();const request=wire(client.createRequest(profile==='privsearch-merkle-v2'?[q]:q),true),tokenMs=performance.now()-t;
  t=performance.now();const nativeReply=server.search(request),serverMs=performance.now()-t;
  const reply=wire(nativeReply);t=performance.now();let ids,nativeBodies;
  if(profile==='privsearch-merkle-v2'){
    const result=await client.verifyResponse(reply,{locate:h=>wire(server.locate(h)),retrieve:key=>{const packet=wire({body:prepared.objects.get(key).toString('base64')});return Buffer.from(packet.body,'base64');}});
    S.check(result.verified,'native verify failed');ids=result.payloads.map(p=>p.document_id);nativeBodies=new Map(result.payloads.map(p=>[p.document_id,p.plaintext]));
  }else ids=client.verify(reply).matched_identifiers;
  const nativeVerifyMs=performance.now()-t;t=performance.now();const returned=[];
  for(const id of ids){const original=payload.packets.get(id),packet=nativeBodies?wire({leaf:original.leaf,proof:original.proof}):wire(original);if(nativeBodies)packet.body=nativeBodies.get(id).toString('base64');const body=Common.verify(packet,id,payload.root,docs.length);returned.push({id,sha256:S.sha(body)});}
  const payloadMs=performance.now()-t,totalMs=performance.now()-start;
  returned.sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)));
  S.check(S.sha(Buffer.from(S.canonical(returned)))===plan.queries[job.query_index].oracle_digest&&returned.length===plan.queries[job.query_index].result_count,'exact result/body oracle mismatch');
  S.check(new Set(ids).size===ids.length&&ids.every(id=>records.has(id)),'duplicate or unknown identifier');
  rows.push({...job,profile,accepted:true,result_count:returned.length,oracle_digest:plan.queries[job.query_index].oracle_digest,total_ms:totalMs,token_ms:tokenMs,server_ms:serverMs,native_verification_ms:nativeVerifyMs,shared_payload_ms:payloadMs,request_bytes:sent,response_bytes:received});
  save();
 }
 progress.status='COMPLETE';save();
 console.log('PROFILE_COMPLETE: '+profile+' '+rows.length);
}
main().catch(e=>{if(progress){progress.status='STOPPED';progress.failure=e.message;save();}console.error('PROFILE_STOPPED: '+e.message);process.exitCode=1;});
