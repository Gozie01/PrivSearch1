'use strict';
const S=require('./stage1-state'),R=require('./stage10-chain-reader-fix1');
async function ownerChain(c){
 if(c.mode==='simulation')return require('./stage4-services').ownerChain(c);
 const {ethers}=require('ethers'),provider=new ethers.JsonRpcProvider(c.ownerRpc);
 try{
  const wallet=new ethers.Wallet(c.signer,provider),rpc=new R.RpcTransport(c.ownerRpc);S.check(wallet.address.toLowerCase()===c.pins.owner.toLowerCase(),'Stage18 owner signer mismatch');S.check(BigInt(await rpc.send('eth_chainId',[]))===BigInt(c.pins.chainId),'Stage18 owner chain mismatch');S.check((await rpc.send('eth_getBlockByNumber',['0x0',false])).hash.toLowerCase()==='0x'+c.pins.genesisHash,'Stage18 owner genesis mismatch');
  const contract=new ethers.Contract(c.pins.contract,R.ABI,wallet),code=await rpc.send('eth_getCode',[c.pins.contract,'latest']);S.check(S.sha(Buffer.from(code.slice(2),'hex'))===c.pins.codeHash&&(await contract.owner()).toLowerCase()===c.pins.owner.toLowerCase(),'Stage18 owner authority mismatch');S.check((await contract.getState('0x'+c.datasetId))[0]===0n,'Stage18 dataset namespace already used');
  return {async anchor(candidate){const state=candidate.snapshot.state;S.validateState(state);S.check(state.dataset_id===c.datasetId&&state.sequence==='1'&&state.previous_commitment===S.ZERO&&candidate.commitment===S.commitment(state),'Stage18 anchor candidate binding');const overrides={};if(c.gasPrice)overrides.gasPrice=BigInt(c.gasPrice);const tx=await contract.anchorState('0x'+state.dataset_id,1n,'0x'+candidate.commitment,'0x'+S.ZERO,overrides),receipt=await tx.wait(1,180000);S.check(receipt?.status===1,'Stage18 anchor receipt failed');return {transaction_hash:tx.hash,gas_used:receipt.gasUsed.toString(),receipt_block:receipt.blockNumber,simulated:false};},async close(){provider.destroy();}};
 }catch(e){provider.destroy();throw e;}
}
module.exports={ownerChain};
