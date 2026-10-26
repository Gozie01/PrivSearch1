'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const D=require('./privsearch/stage11-data'),I=require('./privsearch/stage5-audit-io'),Sim=require('./privsearch/stage6-simulation');
const P=require('./privsearch/stage17-real-corpus-fix1-pins.json'),OldP=require('./privsearch/stage17-approved-pins.json'),AuditP=require('./privsearch/stage6-audit-pins.json'),QueryP=require('./privsearch/stage15-approved-pins.json');
const fixed=require('./remediate-privsearch-stage17-fix1');
// Fixture hashes are scoped to this test process and restored in finally. Neither
// coordinator exposes a fixture flag or accepts a caller-provided trust pin.
async function harness(fn){
 const f=await Sim.fixture(__dirname),objects=[P,OldP,AuditP,QueryP],saved=objects.map(o=>JSON.parse(JSON.stringify(o))),original=D.prepareSource;
 try{
  for(const entry of P.frozen_files){const dst=path.join(f.projectRoot,entry.path);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(path.join(__dirname,'..',entry.path),dst);}
  for(const file of ['scripts/remediate-privsearch-stage17-fix1.js','scripts/test-privsearch-stage17-fix1.js','scripts/privsearch/stage17-real-corpus-fix1-pins.json']){const dst=path.join(f.projectRoot,file);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(path.join(__dirname,'..',file),dst);}
  const auditHash=I.hashFile(path.join(f.auditRoot,'summary.json'));
  AuditP.summary_sha256=auditHash;AuditP.catalog_sha256=Object.fromEntries(['healthcare','enron'].map(k=>[k,I.hashFile(path.join(f.auditRoot,k+'_queries.csv'))]));
  const prior=path.join(f.projectRoot,'Results/revision_v3/stage16_assurance_audit_fixture');fs.mkdirSync(prior,{recursive:true});const priorText=JSON.stringify({status:'STAGE16_AUDIT_COMPLETE_WITH_OPEN_FINDINGS',evidence_sha256:P.stage15_summary_sha256});fs.writeFileSync(path.join(prior,'summary.json'),priorText);
  for(const pins of [P,OldP]){pins.stage5_summary_sha256=auditHash;pins.approved_stage16_summaries=[I.sha(Buffer.from(priorText))];}
  const sources={};for(const kind of ['healthcare','enron']){
   sources[kind]=await original({...f,kind,simulation:false,runId:crypto.randomUUID()});
   const q=sources[kind];QueryP.queries[kind]=q.queries.filter(q=>q.query.length===1).map(x=>({name:x.name,family:x.family,result_count:q.reference[x.name].count}));
  }
  const before=new Map();const loaded=D.loadAudit(f.projectRoot,f.auditRoot);
  for(const ev of loaded.summary.datasets)for(const entry of ev.source_files){const file=D.sourcePath(loaded.descriptors.find(d=>d.kind===ev.dataset),entry,f.projectRoot);before.set(file,I.hashFile(file));}
  await fn({...f,prior,sources,before,original,run:()=>fixed.main(['--project-root',f.projectRoot,'--stage16',prior,'--audit',f.auditRoot,'--real-corpus'])});
 }finally{D.prepareSource=original;for(let i=0;i<objects.length;i++){for(const key of Object.keys(objects[i]))delete objects[i][key];Object.assign(objects[i],saved[i]);}f.cleanup();}
}
test('actual audited loaders reproduce the omitted runId failure; fixed full coordinator completes both corpora with exact payloads and empty controls',async()=>harness(async h=>{
 const old=await require('./remediate-privsearch-stage17').main(['--project-root',h.projectRoot,'--stage16',h.prior,'--audit',h.auditRoot,'--real-corpus']);
 assert.equal(old.exitCode,1);assert.match(old.summary.failure,/reading 'replace'/);assert.equal(old.summary.rows.length,33);assert.deepEqual(old.summary.pending_real_corpora,['healthcare','enron']);
 const calls=[];D.prepareSource=async args=>{assert.match(args.runId,/^[0-9a-f-]{36}$/);calls.push(args);return h.original(args);};
 const r=await h.run(),s=r.summary;assert.equal(r.exitCode,2,JSON.stringify(s));assert.equal(s.status,'STAGE17_REMEDIATION_VALIDATED_WITH_OPEN_RESEARCH_REQUIREMENTS');assert.equal(s.remediation_fix,'17.0.1');assert.equal(s.frozen_prior_files_checked,167);
 assert.equal(calls.length,2);assert(calls.every(c=>c.runId===s.run_id&&!c.simulation));assert.deepEqual(s.pending_real_corpora,[]);assert.equal(s.source_final_checks.length,2);assert(s.source_final_checks.every(c=>c.source_unchanged&&c.source_writes===0));assert(s.corpus_execution.every(c=>c.status==='VERIFIED_SOURCE_UNCHANGED'));
 const real=s.rows.filter(r=>r.phase==='real_corpus_offline_conformance');assert(real.length>10);assert(real.every(r=>r.verified&&r.exact_original_payload_set));
 for(const kind of ['healthcare','enron'])for(const profile of ['privsearch-merkle-v2','keyed-product-v1']){const empty=real.find(r=>r.case_id==='real-'+kind&&r.profile===profile&&r.job_id.endsWith('/G_prepared_empty'));assert(empty);assert.equal(empty.result_count,0);assert.equal(empty.payload_items,0);}
 for(const [file,hash] of h.before)assert.equal(I.hashFile(file),hash);assert.equal(s.roles.length,6);assert(s.roles.every(r=>r.server_stopped&&r.single_profile&&r.public_only));assert.equal(s.accounting.planned,s.accounting.completed);assert.equal(s.accounting.failed_honest+s.accounting.not_started+s.accounting.unfinished,0);assert.equal(s.accounting.expected_rejections,16);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(r.out,'summary.json'))),s);assert.deepEqual(fs.readFileSync(path.join(r.out,'completed_jobs.jsonl'),'utf8').trim().split('\n').map(JSON.parse),s.rows);assert.equal(s.live_rpc_calls+s.external_service_connections+s.transactions,0);assert(!s.formal_composed_privacy_proven&&!s.published_baseline_comparison_qualified&&!s.all_findings_closed);
}));
test('a later corpus source change retains first-corpus verified exchanges, all denominators and stopped children',async()=>harness(async h=>{
 D.prepareSource=async args=>{if(args.kind==='enron')fs.appendFileSync(path.join(h.projectRoot,'NweDB/enron_processed/enron_emails_part_001.jsonl'),'\n');return h.original(args);};
 const r=await h.run(),s=r.summary;assert.equal(r.exitCode,1);assert.match(s.failure,/SOURCE_CHANGED_SINCE_AUDIT/);assert.deepEqual(s.pending_real_corpora,['enron']);assert.equal(s.source_final_checks.length,1);assert.equal(s.corpus_execution[0].status,'VERIFIED_SOURCE_UNCHANGED');assert.equal(s.corpus_execution[1].status,'STOPPED');assert(s.rows.filter(r=>r.phase==='real_corpus_offline_conformance').every(r=>r.verified&&r.case_id==='real-healthcare'));assert(s.rows.length>33);assert.equal(s.roles.length,4);assert(s.roles.every(r=>r.server_stopped));assert.equal(s.accounting.completed,s.accounting.planned);assert.equal(s.accounting.failed_honest+s.accounting.unfinished+s.accounting.not_started,0);assert.equal(s.findings.find(f=>f.id==='F16-11').status,'REAL_CORPUS_OFFLINE_CONFORMANCE_PENDING');
}));
test('missing or changed pinned query evidence stops before any real-profile setup instead of silently reducing the schedule',async()=>harness(async h=>{
 QueryP.queries.healthcare[0].result_count++;
 const r=await h.run(),s=r.summary;assert.equal(r.exitCode,1);assert.match(s.failure,/PINNED_REAL_QUERY_MISSING_OR_CHANGED/);assert.equal(s.roles.length,2);assert.equal(s.rows.length,33);assert.deepEqual(s.pending_real_corpora,['healthcare','enron']);assert.equal(s.corpus_execution[0].status,'STOPPED');assert.equal(s.corpus_execution[1].status,'NOT_STARTED');assert.equal(s.source_final_checks.length,0);
}));
test('source mutation during profile execution blocks the final source check despite successful payload exchanges',async()=>harness(async h=>{
 const study=require('./privsearch/stage17-study'),original=study.runCase;
 study.runCase=async(...args)=>{const result=await original(...args);if(args[0].case_id==='real-healthcare'&&args[0].profile==='keyed-product-v1')fs.appendFileSync(path.join(h.projectRoot,'NweDB/healthcare_revision_v2/combined/healthcare_privsearch_corpus.jsonl'),'\n');return result;};
 try{const r=await h.run(),s=r.summary;assert.equal(r.exitCode,1);assert.match(s.failure,/SOURCE_CHANGED_SINCE_AUDIT/);assert.equal(s.source_final_checks.length,0);assert.deepEqual(s.pending_real_corpora,['healthcare','enron']);assert.equal(s.corpus_execution[0].status,'STOPPED');assert.equal(s.corpus_execution[1].status,'NOT_STARTED');assert(s.rows.filter(r=>r.phase==='real_corpus_offline_conformance').every(r=>r.verified));assert.equal(s.roles.length,4);assert(s.roles.every(r=>r.server_stopped));}finally{study.runCase=original;}
}));
