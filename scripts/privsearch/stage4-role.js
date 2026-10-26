'use strict';
const {KEY_NAMES}=require('./stage3-encrypted-search');
function audit(role,capabilities) {return {role,pid:process.pid,ppid:process.ppid,node:process.version,capabilities,environment_sensitive_names_present:Object.keys(process.env).filter(n=>/PRIVATE|SECRET|TOKEN|MONGO|MINIO|PRIVSEARCH|LIFEDB|NODE_OPTIONS|NODE_PATH/i.test(n)),cwd_has_env_file:require('node:fs').existsSync(require('node:path').join(process.cwd(),'.env'))};}
function keyBytes(encoded) {const S=require('./stage1-state');S.exact(encoded,KEY_NAMES);return Object.fromEntries(KEY_NAMES.map(n=>{const b=Buffer.from(encoded[n],'base64');S.check(b.length===32,'Stage4 invalid provisioned key');return [n,b];}));}
module.exports={audit,keyBytes};
