'use strict';
const http=require('node:http'),S=require('./stage1-state'),P=require('./stage9-encrypted-search'),B=require('./stage13-hardened-basic'),X=require('./stage14-boundary'),{Storage}=require('./stage6-services'),{serve}=require('./stage4-ipc'),{audit}=require('./stage4-role'),T=require('./stage4-transport'),{makePage}=require('./stage9-batch');
const FAULTS=['none','omission','false_empty','payload_ciphertext','payload_swap','payload_locator','payload_revision','payload_proof','batch_drop','batch_reorder','http_identity','rpc_first_unavailable','rpc_release_unavailable','rpc_wrong_chain','rpc_missing_header'];
let config,storage,server,snapshot,ps,basic,fault='none',stopping=false;const sessions=new Map();process.on('disconnect',()=>{if(!stopping)process.exit(1);});
async function operation(endpoint,args){
 if(endpoint==='search'){
  S.exact(args,['profile','request']);S.check(X.PROFILES.includes(args.profile),'Stage14 unknown profile');if(!snapshot){snapshot=await storage.snapshot('1');S.check(snapshot.schema===X.SCHEMA,'Stage14 snapshot schema');ps=new P.Stage3Server(snapshot.privsearch);basic=new B.Server(snapshot.basic);}
  let response=args.profile==='privsearch'?ps.search(args.request):basic.search(args.request);
  if(fault==='omission'||fault==='false_empty'){if(args.profile==='privsearch'){if(fault==='omission')response.clauses[0].matches.pop();else response.clauses[0].matches=[];}else{if(fault==='omission')response.rows.pop();else response.rows=[];}}
  for(const [id,s] of sessions)if(Date.now()-s.created>1800000)sessions.delete(id);S.check(sessions.size<16,'Stage14 session limit');const session_id=require('node:crypto').randomBytes(24).toString('hex');sessions.set(session_id,{profile:args.profile,created:Date.now()});return {session_id,response};
 }
 S.check(typeof args.session_id==='string'&&sessions.has(args.session_id),'Stage14 unknown session');const session=sessions.get(args.session_id);
 if(endpoint==='close'){S.exact(args,['session_id']);sessions.delete(args.session_id);return {closed:true};}
 if(endpoint==='prove'){S.exact(args,['session_id','proof_request']);S.check(session.profile==='privsearch','Stage14 proof route profile');return ps.proveRows(args.proof_request);}
 if(endpoint==='payloads'){
  S.exact(args,['session_id','handles']);const page=await makePage(args.handles,async handle=>{const packet=ps.locate(handle);let bytes=await storage.object(packet.descriptor.object_key);
   if(fault==='payload_ciphertext'){const e=JSON.parse(bytes);e.tag_hex='0'.repeat(32);bytes=Buffer.from(JSON.stringify(e));}
   if(fault==='payload_swap'){const d=snapshot.privsearch.payloads.find(d=>d.context.document_id!==handle);S.check(d,'Stage14 swap prerequisite');bytes=await storage.object(d.object_key);}
   if(fault==='payload_locator')packet.descriptor.object_key='substituted';if(fault==='payload_revision')packet.descriptor.context.revision='2';if(fault==='payload_proof')packet.proof.count++;
   return {handle,packet,ciphertext_b64:bytes.toString('base64')};});
  if(fault==='batch_drop')page.items.pop();if(fault==='batch_reorder')page.items.reverse();return page;
 }
 throw new Error('Stage14 HTTP operation unknown');
}
serve({async boot(c){config=c;S.exact(c,c.mode==='simulation'?['mode','publicDirectory','runId','token']:['mode','mongoUri','mongoDb','minio','bucket','runId','token']);storage=new Storage(c);await storage.open();
 server=http.createServer(async(req,res)=>{let id=null;try{S.check(req.method==='POST'&&/^\/(search|prove|payloads|close)$/.test(req.url),'Stage14 HTTP route');S.check(T.authEqual(req.headers.authorization,c.token),'Stage14 unauthorized');const packet=JSON.parse((await T.bounded(req)).toString('utf8'));S.exact(packet,['id','args']);S.check(Number.isSafeInteger(packet.id)&&packet.id>0,'Stage14 HTTP id');id=packet.id;const result=await operation(req.url.slice(1),packet.args),bytes=Buffer.from(JSON.stringify({id:fault==='http_identity'?id+1:id,server_pid:process.pid,result}));S.check(bytes.length<=T.MAX_BYTES,'STAGE14_RESPONSE_BODY_SIZE_LIMIT:'+bytes.length);res.setHeader('Content-Type','application/json');res.end(bytes);}catch(e){res.statusCode=400;res.end(JSON.stringify({id,server_pid:process.pid,error:{message:T.safeMessage(e)}}));}});
 server.requestTimeout=30000;server.headersTimeout=10000;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return {...audit('server',['public-both-profile-search-structures','shared-encrypted-storage-read','no-signer-client-keys-or-RPC-endpoint','loopback-search']),url:'http://127.0.0.1:'+server.address().port+'/'};
 },async fault({name}){S.check(FAULTS.includes(name),'Stage14 fault unknown');sessions.clear();fault=name;return {configured:true};},
 async shutdown(){stopping=true;sessions.clear();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}if(storage)await storage.close();snapshot=undefined;config=undefined;setImmediate(()=>process.exit(0));return {closed:true};}});
module.exports={FAULTS};
