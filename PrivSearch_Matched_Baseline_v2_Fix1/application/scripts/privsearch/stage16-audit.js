'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),copy=x=>JSON.parse(JSON.stringify(x));
function check(ok,message){if(!ok)throw new Error('STAGE16_'+message);}
function readBounded(file,max=64*1024*1024){const st=fs.lstatSync(file);check(st.isFile()&&!st.isSymbolicLink()&&st.size<=max,'INPUT_FILE_OR_SIZE');return fs.readFileSync(file);}
function sourceFile(root,relative){check(typeof relative==='string'&&/^[A-Za-z0-9_.\/-]+$/.test(relative)&&!relative.split('/').some(x=>x==='.'||x==='..'||!x),'UNSAFE_SOURCE_PATH');const base=path.resolve(root);let target=base;for(const part of relative.split('/')){target=path.join(target,part);check(!fs.lstatSync(target).isSymbolicLink(),'LINKED_SOURCE_INPUT');}return target;}
function verifySources(root,entries){check(Array.isArray(entries)&&entries.length&&new Set(entries.map(e=>e.path)).size===entries.length,'SOURCE_MANIFEST');return entries.map(e=>{check(/^[a-f0-9]{64}$/.test(e.sha256),'SOURCE_HASH_FORMAT');const actual=sha(readBounded(sourceFile(root,e.path)));check(actual===e.sha256,'SOURCE_CHANGED: '+e.path);return {path:e.path,sha256:actual};});}
function approvedSummary(file,pin){const raw=readBounded(file);check(sha(raw)===pin,'UNAPPROVED_STAGE15_EVIDENCE');return JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,''));}
function med(values){const a=values.slice().sort((x,y)=>x-y);check(a.length>0&&a.every(x=>Number.isFinite(x)&&x>=0),'INVALID_METRIC');const h=a.length>>1;return a.length%2?a[h]:(a[h-1]+a[h])/2;}
function near(a,b){return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-6,Math.abs(b)*1e-10);}
function good(r){return r.accepted===true&&r.verified===true&&r.exact_original_payload_set_match===true;}
function measured(r){return r.phase==='serial'||r.phase==='concurrency';}
function key(r){return [r.dataset,r.phase,r.name,r.profile,r.concurrency].join('/');}
function validateEvidence(s){
 check(s.status==='STAGE15_IMPLEMENTATION_STUDY_COMPLETED'&&s.simulated===false&&s.publication_fix==='15.0.1','STAGE15_STATUS');
 for(const flag of ['published_seacq_comparison_qualified','daks_comparison_qualified','full_dynamic_seacq','paper_privacy_equivalence_established','matched_assurance_comparison_ready'])check(s[flag]===false,'OVERCLAIMED_PRIOR_SCOPE');
 check(s.prior_evidence.stage11_prior_failures_retained===3&&s.prior_evidence.published_baseline_comparison_still_blocked===true,'PRIOR_FAILURES_OR_BASELINE_SCOPE');
 assert.deepEqual(s.requested_corpora,['healthcare','enron']);assert.deepEqual(s.profiles,['privsearch','basic-derived']);
 const jobs=s.plans.flatMap(p=>p.blocks.flatMap(b=>b.jobs)),byId=new Map(jobs.map(j=>[j.job_id,j]));
 check(byId.size===jobs.length&&new Set(s.started_job_ids).size===s.started_job_ids.length,'DUPLICATE_PLAN_OR_START');
 check(jobs.length===1288&&s.started_job_ids.length===1288&&s.rows.length===1288,'JOB_DENOMINATORS');
 check(new Set(s.rows.map(r=>r.job_id)).size===s.rows.length,'DUPLICATE_COMPLETION');
 const starts=new Set(s.started_job_ids);check([...starts].every(id=>byId.has(id)),'UNPLANNED_START');
 const groups=new Map(),pairs=new Map(),perCorpus=new Map(s.datasets.map(d=>[d.dataset,d]));let retries=0;
 check(perCorpus.size===2,'CORPUS_COUNT');
 for(const r of s.rows){
  const j=byId.get(r.job_id);check(j&&starts.has(r.job_id),'UNPLANNED_COMPLETION');
  for(const f of ['dataset','profile','name','phase','concurrency','expected','trial','pair_id','fault'])check(r[f]===j[f],'JOB_BINDING_'+f);
  if(j.expected==='reject'){check(r.expected_rejection_verified===true&&r.no_result_released===true&&!r.accepted,'ACCEPTED_ATTACK');}
  else{
   check(good(r),'UNVERIFIED_HONEST_RESULT');
   const ds=perCorpus.get(r.dataset),query=ds.selected_queries.find(q=>q.name===r.name);check(query&&query.result_count===r.result_count&&r.payload_items===r.result_count,'PAYLOAD_REFERENCE_COUNT');
   if(r.result_count===0)check(r.payload_pages===0,'ZERO_RESULT_RETRIEVAL');
   for(const o of [r.first_observation,r.release_observation]){check(o&&o.verified===true&&o.commitment===ds.public.state_commitment&&o.sequence==='1'&&o.block_selector==='eip1898'&&o.finality.kind==='confirmations'&&o.finality.depth===1,'OBSERVATION_POLICY');check(o.observation_attempts>=1&&o.observation_attempts<=3&&o.retry_events.length===o.observation_attempts-1,'OBSERVATION_RETRY_BUDGET');retries+=o.retry_events.length;}
   check(near(r.query_setup_ms+r.create_request_ms+r.search_http_ms+r.verify_response_ms,r.total_verified_query_ms),'TOP_LEVEL_TIMING_PARTITION');
   check(near(r.chain_observation_ms+r.proof_callback_ms+r.payload_batch_io_ms+r.verify_local_ms,r.verify_response_ms),'VERIFIER_TIMING_PARTITION');
  }
  if(measured(r)){const k=key(r);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
  if(r.phase==='serial'){const k=r.pair_id;if(!pairs.has(k))pairs.set(k,[]);pairs.get(k).push(r);}
 }
 const computed={planned:jobs.length,started:starts.size,completed:s.rows.length,verified_payload_exchanges:s.rows.filter(good).length,expected_rejections:s.rows.filter(r=>r.expected_rejection_verified).length,unexpected_controls:0,measured_attempts:s.rows.filter(measured).length,measured_verified:s.rows.filter(r=>measured(r)&&good(r)).length,measured_failed:s.rows.filter(r=>measured(r)&&!good(r)).length,unfinished:0,not_started:0};assert.deepEqual(s.accounting,computed);
 check(computed.measured_verified===1200&&computed.expected_rejections===56&&computed.verified_payload_exchanges===1232,'EXPECTED_COUNTS');
 const serialGroups=[],concurrentGroups=[];check(s.statistics.length===groups.size&&groups.size===44,'STATISTIC_GROUP_DENOMINATOR');
 for(const [k,rr] of groups){
  const prior=s.statistics.find(g=>g.group===k);check(prior&&prior.planned===rr.length&&prior.completed===rr.length&&prior.verified===rr.length&&prior.failed===0&&prior.not_completed===0,'STATISTIC_DENOMINATOR');
  const metrics={};for(const [name,stats] of Object.entries(prior.metrics)){
   const values=rr.map(r=>r[name]).filter(v=>v!==null&&v!==undefined);check(stats.n===values.length,'METRIC_DENOMINATOR');if(!values.length)continue;
   const sorted=values.slice().sort((a,b)=>a-b),median=med(values);check(near(stats.median,median),'METRIC_MEDIAN');check(near(stats.mean,values.reduce((a,b)=>a+b,0)/values.length),'METRIC_MEAN');
   if(values.length>=20&&stats.unit!=='ratio')check(near(stats.empirical_p95,sorted[Math.ceil(.95*values.length)-1]),'METRIC_P95');else check(!Object.hasOwn(stats,'empirical_p95'),'UNSUPPORTED_P95');
   if(rr[0].phase==='concurrency')check(!Object.hasOwn(stats,'median_trial_bootstrap_95_ci')&&!Object.hasOwn(stats,'bootstrap_resamples'),'IID_CONCURRENT_BOOTSTRAP');
   metrics[name]={n:values.length,median,empirical_p95:stats.empirical_p95??null,unit:stats.unit};
  }
  const ds=perCorpus.get(rr[0].dataset),query=ds.selected_queries.find(q=>q.name===rr[0].name),entry={dataset:rr[0].dataset,query:rr[0].name,family:query.family,result_count:query.result_count,profile:rr[0].profile,concurrency:rr[0].concurrency,attempts:rr.length,verified:rr.length,metrics};
  (rr[0].phase==='serial'?serialGroups:concurrentGroups).push(entry);
 }
 check(pairs.size===280,'PAIR_DENOMINATOR');const pairGroups=new Map();
 for(const [id,rr] of pairs){check(rr.length===2&&new Set(rr.map(r=>r.profile)).size===2,'PAIR_SHAPE');const [a,b]=rr,pa=jobs.findIndex(j=>j.job_id===a.job_id),pb=jobs.findIndex(j=>j.job_id===b.job_id);check(Math.abs(pa-pb)===1,'NONADJACENT_PAIR');const k=a.dataset+'/'+a.name;if(!pairGroups.has(k))pairGroups.set(k,[]);const p=rr.find(r=>r.profile==='privsearch'),base=rr.find(r=>r.profile==='basic-derived');check(base.total_verified_query_ms>0,'PAIR_DENOMINATOR_ZERO');pairGroups.get(k).push({ratio:p.total_verified_query_ms/base.total_verified_query_ms,p_first:pa<pb?a.profile==='privsearch':b.profile==='privsearch'});}
 const paired=[];check(s.paired_comparisons.length===pairGroups.size&&pairGroups.size===14,'PAIR_GROUP_COUNT');
 for(const [group,pp] of pairGroups){check(pp.length===20&&pp.filter(x=>x.p_first).length===10,'PAIR_BALANCE');const prev=s.paired_comparisons.find(p=>p.group===group),median=med(pp.map(p=>p.ratio));check(prev&&prev.planned_pairs===20&&prev.complete_verified_pairs===20&&prev.failed_completed_pairs===0&&prev.incomplete_pairs===0&&near(prev.paired_latency_ratio.median,median),'PAIRED_MEDIAN');paired.push({group,pairs:20,ab:10,ba:10,privsearch_over_basic_median:median,trial_bootstrap_95_ci:prev.paired_latency_ratio.median_trial_bootstrap_95_ci,ci_scope:'Reported Stage15 trial-level resampling, conditional on both profiles verifying; no cross-machine inference.'});}
 const throughput=[];
 const allBlocks=s.plans.flatMap(p=>p.blocks),rowById=new Map(s.rows.map(r=>[r.job_id,r]));check(s.batch_results.length===allBlocks.length&&new Set(s.batch_results.map(b=>b.batch_id)).size===s.batch_results.length,'DUPLICATE_OR_MISSING_BATCH');
 for(const b of s.batch_results){const planned=allBlocks.find(p=>p.batch_id===b.batch_id);check(planned&&planned.status==='finished'&&planned.completed===planned.jobs.length&&b.attempted===planned.jobs.length&&b.verified===planned.jobs.filter(j=>good(rowById.get(j.job_id))).length,'BATCH_DENOMINATOR');for(const f of ['dataset','phase','profile','concurrency'])check(b[f]===planned[f],'BATCH_BINDING');if(b.phase==='concurrency'){check(b.attempted===40&&b.batch_elapsed_ms>0&&near(b.verified_queries_per_second,40000/b.batch_elapsed_ms),'THROUGHPUT');throughput.push({dataset:b.dataset,profile:b.profile,workers:b.concurrency,attempted:b.attempted,verified:b.verified,makespan_ms:b.batch_elapsed_ms,verified_queries_per_second:40000/b.batch_elapsed_ms});}}
 check(throughput.length===16,'CONCURRENCY_GROUPS');
 check(s.source_final_checks.length===2&&s.source_final_checks.every(c=>c.source_files_match_passed_audit===true&&c.source_files_written===0),'SOURCE_PRESERVATION');
 check(s.roles.length===8&&s.roles.every(r=>r.process_stopped===true&&r.cwd_has_env_file===false&&r.environment_sensitive_names_present.length===0)&&s.owned_children_cleanup_completed===true,'ROLE_CLEANUP');
 check(s.receipts.length===2&&s.receipts.every(r=>r.simulated===false&&r.visibility.observation.verified===true&&r.commitment===perCorpus.get(r.dataset).public.state_commitment)&&s.live_anchor_transactions===2&&s.simulated_anchors===0&&s.unresolved_anchor_attempts===0&&s.pending_corpora.length===0,'ANCHOR_ACCOUNTING');
 return {accounting:computed,serial_groups:serialGroups,concurrent_groups:concurrentGroups,paired,throughput,observation_retries:retries,stage11_prior_failures_retained:3,scope:'Offline reconciliation of the pinned report. Does not independently reobserve chain state, rescan source corpora or rerun measurements.'};
}
function markdown(summary,review){
 const lines=['# Stage16 security, privacy and evidence audit','',`Status: **${summary.status}**. Audit execution completed; open assurance findings remain.`,
 '', 'This report concerns the frozen implementation and the reviewed Stage15 paired study. Synthetic probes characterize behavior; regression tests cover specified failure modes. Neither constitutes a formal security proof, production certification or a published-baseline comparison.',
 '',`Stage15 evidence SHA-256: \`${summary.evidence_sha256}\`. Frozen prior files checked: ${summary.frozen_files_checked}.`,
 '', '## Evidence reconciliation','',`${summary.evidence.accounting.measured_verified}/${summary.evidence.accounting.measured_attempts} measured attempts verified; ${summary.evidence.accounting.expected_rejections} expected attack rejections. Prior Stage11 honest failures retained: 3. Successful Stage15 observations include ${summary.evidence.observation_retries} bounded reader retries; no failed query was replaced.`,
 '', '## Scoped claims and open findings','', '| ID | Disposition | Finding and required treatment |','|---|---|---|'];
 for(const f of review.findings)lines.push(`| ${f.id} | ${f.disposition} | ${f.title}. ${f.required_treatment} |`);
 lines.push('','## Serial verified latency','', 'Twenty fixed attempts per query/profile, one machine. Values below are recomputed medians in seconds. Query sizes, base posting lengths and result counts differ; this is not a controlled one-variable scaling experiment.','', '| Dataset | Query | Family | Results | PrivSearch s | Basic-derived s |','|---|---|---|---:|---:|---:|');
 const serial=summary.evidence.serial_groups;for(const p of serial.filter(x=>x.profile==='privsearch')){const b=serial.find(x=>x.profile==='basic-derived'&&x.dataset===p.dataset&&x.query===p.query);lines.push(`| ${p.dataset} | ${p.query} | ${p.family} | ${p.result_count} | ${(p.metrics.total_verified_query_ms.median/1000).toFixed(3)} | ${(b.metrics.total_verified_query_ms.median/1000).toFixed(3)} |`);}
 lines.push('','## Component medians','', 'Median milliseconds within the verified serial boundary. Component medians need not sum to the median total; per-trial partitions are reconciled exactly. Proof callback time includes callback transport and server work, rather than isolated RSA CPU.', '', '| Dataset | Query | Profile | Create request ms | Search HTTP ms | Proof callback ms | Local verify ms | Payload I/O ms | Chain ms |','|---|---|---|---:|---:|---:|---:|---:|---:|');
 for(const r of serial)lines.push(`| ${r.dataset} | ${r.query} | ${r.profile} | ${['create_request_ms','search_http_ms','proof_callback_ms','verify_local_ms','payload_batch_io_ms','chain_observation_ms'].map(k=>r.metrics[k].median.toFixed(2)).join(' | ')} |`);
 lines.push('','## Concurrency throughput','', 'Closed-loop workers on the small single-keyword query, forty fixed jobs/profile/level, one client process and one retained server process. These descriptive batch throughputs do not establish multi-core server scaling, WAN performance, or blockchain transaction throughput. No independent-job bootstrap or throughput confidence interval is asserted.', '', '| Dataset | Profile | Workers | Verified / attempted | Verified queries/s |','|---|---|---:|---:|---:|');
 for(const r of summary.evidence.throughput)lines.push(`| ${r.dataset} | ${r.profile} | ${r.workers} | ${r.verified}/${r.attempted} | ${r.verified_queries_per_second.toFixed(3)} |`);
 lines.push('','## Query work characterization','', 'The synthetic matrix below counts operations in the unchanged code; it contains no comparative timings or assurance-removing ablation. For clause i with k_i terms and b_i base rows, request token exponentiations and server cross tests equal sum_i b_i(k_i-1). Full coverage opens the sum of posting lengths for every distinct queried token, and requests one sampled RSA proof per distinct queried token. Payload work follows the result union.', '', '| Terms | Base rows | Token exponentiations | Cross tests | Opened rows | RSA callbacks | Results |','|---:|---:|---:|---:|---:|---:|---:|');
 for(const r of summary.probes.work_growth)lines.push(`| ${r.terms} | ${r.base_rows} | ${r.request_group_exponentiations} | ${r.server_cross_tests} | ${r.opened_ciphertext_rows} | ${r.rsa_callbacks} | ${r.returned_payloads} |`);
 lines.push('','## Synthetic observations','');for(const c of summary.probes.checks)lines.push(`- **${c.id}**: ${c.evidence.scope}`);
 lines.push('','## Remaining work','',...review.remaining_work.map(w=>'- '+w),'','Stage16 writes only this new report directory. No service configuration, corpus files, remote RPC endpoint, deployment, object store or database is opened by the audit. The separate regression gate uses synthetic local HTTP services only.');return lines.join('\n')+'\n';
}
module.exports={sha,copy,check,readBounded,sourceFile,verifySources,approvedSummary,med,near,good,validateEvidence,markdown};
