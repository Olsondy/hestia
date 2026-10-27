"""Runs an explicitly selected local analyzer against generated fixtures only; no network."""
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path
import PIL
import numpy
import cv2

parser = argparse.ArgumentParser()
parser.add_argument('--analyzer', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
analyzer = args.analyzer.resolve(strict=True)
root = Path(__file__).resolve().parents[2]
fixtures = root / 'tests/fixtures/synthetic'
report = {'evidence': 'local-algorithm-on-synthetic-images-only',
          'analyzerSha256': hashlib.sha256(analyzer.read_bytes()).hexdigest(),
          'dependencies': {'python': sys.version.split()[0], 'Pillow': PIL.__version__, 'numpy': numpy.__version__, 'opencv': cv2.__version__},
          'scale': {'mmPerPixel': 20, 'source': 'synthetic-generator-ground-truth'},
          'realDrawingEvaluation': 'not-run', 'cases': []}
for filename in ['clean.png', 'scan-like.png', 'handdrawn-like.png']:
    with tempfile.TemporaryDirectory(prefix='hestia-synthetic-') as output:
        flags = ['--outlined'] if filename == 'handdrawn-like.png' else []
        command = [sys.executable, str(analyzer), str(fixtures / filename), '--scale', '20', '--out', output, *flags]
        completed = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', timeout=30)
        case = {'fixture': filename, 'extraFlags': flags, 'exitCode': completed.returncode,
                'expected': {'walls': 4, 'openings': 1}}
        if completed.returncode:
            case['failure'] = completed.stderr.strip() or completed.stdout.strip()
            case['actual'] = None
        else:
            draft = json.loads((Path(output) / 'draft.json').read_text(encoding='utf-8'))
            # Remove absolute machine paths before retaining synthetic evidence.
            draft['underlay']['image'] = filename
            case['actual'] = {'walls': len(draft['walls']), 'openings': sum(len(w.get('openings', [])) for w in draft['walls'])}
            case['draft'] = draft
            # Recover original image coordinate frame from explicit underlay offset.
            # Counts alone do not prove geometry: retain actual line intervals for review.
            ox, oy = draft['underlay']['x'], draft['underlay']['y']
            case['wallsInImageMm'] = [{'a': [w['a'][0] - ox, w['a'][1] - oy],
                                       'b': [w['b'][0] - ox, w['b'][1] - oy]} for w in draft['walls']]
        report['cases'].append(case)
args.output.parent.mkdir(parents=True, exist_ok=True)
with args.output.open('x', encoding='utf-8') as f:
    json.dump(report, f, indent=2, ensure_ascii=False)
print(json.dumps({k: report[k] for k in ['evidence', 'realDrawingEvaluation']}, ensure_ascii=False))
