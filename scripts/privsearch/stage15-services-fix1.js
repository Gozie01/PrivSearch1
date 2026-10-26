'use strict';
const S=require('./stage1-state'),base=require('./stage6-services-fix1');
const TRANSPORT=new Set(['ECONNRESET','EPIPE','ETIMEDOUT']);
function retryable(e){return !!(e&&(TRANSPORT.has(e.code)||(e instanceof Error&&e.name==='S3Error'&&e.code==='IncompleteBody')));}
function label(x){return typeof x==='string'&&/^[a-zA-Z0-9_]{1,80}$/.test(x)?x:null;}
class Storage extends base.Storage{
 freshMinio(){if(this.agent)this.agent.destroy();const {Client}=require('minio'),{Agent}=require(this.c.minio.useSSL?'node:https':'node:http');this.agent=new Agent({keepAlive:false,maxSockets:1});this.minio=new Client({...this.c.minio,transportAgent:this.agent});}
 async putObject(key,bytes){S.check(typeof key==='string'&&key.length>0&&Buffer.isBuffer(bytes),'Stage15 object key and Buffer required');const frozen=Buffer.from(bytes),ordinal=this.publication.object_count+1,evidence={declared_bytes:frozen.length,ciphertext_sha256:S.sha(frozen),object_key_sha256:S.sha(Buffer.from(key)),upload_keep_alive:false};this.publication.step='minio_object_put';
  for(let attempt=1;attempt<=3;attempt++){this.publication.object_put_attempts++;try{
   if(this.c.mode==='simulation')await require('./stage6-services').Storage.prototype.putObject.call(this,key,frozen);
   else await this.minio.putObject(this.c.bucket,key,Buffer.from(frozen),frozen.length,{'content-type':'application/json'});
   this.publication.object_count++;this.publication.object_bytes+=frozen.length;if(ordinal===1||ordinal%250===0||attempt>1)this.emit({...evidence,object_ordinal:ordinal,wrapper_attempt:attempt,outcome:'object_complete'});return;
  }catch(e){const retry=this.c.mode!=='simulation'&&retryable(e)&&attempt<3;if(retry)this.publication.object_retry_count++;this.emit({...evidence,object_ordinal:ordinal,wrapper_attempt:attempt,outcome:retry?'retry_scheduled':'failed',error_code:label(e.code),error_name:label(e.name),failure_kind:e.name==='S3Error'&&e.code==='IncompleteBody'?'s3_incomplete_body':'other'});if(!retry)throw e;this.freshMinio();await new Promise(r=>setTimeout(r,attempt===1?100:300));}}
 }
}
module.exports={...base,Storage,retryable};
