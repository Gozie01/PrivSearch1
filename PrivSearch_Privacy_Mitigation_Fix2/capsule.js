'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http'),{fork}=require('node:child_process'),{pipeline}=require('node:stream/promises'),{Readable,Transform}=require('node:stream');
const MAGIC=Buffer.from('PSCAP001'),AAD=Buffer.from('privsearch-private-replica-1'),MAX=1024*1024*1024;
function check(x,code){if(!x)throw Object.assign(Error(code),{code});}
function u64(n){const b=Buffer.alloc(8);b.writeBigUInt64BE(BigInt(n));return b;}
async function digest(file){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
async function seal(file,prepared){
  const key=crypto.randomBytes(32),nonce=crypto.randomBytes(12),snapshot=Buffer.from(JSON.stringify(prepared.snapshot));
  let plaintextBytes=1+8+snapshot.length+1;
  for(const [k,v] of prepared.objects)plaintextBytes+=1+8+Buffer.byteLength(k)+8+v.length;
  check(plaintextBytes+36<=MAX,'CAPSULE_SIZE_LIMIT');
  async function* frames(){yield Buffer.from([1]);yield u64(snapshot.length);yield snapshot;
    for(const [k,v] of prepared.objects){const kb=Buffer.from(k);yield Buffer.from([2]);yield u64(kb.length);yield kb;yield u64(v.length);for(let i=0;i<v.length;i+=1024*1024)yield v.subarray(i,i+1024*1024);}
    yield Buffer.from([0]);
  }
  const cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(AAD);
  const output=fs.createWriteStream(file,{flags:'wx',mode:0o600});output.write(Buffer.concat([MAGIC,nonce]));
  try{await pipeline(Readable.from(frames()),cipher,output,{end:false});output.end(cipher.getAuthTag());await new Promise((resolve,reject)=>{output.once('finish',resolve);output.once('error',reject);});}
  catch(e){output.destroy();throw e;}
  const bytes=fs.statSync(file).size;check(bytes===plaintextBytes+36,'CAPSULE_LENGTH');
  return {key,pin:{schema:'privsearch-private-replica-1',sha256:await digest(file),bytes,commitment:prepared.commitment},plaintextBytes,snapshotBytes:snapshot.length,objectBytes:[...prepared.objects.values()].reduce((n,b)=>n+b.length,0),objectCount:prepared.objects.size};
}
async function download(port,file,pin,{timeoutMs=180000}={}){
  check(Number.isSafeInteger(pin.bytes)&&pin.bytes>=36&&pin.bytes<=MAX,'CAPSULE_PIN_SIZE');
  const request=http.get({host:'127.0.0.1',port,path:'/snapshot',agent:false,headers:{Connection:'close'}});
  let timer;try{
    const response=await new Promise((resolve,reject)=>{timer=setTimeout(()=>request.destroy(Object.assign(Error('CAPSULE_DEADLINE'),{code:'CAPSULE_DEADLINE'})),timeoutMs);request.once('response',resolve);request.once('error',reject);});
    check(response.statusCode===200&&response.headers['content-length']===String(pin.bytes),'CAPSULE_HTTP_IDENTITY');
    const h=crypto.createHash('sha256');let count=0;
    const meter=new Transform({transform(b,enc,cb){count+=b.length;if(count>pin.bytes)cb(Object.assign(Error('CAPSULE_BODY_LIMIT'),{code:'CAPSULE_BODY_LIMIT'}));else{h.update(b);cb(null,b);}}});
    await pipeline(response,meter,fs.createWriteStream(file,{flags:'wx',mode:0o600}));
    const bodySha256=h.digest('hex');check(count===pin.bytes&&bodySha256===pin.sha256,'CAPSULE_PIN_MISMATCH');return {bytes:count,sha256:bodySha256};
  }finally{clearTimeout(timer);request.destroy();}
}
async function restore(file,key,pin){
  check(Buffer.isBuffer(key)&&key.length===32,'CAPSULE_KEY');
  check(fs.statSync(file).size===pin.bytes&&await digest(file)===pin.sha256,'CAPSULE_PIN_MISMATCH');
  const fd=fs.openSync(file,'r'),head=Buffer.alloc(20),tag=Buffer.alloc(16);
  try{check(fs.readSync(fd,head,0,20,0)===20&&head.subarray(0,8).equals(MAGIC),'CAPSULE_HEADER');check(fs.readSync(fd,tag,0,16,pin.bytes-16)===16,'CAPSULE_HEADER');}finally{fs.closeSync(fd);}
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,head.subarray(8));decipher.setAAD(AAD);decipher.setAuthTag(tag);
  const input=fs.createReadStream(file,{start:20,end:pin.bytes-17}),stream=input.pipe(decipher),it=stream[Symbol.asyncIterator]();
  input.on('error',e=>decipher.destroy(e));let current=Buffer.alloc(0),offset=0,readBytes=0;
  async function read(n){check(Number.isSafeInteger(n)&&n>=0&&n<=MAX,'CAPSULE_FRAME_LIMIT');const result=Buffer.alloc(n);let pos=0;
    while(pos<n){if(offset===current.length){const next=await it.next();check(!next.done,'CAPSULE_TRUNCATED');current=next.value;offset=0;}const take=Math.min(n-pos,current.length-offset);current.copy(result,pos,offset,offset+take);offset+=take;pos+=take;}
    readBytes+=n;check(readBytes<=MAX,'CAPSULE_FRAME_LIMIT');return result;
  }
  async function length(limit){const n=(await read(8)).readBigUInt64BE();check(n<=BigInt(limit),'CAPSULE_FRAME_LIMIT');return Number(n);}
  // This staging cache is never returned, queried or used for plaintext release before AEAD finalization.
  try{
    check((await read(1))[0]===1,'CAPSULE_FRAMING');const snapshot=JSON.parse((await read(await length(128*1024*1024))).toString('utf8')),objects=new Map();
    for(;;){const type=(await read(1))[0];if(type===0)break;check(type===2&&objects.size<100000,'CAPSULE_FRAMING');const k=(await read(await length(8192))).toString('utf8');check(k.length>0&&!objects.has(k),'CAPSULE_DUPLICATE_OBJECT');objects.set(k,await read(await length(512*1024*1024)));}
    check(offset===current.length,'CAPSULE_TRAILING_BYTES');const end=await it.next();check(end.done,'CAPSULE_TRAILING_BYTES');
    return {snapshot,objects,plaintextBytes:readBytes};
  }catch(e){stream.destroy();input.destroy();throw e;}
}
function safeEnv(){const env={};for(const k of ['PATH','Path','SystemRoot','SYSTEMROOT','TEMP','TMP'])if(process.env[k])env[k]=process.env[k];return env;}
async function startStore(file,cwd,{script=path.join(__dirname,'capsule-store.js'),graceMs=3000,killMs=3000}={}){
  // These storage children are services, not test workers. Never inherit test/debug/profile flags.
  const child=fork(script,[file],{cwd,execArgv:[],env:safeEnv(),stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  let id=0,reaped=false,exitCode=null,exitSignal=null,closeTask;const pending=new Map();
  const error=code=>Object.assign(Error(code),{code});
  function rejectPending(){for(const p of pending.values()){clearTimeout(p.timer);p.reject(error('CAPSULE_STORE_EXIT'));}pending.clear();}
  const closedPromise=new Promise(resolve=>child.once('close',(code,signal)=>{reaped=true;exitCode=code;exitSignal=signal;rejectPending();resolve();}));
  child.on('exit',rejectPending);child.on('error',rejectPending);
  child.on('message',m=>{if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);p.resolve(m.stats);}});
  async function waitClosed(ms){if(reaped)return true;let timer;try{return await Promise.race([closedPromise.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),ms);})]);}finally{clearTimeout(timer);}}
  async function killAndReap(){if(!reaped)child.kill('SIGKILL');check(await waitClosed(killMs),'CAPSULE_STORE_REAP_TIMEOUT');}
  let ready;
  try{
    ready=await new Promise((resolve,reject)=>{
      function finish(err,value){clearTimeout(timer);child.off('message',onMessage);child.off('error',onError);child.off('exit',onExit);err?reject(err):resolve(value);}
      function onMessage(m){if(m.ready)finish(null,m);}function onError(){finish(error('CAPSULE_STORE_EXIT'));}function onExit(){finish(error('CAPSULE_STORE_EXIT'));}
      const timer=setTimeout(()=>finish(error('CAPSULE_STORE_TIMEOUT')),15000);child.on('message',onMessage);child.once('error',onError);child.once('exit',onExit);
    });
    check(ready.pid===child.pid&&Array.isArray(ready.exec_argv)&&ready.exec_argv.length===0&&Number.isInteger(ready.port)&&ready.port>0&&ready.port<=65535,'CAPSULE_STORE_IDENTITY');
  }catch(e){await killAndReap();throw e;}
  function call(op,timeoutMs=15000){return new Promise((resolve,reject)=>{
    if(reaped||!child.connected)return reject(error('CAPSULE_STORE_EXIT'));
    const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(error('CAPSULE_STORE_TIMEOUT'));},timeoutMs);pending.set(n,{resolve,reject,timer});
    try{child.send({op,id:n},err=>{if(err&&pending.has(n)){pending.delete(n);clearTimeout(timer);reject(error('CAPSULE_STORE_EXIT'));}});}catch(e){pending.delete(n);clearTimeout(timer);reject(error('CAPSULE_STORE_EXIT'));}
  });}
  return {port:ready.port,pid:child.pid,get closed(){return reaped;},stats:()=>call('stats'),close(){
    if(closeTask)return closeTask;
    closeTask=(async()=>{
      if(reaped)throw error('CAPSULE_STORE_EXIT');
      let acknowledged=false;try{await call('stop',graceMs);acknowledged=true;}catch(e){/* Still reap this exact owned process before reporting failure. */}
      const graceful=await waitClosed(graceMs);
      if(!graceful)await killAndReap();
      check(acknowledged&&graceful&&exitCode===0&&exitSignal===null,'CAPSULE_STORE_SHUTDOWN_FAILED');
      return {closed:true,exit_code:exitCode};
    })();return closeTask;
  }};
}
module.exports={MAX,MAGIC,AAD,check,digest,seal,download,restore,startStore};
