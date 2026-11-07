// Scores a cut-out (keyMask from an fx.js) against the test scenes' true answers.
// node tools/keybench/bench.js fx.js <scenes dir> <out dir> [sizes, e.g. 480,640] [cut] [tag]
// (make the scenes first: python tools/keybench/make_scenes.py <scenes dir>; needs numpy, scipy, Pillow)
'use strict';
const fs = require('fs'), path = require('path');
const [, , fxPath, dir, outDir, sizesArg = '320,480,640', cutArg = '0.5', tag = 'run'] = process.argv;
const Fx = new Function(fs.readFileSync(fxPath, 'utf8') + '\nreturn Fx;')();   // (a vm sandbox makes Math calls ~30x slower)
const scenes = Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'))).sort();
const sizes = sizesArg.split(',').map(Number), cut = Number(cutArg);
fs.mkdirSync(outDir, { recursive: true });

function grow(bin, w, h, r) {           // square dilation, r steps
  let a = bin;
  for (let k = 0; k < r; k++) {
    const b = new Uint8Array(a.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      b[i] = a[i] || (x > 0 && a[i - 1]) || (x < w - 1 && a[i + 1]) || (y > 0 && a[i - w]) || (y < h - 1 && a[i + w]) ? 1 : 0;
    }
    a = b;
  }
  return a;
}

const rows = [];
for (const s of scenes) for (const w of sizes) {
  const h = Math.round((w * 1080) / 1920), n = w * h;
  const rd = (k) => new Uint8Array(fs.readFileSync(path.join(dir, `${s}_${k}_${w}.raw`)));
  const F = new Uint8ClampedArray(rd('frame')), P = new Uint8ClampedArray(rd('plate')), A = rd('alpha'), SH = rd('shadow');
  const t0 = performance.now();
  const res = Fx.keyMask(F, P, w, h, cut, true);
  const ms = performance.now() - t0;
  const a = res.alpha, sh = res.shadow;
  let inter = 0, uni = 0, tru = 0, fa = 0, sad = 0, tot = 0;
  const tb = new Uint8Array(n), outside = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const t = A[i] >= 128, e = a[i] >= 128;
    tb[i] = t ? 1 : 0; outside[i] = t ? 0 : 1;
    if (t && e) inter++;
    if (t || e) uni++;
    if (t) tru++;
    if (e && !t) fa++;
    sad += Math.abs(a[i] - A[i]); tot += A[i];
  }
  const dil = grow(tb, w, h, 3), ero = grow(outside, w, h, 3);
  let halo = 0, hn = 0, eaten = 0, en = 0, shf = 0, shn = 0;
  for (let i = 0; i < n; i++) {
    if (dil[i] && A[i] < 13) { halo += a[i]; hn++; }
    if (ero[i] && A[i] > 242) { eaten += 255 - a[i]; en++; }
    if (SH[i] > 40 && A[i] < 13) { shn++; if (a[i] >= 128) shf++; }
  }
  if (!tru) {       // an empty room: everything should be background
    let sum = 0; for (let i = 0; i < n; i++) sum += a[i];
    rows.push({ scene: s, w, empty: true, kept: fa / n, meanA: sum / 255 / n, ms });
  } else rows.push({ scene: s, w, iou: inter / uni, keep: inter / tru, extra: fa / tru, sad: sad / tot, halo: halo / 255 / Math.max(1, hn), eaten: eaten / 255 / Math.max(1, en), shadowAsToy: shf / Math.max(1, shn), ms });
  fs.writeFileSync(path.join(outDir, `${tag}_${s}_${w}_alpha.raw`), Buffer.from(a.buffer, a.byteOffset, a.length));
  fs.writeFileSync(path.join(outDir, `${tag}_${s}_${w}_shadow.raw`), Buffer.from(sh.buffer, sh.byteOffset, sh.length));
}
const pc = (v) => (100 * v).toFixed(1).padStart(6);
console.log(`${tag}  cut ${cut}`);
console.log('scene                        size    IoU   kept  extra    SAD   halo  eaten shadow->toy    ms');
for (const r of rows) {
  if (r.empty) console.log(`${r.scene.padEnd(28)} ${String(r.w).padStart(4)}   empty room: ${pc(r.kept)}% kept as toy, mean alpha ${pc(r.meanA)}%              ${r.ms.toFixed(0).padStart(5)}`);
  else console.log(`${r.scene.padEnd(28)} ${String(r.w).padStart(4)} ${pc(r.iou)} ${pc(r.keep)} ${pc(r.extra)} ${pc(r.sad)} ${pc(r.halo)} ${pc(r.eaten)} ${pc(r.shadowAsToy)}     ${r.ms.toFixed(0).padStart(5)}`);
}
const by = {};
for (const r of rows) (by[r.w] = by[r.w] || []).push(r);
for (const [w, all] of Object.entries(by)) {
  const rs = all.filter((r) => !r.empty), es = all.filter((r) => r.empty);
  const m = (k) => rs.reduce((a, r) => a + r[k], 0) / rs.length;
  console.log(`${'MEAN (toys)'.padEnd(28)} ${String(w).padStart(4)} ${pc(m('iou'))} ${pc(m('keep'))} ${pc(m('extra'))} ${pc(m('sad'))} ${pc(m('halo'))} ${pc(m('eaten'))} ${pc(m('shadowAsToy'))}     ${(all.reduce((a, r) => a + r.ms, 0) / all.length).toFixed(0).padStart(5)}`);
  if (es.length) console.log(`${'MEAN (empty rooms)'.padEnd(28)} ${String(w).padStart(4)}   ${pc(es.reduce((a, r) => a + r.kept, 0) / es.length)}% kept as toy, worst ${pc(Math.max(...es.map((r) => r.kept)))}%`);
}
fs.writeFileSync(path.join(outDir, `${tag}_scores.json`), JSON.stringify(rows, null, 1));
