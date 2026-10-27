"""Deterministic test inputs; not photographs, scans or user drawings. Requires Pillow."""
import json
import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

root = Path(__file__).resolve().parents[2] / 'tests/fixtures/synthetic'
root.mkdir(parents=True, exist_ok=True)
# 20 mm/px; outer-wall centre lines at x=60/360,y=60/260; one 900mm gap.
walls = [([60, 60], [360, 60]), ([360, 60], [360, 260]),
         ([360, 260], [60, 260]), ([60, 260], [60, 60])]
base = Image.new('RGB', (420, 320), 'white')
draw = ImageDraw.Draw(base)
for a, b in walls:
    draw.line([tuple(a), tuple(b)], fill=(55, 55, 55), width=10)
draw.rectangle([150, 254, 194, 266], fill='white')
base.save(root / 'clean.png')
scan = base.rotate(0.7, resample=Image.Resampling.BICUBIC, fillcolor='white').filter(ImageFilter.GaussianBlur(0.65))
rng = random.Random(20261025)
pixels = scan.load()
for y in range(scan.height):
    for x in range(scan.width):
        noise = rng.randint(-12, 8)
        pixels[x, y] = tuple(max(0, min(255, v + noise)) for v in pixels[x, y])
scan.save(root / 'scan-like.png')
hand = Image.new('RGB', base.size, 'white')
d = ImageDraw.Draw(hand)
for a, b in walls:
    for shift in [-5, 5]:
        points = []
        for i in range(21):
            f = i / 20
            points.append((a[0] + (b[0] - a[0]) * f + (shift if a[0] == b[0] else rng.randint(-1, 1)),
                           a[1] + (b[1] - a[1]) * f + (shift if a[1] == b[1] else rng.randint(-1, 1))))
        d.line(points, fill=(70, 70, 70), width=2)
d.rectangle([150, 252, 194, 268], fill='white')
hand.save(root / 'handdrawn-like.png')
spec = {'name': 'Synthetic rectangular room', 'height': 2800, 'north': 0, 'walls': [
    {'id': f'synthetic-wall-{i + 1}', 'a': [p * 20 for p in a], 'b': [p * 20 for p in b], 't': 200,
     **({'openings': [{'id': 'synthetic-opening', 'type': 'door', 'from': 3000, 'to': 3900, 'sill': 0, 'head': 2100}]} if i == 2 else {})}
    for i, (a, b) in enumerate(walls)], 'rooms': [{'at': [4200, 3200], 'name': 'Synthetic room'}]}
(root / 'ground-truth.housespec.json').write_text(json.dumps(spec, indent=2), encoding='utf-8')
(root / 'provenance.json').write_text(json.dumps({
    'synthetic': True, 'generator': 'scripts/validation/generate-synthetic.py', 'seed': 20261025,
    'units': 'mm', 'millimetresPerPixel': 20,
    'expected': {'walls': 4, 'openings': 1, 'centrelineWidthMm': 6000, 'centrelineDepthMm': 4000},
    'note': 'All images are generated fixtures. Distortions are not evidence for real scans or hand drawings. Ground truth describes ideal geometry before image effects.',
}, indent=2), encoding='utf-8')
print(json.dumps({'synthetic': True, 'images': ['clean.png', 'scan-like.png', 'handdrawn-like.png']}))
