import argparse, copy, csv, itertools, json, platform, random, time
from pathlib import Path
from daks_reference import Owner, G, N, mul, add, negate, point_json, keyrow, BACKEND

def fixture():
    words=['alpha','beta','gamma','isolated','empty']
    documents=[dict(id='0001',keywords=['alpha','beta','gamma'],body='record one'),
      dict(id='unicode-é-한글',keywords=['alpha'],body='original α bytes'),
      dict(id='3',keywords=['beta'],body='record three'),
      dict(id='long-id-'*20,keywords=['beta','gamma'],body='record four'),
      dict(id='line\nidentifier',keywords=['gamma'],body='record five'),
      dict(id='isolated',keywords=['isolated'],body='record six')]
    queries=[list(c) for n in range(1,len(words)+1) for c in itertools.combinations(words,n)]
    return documents,words,queries

def main():
    p=argparse.ArgumentParser();p.add_argument('--output',required=True,type=Path);p.add_argument('--input',type=Path);p.add_argument('--repeats',type=int,default=3);a=p.parse_args()
    a.output.mkdir(parents=True,exist_ok=True)
    report=dict(schema='privsearch-external-baseline-experiment-v2',profile='DAKS-paper-reconstruction-greedy-cover',
      status='RUNNING',author_implementation=False,fixture=not bool(a.input),python=platform.python_version(),
      extension='Greedy covering; prepared-empty controls use trusted counts; updates rebuild positional lists with tag reuse. Matched benchmark excludes queries on empty postings.',elliptic_curve_backend=BACKEND,
      dynamic_update_performance_qualified=False,published_daks_timing_reproduction=False,matched_external_comparison_qualified=False,
      tests=[],timings=[],source_writes=0,external_service_calls=0,transactions=0)
    save=lambda:(a.output/'daks-summary.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    def record(name,passed,**details):
      report['tests'].append(dict(name=name,passed=bool(passed),**details));save()
      if not passed:raise RuntimeError('Control failed: '+name)
    try:
      record('P256_group_order',mul(G,N) is None)
      docs,words,queries=fixture();t=time.perf_counter();owner=Owner(docs,words);report['fixture_setup_ms']=(time.perf_counter()-t)*1000
      server=owner.server();client=owner.client()
      record('server_has_no_verifier_secret',not hasattr(server,'key') and not hasattr(server,'owner'))
      for i,q in enumerate(queries):
        expected=sorted(d['id'] for d in docs if all(w in d['keywords'] for w in q));ok,ids=client.verify(q,server.search(q))
        record('honest_subset_'+str(i),ok and ids==expected,terms=len(q),result_count=len(ids))
      query=['alpha','beta'];reply=server.search(query)
      mutations={
       'omit_result':lambda r:r['results'].pop(),
       'false_empty':lambda r:r['results'].clear(),
       'extra_nonmatch':lambda r:r['results'].append(copy.deepcopy(docs[1])),
       'duplicate_result':lambda r:r['results'].append(copy.deepcopy(r['results'][0])),
       'changed_body':lambda r:r['results'][0].update(body='tampered'),
       'changed_row_keyword':lambda r:r['rows'][0].update(word='isolated'),
       'changed_offset':lambda r:r['rows'][0].update(right=999999),
       'changed_id':lambda r:r['rows'][0].update(id='forged'),
       'duplicate_row':lambda r:r['rows'].append(copy.deepcopy(r['rows'][0])),
       'omit_row':lambda r:r['rows'].pop(),
       'omit_covering_path':lambda r:r['a1'].clear(),
       'omit_inclusion_step':lambda r:r['path'].pop(),
       'invalid_point':lambda r:r.update(proof=['0'*64,'0'*64]),
       'wrong_revision':lambda r:r.update(revision=r['revision']+1),
       'unknown_response_field':lambda r:r.update(extra=True)}
      for name,mutate in mutations.items():
        bad=copy.deepcopy(reply);mutate(bad);ok,_=client.verify(query,bad);record(name,not ok)
      record('wrong_query_reject',not client.verify(['alpha','gamma'],reply)[0])
      fresh=owner.client();wrong=bytearray(fresh.key);wrong[0]^=1;fresh.key=bytes(wrong)
      record('wrong_verifier_key_reject',not fresh.verify(query,reply)[0])
      # Stronger structural control: a server can recompute a valid aggregate proof
      # for an omitted subset using public tags. Membership success must not hide a gap.
      gap=copy.deepcopy(reply); removed=gap['results'][0]['id']; removed_keys={keyrow(row) for row in gap['rows'] if row['id']==removed}
      gap['rows']=[row for row in gap['rows'] if keyrow(row) not in removed_keys]
      gap['a1']=[k for k in gap['a1'] if tuple(k) not in removed_keys]
      gap['path']=[v for v in gap['path'] if tuple(v['base']) not in removed_keys]
      gap['results']=[]; proof=server.total
      for row in gap['rows']:proof=add(proof,negate(server.tags[keyrow(row)]))
      gap['proof']=point_json(proof)
      record('omission_with_recomputed_valid_membership_proof',not client.verify(query,gap)[0])
      for name,op in [('add',dict(document=dict(id='new',keywords=['alpha','beta'],body='added'))),
          ('replace',dict(document=dict(id='new',keywords=['beta','gamma'],body='updated'))),('delete',dict(delete_id='new'))]:
        old=owner.server().search(query);owner.update(**op);s=owner.server();c=owner.client()
        record(name+'_stale_state_reject',not c.verify(query,old)[0])
        for q in [query,['beta','gamma'],['isolated','alpha']]:
          expected=sorted(id for id,d in owner.docs.items() if all(w in d['keywords'] for w in q));ok,ids=c.verify(q,s.search(q))
          record(name+'_honest_'+str(len(report['tests'])),ok and ids==expected)
      # Corpus input is optional and must be an explicit bounded export; never truncate it.
      if a.input:
        data=json.loads(a.input.read_text(encoding='utf-8-sig'));docs=data['documents'];words=data['words'];queries=data['queries'];report['input_metadata']=data.get('metadata',{})
        declared=report['input_metadata'].get('selected_experiment_queries',[])
        if declared:
          if len(declared)!=len(queries):raise RuntimeError('Audited query accounting mismatch')
          for q,m in zip(queries,declared):
            if sum(all(w in d['keywords'] for w in q) for d in docs)!=m['reference_count']:raise RuntimeError('Audited oracle count mismatch')
      else: docs,words,queries=fixture()
      if len(docs)>1000:raise RuntimeError('Capacity exclusion: DAKS reference max 1000 documents; no truncation performed')
      t=time.perf_counter();owner=Owner(docs,words);report['measurement_setup_ms']=(time.perf_counter()-t)*1000;s=owner.server();c=owner.client()
      jobs=[(i,q,r) for i,q in enumerate(queries) for r in range(a.repeats)];random.Random(20261021).shuffle(jobs)
      for i,q,r in jobs:
        t=time.perf_counter();response=s.search(q);server_ms=(time.perf_counter()-t)*1000;t=time.perf_counter();ok,ids=c.verify(q,response);verify_ms=(time.perf_counter()-t)*1000
        expected=sorted(d['id'] for d in docs if all(w in d['keywords'] for w in q))
        if not ok or ids!=expected:raise RuntimeError('Measurement exact-set mismatch')
        report['timings'].append(dict(query_index=i,terms=len(q),repeat=r,server_ms=server_ms,verification_ms=verify_ms,
          serialized_response_bytes=len(json.dumps(response,ensure_ascii=False,separators=(',',':')).encode()),result_count=len(ids),verified=True))
        save()
      report['status']='QUALIFICATION_CONTROLS_PASSED_DIAGNOSTIC_MEASUREMENTS_COMPLETE'
    except Exception as exc:
      report['status']='STOPPED';report['failure']=str(exc);raise
    finally:
      report['tests_passed']=sum(x['passed'] for x in report['tests']);report['tests_total']=len(report['tests']);save()
      if report['timings']:
        with (a.output/'daks-timings.csv').open('w',newline='',encoding='utf-8') as f:
          w=csv.DictWriter(f,fieldnames=list(report['timings'][0]));w.writeheader();w.writerows(report['timings'])
      print('DAKS_EXPERIMENT_STATUS:',report['status']);print('DAKS_REPORT:',a.output.resolve())

if __name__=='__main__':main()
