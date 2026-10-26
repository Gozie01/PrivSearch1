'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('./privsearch/stage1-state');
const {IndependentStateReader}=require('./privsearch/stage1-chain-reader');
function fixture(kind='finalized') {
  const p={chainId:'900520900520',genesisHash:'a'.repeat(64),contract:'0x'+'b'.repeat(40),owner:'0x'+'c'.repeat(40),codeHash:S.sha(Buffer.from('6000','hex')),finality:kind==='finalized'?{kind}:{kind,depth:1},blockSelector:'number-checked'};
  const state={schema:S.SCHEMA,chain_id:p.chainId,genesis_hash:p.genesisHash,contract:p.contract.slice(2),owner:p.owner.slice(2),dataset_id:'d'.repeat(64),sequence:'1',snapshot_version:'retry-test',index_snapshot_digest:'1'.repeat(64),owner_signing_key_digest:'2'.repeat(64),parameters_digest:'3'.repeat(64),authentication_root:'4'.repeat(64),coverage_root:'5'.repeat(64),metadata_digest:'6'.repeat(64),payload_root:'7'.repeat(64),posting_count:1,payload_count:1,previous_commitment:S.ZERO};
  const n={calls:[],head:{sequence:'1',commitment:S.commitment(state)},nullMode:null,nullCount:0,malformed:false,reorg:false,badOwner:false,unsupported:false};
  const codec={encodeOwner:()=> 'OWNER',decodeOwner:v=>v,encodeState:()=> 'STATE',decodeState:v=>v};
  const rpc={async send(method,params){
    n.calls.push({method,params});
    if(method==='eth_chainId')return '0x'+BigInt(p.chainId).toString(16);
    if(method==='eth_getCode')return '0x6000';
    if(method==='eth_call')return params[0].data==='OWNER'?(n.badOwner?'0x'+'f'.repeat(40):p.owner):{...n.head};
    if(method==='eth_getBlockByNumber'){
      const tag=params[0];if(tag==='finalized'&&n.unsupported)throw new Error('RPC method rejected: eth_getBlockByNumber (code -32000)');
      if(tag==='finalized'&&n.nullMode==='always')return null;
      if(tag==='0x10'&&n.nullMode==='once'&&n.nullCount++===0)return null;
      if(tag==='finalized'&&n.malformed)return {number:'broken',hash:'0x'+'e'.repeat(64),timestamp:'0x1'};
      return {number:tag==='0x0'?'0x0':'0x10',hash:'0x'+(tag==='0x0'?p.genesisHash:n.reorg&&tag==='0x10'?'f'.repeat(64):'e'.repeat(64)),timestamp:'0x1'};
    }
    throw new Error('Unexpected RPC');
  }};
  return {p,state,n,codec,rpc,reader:new IndependentStateReader(p,rpc,codec,{maxBlockAttempts:3,retryDelayMs:0})};
}
test('one null block triggers a complete fresh observation with accurate calls and retry evidence',async()=>{
  const f=fixture();f.n.nullMode='once';const r=await f.reader.observe(f.state);assert(r.verified);assert.equal(r.observation_attempts,2);assert.equal(r.rpc_calls,14);assert.equal(f.n.calls.filter(c=>c.method==='eth_chainId').length,2);assert.deepEqual(r.retry_events,[{attempt:1,stage:'confirm-block',selector:'0x10',reason:'RPC returned null block'}]);
});
test('persistent null blocks stop after three attempts and release no verified result',async()=>{
  const f=fixture();f.n.nullMode='always';await assert.rejects(f.reader.observe(f.state),e=>e.code==='RPC_BLOCK_UNAVAILABLE'&&e.observation_attempts===3&&e.rpc_calls===9&&e.retry_events.length===3);assert.equal(f.n.calls.length,9);
});
test('unsupported tags, malformed responses, changed block and wrong owner are never retried',async()=>{
  for(const field of ['unsupported','malformed','reorg','badOwner']){const f=fixture();f.n[field]=true;await assert.rejects(f.reader.observe(f.state),e=>e.observation_attempts===1&&e.retry_events.length===0);assert.equal(f.n.calls.filter(c=>c.method==='eth_chainId').length,1);}
});
test('fresh retries reject a newer authoritative head instead of reusing an older cached root',async()=>{
  const f=fixture();f.n.nullMode='once';const send=f.rpc.send.bind(f.rpc);f.rpc.send=async(m,p)=>{const r=await send(m,p);if(r===null)f.n.head={sequence:'2',commitment:'f'.repeat(64)};return r;};
  await assert.rejects(f.reader.observe(f.state),e=>/latest visible/.test(e.message)&&e.observation_attempts===2&&e.retry_events.length===1);
  f.n.nullMode=null;f.n.head={sequence:'1',commitment:S.commitment(f.state)};await assert.rejects(f.reader.observe(f.state),/rollback/);
});
test('depth one reuses the selected latest header, then still checks that same block hash after all calls',async()=>{
  const f=fixture('confirmations'),r=await f.reader.observe(f.state);assert(r.verified);assert.equal(r.rpc_calls,7);assert.equal(f.n.calls.filter(c=>c.method==='eth_getBlockByNumber'&&c.params[0]==='0x10').length,1);assert.equal(r.finality.depth,1);
});
