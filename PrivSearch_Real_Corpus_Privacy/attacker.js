'use strict';
// Separate attack role. Reads a declared public/auxiliary view from stdin only.
// Never imports the application, client keys, corpus, truth scorer or config.
const crypto=require('node:crypto');
const SMALL=['unique_scaled_frequency','normalized_frequency','frequency_plus_seed_cooccurrence','uniform_random'];
const WIDE=['unique_count','uniform_random'],EPS=1e-12;
function check(ok,code){if(!ok)throw Object.assign(new Error(code),{code});}
function exact(o,keys){check(o&&Object.getPrototypeOf(o)===Object.prototype&&Object.keys(o).sort().join('|')===keys.slice().sort().join('|'),'ATTACK_VIEW_FIELDS');}
function integer(n,max=1000000){check(Number.isSafeInteger(n)&&n>=0&&n<=max,'ATTACK_VIEW_INTEGER');}
function hex(s){check(typeof s==='string'&&/^[0-9a-f]{64}$/.test(s),'ATTACK_VIEW_LABEL');}
function validate(p){
 exact(p,['schema','target','observations','reference','known_queries','methods']);check(p.schema==='privsearch-real-privacy-attack-view-1','ATTACK_VIEW_SCHEMA');
 exact(p.target,['document_count','index']);integer(p.target.document_count);check(p.target.document_count>0&&Array.isArray(p.target.index)&&p.target.index.length>0&&p.target.index.length<=1000000,'ATTACK_TARGET_SIZE');const index=new Map();
 for(const e of p.target.index){exact(e,['label','count']);hex(e.label);integer(e.count,p.target.document_count);check(!index.has(e.label),'ATTACK_DUPLICATE_LABEL');index.set(e.label,e.count);}
 check(Array.isArray(p.observations)&&p.observations.length>0&&p.observations.length<=128,'ATTACK_OBSERVATION_SIZE');const observed=new Map();
 for(const o of p.observations){exact(o,['label','handles']);hex(o.label);check(index.has(o.label)&&!observed.has(o.label)&&Array.isArray(o.handles)&&o.handles.length===index.get(o.label),'ATTACK_OBSERVATION_COUNT');o.handles.forEach((h,i)=>{hex(h);check(i===0||o.handles[i-1]<h,'ATTACK_HANDLE_ORDER');});observed.set(o.label,new Set(o.handles));}
 const r=p.reference;check(r&&['moments','catalog'].includes(r.kind),'ATTACK_REFERENCE_KIND');exact(r,r.kind==='moments'?['kind','document_count','words','counts','cooccurrence']:['kind','document_count','words','counts']);integer(r.document_count);check(r.document_count>0&&Array.isArray(r.words)&&r.words.length>0&&r.words.length<=1000000&&Array.isArray(r.counts)&&r.counts.length===r.words.length,'ATTACK_REFERENCE_SIZE');const words=new Map();
 r.words.forEach((w,i)=>{check(typeof w==='string'&&w.length>0&&w.length<=1024&&!words.has(w),'ATTACK_REFERENCE_WORD');words.set(w,i);integer(r.counts[i],r.document_count);});
 if(r.kind==='moments'){check(r.words.length<=128&&Array.isArray(r.cooccurrence)&&r.cooccurrence.length===r.words.length,'ATTACK_MATRIX_SIZE');r.cooccurrence.forEach((row,i)=>{check(Array.isArray(row)&&row.length===r.words.length,'ATTACK_MATRIX_WIDTH');row.forEach((n,j)=>{integer(n,Math.min(r.counts[i],r.counts[j]));check(n===r.cooccurrence[j]?.[i]&&(i!==j||n===r.counts[i]),'ATTACK_MATRIX_COUNTS');});});}
 check(Array.isArray(p.known_queries)&&p.known_queries.length<p.observations.length,'ATTACK_SEED_COUNT');const known=new Map(),knownWords=new Set();
 for(const k of p.known_queries){exact(k,['label','word']);check(observed.has(k.label)&&words.has(k.word)&&!known.has(k.label)&&!knownWords.has(k.word),'ATTACK_SEED_BINDING');known.set(k.label,k.word);knownWords.add(k.word);}
 const methods=r.kind==='moments'?SMALL:WIDE;check(Array.isArray(p.methods)&&p.methods.length===methods.length&&p.methods.every((m,i)=>m===methods[i]),'ATTACK_METHODS');return {index,observed,words,known,knownWords};
}
function intersection(a,b){if(a.size>b.size)[a,b]=[b,a];let n=0;for(const x of a)if(b.has(x))n++;return n;}
function attack(p,{randomInt=crypto.randomInt}={}){
 const ctx=validate(p),r=p.reference,candidates=r.words.flatMap((w,i)=>ctx.knownWords.has(w)?[]:[i]);check(candidates.length>0,'ATTACK_NO_CANDIDATES');
 const byCount=new Map();for(const i of candidates){const count=r.counts[i];if(!byCount.has(count))byCount.set(count,[]);byCount.get(count).push(i);}
 const targetQueries=p.observations.filter(o=>!ctx.known.has(o.label)),answers=[];
 for(const method of p.methods){const predictions=[];
  for(const o of targetQueries){let best=[];
   if(method==='uniform_random')best=[candidates[randomInt(candidates.length)]];
   else if(method==='unique_count')best=byCount.get(ctx.index.get(o.label))||[];
   else if(method==='unique_scaled_frequency'){
    const count=ctx.index.get(o.label)*r.document_count/p.target.document_count;
    const rounded=Math.round(count);if(Math.abs(count-rounded)<=EPS)best=byCount.get(rounded)||[];
   }else{
    const frequency=ctx.index.get(o.label)/p.target.document_count,seedValues=p.known_queries.map(s=>intersection(ctx.observed.get(o.label),ctx.observed.get(s.label))/p.target.document_count);let lowest=Infinity;
    for(const i of candidates){let score=(frequency-r.counts[i]/r.document_count)**2;
     if(method==='frequency_plus_seed_cooccurrence')for(let j=0;j<p.known_queries.length;j++){const refIndex=ctx.words.get(p.known_queries[j].word);score+=(seedValues[j]-r.cooccurrence[i][refIndex]/r.document_count)**2;}
     if(score<lowest-EPS){lowest=score;best=[i];}else if(Math.abs(score-lowest)<=EPS)best.push(i);
    }
   }
   predictions.push({label:o.label,guess:best.length===1?r.words[best[0]]:null,candidate_count:method==='uniform_random'?candidates.length:best.length});
  }answers.push({method,predictions});
 }
 return {schema:'privsearch-real-privacy-attack-answer-1',answers,audit:{pid:process.pid,received_fields:Object.keys(p).sort(),application_imported:false,keys_received:false,records_received:false,truth_mapping_received:false,environment_names:Object.keys(process.env).sort()}};
}
if(require.main===module){try{const bytes=require('node:fs').readFileSync(0);check(bytes.length<=96*1024**2,'ATTACK_INPUT_LIMIT');const result=attack(JSON.parse(bytes.toString('utf8')));process.stdout.write(JSON.stringify(result));}catch(e){console.error(typeof e.code==='string'&&/^[A-Z_]+$/.test(e.code)?e.code:'ATTACK_ROLE_FAILED');process.exitCode=1;}}
module.exports={SMALL,WIDE,validate,attack,intersection};
