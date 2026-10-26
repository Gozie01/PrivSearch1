'use strict';
let shuttingDown=false;process.on('disconnect',()=>{if(!shuttingDown)process.exit(1);});
const fs=require('node:fs'),path=require('node:path'),S=require('./stage1-state'),D=require('./stage6-data-fix2'),B=require('./stage3-encrypted-search'),C=require('./stage7-comparison'),{serve}=require('./stage4-ipc'),{audit}=require('./stage4-role');
const phase=text=>process.send({event:'phase',text});
serve({
 async boot(){return audit('offline-comparison-worker',['private-source-reader','ephemeral-keys','in-process-baseline-and-optimized-cores']);},
 async compare(c){
  S.exact(c,['source','kind','runId','baselinePlan','repetitions']);S.check([1,3].includes(c.repetitions),'Stage7 repetitions invalid');
  const source=await D.prepareSource({...c.source,kind:c.kind,runId:c.runId,log:phase});
  if(!c.source.simulation)for(const k of ['projected_documents','projected_keyword_assignments','projected_payload_bytes'])S.check(source.publicPlan[k]===c.baselinePlan[k],'Stage7 source projection differs from approved calibration');
  const queries=C.selectQueries(source.queries,source.publicPlan),plan={...source.publicPlan};delete plan.catalog;
  process.send({event:'plan',plan,selection:queries.map(q=>{const {query,...publicSpec}=q;return publicSpec;})});
  phase('Preparing one common original-core encrypted snapshot for both variants.');
  const keys=B.generateKeys(),pins={chainId:'31337',genesisHash:'a'.repeat(64),contract:'0x'+'b'.repeat(40),owner:'0x'+'c'.repeat(40),codeHash:S.sha(Buffer.from('6000','hex')),finality:{kind:'confirmations',depth:1},blockSelector:'eip1898'},start=performance.now(),candidate=new B.Stage3Owner({keys,pins,datasetId:S.hash('stage7-offline-dataset',[c.runId,c.kind])}).prepare(source.documents,source.words,{sequence:'1',version:'stage7-offline-'+c.runId}),preparation=performance.now()-start;
  process.send({event:'common_snapshot',commitment:candidate.commitment,preparation_ms:preparation,serialized_snapshot_bytes:Buffer.byteLength(JSON.stringify(candidate.snapshot))});
  const micro=C.microbench(32);process.send({event:'microbench',micro});let pairIndex=0;
  for(const q of queries)for(let trial=1;trial<=c.repetitions;trial++){
   const pair_id=c.kind+'/'+q.name+'/'+trial,order=pairIndex++%2?['optimized','baseline']:['baseline','optimized'];
   phase('Comparing '+q.name+', pair '+trial+'/'+c.repetitions+' ('+order.join(' then ')+').');
   const pair=await C.runPair(candidate,keys,q,source.reference[q.name],order,(variant,metrics)=>process.send({event:'result',row:{dataset:c.kind,name:q.name,family:q.family,origin:q.origin,trial,pair_id,variant,order,...metrics,pair_equivalence:'pending'}}));
   process.send({event:'pair',pair:{dataset:c.kind,name:q.name,trial,pair_id,order,...pair}});
  }
  return {role:audit('offline-comparison-worker',['private-source-reader','ephemeral-keys','in-process-baseline-and-optimized-cores']),query_conditions:queries.length,repetitions:c.repetitions};
 },
 async shutdown(){shuttingDown=true;setImmediate(()=>process.exit(0));return {closed:true};}
});
