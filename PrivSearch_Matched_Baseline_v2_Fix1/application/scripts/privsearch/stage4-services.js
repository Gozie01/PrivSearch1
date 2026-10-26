'use strict';
const fs=require('node:fs'),path=require('node:path');
const S=require('./stage1-state'),{ABI,RpcTransport,IndependentStateReader}=require('./stage1-chain-reader');
const {buffer}=require('node:stream/consumers');
function atomic(file,value) {fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(value));fs.renameSync(temp,file);}
function read(file) {return JSON.parse(fs.readFileSync(file,'utf8'));}
class Storage {
  constructor(config) {this.c=config;}
  async open() {
    if(this.c.mode==='simulation'){fs.mkdirSync(this.c.publicDirectory,{recursive:true});return;}
    const {MongoClient}=require('mongodb'),{Client}=require('minio');this.mongo=new MongoClient(this.c.mongoUri,{serverSelectionTimeoutMS:10000});await this.mongo.connect();this.collection=this.mongo.db(this.c.mongoDb).collection('privsearch_stage4_states');this.minio=new Client(this.c.minio);S.check(await this.minio.bucketExists(this.c.bucket),'Existing MinIO bucket required');
  }
  file(name) {return path.join(this.c.publicDirectory,name);}
  async putSnapshot(sequence,snapshot) {if(this.c.mode==='simulation')atomic(this.file('snapshot-'+sequence+'.json'),snapshot);else await this.collection.insertOne({run_id:this.c.runId,sequence,...snapshot});}
  async snapshot(sequence) {S.check(['1','2'].includes(sequence),'Stage4 unknown snapshot sequence');return this.c.mode==='simulation'?read(this.file('snapshot-'+sequence+'.json')):this.collection.findOne({run_id:this.c.runId,sequence});}
  async putObject(key,bytes) {if(this.c.mode==='simulation'){const file=this.file('objects/'+S.sha(Buffer.from(key))+'.bin');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}else await this.minio.putObject(this.c.bucket,key,bytes,bytes.length,{'content-type':'application/json'});}
  async object(key) {return this.c.mode==='simulation'?fs.readFileSync(this.file('objects/'+S.sha(Buffer.from(key))+'.bin')):buffer(await this.minio.getObject(this.c.bucket,key));}
  async close() {if(this.mongo)await this.mongo.close();}
}
function simulationBlock(height,pins) {return {number:'0x'+height.toString(16),hash:'0x'+(height===0n?pins.genesisHash:S.hash('stage4-simulated-block',height.toString())),timestamp:'0x1'};}
class SimulationRpc {
  constructor(config) {this.c=config;}
  async send(method,params) {
    const chain=read(path.join(this.c.publicDirectory,'chain.json')),p=this.c.pins;
    if(method==='eth_chainId')return '0x'+BigInt(p.chainId).toString(16);
    if(method==='eth_getBlockByNumber'){const n=params[0]==='latest'?BigInt(chain.height):BigInt(params[0]);return simulationBlock(n,p);}
    if(method==='eth_getCode')return '0x6000';
    if(method==='eth_call'){
      if(params[0].data==='OWNER')return p.owner;
      const selector=params[1],height=typeof selector==='object'?Object.keys(chain.history).find(h=>simulationBlock(BigInt(h),p).hash===selector.blockHash):BigInt(selector).toString();
      return chain.history[height]||{sequence:'0',commitment:S.ZERO};
    }
    throw new Error('Stage4 unsupported simulated RPC method');
  }
}
function reader(config) {
  if(config.mode==='simulation')return new IndependentStateReader(config.pins,new SimulationRpc(config),{encodeOwner:()=> 'OWNER',decodeOwner:v=>v,encodeState:()=> 'STATE',decodeState:v=>v},{retryDelayMs:0});
  return new IndependentStateReader(config.pins,new RpcTransport(config.clientRpc));
}
async function ownerChain(config) {
  if(config.mode==='simulation') {
    const file=path.join(config.publicDirectory,'chain.json');if(!fs.existsSync(file))atomic(file,{height:'1',history:{'1':{sequence:'0',commitment:S.ZERO}}});
    return {async anchor(candidate){const old=read(file),head=old.history[old.height];S.check(BigInt(candidate.snapshot.state.sequence)===BigInt(head.sequence)+1n&&candidate.snapshot.state.previous_commitment===head.commitment,'Simulated anchor CAS mismatch');const height=(BigInt(old.height)+1n).toString(),commitment=candidate.commitment;old.height=height;old.history[height]={sequence:candidate.snapshot.state.sequence,commitment};atomic(file,old);return {transaction_hash:'0x'+S.hash('stage4-simulated-tx',[height,commitment]),gas_used:'0',receipt_block:Number(height),simulated:true};},async close(){}};
  }
  const {ethers}=require('ethers'),provider=new ethers.JsonRpcProvider(config.ownerRpc),wallet=new ethers.Wallet(config.signer,provider),rpc=new RpcTransport(config.ownerRpc);
  S.check(wallet.address.toLowerCase()===config.pins.owner.toLowerCase(),'Owner signer differs from pin');S.check(BigInt(await rpc.send('eth_chainId',[]))===BigInt(config.pins.chainId),'Owner chain mismatch');S.check((await rpc.send('eth_getBlockByNumber',['0x0',false])).hash.toLowerCase()==='0x'+config.pins.genesisHash,'Owner genesis mismatch');
  const contract=new ethers.Contract(config.pins.contract,ABI,wallet),code=await rpc.send('eth_getCode',[config.pins.contract,'latest']);S.check(S.sha(Buffer.from(code.slice(2),'hex'))===config.pins.codeHash&&(await contract.owner()).toLowerCase()===config.pins.owner.toLowerCase(),'Owner code/authority mismatch');S.check((await contract.getState('0x'+config.datasetId))[0]===0n,'Stage4 dataset namespace already used');
  return {async anchor(candidate){const overrides={};if(config.gasPrice)overrides.gasPrice=BigInt(config.gasPrice);const s=candidate.snapshot.state,tx=await contract.anchorState('0x'+s.dataset_id,BigInt(s.sequence),'0x'+candidate.commitment,'0x'+s.previous_commitment,overrides),r=await tx.wait();S.check(r?.status===1,'Owner anchor failed');return {transaction_hash:tx.hash,gas_used:r.gasUsed.toString(),receipt_block:r.blockNumber,simulated:false};},async close(){provider.destroy();}};
}
module.exports={Storage,reader,ownerChain,atomic};
