'use strict';
/* Stop Motion: the effects engine. It lines photos up (steady camera), evens out the
   light, fills in the magic eraser, cuts toys out for magic backgrounds, frames the
   picture (zoom, move, straighten) and draws one finished frame of the movie.
   Heavy pixel work runs on small copies of the photos. Loaded before the main
   script, so nothing here touches the page until it is called. */
const Fx = (() => {
  const AW = 480;      // width of the copies used to line photos up
  const EW = 320;      // width of magic-eraser masks
  const LIVE_KW = 320; // width of the live cut-out on the camera screen
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  const ctxR = (c) => c.getContext('2d', { willReadFrequently: true });
  const yieldUI = () => new Promise((r) => setTimeout(r, 0));

  // ---------- 2D transforms, in the same form as canvas setTransform ----------
  const M = {
    id: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    mul: (m, n) => ({ a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b, c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d, e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f }),
    inv(m) { const det = m.a * m.d - m.b * m.c || 1e-12; return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det }; },
    scale: (sx, sy = sx) => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }),
    move: (x, y) => ({ a: 1, b: 0, c: 0, d: 1, e: x, f: y }),
    set(x, m) { x.setTransform(m.a, m.b, m.c, m.d, m.e, m.f); },
    pt: (m, x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f],
    // A "sim" {a, b, tx, ty}: x' = a·x − b·y + tx, y' = b·x + a·y + ty (turn + zoom + slide).
    sim: (s) => ({ a: s.a, b: s.b, c: -s.b, d: s.a, e: s.tx, f: s.ty }),
  };
  const ID = { a: 1, b: 0, tx: 0, ty: 0 };
  const applySim = (s, u, v) => [s.a * u - s.b * v + s.tx, s.b * u + s.a * v + s.ty];
  function invSim(s) { const d = s.a * s.a + s.b * s.b || 1e-12, a = s.a / d, b = -s.b / d; return { a, b, tx: -(a * s.tx - b * s.ty), ty: -(b * s.tx + a * s.ty) }; }
  const mulSim = (s, t) => ({ a: s.a * t.a - s.b * t.b, b: s.b * t.a + s.a * t.b, tx: s.a * t.tx - s.b * t.ty + s.tx, ty: s.b * t.tx + s.a * t.ty + s.ty });
  const scaleSim = (s, k) => ({ a: s.a, b: s.b, tx: s.tx * k, ty: s.ty * k });

  // Scratch canvases, reused between frames (only touched by code that does not wait in between).
  const pool = {};
  function scratch(name, w, h) {
    let c = pool[name];
    if (!c) c = pool[name] = mk(w, h);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return c;
  }

  // ---------- framing: which part of the photo shows (zoom, move, straighten) ----------
  const SHAPES = { wide: 16 / 9, tv: 4 / 3, square: 1, tall: 9 / 16 };
  function frameGeom(m, full) {
    const W0 = m.w || 1280, H0 = m.h || 720;
    if (full) return { W0, H0, cw: W0, ch: H0, cx: W0 / 2, cy: H0 / 2, rot: 0, z: 1 };
    const f = (m.edit && m.edit.frame) || {};
    const A = SHAPES[f.shape] || W0 / H0;
    let bw, bh;
    if (A >= W0 / H0) { bw = W0; bh = W0 / A; } else { bh = H0; bw = H0 * A; }
    const rot = clamp(f.rot || 0, -0.3, 0.3), c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
    const hx0 = (bw / 2) * c + (bh / 2) * s, hy0 = (bw / 2) * s + (bh / 2) * c;
    const z = Math.max(clamp(f.zoom || 1, 1, 4), hx0 / (W0 / 2), hy0 / (H0 / 2)); // a turned frame zooms in so no corner falls off
    const hx = hx0 / z, hy = hy0 / z;
    const cx = clamp((f.cx == null ? 0.5 : f.cx) * W0, hx, W0 - hx), cy = clamp((f.cy == null ? 0.5 : f.cy) * H0, hy, H0 - hy);
    return { W0, H0, cw: bw / z, ch: bh / z, cx, cy, rot, z };
  }
  // Maps photo pixels to output pixels for a W×H output.
  function outMatrix(g, W, H) {
    const s = W / g.cw, co = Math.cos(g.rot), sn = Math.sin(g.rot);
    const a = s * co, b = s * sn, c = -s * sn, d = s * co;
    return { a, b, c, d, e: W / 2 - (a * g.cx + c * g.cy), f: H / 2 - (b * g.cx + d * g.cy) };
  }
  function fitSize(aspect, maxW, maxH) {
    let w = maxW, h = maxW / aspect;
    if (h > maxH) { h = maxH; w = maxH * aspect; }
    return [Math.max(2, Math.round(w / 2) * 2), Math.max(2, Math.round(h / 2) * 2)];
  }

  // ---------- the movie's edit settings ----------
  function defaults() {
    return {
      v: 1,
      frame: { shape: 'orig', zoom: 1, cx: 0.5, cy: 0.5, rot: 0 },
      steady: false, even: false, fillFrom: 'first',
      scene: { bg: 'none', fg: 'none', cut: 0.5, shadows: true },
      look: 'none', lookAmt: 0.85, light: 'none', spot: { x: 0.5, y: 0.6, r: 0.3 },
      title: { on: true, text: '', sub: '', style: 'theater' },
      curtains: true, applause: true,
      credits: { on: true, director: (typeof Settings !== 'undefined' && Settings.v.director) || '', cast: '', thanks: '', end: 'The End' },
      stickers: [], sounds: [], voices: [], music: { track: 'none', vol: 0.6 },
      holds: {}, boomerang: false, smooth: 0,
    };
  }
  function ensureEdit(m) {
    const d = defaults(), e = m.edit || {};
    const out = { ...d, ...e };
    for (const k of ['frame', 'scene', 'spot', 'title', 'credits', 'music']) out[k] = { ...d[k], ...(e[k] || {}) };
    for (const k of ['stickers', 'sounds', 'voices']) out[k] = Array.isArray(e[k]) ? e[k] : [];
    out.holds = e.holds && typeof e.holds === 'object' ? e.holds : {};
    m.edit = out;
    return m;
  }

  // ---------- lining photos up ----------
  function grabFeat(img, W0, H0) {
    const w = AW, h = Math.round((AW * H0) / W0), c = scratch('feat', w, h), x = ctxR(c);
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
    x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, w, h);
    const rgba = x.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
    return { an: analyze(gray, w, h), rgba, w, h };
  }
  // How badly one patch of the reference disagrees with the photo shifted by (dx, dy).
  function patchCost(A, B, x0, y0, x1, y1, dx, dy) {
    const w = A.w, h = A.h, a = A.d, b = B.d, T = 1.2;
    const xa = Math.max(x0, 1 - dx, 1), xb = Math.min(x1, w - 1 - dx, w - 1);
    const ya = Math.max(y0, 1 - dy, 1), yb = Math.min(y1, h - 1 - dy, h - 1);
    if (xb - xa < (x1 - x0) * 0.6 || yb - ya < (y1 - y0) * 0.6) return Infinity;
    let s = 0;
    for (let y = ya; y < yb; y++) {
      const ra = y * w, rb = (y + dy) * w + dx;
      for (let x = xa; x < xb; x++) { let e = a[ra + x] - b[rb + x]; if (e < 0) e = -e; s += e < T ? e : T; }
    }
    return s / ((xb - xa) * (yb - ya));
  }
  function patchShift(A, B, x0, y0, x1, y1, gx, gy, R) {
    const n = 2 * R + 1, grid = new Float64Array(n * n);
    let best = Infinity, bx = gx, by = gy, sum = 0, cnt = 0;
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const c = patchCost(A, B, x0, y0, x1, y1, gx + i, gy + j);
      grid[(j + R) * n + (i + R)] = c;
      if (c === Infinity) continue;
      sum += c; cnt++;
      if (c < best) { best = c; bx = gx + i; by = gy + j; }
    }
    if (!cnt || best === Infinity) return null;
    const at = (dx, dy) => { const i = dx - gx, j = dy - gy; return Math.abs(i) <= R && Math.abs(j) <= R ? grid[(j + R) * n + (i + R)] : patchCost(A, B, x0, y0, x1, y1, dx, dy); };
    const sub = (m, p) => { const den = m - 2 * best + p; return den > 1e-6 && isFinite(den) ? clamp((0.5 * (m - p)) / den, -0.5, 0.5) : 0; };
    return {
      dx: bx + sub(at(bx - 1, by), at(bx + 1, by)), dy: by + sub(at(bx, by - 1), at(bx, by + 1)),
      peak: best / (sum / cnt), edge: Math.abs(bx - gx) === R || Math.abs(by - gy) === R,
    };
  }
  // Least-squares turn + zoom + slide from point pairs (cur → ref).
  function solveSim(ps, turn) {
    let W = 0, mu = 0, mv = 0, mx = 0, my = 0;
    for (const p of ps) { W += p.w; mu += p.w * p.u; mv += p.w * p.v; mx += p.w * p.x; my += p.w * p.y; }
    if (W <= 0) return null;
    mu /= W; mv /= W; mx /= W; my /= W;
    let a = 1, b = 0;
    if (turn) {
      let n1 = 0, n2 = 0, den = 0;
      for (const p of ps) { const U = p.u - mu, V = p.v - mv, X = p.x - mx, Y = p.y - my; n1 += p.w * (U * X + V * Y); n2 += p.w * (U * Y - V * X); den += p.w * (U * U + V * V); }
      if (den > 1e-6) { a = n1 / den; b = n2 / den; }
      const s = Math.hypot(a, b);
      if (!(s > 0.94 && s < 1.06) || Math.abs(Math.atan2(b, a)) > 0.08) { a = 1; b = 0; }
    }
    return { a, b, tx: mx - (a * mu - b * mv), ty: my - (b * mu + a * mv) };
  }
  function fitSim(pairs) {
    if (pairs.length < 2) return null;
    let use = pairs;
    for (let it = 0; it < 4; it++) {
      const fit = solveSim(use, use.length >= 4);
      if (!fit) return null;
      const res = pairs.map((p) => { const [x, y] = applySim(fit, p.u, p.v); return Math.hypot(x - p.x, y - p.y); });
      const med = res.slice().sort((a, b) => a - b)[res.length >> 1], thr = Math.max(0.8, med * 2.5);
      const next = pairs.filter((p, i) => res[i] <= thr);
      if (next.length < 2 || next.length === use.length) break;
      use = next;
    }
    const fit = solveSim(use, use.length >= 4);
    if (!fit) return null;
    let e = 0;
    for (const p of use) { const [x, y] = applySim(fit, p.u, p.v); e += (x - p.x) ** 2 + (y - p.y) ** 2; }
    return Object.assign(fit, { inl: use.length, rms: Math.sqrt(e / use.length) });
  }
  // Lines photo C up with reference R. (gdx, gdy) is a rough shift from the tiny copies.
  function alignPair(R, C, gdx, gdy) {
    const A = R.an.pyr[0], B = C.an.pyr[0], w = A.w, h = A.h;
    const NX = 5, NY = 4, mx = Math.round(w * 0.04), my = Math.round(h * 0.05), pw = (w - 2 * mx) / NX, ph = (h - 2 * my) / NY;
    const patches = [];
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const x0 = Math.round(mx + i * pw), y0 = Math.round(my + j * ph), x1 = Math.round(mx + (i + 1) * pw), y1 = Math.round(my + (j + 1) * ph);
      let tex = 0, cnt = 0;
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { tex += A.d[y * w + x]; cnt++; }
      tex /= cnt;
      if (tex > 0.3) patches.push({ x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, tex });
    }
    if (patches.length < 3) return null;
    const run = (guess, Rr) => {
      const pairs = [];
      for (const p of patches) {
        const [gx, gy] = guess(p.cx, p.cy), s = patchShift(A, B, p.x0, p.y0, p.x1, p.y1, Math.round(gx), Math.round(gy), Rr);
        if (!s || s.edge || s.peak > 0.88) continue;
        pairs.push({ u: p.cx + s.dx, v: p.cy + s.dy, x: p.cx, y: p.cy, w: Math.min(2, p.tex) * (1 - s.peak) });
      }
      return fitSim(pairs);
    };
    const fit = run(() => [gdx, gdy], 4);
    if (!fit) return null;
    const inv = invSim(fit);
    const fit2 = run((x, y) => { const [u, v] = applySim(inv, x, y); return [u - x, v - y]; }, 2);
    return fit2 && fit2.inl >= fit.inl - 1 ? fit2 : fit;
  }
  // How much brighter each color channel of C is than R, on the background (middle value of many spots).
  function lightRatio(R, C, sim) {
    const inv = invSim(sim), w = R.w, h = R.h, a = R.rgba, b = C.rgba;
    const hist = [new Uint32Array(128), new Uint32Array(128), new Uint32Array(128)];
    for (let y = 4; y < h - 4; y += 5) for (let x = 4; x < w - 4; x += 5) {
      const [u, v] = applySim(inv, x, y), ui = Math.round(u), vi = Math.round(v);
      if (ui < 0 || vi < 0 || ui >= w || vi >= h) continue;
      const pa = (y * w + x) * 4, pb = (vi * w + ui) * 4;
      for (let c = 0; c < 3; c++) {
        const ra = a[pa + c], rb = b[pb + c];
        if (ra < 14 || ra > 245 || rb < 8 || rb > 250) continue;
        const bin = Math.round(Math.log2(rb / ra) * 64 + 64);
        if (bin >= 0 && bin < 128) hist[c][bin]++;
      }
    }
    return hist.map((hh) => {
      let tot = 0; for (const v of hh) tot += v;
      if (tot < 30) return 1;
      for (let i = 0, acc = 0; i < 128; i++) { acc += hh[i]; if (acc >= tot / 2) return Math.pow(2, (i - 64) / 64); }
      return 1;
    });
  }

  // ---------- cut-outs: what in a photo is not the empty set ----------
  function box1(a, w, h) {
    const t = new Uint8Array(a.length);
    for (let y = 0; y < h; y++) { const r = y * w; for (let x = 0; x < w; x++) t[r + x] = (a[r + (x > 0 ? x - 1 : x)] + a[r + x] + a[r + (x < w - 1 ? x + 1 : x)]) / 3; }
    for (let y = 0; y < h; y++) { const u = (y > 0 ? y - 1 : y) * w, r = y * w, d = (y < h - 1 ? y + 1 : y) * w; for (let x = 0; x < w; x++) a[r + x] = (t[u + x] + t[r + x] + t[d + x]) / 3; }
  }
  // Flips connected blobs of `val` smaller than minArea (holes only: blobs not touching the edge).
  // With keepEdge it changes nothing and returns the blobs that reach within `margin` of the edge.
  function dropBlobs(bin, w, h, val, minArea, holesOnly, keepEdge, margin = 0) {
    const n = w * h, seen = new Uint8Array(n), stack = new Int32Array(n), blob = new Int32Array(n), out = [];
    for (let s = 0; s < n; s++) {
      if (seen[s] || bin[s] !== val) continue;
      let sp = 0, cnt = 0, edge = false;
      stack[sp++] = s; seen[s] = 1;
      while (sp) {
        const i = stack[--sp], x = i % w, y = (i - x) / w;
        blob[cnt++] = i;
        if (x <= margin || y <= margin || x >= w - 1 - margin || y >= h - 1 - margin) edge = true;
        if (x > 0 && !seen[i - 1] && bin[i - 1] === val) { seen[i - 1] = 1; stack[sp++] = i - 1; }
        if (x < w - 1 && !seen[i + 1] && bin[i + 1] === val) { seen[i + 1] = 1; stack[sp++] = i + 1; }
        if (y > 0 && !seen[i - w] && bin[i - w] === val) { seen[i - w] = 1; stack[sp++] = i - w; }
        if (y < h - 1 && !seen[i + w] && bin[i + w] === val) { seen[i + w] = 1; stack[sp++] = i + w; }
      }
      if (keepEdge) { if (edge) out.push(blob.slice(0, cnt)); continue; }
      if (cnt < minArea && !(holesOnly && edge)) for (let j = 0; j < cnt; j++) bin[blob[j]] = 1 - val;
    }
    return out;
  }
  // Work buffers, kept between calls (the camera screen cuts out several times a second).
  const bufs = {};
  function buf(name, n, T = Float32Array) {
    const b = bufs[name];
    return b && b.length === n && b instanceof T ? b : (bufs[name] = new T(n));
  }
  // [1 2 1] blur in both directions (edges repeat).
  function blur121(s, w, h, o, t) {
    for (let y = 0; y < h; y++) {
      const r = y * w;
      if (w < 2) { t[r] = s[r]; continue; }
      t[r] = (3 * s[r] + s[r + 1]) * 0.25;
      for (let x = 1; x < w - 1; x++) t[r + x] = (s[r + x - 1] + 2 * s[r + x] + s[r + x + 1]) * 0.25;
      t[r + w - 1] = (s[r + w - 2] + 3 * s[r + w - 1]) * 0.25;
    }
    for (let y = 0; y < h; y++) {
      const r = y * w, u = y > 0 ? r - w : r, d = y < h - 1 ? r + w : r;
      for (let x = 0; x < w; x++) o[r + x] = (t[u + x] + 2 * t[r + x] + t[d + x]) * 0.25;
    }
  }
  // Mean over a (2r+1)² square (smaller at the edges).
  function boxMean(s, w, h, r, o, t) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = 0; x <= r && x < w; x++) acc += s[row + x];
      for (let x = 0; x < w; x++) {
        t[row + x] = acc / (Math.min(w - 1, x + r) - Math.max(0, x - r) + 1);
        if (x + r + 1 < w) acc += s[row + x + r + 1];
        if (x - r >= 0) acc -= s[row + x - r];
      }
    }
    const acc = buf('boxAcc', w, Float64Array);
    acc.fill(0);
    for (let y = 0; y <= r && y < h; y++) for (let x = 0, row = y * w; x < w; x++) acc[x] += t[row + x];
    for (let y = 0; y < h; y++) {
      const row = y * w, inv = 1 / (Math.min(h - 1, y + r) - Math.max(0, y - r) + 1);
      for (let x = 0; x < w; x++) o[row + x] = acc[x] * inv;
      if (y + r + 1 < h) for (let x = 0, a = (y + r + 1) * w; x < w; x++) acc[x] += t[a + x];
      if (y - r >= 0) for (let x = 0, a = (y - r) * w; x < w; x++) acc[x] -= t[a + x];
    }
  }
  // How one colour channel changed between the empty set and this photo (exposure, white balance,
  // tone curve): photo value for each empty-set value, from the middle photo value at each level.
  // Most pixels are the room, so toys hardly move it; it stays close to one overall gain.
  function toneLUT(fp, pp, ok, n, lut) {
    const hist = buf('tlHist', 32 * 256, Uint32Array), cnt = buf('tlCnt', 32, Uint32Array), rat = buf('tlRat', 32, Float64Array);
    hist.fill(0); cnt.fill(0);
    for (let i = 0; i < n; i += 2) {
      if (!ok[i]) continue;
      const p = pp[i] | 0, f = fp[i] | 0;
      if (p < 8 || p > 247 || f > 251) continue;
      hist[(p >> 3) * 256 + f]++; cnt[p >> 3]++;
    }
    const all = [];
    for (let b = 0; b < 32; b++) {
      rat[b] = NaN;
      if (cnt[b] < 40) continue;
      for (let f = 0, acc = 0, row = b * 256; f < 256; f++) { acc += hist[row + f]; if (acc * 2 >= cnt[b]) { rat[b] = (f + 0.5) / (b * 8 + 4); break; } }
      all.push([rat[b], cnt[b]]);
    }
    let g = 1;
    if (all.length) {
      all.sort((a, b) => a[0] - b[0]);
      let tot = 0; for (const a of all) tot += a[1];
      for (let i = 0, acc = 0; i < all.length; i++) { acc += all[i][1]; if (acc * 2 >= tot) { g = all[i][0]; break; } }
    }
    for (let b = 0; b < 32; b++) if (rat[b] === rat[b]) rat[b] = clamp(rat[b], g / 1.08, g * 1.08);
    for (let b = 0; b < 32; b++) if (rat[b] !== rat[b]) {        // fill gaps from the nearest levels
      let l = b - 1, r = b + 1;
      while (l >= 0 && rat[l] !== rat[l]) l--;
      while (r < 32 && rat[r] !== rat[r]) r++;
      rat[b] = l >= 0 && r < 32 ? rat[l] + ((rat[r] - rat[l]) * (b - l)) / (r - l) : l >= 0 ? rat[l] : r < 32 ? rat[r] : g;
    }
    for (let v = 0; v < 256; v++) {
      const u = clamp((v - 4) / 8, 0, 31), b0 = Math.floor(u), b1 = Math.min(31, b0 + 1), t = u - b0;
      lut[v] = v * (rat[b0] * (1 - t) + rat[b1] * t);
    }
  }
  const mapv = (lut, v) => { const i = v | 0; return i >= 255 ? lut[255] : lut[i] + (lut[i + 1] - lut[i]) * (v - i); };
  // Middle and quartiles of a value over the picture (mostly the room, so: the camera's noise).
  function spread(a, ok, n, lo, hi, step) {
    const N = Math.round((hi - lo) / step), hist = buf('spHist' + N, N + 1, Uint32Array);
    hist.fill(0);
    let tot = 0;
    for (let i = 0; i < n; i += 2) if (ok[i]) { hist[clamp(Math.round((a[i] - lo) / step), 0, N)]++; tot++; }
    const at = (q) => { for (let k = 0, acc = 0; k <= N; k++) { acc += hist[k]; if (acc >= q * tot) return lo + k * step; } return hi; };
    return { mid: at(0.5), lo: at(0.25), hi: at(0.75) };
  }

  // Lines the empty set up with the photo to a fraction of a pixel (a bump of the iPad, focus
  // breathing, whatever steady-camera left): shift, turn and zoom, fitted on the room's edges
  // (toys and shadows don't fit, so they drop out). fit {tx, ty, a, b}: photo pixel (x, y) shows
  // empty-set point u = cx + (1+a)X − bY + tx, v = cy + bX + (1+a)Y + ty, with X = x − cx, Y = y − cy.
  // warm: fit is last moment's answer (the camera screen), so only the full size is checked.
  function fineAlign(fy, qy, ok, w, h, fit, warm) {
    let p = fit;
    if (!warm) {
      const lv = [[fy, qy, ok, w, h]];
      for (let L = 1; L <= 3; L++) {
        const [f, q, o, W, H] = lv[L - 1], w2 = W >> 1, h2 = H >> 1, n2 = w2 * h2;
        const fh = buf('pyF' + L, n2), qh = buf('pyQ' + L, n2), oh = buf('pyO' + L, n2, Uint8Array);
        for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
          const i = 2 * y * W + 2 * x, j = y * w2 + x;
          fh[j] = (f[i] + f[i + 1] + f[i + W] + f[i + W + 1]) * 0.25;
          qh[j] = (q[i] + q[i + 1] + q[i + W] + q[i + W + 1]) * 0.25;
          oh[j] = o[i] & o[i + 1] & o[i + W] & o[i + W + 1];
        }
        lv.push([fh, qh, oh, w2, h2]);
      }
      // A knock can move the picture further than the fit reaches: first try whole steps at 1/8 size.
      const [s0, s1] = coarseShift(...lv[3]);
      p = { tx: fit.tx / 4 + s0 * 2, ty: fit.ty / 4 + s1 * 2, a: fit.a, b: fit.b };
      p = lkLevel(...lv[2], p, 1, 6, 'q');
      p = lkLevel(...lv[1], { tx: p.tx * 2, ty: p.ty * 2, a: p.a, b: p.b }, 1, 4, 'h');
      p = { tx: p.tx * 2, ty: p.ty * 2, a: p.a, b: p.b };
    }
    p = lkLevel(fy, qy, ok, w, h, p, 2, warm ? 3 : 4, 'f');
    const lim = Math.max(6, w / 12);
    return Math.abs(p.tx) > lim || Math.abs(p.ty) > lim || Math.abs(p.a) > 0.03 || Math.abs(p.b) > 0.03 ? { tx: 0, ty: 0, a: 0, b: 0 } : p;
  }
  // The whole-pixel shift (up to 5 each way) that best matches two small pictures, counting only
  // where the empty set has some edge; no shift unless another matches clearly better.
  function coarseShift(f, q, ok, w, h) {
    let best = [0, 0], bestC = Infinity, c0 = Infinity;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      let sum = 0, cnt = 0;
      for (let y = Math.max(1, -dy + 1); y < Math.min(h - 1, h - dy - 1); y++) for (let x = Math.max(1, -dx + 1); x < Math.min(w - 1, w - dx - 1); x++) {
        const j = (y + dy) * w + x + dx;
        if (!ok[j] || Math.abs(q[j + 1] - q[j - 1]) + Math.abs(q[j + w] - q[j - w]) < 6) continue;
        sum += Math.min(18, Math.abs(f[y * w + x] - q[j])); cnt++;
      }
      if (cnt < 20) continue;
      const c = sum / cnt;
      if (!dx && !dy) c0 = c;
      if (c < bestC) { bestC = c; best = [dx, dy]; }
    }
    return c0 < Infinity && bestC < c0 * 0.85 ? best : [0, 0];
  }
  // One level of the fit (Gauss-Newton with robust weights). Only spots where the empty set has an
  // edge say anything about position; damping keeps directions with few edges (a plain wall, a
  // room of level lines) from wandering, and a fit that doesn't match better is dropped.
  function lkLevel(f, q, ok, w, h, p0, step, iters, tag) {
    const n = w * h, gx = buf('lkGX' + tag, n), gy = buf('lkGY' + tag, n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      gx[i] = x > 0 && x < w - 1 ? (q[i + 1] - q[i - 1]) * 0.5 : 0;
      gy[i] = y > 0 && y < h - 1 ? (q[i + w] - q[i - w]) * 0.5 : 0;
    }
    const cx = (w - 1) / 2, cy = (h - 1) / 2, Rn = Math.max(w, h) / 2;
    let m = 0;
    const list = buf('lkL' + tag, Math.ceil(w / step) * Math.ceil(h / step), Int32Array);
    for (let y = 2; y < h - 2; y += step) for (let x = 2; x < w - 2; x += step) {
      const i = y * w + x;
      if (ok[i] && gx[i] * gx[i] + gy[i] * gy[i] >= 1) list[m++] = i;
    }
    if (m < 40) return p0;
    const every = Math.max(1, Math.round(m / 6000)), J = buf('lkJ' + tag, m * 4), R = buf('lkR' + tag, m), ab = buf('lkAbs' + tag, m);
    const A = new Float64Array(16), B = new Float64Array(4);
    // Residuals and slopes at a fit; returns how many samples landed inside.
    const look = (p) => {
      let k = 0;
      for (let s = 0; s < m; s += every) {
        const i = list[s], x = i % w, y = (i - x) / w, X = x - cx, Y = y - cy;
        const u = cx + (1 + p.a) * X - p.b * Y + p.tx, v = cy + p.b * X + (1 + p.a) * Y + p.ty;
        if (u < 1 || v < 1 || u >= w - 2 || v >= h - 2) continue;
        const x0 = u | 0, y0 = v | 0, ax = u - x0, ay = v - y0, j = y0 * w + x0;
        if (!ok[j] || !ok[j + w + 1]) continue;
        const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
        const g0 = gx[j] * w00 + gx[j + 1] * w10 + gx[j + w] * w01 + gx[j + w + 1] * w11;
        const g1 = gy[j] * w00 + gy[j + 1] * w10 + gy[j + w] * w01 + gy[j + w + 1] * w11;
        const o4 = k * 4;
        J[o4] = g0; J[o4 + 1] = g1; J[o4 + 2] = (g0 * X + g1 * Y) / Rn; J[o4 + 3] = (g1 * X - g0 * Y) / Rn;
        R[k++] = f[i] - (q[j] * w00 + q[j + 1] * w10 + q[j + w] * w01 + q[j + w + 1] * w11);
      }
      return k;
    };
    const cost = (k, c2) => { let s = 0; for (let t = 0; t < k; t++) { const z = Math.min(1, R[t] * R[t] * c2); s += 1 - (1 - z) * (1 - z) * (1 - z); } return s / Math.max(1, k); };
    let p = { ...p0 }, c2 = 0, cost0 = 0;
    for (let it = 0; it < iters; it++) {
      const k = look(p);
      if (k < 40) return p0;
      if (!it) {
        // Tukey weights: residuals far beyond the typical one are toys or shadows.
        for (let t = 0; t < k; t++) ab[t] = Math.abs(R[t]);
        const c = Math.max(4.685 * 1.4826 * quickMedian(ab, k), 8);
        c2 = 1 / (c * c); cost0 = cost(k, c2);
      }
      A.fill(0); B.fill(0);
      for (let t = 0; t < k; t++) {
        const r = R[t], z = r * r * c2;
        if (z >= 1) continue;
        const wt = (1 - z) * (1 - z), o4 = t * 4, j0 = J[o4], j1 = J[o4 + 1], j2 = J[o4 + 2], j3 = J[o4 + 3];
        A[0] += wt * j0 * j0; A[1] += wt * j0 * j1; A[2] += wt * j0 * j2; A[3] += wt * j0 * j3;
        A[5] += wt * j1 * j1; A[6] += wt * j1 * j2; A[7] += wt * j1 * j3;
        A[10] += wt * j2 * j2; A[11] += wt * j2 * j3; A[15] += wt * j3 * j3;
        B[0] += wt * j0 * r; B[1] += wt * j1 * r; B[2] += wt * j2 * r; B[3] += wt * j3 * r;
      }
      A[4] = A[1]; A[8] = A[2]; A[9] = A[6]; A[12] = A[3]; A[13] = A[7]; A[14] = A[11];
      const lam = Math.max(0.001 * (A[0] + A[5] + A[10] + A[15]) / 4, 1500);
      for (let d = 0; d < 4; d++) A[d * 5] += lam;
      const d = solve4(A, B);
      if (!d) break;
      p = { tx: p.tx + d[0], ty: p.ty + d[1], a: p.a + d[2] / Rn, b: p.b + d[3] / Rn };
      if (Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) + Math.abs(d[3]) < 0.005) break;
    }
    const k = look(p);
    return k >= 40 && cost(k, c2) < cost0 * 0.975 ? p : p0;
  }
  function solve4(A, B) {
    const M = [0, 1, 2, 3].map((r) => [A[r * 4], A[r * 4 + 1], A[r * 4 + 2], A[r * 4 + 3], B[r]]);
    for (let c = 0; c < 4; c++) {
      let piv = c;
      for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = 0; r < 4; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let j = c; j < 5; j++) M[r][j] -= k * M[c][j]; }
    }
    return M.map((row, r) => row[4] / row[r]);
  }
  function quickMedian(a, n) {           // reorders a[0..n)
    let lo = 0, hi = n - 1, k = n >> 1;
    while (lo < hi) {
      const piv = a[(lo + hi) >> 1];
      let i = lo, j = hi;
      while (i <= j) { while (a[i] < piv) i++; while (a[j] > piv) j--; if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; } }
      if (k <= j) hi = j; else if (k >= i) lo = i; else break;
    }
    return a[k];
  }
  // Moves the empty set's planes (and where it is valid) by a fit, in place.
  function warpPlanes(p, planes, ok, w, h) {
    const n = w * h, cx = (w - 1) / 2, cy = (h - 1) / 2;
    const src = planes.map((pl, k) => { const c = buf('wp' + k, n); c.set(pl); return c; });
    const oks = buf('wpOk', n, Uint8Array); oks.set(ok);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, X = x - cx, Y = y - cy;
      const u = cx + (1 + p.a) * X - p.b * Y + p.tx, v = cy + p.b * X + (1 + p.a) * Y + p.ty;
      if (u < 0 || v < 0 || u > w - 1 || v > h - 1) { ok[i] = 0; continue; }
      const x0 = Math.min(w - 2, u | 0), y0 = Math.min(h - 2, v | 0), ax = u - x0, ay = v - y0, j = y0 * w + x0;
      ok[i] = oks[j] & oks[j + 1] & oks[j + w] & oks[j + w + 1];
      const w00 = (1 - ax) * (1 - ay), w10 = ax * (1 - ay), w01 = (1 - ax) * ay, w11 = ax * ay;
      for (let k = 0; k < planes.length; k++) { const s = src[k]; planes[k][i] = s[j] * w00 + s[j + 1] * w10 + s[j + w] * w01 + s[j + w + 1] * w11; }
    }
  }

  // F = photo, P = empty set (RGBA, same size; P's see-through edges are ignored).
  // cut 0..1: how eagerly things count as toys. o.fit: a starting guess for lining the two up
  // (the camera screen passes the last one). Returns alpha (how much each pixel is toy), shadow
  // (how much the toys darken the set there) and the fit.
  function keyMask(F, P, w, h, cut = 0.5, shadows = true, o = {}) {
    const n = w * h;
    cut = clamp(cut == null ? 0.5 : cut, 0, 1);
    const f0 = buf('f0', n), f1 = buf('f1', n), f2 = buf('f2', n), p0 = buf('p0', n), p1 = buf('p1', n), p2 = buf('p2', n);
    const ok = buf('ok', n, Uint8Array);
    for (let i = 0, q = 0; i < n; i++, q += 4) {
      f0[i] = F[q]; f1[i] = F[q + 1]; f2[i] = F[q + 2];
      p0[i] = P[q]; p1[i] = P[q + 1]; p2[i] = P[q + 2];
      ok[i] = P[q + 3] > 250 ? 1 : 0;
    }
    const tmp = buf('tmp', n), b0 = buf('b0', n), b1 = buf('b1', n), b2 = buf('b2', n), c0 = buf('c0', n), c1 = buf('c1', n), c2 = buf('c2', n);
    const L0 = buf('L0', 256), L1 = buf('L1', 256), L2 = buf('L2', 256), FY = buf('FY', n), QY = buf('QY', n);
    blur121(f0, w, h, b0, tmp); blur121(f1, w, h, b1, tmp); blur121(f2, w, h, b2, tmp);
    const prep = () => {
      blur121(p0, w, h, c0, tmp); blur121(p1, w, h, c1, tmp); blur121(p2, w, h, c2, tmp);
      toneLUT(b0, c0, ok, n, L0); toneLUT(b1, c1, ok, n, L1); toneLUT(b2, c2, ok, n, L2);
    };
    prep();
    // Line the empty set up with the photo (the iPad may have moved a hair since it was taken).
    for (let i = 0; i < n; i++) {
      FY[i] = 0.299 * b0[i] + 0.587 * b1[i] + 0.114 * b2[i];
      QY[i] = 0.299 * mapv(L0, c0[i]) + 0.587 * mapv(L1, c1[i]) + 0.114 * mapv(L2, c2[i]);
    }
    const fit = fineAlign(FY, QY, ok, w, h, o.fit || { tx: 0, ty: 0, a: 0, b: 0 }, !!o.fit);
    if (Math.abs(fit.tx) + Math.abs(fit.ty) > 0.02 || Math.abs(fit.a) + Math.abs(fit.b) > 2e-5) { warpPlanes(fit, [p0, p1, p2], ok, w, h); prep(); }
    // Only trust spots well inside the empty-set picture (its edges blur when it is moved).
    for (let pass = 0; pass < 2; pass++) {
      const t = buf('ok2', n, Uint8Array);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        t[i] = ok[i] && (x === 0 || ok[i - 1]) && (x === w - 1 || ok[i + 1]) && (y === 0 || ok[i - w]) && (y === h - 1 || ok[i + w]) ? 1 : 0;
      }
      ok.set(t);
    }

    // Per pixel: brightness ratio s (photo ≈ s × empty set), colour change cd (what a change of
    // brightness can't explain), luminance change dy, and how fast the empty set changes there (eg:
    // a leftover hair of misalignment shows up along its edges).
    const S = buf('S', n), CD = buf('CD', n), DY = buf('DY', n), QN = buf('QN', n), EG = buf('EG', n);
    const q0 = buf('q0', n), q1 = buf('q1', n), q2 = buf('q2', n);
    for (let i = 0; i < n; i++) { q0[i] = mapv(L0, c0[i]); q1[i] = mapv(L1, c1[i]); q2[i] = mapv(L2, c2[i]); }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!ok[i]) { S[i] = 1; CD[i] = 0; DY[i] = 0; QN[i] = 1; EG[i] = 0; continue; }
      const fr = b0[i], fg = b1[i], fb = b2[i], qr = q0[i], qg = q1[i], qb = q2[i];
      const qq = qr * qr + qg * qg + qb * qb + 1, s = (fr * qr + fg * qg + fb * qb) / qq;
      const er = fr - s * qr, eg = fg - s * qg, eb = fb - s * qb;
      S[i] = s; CD[i] = Math.sqrt(er * er + eg * eg + eb * eb); QN[i] = Math.sqrt(qq);
      DY[i] = 0.299 * (fr - qr) + 0.587 * (fg - qg) + 0.114 * (fb - qb);
      const l = x > 0 ? i - 1 : i, r = x < w - 1 ? i + 1 : i, u = y > 0 ? i - w : i, d = y < h - 1 ? i + w : i;
      EG[i] = Math.max(Math.abs(q0[r] - q0[l]) + Math.abs(q0[d] - q0[u]), Math.abs(q1[r] - q1[l]) + Math.abs(q1[d] - q1[u]), Math.abs(q2[r] - q2[l]) + Math.abs(q2[d] - q2[u])) * 0.5;
    }
    // The camera's noise, so the thresholds suit a dim room as well as a bright one.
    const dy = spread(DY, ok, n, -64, 64, 0.25), sY = clamp((dy.hi - dy.lo) / 1.349, 0.6, 8);
    const sC = clamp(spread(CD, ok, n, 0, 64, 0.25).mid, 0.6, 8);
    const kS = 7.5 - 3 * cut, kW = 3.6 - 1.2 * cut;
    const tYw = Math.max(kW * sY, 2.5), tCw = Math.max(kW * sC, 3), tCs = Math.max(kS * sC, 7), yS = Math.max(kS * sY, 6);

    // 0 = the set, 1 = only lighter or darker (a shadow? or a toy the set's colour), 2 = a little
    // different, 3 = clearly different.
    const cls = buf('cls', n, Uint8Array);
    for (let i = 0; i < n; i++) {
      if (!ok[i]) { cls[i] = 0; continue; }
      const s = S[i], cd = CD[i], d = DY[i], e = 0.4 * EG[i], allow = 0.12 * Math.abs(1 - s) * QN[i] + e;
      if (cd > tCs + allow || (s < 0.42 && d < -yS - e) || (s > 1.45 && d > yS + e)) cls[i] = 3;
      else if (cd > tCw + allow) cls[i] = 2;
      else if (d < -tYw - e || d > tYw + e) cls[i] = 1;
      else cls[i] = 0;
    }

    // Toys: blobs of different pixels with a clearly different pixel in them (or big enough).
    const obj = buf('obj', n, Uint8Array), lab = buf('lab', n, Int32Array), stack = buf('stack', n, Int32Array), list = buf('list', n, Int32Array);
    obj.fill(0); lab.fill(0);
    const minWeak = Math.max(12, Math.round(n * 0.0015));
    for (let s0 = 0; s0 < n; s0++) {
      if (cls[s0] < 2 || lab[s0]) continue;
      let sp = 0, cnt = 0, strong = false;
      stack[sp++] = s0; lab[s0] = 1;
      while (sp) {
        const i = stack[--sp], x = i % w;
        list[cnt++] = i;
        if (cls[i] === 3) strong = true;
        if (x > 0 && !lab[i - 1] && cls[i - 1] >= 2) { lab[i - 1] = 1; stack[sp++] = i - 1; }
        if (x < w - 1 && !lab[i + 1] && cls[i + 1] >= 2) { lab[i + 1] = 1; stack[sp++] = i + 1; }
        if (i >= w && !lab[i - w] && cls[i - w] >= 2) { lab[i - w] = 1; stack[sp++] = i - w; }
        if (i < n - w && !lab[i + w] && cls[i + w] >= 2) { lab[i + w] = 1; stack[sp++] = i + w; }
      }
      if (strong || cnt >= minWeak) for (let j = 0; j < cnt; j++) obj[list[j]] = 1;
    }

    // A toy's outline holds parts the colour of the set (a white shirt between a toy's head, hands
    // and legs): lighter or darker pixels inside the clear parts' closed outline are toy too.
    const dA = buf('dA', n, Uint16Array), rr = 3 * Math.max(3, Math.round(w / 20));
    distTo(obj, 1, w, h, dA);
    for (let i = 0; i < n; i++) tmp[i] = dA[i] <= rr ? 1 : 0;
    distTo(tmp, 0, w, h, dA);
    for (let i = 0; i < n; i++) if (cls[i] === 1 && dA[i] > rr) obj[i] = 1;

    // Other lighter or darker patches: a shadow or a change of light (soft edges, the set's pattern
    // still there, beside the toys) or a toy the set's colour (crisp edges, among toys, much darker,
    // hides the pattern).
    const shadow = new Uint8Array(n), alpha = new Uint8Array(n), rises = buf('zRises', n), hist = buf('zHist', 64, Uint32Array);
    const sub = buf('sub', n, Int32Array), list2 = buf('list2', n, Int32Array);
    sub.fill(0);
    const minZ = Math.max(4, Math.round(n * 0.00004)), sP = sY / Math.SQRT2;
    const cliff = (i, j) => Math.abs(S[i] - S[j]) > Math.max(0.03, (5 * sP) / Math.max(8, 0.299 * q0[i] + 0.587 * q1[i] + 0.114 * q2[i]));
    // One patch's verdict (pixels L[0..cnt); inP(j): is j in it).
    const judge = (L, cnt, inP) => {
      let sumS = 0, adjO = 0, adjB = 0, rise = 0, pairs = 0, crisp = 0;
      hist.fill(0);
      for (let t = 0; t < cnt; t++) {
        const i = L[t], x = i % w, ci = Math.abs(1 - S[i]);
        sumS += S[i]; hist[Math.min(63, (ci * 96) | 0)]++;
        for (let k = 0; k < 4; k++) {
          const dx = k === 0 ? -1 : k === 1 ? 1 : 0, dy = k === 2 ? -1 : k === 3 ? 1 : 0;
          if ((dx < 0 && x < 1) || (dx > 0 && x > w - 2)) continue;
          const j = i + dx + dy * w;
          if (j < 0 || j >= n || !ok[j]) continue;
          if (obj[j]) { adjO++; continue; }
          if (inP(j) || cls[j] !== 0) continue;
          // the jump in change across this edge: a toy's edge jumps most of the way at once, a
          // shadow's or a light's soft edge creeps up
          adjB++;
          const kk = (dx > 0 && x < 1) || (dx < 0 && x > w - 2) ? -1 : i - dx - dy * w;
          const cIn = Math.max(ci, kk >= 0 && kk < n && inP(kk) ? Math.abs(1 - S[kk]) : 0), r = cIn - Math.abs(1 - S[j]);
          rises[pairs++] = r; rise += r;
        }
      }
      let c80 = 0;
      for (let b = 0, acc = 0; b < 64; b++) { acc += hist[b]; if (acc >= cnt * 0.8) { c80 = (b + 0.5) / 96; break; } }
      const big = Math.max(0.02, c80);
      for (let t = 0; t < pairs; t++) if (rises[t] > 0.45 * big) crisp++;
      const meanS = sumS / cnt, sharp = pairs ? rise / pairs / big : 1, crispFrac = pairs ? crisp / pairs : 0, enc = adjO / Math.max(1, adjO + adjB);
      // A shadow touches its toy (often crisply, at the toy's foot) but fades softly everywhere
      // else; a toy part has a crisp outline all the way round.
      let score = (cut - 0.5) * 2.5;
      if (enc >= 0.7) score += 2.5;             // nearly surrounded by toy
      if (!adjO) score -= 1;                    // touches no toy: light, or a shadow from outside the picture
      if (pairs >= 12) score += clamp((crispFrac - 0.55) * 8, -3, 2.5) + clamp((sharp - 0.5) * 4, -1.5, 1.5);
      if (meanS < 0.5) score += 1.5;            // darker than shadows get
      if (cnt > n * 0.25) score -= 2;           // a change over much of the picture is the light
      return { isToy: score > 0, adjO };
    };
    const settle = (L, cnt, isToy) => {
      for (let t = 0; t < cnt; t++) {
        const i = L[t];
        if (isToy) obj[i] = 1;
        else if (shadows && S[i] < 1) shadow[i] = clamp(((1 - S[i]) / 0.85) * 255, 0, 190);
      }
    };
    let zid = 2;
    for (let s0 = 0; s0 < n; s0++) {
      if (cls[s0] !== 1 || lab[s0] || obj[s0]) continue;
      const id = zid++;
      let sp = 0, cnt = 0;
      stack[sp++] = s0; lab[s0] = id;
      while (sp) {
        const i = stack[--sp], x = i % w;
        list[cnt++] = i;
        if (x > 0 && cls[i - 1] === 1 && !lab[i - 1] && !obj[i - 1]) { lab[i - 1] = id; stack[sp++] = i - 1; }
        if (x < w - 1 && cls[i + 1] === 1 && !lab[i + 1] && !obj[i + 1]) { lab[i + 1] = id; stack[sp++] = i + 1; }
        if (i >= w && cls[i - w] === 1 && !lab[i - w] && !obj[i - w]) { lab[i - w] = id; stack[sp++] = i - w; }
        if (i < n - w && cls[i + w] === 1 && !lab[i + w] && !obj[i + w]) { lab[i + w] = id; stack[sp++] = i + w; }
      }
      if (cnt < minZ) continue;
      const v = judge(list, cnt, (j) => lab[j] === id);
      if (v.isToy || !v.adjO || cnt < 60) { settle(list, cnt, v.isToy); continue; }
      // A shadow-looking patch touching a toy may hold a toy part the set's colour (a grey head
      // next to its own shadow): split it where the brightness jumps and judge the pieces.
      for (let t = 0; t < cnt; t++) {
        const s1 = list[t];
        if (sub[s1]) continue;
        const sid = zid++;
        let sp2 = 0, c2 = 0;
        stack[sp2++] = s1; sub[s1] = sid;
        while (sp2) {
          const i = stack[--sp2], x = i % w;
          list2[c2++] = i;
          for (let k = 0; k < 4; k++) {
            const j = k === 0 ? (x > 0 ? i - 1 : -1) : k === 1 ? (x < w - 1 ? i + 1 : -1) : k === 2 ? i - w : i + w;
            if (j < 0 || j >= n || lab[j] !== id || sub[j] || cliff(i, j)) continue;
            sub[j] = sid; stack[sp2++] = j;
          }
        }
        settle(list2, c2, c2 >= Math.max(minZ, 12) && c2 < cnt ? judge(list2, c2, (j) => sub[j] === sid).isToy : false);
      }
    }

    // Tidy: drop specks, fill small holes.
    dropBlobs(obj, w, h, 1, Math.max(6, Math.round(n * 0.0003)), false);
    dropBlobs(obj, w, h, 0, Math.round(n * 0.0012), true);

    // The decisions were made on a smoothed picture, so the outline sits half a pixel out: pull
    // in edge pixels whose own (unsmoothed) colour is still the set's.
    for (let i = 0; i < n; i++) tmp[i] = obj[i];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!tmp[i] || ((x === 0 || tmp[i - 1]) && (x === w - 1 || tmp[i + 1]) && (y === 0 || tmp[i - w]) && (y === h - 1 || tmp[i + w]))) continue;
      const qr = mapv(L0, p0[i]), qg = mapv(L1, p1[i]), qb = mapv(L2, p2[i]);
      const dr = f0[i] - qr, dg = f1[i] - qg, db = f2[i] - qb, d = Math.sqrt(dr * dr + dg * dg + db * db);
      if (d < 2.5 * (tYw + 0.4 * EG[i])) obj[i] = 0;
    }
    // Soft, exact edges: a guided filter makes the cut follow the photo's own edges.
    for (let i = 0; i < n; i++) {
      const dr = f0[i] - mapv(L0, p0[i]), dg = f1[i] - mapv(L1, p1[i]), db = f2[i] - mapv(L2, p2[i]);
      tmp[i] = ok[i] ? Math.min(1, Math.sqrt(dr * dr + dg * dg + db * db) / 160) : 0;
    }
    guided1(tmp, obj, w, h, Math.max(1, Math.round(w / 240)), 0.0012, alpha);
    for (let i = 0; i < n; i++) if (!ok[i]) alpha[i] = 0;
    blur121U8(shadow, w, h);
    return { alpha, shadow, fit };
  }
  // Chamfer distance (in thirds of a pixel) to the nearest pixel where src equals val.
  function distTo(src, val, w, h, d) {
    const n = w * h, INF = 65535;
    for (let i = 0; i < n; i++) d[i] = src[i] === val ? 0 : INF;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0 && d[i - 1] + 3 < v) v = d[i - 1] + 3;
      if (y > 0) {
        if (d[i - w] + 3 < v) v = d[i - w] + 3;
        if (x > 0 && d[i - w - 1] + 4 < v) v = d[i - w - 1] + 4;
        if (x < w - 1 && d[i - w + 1] + 4 < v) v = d[i - w + 1] + 4;
      }
      d[i] = v;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1 && d[i + 1] + 3 < v) v = d[i + 1] + 3;
      if (y < h - 1) {
        if (d[i + w] + 3 < v) v = d[i + w] + 3;
        if (x < w - 1 && d[i + w + 1] + 4 < v) v = d[i + w + 1] + 4;
        if (x > 0 && d[i + w - 1] + 4 < v) v = d[i + w - 1] + 4;
      }
      d[i] = v;
    }
  }
  function blur121U8(a, w, h) {
    const n = w * h, s = buf('bu8s', n), o = buf('bu8o', n), t = buf('bu8t', n);
    for (let i = 0; i < n; i++) s[i] = a[i];
    blur121(s, w, h, o, t);
    for (let i = 0; i < n; i++) a[i] = o[i] + 0.5;
  }
  // Guided filter on one guide channel (He et al.): alpha that is locally a linear function of it.
  function guided1(I, m, w, h, r, eps, out) {
    const n = w * h, t = buf('g1T', n), x = buf('g1X', n), p = buf('g1P', n);
    const mI = buf('g1mI', n), mp = buf('g1mp', n), mII = buf('g1mII', n), mIp = buf('g1mIp', n), A = buf('g1A', n), B = buf('g1B', n);
    for (let i = 0; i < n; i++) p[i] = m[i];
    boxMean(I, w, h, r, mI, t); boxMean(p, w, h, r, mp, t);
    for (let i = 0; i < n; i++) x[i] = I[i] * I[i];
    boxMean(x, w, h, r, mII, t);
    for (let i = 0; i < n; i++) x[i] = I[i] * p[i];
    boxMean(x, w, h, r, mIp, t);
    for (let i = 0; i < n; i++) {
      const v = mII[i] - mI[i] * mI[i], c = mIp[i] - mI[i] * mp[i], a = c / (v + eps);
      A[i] = a; B[i] = mp[i] - a * mI[i];
    }
    boxMean(A, w, h, r, mII, t); boxMean(B, w, h, r, mIp, t);
    for (let i = 0; i < n; i++) out[i] = clamp((mII[i] * I[i] + mIp[i]) * 255 + 0.5, 0, 255);
  }
  // Puts a mask into a canvas: white (or black for shadows) with that alpha.
  function maskCanvas(c, a, w, h, white) {
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const x = c.getContext('2d'), img = x.createImageData(w, h), d = img.data, v = white ? 255 : 0;
    for (let i = 0, q = 0; i < a.length; i++, q += 4) { d[q] = d[q + 1] = d[q + 2] = v; d[q + 3] = a[i]; }
    x.putImageData(img, 0, 0);
    return c;
  }

  // ---------- one movie's effect data: lined-up photos, eraser masks, empty set ----------
  class Lib {
    constructor(m, frames) {
      this.m = m; this.recs = new Map(); this.plate = null; this.plateV = 0; this.v = 1;
      this.bmp = new Map(); this.masks = new Map(); this.keys = new Map(); this.gainsCache = null;
      this.setFrames(frames);
    }
    get ed() { return this.m.edit; }
    setFrames(frames) { this.frames = frames; this.idx = new Map(frames.map((f, i) => [f.id, i])); this.gainsCache = null; }
    get refId() { return this.frames[0] ? this.frames[0].id : null; }
    aux(fid) { return `${this.m.id}/fx/${fid}`; }
    async load() {
      const recs = this.frames.length ? await DB.getMany('aux', this.frames.map((f) => this.aux(f.id))) : [];
      recs.forEach((r, i) => { if (r) this.recs.set(this.frames[i].id, r); });
      this.plate = (await DB.get('aux', `${this.m.id}/plate`)) || null;
      this.bgRec = (await DB.get('aux', `${this.m.id}/bgphoto`)) || null;
      this.plateImgP = null; this.bgImgP = null;
    }
    rec(fid) { let r = this.recs.get(fid); if (!r) { r = { id: this.aux(fid) }; this.recs.set(fid, r); } return r; }
    bitmap(fid) {
      let p = this.bmp.get(fid);
      if (p) { this.bmp.delete(fid); this.bmp.set(fid, p); return p; }
      const f = this.frames[this.idx.get(fid)];
      p = f ? getFull(f).then((b) => (b ? decodeImage(b) : null)).catch(() => null) : Promise.resolve(null);
      this.bmp.set(fid, p);
      while (this.bmp.size > 8) {
        const [k0, p0] = this.bmp.entries().next().value;
        this.bmp.delete(k0);
        setTimeout(() => p0.then((b) => b && b.close && b.close()), 4000); // late, in case a frame is still drawing it
      }
      return p;
    }
    plateImg() { if (!this.plate) return Promise.resolve(null); if (!this.plateImgP) this.plateImgP = decodeImage(this.plate.full).catch(() => null); return this.plateImgP; }
    bgPhoto() { if (!this.bgRec) return Promise.resolve(null); if (!this.bgImgP) this.bgImgP = decodeImage(this.bgRec.blob).catch(() => null); return this.bgImgP; }
    validAlign(fid) { const r = this.recs.get(fid); return !!(r && r.align && r.align.ref === this.refId); }
    alignOf(fid) { const r = this.recs.get(fid); return r && r.align && r.align.ref === this.refId ? r.align : ID; }
    plateSim() { const p = this.plate; return p && p.align && (p.made || p.align.ref === this.refId) ? p.align : ID; }
    needsAnalysis() { return this.frames.some((f) => !this.validAlign(f.id)) || (!!this.plate && !this.plate.made && !(this.plate.align && this.plate.align.ref === this.refId)); }

    // Lines every photo up with the first one and measures its light. Only new photos are worked on.
    analyze(onProgress = () => {}) {
      if (this.busy) return this.busy;
      this.busy = (async () => {
        const fr = this.frames, n = fr.length, ref = this.refId;
        if (!n) return;
        const todo = [];
        fr.forEach((f, i) => { if (!this.validAlign(f.id)) todo.push(i); });
        const plateTodo = !!this.plate && !this.plate.made && !(this.plate.align && this.plate.align.ref === ref);
        if (!todo.length && !plateTodo) return;
        const W0 = this.m.w, H0 = this.m.h, s = W0 / AW, total = todo.length + (plateTodo ? 1 : 0);
        const small = (f) => analyze(f.small, f.sw, f.sh);
        const feat = async (i) => { const b = await this.bitmap(fr[i].id); return b ? grabFeat(b, W0, H0) : null; };
        const refF = await feat(0), refS = small(fr[0]);
        if (!refF) return;
        const solve = (RF, RS, CF, CS) => { const e = estimateShift(RS, CS), g = AW / RS.w; return alignPair(RF, CF, e.dx * g, e.dy * g); };
        const sane = (q) => Math.abs(q.tx) < AW * 0.14 && Math.abs(q.ty) < refF.h * 0.14 && Math.abs(Math.hypot(q.a, q.b) - 1) < 0.06 && Math.abs(Math.atan2(q.b, q.a)) < 0.07;
        const lineUp = async (CF, CS, prevIdx) => {
          let best = null;
          const r1 = solve(refF, refS, CF, CS);
          if (r1 && r1.inl >= 5 && sane(r1)) best = r1;
          if ((!best || best.inl < 8) && prevIdx > 0) { // try the photo before, then chain
            const pF = prev && prev.i === prevIdx ? prev.F : await feat(prevIdx);
            if (pF) {
              const r2 = solve(pF, small(fr[prevIdx]), CF, CS);
              if (r2 && r2.inl >= 5 && (!best || r2.inl > best.inl)) {
                const chained = mulSim(scaleSim(this.alignOf(fr[prevIdx].id), 1 / s), r2);
                if (sane(chained)) best = Object.assign(chained, { inl: r2.inl });
              }
            }
          }
          return best;
        };
        let prev = { i: 0, F: refF }, done = 0;
        for (const i of todo) {
          let sim = ID, q = 0, light = [1, 1, 1];
          const F = i === 0 ? refF : await feat(i);
          if (F && i > 0) {
            const best = await lineUp(F, small(fr[i]), i - 1);
            if (best) { sim = best; q = best.inl; }
            light = lightRatio(refF, F, sim);
          }
          const rec = this.rec(fr[i].id);
          rec.align = { a: sim.a, b: sim.b, tx: sim.tx * s, ty: sim.ty * s, q, ref };
          rec.light = light;
          await DB.put('aux', rec);
          if (F) prev = { i, F };
          onProgress(++done / total);
          await yieldUI();
        }
        if (plateTodo) {
          const img = await this.plateImg();
          if (img) {
            const F = grabFeat(img, W0, H0), best = await lineUp(F, analyze(this.plate.small, this.plate.sw, this.plate.sh), 0);
            const sim = best || ID;
            this.plate.align = { a: sim.a, b: sim.b, tx: sim.tx * s, ty: sim.ty * s, q: best ? best.inl : 0, ref };
            await DB.put('aux', this.plate);
          }
          onProgress(1);
        }
        this.gainsCache = null; this.keys.clear(); this.v++;
      })().finally(() => { this.busy = null; });
      return this.busy;
    }

    // Per-photo color gains that remove flicker but keep slow changes.
    gains(k) {
      if (!this.gainsCache) {
        const L = this.frames.map((f) => { const r = this.recs.get(f.id); return r && r.light && this.validAlign(f.id) ? r.light : [1, 1, 1]; });
        const n = L.length, out = L.map(() => [1, 1, 1]);
        for (let c = 0; c < 3; c++) {
          const v = L.map((l) => Math.log(l[c] || 1));
          const med = v.map((_, i) => { const w = v.slice(Math.max(0, i - 3), i + 4).sort((a, b) => a - b); return w[w.length >> 1]; });
          for (let i = 0; i < n; i++) {
            let s = 0, m = 0;
            for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) { s += med[j]; m++; }
            out[i][c] = clamp(Math.exp(s / m - v[i]), 0.6, 1.6);
          }
        }
        this.gainsCache = out;
      }
      return this.gainsCache[k] || [1, 1, 1];
    }

    // ----- magic eraser masks (white = rubbed out), stored per photo -----
    maskSize() { return [EW, Math.max(2, Math.round((EW * this.m.h) / this.m.w))]; }
    hasMask(fid) { const r = this.recs.get(fid); return !!(r && r.mask); }
    async mask(fid) {
      if (this.masks.has(fid)) return this.masks.get(fid);
      const r = this.recs.get(fid);
      let c = null;
      if (r && r.mask) {
        try {
          const b = await decodeImage(r.mask), [w, h] = this.maskSize();
          c = mk(w, h); c.getContext('2d').drawImage(b, 0, 0, w, h);
          if (b.close) b.close();
        } catch (e) { c = null; }
      }
      this.masks.set(fid, c);
      return c;
    }
    async editMask(fid) {
      let c = await this.mask(fid);
      if (!c) { const [w, h] = this.maskSize(); c = mk(w, h); this.masks.set(fid, c); }
      return c;
    }
    async saveMask(fid) {
      const c = this.masks.get(fid), r = this.rec(fid);
      let empty = true;
      if (c) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 16) if (d[i] > 8) { empty = false; break; } }
      if (empty) { r.mask = null; this.masks.set(fid, null); }
      else r.mask = await toBlob(c, 'image/png');
      r.maskV = (r.maskV || 0) + 1;
      await DB.put('aux', r);
    }
    async copyMask(fromId, toId) {
      const src = await this.mask(fromId);
      if (!src) return;
      const dst = await this.editMask(toId), x = dst.getContext('2d');
      x.globalCompositeOperation = 'source-over'; x.drawImage(src, 0, 0);
      await this.saveMask(toId);
    }
    async clearMask(fid) { this.masks.set(fid, null); const r = this.rec(fid); r.mask = null; r.maskV = (r.maskV || 0) + 1; await DB.put('aux', r); }
    // Where rubbed-out spots are filled from: the empty set, the first photo, or the photo before.
    async fillFor(k) {
      const fr = this.frames, free = (j) => j >= 0 && j < fr.length && j !== k && !this.hasMask(fr[j].id);
      const of = async (j) => ({ img: await this.bitmap(fr[j].id), sim: this.alignOf(fr[j].id) });
      if (this.ed.fillFrom === 'before') for (let j = k - 1; j >= 0; j--) if (free(j)) return of(j);
      if (this.plate) { const img = await this.plateImg(); if (img) return { img, sim: this.plateSim() }; }
      if (free(0)) return of(0);
      for (let j = 1; j < fr.length; j++) if (free(j)) return of(j);
      return null;
    }
    // What shows at the edges when a photo is slid back into place.
    async underlay() {
      if (this.plate) { const img = await this.plateImg(); if (img) return { img, sim: this.plateSim() }; }
      return this.frames.length ? { img: await this.bitmap(this.frames[0].id), sim: this.alignOf(this.frames[0].id) } : null;
    }
    // Draws photo k through transform T (photo pixels → target), with the magic eraser applied.
    paintClean(x, T, res, tmp) {
      const W0 = this.m.w, H0 = this.m.h;
      M.set(x, T); x.drawImage(res.img, 0, 0, W0, H0);
      if (!res.mask || !res.src || !res.src.img) return;
      const c = x.canvas, E = scratch(tmp, c.width, c.height), ex = E.getContext('2d');
      ex.setTransform(1, 0, 0, 1, 0, 0); ex.globalAlpha = 1; ex.globalCompositeOperation = 'source-over'; ex.clearRect(0, 0, E.width, E.height);
      ex.imageSmoothingQuality = 'high';
      M.set(ex, M.mul(T, M.mul(M.inv(M.sim(this.alignOf(res.f.id))), M.sim(res.src.sim))));
      ex.drawImage(res.src.img, 0, 0, W0, H0);
      ex.globalCompositeOperation = 'destination-in';
      M.set(ex, M.mul(T, M.scale(W0 / res.mask.width, H0 / res.mask.height)));
      ex.drawImage(res.mask, 0, 0);
      ex.globalCompositeOperation = 'source-over'; ex.setTransform(1, 0, 0, 1, 0, 0);
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.drawImage(E, 0, 0); x.restore();
    }

    // ----- magic background cut-outs -----
    async keyFor(k, kw) {
      const f = this.frames[k], ed = this.ed;
      if (!f || !this.plate) return null;
      const r = this.recs.get(f.id) || {};
      const id = `${f.id}|${kw}|${ed.scene.cut}|${ed.scene.shadows !== false}|${r.maskV || 0}|${this.plateV}|${this.v}`;
      if (this.keys.has(id)) { const v = this.keys.get(id); this.keys.delete(id); this.keys.set(id, v); return v; }
      const [img, mask, plate] = await Promise.all([this.bitmap(f.id), this.mask(f.id), this.plateImg()]);
      if (!img || !plate) return null;
      const src = mask ? await this.fillFor(k) : null;
      // From here on nothing waits, so the scratch canvases are safe to share.
      const W0 = this.m.w, H0 = this.m.h, kh = Math.round((kw * H0) / W0), S = M.scale(kw / W0, kh / H0);
      // Both shrink with the same smoothing, so fine detail (wood grain, edges) matches.
      const A = scratch('kA', kw, kh), ax = ctxR(A);
      ax.setTransform(1, 0, 0, 1, 0, 0); ax.globalCompositeOperation = 'source-over'; ax.globalAlpha = 1; ax.clearRect(0, 0, kw, kh);
      ax.imageSmoothingEnabled = true; ax.imageSmoothingQuality = 'high';
      this.paintClean(ax, S, { f, img, mask, src }, 'kE');
      const Fd = ax.getImageData(0, 0, kw, kh).data;
      const B = scratch('kB', kw, kh), bx = ctxR(B);
      bx.setTransform(1, 0, 0, 1, 0, 0); bx.clearRect(0, 0, kw, kh);
      bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = 'high';
      M.set(bx, M.mul(S, M.mul(M.inv(M.sim(this.alignOf(f.id))), M.sim(this.plateSim()))));
      bx.drawImage(plate, 0, 0, W0, H0);
      const Pd = bx.getImageData(0, 0, kw, kh).data;
      const res = keyMask(Fd, Pd, kw, kh, ed.scene.cut, ed.scene.shadows !== false);
      const out = { w: kw, h: kh, alpha: maskCanvas(mk(kw, kh), res.alpha, kw, kh, true), shadow: maskCanvas(mk(kw, kh), res.shadow, kw, kh, false) };
      this.keys.set(id, out);
      while (this.keys.size > 24) this.keys.delete(this.keys.keys().next().value);
      return out;
    }
    dropKeys() { this.keys.clear(); }
    async setPlate(rec) {
      this.plate = rec; this.plateImgP = null; this.plateV++; this.keys.clear();
      if (rec) await DB.put('aux', rec); else await DB.run('aux', 'readwrite', (tx) => { tx.objectStore('aux').delete(`${this.m.id}/plate`); });
    }
    async setBgPhoto(blob) {
      this.bgRec = { id: `${this.m.id}/bgphoto`, blob }; this.bgImgP = null;
      await DB.put('aux', this.bgRec);
    }
    // Builds an empty-set picture from the photos: each spot takes its middle value, so toys that move vanish.
    async makePlate(onProgress = () => {}) {
      await this.analyze((p) => onProgress(p * 0.4));
      const fr = this.frames, n = fr.length;
      if (n < 3) throw new Error('Take a few more photos first');
      const W0 = this.m.w, H0 = this.m.h, PW = Math.min(1280, W0), PH = Math.round((PW * H0) / W0);
      const want = Math.min(11, n), pick = [];
      for (let i = 0; i < want; i++) pick.push(Math.round((i * (n - 1)) / Math.max(1, want - 1)));
      const c = mk(PW, PH), x = ctxR(c), stack = [];
      for (const j of pick) {
        const img = await this.bitmap(fr[j].id);
        if (!img) continue;
        x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, PW, PH);
        M.set(x, M.mul(M.scale(PW / W0, PH / H0), M.sim(this.alignOf(fr[j].id)))); x.drawImage(img, 0, 0, W0, H0);
        stack.push(x.getImageData(0, 0, PW, PH).data);
        onProgress(0.4 + (0.3 * stack.length) / want);
        await yieldUI();
      }
      const K = stack.length, out = x.createImageData(PW, PH), o = out.data, buf = new Uint8Array(K);
      for (let y = 0; y < PH; y++) {
        for (let p = y * PW * 4, end = p + PW * 4; p < end; p += 4) {
          for (let ch = 0; ch < 3; ch++) {
            let m = 0;
            for (let s = 0; s < K; s++) if (stack[s][p + 3] > 128) {
              const v = stack[s][p + ch]; let j = m - 1;
              while (j >= 0 && buf[j] > v) { buf[j + 1] = buf[j]; j--; }
              buf[j + 1] = v; m++;
            }
            o[p + ch] = m ? buf[m >> 1] : 0;
          }
          o[p + 3] = 255;
        }
        if (y % 40 === 0) { onProgress(0.7 + (0.28 * y) / PH); await yieldUI(); }
      }
      x.setTransform(1, 0, 0, 1, 0, 0); x.putImageData(out, 0, 0);
      const full = await toBlob(c, 'image/jpeg', 0.92), sh = Math.round((SMALL_W * PH) / PW);
      await this.setPlate({ id: `${this.m.id}/plate`, full, small: Vision.grab(c, SMALL_W, sh), sw: SMALL_W, sh, w: PW, h: PH, made: true, align: { ...ID, q: 0, ref: this.refId }, t: Date.now() });
      onProgress(1);
    }

    // ----- "find surprises": things poking in from the edge that are not in the empty scene -----
    async findSurprises(onProgress = () => {}) {
      await this.analyze((p) => onProgress(p * 0.6));
      const fr = this.frames, n = fr.length;
      if (n < 2) return [];
      const sw = fr[0].sw, sh = fr[0].sh, W0 = this.m.w, H0 = this.m.h, s = sw / W0, N = sw * sh;
      // A photo's tiny copy, moved into the first photo's position.
      const warp = (small, sim) => {
        const inv = invSim(scaleSim(sim, s)), out = new Float32Array(N), ok = new Uint8Array(N);
        for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
          const [u, v] = applySim(inv, x, y);
          if (u < 0 || v < 0 || u > sw - 1.001 || v > sh - 1.001) continue;
          const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, i0 = y0 * sw + x0;
          out[y * sw + x] = (small[i0] * (1 - fx) + small[i0 + 1] * fx) * (1 - fy) + (small[i0 + sw] * (1 - fx) + small[i0 + sw + 1] * fx) * fy;
          ok[y * sw + x] = 1;
        }
        return { px: out, ok };
      };
      let bg;
      if (this.plate) bg = warp(this.plate.small, this.plate.made ? ID : this.plateSim());
      else {
        const want = Math.min(25, n), pick = [];
        for (let i = 0; i < want; i++) pick.push(Math.round((i * (n - 1)) / Math.max(1, want - 1)));
        const ws = pick.map((j) => warp(fr[j].small, this.alignOf(fr[j].id))), px = new Float32Array(N), ok = new Uint8Array(N), buf = [];
        for (let i = 0; i < N; i++) {
          buf.length = 0;
          for (const w of ws) if (w.ok[i]) buf.push(w.px[i]);
          if (buf.length) { buf.sort((a, b) => a - b); px[i] = buf[buf.length >> 1]; ok[i] = 1; }
        }
        bg = { px, ok };
      }
      const found = [];
      for (let k = 0; k < n; k++) {
        const f = fr[k], A = this.alignOf(f.id), cur = warp(f.small, A);
        const ratios = [];
        for (let i = 0; i < N; i += 7) if (cur.ok[i] && bg.ok[i] && bg.px[i] > 12) ratios.push(cur.px[i] / bg.px[i]);
        ratios.sort((a, b) => a - b);
        const g = ratios.length ? ratios[ratios.length >> 1] : 1;
        const d = new Uint8Array(N);
        for (let i = 0; i < N; i++) d[i] = cur.ok[i] && bg.ok[i] ? clamp(Math.abs(cur.px[i] - bg.px[i] * g) * 3, 0, 255) : 0;
        box1(d, sw, sh);
        const bin = new Uint8Array(N);
        for (let i = 0; i < N; i++) bin[i] = d[i] > 72 ? 1 : 0;
        const blobs = dropBlobs(bin, sw, sh, 1, 0, false, true, Math.round(sw * 0.03)).filter((b) => b.length > N * 0.01 && b.length < N * 0.45);
        if (blobs.length) {
          const refMask = new Uint8Array(N), mg = Math.round(sw * 0.03);
          blobs.forEach((b) => {
            b.forEach((i) => { refMask[i] = 1; });
            // A leg or arm comes in from the edge: fill the gap between the blob and that edge too.
            const lo = new Int32Array(sw).fill(sh), hi = new Int32Array(sw).fill(-1), le = new Int32Array(sh).fill(sw), ri = new Int32Array(sh).fill(-1);
            b.forEach((i) => { const x = i % sw, y = (i - x) / sw; lo[x] = Math.min(lo[x], y); hi[x] = Math.max(hi[x], y); le[y] = Math.min(le[y], x); ri[y] = Math.max(ri[y], x); });
            const maxY = Math.max(...hi), minY = Math.min(...lo), maxX = Math.max(...ri), minX = Math.min(...le);
            for (let x = 0; x < sw; x++) if (hi[x] >= 0) {
              if (maxY >= sh - 1 - mg) for (let y = hi[x]; y < sh; y++) refMask[y * sw + x] = 1;
              if (minY <= mg) for (let y = 0; y <= lo[x]; y++) refMask[y * sw + x] = 1;
            }
            for (let y = 0; y < sh; y++) if (ri[y] >= 0) {
              if (maxX >= sw - 1 - mg) for (let x = ri[y]; x < sw; x++) refMask[y * sw + x] = 1;
              if (minX <= mg) for (let x = 0; x <= le[y]; x++) refMask[y * sw + x] = 1;
            }
          });
          found.push({ k, id: f.id, mask: this.maskFromRef(refMask, sw, sh, A) });
        }
        if (k % 8 === 0) { onProgress(0.6 + (0.4 * k) / n); await yieldUI(); }
      }
      onProgress(1);
      return found;
    }
    // Turns a mask in the first photo's position (tiny-copy size) into an eraser mask for one photo.
    maskFromRef(refMask, sw, sh, A) {
      const [w, h] = this.maskSize(), W0 = this.m.w, s = sw / W0, k = W0 / w, a = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const [u, v] = applySim(A, x * k, y * k), ui = Math.round(u * s), vi = Math.round(v * s);
        if (ui >= 0 && vi >= 0 && ui < sw && vi < sh && refMask[vi * sw + ui]) a[y * w + x] = 255;
      }
      for (let r = 0; r < 3; r++) { box1(a, w, h); for (let i = 0; i < a.length; i++) a[i] = a[i] > 20 ? 255 : 0; } // grow a little
      box1(a, w, h);
      return maskCanvas(mk(w, h), a, w, h, true);
    }
    async addToMask(fid, extra) {
      const c = await this.editMask(fid), x = c.getContext('2d');
      x.globalCompositeOperation = 'source-over'; x.drawImage(extra, 0, 0, c.width, c.height);
      await this.saveMask(fid);
    }

    // Everything one frame needs, fetched before any drawing starts.
    async shotRes(k, kw) {
      const f = this.frames[k];
      if (!f) return null;
      const ed = this.ed, wantKey = ed.scene.bg !== 'none' && !!this.plate;
      const [img, mask] = await Promise.all([this.bitmap(f.id), this.mask(f.id)]);
      const src = mask ? await this.fillFor(k) : null;
      const under = ed.steady ? await this.underlay() : null;
      const key = wantKey ? await this.keyFor(k, kw) : null;
      const bg = ed.scene.bg === 'photo' ? await this.bgPhoto() : null;
      return { f, img, mask, src, under, key, bg };
    }
  }

  // Brightens or darkens each color channel of a canvas (GPU blend modes, no pixel loop).
  function gainsOn(c, x, g) {
    const W = c.width, H = c.height, hi = g.map((v) => clamp(v - 1, 0, 1)), lo = g.map((v) => Math.min(1, v));
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1;
    if (hi.some((v) => v > 0.004)) {
      const T = scratch('gain', W, H), t = T.getContext('2d');
      t.setTransform(1, 0, 0, 1, 0, 0); t.globalAlpha = 1; t.globalCompositeOperation = 'source-over'; t.drawImage(c, 0, 0);
      t.globalCompositeOperation = 'multiply'; t.fillStyle = `rgb(${hi.map((v) => Math.round(v * 255)).join(',')})`; t.fillRect(0, 0, W, H);
      t.globalCompositeOperation = 'source-over';
      x.globalCompositeOperation = 'lighter'; x.drawImage(T, 0, 0);
    }
    if (lo.some((v) => v < 0.996)) { x.globalCompositeOperation = 'multiply'; x.fillStyle = `rgb(${lo.map((v) => Math.round(v * 255)).join(',')})`; x.fillRect(0, 0, W, H); }
    x.globalCompositeOperation = 'source-over';
  }
  function stickersAt(lib, k) {
    return lib.ed.stickers.filter((s) => {
      const i = lib.idx.get(s.at);
      return i != null && k >= i && (!s.len || k < i + s.len);
    });
  }

  // ---------- one finished frame of the movie ----------
  // o.full: show the whole photo (for choosing the frame); o.raw: the photo only, no effects.
  async function drawShot(x, W, H, lib, k, o = {}) {
    const res = await lib.shotRes(k, o.keyRes || 480);
    paintShot(x, W, H, lib, k, res, o);
  }
  // One photo's layers in output pixels: the photo itself (lined up, rubbed out, light evened) and,
  // with a magic background, its cut-out toys (fg) and their shadow (sh). Scratch canvases unless `own`.
  function layersOf(lib, k, r, O, W, H, raw, own) {
    const m = lib.m, ed = m.edit, W0 = m.w, H0 = m.h, get = (n) => (own ? mk(W, H) : scratch(n, W, H));
    const A = lib.alignOf(r.f.id), T = M.mul(O, ed.steady ? M.sim(A) : M.id());
    const L = get('L'), lx = L.getContext('2d');
    Art.reset(lx); lx.fillStyle = '#000'; lx.fillRect(0, 0, W, H); lx.imageSmoothingQuality = 'high';
    if (ed.steady && r.under && r.under.img) { M.set(lx, M.mul(O, M.sim(r.under.sim))); lx.drawImage(r.under.img, 0, 0, W0, H0); }
    lib.paintClean(lx, T, r, 'E');
    if (ed.even) gainsOn(L, lx, lib.gains(k));
    Art.reset(lx);
    if (!r.key || raw) return { L, fg: L, sh: null, keyed: false };
    const KT = M.mul(T, M.scale(W0 / r.key.w, H0 / r.key.h));
    const F = get('F'), fx = F.getContext('2d');
    Art.reset(fx); fx.clearRect(0, 0, W, H); fx.drawImage(L, 0, 0);
    fx.globalCompositeOperation = 'destination-in'; fx.imageSmoothingQuality = 'high'; M.set(fx, KT); fx.drawImage(r.key.alpha, 0, 0);
    Art.reset(fx);
    let sh = null;
    if (ed.scene.shadows !== false) {
      sh = get('S');
      const sx = sh.getContext('2d');
      Art.reset(sx); sx.clearRect(0, 0, W, H); sx.imageSmoothingQuality = 'high';
      M.set(sx, KT); sx.globalAlpha = 0.85; sx.drawImage(r.key.shadow, 0, 0); Art.reset(sx);
    }
    return { L, fg: F, sh, keyed: true };
  }
  // Puts a frame together: background, shadow, toys, then effects, look, lights and stickers.
  // kf may fall between photos (in-between pictures); looks, lights and stickers follow photo sk.
  function finishFrame(x, W, H, lib, kf, ly, bg, o, sk) {
    const ed = lib.m.edit, k = Math.floor(kf);
    Art.reset(x);
    if (ly.keyed) {
      Art.drawBg(x, W, H, ed.scene.bg, kf, bg);
      if (ly.sh) x.drawImage(ly.sh, 0, 0);
      x.drawImage(ly.fg, 0, 0);
    } else x.drawImage(ly.L, 0, 0);
    if (o.raw) return;
    if (ed.scene.fg && ed.scene.fg !== 'none') Art.drawEffect(x, W, H, ed.scene.fg, kf);
    if (ed.look && ed.look !== 'none') Art.applyLook(x, W, H, ed.look, ed.lookAmt == null ? 0.85 : ed.lookAmt, k);
    if (ed.light && ed.light !== 'none') Art.drawLight(x, W, H, ed.light, k, ed.spot);
    Art.reset(x);
    if (!o.noStickers) for (const s of stickersAt(lib, sk == null ? k : sk)) Art.drawSticker(x, W, H, s);
  }
  function paintShot(x, W, H, lib, k, r, o = {}) {
    Art.reset(x);
    if (!r || !r.img) { x.fillStyle = '#000'; x.fillRect(0, 0, W, H); return; }
    const O = outMatrix(frameGeom(lib.m, o.full), W, H);
    finishFrame(x, W, H, lib, k, layersOf(lib, k, r, O, W, H, o.raw), r.bg, o, k);
  }

  // ---------- smooth moves: in-between pictures that follow the motion ----------
  // Motion is followed on small grey copies, coarse to fine; things that didn't move stay put.
  const FLOW_W = 320, G = 4;
  function grayOf(c, w, h) {
    const g = scratch('flowGray', w, h), x = ctxR(g);
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data, out = new Float32Array(w * h);
    for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
    return out;
  }
  function half(L) {
    const w = L.w >> 1, h = L.h >> 1, o = new Float32Array(w * h), d = L.d, W = L.w;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = 2 * y * W + 2 * x; o[y * w + x] = (d[i] + d[i + 1] + d[i + W] + d[i + W + 1]) * 0.25; }
    return { d: o, w, h };
  }
  // Mean difference between a box of A and the same box of B moved by (dx, dy).
  function boxCost(A, B, x0, y0, x1, y1, dx, dy) {
    const w = A.w, h = A.h, a = A.d, b = B.d;
    const xa = Math.max(x0, 0, -dx), xb = Math.min(x1, w, w - dx), ya = Math.max(y0, 0, -dy), yb = Math.min(y1, h, h - dy);
    if ((xb - xa) * 2 < x1 - x0 || (yb - ya) * 2 < y1 - y0) return Infinity;
    let s = 0;
    for (let y = ya; y < yb; y++) {
      const ra = y * w, rb = (y + dy) * w + dx;
      for (let x = xa; x < xb; x++) { const e = a[ra + x] - b[rb + x]; s += e < 0 ? -e : e; }
    }
    return s / ((xb - xa) * (yb - ya));
  }
  function median9(v, gw, gh) {
    const o = new Float32Array(v.length), buf = [];
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      buf.length = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const jj = Math.min(gh - 1, Math.max(0, j + dj)), ii = Math.min(gw - 1, Math.max(0, i + di));
        buf.push(v[jj * gw + ii]);
      }
      buf.sort((p, q) => p - q);
      o[j * gw + i] = buf[4];
    }
    return o;
  }
  // How things moved from photo layer A to photo layer B: motion every G pixels of a small grey copy
  // (coarse to fine, standing still wins ties), and a mask of the moving things in A and where they land in B.
  // null when the photos are too different to blend.
  function flowBetween(LA, LB) {
    const w = FLOW_W, h = Math.max(G * 2, Math.round((FLOW_W * LA.height) / LA.width));
    const a = grayOf(LA, w, h), b = grayOf(LB, w, h);
    let ma = 0, mb = 0;
    for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
    const gn = mb > 0 ? ma / mb : 1;
    for (let i = 0; i < b.length; i++) b[i] *= gn;   // the light may have changed a little
    const PA = [{ d: a, w, h }], PB = [{ d: b, w, h }];
    for (let l = 1; l < 3; l++) { PA.push(half(PA[l - 1])); PB.push(half(PB[l - 1])); }
    const gw = Math.ceil(w / G), gh = Math.ceil(h / G);
    let fx = new Float32Array(gw * gh), fy = new Float32Array(gw * gh), moved = 0, lost = 0;
    // Coarse motion, found once for each 4×4 group of points on a quarter-size copy (big moves need the wide look).
    const coarse = new Map(), coarseAt = (ci, cj) => {
      const ck = cj * 4096 + ci;
      let cv = coarse.get(ck);
      if (cv) return cv;
      const gx = (ci * 4 + 2) * G, gy = (cj * 4 + 2) * G, X0 = (gx - 12) >> 2, Y0 = (gy - 12) >> 2, X1 = (gx + 15) >> 2, Y1 = (gy + 15) >> 2;
      let best = Infinity;
      cv = [0, 0];
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const c = boxCost(PA[2], PB[2], X0, Y0, X1, Y1, dx, dy) + 0.15 * (Math.abs(dx) + Math.abs(dy));
        if (c < best) { best = c; cv = [dx, dy]; }
      }
      coarse.set(ck, cv);
      return cv;
    };
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const cx = i * G + G / 2, cy = j * G + G / 2, x0 = cx - 4, y0 = cy - 4, x1 = cx + 4, y1 = cy + 4;
      const c0 = boxCost(PA[0], PB[0], x0, y0, x1, y1, 0, 0);
      if (c0 < 4) continue;                                     // nothing moved here
      moved++;
      // Fine: half size around this group's motion, its neighbours' and standing still; then full size.
      const guesses = [coarseAt(i >> 2, j >> 2), [0, 0]];
      if (i >> 2) guesses.push(coarseAt((i >> 2) - 1, j >> 2));
      if (j >> 2) guesses.push(coarseAt(i >> 2, (j >> 2) - 1));
      let bx = 0, by = 0, best = Infinity;
      const Xa = Math.floor(x0 / 2) - 1, Ya = Math.floor(y0 / 2) - 1, Xb = Math.ceil(x1 / 2) + 1, Yb = Math.ceil(y1 / 2) + 1;
      for (const [ux, uy] of guesses) {
        for (let dy = uy * 2 - 2; dy <= uy * 2 + 2; dy++) for (let dx = ux * 2 - 2; dx <= ux * 2 + 2; dx++) {
          const c = boxCost(PA[1], PB[1], Xa, Ya, Xb, Yb, dx, dy);
          if (c < best) { best = c; bx = dx; by = dy; }
        }
      }
      const gx = bx * 2, gy = by * 2;
      best = Infinity;
      for (let dy = gy - 2; dy <= gy + 2; dy++) for (let dx = gx - 2; dx <= gx + 2; dx++) {
        const c = boxCost(PA[0], PB[0], x0, y0, x1, y1, dx, dy);
        if (c < best) { best = c; bx = dx; by = dy; }
      }
      if (!(best < c0 / 1.15 - 1)) { if (best > 10) lost++; continue; }   // standing still is about as good
      const cost = (dx, dy) => boxCost(PA[0], PB[0], x0, y0, x1, y1, dx, dy);
      const sub = (m, p) => { const den = m - 2 * best + p; return den > 1e-6 && isFinite(den) ? clamp((0.5 * (m - p)) / den, -0.5, 0.5) : 0; };
      fx[j * gw + i] = bx + sub(cost(bx - 1, by), cost(bx + 1, by));
      fy[j * gw + i] = by + sub(cost(bx, by - 1), cost(bx, by + 1));
      if (best > c0 * 0.6 && best > 10) lost++;
    }
    if (moved > 12 && lost > moved * 0.4 && lost > gw * gh * 0.03) return null;   // too different: just cut
    // The plain middle of a moving thing looks unchanged, so it got no motion: fill such enclosed gaps
    // from the motion around them, so the whole thing moves as one piece.
    const mv = new Uint8Array(gw * gh);
    for (let q = 0; q < mv.length; q++) mv[q] = fx[q] * fx[q] + fy[q] * fy[q] > 0.25 ? 1 : 0;
    const known = mv.slice();
    dropBlobs(mv, gw, gh, 0, Math.max(4, Math.round(gw * gh * 0.06)), true);
    for (let pass = 0; pass < 12; pass++) {
      let left = 0;
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        const q = j * gw + i;
        if (!mv[q] || known[q]) continue;
        let sx = 0, sy = 0, c = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue;
          const r = jj * gw + ii;
          if (known[r]) { sx += fx[r]; sy += fy[r]; c++; }
        }
        if (c) { fx[q] = sx / c; fy[q] = sy / c; known[q] = 2; } else left++;
      }
      if (!left) break;
    }
    fx = median9(fx, gw, gh); fy = median9(fy, gw, gh);
    // The moving things in A: pixels that changed, have motion, and are found again in B along it.
    const flowAt = (x, y) => {
      let gx = (x + 0.5) / G - 0.5, gy = (y + 0.5) / G - 0.5;
      gx = gx < 0 ? 0 : gx > gw - 1 ? gw - 1 : gx; gy = gy < 0 ? 0 : gy > gh - 1 ? gh - 1 : gy;
      const i0 = gx | 0, j0 = gy | 0, i1 = Math.min(gw - 1, i0 + 1), j1 = Math.min(gh - 1, j0 + 1), wx = gx - i0, wy = gy - j0;
      const at = (v) => (v[j0 * gw + i0] * (1 - wx) + v[j0 * gw + i1] * wx) * (1 - wy) + (v[j1 * gw + i0] * (1 - wx) + v[j1 * gw + i1] * wx) * wy;
      return [at(fx), at(fy)];
    };
    const n = w * h, OA = new Uint8Array(n), OB = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, [vx, vy] = flowAt(x, y);
      if (vx * vx + vy * vy < 0.25) continue;
      const X = clamp(x + vx, 0, w - 1.001), Y = clamp(y + vy, 0, h - 1.001), xi = X | 0, yi = Y | 0, ax = X - xi, ay = Y - yi, q = yi * w + xi;
      const bw = (b[q] * (1 - ax) + b[q + 1] * ax) * (1 - ay) + (b[q + w] * (1 - ax) + b[q + w + 1] * ax) * ay;
      if (Math.abs(a[p] - bw) < 16) OA[p] = 1;
    }
    dropBlobs(OA, w, h, 1, 8, false);
    dropBlobs(OA, w, h, 0, 60, true);
    // Where those things are in B.
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!OA[y * w + x]) continue;
      const [vx, vy] = flowAt(x, y), X = Math.round(x + vx), Y = Math.round(y + vy);
      if (X >= 0 && Y >= 0 && X < w && Y < h) OB[Y * w + X] = 1;
    }
    dropBlobs(OB, w, h, 0, 60, true);
    // Two pixels wider, for choosing where the background shows, so no rim of a moving thing is left behind.
    const grow = (M) => { const o = M.slice(); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (M[y * w + x]) { if (x) o[y * w + x - 1] = 1; if (x < w - 1) o[y * w + x + 1] = 1; if (y) o[(y - 1) * w + x] = 1; if (y < h - 1) o[(y + 1) * w + x] = 1; } return o; };
    return { fx, fy, gw, gh, w, h, OA, OAb: grow(grow(OA)), OBb: grow(grow(OB)) };
  }
  // Buffers for in-between pictures, kept between calls.
  let tb = { n: 0 };
  function tweenBufs(n) {
    if (tb.n !== n) tb = { n, base: new Float32Array(n * 4), acc: new Float32Array(n * 4), wsum: new Float32Array(n) };
    else { tb.acc.fill(0); tb.wsum.fill(0); }
    return tb;
  }
  // The picture a share t of the way from A to B (RGBA). The background comes from whichever photo shows it
  // there; the moving things slide along their motion and are laid on top. pm: work with see-through pixels.
  function tweenPixels(A, B, out, W, H, F, t, pm) {
    const { fx, fy, gw, gh, w, h, OA, OAb, OBb } = F, sx = W / w, sy = H / h, u = 1 - t, N = W * H, W4 = W * 4;
    const { base, acc, wsum } = tweenBufs(N);
    // For each output column (or row): the two neighbouring cells of a coarser grid and the weight between them.
    const look = (len, scale, cells) => {
      const i0 = new Int32Array(len), i1 = new Int32Array(len), wt = new Float32Array(len), top = cells - 1;
      for (let k = 0; k < len; k++) {
        let g = (k + 0.5) / scale - 0.5;
        g = g < 0 ? 0 : g > top ? top : g;
        i0[k] = g | 0; i1[k] = Math.min(top, i0[k] + 1); wt[k] = g - i0[k];
      }
      return { i0, i1, wt };
    };
    const mc = look(W, sx, w), mr = look(H, sy, h), gc = look(W, sx * G, gw), gr = look(H, sy * G, gh);
    let cR = 0, cG = 0, cB = 0, cA = 0;
    const put = (X, Y, wt) => {
      if (wt <= 0 || X < 0 || Y < 0 || X >= W || Y >= H) return;
      const r = Y * W + X, ri = r * 4;
      acc[ri] += cR * wt; acc[ri + 1] += cG * wt; acc[ri + 2] += cB * wt; acc[ri + 3] += cA * wt; wsum[r] += wt;
    };
    for (let y = 0; y < H; y++) {
      const m0 = mr.i0[y] * w, m1 = mr.i1[y] * w, my = mr.wt[y], g0 = gr.i0[y] * gw, g1 = gr.i1[y] * gw, gy = gr.wt[y];
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, c0 = mc.i0[x], c1 = mc.i1[x], cx = mc.wt[x], nx = 1 - cx, ny = 1 - my;
        const oab = (OAb[m0 + c0] * nx + OAb[m0 + c1] * cx) * ny + (OAb[m1 + c0] * nx + OAb[m1 + c1] * cx) * my;
        const obb = (OBb[m0 + c0] * nx + OBb[m0 + c1] * cx) * ny + (OBb[m1 + c0] * nx + OBb[m1 + c1] * cx) * my;
        const oa = (OA[m0 + c0] * nx + OA[m0 + c1] * cx) * ny + (OA[m1 + c0] * nx + OA[m1 + c1] * cx) * my;
        let a0, a1, a2, a3, b0, b1, b2, b3;
        if (pm) {
          const fa = A[i + 3] / 255, fb = B[i + 3] / 255;
          a0 = A[i] * fa; a1 = A[i + 1] * fa; a2 = A[i + 2] * fa; a3 = A[i + 3];
          b0 = B[i] * fb; b1 = B[i + 1] * fb; b2 = B[i + 2] * fb; b3 = B[i + 3];
        } else {
          a0 = A[i]; a1 = A[i + 1]; a2 = A[i + 2]; a3 = 255; b0 = B[i]; b1 = B[i + 1]; b2 = B[i + 2]; b3 = 255;
        }
        // Background: from B where A's moving thing was, from A where B's will be, else a mix of both.
        const mix = (1 - oab) * (1 - obb), wa = (1 - oab) * obb + mix * u, wb = oab + mix * t;
        base[i] = a0 * wa + b0 * wb; base[i + 1] = a1 * wa + b1 * wb; base[i + 2] = a2 * wa + b2 * wb; base[i + 3] = a3 * wa + b3 * wb;
        if (oa < 0.02) continue;
        // A moving spot: blend how it looks in A and in B, and lay it down a share t along its way.
        const gx0 = gc.i0[x], gx1 = gc.i1[x], gxw = gc.wt[x], gnx = 1 - gxw, gny = 1 - gy;
        const vx = ((fx[g0 + gx0] * gnx + fx[g0 + gx1] * gxw) * gny + (fx[g1 + gx0] * gnx + fx[g1 + gx1] * gxw) * gy) * sx;
        const vy = ((fy[g0 + gx0] * gnx + fy[g0 + gx1] * gxw) * gny + (fy[g1 + gx0] * gnx + fy[g1 + gx1] * gxw) * gy) * sy;
        let BX = x + vx, BY = y + vy;
        BX = BX < 0 ? 0 : BX > W - 1.001 ? W - 1.001 : BX; BY = BY < 0 ? 0 : BY > H - 1.001 ? H - 1.001 : BY;
        const bx0 = BX | 0, by0 = BY | 0, bax = BX - bx0, bay = BY - by0, j = (by0 * W + bx0) * 4;
        let w00 = (1 - bax) * (1 - bay), w10 = bax * (1 - bay), w01 = (1 - bax) * bay, w11 = bax * bay, s3 = 255;
        if (pm) { w00 *= B[j + 3] / 255; w10 *= B[j + 7] / 255; w01 *= B[j + W4 + 3] / 255; w11 *= B[j + W4 + 7] / 255; s3 = (w00 + w10 + w01 + w11) * 255; }
        cR = u * a0 + t * (B[j] * w00 + B[j + 4] * w10 + B[j + W4] * w01 + B[j + W4 + 4] * w11);
        cG = u * a1 + t * (B[j + 1] * w00 + B[j + 5] * w10 + B[j + W4 + 1] * w01 + B[j + W4 + 5] * w11);
        cB = u * a2 + t * (B[j + 2] * w00 + B[j + 6] * w10 + B[j + W4 + 2] * w01 + B[j + W4 + 6] * w11);
        cA = u * a3 + t * s3;
        const TX = x + t * vx, TY = y + t * vy, tx0 = Math.floor(TX), ty0 = Math.floor(TY), tax = TX - tx0, tay = TY - ty0;
        put(tx0, ty0, (1 - tax) * (1 - tay) * oa); put(tx0 + 1, ty0, tax * (1 - tay) * oa);
        put(tx0, ty0 + 1, (1 - tax) * tay * oa); put(tx0 + 1, ty0 + 1, tax * tay * oa);
      }
    }
    for (let q = 0, i = 0; q < N; q++, i += 4) {
      let r = base[i], g = base[i + 1], bl = base[i + 2], al = base[i + 3];
      const ws = wsum[q];
      if (ws > 0) {
        const k = ws < 1 ? ws : 1, inv = k / ws, rest = 1 - k;
        r = acc[i] * inv + rest * r; g = acc[i + 1] * inv + rest * g; bl = acc[i + 2] * inv + rest * bl; al = acc[i + 3] * inv + rest * al;
      }
      if (pm) { const f = al > 0.5 ? 255 / al : 0; out[i] = r * f; out[i + 1] = g * f; out[i + 2] = bl * f; out[i + 3] = al; }
      else { out[i] = r; out[i + 1] = g; out[i + 2] = bl; out[i + 3] = 255; }
    }
  }
  // The two photos around an in-between are prepared once and reused for every in-between between them.
  let pair = { key: '', P: null };
  function pairKey(lib, k, k2, W, H, kw) {
    const ed = lib.m.edit, mv = (i) => { const f = lib.frames[i], r = f && lib.recs.get(f.id); return r ? r.maskV || 0 : 0; };
    return JSON.stringify([lib.m.id, k, k2, W, H, kw, ed.steady, ed.even, ed.frame, ed.fillFrom, ed.scene.bg !== 'none', ed.scene.cut, ed.scene.shadows, lib.v, lib.plateV, mv(k), mv(k2)]);
  }
  async function drawTween(x, W, H, lib, k, k2, f, o = {}) {
    const kw = o.keyRes || 480, key = pairKey(lib, k, k2, W, H, kw);
    if (pair.key !== key) {
      const rA = await lib.shotRes(k, kw), rB = await lib.shotRes(k2, kw);
      if (!rA || !rA.img || !rB || !rB.img) { paintShot(x, W, H, lib, k, rA, o); return; }
      const O = outMatrix(frameGeom(lib.m), W, H);
      const A = layersOf(lib, k, rA, O, W, H, false, true), B = layersOf(lib, k2, rB, O, W, H, false, true);
      const flow = flowBetween(A.L, B.L), read = (c) => c && c.getContext('2d').getImageData(0, 0, W, H).data;
      pair = { key, P: { A, flow, bg: rA.bg, keyed: A.keyed, fgA: flow && read(A.fg), fgB: flow && read(B.fg), shA: flow && read(A.sh), shB: flow && read(B.sh) } };
    }
    const P = pair.P;
    if (!P.flow) { finishFrame(x, W, H, lib, k, P.A, P.bg, o, k); return; }   // too different to blend: hold the photo
    const T = scratch('tween', W, H), tx = T.getContext('2d'), img = tx.createImageData(W, H);
    tweenPixels(P.fgA, P.fgB, img.data, W, H, P.flow, f, P.keyed);
    tx.putImageData(img, 0, 0);
    let sh = null;
    if (P.shA && P.shB) {
      sh = scratch('tweenSh', W, H);
      const sx = sh.getContext('2d'), si = sx.createImageData(W, H);
      tweenPixels(P.shA, P.shB, si.data, W, H, P.flow, f, true);
      sx.putImageData(si, 0, 0);
    }
    finishFrame(x, W, H, lib, k + f, { L: T, fg: T, sh, keyed: P.keyed }, P.bg, o, k);
  }
  const SMOOTH = [0, 12, 24];   // off, smooth, extra smooth: roughly how many pictures a second to aim for
  function tweensPerPhoto(ed, fps) {
    const target = SMOOTH[ed.smooth || 0], cap = Math.min(7, Math.floor(30 / fps) - 1);
    return !target || cap < 1 ? 0 : clamp(Math.round(target / fps) - 1, 1, cap);
  }

  // ---------- the movie's timeline: title, photos, curtains, credits ----------
  function timeline(m, frames, music) {
    const ed = m.edit, fps = m.fps || 10, n = frames.length, base = 1 / fps;
    const T0 = ed.title.on && n ? Art.TITLE_DUR : 0, cur = !!ed.curtains && n > 0, open = cur ? 1.4 : 0, close = cur ? 1.4 : 0;
    let order = frames.map((_, i) => i);
    if (ed.boomerang && n > 2) order = order.concat(order.slice(1, -1).reverse());
    const shots = [], firstAt = {};
    let t = T0 + open;
    for (const i of order) {
      const d = base * clamp(ed.holds[frames[i].id] || 1, 1, 8);
      shots.push({ k: i, t0: t, d });
      if (firstAt[frames[i].id] == null) firstAt[frames[i].id] = t;
      t += d;
    }
    const movieEnd = t, creditsStart = movieEnd + close, creditsDur = n ? Art.creditsDur(ed, music) : 0;
    return {
      fps, n, T0, open, close, movieStart: T0 + open, movieEnd, creditsStart, creditsDur, total: creditsStart + creditsDur, shots, firstAt,
      base, smoothN: tweensPerPhoto(ed, fps), cut: frames.map((f) => !!f.cut),
    };
  }
  // Every picture of the finished video: one per photo (plus in-betweens for smooth moves),
  // and 30 a second while titles and curtains animate.
  function items(tl) {
    const out = [], step = 1 / 30;
    const anim = (kind, t0, dur, extra) => {
      const n = Math.max(1, Math.round(dur * 30));
      for (let i = 0; i < n; i++) out.push({ kind, t: t0 + i * step, d: i === n - 1 ? dur - i * step : step, u: i * step, ...extra });
    };
    if (tl.T0 > 0) anim('title', 0, tl.T0);
    if (tl.n) {
      if (tl.open > 0) anim('open', tl.T0, tl.open, { k: tl.shots[0].k });
      tl.shots.forEach((s, i) => {
        const nx = tl.shots[i + 1], n = tl.smoothN;
        // In-betweens take the last moment of a photo, never across a "keep this spot" cut.
        if (n && nx && nx.k !== s.k && !tl.cut[Math.max(s.k, nx.k)]) {
          const d = tl.base / (n + 1), still = s.d - n * d;
          out.push({ kind: 'shot', t: s.t0, d: still, k: s.k });
          for (let j = 1; j <= n; j++) out.push({ kind: 'tween', t: s.t0 + still + (j - 1) * d, d, k: s.k, k2: nx.k, f: j / (n + 1) });
        } else out.push({ kind: 'shot', t: s.t0, d: s.d, k: s.k });
      });
      if (tl.close > 0) anim('close', tl.movieEnd, tl.close, { k: tl.shots[tl.shots.length - 1].k });
    }
    if (tl.creditsDur > 0) anim('credits', tl.creditsStart, tl.creditsDur);
    return out;
  }
  function itemAt(list, t) {
    let lo = 0, hi = list.length - 1;
    if (hi < 0) return -1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (list[mid].t <= t) lo = mid; else hi = mid - 1; }
    return lo;
  }

  // ---------- the camera screen: live magic background, effects and framing ----------
  // Shrinks a picture (the camera, a photo, the empty set) to w×h through a half-way size with
  // smoothing, the same way for all of them, so fine detail (wood grain, edges) shrinks alike.
  function shrink(src, sw, sh, w, h, name) {
    let s = src;
    if (sw > 3 * w) {
      const m = scratch(name + 'Mid', w * 2, h * 2), mx = m.getContext('2d');
      mx.setTransform(1, 0, 0, 1, 0, 0); mx.imageSmoothingEnabled = true; mx.imageSmoothingQuality = 'high';
      mx.drawImage(src, 0, 0, w * 2, h * 2);
      s = m;
    }
    const c = scratch(name, w, h), x = ctxR(c);
    x.setTransform(1, 0, 0, 1, 0, 0); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(s, 0, 0, w, h);
    return x.getImageData(0, 0, w, h).data;
  }
  const Live = {
    canvas: null, raf: 0, plate: null, mask: null, shadow: null, ghost: null, ghostSrc: '', bgImg: null, on: false,
    fit: null, ticks: 0, past: [],
    get m() { return S.movie; },   // always the movie on the camera screen
    async start(canvas) {
      this.stop();
      this.canvas = canvas; this.on = true; this.mask = null; this.ghost = null; this.ghostSrc = '';
      await this.reload();
      this.loop();
    },
    stop() {
      this.on = false; cancelAnimationFrame(this.raf); clearTimeout(this.timer);
      if (this.canvas) this.canvas.hidden = true;
      document.body.classList.remove('scene-bg');
    },
    get bgOn() { return !!(this.m && this.m.edit.scene.bg !== 'none' && this.plate); },
    get fgOn() { return !!(this.m && this.m.edit.scene.fg !== 'none'); },
    async reload() {
      const m = this.m;
      if (!m) return;
      const rec = await DB.get('aux', `${m.id}/plate`);
      this.plate = null; this.fit = null; this.ticks = 0; this.past = [];
      if (rec) {
        const img = await decodeImage(rec.full).catch(() => null);
        if (img) {
          const kw = LIVE_KW, kh = Math.round((kw * (m.h || rec.h)) / (m.w || rec.w));
          this.plate = { w: kw, h: kh, data: shrink(img, img.width || img.naturalWidth, img.height || img.naturalHeight, kw, kh, 'livePlate').slice(), made: !!rec.made };
          if (img.close) img.close();
        }
      }
      const bg = m.edit.scene.bg === 'photo' ? await DB.get('aux', `${m.id}/bgphoto`) : null;
      this.bgImg = bg ? await decodeImage(bg.blob).catch(() => null) : null;
      this.ghostSrc = '';
    },
    // From the camera watch loop: cut the toys out of the live picture. The empty set is lined up
    // with the camera each time, starting from last time's fit (from scratch now and then, in case
    // the iPad was bumped); each pixel shows the middle of its last three cut-outs, so camera noise
    // doesn't make the edges flicker.
    update(src) {
      if (!this.on || !this.bgOn) return;
      const [vw, vh] = sourceSize(src);
      if (!vw) return;
      const { w, h } = this.plate, ed = this.m.edit, warm = !!this.fit && this.ticks++ % 8 !== 0;
      const res = keyMask(shrink(src, vw, vh, w, h, 'liveGrab'), this.plate.data, w, h, ed.scene.cut, ed.scene.shadows !== false, warm ? { fit: this.fit } : {});
      this.fit = res.fit;
      const a = res.alpha, [p1, p2] = this.past;
      this.past = [a, p1];
      let out = a;
      if (p1 && p2 && p2.length === a.length) {
        out = new Uint8Array(a.length);
        for (let i = 0; i < a.length; i++) { const x = a[i], y = p1[i], z = p2[i], lo = x < y ? x : y, hi = x < y ? y : x; out[i] = hi < z ? hi : lo > z ? lo : z; }
      }
      this.mask = maskCanvas(this.mask || mk(w, h), out, w, h, true);
      this.shadow = maskCanvas(this.shadow || mk(w, h), res.shadow, w, h, false);
    },
    // The see-through ghost of the last photo, cut out too.
    ghostFrom(img) {
      if (!this.bgOn || !img || !img.complete || !img.naturalWidth) { this.ghost = null; return; }
      if (this.ghostSrc === img.src) return;
      this.ghostSrc = img.src;
      const { w, h } = this.plate;
      const res = keyMask(shrink(img, img.naturalWidth, img.naturalHeight, w, h, 'ghostGrab'), this.plate.data, w, h, this.m.edit.scene.cut, this.m.edit.scene.shadows !== false);
      const gw = 960, gh = Math.round((gw * h) / w), g = this.ghost && this.ghost.width === gw ? this.ghost : mk(gw, gh), gx = g.getContext('2d');
      gx.setTransform(1, 0, 0, 1, 0, 0); gx.globalCompositeOperation = 'source-over'; gx.clearRect(0, 0, gw, gh); gx.drawImage(img, 0, 0, gw, gh);
      gx.globalCompositeOperation = 'destination-in'; gx.drawImage(maskCanvas(mk(w, h), res.alpha, w, h, true), 0, 0, gw, gh);
      gx.globalCompositeOperation = 'source-over';
      this.ghost = g;
    },
    loop() {
      if (!this.on) return;
      this.draw();
      cancelAnimationFrame(this.raf); clearTimeout(this.timer);
      this.raf = requestAnimationFrame(() => this.loop());
      this.timer = setTimeout(() => this.loop(), 120); // keeps going where animation frames are paused
    },
    // The stage rectangle where the framed picture shows, in canvas pixels.
    windowRect(W, H) {
      const g = frameGeom(this.m), [ww, wh] = fitSize(g.cw / g.ch, W, H);
      return { g, ww, wh, wx: (W - ww) / 2, wy: (H - wh) / 2 };
    },
    draw() {
      const c = this.canvas, m = this.m;
      if (!c || !m) return;
      const show = !this.hold && (this.bgOn || this.fgOn);   // hold: show the real camera (taking the empty set)
      c.hidden = !show;
      document.body.classList.toggle('scene-bg', show && this.bgOn);
      if (!show) return;
      const st = c.parentElement, dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const W = Math.max(2, Math.round(st.clientWidth * dpr)), H = Math.max(2, Math.round(st.clientHeight * dpr));
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const x = c.getContext('2d');
      Art.reset(x); x.clearRect(0, 0, W, H);
      const { g, ww, wh, wx, wy } = this.windowRect(W, H), ed = m.edit, W0 = m.w || 1280, H0 = m.h || 720;
      const k = (performance.now() / 1000) * (m.fps || 10), src = frameSource(), [vw] = sourceSize(src);
      const Tw = M.mul(M.move(wx, wy), outMatrix(g, ww, wh));
      x.save(); x.beginPath(); x.rect(wx, wy, ww, wh); x.clip();
      if (this.bgOn) {
        x.translate(wx, wy); Art.drawBg(x, ww, wh, ed.scene.bg, k, this.bgImg); x.setTransform(1, 0, 0, 1, 0, 0);
        x.imageSmoothingQuality = 'high';
        if (this.ghost && Settings.v.onion) { M.set(x, M.mul(Tw, M.scale(W0 / this.ghost.width, H0 / this.ghost.height))); x.globalAlpha = 0.45; x.drawImage(this.ghost, 0, 0); x.globalAlpha = 1; }
        if (this.mask && vw) {
          const KT = M.mul(Tw, M.scale(W0 / this.mask.width, H0 / this.mask.height));
          if (ed.scene.shadows !== false && this.shadow) { M.set(x, KT); x.globalAlpha = 0.85; x.drawImage(this.shadow, 0, 0); x.globalAlpha = 1; }
          const T = scratch('liveT', W, H), tx = T.getContext('2d');
          Art.reset(tx); tx.clearRect(0, 0, W, H);
          M.set(tx, Tw); tx.drawImage(src, 0, 0, W0, H0);
          tx.globalCompositeOperation = 'destination-in'; tx.imageSmoothingQuality = 'high'; M.set(tx, KT); tx.drawImage(this.mask, 0, 0);
          Art.reset(tx);
          x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(T, 0, 0);
        }
      }
      if (this.fgOn) { x.setTransform(1, 0, 0, 1, wx, wy); Art.drawEffect(x, ww, wh, ed.scene.fg, k); }
      x.restore();
    },
  };

  return {
    M, AW, EW, Lib, ID, keyMask, maskCanvas, defaults, ensureEdit, frameGeom, outMatrix, fitSize, SHAPES,
    drawShot, paintShot, drawTween, stickersAt, timeline, items, itemAt, Live, applySim, invSim, flowBetween,
  };
})();
