# Contact sheet: for each scene, photo | true cut-out | estimated cut-out | composite on a new background.
# python sheet.py <scenes> <out> <size> <out.jpg> <tag1> [tag2 ...]   (several tags → one column pair per tag)
import sys, os, json
import numpy as np
from PIL import Image

sc_dir, out_dir, size, dest, tags = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4], sys.argv[5:]
w, h = size, round(size * 1080 / 1920)
scenes = sorted(json.load(open(os.path.join(sc_dir, 'index.json'))).keys())
only = os.environ.get('ONLY')
if only:
    scenes = [s for s in scenes if any(o in s for o in only.split(','))]
yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
sky = np.stack([255 * (0.35 + 0.3 * yy / h), 120 + 60 * yy / h + 0 * xx, 255 + 0 * xx], -1)   # violet-blue: shows any wall left over
sky = np.clip(sky, 0, 255)
check = ((xx // 12 + yy // 12) % 2)[..., None] * 40 + sky * 0.85


def raw(p, ch):
    a = np.fromfile(p, np.uint8)
    return a.reshape(h, w, ch) if ch > 1 else a.reshape(h, w)


rows = []
for s in scenes:
    F = raw(os.path.join(sc_dir, f'{s}_frame_{size}.raw'), 4)[..., :3].astype(np.float32)
    A = raw(os.path.join(sc_dir, f'{s}_alpha_{size}.raw'), 1).astype(np.float32) / 255
    cells = [F, np.repeat(A[..., None] * 255, 3, -1)]
    for t in tags:
        a = raw(os.path.join(out_dir, f'{t}_{s}_{size}_alpha.raw'), 1).astype(np.float32) / 255
        sh = raw(os.path.join(out_dir, f'{t}_{s}_{size}_shadow.raw'), 1).astype(np.float32) / 255
        comp = check * (1 - 0.85 * sh[..., None])
        comp = comp * (1 - a[..., None]) + F * a[..., None]
        cells += [np.repeat(a[..., None] * 255, 3, -1), comp]
    rows.append(np.concatenate(cells, 1))
img = np.concatenate(rows, 0).clip(0, 255).astype(np.uint8)
im = Image.fromarray(img)
if im.width > 2400:
    im = im.resize((2400, round(im.height * 2400 / im.width)), Image.LANCZOS)
im.save(dest, quality=88)
print(im.size)
