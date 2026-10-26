const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const live=new Map(),fork=cp.fork,rm=fs.rmSync;
cp.fork=function(module,args,options){const child=fork.call(this,module,args,options);if(path.basename(module)==='capsule-store.js'){live.set(child.pid,path.resolve(options.cwd));child.once('exit',()=>live.delete(child.pid));}return child;};
fs.rmSync=function(file,...args){if(typeof file==='string'){const dir=path.resolve(file);for(const [pid,cwd] of live)if(cwd===dir||cwd.startsWith(dir+path.sep)){process.stderr.write('SIMULATED_WINDOWS_CWD_LOCK: live capsule child '+pid+'\n');throw Object.assign(Error('simulated live-child cwd lock'),{code:'EPERM'});}}return rm.call(this,file,...args);};
