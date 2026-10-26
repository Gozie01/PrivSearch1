'use strict';
// Domain-separated probable-prime representatives only. No inherited RSA modulus or generator.
const crypto=require('node:crypto');
const cache=new Map(),LIMIT=50000;
function representative(version,token,value){const key=JSON.stringify([version,token,value]);if(cache.has(key))return cache.get(key);const hash=crypto.createHash('sha256').update(JSON.stringify(['privsearch-stage17-representative-256',version,token,value])).digest('hex');let candidate=BigInt('0x'+hash)|(1n<<255n)|1n;const ceiling=1n<<256n;while(candidate<ceiling){if(crypto.checkPrimeSync(Buffer.from(candidate.toString(16).padStart(64,'0'),'hex'),{checks:64})){if(cache.size>=LIMIT)cache.delete(cache.keys().next().value);cache.set(key,candidate);return candidate;}candidate+=2n;}throw new Error('Stage17 representative search overflow');}
module.exports={representative};
