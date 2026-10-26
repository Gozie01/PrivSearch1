'use strict';
const {performance}=require('node:perf_hooks');
const {check,hex,commitment,validateState,sha}=require('./stage1-state');
const ABI=['function owner() view returns (address)','function getState(bytes32) view returns (uint64 sequence, bytes32 commitment)','function anchorState(bytes32,uint64,bytes32,bytes32)'];
function quantity(v) { check(typeof v==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(v),'Invalid RPC quantity');return BigInt(v); }
class UnavailableBlockError extends Error {
  constructor(stage,selector) { super('Block unavailable');this.code='RPC_BLOCK_UNAVAILABLE';this.stage=stage;this.selector=selector; }
}
function block(v,{stage='unspecified',selector=null}={}) {
  if(v===null)throw new UnavailableBlockError(stage,selector);
  check(v&&typeof v==='object'&&!Array.isArray(v),'Invalid block response');
  quantity(v.number);hex(v.hash?.slice(2));check(v.hash.startsWith('0x'),'Invalid block hash');quantity(v.timestamp);return v;
}
function normalizeAddress(a) { check(typeof a==='string'&&/^0x[0-9a-fA-F]{40}$/.test(a),'Invalid pinned address');return a.toLowerCase(); }
function safeRpcMessage(value) { return String(value||'').replace(/https?:\/\/\S+/gi,'[endpoint]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,1000); }
class RpcMethodError extends Error {
  constructor(method,error,selector) {
    const message=safeRpcMessage(error.message);
    super('RPC method rejected: '+method+' (code '+error.code+')'+(message?': '+message:''));
    this.code=error.code;this.rpc_method=method;this.provider_message=message;this.selector=selector;this.stage='rpc-'+method;
  }
}
// Only the observed canonical-hash availability error is retryable. Every
// retry restarts the entire pinned observation; no cached state is released.
function missingCanonicalHeader(error) {
  const s=error.selector;
  return error instanceof RpcMethodError&&error.code===-32000&&
    ['eth_getCode','eth_call'].includes(error.rpc_method)&&
    error.provider_message.trim().toLowerCase()==='header for hash not found'&&
    s&&typeof s==='object'&&!Array.isArray(s)&&s.requireCanonical===true&&
    typeof s.blockHash==='string'&&/^0x[0-9a-fA-F]{64}$/.test(s.blockHash);
}
class RpcTransport {
  constructor(url,{timeoutMs=15000}={}) {
    const u=new URL(url);check(['https:','http:'].includes(u.protocol),'HTTP(S) RPC required');
    this.url=url;this.timeoutMs=timeoutMs;this.nextId=1;
  }
  async send(method,params) {
    const id=this.nextId++;
    let response;
    try { response=await fetch(this.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(this.timeoutMs)}); }
    catch { throw new Error('RPC transport unavailable for '+method); }
    check(response.ok,'RPC HTTP failure for '+method);
    const raw=await response.text();check(Buffer.byteLength(raw)<1024*1024,'Oversized RPC response');
    let value;try {value=JSON.parse(raw);}catch{throw new Error('Invalid RPC JSON for '+method);}
    check(value.jsonrpc==='2.0'&&value.id===id,'RPC response identity mismatch');
    if(value.error)throw new RpcMethodError(method,value.error,['eth_getCode','eth_call'].includes(method)?params[1]:method==='eth_getBlockByNumber'?params[0]:null);
    check(Object.hasOwn(value,'result'),'RPC result missing');return value.result;
  }
}
function ethersCodec() {
  const {Interface}=require('ethers'),iface=new Interface(ABI);
  return {encodeOwner:()=>iface.encodeFunctionData('owner'),decodeOwner:v=>iface.decodeFunctionResult('owner',v)[0],
    encodeState:id=>iface.encodeFunctionData('getState',['0x'+id]),decodeState:v=>{const r=iface.decodeFunctionResult('getState',v);return {sequence:r[0].toString(),commitment:r[1].slice(2).toLowerCase()};}};
}
async function selectedBlock(rpc,policy) {
  check(policy&&['finalized','confirmations'].includes(policy.kind),'Explicit finality policy required');
  if(policy.kind==='finalized') return block(await rpc.send('eth_getBlockByNumber',['finalized',false]),{stage:'select-finalized',selector:'finalized'});
  check(Number.isSafeInteger(policy.depth)&&policy.depth>=1&&policy.depth<=100000,'Invalid confirmation depth');
  const latest=block(await rpc.send('eth_getBlockByNumber',['latest',false]),{stage:'select-latest',selector:'latest'}),height=quantity(latest.number)-BigInt(policy.depth-1);
  check(height>=0n,'Insufficient chain depth');
  if(policy.depth===1)return latest;
  const selector='0x'+height.toString(16);
  return block(await rpc.send('eth_getBlockByNumber',[selector,false]),{stage:'select-confirmation-depth',selector});
}
class IndependentStateReader {
  #pins;#rpc;#codec;#watermarks=new Map();#maxBlockAttempts;#retryDelayMs;
  constructor(pins,rpc,codec=ethersCodec(),{maxBlockAttempts=3,retryDelayMs=250}={}) {
    const copy=JSON.parse(JSON.stringify(pins));
    copy.contract=normalizeAddress(copy.contract);copy.owner=normalizeAddress(copy.owner);hex(copy.codeHash);hex(copy.genesisHash.replace(/^0x/,''));
    check(/^[1-9]\d*$/.test(String(copy.chainId)),'Invalid pinned chain');
    check(['number-checked','eip1898'].includes(copy.blockSelector),'Explicit block selector policy required');
    check(copy.finality&&['finalized','confirmations'].includes(copy.finality.kind),'Explicit finality policy required');
    check(Number.isSafeInteger(maxBlockAttempts)&&maxBlockAttempts>=1&&maxBlockAttempts<=5,'Invalid block retry limit');
    check(Number.isSafeInteger(retryDelayMs)&&retryDelayMs>=0&&retryDelayMs<=2000,'Invalid block retry delay');
    this.#pins=copy;this.#rpc=rpc;this.#codec=codec;this.#maxBlockAttempts=maxBlockAttempts;this.#retryDelayMs=retryDelayMs;
  }
  async observe(state) {
    const start=performance.now(),events=[];let calls=0;
    const rpc={send:(method,params)=>{calls++;return this.#rpc.send(method,params);}};
    for(let attempt=1;attempt<=this.#maxBlockAttempts;attempt++) {
      try {
        const result=await this.#observeOnce(state,rpc);
        return {...result,blockchain_verification_ms:performance.now()-start,rpc_calls:calls,observation_attempts:attempt,retry_events:events};
      } catch(error) {
        error.observation_attempts=attempt;error.retry_events=events.slice();error.rpc_calls=calls;error.blockchain_verification_ms=performance.now()-start;
        const nullBlock=error instanceof UnavailableBlockError;
        if(!nullBlock&&!missingCanonicalHeader(error))throw error;
        events.push(nullBlock?{attempt,stage:error.stage,selector:error.selector,reason:'RPC returned null block'}:
          {attempt,stage:error.stage,selector:JSON.parse(JSON.stringify(error.selector)),reason:'Canonical block header unavailable',rpc_method:error.rpc_method,code:error.code,provider_message:error.provider_message});
        if(attempt===this.#maxBlockAttempts) {
          error.observation_attempts=attempt;error.retry_events=events;error.rpc_calls=calls;error.blockchain_verification_ms=performance.now()-start;throw error;
        }
        if(this.#retryDelayMs)await new Promise(resolve=>setTimeout(resolve,this.#retryDelayMs));
      }
    }
  }
  async #observeOnce(state,rpc) {
    const p=this.#pins;validateState(state);
    check(state.chain_id===String(p.chainId)&&state.genesis_hash===p.genesisHash.replace(/^0x/,'').toLowerCase(),'State network binding mismatch');
    check('0x'+state.contract===p.contract&&'0x'+state.owner===p.owner,'State authority binding mismatch');
    const chain=quantity(await rpc.send('eth_chainId',[]));check(chain===BigInt(p.chainId),'RPC chain ID mismatch');
    const genesis=block(await rpc.send('eth_getBlockByNumber',['0x0',false]),{stage:'genesis',selector:'0x0'});check(genesis.hash.toLowerCase()===('0x'+state.genesis_hash),'Genesis mismatch');
    const selected=await selectedBlock(rpc,p.finality),height=quantity(selected.number);
    const old=this.#watermarks.get(state.dataset_id);
    if(old) {check(height>=BigInt(old.blockNumber),'Observed chain rollback');if(height===BigInt(old.blockNumber))check(selected.hash===old.blockHash,'Conflicting observed block');}
    const selector=p.blockSelector==='eip1898'?{blockHash:selected.hash,requireCanonical:true}:selected.number;
    const code=await rpc.send('eth_getCode',[p.contract,selector]);
    check(typeof code==='string'&&/^0x(?:[0-9a-fA-F]{2})+$/.test(code),'State contract code unavailable');
    check(sha(Buffer.from(code.slice(2),'hex'))===p.codeHash,'State contract code differs from pin');
    const owner=normalizeAddress(this.#codec.decodeOwner(await rpc.send('eth_call',[{to:p.contract,data:this.#codec.encodeOwner()},selector])));
    check(owner===p.owner,'On-chain owner mismatch');
    const head=this.#codec.decodeState(await rpc.send('eth_call',[{to:p.contract,data:this.#codec.encodeState(state.dataset_id)},selector]));
    check(typeof head.sequence==='string'&&/^(0|[1-9]\d*)$/.test(head.sequence),'Invalid head sequence');hex(head.commitment);
    const after=block(await rpc.send('eth_getBlockByNumber',[selected.number,false]),{stage:'confirm-block',selector:selected.number});check(after.hash===selected.hash,'Block changed during state read');
    if(old) {check(BigInt(head.sequence)>=BigInt(old.sequence),'Observed state rollback');if(head.sequence===old.sequence)check(head.commitment===old.commitment,'Conflicting observed state');}
    // Record a newer authoritative head even when the supplied response is stale.
    this.#watermarks.set(state.dataset_id,{blockNumber:height.toString(),blockHash:selected.hash,sequence:head.sequence,commitment:head.commitment});
    check(head.sequence===state.sequence,'Response is not latest visible anchored sequence');
    check(head.commitment===commitment(state),'Response commitment differs from authoritative head');
    return {verified:true,sequence:head.sequence,commitment:head.commitment,block_number:height.toString(),block_hash:selected.hash,finality:JSON.parse(JSON.stringify(p.finality)),block_selector:p.blockSelector};
  }
}
module.exports={ABI,RpcTransport,ethersCodec,selectedBlock,IndependentStateReader,UnavailableBlockError,RpcMethodError,safeRpcMessage,quantity,block};
