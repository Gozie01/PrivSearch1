'use strict';
const {serve}=require('./stage4-ipc'),{audit}=require('./stage4-role'),{Storage,reader,ownerChain}=require('./stage4-services'),S=require('./stage1-state'),E=require('./stage3-encrypted-search'),F=require('./stage4-fixture');
let config,storage,chain,owner,keys,observer;const candidates=new Map();
serve({
  async boot(c){S.check(!config,'Stage4 owner already booted');config=c;storage=new Storage(c);await storage.open();chain=await ownerChain(c);observer=reader(c);keys=E.generateKeys();owner=new E.Stage3Owner({keys,pins:c.pins,datasetId:c.datasetId});return audit('owner',['signer','storage-read-write','search-keys','payload-key','private-fixture']);},
  async prepare({sequence}) {
    S.check(['1','2'].includes(sequence)&&!candidates.has(sequence),'Stage4 owner sequence invalid');const previous=sequence==='1'?S.ZERO:candidates.get('1').commitment,start=performance.now(),docs=F.documents(sequence),candidate=owner.prepare(docs,F.WORDS,{sequence,previousCommitment:previous,version:'stage4-'+config.runId+'-'+sequence});
    const probes=[...F.WORDS,...docs.flatMap(d=>[d.id,d.body.toString()]),...Object.values(keys).flatMap(k=>[k.toString('hex'),k.toString('base64')])],encoded=JSON.stringify(candidate.snapshot);for(const p of probes)S.check(!encoded.includes(p),'Stage4 private value in public snapshot');
    for(const [key,bytes] of candidate.objects)await storage.putObject(key,bytes);await storage.putSnapshot(sequence,candidate.snapshot);candidates.set(sequence,candidate);
    const queries=F.queries(sequence),reference=Object.fromEntries(queries.map(q=>[q.name,q.expected.map(i=>({document_id:docs[i].id,body_sha256:S.sha(docs[i].body)})).sort((a,b)=>a.document_id.localeCompare(b.document_id))]));
    return {commitment:candidate.commitment,setup:{sequence,preparation_and_publication_ms:performance.now()-start,payload_count:docs.length,posting_count:candidate.snapshot.server_data.tables.length,posting_references:candidate.snapshot.server_data.tables.reduce((n,t)=>n+t.rows.length,0),public_snapshot_private_value_scan_passed:true},reference,
      client_provision:{keys:sequence==='1'?Object.fromEntries(Object.entries(keys).map(([n,k])=>[n,k.toString('base64')])):undefined,state:candidate.snapshot.state,envelope:candidate.snapshot.envelope,ownerPublicKey:candidate.ownerPublicKey,metadata:candidate.snapshot.metadata,queries:queries.map(q=>({name:q.name,query:q.query})),private_probes:probes}};
  },
  async anchor({sequence}) {
    const candidate=candidates.get(sequence);S.check(candidate,'Stage4 candidate missing');const start=performance.now(),receipt=await chain.anchor(candidate),row={sequence,commitment:candidate.commitment,...receipt,submission_to_receipt_ms:performance.now()-start,visibility_status:'pending'};process.send({event:'receipt',receipt:row});
    const visible=performance.now();let attempts=0;while(performance.now()-visible<180000){attempts++;try{const observation=await observer.observe(candidate.snapshot.state);return {...row,visibility_status:'verified',receipt_to_visible_ms:performance.now()-visible,visibility_attempts:attempts,observation};}catch(e){if(e.message!=='Response is not latest visible anchored sequence')throw e;}await new Promise(r=>setTimeout(r,1000));}throw new Error('Stage4 owner visibility timeout');
  },
  async shutdown(){if(storage)await storage.close();if(chain)await chain.close();setImmediate(()=>process.exit(0));return {closed:true};}
});
