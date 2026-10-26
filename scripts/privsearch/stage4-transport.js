'use strict';
const crypto=require('node:crypto');
const MAX_BYTES=16*1024*1024;
function safeMessage(e) {return String(e?.message||e||'Operation failed').replace(/(?:https?|mongodb(?:\+srv)?):\/\/\S+/gi,'[endpoint]').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/(?:0x)?[0-9a-f]{64,}/gi,'[hex-value]').slice(0,1000);}
function environment(source=process.env) {
  const out={};for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','TEMP','TMP','TMPDIR','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','COMSPEC','PATHEXT','LANG','LC_ALL'])if(typeof source[key]==='string')out[key]=source[key];return out;
}
async function bounded(stream,limit=MAX_BYTES) {const chunks=[];let size=0;for await(const chunk of stream){size+=chunk.length;if(size>limit)throw new Error('STAGE4_MESSAGE_TOO_LARGE');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);}
class HttpClient {
  constructor(url,token,{timeoutMs=30000,capture=()=>{},serverPid}={}) {
    const parsed=new URL(url);if(parsed.protocol!=='http:'||parsed.hostname!=='127.0.0.1'||parsed.pathname!=='/')throw new Error('STAGE4_LOOPBACK_HTTP_REQUIRED');
    this.url=parsed.href;this.token=token;this.timeoutMs=timeoutMs;this.capture=capture;this.serverPid=serverPid;this.nextId=1;this.stats={calls:0,request_body_bytes:0,response_body_bytes:0,http_roundtrip_ms:0};
  }
  async call(endpoint,args) {
    const id=this.nextId++,body=Buffer.from(JSON.stringify({id,args})),start=performance.now();if(body.length>MAX_BYTES)throw new Error('STAGE4_MESSAGE_TOO_LARGE');
    this.capture({endpoint,request:{id,args}});const response=await fetch(this.url+endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+this.token},body,signal:AbortSignal.timeout(this.timeoutMs)});
    const raw=await bounded(response.body);this.stats.calls++;this.stats.request_body_bytes+=body.length;this.stats.response_body_bytes+=raw.length;this.stats.http_roundtrip_ms+=performance.now()-start;
    let packet;try {packet=JSON.parse(raw.toString('utf8'));}catch {throw new Error('STAGE4_INVALID_HTTP_JSON');}
    if(packet.id!==id||!Number.isSafeInteger(packet.server_pid)||packet.server_pid<1||(this.serverPid&&packet.server_pid!==this.serverPid))throw new Error('STAGE4_HTTP_RESPONSE_IDENTITY_MISMATCH');
    this.capture({endpoint,response:packet});
    if(!response.ok||packet.error)throw new Error(packet.error?.message||'STAGE4_HTTP_OPERATION_FAILED');
    if(!Object.hasOwn(packet,'result'))throw new Error('STAGE4_HTTP_RESULT_MISSING');return packet.result;
  }
}
function authEqual(value,token) {const expected=Buffer.from('Bearer '+token),got=Buffer.from(String(value||''));return got.length===expected.length&&crypto.timingSafeEqual(got,expected);}
module.exports={MAX_BYTES,safeMessage,environment,bounded,HttpClient,authEqual};
