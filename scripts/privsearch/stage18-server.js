'use strict';
const http=require('node:http'),fs=require('node:fs'),I=require('./stage4-ipc'),T=require('./stage4-transport'),S=require('./stage1-state'),X=require('./stage17-isolated-boundary'),B=require('./stage9-batch'),{Storage}=require('./stage15-services-fix1');
let store,core,service,ready=false,token;
const stats={snapshot_reads:0,object_gets:0,object_bytes:0,searches:0,payload_pages:0};
async function close(){ready=false;try{if(service){service.closeAllConnections();await new Promise(r=>service.close(r));service=null;}}finally{if(store){await store.close();store=null;}}}
I.serve({async boot(c){
 S.check(!store,'Stage18 server already booted');S.exact(c,['storage','profile','snapshot_sha256','token']);S.exact(c.storage,c.storage.mode==='simulation'?['mode','publicDirectory','runId']:['mode','mongoUri','mongoDb','minio','bucket','runId']);S.check(['live','simulation'].includes(c.storage.mode),'Stage18 storage mode');
 token=c.token;S.check(typeof token==='string'&&token.length>=32,'Stage18 capability');store=new Storage(c.storage);await store.open();
 const snapshot=await store.snapshot('1');stats.snapshot_reads++;S.check(S.sha(Buffer.from(JSON.stringify(snapshot)))===c.snapshot_sha256,'Stage18 published snapshot differs');X.validatePublic(snapshot);S.check(snapshot.profile===c.profile,'Stage18 profile substitution');core=X.server(snapshot);
 service=http.createServer(async(req,res)=>{let id=null;try{
  S.check(ready&&req.method==='POST'&&T.authEqual(req.headers.authorization,token),'Stage18 HTTP denied');const packet=JSON.parse((await T.bounded(req)).toString('utf8'));S.exact(packet,['id','args']);id=packet.id;S.check(Number.isSafeInteger(id)&&id>0,'Stage18 HTTP identity');let result;
  if(req.url==='/search'){const start=performance.now(),response=core.search(packet.args);stats.searches++;result={response,server_search_ms:performance.now()-start};}
  else if(req.url==='/payloads'){S.exact(packet.args,['handles']);result=await B.makePage(packet.args.handles,async handle=>{const packet=core.locate(handle),bytes=await store.object(packet.descriptor.object_key);stats.object_gets++;stats.object_bytes+=bytes.length;return {handle,packet,ciphertext_b64:bytes.toString('base64')};});stats.payload_pages++;}
  else throw new Error('Stage18 unknown HTTP endpoint');
  const body=Buffer.from(JSON.stringify({id,server_pid:process.pid,result}));S.check(body.length<=T.MAX_BYTES,'Stage18 HTTP response limit');res.setHeader('Content-Type','application/json');res.end(body);
 }catch(e){res.statusCode=400;res.end(JSON.stringify({id,server_pid:process.pid,error:{message:T.safeMessage(e)}}));}});
 service.headersTimeout=10000;service.requestTimeout=30000;await new Promise((resolve,reject)=>{service.once('error',reject);service.listen(0,'127.0.0.1',resolve);});ready=true;
 return {url:'http://127.0.0.1:'+service.address().port+'/',pid:process.pid,profile:c.profile,single_profile:true,public_only:true,storage_credentials_received:c.storage.mode==='live',search_or_decryption_keys_received:false,rpc_endpoint_received:false,cwd_has_env_file:fs.existsSync('.env'),sensitive_environment_names:Object.keys(process.env).filter(k=>/PRIVATE|SECRET|TOKEN|MONGO|MINIO|PURECHAIN|PRIVSEARCH/.test(k)),snapshot_bytes:store.stats.snapshot_bytes};
 },async audit(){return {...stats};},async shutdown(){await close();setTimeout(()=>process.exit(0),25);return {closed:true};}});
process.on('disconnect',()=>close().finally(()=>process.exit(0)));
