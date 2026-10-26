"""Offline qualification of pinned SeaCQ verifier code; no RPC, deployment or timing claim."""
import argparse, ast, contextlib, hashlib, importlib, io, json, math, pathlib, platform, sys, types

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()

def inspect(root, pins):
    for name, digest in pins['author_files'].items():
        p = root / name
        if p.is_symlink() or not p.is_file() or sha(p) != digest:
            raise ValueError('STAGE12_AUTHOR_FILE_HASH_MISMATCH: ' + name)
    evidence = []
    for variant in ['SeaCQ', 'FB-SeaCQ']:
        text = (root / variant / 'owner.py').read_text(encoding='utf-8-sig')
        tree = ast.parse(text)
        constructions = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == 'Accumulator']
        params = {k.arg: ast.literal_eval(k.value) for k in constructions[0].keywords}
        evidence.append({'variant_directory': variant, 'rsa_modulus_bits': (params['p'] * params['q']).bit_length(), 'factors_literal_in_owner_and_server': all(str(params[k]) in (root / variant / 'server.py').read_text() for k in ['p', 'q']), 'fixed_key_literals_present': 'XJTUOSV1' in text and 'XJTUOSV2' in text, 'aes_mode': 'ECB', 'representative_hash_input_bytes': 4, 'bare_latest_contract_calls': '.call()' in text, 'full_payload_retrieval_in_this_verifier': False})
    return evidence

class ReadResult:
    def __init__(self, value): self.value = value
    def call(self): return self.value

