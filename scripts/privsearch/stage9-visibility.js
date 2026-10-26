'use strict';
async function waitVisible(observe,{now=()=>performance.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=180000}={}){const start=now();let attempts=0;while(now()-start<timeoutMs){attempts++;try{const observation=await observe();return {receipt_to_visible_ms:now()-start,visibility_attempts:attempts,observation};}catch(e){if(e.message!=='Response is not latest visible anchored sequence')throw e;}await sleep(1000);}throw new Error('Stage9 anchor visibility timeout');}
module.exports={waitVisible};
