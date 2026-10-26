'use strict';
const crypto=require('node:crypto'),S=require('./stage1-state'),P=require('./stage9-encrypted-search'),O=require('./stage3-encrypted-search'),B=require('./stage13-hardened-basic');
const SCHEMA='privsearch-stage14-shared-boundary-1',PROFILES=['privsearch','basic-derived'];
const copy=B.copy;
function handle(key,dataset,id){return crypto.createHmac('sha256',key).update(S.canonical([P.SCHEMA,'opaque-document',[dataset,id]])).digest('hex');}
function prepare(documents,words,{pins,datasetId,version,onProgress=()=>{}}){
 const keys=P.generateKeys(),ps=new O.Stage3Owner({keys,pins,datasetId}).prepare(documents,words,{version});
 onProgress('Preparing fresh basic-derived RSA state.');
 const basic=B.prepare(documents.map(({id,keywords})=>({id,keywords})),words,{datasetId,onProgress:p=>onProgress('Basic accumulators '+p.documents_prepared+'/'+p.total)});
 const binding={schema:SCHEMA,basic_manifest_commitment:basic.authorityPins.manifest_commitment,basic_owner_key_digest:S.sha(Buffer.from(basic.authorityPins.owner_public_key)),payload_format:P.SCHEMA,profiles:PROFILES.slice()};
 const metadata={...ps.snapshot.metadata,shared_boundary:binding},built=S.buildState({pins,datasetId,sequence:'1',auditManifest:ps.snapshot.envelope.manifest,ownerPublicKey:ps.ownerPublicKey,metadata,payloadDescriptors:ps.snapshot.payloads});
 const snapshot={...ps.snapshot,state:built.state,metadata,payloads:built.payloads,payload_proofs:built.payloadProofs};
 const common={state:built.state,metadata,envelope:snapshot.envelope,ownerPublicKey:ps.ownerPublicKey};
 const provisions={privsearch:{...common,keys:Object.fromEntries(Object.entries(keys).map(([n,k])=>[n,k.toString('base64')]))},'basic-derived':{...common,basic:basic.clientProvision,authorityPins:basic.authorityPins,identifierKey:keys.KI.toString('base64'),payloadKey:keys.KD.toString('base64')}};
 const publicSnapshot={schema:SCHEMA,privsearch:snapshot,basic:basic.serverData};
 const encoded=JSON.stringify(publicSnapshot);for(const k of Object.values(keys))S.check(!encoded.includes(k.toString('base64'))&&!encoded.includes(k.toString('hex')),'Stage14 key exported to public storage');
 for(const k of Object.values(basic.clientProvision.keys))S.check(!encoded.includes(k),'Stage14 basic key exported to public storage');
 return {publicSnapshot,provisions,objects:ps.objects,candidate:{snapshot:{state:built.state},commitment:built.commitment},public:{schema:SCHEMA,basic:basic.public,state_commitment:built.commitment,shared_payload_objects:ps.objects.size,server_receives_keys:false,common_payload_root:built.state.payload_root,basic_manifest_commitment:basic.authorityPins.manifest_commitment}};
}
function bind(p){
 S.bindAuditState(p.state,p.envelope,p.ownerPublicKey,p.metadata);
 S.check(p.metadata.shared_boundary?.schema===SCHEMA,'Stage14 boundary policy missing');
 S.check(S.canonical(p.metadata.shared_boundary.profiles)===S.canonical(PROFILES)&&p.metadata.shared_boundary.payload_format===P.SCHEMA,'Stage14 boundary policy mismatch');
 const m=p.basic.envelope.manifest;
 S.check(m.dataset_id===p.state.dataset_id&&m.sequence===p.state.sequence,'Stage14 basic state context mismatch');
 S.check(p.metadata.shared_boundary.basic_manifest_commitment===p.authorityPins.manifest_commitment&&p.metadata.shared_boundary.basic_owner_key_digest===S.sha(Buffer.from(p.authorityPins.owner_public_key)),'Stage14 anchored basic authority mismatch');
}
class BasicPayloadClient{
 #p;#basic;#reader;#ki;#kd;
 constructor(provision,reader){this.#p=copy(provision);bind(this.#p);this.#basic=new B.Client(this.#p.basic,this.#p.authorityPins);this.#reader=reader;this.#ki=Buffer.from(this.#p.identifierKey,'base64');this.#kd=Buffer.from(this.#p.payloadKey,'base64');S.check(this.#ki.length===32&&this.#kd.length===32,'Stage14 payload key length');}
 createRequest(query){S.check(Array.isArray(query)&&query.length===1,'Stage14 native conjunction required');return this.#basic.createRequest(query[0]);}
 async verifyResponse(response,{locate,retrieve,preparePayloads}){
  const p=this.#p,first=await this.#reader.observe(p.state),r=this.#basic.verify(response),expected=new Map();
  for(const id of r.matched_identifiers){const h=handle(this.#ki,p.state.dataset_id,id);S.check(!expected.has(h),'Stage14 duplicate result handle');expected.set(h,id);}
  const handles=[...expected.keys()].sort();await preparePayloads(handles);const payloads=[];
  for(const h of handles){const packet=copy(await locate(h));S.exact(packet,['descriptor','proof']);const d=packet.descriptor;
   S.check(d.context.dataset_id===p.state.dataset_id&&d.context.document_id===h&&d.context.revision===p.state.sequence,'Stage14 payload identity/revision mismatch');
   S.check(packet.proof.count===p.state.payload_count,'Stage14 payload count mismatch');S.verifyLeaf(d,packet.proof,'payload-manifest',p.state.payload_root);
   const encoded=await retrieve(d.object_key),e=JSON.parse(encoded.toString('utf8')),plain=JSON.parse(S.decryptPayload(e,this.#kd,d,packet.proof,p.state,h).toString('utf8'));
   S.exact(plain,['schema','document_id','revision','body_b64']);S.check(plain.schema===P.SCHEMA&&plain.revision===p.state.sequence&&plain.document_id===expected.get(h)&&handle(this.#ki,p.state.dataset_id,plain.document_id)===h,'Stage14 plaintext identity mismatch');
   S.check(typeof plain.body_b64==='string'&&Buffer.from(plain.body_b64,'base64').toString('base64')===plain.body_b64,'Stage14 payload encoding mismatch');
   payloads.push({document_id:plain.document_id,opaque_handle:h,plaintext:Buffer.from(plain.body_b64,'base64')});
  }
  const release=await this.#reader.observe(p.state);
  return {verified:true,omission_completeness:true,query_result_soundness:true,payloads,base_rows:r.base_rows,first_observation:first,release_observation:release};
 }
}
function selectQueries(source){const native=source.queries.filter(q=>q.origin.startsWith('audited-workload')),out=native.filter(q=>/^and_\d+$/.test(q.family)),single=native.filter(q=>q.family==='single_keyword').sort((a,b)=>source.reference[a.name].count-source.reference[b.name].count||a.name.localeCompare(b.name))[0];if(single)out.push(single);for(const n of ['G_prepared_empty','G_disjoint_and']){const q=source.queries.find(q=>q.name===n);if(q)out.push(q);}S.check(out.length&&out.every(q=>q.query.length===1),'Stage14 common native query scope');return out;}
module.exports={SCHEMA,PROFILES,copy,handle,prepare,bind,BasicPayloadClient,selectQueries};
