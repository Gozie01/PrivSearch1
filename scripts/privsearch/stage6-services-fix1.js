'use strict';
const fs=require('node:fs'),S=require('./stage1-state'),base=require('./stage6-services'),{atomic}=require('./stage4-services');
const RETRY_CODES=new Set(['ECONNRESET','EPIPE','ETIMEDOUT']);
const errorCode=e=>typeof e?.code==='string'&&/^[a-zA-Z0-9_]{1,80}$/.test(e.code)?e.code:null;
class Storage extends base.Storage {
 constructor(c,onProgress=()=>{}){
  super(c);this.onProgress=onProgress;
  this.publication={step:'not_started',object_count:0,object_bytes:0,object_put_attempts:0,object_retry_count:0,snapshot_chunks_completed:0};
 }
 emit(extra={}){this.onProgress({...this.publication,...extra});}
 freshMinio(){
  if(this.agent)this.agent.destroy();
  const {Client}=require('minio'),{Agent}=require(this.c.minio.useSSL?'node:https':'node:http');
  this.agent=new Agent({keepAlive:true,maxSockets:4,maxFreeSockets:1});
  this.minio=new Client({...this.c.minio,transportAgent:this.agent});
 }
 async open(){
  if(this.c.mode==='simulation')return super.open();
  this.publication.step='mongodb_connect';this.emit();
  const {MongoClient}=require('mongodb');this.mongo=new MongoClient(this.c.mongoUri,{serverSelectionTimeoutMS:10000});await this.mongo.connect();
  const db=this.mongo.db(this.c.mongoDb);this.meta=db.collection('privsearch_stage6_snapshots');this.chunks=db.collection('privsearch_stage6_snapshot_chunks');
  this.publication.step='minio_bucket_check';this.emit();this.freshMinio();
  S.check(await this.minio.bucketExists(this.c.bucket),'Stage6 existing MinIO bucket required');
  this.publication.step='ready';this.emit();
 }
 async putObject(key,bytes){
  // Freeze the exact ciphertext for every application-level retry of this key.
  const frozen=Buffer.from(bytes),ordinal=this.publication.object_count+1;
  this.publication.step='minio_object_put';
  for(let attempt=1;attempt<=3;attempt++){
   this.publication.object_put_attempts++;
   try{
    if(this.c.mode==='simulation')await super.putObject(key,frozen);
    else await this.minio.putObject(this.c.bucket,key,frozen,frozen.length,{'content-type':'application/json'});
    this.publication.object_count++;this.publication.object_bytes+=frozen.length;
    if(ordinal===1||ordinal%250===0||attempt>1)this.emit({object_ordinal:ordinal,wrapper_attempt:attempt,outcome:'object_complete'});
    return;
   }catch(e){
    const retry=this.c.mode!=='simulation'&&RETRY_CODES.has(e.code)&&attempt<3;
    if(retry)this.publication.object_retry_count++;
    this.emit({object_ordinal:ordinal,wrapper_attempt:attempt,outcome:retry?'retry_scheduled':'failed',error_code:errorCode(e)});
    if(!retry)throw e;
    this.freshMinio();await new Promise(resolve=>setTimeout(resolve,attempt===1?100:300));
   }
  }
 }
 async putSnapshot(sequence,snapshot){
  this.publication.step='snapshot_serialize';this.emit();
  const bytes=Buffer.from(JSON.stringify(snapshot));
  S.check(bytes.length>0&&bytes.length<=base.MAX_SNAPSHOT,'STAGE6_SNAPSHOT_SIZE_LIMIT');
  const pieces=[];for(let i=0;i<bytes.length;i+=base.CHUNK)pieces.push(bytes.subarray(i,i+base.CHUNK));
  const meta={run_id:this.c.runId,sequence,count:pieces.length,bytes:bytes.length,sha256:S.sha(bytes),digests:pieces.map(b=>S.sha(b))};
  for(let i=0;i<pieces.length;i++){
   this.publication.step='mongodb_snapshot_chunk_insert';this.emit({chunk_ordinal:i+1,chunk_total:pieces.length});
   // Do not repeat database inserts after an ambiguous error.
   if(this.c.mode==='simulation')fs.writeFileSync(this.file('chunk-'+sequence+'-'+i+'.bin'),pieces[i]);
   else await this.chunks.insertOne({run_id:this.c.runId,sequence,part:i,sha256:meta.digests[i],data:pieces[i].toString('base64')});
   this.publication.snapshot_chunks_completed++;
  }
  this.publication.step='mongodb_snapshot_metadata_insert';this.emit();
  if(this.c.mode==='simulation')atomic(this.file('snapshot-'+sequence+'.json'),meta);else await this.meta.insertOne(meta);
  this.publication.step='publication_complete';this.emit();
  return {serialized_snapshot_bytes:bytes.length,mongodb_chunk_count:pieces.length,mongodb_chunk_payload_bytes:base.CHUNK,publication:{...this.publication}};
 }
 async close(){try{await super.close();}finally{if(this.agent)this.agent.destroy();}}
}
module.exports={...base,Storage,RETRY_CODES};
