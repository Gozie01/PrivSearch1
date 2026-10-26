import copy,hashlib,itertools,json,os,random,subprocess,sys,tempfile,unittest
from pathlib import Path
from common_payload import build,verify,canonical
from run_matched import fixture,plan_data
from daks_reference import Owner,lower,mul,reference_mul,G
ROOT=Path(__file__).resolve().parent
NODE=os.environ.get('MATCHED_NODE','node')

class MatchedTests(unittest.TestCase):
 def test_exporter_keeps_positive_native_queries_and_real_disjoint_control(self):
  code="const assert=require('node:assert/strict'),X=require('./export-audited-corpus'),D=require('./application/scripts/privsearch/stage11-data');const s={queries:[{name:'positive',query:[['a','b']],origin:'audited-workload'},{name:'G_disjoint_and',query:[['a','c']],origin:'derived-real-keyword-control'},{name:'or',query:[['a'],['b']],origin:'audited-workload'}],reference:{positive:{count:5},G_disjoint_and:{count:0},or:{count:7}}};assert.deepEqual(X.selectWorkload(s).map(q=>q.name),['positive','G_disjoint_and']);assert.equal(D.LIMITS.documents,30000);console.log('ok');"
  r=subprocess.run([NODE,'-e',code],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE);self.assertEqual(r.returncode,0,r.stderr)
 def test_curve_backend_against_independent_reference(self):
  for k in [1,2,17,123456789,2**200+891]:self.assertEqual(mul(G,k),reference_mul(G,k))
 def test_positive_and_empty_coverage_gate(self):
  for which in [0,2]:
   d=fixture();d['queries']=[d['queries'][which]]
   with self.assertRaisesRegex(ValueError,'coverage'):plan_data(d,canonical(d),1,2)
 def test_empty_keyword_posting_cannot_substitute_for_disjoint_control(self):
  d=fixture();d['words'].append('empty');d['queries'].append(['alpha','empty'])
  with self.assertRaisesRegex(ValueError,'Empty prepared posting'):plan_data(d,canonical(d),1,2)
 def test_plan_is_shared_deterministic_and_repetition_matched(self):
  d=fixture();p=plan_data(d,canonical(d),12,3);self.assertEqual(p,plan_data(d,canonical(d),12,3));self.assertEqual(len(p['jobs']),12)
  self.assertEqual(len({x['job_id'] for x in p['jobs']}),12)
 def test_common_payload_tampering_and_wrong_pin(self):
  d=fixture();root,packets=build(d['documents'])
  for id,packet in packets.items():
   self.assertIsInstance(verify(packet,id,root,4),bytes)
   for mutation in ['body','id','root','count','proof']:
    bad=copy.deepcopy(packet);r=root;n=4
    if mutation=='body':bad['body']='Zm9yZ2Vk'
    elif mutation=='id':bad['leaf']['id']='forged'
    elif mutation=='root':r='0'*64
    elif mutation=='count':n=5
    else:bad['proof']['siblings'][0]='0'*64
    with self.assertRaises(ValueError):verify(bad,id,r,n)
 def test_cross_language_payload_root_and_bytes(self):
  d=fixture();d['documents'].append(dict(id='binary',keywords=['alpha'],body='AP8KAA==',body_encoding='base64'));root,_=build(d['documents'])
  code="const C=require('./common-payload');let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{const d=JSON.parse(s).documents.map(v=>({id:v.id,body:Buffer.from(v.body,'base64')}));const p=C.build(d);for(const [id,v]of p.packets)C.verify(v,id,p.root,d.length);console.log(p.root);});"
  r=subprocess.run([NODE,'-e',code],cwd=ROOT,input=canonical(d),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(r.stdout.decode().strip(),root)
 def test_greedy_cover_against_exhaustive_shortest_path_and_raw_oracle(self):
  for seed in range(8):
   rng=random.Random(seed);words=['alpha','beta','gamma'];docs=[dict(id=str(i),keywords=[w for w in words if rng.random()<0.65],body=str(i)) for i in range(8)]
   owner=Owner(docs,words);s=owner.server();c=owner.client()
   for width in [2,3]:
    for q in itertools.combinations(words,width):
     r=s.search(list(q));ok,ids=c.verify(list(q),r);expected=sorted(d['id'] for d in docs if all(w in d['keywords'] for w in q));self.assertTrue(ok);self.assertEqual(ids,expected)
     if any(not s.tables[w] for w in q):continue
     rows=sorted([r for w in q for r in s.tables[w]],key=lambda x:x['position']);dist=[]
     for i,row in enumerate(rows):
      best=1 if row['left'] is None else 100000
      for j,prev in enumerate(rows[:i]):
       if prev['position']<row['position'] and prev['position']>=lower(row):best=min(best,dist[j]+1)
      dist.append(best)
     optimum=min(dist[i] for i,row in enumerate(rows) if row['right'] is None)
     self.assertEqual(len(r['a1']),optimum)
 def test_failed_worker_retains_started_job(self):
  with tempfile.TemporaryDirectory() as td:
   t=Path(td);data=fixture();raw=canonical(data);plan=plan_data(data,raw,1,1);plan['queries'][0]['oracle_digest']='0'*64
   (t/'input.json').write_bytes(raw);(t/'plan.json').write_bytes(canonical(plan))
   r=subprocess.run([NODE,str(ROOT/'node-worker.js'),str(t/'input.json'),str(t/'plan.json'),'seacq-basic-derived',str(t/'result.json')],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
   self.assertNotEqual(r.returncode,0);out=json.loads((t/'result.json').read_text());self.assertEqual(out['status'],'STOPPED');self.assertEqual(len(out['started_jobs']),1);self.assertEqual(len(out['measurements']),0)

if __name__=='__main__':unittest.main(verbosity=2)
