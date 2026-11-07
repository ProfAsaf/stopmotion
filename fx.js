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
      holds: {}, boomerang: false,
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
  function blurRGB(S, w, h) {
    const n = w * h, T = new Uint8ClampedArray(n * 4), O = new Uint8ClampedArray(n * 4);
    for (let y = 0; y < h; y++) {
      const r = y * w;
      for (let x = 0; x < w; x++) {
        const l = (r + (x > 0 ? x - 1 : x)) * 4, c = (r + x) * 4, rr = (r + (x < w - 1 ? x + 1 : x)) * 4;
        T[c] = (S[l] + S[c] + S[rr]) / 3; T[c + 1] = (S[l + 1] + S[c + 1] + S[rr + 1]) / 3; T[c + 2] = (S[l + 2] + S[c + 2] + S[rr + 2]) / 3; T[c + 3] = S[c + 3];
      }
    }
    for (let y = 0; y < h; y++) {
      const u = (y > 0 ? y - 1 : y) * w, r = y * w, d = (y < h - 1 ? y + 1 : y) * w;
      for (let x = 0; x < w; x++) {
        const a = (u + x) * 4, c = (r + x) * 4, b = (d + x) * 4;
        O[c] = (T[a] + T[c] + T[b]) / 3; O[c + 1] = (T[a + 1] + T[c + 1] + T[b + 1]) / 3; O[c + 2] = (T[a + 2] + T[c + 2] + T[b + 2]) / 3; O[c + 3] = T[c + 3];
      }
    }
    return O;
  }
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
  // F = photo, P = empty set (RGBA, same size). cut 0..1: how eagerly things count as toys.
  // Returns alpha (how much each pixel is toy) and shadow (how much shadow falls there).
  function keyMask(F, P, w, h, cut, shadows) {
    const n = w * h, f = blurRGB(F, w, h), p = blurRGB(P, w, h);
    const hist = [new Uint32Array(128), new Uint32Array(128), new Uint32Array(128)];
    for (let i = 0; i < n; i += 3) {
      const q = i * 4;
      if (P[q + 3] < 128) continue;
      for (let c = 0; c < 3; c++) {
        const a = p[q + c], b = f[q + c];
        if (a < 12 || a > 245 || b < 8 || b > 250) continue;
        const bin = Math.round(Math.log2(b / a) * 64 + 64);
        if (bin >= 0 && bin < 128) hist[c][bin]++;
      }
    }
    const gain = hist.map((hh) => { let tot = 0; for (const v of hh) tot += v; if (tot < 50) return 1; for (let i = 0, acc = 0; i < 128; i++) { acc += hh[i]; if (acc >= tot / 2) return Math.pow(2, (i - 64) / 64); } return 1; });
    const lo = 40 - 28 * clamp(cut, 0, 1), hi = lo + 18, alpha = new Uint8Array(n), shadow = new Uint8Array(n);
    // Only trust spots well inside the empty-set picture: its edges get darkened by the blur when it is slid into place.
    let ok = new Uint8Array(n);
    for (let i = 0; i < n; i++) ok[i] = P[i * 4 + 3] > 250 ? 1 : 0;
    for (let pass = 0; pass < 2; pass++) {
      const t = new Uint8Array(n);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        t[i] = ok[i] && (x === 0 || ok[i - 1]) && (x === w - 1 || ok[i + 1]) && (y === 0 || ok[i - w]) && (y === h - 1 || ok[i + w]) ? 1 : 0;
      }
      ok = t;
    }
    for (let i = 0, q = 0; i < n; i++, q += 4) {
      if (!ok[i]) continue;
      const fr = f[q], fg = f[q + 1], fb = f[q + 2], pr = p[q] * gain[0], pg = p[q + 1] * gain[1], pb = p[q + 2] * gain[2];
      const yf = 0.299 * fr + 0.587 * fg + 0.114 * fb + 6, yp = 0.299 * pr + 0.587 * pg + 0.114 * pb + 6;
      const dcr = fr / yf - pr / yp, dcb = fb / yf - pb / yp, chroma = Math.sqrt(dcr * dcr + dcb * dcb) * Math.min(yf, yp);
      const ratio = yf / yp;
      let score;
      if (shadows && ratio > 0.3 && ratio < 0.94 && chroma < 14) {   // darker, same color: a shadow
        score = chroma * 1.6;
        shadow[i] = Math.round(clamp((0.94 - ratio) / 0.64, 0, 1) * 210);
      } else score = Math.max(Math.abs(yf - yp), chroma * 1.6);
      alpha[i] = score <= lo ? 0 : score >= hi ? 255 : ((score - lo) / (hi - lo)) * 255;
    }
    const bin = new Uint8Array(n);
    for (let i = 0; i < n; i++) bin[i] = alpha[i] > 110 ? 1 : 0;
    dropBlobs(bin, w, h, 1, Math.max(6, Math.round(n * 0.0005)), false);
    dropBlobs(bin, w, h, 0, Math.round(n * 0.006), true);
    for (let i = 0; i < n; i++) { alpha[i] = bin[i] ? 255 : 0; if (bin[i]) shadow[i] = 0; }
    box1(alpha, w, h); box1(alpha, w, h); box1(shadow, w, h);
    return { alpha, shadow };
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
      const A = scratch('kA', kw, kh), ax = ctxR(A);
      ax.setTransform(1, 0, 0, 1, 0, 0); ax.globalCompositeOperation = 'source-over'; ax.globalAlpha = 1; ax.clearRect(0, 0, kw, kh);
      this.paintClean(ax, S, { f, img, mask, src }, 'kE');
      const Fd = ax.getImageData(0, 0, kw, kh).data;
      const B = scratch('kB', kw, kh), bx = ctxR(B);
      bx.setTransform(1, 0, 0, 1, 0, 0); bx.clearRect(0, 0, kw, kh);
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
  function paintShot(x, W, H, lib, k, r, o = {}) {
    const m = lib.m, ed = m.edit, W0 = m.w, H0 = m.h;
    Art.reset(x);
    if (!r || !r.img) { x.fillStyle = '#000'; x.fillRect(0, 0, W, H); return; }
    const O = outMatrix(frameGeom(m, o.full), W, H), A = lib.alignOf(r.f.id), T = M.mul(O, ed.steady ? M.sim(A) : M.id());
    const L = scratch('L', W, H), lx = L.getContext('2d');
    Art.reset(lx); lx.fillStyle = '#000'; lx.fillRect(0, 0, W, H); lx.imageSmoothingQuality = 'high';
    if (ed.steady && r.under && r.under.img) { M.set(lx, M.mul(O, M.sim(r.under.sim))); lx.drawImage(r.under.img, 0, 0, W0, H0); }
    lib.paintClean(lx, T, r, 'E');
    if (ed.even) gainsOn(L, lx, lib.gains(k));
    Art.reset(lx);
    if (r.key && !o.raw) {
      Art.drawBg(x, W, H, ed.scene.bg, k, r.bg);
      const KT = M.mul(T, M.scale(W0 / r.key.w, H0 / r.key.h));
      x.imageSmoothingQuality = 'high';
      if (ed.scene.shadows !== false) { M.set(x, KT); x.globalAlpha = 0.85; x.drawImage(r.key.shadow, 0, 0); Art.reset(x); }
      const F = scratch('F', W, H), fx = F.getContext('2d');
      Art.reset(fx); fx.clearRect(0, 0, W, H); fx.drawImage(L, 0, 0);
      fx.globalCompositeOperation = 'destination-in'; fx.imageSmoothingQuality = 'high'; M.set(fx, KT); fx.drawImage(r.key.alpha, 0, 0);
      Art.reset(fx);
      x.drawImage(F, 0, 0);
    } else x.drawImage(L, 0, 0);
    if (o.raw) return;
    if (ed.scene.fg && ed.scene.fg !== 'none') Art.drawEffect(x, W, H, ed.scene.fg, k);
    if (ed.look && ed.look !== 'none') Art.applyLook(x, W, H, ed.look, ed.lookAmt == null ? 0.85 : ed.lookAmt, k);
    if (ed.light && ed.light !== 'none') Art.drawLight(x, W, H, ed.light, k, ed.spot);
    Art.reset(x);
    if (!o.noStickers) for (const s of stickersAt(lib, k)) Art.drawSticker(x, W, H, s);
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
    return { fps, n, T0, open, close, movieStart: T0 + open, movieEnd, creditsStart, creditsDur, total: creditsStart + creditsDur, shots, firstAt };
  }
  // Every picture of the finished video: one per photo, plus 30 a second while things animate.
  function items(tl) {
    const out = [], step = 1 / 30;
    const anim = (kind, t0, dur, extra) => {
      const n = Math.max(1, Math.round(dur * 30));
      for (let i = 0; i < n; i++) out.push({ kind, t: t0 + i * step, d: i === n - 1 ? dur - i * step : step, u: i * step, ...extra });
    };
    if (tl.T0 > 0) anim('title', 0, tl.T0);
    if (tl.n) {
      if (tl.open > 0) anim('open', tl.T0, tl.open, { k: tl.shots[0].k });
      for (const s of tl.shots) out.push({ kind: 'shot', t: s.t0, d: s.d, k: s.k });
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
  const Live = {
    canvas: null, raf: 0, plate: null, mask: null, shadow: null, ghost: null, ghostSrc: '', bgImg: null, on: false,
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
      this.plate = null;
      if (rec) {
        const img = await decodeImage(rec.full).catch(() => null);
        if (img) {
          const kw = LIVE_KW, kh = Math.round((kw * (m.h || rec.h)) / (m.w || rec.w)), c = mk(kw, kh), x = ctxR(c);
          x.drawImage(img, 0, 0, kw, kh);
          this.plate = { w: kw, h: kh, data: x.getImageData(0, 0, kw, kh).data, made: !!rec.made };
          if (img.close) img.close();
        }
      }
      const bg = m.edit.scene.bg === 'photo' ? await DB.get('aux', `${m.id}/bgphoto`) : null;
      this.bgImg = bg ? await decodeImage(bg.blob).catch(() => null) : null;
      this.ghostSrc = '';
    },
    // From the camera watch loop: cut the toys out of the live picture.
    update(src) {
      if (!this.on || !this.bgOn) return;
      const [vw] = sourceSize(src);
      if (!vw) return;
      const { w, h } = this.plate, c = scratch('liveGrab', w, h), x = ctxR(c);
      x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(src, 0, 0, w, h);
      const res = keyMask(x.getImageData(0, 0, w, h).data, this.plate.data, w, h, this.m.edit.scene.cut, this.m.edit.scene.shadows !== false);
      this.mask = maskCanvas(this.mask || mk(w, h), res.alpha, w, h, true);
      this.shadow = maskCanvas(this.shadow || mk(w, h), res.shadow, w, h, false);
    },
    // The see-through ghost of the last photo, cut out too.
    ghostFrom(img) {
      if (!this.bgOn || !img || !img.complete || !img.naturalWidth) { this.ghost = null; return; }
      if (this.ghostSrc === img.src) return;
      this.ghostSrc = img.src;
      const { w, h } = this.plate, c = scratch('ghostGrab', w, h), x = ctxR(c);
      x.drawImage(img, 0, 0, w, h);
      const res = keyMask(x.getImageData(0, 0, w, h).data, this.plate.data, w, h, this.m.edit.scene.cut, this.m.edit.scene.shadows !== false);
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
    drawShot, paintShot, stickersAt, timeline, items, itemAt, Live, applySim, invSim,
  };
})();
