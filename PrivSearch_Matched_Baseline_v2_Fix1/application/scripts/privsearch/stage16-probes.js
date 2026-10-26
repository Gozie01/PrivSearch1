'use strict';
// Small synthetic characterizations of the unchanged implementation, not a privacy proof.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const S=require('./stage1-state'),E=require('./stage9-encrypted-search'),B=require('./stage13-hardened-basic'),X=require('./stage14-boundary');
function fixture(){
 const pins={chainId:'31337',genesisHash:'a'.repeat(64),contract:'0x'+'b'.repeat(40),owner:'0x'+'c'.repeat(40),codeHash:S.sha(Buffer.from('6000','hex')),finality:{kind:'confirmations',depth:1},blockSelector:'eip1898'};
 const words=['alpha','beta','gamma','delta','epsilon','zeta','eta','theta','empty','island'];
 const documents=Array.from({length:8},(_,i)=>({id:'stage16-synthetic-'+i,keywords:i<6?words.slice(0,8):i===6?['alpha']:['island'],body:Buffer.from([0,255,i,13,10])}));
 const prepared=X.prepare(documents,words,{pins,datasetId:'d'.repeat(64),version:'stage16-characterization'});
 return {pins,words,documents,prepared};
}
function client(f,reader){const p=f.prepared.provisions.privsearch;return new E.Stage3Client({...p,keys:Object.fromEntries(Object.entries(p.keys).map(([k,v])=>[k,Buffer.from(v,'base64')])),reader});}
function stableRequest(r){const x=X.copy(r);delete x.nonce;return x;}
async function probes(){
 const f=fixture(),p=f.prepared,server=new E.Stage3Server(p.publicSnapshot.privsearch),checks=[],work=[];
 const record=(id,evidence)=>checks.push({id,status:'OBSERVED_AS_EXPECTED',evidence});
 const reader={observe:async()=>({verified:true,blockchain_verification_ms:0})}; // Synthetic trusted-reader stub only; no chain-security inference.
 const c=client(f,reader),q=[['alpha','beta']],r1=c.createRequest(q),r2=c.createRequest(q);
 assert.notEqual(r1.nonce,r2.nonce);assert.deepEqual(stableRequest(r1),stableRequest(r2));
 record('P16-QUERY-LINKABILITY',{fresh_nonces:true,all_other_request_fields_repeat:true,scope:'Same dataset, revision, keys and normalized query. No query unlinkability claim.'});
 const a=server.search(r1),coverageRows=a.coverage.reduce((n,x)=>n+x.rows.length,0);
 const verified=await c.verifyResponse(a,{proveRows:x=>server.proveRows(x),locate:h=>server.locate(h),retrieve:k=>p.objects.get(k)});
 assert.equal(verified.payloads.length,6);assert.equal(coverageRows,13);assert.equal(verified.opened_ciphertext_rows,13);
 assert.equal(verified.formal_composed_privacy_proven,false);
 await assert.rejects(c.verifyResponse(a,{}),/unknown or consumed/);
 record('P16-FULL-OPENINGS',{opened_posting_rows:coverageRows,returned_payloads:verified.payloads.length,client_holds_all_search_keys:true,scope:'All queried posting handles are decrypted internally, including nonmatching handles. This is broader disclosure to an authorized client than final results alone.'});
 const view=p.publicSnapshot.basic,context=view.envelope.manifest,dictionary=['alpha','beta','gamma','delta','epsilon','zeta','eta','theta','empty','island','absent-guess'];
 // The attack uses public context and keyword products only, never client keys or IDs.
 const recovered=view.documents.map(d=>dictionary.filter(w=>BigInt('0x'+d.keyword_product)%B.prime(context,'keyword',w)===0n));
 const expected=f.documents.map(d=>d.keywords.slice().sort().join(',')).sort();
 assert.deepEqual(recovered.map(ws=>ws.slice().sort().join(',')).sort(),expected);
 const bp=new B.Client(p.provisions['basic-derived'].basic,p.provisions['basic-derived'].authorityPins),br=bp.createRequest(['alpha','beta']);
 const remaining=dictionary.filter(w=>BigInt('0x'+br.query_product)%B.prime(context,'keyword',w)===0n);
 assert.equal(remaining.length,1);assert(['alpha','beta'].includes(remaining[0]));
 record('P16-BASIC-DICTIONARY',{public_document_products_examined:recovered.length,dictionary_candidates:dictionary.length,exact_keyword_incidence_multiset_recovered:true,nonbase_query_term_recovered:true,scope:'Dictionary membership recovery for basic-derived public keyword products. This finding concerns the implemented profile; no claim about the published SeaCQ construction.'});
 const tables=p.publicSnapshot.privsearch.server_data.tables;
 assert.equal(tables.length,f.words.length);assert.equal(tables.reduce((n,t)=>n+t.rows.length,0),50);
 record('P16-PUBLIC-SHAPE',{prepared_tables:tables.length,visible_posting_rows:50,visible_payload_descriptors:p.publicSnapshot.privsearch.payloads.length,stable_payload_locators:true,cohosted_basic_profile:true,scope:'Counts, ciphertext sizes, table equality, object access and a second profile are visible in the paired-study server/storage view. Co-hosting does not establish standalone privacy.'});
 let omittedProves=0,omittedRetrievals=0;const omissionClient=client(f,reader),omission=server.search(omissionClient.createRequest(q));omission.coverage[0].rows.pop();
 await assert.rejects(omissionClient.verifyResponse(omission,{proveRows:()=>{omittedProves++;throw new Error('should not prove');},retrieve:()=>{omittedRetrievals++;}}),/row digest mismatch/);
 assert.equal(omittedProves+omittedRetrievals,0);
 record('P16-COVERAGE-BEFORE-RSA',{truncated_opening_rejected:true,rsa_callbacks:omittedProves,payload_retrievals:omittedRetrievals,scope:'Full anchored posting openings enforce this check before sampled RSA. This does not establish RSA setup soundness.'});
 for(const k of [1,2,4,8]){
  const cc=client(f,reader),req=cc.createRequest([f.words.slice(0,k)]),reply=server.search(req),n=req.clauses[0].count;
  const points=req.clauses[0].xtokens.reduce((sum,x)=>sum+x.points.length,0),opened=reply.coverage.reduce((sum,x)=>sum+x.rows.length,0);
  assert.equal(points,n*(k-1));assert.equal(reply.cross_tests,points);
  const v=await cc.verifyResponse(reply,{proveRows:x=>server.proveRows(x),locate:h=>server.locate(h),retrieve:key=>p.objects.get(key)});
  assert.equal(v.opened_ciphertext_rows,opened);assert.equal(v.opened_tokens,k);
  assert.deepEqual(v.payloads.map(x=>x.document_id).sort(),f.documents.filter(d=>f.words.slice(0,k).every(w=>d.keywords.includes(w))).map(d=>d.id).sort());
  work.push({terms:k,base_rows:n,request_group_exponentiations:points,server_cross_tests:reply.cross_tests,opened_ciphertext_rows:opened,rsa_callbacks:k,returned_payloads:v.payloads.length,request_json_bytes:Buffer.byteLength(JSON.stringify(req)),response_json_bytes:Buffer.byteLength(JSON.stringify(reply))});
 }
 for(const query of [[['empty']],[['alpha','island']]]){let reads=0;const cc=client(f,reader),v=await cc.verifyResponse(server.search(cc.createRequest(query)),{proveRows:x=>server.proveRows(x),locate:h=>server.locate(h),retrieve:key=>{reads++;return p.objects.get(key);}});assert.equal(v.payloads.length,0);assert.equal(reads,0);}
 record('P16-ZERO-RESULTS',{prepared_empty_and_disjoint_verified:true,payload_retrievals:0,scope:'An empty result can still require nonempty posting openings for disjoint terms.'});
 const unknown=client(f,reader);assert.throws(()=>unknown.createRequest([['unprepared']]),/not prepared/);assert.throws(()=>unknown.createRequest([[{range:[1,10]}]]),/keyword must be text/);
 record('P16-QUERY-SCOPE',{unprepared_keyword_rejected:true,range_object_rejected:true,scope:'Prepared token DNF only; external range, fuzzy and semantic expansion correctness is not established.'});
 // Show the authority limit: an owner can consistently encrypt a new body. The client authenticates that body, not external truth.
 const altered=X.prepare(f.documents.map((d,i)=>({...d,body:i===0?Buffer.from('owner-chosen synthetic replacement'):d.body})),f.words,{pins:f.pins,datasetId:'e'.repeat(64),version:'stage16-owner-authority'});
 const af={...f,prepared:altered},as=new E.Stage3Server(altered.publicSnapshot.privsearch),ac=client(af,reader),av=await ac.verifyResponse(as.search(ac.createRequest([['alpha']])),{proveRows:x=>as.proveRows(x),locate:h=>as.locate(h),retrieve:key=>altered.objects.get(key)});
 assert.equal(av.payloads.find(d=>d.document_id==='stage16-synthetic-0').plaintext.toString(),'owner-chosen synthetic replacement');
 record('P16-OWNER-AUTHORITY',{honestly_committed_owner_chosen_body_accepted:true,scope:'Trusted-reader synthetic experiment. Cryptography authenticates owner commitments; external corpus truth, signing-key compromise and malicious-authority resistance are not established.'});
 const manifest=p.publicSnapshot.privsearch.envelope.manifest;
 record('P16-RSA-PROVENANCE',{modulus_bits:BigInt('0x'+manifest.parameters.modulus_hex).toString(2).length,fixed_legacy_modulus:true,factor_disposal_established:false,scope:'Provenance limitation from frozen audit-v2-protocol.js. No factoring attempt or exploit is claimed.'});
 return {schema:'privsearch-stage16-characterization-1',synthetic:true,live_rpc_calls:0,service_connections:0,transactions:0,checks,work_growth:work,work_scope:'Deterministic operation counts and JSON body sizes on eight synthetic documents. No speedup ablation, large-corpus timing or security proof.',formal_composed_privacy_proven:false};
}
module.exports={probes,fixture,client,stableRequest};
