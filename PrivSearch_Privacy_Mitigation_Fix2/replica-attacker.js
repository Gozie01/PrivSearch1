'use strict';
// An explicitly weaker attack surface, justified by the measured storage trace.
// No fabricated zero counts, token labels, access handles or truth mappings are supplied.
const fs=require('node:fs'),crypto=require('node:crypto');
function check(x){if(!x)throw Error('REPLICA_ATTACK_VIEW_INVALID');}
function exact(o,keys){check(o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join('|')===keys.slice().sort().join('|'));}
function attack(p,{randomInt=crypto.randomInt}={}){
  exact(p,['schema','target','observations','reference','known_queries','methods']);check(p.schema==='privsearch-query-blind-replica-view-1');
  exact(p.target,['document_count','capsule_bytes','bootstrap_requests','query_phase_requests','opaque_capsule_sha256']);
  check(Number.isSafeInteger(p.target.document_count)&&p.target.document_count>0&&Number.isSafeInteger(p.target.capsule_bytes)&&p.target.capsule_bytes>=36&&p.target.bootstrap_requests===1&&p.target.query_phase_requests===0&&/^[0-9a-f]{64}$/.test(p.target.opaque_capsule_sha256));
  const r=p.reference;exact(r,r.kind==='catalog'?['kind','document_count','words','counts']:['kind','document_count','words','counts','cooccurrence']);
  check(['catalog','moments'].includes(r.kind)&&Number.isSafeInteger(r.document_count)&&r.document_count>0&&Array.isArray(r.words)&&r.words.length>1&&r.words.length<=1000000&&new Set(r.words).size===r.words.length&&r.words.every(w=>typeof w==='string'&&w.length>0&&w.length<=1024));
  check(Array.isArray(r.counts)&&r.counts.length===r.words.length&&r.counts.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=r.document_count));
  if(r.kind==='moments'){
    check(r.words.length<=128&&Array.isArray(r.cooccurrence)&&r.cooccurrence.length===r.words.length);
    for(let i=0;i<r.words.length;i++){check(Array.isArray(r.cooccurrence[i])&&r.cooccurrence[i].length===r.words.length);for(let j=0;j<r.words.length;j++)check(Number.isSafeInteger(r.cooccurrence[i][j])&&r.cooccurrence[i][j]>=0&&r.cooccurrence[i][j]<=Math.min(r.counts[i],r.counts[j])&&r.cooccurrence[i][j]===r.cooccurrence[j]?.[i]);check(r.cooccurrence[i][i]===r.counts[i]);}
  }
  check(Array.isArray(p.observations)&&p.observations.length>=2&&p.observations.length<=128);const slots=new Set();
  for(const o of p.observations){exact(o,['label']);check(/^[0-9a-f]{64}$/.test(o.label)&&!slots.has(o.label));slots.add(o.label);}
  check(Array.isArray(p.known_queries)&&p.known_queries.length<p.observations.length);const known=new Set(),knownWords=new Set();
  for(const k of p.known_queries){exact(k,['label','word']);check(slots.has(k.label)&&r.words.includes(k.word)&&!known.has(k.label)&&!knownWords.has(k.word));known.add(k.label);knownWords.add(k.word);}
  const expected=r.kind==='catalog'?['unique_count','uniform_random']:['unique_scaled_frequency','normalized_frequency','frequency_plus_seed_cooccurrence','uniform_random'];check(JSON.stringify(p.methods)===JSON.stringify(expected));
  const candidates=r.words.filter(w=>!knownWords.has(w));check(candidates.length>0);
  // A slot has no keyword-dependent feature. Frequency/co-occurrence rules therefore abstain.
  // This is attack inapplicability, not a proof that every possible attacker fails.
  return {schema:'privsearch-real-privacy-attack-answer-1',answers:p.methods.map(method=>({method,predictions:p.observations.filter(o=>!known.has(o.label)).map(o=>({label:o.label,guess:candidates.length===1?candidates[0]:method==='uniform_random'?candidates[randomInt(candidates.length)]:null,candidate_count:candidates.length}))})),audit:{pid:process.pid,application_imported:false,keys_received:false,records_received:false,truth_mapping_received:false,received_fields:Object.keys(p).sort(),environment_names:Object.keys(process.env).sort(),available_query_features:[],nonrandom_rules:'inapplicable_abstain'}};
}
if(require.main===module){try{const input=fs.readFileSync(0);check(input.length<=96*1024*1024);process.stdout.write(JSON.stringify(attack(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input)))));}catch(e){process.stderr.write('REPLICA_ATTACK_VIEW_INVALID');process.exitCode=1;}}
module.exports={attack};
