import argparse,csv,hashlib,json,os,random,statistics,subprocess,sys,time
from pathlib import Path
from common_payload import build,canonical
from daks_reference import bodybytes,BACKEND

PROFILES=['privsearch-merkle-v2','seacq-basic-derived','daks-paper-reconstruction']
def plan_data(data,raw,seed,repeats):
 if not data['documents'] or len(data['documents'])>30000:raise ValueError('Dataset document capacity exceeded')
 ids=[d['id'] for d in data['documents']]
 if len(set(ids))!=len(ids):raise ValueError('Duplicate source identifier')
 if len(data['words'])>64:raise ValueError('Shared vocabulary exceeds SeaCQ-derived bound')
 if len(data['words'])!=len(set(data['words'])):raise ValueError('Duplicate prepared word')
 queries=[];wordset=set(data['words']);declared=data.get('metadata',{}).get('selected_experiment_queries',[])
 for i,q in enumerate(data['queries']):
  if not 2<=len(q)<=16 or len(set(q))!=len(q) or not set(q)<=wordset:raise ValueError('Common conjunction interface violated')
  if not all(any(w in d['keywords'] for d in data['documents']) for w in q):raise ValueError('Empty prepared posting is outside matched workload')
  expected=[dict(id=d['id'],sha256=hashlib.sha256(bodybytes(d)).hexdigest()) for d in data['documents'] if all(w in d['keywords'] for w in q)]
  expected.sort(key=lambda x:x['id'].encode());count=len(expected)
  if declared and (i>=len(declared) or declared[i]['reference_count']!=count):raise ValueError('Audited count mismatch')
  queries.append(dict(query_id=declared[i]['name'] if declared else 'Q'+str(i),terms=len(q),result_count=count,
   category='positive' if count else 'empty',oracle_digest=hashlib.sha256(canonical(expected)).hexdigest()))
 if not any(q['result_count'] for q in queries) or not any(q['result_count']==0 for q in queries):raise ValueError('Positive AND empty-result coverage is mandatory')
 if declared and len(declared)!=len(queries):raise ValueError('Query accounting mismatch')
 jobs=[]
 for i in range(len(queries)):jobs.append(dict(job_id='warmup/'+str(i),query_index=i,phase='warmup',repeat=0))
 measured=[dict(job_id='measured/'+str(r)+'/'+str(i),query_index=i,phase='measurement',repeat=r) for r in range(repeats) for i in range(len(queries))]
 random.Random(seed).shuffle(measured);jobs+=measured
 root,_=build(data['documents']);input_sha=hashlib.sha256(raw).hexdigest()
 return dict(input_sha256=input_sha,payload_root=root,dataset_id=hashlib.sha256(('matched-v2/'+input_sha).encode()).hexdigest(),queries=queries,jobs=jobs)

def fixture():
 words=['alpha','beta','gamma','isolated']
 docs=[dict(id='0001',keywords=['alpha','beta','gamma'],body='b25l',body_encoding='base64'),
  dict(id='unicode-é-한글',keywords=['alpha','gamma'],body='dHdv',body_encoding='base64'),
  dict(id='3',keywords=['beta'],body='dGhyZWU=',body_encoding='base64'),
  dict(id='isolated',keywords=['isolated'],body='Zm91cg==',body_encoding='base64')]
 return dict(documents=docs,words=words,queries=[['alpha','beta'],['alpha','gamma'],['alpha','isolated']],metadata=dict(fixture=True))

