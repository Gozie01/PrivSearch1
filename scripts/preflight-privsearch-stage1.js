'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {RpcTransport,selectedBlock,quantity,block}=require('./privsearch/stage1-chain-reader');
const ROOT=path.resolve(__dirname,'..');
function envConfig() {
  require('dotenv').config({path:process.env.LIFEDB_ENV_PATH||path.join(ROOT,'.env')});
  const e=process.env;
  if(e.PRIVSEARCH_FINALITY_MODE&&!['finalized','confirmations'].includes(e.PRIVSEARCH_FINALITY_MODE))throw new Error('Unknown explicit finality mode');
  if(e.PRIVSEARCH_BLOCK_SELECTOR&&!['number-checked','eip1898'].includes(e.PRIVSEARCH_BLOCK_SELECTOR))throw new Error('Unknown block selector');
  if(e.PRIVSEARCH_FINALITY_MODE==='confirmations'&&(!Number.isSafeInteger(Number(e.PRIVSEARCH_FINALITY_DEPTH))||Number(e.PRIVSEARCH_FINALITY_DEPTH)<1||Number(e.PRIVSEARCH_FINALITY_DEPTH)>100000))throw new Error('Explicit valid confirmation depth required');
  return {clientRpc:e.PRIVSEARCH_CLIENT_RPC_URL||e.PURECHAIN_RPC_URL||'https://purechainnode.com',ownerRpc:e.PURECHAIN_RPC_URL||'https://purechainnode.com',
    chainId:e.PURECHAIN_CHAIN_ID||'900520900520',mongoUri:e.MONGODB_URI||'mongodb://localhost:27017/lifedb',mongoDb:e.MONGODB_DB||'lifedb',
    minio:{endPoint:e.MINIO_ENDPOINT||'localhost',port:Number(e.MINIO_PORT||9000),useSSL:e.MINIO_USE_SSL==='true',accessKey:e.MINIO_ACCESS_KEY||'minioadmin',secretKey:e.MINIO_SECRET_KEY||'minioadmin'},bucket:e.MINIO_BUCKET||'lifedb-files',
    finality:e.PRIVSEARCH_FINALITY_MODE==='confirmations'?{kind:'confirmations',depth:Number(e.PRIVSEARCH_FINALITY_DEPTH)}:{kind:'finalized'},
    blockSelector:e.PRIVSEARCH_BLOCK_SELECTOR||'number-checked'};
}
function reportPath(prefix) {
  const parent=path.join(ROOT,'Results','revision_v3');fs.mkdirSync(parent,{recursive:true});
  const directory=path.join(parent,prefix+'_'+new Date().toISOString().replace(/[:.]/g,'-')+'_'+crypto.randomUUID().slice(0,8));
  fs.mkdirSync(directory);return directory;
}
async function preflight() {
  const out=reportPath('stage1_preflight'),rows=[],c=envConfig();
  async function probe(name,fn) {try{const details=await fn();rows.push({name,ok:true,...details});}catch(err){rows.push({name,ok:false,error_code:typeof err.code==='string'||typeof err.code==='number'?err.code:null});}}
  await probe('installed_dependencies',async()=>{for(const m of ['ethers','mongodb','minio','hardhat'])require.resolve(m);return {};});
  await probe('audit_v2_modules',async()=>{require('./privsearch/audit-v2-protocol');require('./privsearch/audit-v2-batch-witness');return {};});
  let clientGenesis=null;
  await probe('client_chain_and_visibility_policy',async()=>{
    const rpc=new RpcTransport(c.clientRpc);const id=quantity(await rpc.send('eth_chainId',[]));if(id!==BigInt(c.chainId))throw new Error('Chain mismatch');
    const g=block(await rpc.send('eth_getBlockByNumber',['0x0',false]));clientGenesis=g.hash;
    const b=await selectedBlock(rpc,c.finality);return {chain_id:id.toString(),genesis_hash:g.hash,visible_block:b.number,visible_hash:b.hash,policy:c.finality,block_selector:c.blockSelector};
  });
  await probe('owner_client_network_agreement',async()=>{
    if(!clientGenesis)throw new Error('Client probe failed');const rpc=new RpcTransport(c.ownerRpc),id=quantity(await rpc.send('eth_chainId',[])),g=block(await rpc.send('eth_getBlockByNumber',['0x0',false]));
    if(id!==BigInt(c.chainId)||g.hash!==clientGenesis)throw new Error('Owner/client chain differs');return {};
  });
  await probe('mongodb_read_only_ping',async()=>{const {MongoClient}=require('mongodb'),m=new MongoClient(c.mongoUri,{serverSelectionTimeoutMS:10000});try{await m.connect();await m.db(c.mongoDb).command({ping:1});return {};}finally{await m.close();}});
  await probe('minio_existing_bucket',async()=>{const {Client}=require('minio'),m=new Client(c.minio);if(!await m.bucketExists(c.bucket))throw new Error('Bucket missing');return {};});
  rows.push({name:'owner_signer_configured',ok:Boolean(process.env.PURECHAIN_PRIVATE_KEY)});
  rows.push({name:'stage1_contract_artifact',ok:fs.existsSync(path.join(ROOT,'artifacts','contracts','PrivSearchStateAnchor.sol','PrivSearchStateAnchor.json')),required_for:'deploy/run only'});
  const required=rows.filter(r=>r.name!=='stage1_contract_artifact'&&r.name!=='owner_signer_configured');
  const report={status:required.every(r=>r.ok)?'STAGE1_READ_ONLY_PREFLIGHT_PASSED':'STAGE1_PREFLIGHT_BLOCKED',generated_at:new Date().toISOString(),checks:rows,
    writes_performed:'Only this report directory; no database writes, object uploads, deployments or transactions.',
    policy_note:c.finality.kind==='finalized'?'Finality tag is a trusted-RPC observation; the pilot is not a consensus light client.':'Confirmation-depth policy is provisional and must not be reported as deterministic finality.',
    endpoints_independently_configured:true,client_and_owner_same_url:c.clientRpc===c.ownerRpc};
  fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));console.log('PREFLIGHT_REPORT_DIRECTORY: '+out);
  if(report.status==='STAGE1_PREFLIGHT_BLOCKED')process.exitCode=1;
  return report;
}
if(require.main===module)preflight().catch(()=>{console.error('STAGE1_PREFLIGHT_FAILED: Check installed dependencies, .env configuration and service reachability. No credentials are printed.');process.exitCode=1;});
module.exports={ROOT,envConfig,reportPath,preflight};
