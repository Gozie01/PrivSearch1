"""Independent DAKS qualification reconstruction, not author code or optimized timing reproduction.

Maps paper Sections 4.2-4.5 and 5.1: authenticated offsets, covering path,
cross-keyword inclusion, exact intersection and keyed aggregate CMPS.
Uses a greedy covering path, independently checked against exact shortest paths.
Empty prepared postings require an external trusted vocabulary/count provision.
"""
import base64, bisect, copy, hashlib, json, secrets
try:
    import Crypto
    from Crypto.PublicKey import ECC
    BACKEND='PyCryptodome-'+Crypto.__version__+'-P256'
except ImportError:
    ECC=None;BACKEND='stdlib-affine-reference'

P = 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff
N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551
B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b
G = (0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296,
     0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5)

def add(a, b):
    if a is None: return b
    if b is None: return a
    x, y = a; u, v = b
    if x == u and (y + v) % P == 0: return None
    slope = ((3*x*x-3)*pow(2*y, -1, P) if a == b else (v-y)*pow(u-x, -1, P)) % P
    z = (slope*slope-x-u) % P
    return z, (slope*(x-z)-y) % P

def mul(a, k):
    out = None
    while k:
        if k & 1: out = add(out, a)
        a = add(a, a); k >>= 1
    return out

_affine_add=add
def reference_mul(a,k):
    result=None
    while k:
        if k&1:result=_affine_add(result,a)
        a=_affine_add(a,a);k>>=1
    return result

if ECC is not None:
    def unpack(point):return None if point.is_point_at_infinity() else (int(point.x),int(point.y))
    def add(a,b):
        if a is None:return b
        if b is None:return a
        return unpack(ECC.EccPoint(a[0],a[1],curve='P-256')+ECC.EccPoint(b[0],b[1],curve='P-256'))
    def mul(a,k):
        if a is None:return None
        return unpack(ECC.EccPoint(a[0],a[1],curve='P-256')*k)

def negate(a): return None if a is None else (a[0], -a[1] % P)
def point_json(a): return None if a is None else [format(a[0], '064x'), format(a[1], '064x')]
def parse_point(v):
    if v is None: return None
    if not isinstance(v, list) or len(v) != 2 or any(not isinstance(x,str) or len(x)!=64 for x in v): raise ValueError('point encoding')
    x,y = [int(x,16) for x in v]
    if not 0<=x<P or not 0<=y<P or (y*y-x*x*x+3*x-B)%P: raise ValueError('point not on curve')
    return x,y
