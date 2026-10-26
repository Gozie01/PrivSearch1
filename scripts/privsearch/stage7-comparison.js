'use strict';
const crypto=require('node:crypto'),S=require('./stage1-state'),A=require('./audit-v2-protocol'),B=require('./stage3-encrypted-search'),O=require('./stage7-encrypted-search');
const clone=A.clone;
function cleanRequest(r){const x=clone(r);delete x.nonce;return x;}
function cleanResponse(r){const x=clone(r);delete x.nonce;delete x.request_digest;delete x.server_search_ms;return x;}
function digestPayloads(payloads){return S.sha(Buffer.from(JSON.stringify(payloads.map(p=>({document_id:p.document_id,body_sha256:S.sha(p.plaintext)})).sort((a,b)=>a.document_id<b.document_id?-1:a.document_id>b.document_id?1:0))));}
function selectQueries(queries,plan){
 const get=q=>plan.selected_queries.find(p=>p.name===q.name),native=queries.filter(q=>q.origin==='audited-workload'),out=[];
 for(const family of (plan.dataset==='healthcare'?['and_10','and_2']:['and_2','or_3'])){const q=native.find(q=>q.family===family);if(q)out.push(q);}
 const singles=native.filter(q=>q.family==='single_keyword').sort((a,b)=>get(a).opened_posting_references-get(b).opened_posting_references||a.name.localeCompare(b.name));
 if(singles.length)out.push(singles[0]);if(singles.length>1)out.push(singles.at(-1));
 for(const name of ['G_prepared_empty','G_disjoint_and','G_overlap_dnf']){const q=queries.find(q=>q.name===name);if(q)out.push(q);}
 return out.filter((q,i)=>out.findIndex(x=>x.name===q.name)===i);
}
async function runCore(E,candidate,keys,spec){
 const construction=performance.now(),server=new E.Stage3Server(candidate.snapshot),serverConstruction=performance.now()-construction;
 let observations=0;const reader={async observe(state){S.check(S.commitment(state)===candidate.commitment,'Stage7 fixed offline state mismatch');observations++;return {verified:true,sequence:state.sequence,commitment:candidate.commitment,offline_fixed_reference:true,blockchain_verification_ms:0,rpc_calls:0,retry_events:[]};}};
 const start=performance.now(),client=new E.Stage3Client({keys,state:candidate.snapshot.state,envelope:candidate.snapshot.envelope,ownerPublicKey:candidate.ownerPublicKey,metadata:candidate.snapshot.metadata,reader});
 const request=client.createRequest(spec.query),response=server.search(request),r=await client.verifyResponse(response,{proveRows:p=>server.proveRows(p),locate:h=>server.locate(h),retrieve:key=>{S.check(candidate.objects.has(key),'Stage7 missing in-memory encrypted object');return candidate.objects.get(key);}}),elapsed=performance.now()-start;
 S.check(r.verified&&r.omission_completeness&&r.query_result_soundness&&observations===2,'Stage7 offline protocol verification failed');
 const resultDigest=digestPayloads(r.payloads);
 return {metrics:{verified_under_offline_state_reference:true,result_count:r.payloads.length,core_protocol_ms:elapsed,server_construction_ms:serverConstruction,server_search_ms:response.server_search_ms,token_generation_ms:r.token_generation_ms,coverage_identifier_ms:r.ciphertext_coverage_and_identifier_verification_ms,payload_buffer_lookup_ms:r.payload_retrieval_ms,opened_tokens:r.opened_tokens,opened_ciphertext_rows:r.opened_ciphertext_rows,checked_rsa_row_witnesses:r.checked_rsa_row_witnesses,cross_tests:response.cross_tests,offline_observation_calls:observations,rpc_calls:0},resultDigest,request:cleanRequest(request),response:cleanResponse(response)};
}
async function runPair(candidate,keys,spec,reference,order,onResult=()=>{}){
 const results={};
 for(const variant of order){const result=await runCore(variant==='baseline'?B:O,candidate,keys,spec);S.check(result.resultDigest===reference.digest&&result.metrics.result_count===reference.count,'Stage7 original source reference mismatch');results[variant]=result;onResult(variant,result.metrics);}
 S.check(S.canonical(results.baseline.request)===S.canonical(results.optimized.request),'Stage7 request contents differ beyond fresh nonce');
 S.check(S.canonical(results.baseline.response)===S.canonical(results.optimized.response),'Stage7 response contents differ beyond nonce/digest/timing');
 S.check(results.baseline.resultDigest===results.optimized.resultDigest,'Stage7 released plaintext differs');
 return {request_equivalent:true,response_equivalent:true,source_reference_matches:true,baseline_ms:results.baseline.metrics.core_protocol_ms,optimized_ms:results.optimized.metrics.core_protocol_ms,speedup:results.baseline.metrics.core_protocol_ms/results.optimized.metrics.core_protocol_ms};
}
function microbench(count=32){
 S.check(Number.isSafeInteger(count)&&count>=8&&count<=256,'Stage7 microbench size invalid');
 const values=Array.from({length:count},(_,i)=>B.power(B.G,BigInt(i+2))),points=values.map(n=>n.toString(16).padStart(512,'0')),times={baseline:[],optimized:[]};
 for(let trial=0;trial<3;trial++)for(const variant of trial%2?['optimized','baseline']:['baseline','optimized']){const start=performance.now(),E=variant==='baseline'?B:O;for(const point of points)S.check(E.groupElement(point)>1n,'Stage7 microcheck failed');times[variant].push(performance.now()-start);}
 const median=a=>[...a].sort((x,y)=>x-y)[1];return {operations_per_trial:count,trials:3,baseline_ms:times.baseline,optimized_ms:times.optimized,median_speedup:median(times.baseline)/median(times.optimized),scope:'Public subgroup-membership kernel only; not live query latency. No validation-result cache.'};
}
function statistics(rows,pairs){
 const med=a=>{const x=[...a].sort((a,b)=>a-b);return x.length%2?x[(x.length-1)/2]:(x[x.length/2-1]+x[x.length/2])/2;},out=[];
 for(const key of new Set(rows.map(r=>r.dataset+'/'+r.name))){const rr=rows.filter(r=>r.dataset+'/'+r.name===key),pp=pairs.filter(p=>p.dataset+'/'+p.name===key);if(!pp.length)continue;const group={condition:key,complete_pairs:pp.length};for(const variant of ['baseline','optimized']){const r=rr.filter(r=>r.variant===variant&&r.pair_equivalence==='verified');group[variant]={n:r.length,median_core_protocol_ms:med(r.map(r=>r.core_protocol_ms)),median_server_search_ms:med(r.map(r=>r.server_search_ms)),median_token_generation_ms:med(r.map(r=>r.token_generation_ms)),median_coverage_identifier_ms:med(r.map(r=>r.coverage_identifier_ms)),min_core_protocol_ms:Math.min(...r.map(r=>r.core_protocol_ms)),max_core_protocol_ms:Math.max(...r.map(r=>r.core_protocol_ms))};}group.median_paired_speedup=med(pp.map(p=>p.speedup));out.push(group);}return out;
}
module.exports={cleanRequest,cleanResponse,digestPayloads,selectQueries,runCore,runPair,microbench,statistics};