class BytesOnlyWeb3:
    @staticmethod
    def toBytes(v=None, text=None):
        return text.encode('utf-8') if text is not None else v.to_bytes(max(1, (v.bit_length() + 7) // 8), 'big')
    @staticmethod
    def toInt(v): return int.from_bytes(v, 'big')

def probe_variant(root, variant):
    # Legacy Web3 conversions only. Immutable local ADS reads replace the contract boundary.
    # Original verifier, AES and accumulator functions are executed without source edits.
    shim = types.ModuleType('web3'); shim.Web3 = BytesOnlyWeb3
    sys.modules['web3'] = shim
    for name in ['owner', 'Accumulator', 'numbthy', 'server']:
        sys.modules.pop(name, None)
    sys.path.insert(0, str(root / variant))
    try:
        owner = importlib.import_module('owner'); A = importlib.import_module('Accumulator')
        from Crypto.Cipher import AES
        constants = inspect_constants(root / variant / 'owner.py')
        msa = A.Accumulator(**constants)
        documents = {'1': {'alpha', 'beta'}, '2': {'alpha'}, '3': {'beta'}}
        w = 'alpha'; query = {'alpha', 'beta'}
        selected = ['1', '2']; expected = {'1'}
        product = lambda values: math.prod(values)
        pq = product(A.str2prime(t) for t in query if variant != 'SeaCQ' or t != w)
        ads_file = {fid: msa.genAcc({A.str2prime(t) for t in terms})[0] for fid, terms in documents.items()}
        ads_word = msa.genAcc({A.str2prime(fid) for fid in selected})[0]
        class Functions:
            def batch_get_ADS(self, names, count):
                if count != len(names): raise ValueError('local ADS count')
                return ReadResult([BytesOnlyWeb3.toBytes(ads_file[n.decode().lstrip('0')]) for n in names])
            def getADS(self, name, kind):
                if name.decode().lstrip('0') != w or kind != 1: raise ValueError('local ADS key')
                return ReadResult(BytesOnlyWeb3.toBytes(ads_word))
        contract = types.SimpleNamespace(functions=Functions())
        key = 'XJTUOSV2'.zfill(16).encode()
        cipher = AES.new(key, AES.MODE_ECB)
        response = set()
        for fid in selected:
            xp = product(A.str2prime(t) for t in documents[fid])
            encrypted = cipher.encrypt(fid.zfill(16).encode())
            if xp % pq == 0:
                response.add((encrypted, msa.prove_membership(pq, xp), 1))
            else:
                missing = pq // math.gcd(xp, pq)
                response.add((encrypted, msa.prove_non_membership(missing, xp), 0, missing))
        def verify(packet):
            with contextlib.redirect_stdout(io.StringIO()): result = owner.verify(w, pq, packet, None, contract, key)
            return {'accepted': bool(result[0]), 'result_count': len(result[1]), 'exact_reference_match': result[0] and result[1] == expected}
        honest = verify(response)
        omitted = verify({row for row in response if row[2] != 1})
        forged = verify({row if row[2] != 1 else (row[0], (0, constants['g']), 0, 1) for row in response})
        wrong_proof = verify({row if row[2] != 1 else (row[0], 0, 1) for row in response})
        phi = (constants['p'] - 1) * (constants['q'] - 1)
        trapdoor = None
        if math.gcd(pq, phi) == 1:
            forged_member = set()
            for row in response:
                fid = AES.new(key, AES.MODE_ECB).decrypt(row[0]).decode().lstrip('0')
                forged_member.add((row[0], pow(ads_file[fid], pow(pq, -1, phi), msa.n), 1))
            trapdoor = verify(forged_member)
        try:
            import hmac
            hmac.new(key=b'fixture', msg=b'fixture', digestmod='shake128').digest()
            digest_supported = True
        except (ValueError, TypeError): digest_supported = False
        return {'variant_directory': variant, 'case_scope': 'unchanged author verifier and accumulator; actual AES; synthetic three-document fixture; immutable local ADS; no blockchain network', 'reference_result_count': 1, 'honest': honest, 'ordinary_omission': omitted, 'invalid_membership_witness': wrong_proof, 'false_empty_unit_nonmembership': forged, 'false_positive_with_published_factors': trapdoor, 'shake128_hmac_supported_by_runtime': digest_supported, 'matched_assurance_eligible': False}
    finally:
        sys.path.pop(0)

def inspect_constants(path):
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    call = next(n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == 'Accumulator')
    return {k.arg: ast.literal_eval(k.value) for k in call.keywords}

def run(root, pins):
    static = inspect(root, pins)
    try:
        import Crypto
    except ImportError:
        return {'status': 'DEPENDENCY_BLOCKED', 'reason': 'PyCryptodome is required for actual author AES/verifier execution', 'static': static, 'probes': []}
    probes = [probe_variant(root, variant) for variant in ['SeaCQ', 'FB-SeaCQ']]
    for p in probes:
        if not p['honest']['exact_reference_match'] or p['ordinary_omission']['accepted'] or p['invalid_membership_witness']['accepted']:
            raise ValueError('STAGE12_AUTHOR_PROBE_CONTROL_FAILED')
    return {'schema': 'privsearch-stage12-author-probe-1', 'status': 'BASELINE_QUALIFICATION_BLOCKED', 'repository': pins['repository'], 'commit': pins['commit'], 'python': platform.python_version(), 'pycryptodome': Crypto.__version__, 'network_calls': 0, 'transactions': 0, 'author_files_modified': 0, 'author_source_sha256': {n: sha(root / n) for n in pins['author_files']}, 'static': static, 'probes': probes, 'finding_scope': 'Pinned experimental source only. This diagnostic does not establish a flaw in the published abstract construction or a measured PrivSearch speed advantage.'}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--author-root', required=True); parser.add_argument('--pins', required=True)
    args = parser.parse_args()
    sys.dont_write_bytecode = True
    try:
        result = run(pathlib.Path(args.author_root).resolve(), json.loads(pathlib.Path(args.pins).read_text()))
        print(json.dumps(result)); sys.exit(0 if result['status'] == 'BASELINE_QUALIFICATION_BLOCKED' else 2)
    except Exception as e:
        print(json.dumps({'status': 'AUTHOR_PROBE_STOPPED', 'error': type(e).__name__, 'reason': str(e)[:300]})); sys.exit(1)
