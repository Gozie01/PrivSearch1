'use strict';
// The untrusted storage role sees only one opaque encrypted file. No application imports.
const fs=require('node:fs'),http=require('node:http'),crypto=require('node:crypto');
const file=process.argv[2],size=fs.statSync(file).size;
let requests=0,complete=0,bytes=0,rejected=0;
const sockets=new Set(),streams=new Set();let stopping=false;
const server=http.createServer((req,res)=>{
  requests++;
  if(req.method!=='GET'||req.url!=='/snapshot'){rejected++;req.resume();res.writeHead(400);res.end();return;}
  res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':size,'Connection':'close'});
  const input=fs.createReadStream(file);streams.add(input);input.once('close',()=>streams.delete(input));let sent=0;
  input.on('data',b=>{sent+=b.length;});input.on('error',()=>res.destroy());
  res.on('finish',()=>{complete++;bytes+=sent;});res.on('close',()=>input.destroy());input.pipe(res);
});
server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
function stats(){return {requests,completed_downloads:complete,body_bytes:bytes,rejected_requests:rejected,route:'/snapshot',pid:process.pid,keys_received:false,application_imported:false,records_received:false,environment_names:Object.keys(process.env).sort(),exec_argv:process.execArgv.slice()};}
function shutdown(id){
  if(stopping)return;stopping=true;
  server.close(()=>{
    if(id!==undefined&&process.connected)process.send({id,stats:stats()},()=>{if(process.connected)process.disconnect();});
    else if(process.connected)process.disconnect();
  });
  server.closeAllConnections();
  for(const s of sockets)s.destroy();for(const stream of streams)stream.destroy();
}
process.on('message',m=>{
  if(m?.op==='stats')process.send({id:m.id,stats:stats()});
  if(m?.op==='stop')shutdown(m.id);
});
process.on('disconnect',()=>shutdown());
server.listen(0,'127.0.0.1',()=>process.send({ready:true,port:server.address().port,pid:process.pid,opaque_file_bytes:size,exec_argv:process.execArgv.slice()}));
