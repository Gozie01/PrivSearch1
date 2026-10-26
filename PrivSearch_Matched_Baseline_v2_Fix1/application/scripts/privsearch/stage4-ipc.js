'use strict';
const {fork}=require('node:child_process'),{environment,safeMessage}=require('./stage4-transport');
function launch(role,file,cwd,onEvent=()=>{}) {
  const child=fork(file,[role],{cwd,env:environment(),execArgv:['--dns-result-order=ipv4first'],stdio:['ignore','ignore','pipe','ipc']}),pending=new Map();let next=1,stderr='';
  child.stderr.on('data',b=>{stderr=(stderr+b.toString()).slice(-4000);});
  child.on('message',m=>{if(m.event){onEvent(m,child);return;}const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Object.assign(new Error(m.error.message),m.error)):p.resolve(m.result);});
  function fail(e){for(const p of pending.values()){clearTimeout(p.timer);p.reject(e);}pending.clear();}
  child.on('error',fail);child.on('exit',(code,signal)=>fail(new Error('Stage4 '+role+' exited '+code+'/'+signal+(stderr?' '+safeMessage(stderr):''))));
  return {child,role,call(command,args={},timeoutMs=240000){return new Promise((resolve,reject)=>{const id=next++,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Stage4 '+role+' IPC timeout'));},timeoutMs);pending.set(id,{resolve,reject,timer});child.send({id,command,args},e=>{if(e){pending.delete(id);clearTimeout(timer);reject(e);}});});},async stop(){if(child.exitCode!==null||child.signalCode)return;try{await this.call('shutdown',{},5000);}catch{}if(child.connected)child.disconnect();if(child.exitCode===null){await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill();resolve();},3000);child.once('exit',()=>{clearTimeout(timer);resolve();});});}}};
}
function serve(commands) {
  let queue=Promise.resolve();process.on('message',m=>{if(m.event_reply){eventReply(m);return;}queue=queue.then(async()=>{try{if(!Object.hasOwn(commands,m.command))throw new Error('Stage4 unknown private command');const result=await commands[m.command](m.args);process.send({id:m.id,result});}catch(e){process.send({id:m.id,error:{message:safeMessage(e),code:e.code??null,rpc_method:e.rpc_method||null,provider_message:e.provider_message||null,selector:e.selector||null,rpc_calls:e.rpc_calls||null,retry_events:e.retry_events||[]}});}});});
}
const events=new Map();let nextEvent=1;
function requestEvent(event){const event_id=nextEvent++;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{events.delete(event_id);reject(new Error('Stage4 private update event timeout'));},240000);events.set(event_id,{resolve,reject,timer});process.send({event,event_id});});}
function eventReply(m){const p=events.get(m.event_id);if(!p)return;events.delete(m.event_id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error)):p.resolve(m.result);}
module.exports={launch,serve,requestEvent};
