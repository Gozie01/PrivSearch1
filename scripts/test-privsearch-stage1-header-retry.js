'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const S=require('./privsearch/stage1-state');
const {IndependentStateReader,RpcMethodError}=require('./privsearch/stage1-chain-reader');
const {Stage1Client}=require('./privsearch/stage1-client');
const audit=require('./privsearch/audit-v2-protocol');
function fixture() {
  const p={chainId:'900520900520',genesisHash:'a'.repeat(64),contract:'0x'+'b'.repeat(40),owner:'0x'+'c'.repeat(40),codeHash:S.sha(Buffer.from('6000','hex')),finality:{kind:'confirmations',depth:1},blockSelector:'eip1898'};
  const state={schema:S.SCHEMA,chain_id:p.chainId,genesis_hash:p.genesisHash,contract:p.contract.slice(2),owner:p.owner.slice(2),dataset_id:'d'.repeat(64),sequence:'1',snapshot_version:'header-retry-test',index_snapshot_digest:'1'.repeat(64),owner_signing_key_digest:'2'.repeat(64),parameters_digest:'3'.repeat(64),authentication_root:'4'.repeat(64),coverage_root:'5'.repeat(64),metadata_digest:'6'.repeat(64),payload_root:'7'.repeat(64),posting_count:1,payload_count:1,previous_commitment:S.ZERO};
  const n={calls:[],height:16,hash:'e'.repeat(64),head:{sequence:'1',commitment:S.commitment(state)},code:'0x6000',owner:p.owner,failMethod:'eth_getCode',failData:null,failures:1,onFailure:null,errorCode:-32000,errorMessage:'header for hash not found'};
  const codec={encodeOwner:()=> 'OWNER',decodeOwner:v=>v,encodeState:()=> 'STATE',decodeState:v=>v};
  const rpc={async send(method,params){
    n.calls.push({method,params:JSON.parse(JSON.stringify(params))});
    if(method===n.failMethod&&(!n.failData||params[0].data===n.failData)&&n.failures>0){
      n.failures--;if(n.onFailure)n.onFailure();
      throw new RpcMethodError(method,{code:n.errorCode,message:n.errorMessage},params[1]);
    }
    if(method==='eth_chainId')return '0x'+BigInt(p.chainId).toString(16);
    if(method==='eth_getCode')return n.code;
    if(method==='eth_call')return params[0].data==='OWNER'?n.owner:{...n.head};
    if(method==='eth_getBlockByNumber')return {number:params[0]==='0x0'?'0x0':'0x'+n.height.toString(16),hash:'0x'+(params[0]==='0x0'?p.genesisHash:n.hash),timestamp:'0x1'};
    throw new Error('Unexpected RPC');
  }};
  const reader=new IndependentStateReader(p,rpc,codec,{maxBlockAttempts:3,retryDelayMs:0});
  return {p,state,n,codec,rpc,reader};
}
test('missing canonical header restarts every check and records exact error, selector and RPC counts',async()=>{
  const f=fixture();f.n.onFailure=()=>{f.n.height=17;f.n.hash='f'.repeat(64);};
  const r=await f.reader.observe(f.state);
  assert(r.verified);assert.equal(r.observation_attempts,2);assert.equal(r.rpc_calls,11);
  assert.equal(r.block_hash,'0x'+'f'.repeat(64));assert.equal(r.block_number,'17');
  assert.equal(f.n.calls.filter(c=>c.method==='eth_chainId').length,2);
  assert.equal(f.n.calls.filter(c=>c.method==='eth_getBlockByNumber'&&c.params[0]==='latest').length,2);
  assert.deepEqual(r.retry_events,[{attempt:1,stage:'rpc-eth_getCode',selector:{blockHash:'0x'+'e'.repeat(64),requireCanonical:true},reason:'Canonical block header unavailable',rpc_method:'eth_getCode',code:-32000,provider_message:'header for hash not found'}]);
  for(const c of f.n.calls.slice(4).filter(c=>['eth_getCode','eth_call'].includes(c.method)))assert.deepEqual(c.params[1],{blockHash:r.block_hash,requireCanonical:true});
});
test('missing headers during both owner and head eth_call restart the whole observation',async()=>{
  for(const [data,calls] of [['OWNER',12],['STATE',13]]){
    const f=fixture();f.n.failMethod='eth_call';f.n.failData=data;
    const r=await f.reader.observe(f.state);assert(r.verified);assert.equal(r.rpc_calls,calls);assert.equal(r.observation_attempts,2);
    assert.equal(r.retry_events[0].rpc_method,'eth_call');
  }
});
test('persistent missing headers stop after exactly three attempts with no verified result',async()=>{
  const f=fixture();f.n.failures=Infinity;
  await assert.rejects(f.reader.observe(f.state),e=>e instanceof RpcMethodError&&e.code===-32000&&e.observation_attempts===3&&e.rpc_calls===12&&e.retry_events.length===3);
  assert.equal(f.n.calls.filter(c=>c.method==='eth_chainId').length,3);
  assert(!f.n.calls.some(c=>c.method==='eth_call'));
});
test('unrecognized RPC errors, numeric selectors and noncanonical hash selectors are never retried',async()=>{
  for(const [code,message] of [[-32601,'header for hash not found'],[-32000,'method not supported'],[-32000,'header not found'],[-32000,'hash is not currently canonical'],[-32000,'missing trie node'],[-32000,'header for hash not found https://private/token']]){
    const f=fixture();f.n.errorCode=code;f.n.errorMessage=message;
    await assert.rejects(f.reader.observe(f.state),e=>e.observation_attempts===1&&e.retry_events.length===0);assert.equal(f.n.calls.length,4);
  }
  const f=fixture(),pins={...f.p,blockSelector:'number-checked'},r=new IndependentStateReader(pins,f.rpc,f.codec,{retryDelayMs:0});
  await assert.rejects(r.observe(f.state),e=>e.observation_attempts===1&&e.retry_events.length===0);
  const g=fixture(),send=g.rpc.send.bind(g.rpc);g.n.failures=0;
  g.rpc.send=async(m,p)=>{if(m==='eth_getCode')throw new RpcMethodError(m,{code:-32000,message:'header for hash not found'},{blockHash:'0x'+'e'.repeat(64),requireCanonical:false});return send(m,p);};
  await assert.rejects(g.reader.observe(g.state),e=>e.observation_attempts===1&&e.retry_events.length===0);
});
test('a newer authoritative head on retry rejects stale state and preserves the rollback watermark',async()=>{
  const f=fixture();f.n.onFailure=()=>{f.n.height=17;f.n.head={sequence:'2',commitment:'f'.repeat(64)};};
  await assert.rejects(f.reader.observe(f.state),e=>/latest visible/.test(e.message)&&e.observation_attempts===2&&e.retry_events.length===1);
  f.n.height=18;f.n.head={sequence:'1',commitment:S.commitment(f.state)};
  await assert.rejects(f.reader.observe(f.state),/rollback/);
});
test('a prior watermark survives missing-header retries and rejects changed block or chain rollback',async()=>{
  for(const change of [n=>n.hash='f'.repeat(64),n=>n.height=15]){
    const f=fixture();f.n.failures=0;await f.reader.observe(f.state);
    f.n.failures=1;f.n.onFailure=()=>change(f.n);
    await assert.rejects(f.reader.observe(f.state),e=>/Conflicting observed block|chain rollback/.test(e.message)&&e.observation_attempts===2);
  }
});
test('code and owner pin mismatches after a retry still reject immediately',async()=>{
  for(const change of [n=>n.code='0x6001',n=>n.owner='0x'+'f'.repeat(40)]){
    const f=fixture();f.n.onFailure=()=>change(f.n);
    await assert.rejects(f.reader.observe(f.state),e=>/differs from pin|owner mismatch/.test(e.message)&&e.observation_attempts===2&&e.retry_events.length===1);
  }
});
test('mixed null-block and missing-header failures share the same three-attempt budget',async()=>{
  const f=fixture(),send=f.rpc.send.bind(f.rpc);let latest=0;
  f.n.failures=0;f.rpc.send=async(m,p)=>{
    if(m==='eth_getBlockByNumber'&&p[0]==='latest'&&++latest===1)return null;
    if(m==='eth_getCode')throw new RpcMethodError(m,{code:-32000,message:'header for hash not found'},p[1]);
    return send(m,p);
  };
  await assert.rejects(f.reader.observe(f.state),e=>e.observation_attempts===3&&e.rpc_calls===11&&e.retry_events.length===3&&e.retry_events[0].reason==='RPC returned null block');
});
test('a composite client releases no plaintext when the release observation exhausts missing-header retries',async()=>{
  const f=fixture();f.n.failures=0;
  const token=crypto.randomBytes(32).toString('hex'),docs=['synthetic-a'],a=audit.buildOwnerState(new Map([[token,docs]])),key=crypto.randomBytes(32);
  const context={dataset_id:f.state.dataset_id,document_id:docs[0],revision:'1',key_id:'test'},envelope=S.encryptPayload(Buffer.from('authenticated plaintext'),key,context),descriptor=S.descriptor(context,envelope,'synthetic/object.json'),metadata={scope:'synthetic test'};
  const built=S.buildState({pins:f.p,datasetId:context.dataset_id,sequence:'1',auditManifest:a.envelope.manifest,ownerPublicKey:a.publicKey,metadata,payloadDescriptors:[descriptor],previousCommitment:S.ZERO});
  f.n.head={sequence:'1',commitment:built.commitment};
  const client=new Stage1Client({state:built.state,envelope:a.envelope,ownerPublicKey:a.publicKey,metadata,reader:f.reader,decryptionKey:key,sampleSize:1}),server=new audit.AuditServer(a.serverData),query=[[token]],answer=server.createAnswer(query),challenge=client.createChallenge(answer,query),proof=server.createProof(answer,query,challenge);
  let retrieved=false;
  await assert.rejects(client.verify(proof,[{descriptor,proof:built.payloadProofs[0]}],async()=>{retrieved=true;f.n.failures=Infinity;return envelope;}),e=>e instanceof RpcMethodError&&e.observation_attempts===3&&e.retry_events.length===3);
  assert(retrieved);assert.equal(f.n.calls.filter(c=>c.method==='eth_chainId').length,4);
});
