'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {RpcTransport,RpcMethodError,safeRpcMessage}=require('./privsearch/stage1-chain-reader');
test('RPC diagnostics retain the exact error code, method, selector and provider reason',async()=>{
  const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const q=JSON.parse(raw);res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:-32000,message:'header not found'}}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {const rpc=new RpcTransport('http://127.0.0.1:'+server.address().port);await assert.rejects(rpc.send('eth_getCode',['0x'+'a'.repeat(40),'0x1bbeb7']),e=>e instanceof RpcMethodError&&e.code===-32000&&e.rpc_method==='eth_getCode'&&e.selector==='0x1bbeb7'&&e.provider_message==='header not found');}
  finally {await new Promise(resolve=>server.close(resolve));}
});
test('provider diagnostic messages redact endpoint/token strings and are bounded',()=>{
  const s=safeRpcMessage('header not found https://host/private?token=credential Bearer credential-value');assert(!s.includes('credential'));assert(s.includes('header not found'));assert.equal(safeRpcMessage('x'.repeat(2000)).length,1000);
});
