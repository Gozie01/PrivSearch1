import base64,hashlib,json
from daks_reference import bodybytes
def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def h(domain,x):return hashlib.sha256(domain.encode()+b'\x00'+canonical(x)).hexdigest()
def build(docs):
    docs=sorted(docs,key=lambda d:d['id'].encode())
    leaves=[dict(id=d['id'],sha256=hashlib.sha256(bodybytes(d)).hexdigest(),length=len(bodybytes(d)),revision='1') for d in docs]
    if not leaves:raise ValueError('empty dataset')
    levels=[[h('matched-leaf',v) for v in leaves]]
    while len(levels[-1])>1:
      prev=levels[-1];levels.append([h('matched-node',[prev[i],prev[min(i+1,len(prev)-1)]]) for i in range(0,len(prev),2)])
    root=h('matched-root',[len(leaves),levels[-1][0]]);packets={}
    for i,(d,leaf) in enumerate(zip(docs,leaves)):
      pos=i;siblings=[]
      for level in levels[:-1]:siblings.append(level[pos^1] if pos^1<len(level) else level[pos]);pos//=2
      packets[d['id']]=dict(leaf=leaf,proof=dict(index=i,count=len(leaves),siblings=siblings),body=base64.b64encode(bodybytes(d)).decode())
    return root,packets
def verify(packet,id,root,count):
    leaf=packet['leaf'];proof=packet['proof'];raw=base64.b64decode(packet['body'],validate=True)
    if set(packet)!={'leaf','proof','body'} or set(leaf)!={'id','sha256','length','revision'} or set(proof)!={'index','count','siblings'}:raise ValueError('payload fields')
    if leaf['id']!=id or leaf['revision']!='1' or leaf['length']!=len(raw) or leaf['sha256']!=hashlib.sha256(raw).hexdigest():raise ValueError('payload binding')
    if proof['count']!=count or type(proof['index'])is not int or not 0<=proof['index']<count:raise ValueError('payload index')
    width=count;pos=proof['index'];v=h('matched-leaf',leaf);i=0
    while width>1:
      sibling=proof['siblings'][i];i+=1
      if len(sibling)!=64 or any(c not in '0123456789abcdef' for c in sibling):raise ValueError('sibling')
      if pos%2==0 and pos+1>=width and sibling!=v:raise ValueError('odd leaf')
      v=h('matched-node',[sibling,v] if pos%2 else [v,sibling]);pos//=2;width=(width+1)//2
    if i!=len(proof['siblings']) or h('matched-root',[count,v])!=root:raise ValueError('payload root')
    return raw
