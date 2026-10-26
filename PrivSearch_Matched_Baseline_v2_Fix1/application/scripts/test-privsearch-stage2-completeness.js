'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const S=require('./privsearch/stage1-state'),C=require('./privsearch/stage2-completeness'),audit=require('./privsearch/audit-v2-protocol');
const {IndependentStateReader}=require('./privsearch/stage1-chain-reader');
const {Stage1Client}=require('./privsearch/stage1-client');
const clone=v=>JSON.parse(S.canonical(v));
const TOKENS=Array.from({length:5},(_,i)=>(i+1).toString(16).padStart(64,'0'));
const PINS={chainId:'900520900520',genesisHash:'a'.repeat(64),contract:'0x'+'b'.repeat(40),owner:'0x'+'c'.repeat(40),codeHash:S.sha(Buffer.from('6000','hex')),finality:{kind:'confirmations',depth:1},blockSelector:'eip1898'};
function fixture(sequence='1',previous=S.ZERO) {
  const docs=['a','b','c','d','e','f'],postings=new Map([[TOKENS[0],sequence==='1'?['a','b','c','d']:['a','c','d','f']],[TOKENS[1],['b','c','e']],[TOKENS[2],['c','d','f']],[TOKENS[3],[]],[TOKENS[4],['f']]]);
  const owner=audit.buildOwnerState(postings,{version:'completeness-test-'+sequence,sequence:Number(sequence)}),key=crypto.randomBytes(32),objects=new Map(),metadata={families:['token-dnf'],completeness:clone(C.POLICY)};
  const descriptors=docs.map(id=>{const context={dataset_id:'d'.repeat(64),document_id:id,revision:sequence,key_id:'test'},e=S.encryptPayload(Buffer.from('fixture:'+id),key,context),objectKey='fixture/'+id;objects.set(objectKey,e);return S.descriptor(context,e,objectKey);});
  const built=S.buildState({pins:PINS,datasetId:'d'.repeat(64),sequence,auditManifest:owner.envelope.manifest,ownerPublicKey:owner.publicKey,metadata,payloadDescriptors:descriptors,previousCommitment:previous});
  return {docs,postings,owner,key,objects,metadata,...built};
}
function network(f) {
  const n={calls:[],height:16,hash:'e'.repeat(64),head:{sequence:f.state.sequence,commitment:f.commitment}};
  const codec={encodeOwner:()=> 'OWNER',decodeOwner:v=>v,encodeState:()=> 'STATE',decodeState:v=>v};
  const rpc={async send(m,p){n.calls.push({method:m,params:clone(p)});
    if(m==='eth_chainId')return '0x'+BigInt(PINS.chainId).toString(16);
    if(m==='eth_getBlockByNumber')return {number:p[0]==='0x0'?'0x0':'0x'+n.height.toString(16),hash:'0x'+(p[0]==='0x0'?PINS.genesisHash:n.hash),timestamp:'0x1'};
    if(m==='eth_getCode')return '0x6000';if(m==='eth_call')return p[0].data==='OWNER'?PINS.owner:clone(n.head);throw new Error('unexpected RPC');}};
  return {n,reader:new IndependentStateReader(PINS,rpc,codec,{retryDelayMs:0})};
}
function input(f,query,net=network(f),Client=C.Stage2Client) {
  const server=new audit.AuditServer(f.owner.serverData),answer=server.createAnswer(query),coverage=C.buildCoveragePacket(f.state,server,query),client=new Client({state:f.state,envelope:f.owner.envelope,ownerPublicKey:f.owner.publicKey,metadata:f.metadata,reader:net.reader,decryptionKey:f.key,sampleSize:1});
  return {server,answer,coverage,client,net,query};
}
function packets(f,ids) {return ids.map(id=>{const i=f.payloads.findIndex(d=>d.context.document_id===id);return {descriptor:clone(f.payloads[i]),proof:clone(f.payloadProofs[i])};});}
async function exchange(f,c,retrieve=async key=>f.objects.get(key)) {
  const challenge=c.client.createChallenge(c.answer,c.query,c.coverage),proof=c.server.createProof(c.answer,c.query,challenge);
  return c.client.verify(proof,packets(f,c.answer.result_docs),retrieve);
}
const f=fixture();
test('AND, OR, OR-of-AND and overlapping branches authenticate exact sets with sampled RSA retained',async()=>{
  for(const [query,expected] of [[[[TOKENS[0],TOKENS[1]]],['b','c']],[[[TOKENS[0],TOKENS[1],TOKENS[2]]],['c']],[[[TOKENS[0]],[TOKENS[1]]],['a','b','c','d','e']],[[[TOKENS[0],TOKENS[1]],[TOKENS[1],TOKENS[2]]],['b','c']],[[[TOKENS[0]],[TOKENS[0],TOKENS[1]]],['a','b','c','d']]]){
    const c=input(f,query),r=await exchange(f,c);assert(r.verified&&r.omission_completeness&&r.query_result_soundness);assert.equal(r.encrypted_search_privacy,false);assert.deepEqual(r.result_docs,expected);assert.equal(c.net.n.calls.length,14);assert(r.checked_documents<=1);assert.equal(r.payloads.length,expected.length);
  }
});
test('committed empty postings and disjoint AND results verify with zero witnesses and zero retrievals',async()=>{
  for(const query of [[[TOKENS[3]]],[[TOKENS[1],TOKENS[4]]]]){
    let retrieved=0;const c=input(f,query),r=await exchange(f,c,async()=>{retrieved++;throw new Error('unexpected fetch');});
    assert(r.omission_completeness);assert.deepEqual(r.result_docs,[]);assert.equal(r.checked_witnesses,0);assert.equal(retrieved,0);assert.equal(c.net.n.calls.length,14);
  }
});
test('the old client accepts an omission control while Stage2 rejects it before a challenge',async()=>{
  const query=[[TOKENS[0],TOKENS[1]]],old=input(f,query,network(f),Stage1Client);
  old.answer.result_docs=['c'];old.answer.clause_docs=[['c']];
  const r=await exchange(f,old);assert(r.verified);assert.equal(r.omission_completeness,false);assert.deepEqual(r.result_docs,['c']);
  const c=input(f,query);c.answer.result_docs=['c'];c.answer.clause_docs=[['c']];
  assert.throws(()=>c.client.createChallenge(c.answer,c.query,c.coverage),/Completeness clause result mismatch/);assert.equal(c.net.n.calls.length,0);
});
test('omitting all results or inserting a valid nonmatching payload identity is rejected',()=>{
  for(const docs of [[],['a','b','c']]){const c=input(f,[[TOKENS[0],TOKENS[1]]]);c.answer.result_docs=docs;c.answer.clause_docs=[docs];assert.throws(()=>c.client.createChallenge(c.answer,c.query,c.coverage),/Completeness clause result mismatch/);}
});
test('branch omissions are rejected even when the final DNF union is unchanged',()=>{
  const c=input(f,[[TOKENS[0],TOKENS[1]],[TOKENS[1],TOKENS[2]]]);assert.deepEqual(c.answer.result_docs,['b','c']);c.answer.clause_docs[0]=['b'];
  assert.throws(()=>c.client.createChallenge(c.answer,c.query,c.coverage),/Completeness clause result mismatch/);
});
test('missing, extra, duplicated and reordered token openings are rejected',()=>{
  for(const mutate of [p=>p.openings.pop(),p=>p.openings.push(clone(p.openings[0])),p=>p.openings[1]=clone(p.openings[0]),p=>p.openings.reverse()]){
    const c=input(f,[[TOKENS[0],TOKENS[1]]]);mutate(c.coverage);assert.throws(()=>c.client.createChallenge(c.answer,c.query,c.coverage),/Completeness/);
  }
});
test('truncated, reordered or duplicate posting documents cannot be used as full openings',()=>{
  for(const mutate of [o=>o.docs.pop(),o=>o.docs.reverse(),o=>o.docs.push(o.docs[0])]){
    const c=input(f,[[TOKENS[0],TOKENS[1]]]);mutate(c.coverage.openings[0]);assert.throws(()=>c.client.createChallenge(c.answer,c.query,c.coverage),/Completeness/);
  }
});
test('changing an opening and its count/digest still fails anchored Merkle membership',()=>{
  const c=input(f,[[TOKENS[0],TOKENS[1]]]),o=c.coverage.openings[0];o.docs.pop();o.leaf.count=o.docs.length;o.leaf.posting_digest=C.postingDigest(o.docs);
  assert.throws(()=>c.client.createChallenge(c.answer,c.query,c.coverage),/Completeness coverage membership failed/);
});
test('empty-result claims require every authenticated empty or disjoint posting opening',()=>{
  const c=input(f,[[TOKENS[3]]]);c.coverage.openings=[];assert.throws(()=>c.client.createChallenge(c.answer,c.query,c.coverage),/Completeness missing/);
  const d=input(f,[[TOKENS[1],TOKENS[4]]]);d.coverage.openings[0].docs=[];d.coverage.openings[0].leaf.count=0;d.coverage.openings[0].leaf.posting_digest=C.postingDigest([]);
  assert.throws(()=>d.client.createChallenge(d.answer,d.query,d.coverage),/Completeness coverage membership failed/);
});
test('cross-dataset, version, snapshot, coverage-root and query packet substitution is rejected',()=>{
  for(const [field,value] of [['dataset_id','f'.repeat(64)],['sequence','2'],['index_snapshot_digest','f'.repeat(64)],['coverage_root','f'.repeat(64)],['query_digest','f'.repeat(64)]]){
    const c=input(f,[[TOKENS[0],TOKENS[1]]]);c.coverage[field]=value;assert.throws(()=>c.client.createChallenge(c.answer,c.query,c.coverage),/Completeness .* binding mismatch/);
  }
});
test('coverage proof position, count, siblings and unknown fields are rejected',()=>{
  for(const mutate of [p=>p.index=(p.index+1)%p.count,p=>p.count++,p=>p.siblings[0]='f'.repeat(64),p=>p.unexpected=true]){
    const c=input(f,[[TOKENS[0],TOKENS[1]]]);mutate(c.coverage.openings[0].proof);assert.throws(()=>c.client.createChallenge(c.answer,c.query,c.coverage),/Completeness/);
  }
  const c=input(f,[[TOKENS[0]]]);c.coverage.unexpected=true;assert.throws(()=>c.client.createChallenge(c.answer,c.query,c.coverage),/Unexpected or missing fields/);
});
test('wrong query, unprepared tokens and malformed or oversized query shapes fail closed',()=>{
  const c=input(f,[[TOKENS[0],TOKENS[1]]]);assert.throws(()=>c.client.createChallenge(c.answer,[[TOKENS[0]]],c.coverage),/Completeness query binding/);
  assert.throws(()=>C.buildCoveragePacket(f.state,f.owner.serverData,[['f'.repeat(64)]]),/not prepared/);
  for(const q of [[],[[]],[[TOKENS[0],TOKENS[0]]],Array.from({length:65},()=>[TOKENS[0]]),[Array.from({length:129},()=>TOKENS[0])]])assert.throws(()=>C.checkedQuery(q));
});
test('completeness policy must be anchored and unknown metadata changes cannot substitute it',()=>{
  assert(Object.isFrozen(C.POLICY));assert.throws(()=>{C.POLICY.max_clauses=1;},TypeError);
  const options={state:f.state,envelope:f.owner.envelope,ownerPublicKey:f.owner.publicKey,metadata:{...f.metadata,completeness:{...C.POLICY,max_clauses:1}},reader:network(f).reader,decryptionKey:f.key};
  assert.throws(()=>new C.Stage2Client(options),/Completeness policy/);
  options.metadata={...f.metadata,unexpected:'changed'};assert.throws(()=>new C.Stage2Client(options),/Query metadata mismatch/);
});
test('client state, query, answer and coverage caller mutation cannot change an issued challenge',async()=>{
  const state=clone(f.state),c=input({...f,state},[[TOKENS[0],TOKENS[1]]]),original=audit.clone(c.answer),query=clone(c.query),challenge=c.client.createChallenge(c.answer,c.query,c.coverage);
  state.sequence='99';c.answer.result_docs=[];c.query[0]=[TOKENS[4]];c.coverage.openings=[];
  const proof=c.server.createProof(original,query,challenge),r=await c.client.verify(proof,packets(f,original.result_docs),async key=>f.objects.get(key));assert.deepEqual(r.result_docs,['b','c']);assert(r.omission_completeness);
});
test('challenge replay, changed RSA proof binding and proof from another challenge are rejected',async()=>{
  const c=input(f,[[TOKENS[0],TOKENS[1]]]),challenge=c.client.createChallenge(c.answer,c.query,c.coverage),proof=c.server.createProof(c.answer,c.query,challenge);
  await c.client.verify(proof,packets(f,c.answer.result_docs),async k=>f.objects.get(k));await assert.rejects(c.client.verify(proof,[],async()=>{}),/consumed challenge/);
  const d=input(f,c.query),ch=d.client.createChallenge(d.answer,d.query,d.coverage),p=d.server.createProof(d.answer,d.query,ch);p.query_digest='f'.repeat(64);
  await assert.rejects(d.client.verify(p,packets(f,d.answer.result_docs),async k=>f.objects.get(k)),/RSA membership/);
  const e=input(f,c.query);await assert.rejects(e.client.verify(proof,[],async()=>{}),/unknown or consumed/);
});
test('unanchored version, stale version and a state advance during payload I/O release no result',async()=>{
  let c=input(f,[[TOKENS[0],TOKENS[1]]]);c.net.n.head={sequence:'0',commitment:S.ZERO};await assert.rejects(exchange(f,c),/latest visible/);
  c=input(f,[[TOKENS[0],TOKENS[1]]]);c.net.n.head={sequence:'2',commitment:'f'.repeat(64)};await assert.rejects(exchange(f,c),/latest visible/);
  c=input(f,[[TOKENS[0],TOKENS[1]]]);let fetched=0;
  await assert.rejects(exchange(f,c,async k=>{fetched++;c.net.n.height=17;c.net.n.head={sequence:'2',commitment:'f'.repeat(64)};return f.objects.get(k);}),/latest visible/);assert.equal(fetched,2);
});
test('payload locator, ciphertext swap and forged RSA witnesses remain rejected',async()=>{
  const c=input(f,[[TOKENS[0],TOKENS[1]]]),challenge=c.client.createChallenge(c.answer,c.query,c.coverage),proof=c.server.createProof(c.answer,c.query,challenge);proof.witnesses[0].witness_hex='0'.repeat(audit.WITNESS_BYTES*2);
  await assert.rejects(c.client.verify(proof,packets(f,c.answer.result_docs),async k=>f.objects.get(k)),/RSA membership/);
  const d=input(f,c.query);await assert.rejects(exchange(f,d,async()=>f.objects.get('fixture/a')),/envelope digest mismatch/);
  const e=input(f,c.query),ch=e.client.createChallenge(e.answer,e.query,e.coverage),p=e.server.createProof(e.answer,e.query,ch),ps=packets(f,e.answer.result_docs);ps[0].descriptor.object_key='substituted';
  await assert.rejects(e.client.verify(p,ps,async k=>f.objects.get(k)),/Manifest membership/);
});
test('all nonempty token-subset AND and OR queries agree with an independent universe scan',()=>{
  const server=new audit.AuditServer(f.owner.serverData);let checked=0;
  for(let mask=1;mask<32;mask++){
    const subset=TOKENS.filter((_,i)=>mask&(1<<i));
    for(const query of [[subset],subset.map(t=>[t]),[subset,[TOKENS[0],TOKENS[1]]]]){
      const answer=server.createAnswer(query),packet=C.buildCoveragePacket(f.state,server,query),result=C.verifyCoverage(f.state,query,answer,packet);
      const expected=f.docs.filter(id=>query.some(clause=>clause.every(t=>f.postings.get(t).includes(id))));
      assert.deepEqual(result.result_docs,expected);checked++;
    }
  }
  assert.equal(checked,93);
});
