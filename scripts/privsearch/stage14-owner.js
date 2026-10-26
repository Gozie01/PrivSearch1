'use strict';
const {serve}=require('./stage4-ipc'),{audit}=require('./stage4-role'),{Storage,ownerChain}=require('./stage6-services-fix1'),{reader}=require('./stage10-chain-reader-fix1'),{waitVisible}=require('./stage9-visibility'),D=require('./stage11-data'),X=require('./stage14-boundary'),S=require('./stage1-state');
let config,chain,candidate,storage,stopping=false;const phase=text=>process.send({event:'phase',text});process.on('disconnect',()=>{if(!stopping)process.exit(1);});
serve({async boot(c){config=c;return audit('owner',['private-corpus-read','both-owner-setups','storage-publication','one-common-state-anchor']);},async prepare(){
 const source=await D.prepareSource({...config.source,runId:config.runId,log:phase}),queries=X.selectQueries(source),references=Object.fromEntries(queries.map(q=>[q.name,source.reference[q.name]]));
 process.send({event:'source_plan',plan:source.publicPlan});phase('Preparing both full selected-vocabulary search structures and one common payload collection.');
 const prepared=X.prepare(source.documents,source.words,{pins:config.pins,datasetId:config.datasetId,version:'stage14-'+config.runId,onProgress:phase});candidate=prepared.candidate;
 // No service connection until source verification and both cryptographic setups finish.
 phase('Publishing identical payload objects and the composite public snapshot.');storage=new Storage(config,p=>process.send({event:'publication',progress:p}));await storage.open();
 for(const [key,bytes] of prepared.objects)await storage.putObject(key,bytes);
 const publication=await storage.putSnapshot('1',prepared.publicSnapshot);await storage.close();storage=undefined;
 const {catalog,...plan}=source.publicPlan;return {provisions:prepared.provisions,queries,references,plan,public:prepared.public,publication};
 },async anchor(){S.check(candidate,'Stage14 prepared state missing');chain=await ownerChain(config);process.send({event:'anchor_started'});const receipt=await chain.anchor(candidate);process.send({event:'receipt',receipt:{...receipt,commitment:candidate.commitment,sequence:'1'}});const visibility=await waitVisible(()=>reader(config).observe(candidate.snapshot.state));return {...receipt,commitment:candidate.commitment,sequence:'1',visibility};},
 async check_source(){const a=D.loadAudit(config.source.projectRoot,config.source.auditRoot,config.source.overrides,config.source.simulation);D.pinInputs(a.descriptors.find(d=>d.kind===config.source.kind),a.summary.datasets.find(d=>d.dataset===config.source.kind),config.source.projectRoot);return {source_files_match_passed_audit:true,source_files_written:0};},
 async shutdown(){stopping=true;if(storage)await storage.close();if(chain)await chain.close();candidate=undefined;config=undefined;setImmediate(()=>process.exit(0));return {closed:true};}});
