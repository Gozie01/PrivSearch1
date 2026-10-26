import base64,hashlib,json,os,sys,time
from pathlib import Path
from daks_reference import Owner,bodybytes,BACKEND
from common_payload import build,verify,canonical
PROGRESS=None;OUTPUT=None
def save():
 if PROGRESS is not None:
  temp=Path(str(OUTPUT)+'.tmp');temp.write_text(json.dumps(PROGRESS,indent=2)+'\n');os.replace(temp,OUTPUT)

def main():
 global PROGRESS,OUTPUT
 input_file,plan_file,out=map(Path,sys.argv[1:]);raw=input_file.read_bytes();data=json.loads(raw);plan=json.loads(plan_file.read_text())
 if hashlib.sha256(raw).hexdigest()!=plan['input_sha256']:raise ValueError('input changed')
 t=time.perf_counter();root,packets=build(data['documents']);shared_setup=(time.perf_counter()-t)*1000
 if root!=plan['payload_root']:raise ValueError('payload root mismatch')
 t=time.perf_counter();owner=Owner(data['documents'],data['words']);server=owner.server();client=owner.client();setup_ms=(time.perf_counter()-t)*1000
 rows=[];OUTPUT=out;PROGRESS=dict(status='RUNNING',profile='daks-paper-reconstruction',input_sha256=plan['input_sha256'],payload_root=root,dataset_id=plan['dataset_id'],setup_ms=setup_ms,shared_payload_setup_ms=shared_setup,measurements=rows,started_jobs=[],language=sys.version.split()[0],elliptic_curve_backend=BACKEND,offline=True);save()
 for job in plan['jobs']:
  q=data['queries'][job['query_index']];sent=received=0
  PROGRESS['started_jobs'].append(job['job_id']);save()
  def wire(value,request=False):
   nonlocal sent,received
   encoded=json.dumps(value,ensure_ascii=False,separators=(',',':')).encode()
   if request:sent+=len(encoded)
   else:received+=len(encoded)
   return json.loads(encoded)
  start=time.perf_counter();t=time.perf_counter();request=wire(q,True);token_ms=(time.perf_counter()-t)*1000
  t=time.perf_counter();response=server.search(request);server_ms=(time.perf_counter()-t)*1000;response=wire(response)
  t=time.perf_counter();accepted,ids=client.verify(q,response);verification_ms=(time.perf_counter()-t)*1000
  if not accepted:raise ValueError('native verification failed')
  native={d['id']:bodybytes(d) for d in response['results']};returned=[];t=time.perf_counter()
  for id in ids:
   original=packets[id];packet=wire(dict(leaf=original['leaf'],proof=original['proof']));packet['body']=base64.b64encode(native[id]).decode()
   rawbody=verify(packet,id,root,len(data['documents']))
   if native[id]!=rawbody:raise ValueError('native body mismatch')
   returned.append(dict(id=id,sha256=hashlib.sha256(rawbody).hexdigest()))
  payload_ms=(time.perf_counter()-t)*1000;total_ms=(time.perf_counter()-start)*1000
  returned.sort(key=lambda x:x['id'].encode());oracle=hashlib.sha256(canonical(returned)).hexdigest();expected=plan['queries'][job['query_index']]
  if oracle!=expected['oracle_digest'] or len(returned)!=expected['result_count']:raise ValueError('exact result/body oracle mismatch')
  rows.append(dict(**job,profile='daks-paper-reconstruction',accepted=True,result_count=len(ids),oracle_digest=oracle,total_ms=total_ms,
   token_ms=token_ms,server_ms=server_ms,native_verification_ms=verification_ms,shared_payload_ms=payload_ms,request_bytes=sent,response_bytes=received))
  save()
 PROGRESS['status']='COMPLETE';save()
 print('PROFILE_COMPLETE: daks-paper-reconstruction',len(rows))
if __name__=='__main__':
 try:main()
 except Exception as exc:
  if PROGRESS is not None:PROGRESS['status']='STOPPED';PROGRESS['failure']=str(exc);save()
  raise
