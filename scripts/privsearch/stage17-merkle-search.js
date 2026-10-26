'use strict';
const crypto=require('node:crypto'),{performance}=require('node:perf_hooks');
const S=require('./stage1-state'),M=require('./stage17-merkle-auth');
const SCHEMA='privsearch-oxt-full-row-merkle-v2',KEY_NAMES=['KT','KX','KI','KZ','KE','KD','KC'];
const PRIME_BYTES=crypto.getDiffieHellman('modp14').getPrime(),P=BigInt('0x'+PRIME_BYTES.toString('hex')),Q=(P-1n)/2n,G=4n;
const POLICY=Object.freeze({scheme:SCHEMA,semantics:'token-dnf-v1',group:'RFC3526-modp14-prime-order-subgroup',prime_sha256:S.sha(PRIME_BYTES),generator:'4',scalar_prf:'hmac-sha256-expand-2048-rejection-v1',identifier_cipher:'AES-256-GCM',identifier_aad:'dataset-sequence-label-position-v1',coverage:M.SCHEMA,authentication:'complete-row-merkle-only',coverage_identifiers:'ciphertext-row-digests',normalization:'NFKC-trim-lowercase-v1',max_clauses:64,max_query_token_references:128,max_opened_posting_references:1000000,prepared_tokens_only:true,payload_revision:'snapshot-sequence'});
const clone=M.copy,enc=n=>Buffer.from(n.toString(16).padStart(512,'0'),'hex'),scalarHex=n=>n.toString(16).padStart(512,'0');
const dh=crypto.createDiffieHellman(PRIME_BYTES,Buffer.from([4]));S.check(dh.verifyError===0,'Stage3 group validation failed');
function power(base,exponent) {
  S.check(typeof base==='bigint'&&base>1n&&base<P-1n&&typeof exponent==='bigint'&&exponent>0n&&exponent<Q,'Stage3 group power out of range');
  dh.setPrivateKey(enc(exponent));const b=dh.computeSecret(enc(base));S.check(b.length===256,'Stage3 group operation failed');return BigInt('0x'+b.toString('hex'));
}
// P is the unchanged, fixed RFC3526 safe prime. Its order-Q subgroup is
// exactly the quadratic residues; the Jacobi symbol equals the Legendre symbol
// for this prime. Keep the original encoding/range checks and reject identity.
function quadraticCharacter(value) {
  S.check(typeof value==='bigint'&&value>=0n&&value<P,'Stage7 quadratic character input invalid');
  let a=value,n=P,sign=1;
  while(a){
    while((a&1n)===0n){a>>=1n;const residue=n&7n;if(residue===3n||residue===5n)sign=-sign;}
    [a,n]=[n,a];if((a&3n)===3n&&(n&3n)===3n)sign=-sign;a%=n;
  }
  return n===1n?sign:0;
}
function groupElement(h) {S.hex(h,256);const n=BigInt('0x'+h);S.check(n>1n&&n<P-1n&&quadraticCharacter(n)===1,'Stage3 invalid subgroup element');return n;}
function scalar(h) {S.hex(h,256);const n=BigInt('0x'+h);S.check(n>0n&&n<Q,'Stage3 invalid scalar');return n;}
function inverse(a) {let old=Q,r=a,t=0n,next=1n;while(r){const k=old/r;[old,r]=[r,old-k*r];[t,next]=[next,t-k*next];}S.check(old===1n,'Stage3 scalar inverse failed');return (t%Q+Q)%Q;}
function keyword(w) {S.check(typeof w==='string','Stage3 keyword must be text');const n=w.normalize('NFKC').trim().toLowerCase();S.check(n.length>0&&n.length<=1024,'Stage3 keyword length invalid');return n;}
function keyCopy(keys) {S.exact(keys,KEY_NAMES);const out={};for(const k of KEY_NAMES){S.check(Buffer.isBuffer(keys[k])&&keys[k].length===32,'Stage3 independent 32-byte key required');out[k]=Buffer.from(keys[k]);}S.check(new Set(KEY_NAMES.map(k=>out[k].toString('hex'))).size===7,'Stage3 keys must be independent');return out;}
function generateKeys() {return Object.fromEntries(KEY_NAMES.map(k=>[k,crypto.randomBytes(32)]));}
function prf(k,domain,value) {return crypto.createHmac('sha256',k).update(S.canonical([SCHEMA,domain,value])).digest();}
function field(k,domain,value) {
  const prefix='['+S.canonical(SCHEMA)+','+S.canonical(domain)+',['+S.canonical(value)+',';
  for(let retry=0;retry<1024;retry++) {const bytes=Buffer.allocUnsafe(256),retryPrefix=prefix+retry+',';for(let i=0;i<8;i++)crypto.createHmac('sha256',k).update(retryPrefix+i+']]').digest().copy(bytes,i*32);const n=BigInt('0x'+bytes.toString('hex'));if(n>0n&&n<Q)return n;}
  throw new Error('Stage3 scalar rejection limit');
}
function tags(keys,dataset,sequence,w) {return {label:prf(keys.KC,'coverage-label',[dataset,sequence,w]).toString('hex'),stag:prf(keys.KT,'tset-address',[dataset,sequence,w]).toString('hex')};}
function opaque(keys,dataset,id) {S.check(typeof id==='string'&&id.length>0&&id.length<=1024,'Stage3 document identifier invalid');return prf(keys.KI,'opaque-document',[dataset,id]).toString('hex');}
function rowKey(keys,dataset,sequence,label) {return Buffer.from(crypto.hkdfSync('sha256',keys.KE,Buffer.from(dataset,'hex'),Buffer.from(S.canonical([SCHEMA,'identifier-key',sequence,label])),32));}
function rowAAD(dataset,sequence,label,position) {return Buffer.from(S.canonical([SCHEMA,'identifier-row',dataset,sequence,label,position]));}
function rowId(row) {return S.hash('stage3-ciphertext-row',row);}
function validateRow(row,count) {
  S.exact(row,['schema','position','encrypted','y']);S.check(row.schema===SCHEMA&&Number.isSafeInteger(row.position)&&row.position>=1&&row.position<=count,'Stage3 row position invalid');scalar(row.y);
  S.exact(row.encrypted,['iv_hex','tag_hex','ciphertext_b64']);S.hex(row.encrypted.iv_hex,12);S.hex(row.encrypted.tag_hex,16);
  S.check(typeof row.encrypted.ciphertext_b64==='string'&&Buffer.from(row.encrypted.ciphertext_b64,'base64').toString('base64')===row.encrypted.ciphertext_b64&&Buffer.from(row.encrypted.ciphertext_b64,'base64').length<=512,'Stage3 identifier ciphertext invalid');
}
function decryptRow(keys,state,label,w,row,count,key) {
  validateRow(row,count);const e=row.encrypted,d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv_hex,'hex'),{authTagLength:16});d.setAAD(rowAAD(state.dataset_id,state.sequence,label,row.position));d.setAuthTag(Buffer.from(e.tag_hex,'hex'));
  const plain=JSON.parse(Buffer.concat([d.update(Buffer.from(e.ciphertext_b64,'base64')),d.final()]).toString('utf8'));S.exact(plain,['schema','handle']);S.check(plain.schema===SCHEMA,'Stage3 identifier schema invalid');S.hex(plain.handle);
  const x=field(keys.KI,'xind',[state.dataset_id,plain.handle]),z=field(keys.KZ,'position-blinder',[state.dataset_id,state.sequence,w,row.position]);S.check(scalar(row.y)*z%Q===x,'Stage3 row scalar binding mismatch');return plain.handle;
}
class Stage3Owner {
  #keys;#pins;#dataset;#keyPair;#ivs=new Set();
  constructor({keys,pins,datasetId,keyPair=crypto.generateKeyPairSync('ed25519')}) {this.#keys=keyCopy(keys);this.#pins=clone(pins);S.hex(datasetId);this.#dataset=datasetId;this.#keyPair=keyPair;}
  prepare(documents,preparedKeywords,{sequence='1',previousCommitment=S.ZERO,version='stage17-'+crypto.randomUUID(),plannerCommitment=S.ZERO}={}) {
    S.uint(sequence);S.hex(previousCommitment);S.check(Array.isArray(documents)&&documents.length>0&&documents.length<=1000000,'Stage3 bounded nonempty documents required');
    S.check(Array.isArray(preparedKeywords)&&preparedKeywords.length>0&&preparedKeywords.length<=1000000,'Stage3 prepared vocabulary required');
    const words=preparedKeywords.map(keyword);S.check(new Set(words).size===words.length,'Stage3 duplicate normalized vocabulary');
    const lists=new Map(words.map(w=>[w,[]])),objects=new Map(),descriptors=[],seen=new Set();
    for(const doc of documents) {
      S.exact(doc,['id','keywords','body']);S.check(Buffer.isBuffer(doc.body)&&Array.isArray(doc.keywords),'Stage3 document bytes and keywords required');
      const handle=opaque(this.#keys,this.#dataset,doc.id);S.check(!seen.has(handle),'Stage3 duplicate document');seen.add(handle);
      const normalized=doc.keywords.map(keyword);S.check(new Set(normalized).size===normalized.length,'Stage3 duplicate normalized document keyword');
      for(const w of normalized){S.check(lists.has(w),'Stage3 document keyword not prepared');lists.get(w).push(handle);}
      const context={dataset_id:this.#dataset,document_id:handle,revision:sequence,key_id:'stage3-payload'},plain=Buffer.from(S.canonical({schema:SCHEMA,document_id:doc.id,revision:sequence,body_b64:doc.body.toString('base64')}));
      let e;for(let attempt=0;attempt<64;attempt++){const candidate=S.encryptPayload(plain,this.#keys.KD,context);if(!this.#ivs.has(candidate.iv_hex)){e=candidate;break;}}S.check(e,'Stage3 IV uniqueness limit');this.#ivs.add(e.iv_hex);
      const objectKey='privsearch-stage3/'+this.#dataset+'/'+handle+'/'+S.hash('ciphertext-envelope',e)+'.json';objects.set(objectKey,Buffer.from(S.canonical(e)));descriptors.push(S.descriptor(context,e,objectKey));
    }
    const tables=[],xset=new Set(),postings=new Map();
    for(const w of words) {
      const {label,stag}=tags(this.#keys,this.#dataset,sequence,w),handles=lists.get(w).sort(),fx=field(this.#keys.KX,'xterm',[this.#dataset,sequence,w]);
      const rows=handles.map((handle,i)=>{
        const position=i+1,x=field(this.#keys.KI,'xind',[this.#dataset,handle]),z=field(this.#keys.KZ,'position-blinder',[this.#dataset,sequence,w,position]);xset.add(scalarHex(power(G,fx*x%Q)));
        let iv;for(let attempt=0;attempt<64;attempt++){const candidate=crypto.randomBytes(12);if(!this.#ivs.has(candidate.toString('hex'))){iv=candidate;break;}}S.check(iv,'Stage3 IV uniqueness limit');this.#ivs.add(iv.toString('hex'));
        const cipher=crypto.createCipheriv('aes-256-gcm',rowKey(this.#keys,this.#dataset,sequence,label),iv,{authTagLength:16});cipher.setAAD(rowAAD(this.#dataset,sequence,label,position));
        const ciphertext=Buffer.concat([cipher.update(Buffer.from(S.canonical({schema:SCHEMA,handle}))),cipher.final()]);
        return {schema:SCHEMA,position,encrypted:{iv_hex:iv.toString('hex'),tag_hex:cipher.getAuthTag().toString('hex'),ciphertext_b64:ciphertext.toString('base64')},y:scalarHex(x*inverse(z)%Q)};
      });
      tables.push({label,stag,rows});postings.set(label,rows.map(rowId));
    }
    tables.sort((a,b)=>a.stag<b.stag?-1:a.stag>b.stag?1:0);
    const owner=M.buildOwnerState(postings,{version,sequence,keyPair:this.#keyPair}),metadata={families:['token-dnf'],expansion:'explicit-policy-digest-or-native',planner_commitment:S.hex(plannerCommitment),encrypted_search:clone(POLICY),xset_digest:S.hash('stage3-xset',[...xset].sort())};
    const built=M.buildState({pins:this.#pins,datasetId:this.#dataset,sequence,auditManifest:owner.envelope.manifest,ownerPublicKey:owner.publicKey,metadata,payloadDescriptors:descriptors,previousCommitment});
    const serverData={schema:SCHEMA,tables,xset:[...xset].sort(),audit_server:{manifest:owner.serverData.manifest,lists:[...owner.serverData.lists].map(([label,e])=>[label,{docs:e.docs}])}};
    const snapshot={schema:SCHEMA,state:built.state,envelope:owner.envelope,metadata,payloads:built.payloads,payload_proofs:built.payloadProofs,server_data:serverData};
    return {snapshot,objects,ownerPublicKey:owner.publicKey,commitment:built.commitment};
  }
}
class Stage3Server {
  #snapshot;#tables;#byLabel;#xset;#audit;#payloadIndex;
  constructor(snapshot) {
    this.#snapshot=clone(snapshot);this.#payloadIndex=new Map();this.#snapshot.payloads.forEach((p,i)=>{if(!this.#payloadIndex.has(p.context.document_id))this.#payloadIndex.set(p.context.document_id,i);});S.check(snapshot.schema===SCHEMA&&snapshot.server_data.schema===SCHEMA,'Stage3 server schema invalid');
    this.#tables=new Map(snapshot.server_data.tables.map(t=>[t.stag,clone(t)]));this.#byLabel=new Map(snapshot.server_data.tables.map(t=>[t.label,clone(t)]));this.#xset=new Set(snapshot.server_data.xset);this.#audit=M.restoreServer(snapshot.server_data.audit_server);
  }
  exportView() {return clone(this.#snapshot);}
  search(request) {
    const start=performance.now();S.exact(request,['schema','nonce','dataset_id','sequence','commitment','coverage_labels','clauses']);S.check(request.schema===SCHEMA,'Stage3 request schema invalid');S.hex(request.nonce);
    S.check(request.dataset_id===this.#snapshot.state.dataset_id&&request.sequence===this.#snapshot.state.sequence&&request.commitment===S.commitment(this.#snapshot.state),'Stage3 request snapshot mismatch');
    S.check(Array.isArray(request.clauses)&&request.clauses.length>0&&request.clauses.length<=POLICY.max_clauses,'Stage3 request clause limit');
    let crossTests=0;
    const clauses=request.clauses.map(clause=>{
      S.exact(clause,['label','stag','count','term_labels','xtokens']);const table=this.#tables.get(clause.stag);S.check(table&&table.label===clause.label&&table.rows.length===clause.count,'Stage3 TSet selection mismatch');
      S.check(Array.isArray(clause.term_labels)&&clause.term_labels.length>0&&clause.term_labels.length<=128&&clause.term_labels.includes(clause.label),'Stage3 request terms invalid');
      S.check(Array.isArray(clause.xtokens)&&clause.xtokens.length===clause.count,'Stage3 position token count mismatch');
      const matches=[];
      table.rows.forEach((row,i)=>{
        const packet=clause.xtokens[i];S.exact(packet,['position','points']);S.check(packet.position===i+1&&Array.isArray(packet.points)&&packet.points.length===clause.term_labels.length-1,'Stage3 position tokens invalid');
        const y=scalar(row.y);let accepted=true;
        // Evaluate every predicate even after a false test; disclose the exact
        // cross-test count instead of hiding short-circuit work in timings.
        for(const point of packet.points){crossTests++;const value=scalarHex(power(groupElement(point),y));if(!this.#xset.has(value))accepted=false;}
        if(accepted)matches.push(row.position);
      });
      return {label:clause.label,matches};
    });
    S.check(Array.isArray(request.coverage_labels)&&request.coverage_labels.length<=128,'Stage3 coverage label limit');
    const coverage=request.coverage_labels.map(label=>{
      const table=this.#byLabel.get(label);S.check(table,'Stage3 coverage label not prepared');
      const packet=M.buildCoveragePacket(this.#snapshot.state,this.#audit,label),rows=table.rows.map(row=>({row,id:rowId(row)})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(item=>item.row);return {label,packet,rows};
    });
    return {schema:SCHEMA,nonce:request.nonce,request_digest:S.hash('stage3-request',request),dataset_id:request.dataset_id,sequence:request.sequence,commitment:request.commitment,clauses,coverage,server_search_ms:performance.now()-start,cross_tests:crossTests};
  }
  locate(handle) {const i=this.#payloadIndex.get(handle);S.check(i!==undefined,'Stage3 payload handle unavailable');return {descriptor:clone(this.#snapshot.payloads[i]),proof:clone(this.#snapshot.payload_proofs[i])};}
}
class Stage3Client {
  #keys;#state;#reader;#entries;#pending=new Map();
  constructor({keys,state,envelope,ownerPublicKey,metadata,reader}) {
    this.#keys=keyCopy(keys);this.#state=clone(state);this.#reader=reader;S.check(S.canonical(metadata.encrypted_search)===S.canonical(POLICY),'Stage3 committed policy mismatch');
    M.bindState(this.#state,envelope,ownerPublicKey,metadata);this.#entries=new Map(envelope.manifest.entries.map(e=>[e.token,clone(e)]));
  }
  createRequest(plaintextQuery) {
    const start=performance.now();S.check(this.#pending.size<64,'Stage3 pending request limit');S.check(Array.isArray(plaintextQuery)&&plaintextQuery.length>0&&plaintextQuery.length<=64,'Stage3 query clause limit');
    S.check(plaintextQuery.every(c=>Array.isArray(c)&&c.length>0)&&plaintextQuery.reduce((n,c)=>n+c.length,0)<=128,'Stage3 query token limit');
    const words=new Map(),clauses=plaintextQuery.map(clause=>{
      const normalized=clause.map(keyword);S.check(new Set(normalized).size===normalized.length,'Stage3 duplicate normalized query term');
      const terms=normalized.map(w=>{const t=tags(this.#keys,this.#state.dataset_id,this.#state.sequence,w),entry=this.#entries.get(t.label);S.check(entry,'Stage3 query keyword not prepared');words.set(t.label,w);return {...t,w,count:entry.count};}).sort((a,b)=>a.label<b.label?-1:1);
      const selected=terms.slice().sort((a,b)=>a.count-b.count||(a.label<b.label?-1:1))[0],others=terms.filter(t=>t.label!==selected.label).map(t=>({...t,fx:field(this.#keys.KX,'xterm',[this.#state.dataset_id,this.#state.sequence,t.w])})),xtokens=[];
      for(let position=1;position<=selected.count;position++) {const z=field(this.#keys.KZ,'position-blinder',[this.#state.dataset_id,this.#state.sequence,selected.w,position]);xtokens.push({position,points:others.map(t=>scalarHex(power(G,z*t.fx%Q)))});}
      return {label:selected.label,stag:selected.stag,count:selected.count,term_labels:terms.map(t=>t.label),xtokens};
    });
    const request={schema:SCHEMA,nonce:crypto.randomBytes(32).toString('hex'),dataset_id:this.#state.dataset_id,sequence:this.#state.sequence,commitment:S.commitment(this.#state),coverage_labels:[...words.keys()].sort(),clauses};
    this.#pending.set(request.nonce,{request:clone(request),words,token_generation_ms:performance.now()-start});return clone(request);
  }
  async verifyResponse(response,{locate,retrieve,preparePayloads}) {
    const start=performance.now(),pending=response&&this.#pending.get(response.nonce);S.check(pending,'Stage3 unknown or consumed request');this.#pending.delete(response.nonce);
    response=clone(response);const request=pending.request;S.exact(response,['schema','nonce','request_digest','dataset_id','sequence','commitment','clauses','coverage','server_search_ms','cross_tests']);
    S.check(response.schema===SCHEMA&&response.dataset_id===request.dataset_id&&response.sequence===request.sequence&&response.commitment===request.commitment&&response.request_digest===S.hash('stage3-request',request),'Stage3 response request binding mismatch');
    const first=await this.#reader.observe(this.#state),coverageStart=performance.now(),lists=new Map();let opened=0;
    S.check(Array.isArray(response.coverage)&&response.coverage.length===request.coverage_labels.length,'Stage3 missing or extra coverage');
    for(let i=0;i<response.coverage.length;i++) {
      const item=response.coverage[i],label=request.coverage_labels[i];S.exact(item,['label','packet','rows']);S.check(item.label===label,'Stage3 duplicate or unordered coverage');
      const entry=this.#entries.get(label),docs=item.packet?.docs;S.check(Array.isArray(docs)&&Array.isArray(item.rows),'Stage3 coverage rows invalid');
      const verified=M.verifyOpening(this.#state,label,entry,item.packet);opened+=verified.opened_posting_references;S.check(opened<=1000000,'Stage17 opened reference limit');
      S.check(item.rows.length===docs.length&&item.rows.every((row,j)=>rowId(row)===docs[j]),'Stage3 ciphertext row digest mismatch');
      const byPosition=new Map(),handles=[],identifierKey=rowKey(this.#keys,this.#state.dataset_id,this.#state.sequence,label);
      for(const row of item.rows) {const handle=decryptRow(this.#keys,this.#state,label,pending.words.get(label),row,entry.count,identifierKey);S.check(!byPosition.has(row.position),'Stage3 duplicate row position');byPosition.set(row.position,handle);handles.push(handle);}
      S.check(new Set(handles).size===handles.length,'Stage3 duplicate decrypted posting identity');lists.set(label,{handles,set:new Set(handles),byPosition});
    }
    S.check(Array.isArray(response.clauses)&&response.clauses.length===request.clauses.length,'Stage3 response clause count mismatch');
    const resultHandles=new Set();request.clauses.forEach((clause,i)=>{
      const row=response.clauses[i];S.exact(row,['label','matches']);S.check(row.label===clause.label,'Stage3 selected clause mismatch');
      const selected=lists.get(clause.label),expected=[];
      for(let position=1;position<=clause.count;position++){const handle=selected.byPosition.get(position);S.check(handle,'Stage3 missing decrypted row position');if(clause.term_labels.every(t=>lists.get(t).set.has(handle))){expected.push(position);resultHandles.add(handle);}}
      S.check(S.canonical(row.matches)===S.canonical(expected),'Stage3 completeness clause mismatch');
    });
    const coverageMs=performance.now()-coverageStart,payloads=[];let retrievalMs=0,objectBytes=0;
    if(preparePayloads!==undefined){S.check(typeof preparePayloads==='function','Stage9 invalid payload preparation callback');await preparePayloads([...resultHandles].sort());}
    for(const handle of [...resultHandles].sort()) {
      const packet=clone(await locate(handle));S.check(packet?.descriptor?.context?.document_id===handle&&packet.descriptor.context.dataset_id===this.#state.dataset_id&&packet.descriptor.context.revision===this.#state.sequence,'Stage3 payload identity/revision mismatch');
      S.check(packet.proof.count===this.#state.payload_count,'Stage3 payload manifest count mismatch');
      try {S.verifyLeaf(packet.descriptor,packet.proof,'payload-manifest',this.#state.payload_root);}catch {throw new Error('Stage3 payload membership failed');}
      const t=performance.now(),encoded=await retrieve(packet.descriptor.object_key);retrievalMs+=performance.now()-t;objectBytes+=Buffer.isBuffer(encoded)?encoded.length:Buffer.byteLength(JSON.stringify(encoded));
      const e=Buffer.isBuffer(encoded)?JSON.parse(encoded.toString('utf8')):encoded,plain=JSON.parse(S.decryptPayload(e,this.#keys.KD,packet.descriptor,packet.proof,this.#state,handle).toString('utf8'));S.exact(plain,['schema','document_id','revision','body_b64']);
      S.check(plain.schema===SCHEMA&&plain.revision===this.#state.sequence&&opaque(this.#keys,this.#state.dataset_id,plain.document_id)===handle,'Stage3 decrypted document binding mismatch');
      S.check(typeof plain.body_b64==='string'&&Buffer.from(plain.body_b64,'base64').toString('base64')===plain.body_b64,'Stage3 payload encoding invalid');payloads.push({document_id:plain.document_id,opaque_handle:handle,plaintext:Buffer.from(plain.body_b64,'base64')});
    }
    const release=await this.#reader.observe(this.#state);
    return {verified:true,omission_completeness:true,query_result_soundness:true,payloads,opened_tokens:lists.size,opened_ciphertext_rows:opened,checked_rsa_row_witnesses:0,authentication_scheme:M.SCHEMA,token_generation_ms:pending.token_generation_ms,ciphertext_coverage_and_identifier_verification_ms:coverageMs,payload_retrieval_ms:retrievalMs,encrypted_object_bytes:objectBytes,client_verification_ms:performance.now()-start,blockchain_verification_ms:first.blockchain_verification_ms+release.blockchain_verification_ms,first_observation:first,release_observation:release,formal_composed_privacy_proven:false};
  }
}
module.exports={quadraticCharacter,OPTIMIZATION:'stage17-versioned-merkle-only-authentication-v1',SCHEMA,POLICY,generateKeys,keyword,Stage3Owner,Stage3Server,Stage3Client,rowId,groupElement,scalar,power,field,inverse,G,P,Q,KEY_NAMES};