def main():
 p=argparse.ArgumentParser();p.add_argument('--input-dir',type=Path);p.add_argument('--output',type=Path,required=True);p.add_argument('--node',default='node');p.add_argument('--repeats',type=int,default=10);p.add_argument('--key-repetitions',type=int,default=3);p.add_argument('--fixture',action='store_true');p.add_argument('--worker-timeout',type=int,default=7200);a=p.parse_args()
 if a.repeats<1 or a.key_repetitions<1:raise ValueError('Positive repetition counts required')
 root=Path(__file__).resolve().parent;a.output.mkdir(parents=True,exist_ok=True);private=a.output/'private-plans';private.mkdir()
 report=dict(schema='privsearch-matched-implementation-benchmark-v2',status='RUNNING',fixture=a.fixture,
  profiles=PROFILES,corpora=[],runs=[],scope='Offline local-process algorithm benchmark; JSON encode/decode charged; no network, MongoDB, MinIO, chain, dynamic update or cold-disk claim.',
  common_contract='Complete conjunction identifiers and exact original bytes; native verification plus one common owner-pinned Merkle payload wrapper.',
  published_system_comparison_qualified=False,matched_implementation_comparison_complete=False,
  labels=dict(seacq='Modified SeaCQ-basic-derived Stage13; added authentication/encryption and common payload wrapper; not unchanged author implementation.',
   daks='Independent paper reconstruction with greedy covering, CMPS/P256 and owner-shared verifier key; not author C++ artifact. Dynamic rebuild performance not measured.',
   privsearch='Frozen full-row Merkle v2 with native encrypted payload verification; offline state pin reader.'),
  caveats=['Native privacy capabilities differ.','Node and Python implementations and arithmetic backends differ.','2048-bit RSA/MODP14 and P256 do not provide identical security strength.','Descriptive paired measurements only; no general published-system speedup or population inference.'])
 save=lambda:(a.output/'summary.json').write_text(json.dumps(report,indent=2)+'\n')
 save();failure=None
 try:
  if a.fixture:
   f=private/'fixture-input.json';f.write_bytes(canonical(fixture()));inputs=[('fixture',f)]
  else:
   if BACKEND!='PyCryptodome-3.23.0-P256':raise ValueError('Real benchmark requires PyCryptodome 3.23.0 native P256 backend; use the existing baseline Python environment')
   if not a.input_dir:raise ValueError('Audited input directory required; no fixture fallback')
   inputs=[(k,a.input_dir/(k+'-private-input.json')) for k in ['healthcare','enron']]
   if not all(f.exists() for _,f in inputs):raise ValueError('Both audited corpus exports are required')
  # All coverage gates run before any profile is timed.
  plans=[]
  for kind,file in inputs:
   raw=file.read_bytes();data=json.loads(raw);base=plan_data(data,raw,20261022,a.repeats)
   if not a.fixture:
    pins=json.loads((root/'application/scripts/privsearch/stage6-audit-pins.json').read_text());m=data.get('metadata',{})
    if m.get('audit_summary_sha256')!=pins['summary_sha256'] or m.get('sources_match_passed_audit') is not True or m.get('required_positive_and_empty_coverage') is not True:raise ValueError('Audited real export identity missing')
   report['corpora'].append(dict(dataset=kind,input_sha256=base['input_sha256'],payload_root=base['payload_root'],documents=len(data['documents']),words=len(data['words']),
    queries=base['queries'],positive_queries=sum(q['result_count']>0 for q in base['queries']),empty_queries=sum(q['result_count']==0 for q in base['queries']),
    missing_requested_arities=[k for k in [2,4,6,8,10] if not any(q['terms']==k and q['result_count']>0 for q in base['queries'])],
    original_source_metadata=data.get('metadata',{})))
   plans.append((kind,file,base));save()
  for kind,file,base in plans:
   for rep in range(a.key_repetitions):
    order=PROFILES.copy();random.Random(20261022+rep).shuffle(order)
    plan=plan_data(json.loads(file.read_bytes()),file.read_bytes(),20261022+rep,a.repeats);plan_file=private/(kind+'-'+str(rep)+'-plan.json');plan_file.write_bytes(canonical(plan))
    for ordinal,profile in enumerate(order):
     name=kind+'-'+str(rep)+'-'+profile;out=a.output/(name+'.json');log=a.output/(name+'.log')
     run=dict(dataset=kind,key_repetition=rep,execution_ordinal=ordinal,profile=profile,status='STARTED',output=out.name);report['runs'].append(run);save()
     print('MATCHED_PROFILE_START:',name,flush=True)
     cmd=[sys.executable,str(root/'daks-worker.py'),str(file.resolve()),str(plan_file.resolve()),str(out.resolve())] if profile=='daks-paper-reconstruction' else [a.node,str(root/'node-worker.js'),str(file.resolve()),str(plan_file.resolve()),profile,str(out.resolve())]
     started=time.perf_counter()
     allowed={'PATH','SYSTEMROOT','WINDIR','TEMP','TMP','PATHEXT','COMSPEC','USERPROFILE','APPDATA','LOCALAPPDATA','PYTHONPATH','PYTHONUTF8','LANG','LC_ALL','HOME'}
     child_env={k:v for k,v in os.environ.items() if k.upper() in allowed};child_env['PYTHONUTF8']='1'
     with log.open('w',encoding='utf-8') as stream:r=subprocess.run(cmd,stdout=stream,stderr=subprocess.STDOUT,timeout=a.worker_timeout,env=child_env)
     run['process_wall_seconds']=time.perf_counter()-started
     if r.returncode or not out.exists():raise RuntimeError('Worker failed: '+name+'; inspect retained log/output')
     measured=json.loads(out.read_text());rows=measured['measurements'];run['status']=measured['status'];run['setup_ms']=measured['setup_ms'];run['shared_payload_setup_ms']=measured['shared_payload_setup_ms']
     if measured['status']!='COMPLETE' or len(rows)!=len(plan['jobs']):raise RuntimeError('Incomplete worker accounting: '+name)
     if measured['input_sha256']!=base['input_sha256'] or measured['payload_root']!=base['payload_root']:raise RuntimeError('Worker snapshot mismatch')
     if [x['job_id'] for x in rows]!=[x['job_id'] for x in plan['jobs']]:raise RuntimeError('Job order mismatch')
     for row in rows:
      expected=plan['queries'][row['query_index']]
      if not row['accepted'] or row['result_count']!=expected['result_count'] or row['oracle_digest']!=expected['oracle_digest']:raise RuntimeError('Verification accounting mismatch')
     run['completed']=len(rows);save()
    if hashlib.sha256(file.read_bytes()).hexdigest()!=base['input_sha256']:raise RuntimeError('Export mutated during benchmark')
  allrows=[]
  for run in report['runs']:
   for row in json.loads((a.output/run['output']).read_text())['measurements']:
    allrows.append(dict(dataset=run['dataset'],key_repetition=run['key_repetition'],**row))
  with (a.output/'attempts.csv').open('w',newline='',encoding='utf-8') as stream:
   writer=csv.DictWriter(stream,fieldnames=list(allrows[0]));writer.writeheader();writer.writerows(allrows)
  groups={}
  for r in allrows:
   if r['phase']=='measurement':groups.setdefault((r['dataset'],r['profile'],r['query_index']),[]).append(r)
  report['descriptive_groups']=[dict(dataset=k[0],profile=k[1],query_index=k[2],attempts=len(v),median_total_ms=statistics.median(x['total_ms'] for x in v),
   min_total_ms=min(x['total_ms'] for x in v),max_total_ms=max(x['total_ms'] for x in v),median_response_bytes=statistics.median(x['response_bytes'] for x in v)) for k,v in groups.items()]
  comparisons=[]
  for corpus in report['corpora']:
   for i,q in enumerate(corpus['queries']):
    row=dict(dataset=corpus['dataset'],query_id=q['query_id'],terms=q['terms'],category=q['category'],result_count=q['result_count'])
    for profile in PROFILES:
     selected=groups[(corpus['dataset'],profile,i)];row[profile+'_attempts']=len(selected);row[profile+'_median_ms']=statistics.median(r['total_ms'] for r in selected)
     row[profile+'_median_response_bytes']=statistics.median(r['response_bytes'] for r in selected)
    comparisons.append(row)
  with (a.output/'comparison.csv').open('w',newline='',encoding='utf-8') as stream:
   writer=csv.DictWriter(stream,fieldnames=list(comparisons[0]));writer.writeheader();writer.writerows(comparisons)
  report['measured_attempts']=sum(r['phase']=='measurement' for r in allrows);report['warmup_attempts']=sum(r['phase']=='warmup' for r in allrows)
  report['matched_implementation_comparison_complete']=not a.fixture;report['status']='FIXTURE_MATCHED_PIPELINE_PASSED' if a.fixture else 'MATCHED_STATIC_IMPLEMENTATION_COMPARISON_COMPLETE'
 except Exception as exc:
  failure=exc;report['status']='STOPPED';report['failure']=str(exc)
 finally:
  import shutil
  shutil.rmtree(private);report['private_plans_removed']=True;save();print('MATCHED_STATUS:',report['status'],flush=True)
 if failure:raise SystemExit(str(failure))
if __name__=='__main__':main()
