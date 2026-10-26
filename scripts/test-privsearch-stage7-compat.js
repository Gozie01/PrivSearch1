'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const E=require('./privsearch/stage7-encrypted-search'),S=require('./privsearch/stage1-state'),a=require('./privsearch/audit-v2-protocol'),{IndependentStateReader}=require('./privsearch/stage1-chain-reader');
const clone=a.clone;
const pins={chainId:'900520900520',genesisHash:'a'.repeat(64),contract:'0x'+'b'.repeat(40),owner:'0x'+'c'.repeat(40),codeHash:S.sha(Buffer.from('6000','hex')),finality:{kind:'confirmations',depth:1},blockSelector:'eip1898'};
const words=['private-term-alpha','private-term-beta','private-term-gamma','private-term-empty','private-term-isolated'];
const documents=Array.from({length:6},(_,i)=>({id:'private-patient-'+i,keywords:[...([0,1,2,3].includes(i)?[words[0]]:[]),...([1,2,4].includes(i)?[words[1]]:[]),...([2,3,5].includes(i)?[words[2]]:[]),...(i===5?[words[4]]:[])],body:Buffer.from('private clinical payload sentinel '+i)}));
const keys=E.generateKeys(),keyPair=crypto.generateKeyPairSync('ed25519'),owner=new E.Stage3Owner({keys,pins,datasetId:'d'.repeat(64),keyPair}),f=owner.prepare(documents,words,{version:'stage3-test-v1'});
function network(candidate=f) {
  const n={height:16,hash:'e'.repeat(64),head:{sequence:candidate.snapshot.state.sequence,commitment:candidate.commitment},calls:[]};
  const codec={encodeOwner:()=> 'OWNER',decodeOwner:v=>v,encodeState:()=> 'STATE',decodeState:v=>v};
  const rpc={async send(m,p){n.calls.push(m);if(m==='eth_chainId')return '0x'+BigInt(pins.chainId).toString(16);if(m==='eth_getBlockByNumber')return {number:p[0]==='0x0'?'0x0':'0x'+n.height.toString(16),hash:'0x'+(p[0]==='0x0'?pins.genesisHash:n.hash),timestamp:'0x1'};if(m==='eth_getCode')return '0x6000';if(m==='eth_call')return p[0].data==='OWNER'?pins.owner:clone(n.head);throw new Error('unexpected RPC');}};
  return {n,reader:new IndependentStateReader(pins,rpc,codec,{retryDelayMs:0})};
}
function input(query=[[words[0],words[1]]],candidate=f,net=network(candidate)) {
  const server=new E.Stage3Server(candidate.snapshot),client=new E.Stage3Client({keys,state:candidate.snapshot.state,envelope:candidate.snapshot.envelope,ownerPublicKey:candidate.ownerPublicKey,metadata:candidate.snapshot.metadata,reader:net.reader}),request=client.createRequest(query),response=server.search(request);
  return {server,client,request,response,net,candidate};
}
function callbacks(c) {return {proveRows:r=>c.server.proveRows(r),locate:h=>c.server.locate(h),retrieve:k=>c.candidate.objects.get(k)};}
test('OXT cross-tag cancellation agrees with independent modular exponentiation',()=>{
  const x=E.field(keys.KI,'test-x',['doc']),z=E.field(keys.KZ,'test-z',['word',1]),fx=E.field(keys.KX,'test-fx',['term']),y=x*E.inverse(z)%E.Q,token=E.power(E.G,z*fx%E.Q);
  assert.equal(E.power(token,y),E.power(E.G,fx*x%E.Q));assert.equal(E.power(token,y),a.modPow(token,y,E.P));assert.equal(a.modPow(E.G,E.Q,E.P),1n);assert.equal(E.P.toString(2).length,2048);
});
test('expanded scalar PRF is deterministic, domain-separated and strictly inside the prime-order field',()=>{
  const x=E.field(keys.KI,'a',['context']);assert.equal(x,E.field(keys.KI,'a',['context']));assert.notEqual(x,E.field(keys.KI,'b',['context']));assert(x>0n&&x<E.Q);assert(x.toString(2).length>256);
});
test('group identity, out-of-range elements and the order-two element are rejected',()=>{
  for(const v of [0n,1n,E.P-1n,E.P])assert.throws(()=>E.groupElement(v.toString(16).padStart(512,'0')));
  assert.throws(()=>E.scalar('0'.repeat(512)));assert.throws(()=>E.scalar(E.Q.toString(16).padStart(512,'0')));
});
test('server snapshot and all request/proof-callback views contain no raw keywords, IDs, payloads or keys',async()=>{
  const c=input(),captured=[c.server.exportView(),c.request,c.response],base=callbacks(c);
  await c.client.verifyResponse(c.response,{...base,proveRows:r=>{captured.push(r);return base.proveRows(r);},locate:h=>{captured.push({requested_handle:h});return base.locate(h);}});
  const bytes=JSON.stringify(captured);for(const w of words)assert(!bytes.includes(w));for(const d of documents){assert(!bytes.includes(d.id));assert(!bytes.includes(d.body.toString()));}
  for(const k of Object.values(keys)){assert(!bytes.includes(k.toString('hex')));assert(!bytes.includes(k.toString('base64')));}
  assert.equal(JSON.stringify(owner),'{}');assert.equal(JSON.stringify(c.client),'{}');
});
test('encrypted entries use distinct ciphertext-row identifiers across postings',()=>{
  const all=f.snapshot.server_data.tables.flatMap(t=>t.rows),ids=all.map(E.rowId);assert.equal(new Set(ids).size,11);assert.equal(new Set(all.map(r=>r.encrypted.iv_hex)).size,11);
  const handles=new Set(f.snapshot.payloads.map(d=>d.context.document_id));assert(!ids.some(id=>handles.has(id)));
});
test('AND, OR, OR-of-AND and overlapping branches verify exact original documents',async()=>{
  for(const [query,expected] of [[[[words[0],words[1]]],[1,2]],[[[words[0],words[1],words[2]]],[2]],[[[words[0]],[words[1]]],[0,1,2,3,4]],[[[words[0],words[1]],[words[1],words[2]]],[1,2]],[[[words[0]],[words[0],words[1]]],[0,1,2,3]]]){
    const c=input(query),r=await c.client.verifyResponse(c.response,callbacks(c));assert(r.verified&&r.omission_completeness&&r.query_result_soundness);assert.deepEqual(r.payloads.map(p=>p.document_id).sort(),expected.map(i=>documents[i].id));assert.equal(c.net.n.calls.length,14);assert.equal(r.formal_composed_privacy_proven,false);
    for(const p of r.payloads)assert(p.plaintext.equals(documents.find(d=>d.id===p.document_id).body));
  }
});
test('empty and disjoint queries authenticate coverage without fetching payloads',async()=>{
  for(const q of [[[words[3]]],[[words[1],words[4]]]]){const c=input(q);let fetched=0;const r=await c.client.verifyResponse(c.response,{...callbacks(c),retrieve:()=>{fetched++;throw new Error('unexpected fetch');}});assert.deepEqual(r.payloads,[]);assert.equal(fetched,0);assert(r.omission_completeness);}
});
test('the least-frequent s-term and cross-test counts match the declared query',()=>{
  const c=input();assert.equal(c.request.clauses[0].count,3);assert.equal(c.response.cross_tests,3);assert.equal(c.request.clauses[0].xtokens.length,3);
  const d=input([[words[0],words[1],words[2]]]);assert.equal(d.response.cross_tests,6);
});
test('omitted or inserted matches and altered branch matches are rejected by client recomputation',async()=>{
  for(const change of [r=>r.clauses[0].matches.pop(),r=>r.clauses[0].matches=[],r=>r.clauses[0].matches=[1,2,3]]){
    const c=input();change(c.response);await assert.rejects(c.client.verifyResponse(c.response,callbacks(c)),/Stage3 completeness clause mismatch/);
  }
  const c=input([[words[0],words[1]],[words[1],words[2]]]);c.response.clauses[0].matches=[];await assert.rejects(c.client.verifyResponse(c.response,callbacks(c)),/Stage3 completeness clause mismatch/);
});
test('missing, duplicated or wrong-label encrypted coverage packets are rejected',async()=>{
  for(const change of [r=>r.coverage.pop(),r=>r.coverage[1]=clone(r.coverage[0]),r=>r.coverage[0].label='f'.repeat(64)]){const c=input();change(c.response);await assert.rejects(c.client.verifyResponse(c.response,callbacks(c)),/Stage3 missing|Stage3 duplicate/);}
});
test('identifier ciphertext, scalar or position substitution fails the committed ciphertext-row digest',async()=>{
  for(const change of [r=>r.encrypted.tag_hex='0'.repeat(32),r=>r.y='0'.repeat(511)+'1',r=>r.position=99]){const c=input();change(c.response.coverage[0].rows[0]);await assert.rejects(c.client.verifyResponse(c.response,callbacks(c)),/ciphertext row digest/);}
});
test('forged row IDs and recomputed coverage counts/digests do not open the anchored root',async()=>{
  const c=input(),p=c.response.coverage[0].packet.openings[0];p.docs.pop();p.leaf.count=p.docs.length;p.leaf.posting_digest=require('./privsearch/stage2-completeness').postingDigest(p.docs);c.response.coverage[0].rows.pop();
  await assert.rejects(c.client.verifyResponse(c.response,callbacks(c)),/Completeness coverage membership failed/);
});
test('changed XSet or position tokens are detected when they change the Boolean result',async()=>{
  const snapshot=clone(f.snapshot);snapshot.server_data.xset=[];const c=input(),bad=new E.Stage3Server(snapshot);c.response=bad.search(c.request);await assert.rejects(c.client.verifyResponse(c.response,callbacks(c)),/completeness clause mismatch/);
  const d=input();for(const packet of d.request.clauses[0].xtokens)packet.points[0]=E.power(E.G,2n).toString(16).padStart(512,'0');const changed=d.server.search(d.request);await assert.rejects(d.client.verifyResponse(changed,callbacks(d)),/request binding mismatch/);
});
test('request nonce, state, query digest and unknown response fields fail closed',async()=>{
  for(const [k,v] of [['nonce','f'.repeat(64)],['sequence','2'],['request_digest','f'.repeat(64)],['commitment','f'.repeat(64)],['unexpected',true]]){const c=input();c.response[k]=v;await assert.rejects(c.client.verifyResponse(c.response,callbacks(c)));}
});
test('response replay and a proof from another request are rejected',async()=>{
  const c=input();await c.client.verifyResponse(c.response,callbacks(c));await assert.rejects(c.client.verifyResponse(c.response,callbacks(c)),/consumed request/);
  const d=input();await assert.rejects(d.client.verifyResponse(c.response,callbacks(d)),/unknown or consumed/);
});
test('forged RSA encrypted-row witnesses remain rejected',async()=>{
  const c=input(),base=callbacks(c);await assert.rejects(c.client.verifyResponse(c.response,{...base,proveRows:r=>{const p=base.proveRows(r);p.witnesses[0].witness_hex='0'.repeat(a.WITNESS_BYTES*2);return p;}}),/RSA row membership/);
});
test('wrong payload identity, changed locator, ciphertext tamper and valid-object swap remain rejected',async()=>{
  for(const mode of ['identity','locator','tamper','swap']){
    const c=input(),base=callbacks(c),cb={...base};
    if(mode==='identity')cb.locate=h=>{const p=base.locate(h);p.descriptor.context.document_id='f'.repeat(64);return p;};
    if(mode==='locator')cb.locate=h=>{const p=base.locate(h);p.descriptor.object_key='changed';return p;};
    if(mode==='tamper')cb.retrieve=k=>{const e=JSON.parse(base.retrieve(k));e.tag_hex='0'.repeat(32);return Buffer.from(JSON.stringify(e));};
    if(mode==='swap')cb.retrieve=k=>[...f.objects].find(([key])=>key!==k)[1];
    await assert.rejects(c.client.verifyResponse(c.response,cb),/identity|payload membership|envelope digest/);
  }
});
test('wrong identifier keys fail AEAD and wrong payload keys release no plaintext',async()=>{
  for(const changed of ['KE','KD']){const bad=Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,Buffer.from(v)]));bad[changed]=crypto.randomBytes(32);const c=input();c.client=new E.Stage3Client({keys:bad,state:f.snapshot.state,envelope:f.snapshot.envelope,ownerPublicKey:f.ownerPublicKey,metadata:f.snapshot.metadata,reader:c.net.reader});c.request=c.client.createRequest([[words[0],words[1]]]);c.response=c.server.search(c.request);await assert.rejects(c.client.verifyResponse(c.response,callbacks(c)));}
});
test('normalization is committed, duplicate normalized terms and unknown vocabulary are rejected',()=>{
  assert.equal(E.keyword('  PRIVATE-TERM-ALPHA '),words[0]);assert.throws(()=>input([[' PRIVATE-TERM-ALPHA ',words[0]]]),/duplicate normalized/);assert.throws(()=>input([['not-prepared-private-term']]),/not prepared/);
  const metadata=clone(f.snapshot.metadata);metadata.encrypted_search.normalization='changed';assert.throws(()=>new E.Stage3Client({keys,state:f.snapshot.state,envelope:f.snapshot.envelope,ownerPublicKey:f.ownerPublicKey,metadata,reader:network().reader}),/policy mismatch/);
});
test('key copies and snapshot/request/response copies resist caller mutation during asynchronous callbacks',async()=>{
  const local=Object.fromEntries(Object.entries(keys).map(([k,v])=>[k,Buffer.from(v)])),snap=clone(f.snapshot),net=network(),client=new E.Stage3Client({keys:local,state:snap.state,envelope:snap.envelope,ownerPublicKey:f.ownerPublicKey,metadata:snap.metadata,reader:net.reader}),server=new E.Stage3Server(f.snapshot),request=client.createRequest([[words[0],words[1]]]),response=server.search(request);
  local.KE.fill(0);local.KD.fill(0);snap.state.sequence='99';request.clauses=[];let modified=false;
  const r=await client.verifyResponse(response,{proveRows:x=>{if(!modified){response.coverage[0].rows[0].position=999;response.clauses=[];modified=true;}return server.proveRows(x);},locate:h=>server.locate(h),retrieve:k=>f.objects.get(k)});assert.equal(r.payloads.length,2);
});
test('unanchored/stale versions and a newer head during payload retrieval are rejected',async()=>{
  for(const sequence of ['0','2']){const c=input();c.net.n.head={sequence,commitment:S.ZERO};await assert.rejects(c.client.verifyResponse(c.response,callbacks(c)),/latest visible/);}
  const c=input(),base=callbacks(c);await assert.rejects(c.client.verifyResponse(c.response,{...base,retrieve:k=>{c.net.n.height=17;c.net.n.head={sequence:'2',commitment:'f'.repeat(64)};return base.retrieve(k);}}),/latest visible/);
});
function reboundSnapshot(mutate) {
  const snapshot=clone(f.snapshot);mutate(snapshot.server_data.tables);
  const auditOwner=a.buildOwnerState(new Map(snapshot.server_data.tables.map(t=>[t.label,t.rows.map(E.rowId)])),{version:snapshot.state.snapshot_version,sequence:1,keyPair});
  const built=S.buildState({pins,datasetId:snapshot.state.dataset_id,sequence:'1',auditManifest:auditOwner.envelope.manifest,ownerPublicKey:auditOwner.publicKey,metadata:snapshot.metadata,payloadDescriptors:snapshot.payloads});
  snapshot.state=built.state;snapshot.envelope=auditOwner.envelope;snapshot.server_data.audit_server={manifest:auditOwner.serverData.manifest,lists:[...auditOwner.serverData.lists].map(([t,e])=>[t,{docs:e.docs,primes:e.primes.map(String)}])};
  return {...f,snapshot,commitment:built.commitment};
}
test('identifier AEAD rejects wrong posting/position even when a trusted owner recommits substituted ciphertext',async()=>{
  for(const mode of ['posting','position']){
    const candidate=reboundSnapshot(tables=>{
      const tablesWithRows=tables.filter(t=>t.rows.length>=2),first=tablesWithRows[0];
      if(mode==='posting')first.rows[0].encrypted=clone(tablesWithRows[1].rows[0].encrypted);
      else [first.rows[0].encrypted,first.rows[1].encrypted]=[first.rows[1].encrypted,first.rows[0].encrypted];
    });
    // OR opens all prepared nonempty postings, including the altered rows.
    const c=input([[words[0]],[words[1]],[words[2]],[words[4]]],candidate);await assert.rejects(c.client.verifyResponse(c.response,callbacks(c)),/authenticate data/);
  }
});
test('decrypted identifier and y scalar must agree even under a newly signed and anchored ciphertext-row root',async()=>{
  const candidate=reboundSnapshot(tables=>tables.find(t=>t.rows.length>0).rows[0].y='0'.repeat(511)+'1'),c=input([[words[0]],[words[1]],[words[2]],[words[4]]],candidate);
  await assert.rejects(c.client.verifyResponse(c.response,callbacks(c)),/row scalar binding mismatch/);
});
test('emitted identifier and payload IVs are unique and repeated entropy stops within a bounded attempt limit',()=>{
  const ivs=[...f.snapshot.server_data.tables.flatMap(t=>t.rows.map(r=>r.encrypted.iv_hex)),...[...f.objects.values()].map(b=>JSON.parse(b).iv_hex)];assert.equal(new Set(ivs).size,ivs.length);
  const original=crypto.randomBytes;crypto.randomBytes=n=>n===12?Buffer.alloc(12,7):original(n);
  try {const o=new E.Stage3Owner({keys,pins,datasetId:'e'.repeat(64),keyPair});assert.throws(()=>o.prepare(documents,words),/IV uniqueness limit/);}finally{crypto.randomBytes=original;}
});
