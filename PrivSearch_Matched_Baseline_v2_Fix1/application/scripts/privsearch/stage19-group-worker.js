'use strict';
// Only derived scalar exponents (trusted client) or public tokens/scalars
// (untrusted server). No owner keys, ciphertext, RPC or storage credentials.
const {parentPort,workerData}=require('node:worker_threads'),S=require('./stage1-state'),P=require('./stage17-merkle-search');
S.exact(workerData,['mode']);S.check(['client','server'].includes(workerData.mode),'Stage19 worker mode');
parentPort.on('message',m=>{let id=null;try{S.exact(m,['id','items']);id=m.id;S.check(Number.isSafeInteger(id)&&id>0&&Array.isArray(m.items)&&m.items.length>0&&m.items.length<=64,'Stage19 worker packet');
 const values=m.items.map(item=>{if(workerData.mode==='client'){S.exact(item,['exponent']);return P.power(P.G,P.scalar(item.exponent)).toString(16).padStart(512,'0');}S.exact(item,['point','y']);return P.power(P.groupElement(item.point),P.scalar(item.y)).toString(16).padStart(512,'0');});parentPort.postMessage({id,values});
 }catch{parentPort.postMessage({id,error:'STAGE19_GROUP_OPERATION_REJECTED'});}});
parentPort.postMessage({ready:true,mode:workerData.mode});
