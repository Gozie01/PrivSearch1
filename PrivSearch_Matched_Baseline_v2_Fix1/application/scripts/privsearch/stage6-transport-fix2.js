'use strict';
const http=require('node:http'),T=require('./stage4-transport');
const QUERY_MS=1800000,CLOSE_MS=30000;
const label=x=>typeof x==='string'&&/^[A-Za-z0-9_.-]{1,80}$/.test(x)?x:null;
function failureDetails(e,endpoint,phase,start,timeoutMs){return {endpoint,phase,code:label(e?.code),name:label(e?.name),cause_code:label(e?.cause?.code),cause_name:label(e?.cause?.name),elapsed_ms:performance.now()-start,timeout_ms:timeoutMs};}
function batchDeadline(count,concurrency){if(!Number.isSafeInteger(count)||count<1||count>1000||![1,4].includes(concurrency))throw new Error('STAGE6_BATCH_DEADLINE_SHAPE_INVALID');return Math.ceil(count/concurrency)*(QUERY_MS+CLOSE_MS)+60000;}
class HttpClient {
 constructor(url,token,{timeoutMs=QUERY_MS,capture=()=>{},serverPid}={}){
  const parsed=new URL(url);if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1'||parsed.pathname!=='/'||parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error('STAGE4_LOOPBACK_HTTP_REQUIRED');
  this.url=parsed;this.token=token;this.timeoutMs=timeoutMs;this.capture=capture;this.serverPid=serverPid;this.nextId=1;
  this.stats={calls:0,attempted_calls:0,failed_calls:0,request_body_bytes:0,attempted_request_body_bytes:0,response_body_bytes:0,http_roundtrip_ms:0};
 }
 async call(endpoint,args){
  if(!['search','prove','locate','object','close'].includes(endpoint))throw new Error('STAGE6_HTTP_ENDPOINT_INVALID');
  const start=performance.now(),id=this.nextId++,body=Buffer.from(JSON.stringify({id,args})),timeoutMs=endpoint==='close'?Math.min(this.timeoutMs,CLOSE_MS):this.timeoutMs;let phase='encode';
  try{
   if(body.length>T.MAX_BYTES)throw new Error('STAGE4_MESSAGE_TOO_LARGE');
   this.stats.attempted_calls++;this.stats.attempted_request_body_bytes+=body.length;this.capture({endpoint,request:{id,args}});phase='request';
   const {status,raw}=await new Promise((resolve,reject)=>{
    // One new socket per request: no pooled connection can become stale while the server performs synchronous cryptography.
    const req=http.request(new URL(endpoint,this.url),{method:'POST',agent:false,headers:{'Content-Type':'application/json','Content-Length':body.length,'Authorization':'Bearer '+this.token,'Connection':'close'}},res=>{
     phase='response_body';const chunks=[];let size=0,terminalError;
     res.on('data',b=>{size+=b.length;if(size>T.MAX_BYTES){const e=new Error('STAGE4_MESSAGE_TOO_LARGE');e.code='STAGE6_HTTP_BODY_LIMIT';terminalError=e;res.destroy(e);req.destroy(e);}else chunks.push(b);});
     res.on('error',e=>reject(terminalError||e));res.on('aborted',()=>{const e=new Error('Stage6 HTTP response aborted');e.code='ECONNRESET';reject(terminalError||e);});
     res.on('end',()=>resolve({status:res.statusCode,raw:Buffer.concat(chunks)}));
    });
    const timer=setTimeout(()=>{const e=new Error('Stage6 HTTP request deadline exceeded');e.code='STAGE6_HTTP_DEADLINE';req.destroy(e);},timeoutMs);
    req.on('error',reject);req.on('close',()=>clearTimeout(timer));req.end(body);
   });
   this.stats.calls++;this.stats.request_body_bytes+=body.length;this.stats.response_body_bytes+=raw.length;this.stats.http_roundtrip_ms+=performance.now()-start;phase='response_validation';
   let packet;try{packet=JSON.parse(raw.toString('utf8'));}catch{throw new Error('STAGE4_INVALID_HTTP_JSON');}
   if(packet.id!==id||!Number.isSafeInteger(packet.server_pid)||packet.server_pid<1||(this.serverPid&&packet.server_pid!==this.serverPid))throw new Error('STAGE4_HTTP_RESPONSE_IDENTITY_MISMATCH');
   this.capture({endpoint,response:packet});
   if(status<200||status>=300||packet.error)throw new Error(packet.error?.message||'STAGE4_HTTP_OPERATION_FAILED');
   if(!Object.hasOwn(packet,'result'))throw new Error('STAGE4_HTTP_RESULT_MISSING');return packet.result;
  }catch(e){this.stats.failed_calls++;this.last_failure=failureDetails(e,endpoint,phase,start,timeoutMs);throw e;}
 }
}
module.exports={...T,HttpClient,QUERY_MS,CLOSE_MS,batchDeadline,failureDetails};
