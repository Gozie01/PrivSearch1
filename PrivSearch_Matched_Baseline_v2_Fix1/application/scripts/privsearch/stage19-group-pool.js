'use strict';
const {Worker}=require('node:worker_threads'),path=require('node:path'),S=require('./stage1-state'),T=require('./stage4-transport');
const MAX_ITEMS=32768,MAX_PENDING_MAPS=8,CHUNK=64;
class GroupPool{
 #slots=[];#queue=[];#tasks=new Map();#next=1;#closed=false;#error=null;#maps=0;#operations=0;#closing;
 constructor({mode,size=4,timeoutMs=60000,workerFactory=(file,options)=>new Worker(file,options)}){
  S.check(['client','server'].includes(mode)&&Number.isSafeInteger(size)&&size>=1&&size<=4&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=180000,'Stage19 pool configuration');this.mode=mode;this.size=size;this.timeoutMs=timeoutMs;this.stats={workers_started:0,workers_stopped:0,operations_submitted:0,operations_completed:0,chunks_completed:0,queue_high_water:0,failures:0};
  const start=performance.now();this.ready=Promise.all(Array.from({length:size},()=>new Promise((resolve,reject)=>{
   const slot={worker:workerFactory(path.join(__dirname,'stage19-group-worker.js'),{workerData:{mode},env:T.environment(),execArgv:[]}),busy:false,ready:false};this.#slots.push(slot);this.stats.workers_started++;
   slot.cancelStartup=()=>{clearTimeout(timer);reject(new Error('STAGE19_POOL_CLOSED'));};
   const timer=setTimeout(()=>{reject(new Error('STAGE19_WORKER_START_TIMEOUT'));this.#fail(new Error('STAGE19_WORKER_START_TIMEOUT'));},timeoutMs);
   slot.worker.on('message',m=>{try{if(!slot.ready){S.exact(m,['ready','mode']);S.check(m.ready===true&&m.mode===mode,'Stage19 worker readiness');slot.ready=true;clearTimeout(timer);resolve();return;}const task=this.#tasks.get(m?.id);S.check(task&&task.slot===slot,'Stage19 worker response identity');S.exact(m,m.error?['id','error']:['id','values']);if(m.error)throw new Error('STAGE19_GROUP_OPERATION_REJECTED');S.check(Array.isArray(m.values)&&m.values.length===task.items.length,'Stage19 worker response count');m.values.forEach(v=>S.hex(v,256));clearTimeout(task.timer);this.#tasks.delete(m.id);slot.busy=false;this.stats.operations_completed+=m.values.length;this.stats.chunks_completed++;task.resolve(m.values);this.#dispatch();}catch(e){clearTimeout(timer);reject(e);this.#fail(e);}});
   slot.worker.on('error',()=>{clearTimeout(timer);const e=new Error('STAGE19_WORKER_ERROR');reject(e);this.#fail(e);});
   slot.worker.on('exit',()=>{this.stats.workers_stopped++;clearTimeout(timer);if(!this.#closed){const e=new Error('STAGE19_WORKER_EXIT');reject(e);this.#fail(e);}});
  }))).then(()=>{this.stats.startup_ms=performance.now()-start;}).catch(e=>{this.#fail(e);throw e;});
  // The explicit open/map await still observes rejection; suppress a detached
  // ready rejection if a caller closes immediately during worker construction.
  this.ready.catch(()=>{});
 }
 static async open(options){const p=new GroupPool(options);try{await p.ready;return p;}catch(e){await p.close();throw e;}}
 #fail(e){if(this.#error||this.#closed)return;this.#error=new Error(String(e.message).slice(0,180));this.stats.failures++;for(const task of [...this.#queue,...this.#tasks.values()]){clearTimeout(task.timer);task.reject(this.#error);}this.#queue=[];this.#tasks.clear();this.close();}
 #dispatch(){if(this.#closed||this.#error)return;for(const slot of this.#slots){if(slot.busy||!slot.ready||!this.#queue.length)continue;const task=this.#queue.shift();task.slot=slot;slot.busy=true;this.#tasks.set(task.id,task);task.timer=setTimeout(()=>this.#fail(new Error('STAGE19_GROUP_DEADLINE')),this.timeoutMs);try{slot.worker.postMessage({id:task.id,items:task.items});}catch{this.#fail(new Error('STAGE19_WORKER_SEND_FAILED'));}}}
 async map(items){S.check(!this.#closed&&!this.#error,'STAGE19_POOL_CLOSED');S.check(Array.isArray(items)&&items.length<=MAX_ITEMS,'STAGE19_GROUP_RESOURCE_LIMIT');if(!items.length){await this.ready;S.check(!this.#closed&&!this.#error,'STAGE19_POOL_CLOSED');return [];}S.check(this.#maps<MAX_PENDING_MAPS&&this.#operations+items.length<=MAX_ITEMS,'STAGE19_GROUP_RESOURCE_LIMIT');
  // Snapshot every item before the first asynchronous dispatch. The native
  // worker repeats strict item validation and unchanged subgroup checks.
  const frozen=items.map(item=>{S.exact(item,this.mode==='client'?['exponent']:['point','y']);for(const v of Object.values(item))S.hex(v,256);return {...item};});this.#maps++;this.#operations+=frozen.length;this.stats.operations_submitted+=frozen.length;
  try{await this.ready;S.check(!this.#closed&&!this.#error,'STAGE19_POOL_CLOSED');const promises=[];for(let i=0;i<frozen.length;i+=CHUNK)promises.push(new Promise((resolve,reject)=>this.#queue.push({id:this.#next++,items:frozen.slice(i,i+CHUNK),resolve,reject})));this.stats.queue_high_water=Math.max(this.stats.queue_high_water,this.#queue.length);this.#dispatch();return (await Promise.all(promises)).flat();}finally{this.#maps--;this.#operations-=frozen.length;}
 }
 close(){if(this.#closing)return this.#closing;this.#closed=true;const error=this.#error||new Error('STAGE19_POOL_CLOSED');for(const task of [...this.#queue,...this.#tasks.values()]){clearTimeout(task.timer);task.reject(error);}this.#queue=[];this.#tasks.clear();for(const slot of this.#slots)if(!slot.ready)slot.cancelStartup();this.#closing=Promise.allSettled(this.#slots.map(slot=>slot.worker.terminate())).then(()=>undefined);return this.#closing;}
}
module.exports={GroupPool,MAX_ITEMS,MAX_PENDING_MAPS,CHUNK};
