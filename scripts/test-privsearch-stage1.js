'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const S=require('./privsearch/stage1-state');
const {IndependentStateReader,RpcTransport,selectedBlock}=require('./privsearch/stage1-chain-reader');
const {Stage1Client}=require('./privsearch/stage1-client');
const audit=require('./privsearch/audit-v2-protocol');
const P={chainId:'900520900520',genesisHash:'a'.repeat(64),contract:'0x'+'b'.repeat(40),owner:'0x'+'c'.repeat(40),codeHash:S.sha(Buffer.from('6000','hex')),finality:{kind:'finalized'},blockSelector:'number-checked'};
const clone=v=>JSON.parse(JSON.stringify(v));
function fixture(sequence='1',previous=S.ZERO) {
  const token=crypto.randomBytes(32).toString('hex'),docs=['document-a','document-b','document-c'];
  const a=audit.buildOwnerState(new Map([[token,docs]]),{version:'stage1-fixture-'+sequence,sequence:Number(sequence)});
  const key=crypto.randomBytes(32),dataset='d'.repeat(64),objects=new Map();
  const descriptors=docs.map(id=>{const context={dataset_id:dataset,document_id:id,revision:'1',key_id:'fixture'},e=S.encryptPayload(Buffer.from('synthetic:'+id),key,context),objectKey='pilot/'+id+'/'+S.hash('ciphertext-envelope',e)+'.json';objects.set(objectKey,e);return S.descriptor(context,e,objectKey);});
  const metadata={query_families:['single_keyword'],expansion:'none',scope:'synthetic-test'};
  const state=S.buildState({pins:P,datasetId:dataset,sequence,auditManifest:a.envelope.manifest,ownerPublicKey:a.publicKey,metadata,payloadDescriptors:descriptors,previousCommitment:previous});
  return {a,key,objects,metadata,...state,query:[[token]],docs};
}
function network(f) {
  const n={height:12n,hash:'e'.repeat(64),genesis:P.genesisHash,chain:P.chainId,owner:P.owner,code:'0x6000',head:{sequence:f.state.sequence,commitment:f.commitment},calls:[],fail:false,changeAfter:false};
  const codec={encodeOwner:()=> 'OWNER',decodeOwner:v=>v,encodeState:()=> 'STATE',decodeState:v=>v};
  let blockReads=0;
  const rpc={async send(method,params) {
    n.calls.push({method,params:clone(params)});if(n.fail)throw new Error('unavailable');
    if(method==='eth_chainId')return '0x'+BigInt(n.chain).toString(16);
    if(method==='eth_getBlockByNumber') {
      if(params[0]==='0x0')return {number:'0x0',hash:'0x'+n.genesis,timestamp:'0x1'};
      blockReads++;return {number:'0x'+n.height.toString(16),hash:'0x'+(n.changeAfter&&blockReads%2===0?'f'.repeat(64):n.hash),timestamp:'0x10'};
    }
    if(method==='eth_getCode')return n.code;
    if(method==='eth_call')return params[0].data==='OWNER'?n.owner:clone(n.head);
    throw new Error('unexpected method');
  }};
  return {n,rpc,codec,reader:new IndependentStateReader(P,rpc,codec)};
}
function packet(f,id) {const i=f.payloads.findIndex(d=>d.context.document_id===id);return {descriptor:clone(f.payloads[i]),proof:clone(f.payloadProofs[i])};}
function clientCase(f,net) {
  const server=new audit.AuditServer(f.a.serverData),client=new Stage1Client({state:f.state,envelope:f.a.envelope,ownerPublicKey:f.a.publicKey,metadata:f.metadata,reader:net.reader,decryptionKey:f.key,sampleSize:3});
  const answer=server.createAnswer(f.query),challenge=client.createChallenge(answer,f.query),proof=server.createProof(answer,f.query,challenge);
  return {server,client,answer,proof,packets:f.docs.map(id=>packet(f,id)),retrieve:async k=>f.objects.get(k)};
}
test('canonical state hash is order independent and rejects unsafe/unknown fields',()=>{
  assert.equal(S.hash('x',{b:2,a:1}),S.hash('x',{a:1,b:2}));assert.throws(()=>S.canonical({x:undefined}));assert.throws(()=>S.canonical(1.2));
  const f=fixture();assert.throws(()=>S.commitment({...f.state,unexpected:1}));assert.throws(()=>S.commitment({...f.state,sequence:'01'}));
  for(const name of ['coverage_root','metadata_digest','payload_root','parameters_digest','owner_signing_key_digest','previous_commitment']) assert.notEqual(S.commitment({...f.state,[name]:'1'.repeat(64)}),f.commitment);
});
test('Merkle proofs bind count, index, order, domain and every leaf for odd sizes',()=>{
  for(const size of [1,2,3,5,9]) {const values=Array.from({length:size},(_,i)=>({i})),t=S.tree(values,'payload-manifest');values.forEach((v,i)=>assert(S.verifyLeaf(v,t.proof(i),'payload-manifest',t.root)));const p=t.proof(0);assert.throws(()=>S.verifyLeaf({i:100},p,'payload-manifest',t.root));assert.throws(()=>S.verifyLeaf(values[0],p,'coverage',t.root));assert.throws(()=>S.verifyLeaf(values[0],{...p,count:size+1},'payload-manifest',t.root));}
});
test('honest bound payloads decrypt; swaps, identity, revision, locator and ciphertext changes fail',()=>{
  const f=fixture(),p=packet(f,f.docs[0]),e=f.objects.get(p.descriptor.object_key);
  assert.equal(S.decryptPayload(e,f.key,p.descriptor,p.proof,f.state,f.docs[0]).toString(),'synthetic:'+f.docs[0]);
  assert.throws(()=>S.decryptPayload(f.objects.get(f.payloads[1].object_key),f.key,p.descriptor,p.proof,f.state,f.docs[0]));
  for(const change of [d=>d.context.revision='2',d=>d.context.document_id='other',d=>d.context.dataset_id='1'.repeat(64),d=>d.object_key='swap',d=>d.status='deleted']) {const d=clone(p.descriptor);change(d);assert.throws(()=>S.decryptPayload(e,f.key,d,p.proof,f.state,f.docs[0]));}
  const tampered={...e,tag_hex:'0'.repeat(32)};assert.throws(()=>S.decryptPayload(tampered,f.key,p.descriptor,p.proof,f.state,f.docs[0]));
  assert.throws(()=>S.decryptPayload(e,crypto.randomBytes(32),p.descriptor,p.proof,f.state,f.docs[0]));
});
test('AEAD rejects wrong document/revision even if a trusted owner commits a substituted envelope',()=>{
  const f=fixture(),original=f.payloads[0],e=f.objects.get(original.object_key),c={...original.context,revision:'2'},d=S.descriptor(c,e,'new-handle'),t=S.tree([d],'payload-manifest');
  const state={...f.state,payload_root:t.root,payload_count:1};assert.throws(()=>S.decryptPayload(e,f.key,d,t.proof(0),state,c.document_id));
});
test('anchored binding rejects changed index, authority, metadata, roots and counts',()=>{
  const f=fixture();S.bindAuditState(f.state,f.a.envelope,f.a.publicKey,f.metadata);
  for(const state of [{...f.state,coverage_root:'1'.repeat(64)},{...f.state,authentication_root:'1'.repeat(64)},{...f.state,posting_count:2}]) assert.throws(()=>S.bindAuditState(state,f.a.envelope,f.a.publicKey,f.metadata));
  assert.throws(()=>S.bindAuditState(f.state,f.a.envelope,'wrong',f.metadata));assert.throws(()=>S.bindAuditState(f.state,f.a.envelope,f.a.publicKey,{...f.metadata,expansion:'changed'}));
});
test('independent reader checks pinned chain, genesis, code, owner and block-coherent state',async()=>{
  const f=fixture(),net=network(f),r=await net.reader.observe(f.state);assert(r.verified);assert.equal(net.n.calls.length,7);
  for(const [field,value] of [['chain','1'],['genesis','1'.repeat(64)],['code','0x6001'],['owner','0x'+'1'.repeat(40)],['changeAfter',true],['fail',true]]) {const n=network(f);n.n[field]=value;await assert.rejects(n.reader.observe(f.state));}
  await assert.rejects(net.reader.observe({...f.state,contract:'1'.repeat(40)}));
});
test('reader pins cannot be changed through caller mutation and hash selectors are explicit',async()=>{
  const f=fixture(),n=network(f),pins=clone(P);pins.blockSelector='eip1898';const r=new IndependentStateReader(pins,n.rpc,n.codec);pins.owner='0x'+'1'.repeat(40);await r.observe(f.state);
  for(const c of n.n.calls.filter(c=>['eth_call','eth_getCode'].includes(c.method))) assert.deepEqual(c.params[1],{blockHash:'0x'+n.n.hash,requireCanonical:true});
});
test('latest anchored head rejects stale or conflicting state and retained watermarks reject rollback',async()=>{
  const f=fixture(),n=network(f);await n.reader.observe(f.state);n.n.head={sequence:'2',commitment:'2'.repeat(64)};n.n.height=13n;await assert.rejects(n.reader.observe(f.state),/latest visible/);
  n.n.head={sequence:'1',commitment:f.commitment};n.n.height=14n;await assert.rejects(n.reader.observe(f.state),/rollback/);
  const n2=network(f);await n2.reader.observe(f.state);n2.n.height=11n;await assert.rejects(n2.reader.observe(f.state),/rollback/);
  const n3=network(f);n3.n.head.commitment='2'.repeat(64);await assert.rejects(n3.reader.observe(f.state),/differs/);
});
test('honest composite client returns only independently verified and authenticated plaintext',async()=>{
  const f=fixture(),n=network(f),c=clientCase(f,n),r=await c.client.verify(c.proof,c.packets,c.retrieve);
  assert.equal(r.payloads.length,3);assert.equal(n.n.calls.length,14);assert.equal(r.omission_completeness,false);assert.equal(r.encrypted_search_privacy,false);
  assert.deepEqual(r.payloads.map(p=>p.plaintext.toString()),f.docs.map(id=>'synthetic:'+id));
});
test('composite client rejects RSA tamper, missing payload, valid-object swap and state change during retrieval',async()=>{
  const f=fixture();
  let n=network(f),c=clientCase(f,n);c.proof.witnesses[0].witness_hex='0'.repeat(audit.WITNESS_BYTES*2);await assert.rejects(c.client.verify(c.proof,c.packets,c.retrieve),/membership/);
  n=network(f);c=clientCase(f,n);await assert.rejects(c.client.verify(c.proof,c.packets.slice(1),c.retrieve),/count/);
  n=network(f);c=clientCase(f,n);await assert.rejects(c.client.verify(c.proof,c.packets,async()=>f.objects.get(f.payloads[1].object_key)));
  n=network(f);c=clientCase(f,n);await assert.rejects(c.client.verify(c.proof,c.packets,async k=>{n.n.height=13n;n.n.head={sequence:'2',commitment:'2'.repeat(64)};return f.objects.get(k);}),/latest visible/);
});
test('honestly signed unanchored version remains rejected and a cold client cannot substitute its authority',async()=>{
  const f=fixture(),n=network(f);n.n.head={sequence:'0',commitment:S.ZERO};const c=clientCase(f,n);await assert.rejects(c.client.verify(c.proof,c.packets,c.retrieve),/latest visible/);
  const wrong=audit.buildOwnerState(new Map([[crypto.randomBytes(32).toString('hex'),['x']]]));assert.throws(()=>new Stage1Client({state:f.state,envelope:f.a.envelope,ownerPublicKey:wrong.publicKey,metadata:f.metadata,reader:n.reader,decryptionKey:f.key}));
});
test('unsupported finalized reads fail without fallback; confirmation depth is explicit',async()=>{
  const calls=[],rpc={async send(m,p){calls.push(p[0]);if(p[0]==='finalized')throw new Error('unsupported');return {number:p[0]==='latest'?'0x10':p[0],hash:'0x'+'e'.repeat(64),timestamp:'0x1'};}};
  await assert.rejects(selectedBlock(rpc,{kind:'finalized'}));assert.deepEqual(calls,['finalized']);
  assert.equal((await selectedBlock(rpc,{kind:'confirmations',depth:3})).number,'0xe');
  await assert.rejects(selectedBlock(rpc,{kind:'confirmations',depth:0}));
});
test('RPC transport validates response identity and rejects RPC errors and invalid JSON',async()=>{
  const http=require('node:http');let mode='honest';
  const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const r=JSON.parse(raw);res.setHeader('Content-Type','application/json');res.end(mode==='bad-json'?'broken':JSON.stringify({jsonrpc:'2.0',id:mode==='wrong-id'?r.id+1:r.id,...(mode==='error'?{error:{code:-1,message:'provider rejected'}}:{result:'0x1'})}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {const rpc=new RpcTransport('http://127.0.0.1:'+server.address().port);assert.equal(await rpc.send('eth_chainId',[]),'0x1');for(const m of ['wrong-id','error','bad-json']){mode=m;await assert.rejects(rpc.send('eth_chainId',[]));}}
  finally {await new Promise(resolve=>server.close(resolve));}
});
