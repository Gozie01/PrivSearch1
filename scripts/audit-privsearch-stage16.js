'use strict';
// Offline only. Does not import service configuration, storage adapters or an RPC transport.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),A=require('./privsearch/stage16-audit');
const PINS=require('./privsearch/stage16-approved-pins.json'),REVIEW=require('./privsearch/stage16-review.json');
function args(argv){const o={root:path.resolve(__dirname,'..')};for(let i=0;i<argv.length;i++){A.check(['--project-root','--stage15','--output'].includes(argv[i])&&i+1<argv.length,'CLI_ARGUMENT');const flag=argv[i++],value=argv[i];o[{'--project-root':'root','--stage15':'stage15','--output':'output'}[flag]]=path.resolve(value);}return o;}
function findEvidence(root){const parent=path.join(root,'Results','revision_v3');A.check(fs.existsSync(parent),'STAGE15_REPORT_NOT_FOUND');const dirs=fs.readdirSync(parent,{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name.startsWith('stage15_implementation_study_fix1_')).sort((a,b)=>a.name.localeCompare(b.name));for(const d of dirs){const f=path.join(parent,d.name,'summary.json');if(fs.existsSync(f)&&A.sha(A.readBounded(f))===PINS.stage15_summary_sha256)return path.dirname(f);}throw new Error('STAGE16_APPROVED_STAGE15_REPORT_NOT_FOUND');}
function write(file,v){fs.writeFileSync(file,typeof v==='string'?v:JSON.stringify(v,null,2)+'\n',{flag:'wx'});}
async function main(argv=process.argv.slice(2)){
 const o=args(argv),root=fs.realpathSync(o.root),out=o.output||path.join(root,'Results','revision_v3','stage16_assurance_audit_'+new Date().toISOString().replace(/[:.]/g,'-')+'_'+crypto.randomBytes(4).toString('hex'));
 // A caller-provided output may not shadow source/input evidence. Every output directory must be new.
 const relative=path.relative(path.join(root,'Results','revision_v3'),out);A.check(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'OUTPUT_MUST_BE_NEW_RESULT_DIRECTORY');
 A.check(!fs.existsSync(out),'EXISTING_OUTPUT');fs.mkdirSync(out,{recursive:true});
 const summary={schema:'privsearch-stage16-assurance-audit-1',status:'STAGE16_AUDIT_STOPPED',generated_at:new Date().toISOString(),offline:true,service_connections:0,transactions:0,corpus_scans:0,new_benchmark_trials:0,formal_composed_privacy_proven:false,published_baseline_comparison_qualified:false,all_assurance_gaps_closed:false,frozen_files_checked:0};let exitCode=1;
 try{
  const frozen=A.verifySources(root,PINS.frozen_files);summary.frozen_files_checked=frozen.length;
  const evidenceDir=o.stage15||findEvidence(root),evidenceFile=path.join(evidenceDir,'summary.json');A.check(path.relative(out,evidenceFile).startsWith('..'),'OUTPUT_OVERLAPS_EVIDENCE');
  const evidence=A.approvedSummary(evidenceFile,PINS.stage15_summary_sha256);summary.evidence_sha256=PINS.stage15_summary_sha256;
  for(const [file,hash] of Object.entries(evidence.code_sha256)){const pinned=frozen.find(e=>e.path==='scripts/'+file);A.check(pinned&&pinned.sha256===hash,'STAGE15_RUNTIME_HASH_BINDING');}
  summary.evidence=A.validateEvidence(evidence);A.check(evidence.prior_evidence.stage14_summary_sha256===PINS.stage14_summary_sha256,'PRIOR_BOUNDARY_PIN');
  for(const f of REVIEW.findings)for(const ref of f.source_refs){const text=A.readBounded(A.sourceFile(root,ref.path)).toString('utf8');A.check(text.includes(ref.symbol),'SOURCE_REVIEW_REFERENCE: '+f.id);}
  console.log('STAGE16_EVIDENCE_RECONCILED: 1288 jobs, 1200 measured successes, 56 expected rejections; earlier failures retained.');
  summary.probes=await require('./privsearch/stage16-probes').probes();
  A.verifySources(root,PINS.frozen_files);A.check(A.sha(A.readBounded(evidenceFile))===PINS.stage15_summary_sha256,'EVIDENCE_CHANGED_DURING_AUDIT');
  summary.findings=REVIEW.findings;summary.open_findings=REVIEW.findings.filter(f=>f.disposition.startsWith('OPEN_')).map(f=>f.id);
  summary.stage12_qualification_evidence_sha256=PINS.stage12_summary_sha256;summary.stage12_evidence_scope='Previously reviewed pinned qualification result; not rerun by Stage16.';
  summary.status='STAGE16_AUDIT_COMPLETE_WITH_OPEN_FINDINGS';summary.exit_code_meaning='2: audit completed; formal privacy, baseline qualification and stated assurance gaps remain open.';
  write(path.join(out,'frozen_source_hashes.json'),frozen);write(path.join(out,'claims_and_findings.json'),REVIEW);write(path.join(out,'evidence_reconciliation.json'),summary.evidence);write(path.join(out,'synthetic_characterizations.json'),summary.probes);write(path.join(out,'assurance_review.md'),A.markdown(summary,REVIEW));exitCode=2;
 }catch(e){summary.failure=String(e.code||e.message||'Unknown audit error').slice(0,1000);console.error('STAGE16_AUDIT_STOPPED: '+summary.failure);}
 write(path.join(out,'summary.json'),summary);console.log(summary.status);console.log('STAGE16_REPORT_DIRECTORY: '+out);if(require.main===module)process.exitCode=exitCode;return {out,summary,exitCode};
}
if(require.main===module)main().catch(e=>{console.error(String(e.message).slice(0,1000));process.exitCode=1;});
module.exports={main,args,findEvidence};
