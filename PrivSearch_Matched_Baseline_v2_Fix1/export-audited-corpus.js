'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const D=require('./application/scripts/privsearch/stage11-data');
const pins=require('./application/scripts/privsearch/stage6-audit-pins.json');
function selectWorkload(source){return source.queries.filter(q=>q.query.length===1&&q.query[0].length>=2&&((q.origin.startsWith('audited-workload')&&source.reference[q.name].count>0)||q.name==='G_disjoint_and'));}
async function main(){
 const args=process.argv.slice(2),o={};for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||!args[i+1])throw Error('Arguments require flag/value pairs');o[args[i].slice(2)]=args[i+1];}
 const project=path.resolve(o.project),out=path.resolve(o.output);fs.mkdirSync(out,{recursive:true});
 let audit=o.audit?path.resolve(o.audit):undefined;
 if(!audit){
  const root=path.join(project,'Results','revision_v3');const candidates=[];
  function walk(dir,depth=0){if(depth>4||!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p,depth+1);else if(e.name==='summary.json')candidates.push(p);}}
  walk(root);
  for(const f of candidates){if(crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')===pins.summary_sha256){audit=path.dirname(f);break;}}
 }
 if(!audit){fs.writeFileSync(path.join(out,'export-status.json'),JSON.stringify({status:'AUDITED_CORPUS_BLOCKED',reason:'Pinned passed Stage5 audit not found under Results/revision_v3; pass -AuditRoot.',fixture_fallback:false},null,2));return;}
 const metadata=[];
 for(const kind of ['healthcare','enron']){
  console.log('BASELINE_SOURCE: '+kind+' full corpus scan; no posting truncation.');
  const source=await D.prepareSource({projectRoot:project,auditRoot:audit,kind,runId:crypto.randomUUID(),simulation:false,
    log:console.log});
  const selected=selectWorkload(source);
  const positive=selected.filter(q=>source.reference[q.name].count>0),empty=selected.filter(q=>source.reference[q.name].count===0);
  const m={...source.publicPlan,selected_experiment_queries:selected.map(q=>({name:q.name,terms:q.query[0].length,reference_count:source.reference[q.name].count})),source_writes:0,
    scope:'Immutable audited complete-posting projection for matched static implementation study; selected vocabulary, not a full-vocabulary benchmark.'};
  if(!positive.length||!empty.length){metadata.push({...m,status:'REQUIRED_POSITIVE_AND_EMPTY_COVERAGE_MISSING',positive:positive.length,empty:empty.length});continue;}
  const data={documents:source.documents.map(d=>({id:d.id,keywords:d.keywords,body:d.body.toString('base64'),body_encoding:'base64'})),
    words:source.words,queries:selected.map(q=>q.query[0]),metadata:{...m,required_positive_and_empty_coverage:true}};
  fs.writeFileSync(path.join(out,kind+'-private-input.json'),JSON.stringify(data));metadata.push({...m,status:'EXPORTED'});
 }
 fs.writeFileSync(path.join(out,'export-status.json'),JSON.stringify({status:'AUDITED_EXPORT_COMPLETE',datasets:metadata},null,2));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main,selectWorkload};
