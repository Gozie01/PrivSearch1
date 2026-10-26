'use strict';
// Explicit private catalog semantics, not a learned semantic model or arbitrary unprepared search.
const crypto=require('node:crypto'),S=require('./stage1-state'),E=require('./stage17-merkle-search');
const SCHEMA='privsearch-stage17-private-expansion-policy-1';
function normalizePolicy(p){
 p=JSON.parse(JSON.stringify(p));S.exact(p,['schema','empty_token','vocabulary','numeric_fields','fuzzy_vocabulary','semantic_v1']);S.check(p.schema===SCHEMA,'Stage17 planner schema');
 S.check(Array.isArray(p.vocabulary)&&p.vocabulary.length>0&&p.vocabulary.length<=100000,'Stage17 planner vocabulary bound');p.vocabulary=p.vocabulary.map(E.keyword).sort();S.check(new Set(p.vocabulary).size===p.vocabulary.length,'Stage17 normalized planner collision');
 const words=new Set(p.vocabulary),token=w=>{const n=E.keyword(w);S.check(words.has(n),'Stage17 planner token not prepared');return n;};p.empty_token=token(p.empty_token);
 S.check(Array.isArray(p.numeric_fields)&&p.numeric_fields.length<=128,'Stage17 field bound');const fields=new Set();p.numeric_fields=p.numeric_fields.map(f=>{S.exact(f,['name','values']);const name=E.keyword(f.name);S.check(!fields.has(name)&&Array.isArray(f.values)&&f.values.length<=100000,'Stage17 numeric field');fields.add(name);const values=f.values.map(v=>{S.exact(v,['value','token']);S.check(Number.isSafeInteger(v.value),'Stage17 integer range value');return {value:v.value,token:token(v.token)};}).sort((a,b)=>a.value-b.value);S.check(new Set(values.map(v=>v.value)).size===values.length&&new Set(values.map(v=>v.token)).size===values.length,'Stage17 duplicate numeric value/token');return {name,values};}).sort((a,b)=>a.name.localeCompare(b.name));
 S.check(Array.isArray(p.fuzzy_vocabulary)&&p.fuzzy_vocabulary.length<=100000,'Stage17 fuzzy vocabulary bound');p.fuzzy_vocabulary=p.fuzzy_vocabulary.map(token).sort();S.check(new Set(p.fuzzy_vocabulary).size===p.fuzzy_vocabulary.length,'Stage17 fuzzy normalized collision');
 S.check(Array.isArray(p.semantic_v1)&&p.semantic_v1.length<=100000,'Stage17 semantic map bound');const aliases=new Set();p.semantic_v1=p.semantic_v1.map(v=>{S.exact(v,['term','tokens']);const term=E.keyword(v.term);S.check(!aliases.has(term)&&Array.isArray(v.tokens)&&v.tokens.length>0,'Stage17 semantic alias');aliases.add(term);const tokens=v.tokens.map(token).sort();S.check(new Set(tokens).size===tokens.length,'Stage17 semantic token collision');return {term,tokens};}).sort((a,b)=>a.term.localeCompare(b.term));return p;
}
function commitment(policy,key){S.check(Buffer.isBuffer(key)&&key.length===32,'Stage17 private planner commitment key required');return crypto.createHmac('sha256',key).update(S.canonical([SCHEMA,'private-planner-binding',normalizePolicy(policy)])).digest('hex');}
function editDistance(a,b){const aa=Array.from(a),bb=Array.from(b);S.check(aa.length<=128&&bb.length<=128,'Stage17 fuzzy text bound');let row=Array.from({length:bb.length+1},(_,i)=>i);for(let i=0;i<aa.length;i++){const next=[i+1];for(let j=0;j<bb.length;j++)next.push(Math.min(next[j]+1,row[j+1]+1,row[j]+(aa[i]===bb[j]?0:1)));row=next;}return row[bb.length];}
function plan(policy,query){const p=normalizePolicy(policy),vocab=new Set(p.vocabulary);let words;
 S.check(query&&typeof query==='object','Stage17 planner query');
 if(query.family==='range'){S.exact(query,['family','field','lower','upper']);S.check(Number.isSafeInteger(query.lower)&&Number.isSafeInteger(query.upper)&&query.lower<=query.upper,'Stage17 inclusive integer range');const field=p.numeric_fields.find(f=>f.name===E.keyword(query.field));S.check(field,'Stage17 unknown range field');words=field.values.filter(v=>v.value>=query.lower&&v.value<=query.upper).map(v=>v.token);}
 else if(query.family==='fuzzy'){S.exact(query,['family','term','max_edits']);S.check(Number.isSafeInteger(query.max_edits)&&query.max_edits>=0&&query.max_edits<=2,'Stage17 fuzzy edit budget');const term=E.keyword(query.term);words=p.fuzzy_vocabulary.filter(w=>editDistance(term,w)<=query.max_edits);}
 else if(query.family==='semantic_v1'){S.exact(query,['family','term']);const item=p.semantic_v1.find(s=>s.term===E.keyword(query.term));S.check(item,'Stage17 semantic alias not declared');words=item.tokens;}
 else if(query.family==='dnf'){S.exact(query,['family','clauses']);S.check(Array.isArray(query.clauses)&&query.clauses.length>0&&query.clauses.length<=64,'Stage17 native clause bound');const clauses=query.clauses.map(c=>{S.check(Array.isArray(c)&&c.length>0,'Stage17 nonempty clause');const out=c.map(E.keyword);S.check(out.every(t=>vocab.has(t))&&new Set(out).size===out.length,'Stage17 native prepared tokens');return out;});S.check(clauses.reduce((a,c)=>a+c.length,0)<=128,'STAGE17_EXPANSION_OVERSIZED');return clauses;}
 else throw new Error('Stage17 unsupported planner family');
 words=[...new Set(words)].sort();S.check(words.length<=64,'STAGE17_EXPANSION_OVERSIZED: '+words.length+' clauses; maximum 64; no truncation');return (words.length?words:[p.empty_token]).map(w=>[w]);
}
function validateDocuments(policy,documents){const p=normalizePolicy(policy),known=new Set(p.vocabulary);S.check(documents.every(d=>d.keywords.every(w=>known.has(E.keyword(w)))&&!d.keywords.map(E.keyword).includes(p.empty_token)),'Stage17 planner document/empty-token invariant');return p;}
class PlannedClient{
 #policy;#core;
 constructor(options,policy){this.#policy=normalizePolicy(policy);S.check(options.metadata?.planner_commitment===commitment(this.#policy,options.keys?.KC),'Stage17 expansion policy differs from committed metadata');this.#core=new E.Stage3Client(options);}
 createRequest(query){return this.#core.createRequest(plan(this.#policy,query));}
 verifyResponse(reply,callbacks){return this.#core.verifyResponse(reply,callbacks);}
}
module.exports={SCHEMA,normalizePolicy,commitment,editDistance,plan,validateDocuments,PlannedClient};
