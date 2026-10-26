"""Verify this release's explicit source inventory without external services."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'release/files.sha256.json').read_text())
errors = []
for name, expected in manifest.items():
    path = root / name
    if not path.is_file():
        errors.append(f'MISSING: {name}')
    elif hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        errors.append(f'CHANGED: {name}')
if errors:
    raise SystemExit('\n'.join(errors))
print(f'RELEASE_FILES_VERIFIED: {len(manifest)}')