def canonical(x): return json.dumps(x, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
def digest(x): return hashlib.sha256(canonical(x)).hexdigest()
def bodybytes(doc):
    return base64.b64decode(doc['body'],validate=True) if doc.get('body_encoding')=='base64' else doc['body'].encode()
def element(row): return digest(row)
def tag(h, key, y):
    ubytes = hashlib.sha256(bytes.fromhex(h)+key).digest()
    rbytes = hashlib.sha256(ubytes+key).digest()
    return add(mul(G,int.from_bytes(ubytes,'big')%N),mul(y,int.from_bytes(rbytes,'big')%N))
def keyrow(row): return row['word'],row['position']
def lower(row): return float('-inf') if row['left'] is None else row['position']-row['left']
def upper(row): return float('inf') if row['right'] is None else row['position']+row['right']
def includes(row, position): return lower(row)<position<upper(row)

class Owner:
    def __init__(self, documents, words):
        if len(set(words))!=len(words) or not words: raise ValueError('vocabulary')
        self.words=list(words); self.key=secrets.token_bytes(32); self.y=mul(G,secrets.randbelow(N-1)+1)
        self.docs={d['id']:copy.deepcopy(d) for d in documents}
        if len(self.docs)!=len(documents): raise ValueError('duplicate identifier')
        self.version=0; self.rows={}; self.tags={}; self.total=None; self.rebuild()
    def rebuild(self):
        self.version+=1
        mapping={id:i+1 for i,id in enumerate(sorted(self.docs))}
        rows={}; tables={w:[] for w in self.words}
        for w in self.words:
            ids=sorted((mapping[id],id) for id,d in self.docs.items() if w in d['keywords'])
            for i,(position,id) in enumerate(ids):
                row=dict(word=w,position=position,id=id,left=None if i==0 else position-ids[i-1][0],
                    right=None if i==len(ids)-1 else ids[i+1][0]-position,body_sha256=hashlib.sha256(bodybytes(self.docs[id])).hexdigest())
                rows[keyrow(row)]=row; tables[w].append(row)
        # Reuse only identical authenticated elements; replace changed neighbor tags.
        newtags={}; total=None
        old={element(row):self.tags[k] for k,row in self.rows.items()}
        for k,row in rows.items():
            h=element(row); newtags[k]=old[h] if h in old else tag(h,self.key,self.y); total=add(total,newtags[k])
        self.rows=rows;self.tags=newtags;self.total=total;self.tables=tables
        self.pin=dict(revision=self.version,digest=point_json(total),counts={w:len(t) for w,t in tables.items()},y=point_json(self.y))
    def update(self, document=None, delete_id=None):
        if delete_id is not None: del self.docs[delete_id]
        if document is not None: self.docs[document['id']]=copy.deepcopy(document)
        self.rebuild()
    def server(self):
        return Server(copy.deepcopy(self.tables),copy.deepcopy(self.tags),self.total,copy.deepcopy(self.docs),self.version)
    def client(self): return Client(self.key,copy.deepcopy(self.pin))

class Server:
    def __init__(self,tables,tags,total,docs,revision):
        self.tables=tables;self.tags=tags;self.total=total;self.docs=docs;self.revision=revision
    def search(self,query):
        if not query or len(set(query))!=len(query) or any(w not in self.tables for w in query): raise ValueError('unprepared or duplicate query')
        # Greedy complete covering path across all requested keyword lists.
        positions={w:[r['position'] for r in self.tables[w]] for w in query}
        if any(not self.tables[w] for w in query):
            return dict(revision=self.revision,a1=[],path=[],rows=[],proof=point_json(self.total),results=[])
        def choose(xs):
            terminal=[x for x in xs if x['right'] is None]
            return min(terminal,key=lambda x:(x['position'],x['word'])) if terminal else max(xs,key=lambda x:(x['position'],x['word']))
        current=choose([self.tables[w][0] for w in query]);a1=[copy.deepcopy(current)]
        while current['right'] is not None:
            candidates=[]
            for w in query:
                i=bisect.bisect_right(positions[w],current['position'])
                if i<len(self.tables[w]):
                    row=self.tables[w][i]
                    if lower(row)<=current['position']:candidates.append(row)
            if not candidates:raise ValueError('No complete covering path')
            current=choose(candidates);a1.append(copy.deepcopy(current))
        evidence={keyrow(r):r for r in a1}; path=[]; matched=[]
        positions={w:[r['position'] for r in self.tables[w]] for w in query}
        for r in a1:
            alternatives=[]; same=[]
            for w in query:
                if w==r['word']: continue
                t=self.tables[w]; ps=positions[w]; i=bisect.bisect_left(ps,r['position'])
                for j in {max(0,i-1), min(len(t)-1,i)}:
                    if not t: continue
                    candidate=t[j]
                    if includes(candidate,r['position']):
                        if candidate['position']!=r['position']: alternatives.append(candidate)
                        else: same.append(candidate)
            if alternatives:
                cover=alternatives[0]; evidence[keyrow(cover)]=cover
                path.append(dict(base=list(keyrow(r)),cover=list(keyrow(cover))))
            else:
                group=[r]+same
                if {v['word'] for v in group}!=set(query): raise ValueError('missing cover')
                for v in group:evidence[keyrow(v)]=v
                matched.append(r['id']);path.append(dict(base=list(keyrow(r)),match=[list(keyrow(v)) for v in group]))
        proof=self.total
        for k in evidence:proof=add(proof,negate(self.tags[k]))
        return dict(revision=self.revision,a1=[list(keyrow(r)) for r in a1],path=path,
            rows=list(evidence.values()),proof=point_json(proof),results=[copy.deepcopy(self.docs[id]) for id in matched])

class Client:
    def __init__(self,key,pin):self.key=key;self.pin=pin;self.y=parse_point(pin['y'])
    def verify(self,query,response):
        try:return self._verify(query,response)
        except (ValueError,KeyError,TypeError,IndexError,OverflowError,AssertionError):return False,[]
    def _verify(self,query,r):
        assert query and len(query)==len(set(query)) and all(w in self.pin['counts'] for w in query)
        assert set(r)=={'revision','a1','path','rows','proof','results'} and r['revision']==self.pin['revision']
        rows={}
        for row in r['rows']:
            assert set(row)=={'word','position','id','left','right','body_sha256'} and row['word'] in query
            assert type(row['position']) is int and row['position']>0
            assert all(v is None or type(v) is int and v>0 for v in [row['left'],row['right']])
            k=keyrow(row);assert k not in rows;rows[k]=row
        check=parse_point(r['proof'])
        for row in rows.values():check=add(check,tag(element(row),self.key,self.y))
        assert point_json(check)==self.pin['digest']
        # Trusted counts are an explicit extension for prepared-empty admission, not the paper's one-digest claim.
        if any(self.pin['counts'][w]==0 for w in query):
            assert not r['a1'] and not r['path'] and not rows and not r['results'];return True,[]
        a1=[rows[tuple(k)] for k in r['a1']]
        assert a1 and len({keyrow(x) for x in a1})==len(a1) and len(r['path'])==len(a1)
        assert a1[0]['left'] is None and a1[-1]['right'] is None
        for prev,nxt in zip(a1,a1[1:]):assert prev['position']<nxt['position'] and prev['position']>=lower(nxt)
        matched={};used={keyrow(x) for x in a1}
        for row,step in zip(a1,r['path']):
            assert tuple(step['base'])==keyrow(row)
            if 'cover' in step:
                assert set(step)=={'base','cover'}
                other=rows[tuple(step['cover'])];used.add(keyrow(other))
                assert other['word']!=row['word'] and other['position']!=row['position'] and includes(other,row['position'])
            else:
                assert set(step)=={'base','match'}
                group=[rows[tuple(k)] for k in step['match']];used.update(keyrow(x) for x in group)
                assert len(group)==len(query) and {x['word'] for x in group}==set(query)
                assert all(x['position']==row['position'] and x['id']==row['id'] and x['body_sha256']==row['body_sha256'] for x in group)
                matched[row['id']]=row['body_sha256']
        assert used==set(rows)
        results={}
        for doc in r['results']:
            assert doc['id'] not in results and all(w in doc['keywords'] for w in query)
            results[doc['id']]=hashlib.sha256(bodybytes(doc)).hexdigest()
        assert results==matched
        return True,sorted(results)
