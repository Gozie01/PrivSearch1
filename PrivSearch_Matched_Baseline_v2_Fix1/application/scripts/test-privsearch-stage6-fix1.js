'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
const {Storage,CHUNK}=require('./privsearch/stage6-services-fix1');
async function stubbed(Client,fn,{insert=async()=>{}}={}){
 const load=Module._load;
 class MongoClient{async connect(){}db(){return {collection:name=>({insertOne:row=>insert(name,row)})};}async close(){}}
 Module._load=function(name,...args){if(name==='mongodb')return {MongoClient};if(name==='minio'&&Client)return {Client};return load.call(this,name,...args);};
 try{return await fn();}finally{Module._load=load;}
}
const config={mode:'live',mongoUri:'private-uri',mongoDb:'db',bucket:'existing',minio:{endPoint:'127.0.0.1',useSSL:false,accessKey:'private-access',secretKey:'private-secret'},runId:'new-unique-run'};
test('owner defers live storage connections until source extraction and cryptographic preparation finish',async()=>{
 const vm=require('node:vm'),order=[],events=[];let commands;
 class Store{async open(){order.push('storage_open');}async putObject(){order.push('object_put');}async putSnapshot(){order.push('snapshot_put');return {};}async close(){}}
 const deps={
  './stage4-ipc':{serve:c=>{commands=c;}},'./stage4-role':{audit:()=>({role:'owner'})},
  './stage6-services-fix1':{Storage:Store,reader:()=>({}),ownerChain:async()=>{order.push('chain_checks');return {};}},
  './stage6-data':{prepareSource:async()=>{order.push('source');return {publicPlan:{projected_keyword_assignments:1,catalog:[]},documents:[],words:[],reference:{},queries:[]};}},
  './stage1-state':require('./privsearch/stage1-state'),
  './stage3-encrypted-search':{generateKeys:()=>({KE:Buffer.alloc(32,1)}),Stage3Owner:class{prepare(){order.push('crypto');return {snapshot:{},objects:new Map([['new-key',Buffer.from('encrypted')]]),commitment:'public'};}}}
 };
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'privsearch/stage6-owner-fix1.js'),'utf8'),{require:n=>{assert(Object.hasOwn(deps,n),n);return deps[n];},process:{on:()=>{},send:m=>events.push(m)},performance,Buffer,setTimeout,setImmediate});
 await commands.boot({...config,pins:{}});assert.deepEqual(order,['chain_checks']);await commands.prepare();assert.deepEqual(order,['chain_checks','source','crypto','storage_open','object_put','snapshot_put']);assert(events.some(e=>e.event==='source_plan'));
});
test('ambiguous object completion retries the identical key and ciphertext, with fresh agents and bounded public evidence',async()=>{
 const attempts=[],clients=[],events=[];let calls=0;
 class Client{constructor(c){clients.push(c);this.c=c;}async bucketExists(){return true;}async putObject(bucket,key,b,size,metadata){attempts.push({bucket,key,b:Buffer.from(b),size,metadata});calls++;if(calls<3)throw Object.assign(new Error('private endpoint https://secret.invalid/token'),{code:calls===1?'ECONNRESET':'EPIPE'});}}
 await stubbed(Client,async()=>{const s=new Storage(config,p=>events.push(p)),bytes=Buffer.from('exact encrypted envelope');try{await s.open();await s.putObject('fresh/key',bytes);assert.equal(calls,3);assert.equal(clients.length,3);for(const a of attempts){assert.equal(a.bucket,'existing');assert.equal(a.key,'fresh/key');assert.deepEqual(a.b,bytes);assert.equal(a.size,bytes.length);}assert.equal(s.publication.object_count,1);assert.equal(s.publication.object_retry_count,2);assert.equal(s.publication.object_put_attempts,3);assert.deepEqual(events.filter(p=>p.outcome==='retry_scheduled').map(p=>p.wrapper_attempt),[1,2]);assert(!JSON.stringify(events).includes('private'));assert.equal(clients[0].transportAgent.options.keepAlive,true);assert.notEqual(clients[0].transportAgent,clients[1].transportAgent);}finally{await s.close();}});
});
test('persistent connection resets stop after three wrapper attempts without publishing a snapshot',async()=>{
 let calls=0,inserts=0;const events=[];
 class Client{async bucketExists(){return true;}async putObject(){calls++;throw Object.assign(new Error('socket hang up'),{code:'ECONNRESET'});}}
 await stubbed(Client,async()=>{const s=new Storage(config,p=>events.push(p));try{await s.open();await assert.rejects(s.putObject('fresh',Buffer.from('ciphertext')),e=>e.code==='ECONNRESET');assert.equal(calls,3);assert.equal(inserts,0);assert.equal(s.publication.object_count,0);assert.equal(events.at(-1).outcome,'failed');assert.equal(events.at(-1).wrapper_attempt,3);}finally{await s.close();}},{insert:async()=>{inserts++;}});
});
test('authorization, validation and unrecognized errors are never retried',async()=>{
 for(const code of ['AccessDenied','InvalidArgument','EUNKNOWN',undefined]){let calls=0;
  class Client{async bucketExists(){return true;}async putObject(){calls++;throw Object.assign(new Error('socket hang up'),{code});}}
  await stubbed(Client,async()=>{const s=new Storage(config);try{await s.open();await assert.rejects(s.putObject('fresh',Buffer.from('ciphertext')));assert.equal(calls,1);assert.equal(s.publication.object_retry_count,0);}finally{await s.close();}});
 }
});
test('snapshot chunks retain metadata-last publication; ambiguous database inserts are not retried',async()=>{
 class Client{async bucketExists(){return true;}}
 const rows=[],events=[];
 await stubbed(Client,async()=>{const s=new Storage(config,p=>events.push(p));try{await s.open();const result=await s.putSnapshot('1',{encrypted:true,padding:'x'.repeat(CHUNK+50)});assert.equal(result.mongodb_chunk_count,2);assert.deepEqual(rows.map(r=>r.name),['privsearch_stage6_snapshot_chunks','privsearch_stage6_snapshot_chunks','privsearch_stage6_snapshots']);assert.equal(events.at(-1).step,'publication_complete');}finally{await s.close();}},{insert:async(name,row)=>rows.push({name,row})});
 let calls=0;await stubbed(Client,async()=>{const s=new Storage(config);try{await s.open();await assert.rejects(s.putSnapshot('1',{encrypted:true}),e=>e.code==='ECONNRESET');assert.equal(calls,1);assert.equal(s.publication.step,'mongodb_snapshot_chunk_insert');}finally{await s.close();}},{insert:async()=>{calls++;throw Object.assign(new Error('ambiguous insert'),{code:'ECONNRESET'});}});
});
test('MinIO 7-compatible installed SDK recovers a real HTTP socket reset with identical signed PUT bodies',async()=>{
 const bodies=[],sockets=[];const crypto=require('node:crypto');
 const server=http.createServer(async(req,res)=>{if(req.method==='HEAD'){res.writeHead(200);res.end();return;}if(req.method!=='PUT'){res.writeHead(500);res.end();return;}const pieces=[];for await(const b of req)pieces.push(b);bodies.push(Buffer.concat(pieces));sockets.push(req.socket);if(bodies.length===1)req.socket.destroy();else{res.writeHead(200,{ETag:'"'+crypto.createHash('md5').update(bodies.at(-1)).digest('hex')+'"'});res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await stubbed(null,async()=>{const s=new Storage({...config,minio:{...config.minio,port:server.address().port,region:'us-east-1'}});try{await s.open();const bytes=Buffer.from('identical encrypted HTTP body');await s.putObject('fresh',bytes);assert.equal(bodies.length,2);assert.deepEqual(bodies,[bytes,bytes]);assert.notEqual(sockets[0],sockets[1]);assert.equal(s.publication.object_retry_count,1);}finally{await s.close();}});}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('fixed owner and coordinator complete both process benchmarks with early source plans, publication counters and unchanged verification',async()=>{
 const child=spawn(process.execPath,[path.join(__dirname,'benchmark-privsearch-stage6-fix1.js'),'--simulation'],{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('Stage6 fix simulation timeout'));},120000);child.once('error',reject);child.once('exit',n=>{clearTimeout(timer);resolve(n);});});assert.equal(code,0,output);
 const out=output.match(/STAGE6_REPORT_DIRECTORY: (.+)/)[1].trim();try{const s=JSON.parse(fs.readFileSync(path.join(out,'summary.json')));assert.equal(s.publication_fix,'6.0.1');assert.equal(s.status,'STAGE6_PROCESS_SIMULATION_PASSED');assert.equal(s.datasets.length,2);assert.equal(s.receipts.length,2);assert.equal(s.rows.length,82);assert(s.rows.every(r=>r.accepted&&r.exact_reference_match));assert(s.owned_children_cleanup_completed);for(const kind of ['healthcare','enron']){const p=s.publication_progress[kind];assert.equal(p.step,'publication_complete');assert(p.object_count>0);assert.equal(p.object_count,p.object_put_attempts);assert.equal(p.object_retry_count,0);assert(fs.existsSync(path.join(out,kind+'_catalog.csv')));}assert(s.datasets.every(d=>d.setup_status==='published'));assert(!JSON.stringify(s).includes('private-stage6-sim-document'));}finally{fs.rmSync(out,{recursive:true,force:true});}
});
