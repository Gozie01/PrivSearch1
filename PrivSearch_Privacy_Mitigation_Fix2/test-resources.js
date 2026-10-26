'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const resources=new WeakMap();
function temp(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'privsearch-mitigation-')),closers=[];resources.set(t,closers);
  // One ordered hook: close/reap child processes and sockets before removing their cwd.
  t.after(async()=>{let failure;for(const close of closers.slice().reverse()){try{await close();}catch(e){failure??=e;}}if(failure)throw failure;fs.rmSync(dir,{recursive:true,force:true,maxRetries:3});});
  return dir;
}
function own(t,close){if(!resources.has(t))throw Error('TEMP_RESOURCE_NOT_INITIALIZED');resources.get(t).push(close);}
async function closeHttp(server,sockets){
  await new Promise((resolve,reject)=>{
    server.close(err=>err&&err.code!=='ERR_SERVER_NOT_RUNNING'?reject(err):resolve());
    server.closeAllConnections();for(const s of sockets)s.destroy();
  });
}
module.exports={temp,own,closeHttp};
