'use strict';
// Full-posting authenticated opening baseline. This is not a compact proof or
// an encrypted-search privacy protocol. The owner must commit correct postings.
const {performance}=require('node:perf_hooks');
const S=require('./stage1-state'),audit=require('./audit-v2-protocol');
const {Stage1Client}=require('./stage1-client');
const SCHEMA='privsearch-full-posting-completeness-v1';
const POLICY=Object.freeze({scheme:SCHEMA,semantics:'token-dnf-v1',max_clauses:64,max_query_token_references:128,max_opened_posting_references:1000000,prepared_tokens_only:true});
const copy=v=>JSON.parse(S.canonical(v));
function checkedQuery(query) {
  S.check(Array.isArray(query)&&query.length>0&&query.length<=POLICY.max_clauses,'Completeness query clause limit');
  S.check(query.every(c=>Array.isArray(c)&&c.length>0)&&query.reduce((n,c)=>n+c.length,0)<=POLICY.max_query_token_references,'Completeness query token limit');
  return audit.canonicalQuery(query);
}
function checkedDocs(docs) {
  S.check(Array.isArray(docs)&&docs.length<=POLICY.max_opened_posting_references,'Completeness posting size limit');
  S.check(docs.every(d=>typeof d==='string'&&d.length>0&&d.length<=1024),'Completeness document identity invalid');
  S.check(S.canonical(docs)===S.canonical(audit.canonicalDocs(docs)),'Completeness postings must be sorted and unique');
  return docs;
}
// Identical encoding to the unchanged audit-v2 hashDocs implementation.
function postingDigest(docs) {return audit.digest([audit.SCHEMA,'posting-list',docs]);}
function coverageLeaf(e) {return {token:e.token,count:e.count,posting_digest:e.posting_digest};}
function buildCoveragePacket(state,serverData,query) {
  S.validateState(state);query=checkedQuery(query);
  const entries=serverData.manifest.entries.slice().sort((a,b)=>a.token<b.token?-1:a.token>b.token?1:0),leaves=entries.map(coverageLeaf),tree=S.tree(leaves,'coverage');
  S.check(entries.length===state.posting_count&&tree.root===state.coverage_root,'Completeness server coverage differs from state');
  S.check(audit.digest(serverData.manifest)===state.index_snapshot_digest,'Completeness server snapshot differs from state');
  const positions=new Map(entries.map((e,i)=>[e.token,i]));
  const openings=[...new Set(query.flat())].sort().map(token=>{
    const index=positions.get(token),posting=serverData.lists.get(token);
    S.check(index!==undefined&&posting,'Completeness query token not prepared');
    const docs=checkedDocs(posting.docs.slice()),leaf=leaves[index];
    S.check(docs.length===leaf.count&&postingDigest(docs)===leaf.posting_digest,'Completeness server posting differs from commitment');
    return {leaf:copy(leaf),docs,proof:tree.proof(index)};
  });
  return {schema:SCHEMA,dataset_id:state.dataset_id,sequence:state.sequence,index_snapshot_digest:state.index_snapshot_digest,coverage_root:state.coverage_root,query_digest:audit.digest(query),openings};
}
function verifyCoverage(state,query,answer,packet) {
  const start=performance.now();S.validateState(state);query=checkedQuery(query);
  S.exact(packet,['schema','dataset_id','sequence','index_snapshot_digest','coverage_root','query_digest','openings']);
  S.check(packet.schema===SCHEMA,'Completeness schema mismatch');
  S.check(packet.dataset_id===state.dataset_id&&packet.sequence===state.sequence&&packet.index_snapshot_digest===state.index_snapshot_digest&&packet.coverage_root===state.coverage_root,'Completeness state binding mismatch');
  S.check(packet.query_digest===audit.digest(query),'Completeness query binding mismatch');
  const tokens=[...new Set(query.flat())].sort();
  S.check(Array.isArray(packet.openings)&&packet.openings.length===tokens.length,'Completeness missing or extra posting opening');
  const lists=new Map();let references=0;
  packet.openings.forEach((opening,i)=>{
    S.exact(opening,['leaf','docs','proof']);S.exact(opening.leaf,['token','count','posting_digest']);
    const leaf=opening.leaf;S.hex(leaf.token);S.hex(leaf.posting_digest);
    S.check(leaf.token===tokens[i],'Completeness duplicate, substituted or unordered token');
    S.check(Number.isSafeInteger(leaf.count)&&leaf.count>=0&&leaf.count<=POLICY.max_opened_posting_references,'Completeness posting count invalid');
    checkedDocs(opening.docs);references+=opening.docs.length;
    S.check(references<=POLICY.max_opened_posting_references,'Completeness opened reference limit');
    S.check(opening.docs.length===leaf.count,'Completeness posting count mismatch');
    S.check(postingDigest(opening.docs)===leaf.posting_digest,'Completeness posting digest mismatch');
    S.check(opening.proof.count===state.posting_count,'Completeness coverage manifest count mismatch');
    try {S.verifyLeaf(leaf,opening.proof,'coverage',state.coverage_root);}catch {throw new Error('Completeness coverage membership failed');}
    lists.set(leaf.token,{docs:opening.docs,set:new Set(opening.docs)});
  });
  const clauseDocs=query.map(clause=>{
    const postings=clause.map(t=>lists.get(t)).sort((a,b)=>a.docs.length-b.docs.length);
    return postings[0].docs.filter(id=>postings.every(p=>p.set.has(id)));
  });
  const resultDocs=audit.canonicalDocs(clauseDocs.flat());
  S.exact(answer,['schema','version','owner_commitment','query_digest','clause_docs','result_docs']);
  S.check(answer.schema===audit.SCHEMA&&answer.version===state.snapshot_version&&answer.owner_commitment===state.index_snapshot_digest&&answer.query_digest===packet.query_digest,'Completeness answer binding mismatch');
  S.check(Array.isArray(answer.clause_docs)&&answer.clause_docs.length===clauseDocs.length,'Completeness clause count mismatch');
  answer.clause_docs.forEach(checkedDocs);checkedDocs(answer.result_docs);
  S.check(S.canonical(answer.clause_docs)===S.canonical(clauseDocs),'Completeness clause result mismatch');
  S.check(S.canonical(answer.result_docs)===S.canonical(resultDocs),'Completeness final result mismatch');
  return {result_docs:resultDocs,clause_docs:clauseDocs,opened_tokens:tokens.length,opened_posting_references:references,coverage_packet_bytes:Buffer.byteLength(S.canonical(packet)),completeness_verification_ms:performance.now()-start};
}
class Stage2Client {
  #state;#base;#pending=new Map();
  constructor(options) {
    S.check(S.canonical(options.metadata?.completeness)===S.canonical(POLICY),'Completeness policy must be committed in query metadata');
    this.#state=copy(options.state);this.#base=new Stage1Client(options);
  }
  createChallenge(answer,query,coveragePacket) {
    S.check(this.#pending.size<64,'Completeness pending challenge limit');
    // Audit-v2 binds the exact JSON encoding, including object key order.
    const a=audit.clone(answer),q=copy(checkedQuery(query)),coverage=verifyCoverage(this.#state,q,a,coveragePacket);
    const challenge=this.#base.createChallenge(a,q);
    this.#pending.set(challenge.nonce,coverage);return challenge;
  }
  async verify(proof,payloadPackets,retrieve) {
    const c=proof&&this.#pending.get(proof.nonce);S.check(c,'Completeness unknown or consumed challenge');this.#pending.delete(proof.nonce);
    // Stage1Client independently checks the committed state before retrieving
    // payloads and again before releasing them. Only then is completeness true.
    const result=await this.#base.verify(proof,payloadPackets,retrieve);
    S.check(S.canonical(result.result_docs)===S.canonical(c.result_docs),'Completeness verified result changed');
    return {...result,omission_completeness:true,query_result_soundness:true,completeness_scheme:SCHEMA,opened_tokens:c.opened_tokens,opened_posting_references:c.opened_posting_references,coverage_packet_bytes:c.coverage_packet_bytes,completeness_verification_ms:c.completeness_verification_ms,encrypted_search_privacy:false};
  }
}
module.exports={SCHEMA,POLICY,postingDigest,checkedQuery,buildCoveragePacket,verifyCoverage,Stage2Client};
