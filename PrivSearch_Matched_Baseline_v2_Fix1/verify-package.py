import hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parent
pins=json.loads((root/'package-files.json').read_text())
for name,expected in pins.items():
 p=root/name
 if hashlib.sha256(p.read_bytes()).hexdigest()!=expected:raise SystemExit('PACKAGE_FILE_CHANGED: '+name)
print('PACKAGE_FILES_VERIFIED:',len(pins))
