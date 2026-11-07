'use strict';
/* Stop Motion: artwork drawn in code, so the app needs no image files. Magic
   backgrounds, front effects, color looks, lights, titles, credits, curtains and
   stickers. Moving parts take k, the photo number, so they step once per photo like
   the toys do (the live camera view passes a fractional k, so they glide there). */
const Art = (() => {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  const rand = (seed) => { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  const hash = (n) => { n = Math.floor(n) | 0; n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const wrap = (v, m) => ((v % m) + m) % m;
  const ease = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t); };
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const popIn = (t) => { const u = clamp(t, 0, 1) - 1; return 1 + 3.2 * u * u * u + 2.2 * u * u; }; // overshoots, then settles
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  const FONT = {
    theater: '"Didot","Bodoni 72","Bodoni MT","Playfair Display",Georgia,serif',
    comic: '"Chalkboard SE","Marker Felt","Comic Sans MS","Comic Neue",cursive',
    space: '"Avenir Next Condensed","Futura","Arial Narrow","Helvetica Neue",Arial,sans-serif',
    old: '"American Typewriter","Courier New",Courier,serif',
    fairy: '"Snell Roundhand","Savoye LET","Apple Chancery","Brush Script MT","Segoe Script",cursive',
    spooky: '"Chalkduster","Papyrus","Luminari","Chiller",fantasy',
    round: 'ui-rounded,"SF Pro Rounded","Arial Rounded MT Bold",system-ui,-apple-system,"Segoe UI",sans-serif',
    emoji: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
  };

  function reset(x) { x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.shadowBlur = 0; x.shadowColor = 'transparent'; }
  function lin(x, x0, y0, x1, y1, stops) { const g = x.createLinearGradient(x0, y0, x1, y1); for (const [o, c] of stops) g.addColorStop(o, c); return g; }
  const vg = (x, y0, y1, stops) => lin(x, 0, y0, 0, y1, stops);
  function glow(x, cx, cy, r, c, a = 1) {
    if (r <= 0) return;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, rgba(c, a)); g.addColorStop(0.35, rgba(c, a * 0.5)); g.addColorStop(1, rgba(c, 0));
    x.fillStyle = g; x.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  }
  function disc(x, cx, cy, r, fill) { x.fillStyle = fill; x.beginPath(); x.arc(cx, cy, Math.max(0.1, r), 0, TAU); x.fill(); }
  function starPath(x, cx, cy, R, r, n, rot = -Math.PI / 2) {
    x.beginPath();
    for (let i = 0; i < n * 2; i++) { const a = rot + (i * Math.PI) / n, q = i % 2 ? r : R; x.lineTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q); }
    x.closePath();
  }
  function star4(x, cx, cy, s) {
    x.beginPath(); x.moveTo(cx, cy - s);
    x.quadraticCurveTo(cx, cy, cx + s, cy); x.quadraticCurveTo(cx, cy, cx, cy + s);
    x.quadraticCurveTo(cx, cy, cx - s, cy); x.quadraticCurveTo(cx, cy, cx, cy - s); x.fill();
  }
  function heartPath(x, cx, cy, s) {
    x.beginPath(); x.moveTo(cx, cy + s * 0.8);
    x.bezierCurveTo(cx - s * 1.3, cy - s * 0.1, cx - s * 0.6, cy - s, cx, cy - s * 0.4);
    x.bezierCurveTo(cx + s * 0.6, cy - s, cx + s * 1.3, cy - s * 0.1, cx, cy + s * 0.8);
    x.closePath();
  }
  function cover(x, img, W, H) {
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    if (!iw || !ih) return;
    const s = Math.max(W / iw, H / ih);
    x.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
  }

  // Static layers are painted once per size and reused.
  const cache = new Map();
  function layer(key, w, h, paint) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const id = `${key}@${w}x${h}`;
    let c = cache.get(id);
    if (c) { cache.delete(id); cache.set(id, c); return c; }
    c = mk(w, h); paint(c.getContext('2d'), w, h);
    cache.set(id, c);
    while (cache.size > 28) cache.delete(cache.keys().next().value);
    return c;
  }

  // ---------- little things the scenes are made of ----------
  const PUFF = [[0, 0, 1], [-0.95, 0.22, 0.7], [0.95, 0.24, 0.72], [-0.45, -0.42, 0.72], [0.45, -0.46, 0.78], [1.7, 0.42, 0.48], [-1.65, 0.44, 0.46]];
  function cloud(x, cx, cy, s, fill = '#fff', shade = 'rgba(160,190,225,.55)') {
    const path = (oy) => { x.beginPath(); for (const [dx, dy, r] of PUFF) { x.moveTo(cx + (dx + r) * s, cy + dy * s + oy); x.arc(cx + dx * s, cy + dy * s + oy, r * s, 0, TAU); } };
    if (shade) { x.fillStyle = shade; path(s * 0.16); x.fill(); }
    x.fillStyle = fill; path(0); x.fill();
  }
  function hills(x, W, H, base, amp, fill, seed) {
    const r = rand(seed), a = [r() * TAU, r() * TAU, r() * TAU], f = [1.2 + r(), 2.6 + r() * 2, 6 + r() * 4];
    x.fillStyle = fill; x.beginPath(); x.moveTo(0, H);
    for (let i = 0; i <= 80; i++) {
      const u = i / 80;
      x.lineTo(u * W, base - amp * (Math.sin(u * f[0] * Math.PI + a[0]) + 0.5 * Math.sin(u * f[1] * Math.PI + a[1]) + 0.2 * Math.sin(u * f[2] * Math.PI + a[2])));
    }
    x.lineTo(W, H); x.closePath(); x.fill();
  }
  function palm(x, bx, by, h, col) {
    x.strokeStyle = col; x.fillStyle = col; x.lineCap = 'round';
    x.lineWidth = h * 0.045;
    x.beginPath(); x.moveTo(bx, by); x.quadraticCurveTo(bx + h * 0.12, by - h * 0.5, bx + h * 0.05, by - h); x.stroke();
    const tx = bx + h * 0.05, ty = by - h;
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i / 6 - 0.5) * 2.7, L = h * (0.4 + (i % 2) * 0.1);
      const ex = tx + Math.cos(a) * L, ey = ty + Math.sin(a) * L * 0.6 + h * 0.14;
      const mx = tx + Math.cos(a) * L * 0.5, my = ty + Math.sin(a) * L * 0.5 - h * 0.05;
      x.beginPath(); x.moveTo(tx, ty); x.quadraticCurveTo(mx, my - h * 0.05, ex, ey); x.quadraticCurveTo(mx, my + h * 0.04, tx, ty); x.fill();
    }
  }
  function pine(x, bx, by, h, col, snow) {
    x.fillStyle = '#5b3a1e'; x.fillRect(bx - h * 0.04, by - h * 0.12, h * 0.08, h * 0.12);
    for (let i = 0; i < 3; i++) {
      const y0 = by - h * 0.1 - i * h * 0.24, w = h * (0.36 - i * 0.08);
      x.fillStyle = col; x.beginPath(); x.moveTo(bx - w, y0); x.lineTo(bx + w, y0); x.lineTo(bx, y0 - h * 0.4); x.closePath(); x.fill();
      if (snow) {
        x.fillStyle = snow; x.beginPath(); x.moveTo(bx - w * 0.45, y0 - h * 0.22); x.lineTo(bx, y0 - h * 0.4); x.lineTo(bx + w * 0.45, y0 - h * 0.22);
        x.quadraticCurveTo(bx, y0 - h * 0.16, bx - w * 0.45, y0 - h * 0.22); x.fill();
      }
    }
  }
  function snowman(x, cx, by, h) {
    const r1 = h * 0.22, r2 = h * 0.16, r3 = h * 0.11;
    const y1 = by - r1, y2 = y1 - r1 - r2 * 0.75, y3 = y2 - r2 - r3 * 0.7;
    for (const [y, r] of [[y1, r1], [y2, r2], [y3, r3]]) { disc(x, cx + r * 0.08, y + r * 0.06, r, '#c9d8ea'); disc(x, cx, y, r, '#ffffff'); }
    disc(x, cx - r3 * 0.35, y3 - r3 * 0.15, r3 * 0.1, '#222'); disc(x, cx + r3 * 0.35, y3 - r3 * 0.15, r3 * 0.1, '#222');
    x.fillStyle = '#ff8a1f'; x.beginPath(); x.moveTo(cx, y3); x.lineTo(cx + r3 * 0.9, y3 + r3 * 0.12); x.lineTo(cx, y3 + r3 * 0.22); x.fill();
    for (let i = 0; i < 3; i++) disc(x, cx, y2 - r2 * 0.4 + i * r2 * 0.4, r2 * 0.08, '#222');
    x.fillStyle = '#222'; x.fillRect(cx - r3 * 0.95, y3 - r3 * 0.85, r3 * 1.9, r3 * 0.18); x.fillRect(cx - r3 * 0.6, y3 - r3 * 1.65, r3 * 1.2, r3 * 0.85);
    x.fillStyle = '#d64545'; x.fillRect(cx - r2 * 0.75, y2 - r2 * 0.95, r2 * 1.5, r2 * 0.22);
  }
  function lollipop(x, bx, by, h, col) {
    x.fillStyle = '#fff'; x.fillRect(bx - h * 0.025, by - h * 0.7, h * 0.05, h * 0.7);
    const cx = bx, cy = by - h * 0.78, r = h * 0.22;
    disc(x, cx, cy, r, '#fff');
    x.strokeStyle = col; x.lineWidth = r * 0.22; x.lineCap = 'round'; x.beginPath();
    for (let a = 0; a < TAU * 2.6; a += 0.2) { const q = (a / (TAU * 2.6)) * r * 0.85; x.lineTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q); }
    x.stroke();
  }
  function cane(x, bx, by, h) {
    x.lineCap = 'round'; x.lineWidth = h * 0.09;
    const path = () => { x.beginPath(); x.moveTo(bx, by); x.lineTo(bx, by - h * 0.75); x.arc(bx + h * 0.16, by - h * 0.75, h * 0.16, Math.PI, 0); };
    x.strokeStyle = '#fff'; path(); x.stroke();
    x.strokeStyle = '#e8384f'; x.setLineDash([h * 0.07, h * 0.07]); path(); x.stroke(); x.setLineDash([]);
  }
  function fish(x, cx, cy, s, dir, body, fin, k) {
    x.save(); x.translate(cx, cy); x.scale(dir, 1);
    const wag = Math.sin(k * 1.7) * 0.25;
    x.fillStyle = fin; x.beginPath(); x.moveTo(-s * 0.8, 0); x.lineTo(-s * 1.55, -s * (0.55 + wag)); x.lineTo(-s * 1.55, s * (0.55 - wag)); x.closePath(); x.fill();
    x.fillStyle = body; x.beginPath(); x.ellipse(0, 0, s, s * 0.58, 0, 0, TAU); x.fill();
    x.fillStyle = fin; x.beginPath(); x.moveTo(-s * 0.1, -s * 0.5); x.lineTo(s * 0.25, -s * 0.85); x.lineTo(s * 0.45, -s * 0.45); x.fill();
    disc(x, s * 0.5, -s * 0.12, s * 0.15, '#fff'); disc(x, s * 0.55, -s * 0.12, s * 0.08, '#111');
    x.restore();
  }
  function bubble(x, cx, cy, r, a = 0.8) {
    x.strokeStyle = `rgba(255,255,255,${a})`; x.lineWidth = Math.max(1, r * 0.12);
    x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.stroke();
    x.fillStyle = `rgba(255,255,255,${a * 0.15})`; x.fill();
    disc(x, cx - r * 0.35, cy - r * 0.35, r * 0.22, `rgba(255,255,255,${a})`);
  }
  function leaf(x, cx, cy, s, rot, col) {
    x.save(); x.translate(cx, cy); x.rotate(rot);
    x.fillStyle = col; x.beginPath(); x.moveTo(0, -s); x.quadraticCurveTo(s * 0.75, 0, 0, s); x.quadraticCurveTo(-s * 0.75, 0, 0, -s); x.fill();
    x.strokeStyle = 'rgba(90,40,10,.5)'; x.lineWidth = Math.max(1, s * 0.08); x.beginPath(); x.moveTo(0, -s * 0.9); x.lineTo(0, s * 1.2); x.stroke();
    x.restore();
  }
  function bigLeaf(x, bx, by, L, ang, col) {
    x.save(); x.translate(bx, by); x.rotate(ang);
    x.fillStyle = col; x.beginPath(); x.moveTo(0, 0); x.quadraticCurveTo(L * 0.5, -L * 0.32, L, 0); x.quadraticCurveTo(L * 0.5, L * 0.32, 0, 0); x.fill();
    x.strokeStyle = 'rgba(20,60,20,.6)'; x.lineWidth = Math.max(1, L * 0.012);
    x.beginPath(); x.moveTo(0, 0); x.lineTo(L * 0.95, 0);
    for (let i = 1; i < 6; i++) { const u = L * i / 6; x.moveTo(u, 0); x.lineTo(u + L * 0.08, -L * 0.14 * (1 - i / 7)); x.moveTo(u, 0); x.lineTo(u + L * 0.08, L * 0.14 * (1 - i / 7)); }
    x.stroke(); x.restore();
  }
  function butterfly(x, cx, cy, s, flap) {
    x.save(); x.translate(cx, cy);
    for (const d of [-1, 1]) {
      x.save(); x.scale(d * (0.25 + 0.75 * flap), 1);
      x.fillStyle = '#ff8ad8'; x.beginPath(); x.ellipse(s * 0.9, -s * 0.45, s * 0.9, s * 0.65, -0.4, 0, TAU); x.fill();
      x.fillStyle = '#ffd23f'; x.beginPath(); x.ellipse(s * 0.65, s * 0.45, s * 0.55, s * 0.42, 0.4, 0, TAU); x.fill();
      x.restore();
    }
    x.fillStyle = '#3a2a1a'; x.fillRect(-s * 0.09, -s * 0.8, s * 0.18, s * 1.6);
    x.restore();
  }
  function bat(x, cx, cy, s, flap) {
    x.save(); x.translate(cx, cy); x.fillStyle = '#120a1e';
    const f = flap * s * 0.5;
    x.beginPath(); x.moveTo(0, 0);
    x.quadraticCurveTo(-s * 0.5, -s * 0.6 - f, -s * 1.3, -s * 0.2 - f); x.quadraticCurveTo(-s * 0.9, s * 0.05, -s * 0.85, s * 0.3);
    x.quadraticCurveTo(-s * 0.5, 0, -s * 0.3, s * 0.3); x.quadraticCurveTo(0, s * 0.1, s * 0.3, s * 0.3);
    x.quadraticCurveTo(s * 0.5, 0, s * 0.85, s * 0.3); x.quadraticCurveTo(s * 0.9, s * 0.05, s * 1.3, -s * 0.2 - f);
    x.quadraticCurveTo(s * 0.5, -s * 0.6 - f, 0, 0); x.fill();
    disc(x, 0, -s * 0.05, s * 0.22, '#120a1e');
    x.restore();
  }
  function ptero(x, cx, cy, s, flap) {
    x.save(); x.translate(cx, cy); x.fillStyle = '#5a3a3a';
    const f = flap * s * 0.6;
    x.beginPath(); x.moveTo(-s * 1.6, -f); x.lineTo(0, s * 0.15); x.lineTo(s * 1.6, -f); x.lineTo(s * 0.3, -s * 0.15); x.lineTo(-s * 0.3, -s * 0.15); x.closePath(); x.fill();
    x.beginPath(); x.moveTo(s * 0.2, -s * 0.1); x.lineTo(s * 0.9, -s * 0.35); x.lineTo(s * 0.35, s * 0.08); x.fill();
    x.beginPath(); x.moveTo(s * 0.5, -s * 0.28); x.lineTo(s * 0.25, -s * 0.6); x.lineTo(s * 0.7, -s * 0.35); x.fill();
    x.restore();
  }
  // Buildings with windows; also returns the window spots so some can twinkle.
  const cityWindows = new Map();
  function skyline(x, W, H, base, maxH, fill, seed, lit, light, keep) {
    const r = rand(seed), spots = [];
    let px = -W * 0.02;
    while (px < W) {
      const bw = W * (0.045 + r() * 0.07), bh = maxH * (0.35 + r() * 0.65);
      x.fillStyle = fill; x.fillRect(px, base - bh, bw, bh + 2);
      if (r() < 0.3) x.fillRect(px + bw * 0.45, base - bh - maxH * 0.1, Math.max(2, bw * 0.06), maxH * 0.1);
      const ws = Math.max(2, H * 0.011), gap = ws * 1.9;
      for (let wy = base - bh + gap; wy < base - gap; wy += gap) {
        for (let wx = px + gap * 0.6; wx < px + bw - ws - gap * 0.3; wx += gap) {
          const v = r();
          if (v < lit) { x.fillStyle = light; x.fillRect(wx, wy, ws, ws * 1.2); }
          else if (keep && v > 0.985) spots.push([wx, wy, ws]);
        }
      }
      px += bw + W * 0.004;
    }
    if (keep) cityWindows.set(`${W}x${H}`, spots);
  }
  function flakes(x, W, H, k, n, sp) {
    const r = rand(77);
    x.fillStyle = '#fff';
    for (let i = 0; i < n; i++) {
      const z = 0.4 + r() * 0.6, sz = (H * 0.005 + 1) * z;
      const px = wrap(r() * W + Math.sin(k * 0.15 + i) * W * 0.015 * z, W);
      const py = wrap(r() * (H + 20) + k * H * 0.012 * z * sp, H + 20) - 10;
      x.globalAlpha = 0.55 + 0.45 * z; x.beginPath(); x.arc(px, py, sz, 0, TAU); x.fill();
    }
    x.globalAlpha = 1;
  }

  // ---------- curtains ----------
  function curtainTex(w, h) {
    return layer('curtain', w, h, (x, W, H) => {
      const folds = Math.max(5, Math.round(W / 70)), g = x.createLinearGradient(0, 0, W, 0);
      const cols = ['#5a0716', '#9e1229', '#d0263e', '#9e1229'];
      for (let i = 0; i <= folds * 4; i++) g.addColorStop(i / (folds * 4), cols[i % 4]);
      x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.fillStyle = vg(x, 0, H, [[0, 'rgba(0,0,0,.5)'], [0.22, 'rgba(0,0,0,0)'], [0.8, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.4)']]); x.fillRect(0, 0, W, H);
      const fh = Math.max(4, H * 0.035);
      x.fillStyle = vg(x, H - fh, H, [[0, '#f7d774'], [1, '#a87b0b']]); x.fillRect(0, H - fh, W, fh);
      x.fillStyle = 'rgba(120,80,0,.7)'; for (let i = 0; i < W; i += 7) x.fillRect(i, H - fh * 0.5, 2, fh * 0.5);
    });
  }
  function valance(x, W, H, y0) {
    const vh = H * 0.13;
    if (y0 + vh * 1.2 <= 0) return;
    x.save(); x.translate(0, y0);
    const n = Math.max(4, Math.round(W / 170)), sw = W / n;
    const edge = () => { for (let i = n - 1; i >= 0; i--) x.quadraticCurveTo(sw * (i + 0.5), vh * 1.18, sw * i, vh * 0.72); };
    x.fillStyle = vg(x, 0, vh, [[0, '#4a0512'], [0.55, '#ad162e'], [1, '#7a0b1f']]);
    x.beginPath(); x.moveTo(0, 0); x.lineTo(W, 0); x.lineTo(W, vh * 0.72); edge(); x.closePath(); x.fill();
    x.strokeStyle = '#e8bf4a'; x.lineWidth = Math.max(2, H * 0.008); x.beginPath(); x.moveTo(W, vh * 0.72); edge(); x.stroke();
    for (let i = 1; i < n; i++) { const tx = sw * i; x.fillStyle = '#e8bf4a'; x.fillRect(tx - H * 0.003, vh * 0.72, H * 0.006, vh * 0.28); disc(x, tx, vh * 1.02, H * 0.013, '#d9a92c'); }
    x.restore();
  }
  // open: 0 = closed, 1 = fully open (each side gathers up at its edge).
  function drawCurtains(x, W, H, open) {
    const p = ease(open), half = Math.ceil(W / 2), tex = curtainTex(half, H);
    const w = half * (1 - 0.88 * p) + 1;
    if (p < 0.999) {
      x.drawImage(tex, 0, 0, tex.width, tex.height, 0, 0, w, H);
      x.save(); x.translate(W, 0); x.scale(-1, 1); x.drawImage(tex, 0, 0, tex.width, tex.height, 0, 0, w, H); x.restore();
      const sh = Math.max(4, W * 0.02);
      x.fillStyle = lin(x, w - sh, 0, w, 0, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.35)']]); x.fillRect(w - sh, 0, sh, H);
      x.fillStyle = lin(x, W - w, 0, W - w + sh, 0, [[0, 'rgba(0,0,0,.35)'], [1, 'rgba(0,0,0,0)']]); x.fillRect(W - w, 0, sh, H);
    }
    valance(x, W, H, -p * H * 0.17);
  }

  // ---------- magic backgrounds (behind the toys) ----------
  const BG = {
    sky: { name: 'Blue sky',
      paint(x, W, H) {
        x.fillStyle = vg(x, 0, H, [[0, '#2b86ec'], [0.6, '#8ccdfc'], [1, '#d9f2ff']]); x.fillRect(0, 0, W, H);
        glow(x, W * 0.83, H * 0.17, H * 0.34, [255, 244, 190], 0.85);
        disc(x, W * 0.83, H * 0.17, H * 0.075, '#fff4c2');
        hills(x, W, H, H * 0.84, H * 0.045, '#9ad57e', 11);
        hills(x, W, H, H * 0.92, H * 0.035, '#62b85c', 12);
      },
      anim(x, W, H, k) {
        const r = rand(5);
        for (let i = 0; i < 6; i++) {
          const s = H * (0.045 + r() * 0.045), span = W + 7 * s, sp = 0.002 + r() * 0.002, y = H * (0.1 + r() * 0.42);
          cloud(x, wrap(r() * span + k * W * sp, span) - 3.5 * s, y, s);
        }
      } },
    sunset: { name: 'Sunset',
      paint(x, W, H) {
        x.fillStyle = vg(x, 0, H, [[0, '#2b1559'], [0.35, '#8a2f78'], [0.6, '#f2675c'], [0.78, '#ffad5a'], [1, '#ffd88a']]); x.fillRect(0, 0, W, H);
        glow(x, W * 0.5, H * 0.72, H * 0.6, [255, 196, 110], 0.85);
        disc(x, W * 0.5, H * 0.72, H * 0.14, '#ffe7a0');
        x.fillStyle = 'rgba(255,150,90,.6)'; for (let i = 0; i < 4; i++) x.fillRect(W * 0.5 - H * 0.16, H * (0.7 + i * 0.028), H * 0.32, H * 0.008);
        hills(x, W, H, H * 0.79, H * 0.05, '#4c1d4f', 21);
        hills(x, W, H, H * 0.9, H * 0.035, '#2c0f33', 22);
        palm(x, W * 0.13, H * 0.93, H * 0.45, '#1c0a22'); palm(x, W * 0.86, H * 0.95, H * 0.36, '#1c0a22');
      },
      anim(x, W, H, k) {
        x.strokeStyle = '#2a1036'; x.lineWidth = Math.max(1.5, H * 0.004); x.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
          const s = H * (0.018 + hash(i * 5) * 0.012), span = W * 1.3;
          const bx = wrap(hash(i * 3) * span + k * W * 0.006, span) - W * 0.15, by = H * (0.18 + hash(i * 9) * 0.25) + Math.sin(k * 0.5 + i) * H * 0.01;
          const f = Math.sin(k * 1.6 + i * 2) * 0.6;
          x.beginPath(); x.moveTo(bx - s, by - s * f); x.quadraticCurveTo(bx - s * 0.4, by - s * 0.2, bx, by); x.quadraticCurveTo(bx + s * 0.4, by - s * 0.2, bx + s, by - s * f); x.stroke();
        }
      } },
    space: { name: 'Outer space',
      paint(x, W, H) {
        x.fillStyle = '#05041a'; x.fillRect(0, 0, W, H);
        glow(x, W * 0.25, H * 0.3, H * 0.7, [90, 40, 160], 0.45);
        glow(x, W * 0.8, H * 0.65, H * 0.6, [20, 80, 170], 0.4);
        const r = rand(9);
        for (let i = 0; i < 260; i++) disc(x, r() * W, r() * H, (0.4 + r() * 1.1) * H / 720, `rgba(255,255,255,${0.25 + r() * 0.6})`);
        const px = W * 0.76, py = H * 0.28, pr = H * 0.13;
        x.save(); x.translate(px, py); x.rotate(-0.35);
        x.strokeStyle = 'rgba(240,210,150,.85)'; x.lineWidth = H * 0.018; x.beginPath(); x.ellipse(0, 0, pr * 1.9, pr * 0.45, 0, Math.PI, TAU); x.stroke();
        x.fillStyle = lin(x, -pr, -pr, pr, pr, [[0, '#ffd59a'], [0.5, '#e88a4a'], [1, '#8a3d2a']]); x.beginPath(); x.arc(0, 0, pr, 0, TAU); x.fill();
        x.strokeStyle = 'rgba(255,230,180,.9)'; x.beginPath(); x.ellipse(0, 0, pr * 1.9, pr * 0.45, 0, 0, Math.PI); x.stroke();
        x.restore();
        disc(x, W * 0.15, H * 0.18, H * 0.04, '#cfd8e8'); disc(x, W * 0.142, H * 0.172, H * 0.012, '#aab4c6');
        x.fillStyle = vg(x, H * 0.78, H, [[0, '#9aa0ad'], [1, '#5d6270']]);
        x.beginPath(); x.moveTo(0, H);
        for (let i = 0; i <= 50; i++) { const u = i / 50; x.lineTo(u * W, H * (0.84 + 0.03 * Math.sin(u * 7 + 2) + 0.012 * Math.sin(u * 31))); }
        x.lineTo(W, H); x.fill();
        for (let i = 0; i < 9; i++) { const cx = r() * W, cy = H * (0.9 + r() * 0.08), cr = H * (0.01 + r() * 0.025); x.fillStyle = 'rgba(60,64,76,.55)'; x.beginPath(); x.ellipse(cx, cy, cr * 2, cr * 0.6, 0, 0, TAU); x.fill(); }
      },
      anim(x, W, H, k) {
        for (let i = 0; i < 40; i++) {
          const tw = Math.abs(Math.sin(k * 0.55 + i * 1.7));
          x.fillStyle = `rgba(255,255,240,${0.35 + 0.65 * tw})`;
          star4(x, hash(i * 7 + 1) * W, hash(i * 13 + 2) * H * 0.78, H * 0.007 * (0.5 + tw));
        }
        const p = wrap(k, 30) / 6;
        if (p < 1) {
          const sx = W * (0.1 + p * 0.5), sy = H * (0.08 + p * 0.25);
          x.strokeStyle = lin(x, sx - W * 0.12, sy - H * 0.06, sx, sy, [[0, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,.95)']]);
          x.lineWidth = H * 0.004; x.beginPath(); x.moveTo(sx - W * 0.12, sy - H * 0.06); x.lineTo(sx, sy); x.stroke();
        }
      } },
    sea: { name: 'Under the sea',
      paint(x, W, H) {
        x.fillStyle = vg(x, 0, H, [[0, '#5fd3e0'], [0.45, '#1f93b8'], [1, '#0b4a75']]); x.fillRect(0, 0, W, H);
        x.fillStyle = vg(x, H * 0.8, H, [[0, '#f0dca0'], [1, '#c9a865']]);
        x.beginPath(); x.moveTo(0, H);
        for (let i = 0; i <= 40; i++) { const u = i / 40; x.lineTo(u * W, H * (0.85 + 0.025 * Math.sin(u * 9 + 1) + 0.012 * Math.sin(u * 23))); }
        x.lineTo(W, H); x.fill();
        const r = rand(8);
        for (let i = 0; i < 6; i++) { x.fillStyle = ['#5c6b7a', '#6f7f8e', '#4f5d6b'][i % 3]; x.beginPath(); x.ellipse(r() * W, H * (0.88 + r() * 0.05), W * (0.03 + r() * 0.04), H * (0.03 + r() * 0.03), 0, Math.PI, 0); x.fill(); }
        x.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          const bx = W * (0.15 + i * 0.33 + r() * 0.1), by = H * 0.9, col = ['#ff7aa8', '#ff9f5a', '#c77dff'][i];
          x.strokeStyle = col; x.lineWidth = H * 0.016;
          for (let j = 0; j < 5; j++) { const a = -Math.PI / 2 + (j - 2) * 0.35; x.beginPath(); x.moveTo(bx, by); x.lineTo(bx + Math.cos(a) * H * 0.1, by + Math.sin(a) * H * 0.1); x.lineTo(bx + Math.cos(a) * H * 0.16 + (j - 2) * H * 0.01, by + Math.sin(a) * H * 0.15); x.stroke(); }
        }
      },
      anim(x, W, H, k) {
        x.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 5; i++) {
          const cx = W * (0.12 + i * 0.19) + Math.sin(k * 0.12 + i) * W * 0.03;
          x.fillStyle = `rgba(255,255,255,${0.04 + 0.02 * Math.sin(k * 0.3 + i)})`;
          x.beginPath(); x.moveTo(cx - W * 0.03, 0); x.lineTo(cx + W * 0.03, 0); x.lineTo(cx + W * 0.13, H); x.lineTo(cx - W * 0.01, H); x.fill();
        }
        x.globalCompositeOperation = 'source-over';
        x.lineCap = 'round';
        for (let i = 0; i < 7; i++) {
          const bx = W * (0.05 + i * 0.15 + hash(i * 3) * 0.05), h = H * (0.25 + hash(i * 5) * 0.2), sw = Math.sin(k * 0.25 + i) * W * 0.02;
          x.strokeStyle = i % 2 ? '#2f9e5b' : '#227a46'; x.lineWidth = W * 0.011;
          x.beginPath(); x.moveTo(bx, H * 0.92); x.bezierCurveTo(bx + sw, H * 0.92 - h * 0.35, bx - sw, H * 0.92 - h * 0.7, bx + sw * 1.5, H * 0.92 - h); x.stroke();
        }
        for (let i = 0; i < 3; i++) {
          const dir = i % 2 ? -1 : 1, span = W * 1.3, s = H * (0.035 + i * 0.008);
          const px = wrap(hash(i * 11) * span + dir * k * W * 0.012, span) - W * 0.15;
          fish(x, px, H * (0.3 + i * 0.16) + Math.sin(k * 0.3 + i) * H * 0.02, s, dir, ['#ff8a3d', '#ffd23f', '#ff6b9a'][i], ['#e0601b', '#e6a800', '#d9467a'][i], k + i);
        }
        for (let i = 0; i < 18; i++) {
          const rr = H * (0.006 + hash(i * 7) * 0.012), px = W * hash(i * 13) + Math.sin(k * 0.4 + i) * W * 0.008;
          bubble(x, px, wrap(H * hash(i * 17) - k * H * 0.02 * (0.6 + hash(i)), H * 1.1), rr, 0.6);
        }
      } },
    stage: { name: 'Stage',
      paint(x, W, H) {
        x.fillStyle = '#140507'; x.fillRect(0, 0, W, H);
        const ch = H * 0.7;
        x.drawImage(curtainTex(W, Math.round(ch)), 0, 0, W, ch);
        x.fillStyle = 'rgba(10,0,4,.5)'; x.fillRect(0, 0, W, ch);
        const fy = H * 0.66;
        x.fillStyle = vg(x, fy, H, [[0, '#7a4524'], [1, '#3b1f0e']]); x.fillRect(0, fy, W, H - fy);
        x.strokeStyle = 'rgba(40,18,6,.55)'; x.lineWidth = Math.max(1, H * 0.003);
        for (let i = -12; i <= 12; i++) { x.beginPath(); x.moveTo(W / 2 + i * W * 0.03, fy); x.lineTo(W / 2 + i * W * 0.11, H); x.stroke(); }
        for (let j = 1; j < 6; j++) { const y = fy + (H - fy) * Math.pow(j / 6, 1.6); x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); }
        x.fillStyle = '#2a0f06'; x.fillRect(0, fy - H * 0.012, W, H * 0.02);
        x.globalCompositeOperation = 'lighter';
        x.fillStyle = vg(x, 0, H, [[0, 'rgba(255,240,200,.02)'], [1, 'rgba(255,240,200,.16)']]);
        x.beginPath(); x.moveTo(W * 0.46, 0); x.lineTo(W * 0.54, 0); x.lineTo(W * 0.72, H * 0.86); x.lineTo(W * 0.28, H * 0.86); x.closePath(); x.fill();
        x.globalCompositeOperation = 'source-over';
        x.save(); x.translate(W / 2, H * 0.84); x.scale(1, 0.22); glow(x, 0, 0, W * 0.26, [255, 230, 180], 0.55); x.restore();
        for (let i = 0; i < 9; i++) glow(x, W * (0.06 + i * 0.11), H * 0.985, H * 0.06, [255, 200, 120], 0.6);
      } },
    jungle: { name: 'Jungle',
      paint(x, W, H) {
        x.fillStyle = vg(x, 0, H, [[0, '#d8efb0'], [0.5, '#a8d98a'], [1, '#6fae55']]); x.fillRect(0, 0, W, H);
        glow(x, W * 0.7, H * 0.12, H * 0.4, [255, 250, 210], 0.7);
        const r = rand(31);
        const tree = (bx, by, s, trunk, leafCol) => {
          x.fillStyle = trunk; x.fillRect(bx - s * 0.06, by - s * 0.7, s * 0.12, s * 0.72);
          for (let i = 0; i < 6; i++) disc(x, bx + (r() - 0.5) * s * 0.7, by - s * (0.75 + r() * 0.35), s * (0.22 + r() * 0.15), leafCol);
        };
        for (let i = 0; i < 9; i++) tree(r() * W, H * 0.62, H * (0.35 + r() * 0.2), '#6d8a52', '#7fb865');
        hills(x, W, H, H * 0.7, H * 0.03, '#5d9a45', 33);
        for (let i = 0; i < 7; i++) tree(r() * W, H * 0.8, H * (0.45 + r() * 0.25), '#5a3d22', i % 2 ? '#3f8a3a' : '#2f7a34');
        hills(x, W, H, H * 0.88, H * 0.025, '#3f7a2c', 34);
        x.fillStyle = '#356b25'; x.fillRect(0, H * 0.92, W, H * 0.08);
        x.strokeStyle = '#3d7a32'; x.lineWidth = Math.max(2, H * 0.006);
        for (let i = 0; i < 6; i++) { const vx = r() * W, L = H * (0.15 + r() * 0.25); x.beginPath(); x.moveTo(vx, 0); x.quadraticCurveTo(vx + W * 0.02, L * 0.5, vx - W * 0.01, L); x.stroke(); disc(x, vx - W * 0.01, L, H * 0.012, '#4f9a40'); }
      },
      anim(x, W, H, k) {
        for (let side = 0; side < 2; side++) for (let i = 0; i < 3; i++) {
          const bx = side ? W * 1.02 : -W * 0.02, by = H * (0.22 + i * 0.3);
          const a = (side ? Math.PI : 0) + (side ? -1 : 1) * (i - 1) * 0.35 + Math.sin(k * 0.2 + i + side) * 0.06;
          bigLeaf(x, bx, by, H * 0.32, a, i % 2 ? '#2e7d32' : '#388e3c');
        }
        butterfly(x, W * (0.5 + 0.3 * Math.sin(k * 0.13)), H * (0.35 + 0.12 * Math.sin(k * 0.29)), H * 0.028, Math.abs(Math.sin(k * 1.3)));
      } },
    snow: { name: 'Snowy hills',
      paint(x, W, H) {
        x.fillStyle = vg(x, 0, H, [[0, '#8fb8e6'], [0.6, '#cfe2f6'], [1, '#eef5fc']]); x.fillRect(0, 0, W, H);
        const mtn = (cx, base, w, h, c1) => {
          x.fillStyle = c1; x.beginPath(); x.moveTo(cx - w, base); x.lineTo(cx, base - h); x.lineTo(cx + w, base); x.fill();
          x.fillStyle = '#f7faff'; x.beginPath(); x.moveTo(cx - w * 0.3, base - h * 0.7); x.lineTo(cx, base - h); x.lineTo(cx + w * 0.3, base - h * 0.7);
          x.lineTo(cx + w * 0.12, base - h * 0.62); x.lineTo(cx, base - h * 0.72); x.lineTo(cx - w * 0.14, base - h * 0.6); x.fill();
        };
        mtn(W * 0.22, H * 0.66, W * 0.25, H * 0.38, '#7d97c0'); mtn(W * 0.62, H * 0.66, W * 0.3, H * 0.46, '#6f8bb6'); mtn(W * 0.95, H * 0.66, W * 0.22, H * 0.3, '#86a0c8');
        hills(x, W, H, H * 0.72, H * 0.04, '#e3edf8', 41); hills(x, W, H, H * 0.84, H * 0.035, '#f7fbff', 42);
        const r = rand(43);
        for (let i = 0; i < 8; i++) pine(x, r() * W * 0.75, H * (0.74 + r() * 0.12), H * (0.16 + r() * 0.12), '#2f5d4a', '#f4f8ff');
        snowman(x, W * 0.86, H * 0.95, H * 0.42);
      },
      anim(x, W, H, k) { flakes(x, W, H, k, 70, 0.6); } },
    candy: { name: 'Candy land',
      paint(x, W, H) {
        x.fillStyle = vg(x, 0, H, [[0, '#ffc6e8'], [0.5, '#e2c8ff'], [1, '#c4f5ea']]); x.fillRect(0, 0, W, H);
        const cols = ['#ff5f6d', '#ffa64d', '#ffe14d', '#6ee07a', '#4dc3ff', '#7d6bff', '#c86bff'];
        x.lineWidth = H * 0.03; x.globalAlpha = 0.75;
        cols.forEach((c, i) => { x.strokeStyle = c; x.beginPath(); x.arc(W * 0.5, H * 0.95, H * (0.78 - i * 0.03), Math.PI, TAU); x.stroke(); });
        x.globalAlpha = 1;
        cloud(x, W * 0.2, H * 0.62, H * 0.07, '#fff', 'rgba(255,190,230,.6)'); cloud(x, W * 0.8, H * 0.6, H * 0.08, '#fff', 'rgba(255,190,230,.6)');
        hills(x, W, H, H * 0.8, H * 0.04, '#ff9fd2', 51); hills(x, W, H, H * 0.9, H * 0.03, '#9eeed2', 52);
        const r = rand(53);
        for (let i = 0; i < 160; i++) {
          x.fillStyle = cols[i % 7]; x.save(); x.translate(r() * W, H * (0.86 + r() * 0.14)); x.rotate(r() * 3);
          x.fillRect(-H * 0.006, -H * 0.002, H * 0.012, H * 0.004); x.restore();
        }
        lollipop(x, W * 0.1, H * 0.86, H * 0.3, '#ff5f9e'); lollipop(x, W * 0.9, H * 0.88, H * 0.26, '#4dc3ff'); lollipop(x, W * 0.72, H * 0.84, H * 0.18, '#ffb84d');
        cane(x, W * 0.26, H * 0.9, H * 0.22);
      },
      anim(x, W, H, k) {
        for (let i = 0; i < 20; i++) {
          const tw = Math.abs(Math.sin(k * 0.6 + i * 2.1));
          x.fillStyle = `rgba(255,255,255,${0.3 + 0.7 * tw})`;
          star4(x, hash(i * 3 + 5) * W, hash(i * 11 + 7) * H * 0.7, H * 0.014 * (0.4 + tw));
        }
      } },
    city: { name: 'Night city',
      paint(x, W, H) {
        x.fillStyle = vg(x, 0, H, [[0, '#060a24'], [0.6, '#1b2459'], [1, '#3b3a7a']]); x.fillRect(0, 0, W, H);
        const r = rand(61);
        for (let i = 0; i < 140; i++) disc(x, r() * W, r() * H * 0.55, (0.4 + r()) * H / 720, `rgba(255,255,255,${0.3 + r() * 0.5})`);
        glow(x, W * 0.8, H * 0.18, H * 0.25, [255, 250, 220], 0.4); disc(x, W * 0.8, H * 0.18, H * 0.07, '#fdf6d8');
        disc(x, W * 0.78, H * 0.16, H * 0.014, '#e8dfbf'); disc(x, W * 0.82, H * 0.2, H * 0.01, '#e8dfbf');
        skyline(x, W, H, H * 0.86, H * 0.42, '#1a1f4a', 62, 0.18, '#ffe7a0', false);
        skyline(x, W, H, H * 0.92, H * 0.5, '#0b0e2a', 63, 0.32, '#ffd76a', true);
        x.fillStyle = '#07070f'; x.fillRect(0, H * 0.92, W, H * 0.08);
        x.fillStyle = '#e8c45a'; for (let i = 0; i < 12; i++) x.fillRect(i * W / 12 + W * 0.02, H * 0.958, W * 0.04, H * 0.006);
      },
      anim(x, W, H, k) {
        const spots = cityWindows.get(`${W}x${H}`) || [];
        x.fillStyle = '#ffd76a';
        spots.forEach(([wx, wy, ws], i) => { if (hash(i * 31 + Math.floor(k / 3)) < 0.5) x.fillRect(wx, wy, ws, ws * 1.2); });
        const span = W * 1.4, cx = wrap(k * W * 0.03, span) - W * 0.2, cy = H * 0.945;
        glow(x, cx + H * 0.07, cy, H * 0.06, [255, 240, 190], 0.8);
        x.fillStyle = '#c0392b'; x.fillRect(cx - H * 0.06, cy - H * 0.022, H * 0.12, H * 0.025); x.fillRect(cx - H * 0.03, cy - H * 0.042, H * 0.06, H * 0.022);
        disc(x, cx - H * 0.035, cy + H * 0.004, H * 0.01, '#111'); disc(x, cx + H * 0.035, cy + H * 0.004, H * 0.01, '#111');
      } },
    dino: { name: 'Dino land',
      paint(x, W, H) {
        x.fillStyle = vg(x, 0, H, [[0, '#ffcf7d'], [0.55, '#ff9b6a'], [1, '#e0745a']]); x.fillRect(0, 0, W, H);
        const vx = W * 0.62, vb = H * 0.74, vw = W * 0.3, vh = H * 0.5;
        x.fillStyle = lin(x, vx - vw, 0, vx + vw, 0, [[0, '#6b4430'], [0.5, '#4f3022'], [1, '#3a2218']]);
        x.beginPath(); x.moveTo(vx - vw, vb); x.lineTo(vx - vw * 0.14, vb - vh); x.lineTo(vx + vw * 0.14, vb - vh); x.lineTo(vx + vw, vb); x.closePath(); x.fill();
        x.strokeStyle = '#ff7a1a'; x.lineWidth = H * 0.012; x.lineCap = 'round';
        for (const d of [-0.08, 0.03, 0.1]) { x.beginPath(); x.moveTo(vx + d * vw, vb - vh); x.quadraticCurveTo(vx + d * vw * 2.2, vb - vh * 0.6, vx + d * vw * 3.2 + vw * 0.02, vb - vh * 0.25); x.stroke(); }
        glow(x, vx, vb - vh, H * 0.12, [255, 140, 40], 0.9);
        hills(x, W, H, H * 0.8, H * 0.04, '#7a9a3a', 71); hills(x, W, H, H * 0.9, H * 0.03, '#5a7f2a', 72);
        palm(x, W * 0.12, H * 0.92, H * 0.42, '#3d5a1f'); palm(x, W * 0.3, H * 0.95, H * 0.3, '#466a22');
        const r = rand(73);
        for (let i = 0; i < 5; i++) { x.fillStyle = ['#8a7a6a', '#6f6255'][i % 2]; x.beginPath(); x.ellipse(W * (0.45 + r() * 0.5), H * (0.9 + r() * 0.06), W * (0.03 + r() * 0.03), H * (0.025 + r() * 0.02), 0, Math.PI, 0); x.fill(); }
      },
      anim(x, W, H, k) {
        const vx = W * 0.62, top = H * 0.24;
        for (let i = 0; i < 6; i++) {
          const p = wrap(k * 0.06 + i / 6, 1);
          disc(x, vx + Math.sin(i * 2 + p * 3) * W * 0.03 + p * W * 0.06, top - p * H * 0.3, H * (0.03 + p * 0.07), `rgba(110,100,100,${0.5 * (1 - p)})`);
        }
        glow(x, vx, top, H * 0.08, [255, 170, 60], 0.4 + 0.3 * Math.abs(Math.sin(k * 0.7)));
        const span = W * 1.4, px = wrap(k * W * 0.012 + W * 0.3, span) - W * 0.2;
        ptero(x, px, H * (0.15 + 0.04 * Math.sin(k * 0.3)), H * 0.05, Math.sin(k * 1.4));
      } },
    photo: { name: 'My picture' },
  };
  function drawBg(x, W, H, id, k, photo) {
    const b = BG[id];
    if (!b) return;
    if (id === 'photo') {
      x.fillStyle = '#2a2440'; x.fillRect(0, 0, W, H);
      if (photo) cover(x, photo, W, H);
      return;
    }
    x.drawImage(layer('bg-' + id, W, H, b.paint), 0, 0, W, H);
    if (b.anim) { x.save(); b.anim(x, W, H, k); x.restore(); }
  }

  // ---------- front effects (in front of everything) ----------
  const FX = {
    rain: { name: 'Rain', draw(x, W, H, k) {
      x.fillStyle = 'rgba(30,45,80,.12)'; x.fillRect(0, 0, W, H);
      const r = rand(31); x.strokeStyle = 'rgba(205,225,255,.6)'; x.lineCap = 'round';
      for (let i = 0; i < 150; i++) {
        const z = 0.35 + r() * 0.65, L = H * 0.06 * z, sp = H * 0.11 * z;
        const px = wrap(r() * W * 1.2 - k * sp * 0.18, W * 1.2) - W * 0.1, py = wrap(r() * H * 1.3 + k * sp, H * 1.3) - H * 0.15;
        x.lineWidth = Math.max(1, H * 0.0025 * z);
        x.beginPath(); x.moveTo(px, py); x.lineTo(px - L * 0.18, py + L); x.stroke();
      }
    } },
    snow: { name: 'Snow', draw(x, W, H, k) { flakes(x, W, H, k, 120, 1); } },
    bubbles: { name: 'Bubbles', draw(x, W, H, k) {
      for (let i = 0; i < 28; i++) {
        const rr = H * (0.012 + hash(i * 7 + 1) * 0.03), sp = H * (0.012 + hash(i * 3) * 0.014);
        const px = W * hash(i * 13 + 4) + Math.sin(k * 0.35 + i) * W * 0.02, py = wrap(H * hash(i * 5 + 9) - k * sp, H * 1.15) - H * 0.05;
        bubble(x, px, py, rr, 0.75);
      }
    } },
    sparkles: { name: 'Sparkles', draw(x, W, H, k) {
      for (let i = 0; i < 36; i++) {
        const tw = Math.abs(Math.sin(k * 0.7 + i * 1.93)), s = H * 0.02 * (0.25 + tw);
        const px = hash(i * 7 + 3) * W, py = hash(i * 11 + 5) * H;
        glow(x, px, py, s * 2.2, [255, 240, 170], 0.35 * tw);
        x.fillStyle = `rgba(255,255,230,${0.4 + 0.6 * tw})`; star4(x, px, py, s);
      }
    } },
    confetti: { name: 'Confetti', draw(x, W, H, k) {
      const cols = ['#ff5f6d', '#ffd23f', '#2ee6b6', '#5cc8ff', '#c86bff', '#ff9f43'];
      for (let i = 0; i < 120; i++) {
        const sp = H * (0.01 + hash(i * 3) * 0.014), px = wrap(W * hash(i * 7) + Math.sin(k * 0.3 + i) * W * 0.03, W);
        const py = wrap(H * hash(i * 11) + k * sp, H * 1.1) - H * 0.05, s = H * 0.012;
        x.save(); x.translate(px, py); x.rotate(k * 0.4 + i); x.scale(1, Math.abs(Math.cos(k * 0.5 + i)) + 0.2);
        x.fillStyle = cols[i % cols.length]; x.fillRect(-s, -s * 0.5, s * 2, s); x.restore();
      }
    } },
    hearts: { name: 'Hearts', draw(x, W, H, k) {
      for (let i = 0; i < 22; i++) {
        const s = H * (0.018 + hash(i * 5) * 0.022), sp = H * (0.008 + hash(i * 9) * 0.01);
        const px = W * hash(i * 13 + 2) + Math.sin(k * 0.3 + i) * W * 0.025, py = wrap(H * hash(i * 17 + 1) - k * sp, H * 1.15) - H * 0.05;
        x.globalAlpha = 0.85; x.fillStyle = ['#ff5f8f', '#ff8fb8', '#e8385f'][i % 3]; heartPath(x, px, py, s); x.fill();
      }
      x.globalAlpha = 1;
    } },
    leaves: { name: 'Falling leaves', draw(x, W, H, k) {
      for (let i = 0; i < 26; i++) {
        const s = H * (0.014 + hash(i * 5 + 1) * 0.014), sp = H * (0.008 + hash(i * 3 + 2) * 0.01);
        const px = wrap(W * hash(i * 7 + 3) + Math.sin(k * 0.25 + i) * W * 0.05, W), py = wrap(H * hash(i * 11 + 4) + k * sp, H * 1.1) - H * 0.05;
        leaf(x, px, py, s, Math.sin(k * 0.3 + i) * 1.2 + i, ['#ff8c1a', '#e8501f', '#ffc21a', '#b8481a'][i % 4]);
      }
    } },
    clouds: { name: 'Clouds', draw(x, W, H, k) {
      const r = rand(15);
      for (let i = 0; i < 4; i++) {
        const s = H * (0.06 + r() * 0.04), span = W + 8 * s;
        x.globalAlpha = 0.92; cloud(x, wrap(r() * span + k * W * (0.002 + r() * 0.002), span) - 4 * s, H * (0.08 + r() * 0.2), s, '#fff', 'rgba(190,205,225,.6)');
      }
      x.globalAlpha = 1;
    } },
    fog: { name: 'Fog', draw(x, W, H, k) {
      for (let i = 0; i < 8; i++) {
        const span = W * 1.6, px = wrap(hash(i * 3) * span + k * W * 0.004 * (1 + hash(i)), span) - W * 0.3;
        x.save(); x.translate(px, H * (0.65 + hash(i * 7) * 0.35)); x.scale(1, 0.45); glow(x, 0, 0, W * 0.3, [235, 238, 245], 0.38); x.restore();
      }
    } },
    fireflies: { name: 'Fireflies', draw(x, W, H, k) {
      x.fillStyle = 'rgba(10,20,40,.22)'; x.fillRect(0, 0, W, H);
      for (let i = 0; i < 28; i++) {
        const px = W * (hash(i * 5) + 0.05 * Math.sin(k * 0.21 * (1 + hash(i)) + i)), py = H * (0.2 + 0.7 * hash(i * 9) + 0.04 * Math.cos(k * 0.17 + i * 2));
        const a = 0.25 + 0.75 * Math.abs(Math.sin(k * 0.45 + i * 1.3));
        glow(x, px, py, H * 0.03, [210, 255, 120], 0.55 * a); disc(x, px, py, H * 0.004, `rgba(240,255,190,${a})`);
      }
    } },
    stage: { name: 'Stage curtains', draw(x, W, H) {
      const tex = curtainTex(Math.ceil(W / 2), H), sw = W * 0.12;
      x.drawImage(tex, 0, 0, tex.width, tex.height, 0, 0, sw, H);
      x.save(); x.translate(W, 0); x.scale(-1, 1); x.drawImage(tex, 0, 0, tex.width, tex.height, 0, 0, sw, H); x.restore();
      valance(x, W, H, 0);
      x.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 7; i++) glow(x, W * (0.14 + i * 0.12), H * 1.02, H * 0.1, [255, 190, 110], 0.3);
      x.globalCompositeOperation = 'source-over';
    } },
  };
  function drawEffect(x, W, H, id, k) { const f = FX[id]; if (f) { x.save(); f.draw(x, W, H, k); x.restore(); } }

  // ---------- color looks (a quick per-pixel pass, then a few overlays) ----------
  const SEPIA = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];
  const GRAY = [0.3, 0.59, 0.11, 0.3, 0.59, 0.11, 0.3, 0.59, 0.11];
  const LOOKS = {
    warm: { name: 'Sunny', mat: [1.08, 0.04, 0, 0.02, 1.02, 0, 0, 0, 0.86], sat: 1.12, con: 1.05, bri: 0.03 },
    night: { name: 'Night', mat: [0.5, 0.06, 0.06, 0.05, 0.6, 0.1, 0.1, 0.14, 0.95], sat: 0.7, con: 1.08, bri: -0.08, gam: 1.3, vig: 0.6 },
    golden: { name: 'Golden', mat: [1.12, 0.06, 0, 0.02, 0.98, 0, 0, 0, 0.78], sat: 1.15, con: 1.06, tint: ['rgba(255,170,60,.38)', 'rgba(180,60,130,.28)'], vig: 0.3 },
    old: { name: 'Old movie', mat: SEPIA, con: 1.15, bri: 0.02, vig: 0.65, grain: 0.4, flicker: 0.08, scratches: true },
    bw: { name: 'Black & white', mat: GRAY, con: 1.25, vig: 0.25, grain: 0.12 },
    dreamy: { name: 'Dreamy', mat: [1.02, 0.03, 0.06, 0.02, 1, 0.05, 0.05, 0.03, 1.05], sat: 0.85, con: 0.86, bri: 0.07, bloom: 0.5 },
    spooky: { name: 'Spooky', mat: [0.62, 0.25, 0.05, 0.1, 0.92, 0.1, 0.1, 0.3, 0.62], sat: 0.55, con: 1.2, bri: -0.1, vig: 0.75, flicker: 0.05 },
    comic: { name: 'Comic', sat: 1.75, con: 1.25, poster: 6 },
  };
  function satMat(s) {
    const r = 0.299 * (1 - s), g = 0.587 * (1 - s), b = 0.114 * (1 - s);
    return [r + s, g, b, r, g + s, b, r, g, b + s];
  }
  function mul3(a, b) {
    const o = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    return o;
  }
  const lookCache = new Map();
  function lookPass(id, amt) {
    const key = `${id}:${amt.toFixed(2)}`;
    if (lookCache.has(key)) return lookCache.get(key);
    const L = LOOKS[id];
    let m = L.mat ? L.mat.slice() : [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (L.sat != null && L.sat !== 1) m = mul3(m, satMat(L.sat));
    const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const mi = new Int32Array(9);
    for (let i = 0; i < 9; i++) mi[i] = Math.round((I[i] + (m[i] - I[i]) * amt) * 1024);
    const con = 1 + ((L.con || 1) - 1) * amt, bri = (L.bri || 0) * amt, gam = 1 + ((L.gam || 1) - 1) * amt, P = L.poster && amt > 0.25 ? L.poster : 0;
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      let v = (i / 255 - 0.5) * con + 0.5 + bri;
      v = Math.pow(clamp(v, 0, 1), gam);
      if (P) v = v * (1 - amt) + (Math.round(v * (P - 1)) / (P - 1)) * amt;
      lut[i] = Math.round(v * 255);
    }
    const out = { m: mi, lut, ident: !L.mat && (L.sat == null || L.sat === 1) };
    lookCache.set(key, out);
    return out;
  }
  let noiseTile = null, scratch = null;
  function noise() {
    if (!noiseTile) {
      noiseTile = mk(256, 256);
      const x = noiseTile.getContext('2d'), img = x.createImageData(256, 256), d = img.data, r = rand(99);
      for (let i = 0; i < d.length; i += 4) { const v = 70 + r() * 116; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      x.putImageData(img, 0, 0);
    }
    return noiseTile;
  }
  function vignette(x, W, H, a) {
    const g = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.55);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${a})`);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
  }
  function applyLook(x, W, H, id, amt, k) {
    const L = LOOKS[id];
    if (!L || amt <= 0.01) return;
    reset(x);
    const P = lookPass(id, amt);
    const img = x.getImageData(0, 0, W, H), d = img.data, m = P.m, lut = P.lut;
    const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = m;
    for (let p = 0; p < d.length; p += 4) {
      const r = d[p], g = d[p + 1], b = d[p + 2];
      let R = (m0 * r + m1 * g + m2 * b) >> 10, G = (m3 * r + m4 * g + m5 * b) >> 10, B = (m6 * r + m7 * g + m8 * b) >> 10;
      d[p] = lut[R < 0 ? 0 : R > 255 ? 255 : R]; d[p + 1] = lut[G < 0 ? 0 : G > 255 ? 255 : G]; d[p + 2] = lut[B < 0 ? 0 : B > 255 ? 255 : B];
    }
    x.putImageData(img, 0, 0);
    if (L.tint) {
      x.globalCompositeOperation = 'soft-light'; x.globalAlpha = amt;
      x.fillStyle = vg(x, 0, H, [[0, L.tint[0]], [1, L.tint[1]]]); x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
    }
    if (L.bloom) {
      const sw = Math.max(8, Math.round(W / 10)), sh = Math.max(8, Math.round(H / 10));
      if (!scratch) scratch = mk(sw, sh);
      if (scratch.width !== sw || scratch.height !== sh) { scratch.width = sw; scratch.height = sh; }
      const s = scratch.getContext('2d'); s.imageSmoothingQuality = 'high'; s.drawImage(x.canvas, 0, 0, sw, sh);
      x.globalCompositeOperation = 'screen'; x.globalAlpha = L.bloom * amt; x.imageSmoothingQuality = 'high'; x.drawImage(scratch, 0, 0, W, H);
      x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
    }
    if (L.flicker) {
      const f = (hash(k * 13 + 1) - 0.5) * 2 * L.flicker * amt;
      x.fillStyle = f > 0 ? `rgba(255,248,230,${f})` : `rgba(0,0,0,${-f})`; x.fillRect(0, 0, W, H);
    }
    if (L.grain) {
      x.globalCompositeOperation = 'overlay'; x.globalAlpha = L.grain * amt;
      const pat = x.createPattern(noise(), 'repeat'), ox = hash(k * 7 + 2) * 256, oy = hash(k * 11 + 3) * 256;
      x.translate(-ox, -oy); x.fillStyle = pat; x.fillRect(ox, oy, W, H); x.setTransform(1, 0, 0, 1, 0, 0);
      x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
    }
    if (L.scratches) {
      const n = Math.floor(hash(k * 31 + 7) * 3);
      for (let i = 0; i < n; i++) {
        const sx = hash(k * 17 + i * 5) * W;
        x.strokeStyle = i % 2 ? `rgba(40,25,10,${0.35 * amt})` : `rgba(255,250,235,${0.4 * amt})`; x.lineWidth = Math.max(1, H * 0.0015);
        x.beginPath(); x.moveTo(sx, 0); x.lineTo(sx + (hash(k + i) - 0.5) * W * 0.01, H); x.stroke();
      }
      for (let i = 0; i < 4; i++) if (hash(k * 41 + i) < 0.5) disc(x, hash(k * 43 + i) * W, hash(k * 47 + i) * H, H * (0.002 + hash(k + i * 3) * 0.004), `rgba(30,20,10,${0.5 * amt})`);
    }
    if (L.vig) vignette(x, W, H, L.vig * amt);
  }

  // ---------- lights ----------
  const LIGHTS = {
    spot: { name: 'Spotlight' }, lightning: { name: 'Lightning' }, disco: { name: 'Disco' },
    beams: { name: 'Sunbeams' }, candle: { name: 'Candlelight' }, rainbow: { name: 'Rainbow' },
  };
  // Lightning flashes on a few photos (the same ones each time); 2 = big flash, 1 = afterglow.
  function flashAt(k) {
    const on = (j) => j >= 2 && hash(j * 7 + 3) < 0.06;
    return on(k) ? 2 : on(k - 1) ? 1 : 0;
  }
  function drawLight(x, W, H, id, k, spot) {
    if (!LIGHTS[id]) return;
    reset(x);
    if (id === 'spot') {
      const s = spot || { x: 0.5, y: 0.6, r: 0.3 }, cx = s.x * W, cy = s.y * H, r = s.r * Math.max(W, H);
      x.globalCompositeOperation = 'soft-light'; glow(x, cx, cy, r * 0.8, [255, 226, 170], 0.22); x.globalCompositeOperation = 'source-over';
      const g = x.createRadialGradient(cx, cy, r * 0.55, cx, cy, r * 1.05);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.86)');
      x.fillStyle = g; x.fillRect(0, 0, W, H);
    } else if (id === 'lightning') {
      x.globalCompositeOperation = 'multiply'; x.fillStyle = '#8392b8'; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'source-over';
      const f = flashAt(k);
      if (f) { x.globalCompositeOperation = 'lighter'; x.fillStyle = `rgba(225,235,255,${f === 2 ? 0.62 : 0.25})`; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'source-over'; }
    } else if (id === 'disco') {
      x.fillStyle = 'rgba(12,0,30,.45)'; x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = 'screen';
      const cols = [[255, 40, 140], [40, 200, 255], [255, 220, 40], [150, 70, 255], [60, 255, 140]];
      cols.forEach((c, i) => glow(x, W * (0.5 + 0.38 * Math.sin(k * 0.45 + i * 1.7)), H * (0.45 + 0.32 * Math.cos(k * 0.37 + i * 2.3)), H * 0.42, c, 0.55));
      x.globalCompositeOperation = 'source-over';
    } else if (id === 'beams') {
      x.globalCompositeOperation = 'screen';
      for (let i = 0; i < 6; i++) {
        const a0 = 0.35 + i * 0.13 + Math.sin(k * 0.2 + i) * 0.01, a1 = a0 + 0.05 + 0.03 * hash(i), L = Math.hypot(W, H) * 1.2;
        x.fillStyle = `rgba(255,246,210,${0.09 + 0.05 * Math.sin(k * 0.35 + i * 1.9)})`;
        x.beginPath(); x.moveTo(-W * 0.05, -H * 0.1); x.lineTo(-W * 0.05 + Math.cos(a0) * L, -H * 0.1 + Math.sin(a0) * L); x.lineTo(-W * 0.05 + Math.cos(a1) * L, -H * 0.1 + Math.sin(a1) * L); x.closePath(); x.fill();
      }
      x.globalCompositeOperation = 'source-over';
      glow(x, 0, 0, H * 0.5, [255, 245, 200], 0.35);
    } else if (id === 'candle') {
      x.globalCompositeOperation = 'multiply'; x.fillStyle = '#ffc890'; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'source-over';
      const f = 0.1 + 0.16 * hash(k * 5 + 1);
      x.fillStyle = `rgba(20,8,0,${f})`; x.fillRect(0, 0, W, H);
      vignette(x, W, H, 0.55);
    } else if (id === 'rainbow') {
      x.globalCompositeOperation = 'soft-light';
      const off = wrap(k * 0.03, 1) * W;
      const g = x.createLinearGradient(-W + off, 0, off + W * 0.2, H);
      ['#ff3b3b', '#ff9f1a', '#ffe11a', '#3bd16f', '#2ea8ff', '#8a5cff', '#ff3b3b', '#ff9f1a', '#ffe11a', '#3bd16f', '#2ea8ff', '#8a5cff'].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
      x.globalAlpha = 0.6; x.fillStyle = g; x.fillRect(0, 0, W, H);
      x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    }
  }

  // ---------- titles ----------
  const TITLE_DUR = 3.4;
  function bgTheater(x, W, H, t) {
    drawCurtains(x, W, H, 0);
    glow(x, W * 0.5, H * 0.5, H * 0.62, [255, 236, 190], 0.28 + 0.14 * easeOut(t / 1.2));
  }
  function bgComic(x, W, H, t) {
    x.drawImage(layer('t-comic', W, H, (c) => {
      c.fillStyle = '#ffd23f'; c.fillRect(0, 0, W, H);
      const s = H * 0.04;
      c.fillStyle = 'rgba(255,130,0,.35)';
      for (let y = 0, row = 0; y < H + s; y += s, row++) for (let xx = row % 2 ? s / 2 : 0; xx < W + s; xx += s) disc(c, xx, y, s * (0.12 + 0.22 * (y / H)), 'rgba(255,130,0,.35)');
    }), 0, 0, W, H);
    x.save(); x.translate(W / 2, H / 2); x.rotate(t * 0.12);
    const p = popIn(t / 0.5), R = Math.max(W, H) * 0.44 * p;
    if (R > 1) { starPath(x, 0, 0, R, R * 0.7, 16); x.fillStyle = '#ff4d3d'; x.fill(); x.lineWidth = H * 0.012; x.strokeStyle = '#111'; x.stroke(); }
    x.restore();
  }
  function bgSpace(x, W, H, t) {
    x.fillStyle = '#03021a'; x.fillRect(0, 0, W, H);
    glow(x, W / 2, H / 2, H * 0.8, [70, 35, 150], 0.5);
    const D = Math.hypot(W, H) * 0.6;
    for (let i = 0; i < 180; i++) {
      const a = hash(i * 7) * TAU, sp = 0.3 + hash(i * 3) * 0.7, z = wrap(hash(i * 11) + t * 0.35 * sp, 1);
      const r0 = z * z * D, r1 = r0 * (1 - 0.1 * sp);
      x.strokeStyle = `rgba(220,235,255,${0.2 + z * 0.8})`; x.lineWidth = Math.max(1, z * H * 0.004);
      x.beginPath(); x.moveTo(W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0); x.lineTo(W / 2 + Math.cos(a) * r1, H / 2 + Math.sin(a) * r1); x.stroke();
    }
  }
  function oldPaper(x, W, H) {
    x.fillStyle = vg(x, 0, H, [[0, '#ecdcb4'], [1, '#d2b78a']]); x.fillRect(0, 0, W, H);
    const r = rand(17);
    for (let i = 0; i < 400; i++) disc(x, r() * W, r() * H, r() * H * 0.002, `rgba(90,60,20,${r() * 0.25})`);
    vignette(x, W, H, 0.55);
    x.strokeStyle = 'rgba(60,40,15,.75)'; x.lineWidth = Math.max(2, H * 0.006);
    x.strokeRect(W * 0.06, H * 0.08, W * 0.88, H * 0.84);
    x.lineWidth = Math.max(1, H * 0.002); x.strokeRect(W * 0.075, H * 0.105, W * 0.85, H * 0.79);
  }
  function bgOld(x, W, H, t) {
    x.drawImage(layer('t-old', W, H, oldPaper), 0, 0, W, H);
    const fr = Math.floor(t * 24);
    if (t < 1.5) {
      const n = 3 - Math.floor(t / 0.5), p = (t % 0.5) / 0.5, cx = W / 2, cy = H / 2, R = H * 0.3;
      x.fillStyle = 'rgba(60,40,15,.18)'; x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + p * TAU); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(40,25,10,.8)'; x.lineWidth = H * 0.008;
      x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.stroke(); x.beginPath(); x.arc(cx, cy, R * 0.82, 0, TAU); x.stroke();
      x.beginPath(); x.moveTo(cx - R * 1.3, cy); x.lineTo(cx + R * 1.3, cy); x.moveTo(cx, cy - R * 1.2); x.lineTo(cx, cy + R * 1.2); x.stroke();
      x.fillStyle = '#2b1d0e'; x.font = `700 ${Math.round(H * 0.32)}px ${FONT.old}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(n), cx, cy + H * 0.01);
    }
    const f = (hash(fr * 13) - 0.5) * 0.12;
    x.fillStyle = f > 0 ? `rgba(255,250,235,${f})` : `rgba(0,0,0,${-f})`; x.fillRect(0, 0, W, H);
    if (hash(fr * 7) < 0.5) { const sx = hash(fr * 3) * W; x.strokeStyle = 'rgba(40,25,10,.4)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(sx, 0); x.lineTo(sx + 4, H); x.stroke(); }
  }
  function bgFairy(x, W, H, t) {
    x.drawImage(layer('t-fairy', W, H, (c) => {
      c.fillStyle = vg(c, 0, H, [[0, '#2c1a5c'], [0.55, '#8a4fb0'], [1, '#ffb6d9']]); c.fillRect(0, 0, W, H);
      const r = rand(23);
      for (let i = 0; i < 120; i++) disc(c, r() * W, r() * H * 0.6, (0.5 + r()) * H / 720, `rgba(255,255,255,${0.3 + r() * 0.5})`);
      glow(c, W * 0.18, H * 0.2, H * 0.22, [255, 250, 220], 0.45); disc(c, W * 0.18, H * 0.2, H * 0.06, '#fff8dc');
      c.fillStyle = '#3a1f5c';
      const bx = W * 0.72, by = H * 0.86;
      c.fillRect(bx - W * 0.1, by - H * 0.22, W * 0.2, H * 0.22);
      for (const [dx, w, h] of [[-0.12, 0.05, 0.36], [0.07, 0.05, 0.32], [-0.025, 0.05, 0.44]]) {
        c.fillRect(bx + dx * W, by - h * H, w * W, h * H);
        c.beginPath(); c.moveTo(bx + dx * W - W * 0.008, by - h * H); c.lineTo(bx + (dx + w / 2) * W, by - (h + 0.1) * H); c.lineTo(bx + (dx + w) * W + W * 0.008, by - h * H); c.fill();
      }
      hills(c, W, H, H * 0.9, H * 0.03, '#2a1648', 24);
    }), 0, 0, W, H);
    for (let i = 0; i < 26; i++) {
      const p = wrap(hash(i * 3) + t * 0.12 * (0.5 + hash(i * 5)), 1), tw = Math.abs(Math.sin(t * 3 + i));
      x.fillStyle = `rgba(255,240,200,${(0.3 + 0.7 * tw) * (1 - p)})`;
      star4(x, hash(i * 7) * W + Math.sin(t + i) * W * 0.02, H * (1 - p), H * 0.012 * (0.4 + tw));
    }
  }
  function bgSpooky(x, W, H, t) {
    x.drawImage(layer('t-spooky', W, H, (c) => {
      c.fillStyle = vg(c, 0, H, [[0, '#0b0518'], [0.7, '#2a1240'], [1, '#160a24']]); c.fillRect(0, 0, W, H);
      glow(c, W * 0.75, H * 0.25, H * 0.35, [220, 255, 200], 0.35); disc(c, W * 0.75, H * 0.25, H * 0.11, '#e8f5d0');
      c.fillStyle = '#07030d'; hills(c, W, H, H * 0.86, H * 0.05, '#07030d', 81);
      c.strokeStyle = '#07030d'; c.lineCap = 'round';
      const tree = (bx, by, h) => {
        c.lineWidth = h * 0.06; c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + h * 0.05, by - h); c.stroke();
        c.lineWidth = h * 0.025;
        for (let i = 0; i < 5; i++) { const y = by - h * (0.45 + i * 0.12), d = i % 2 ? 1 : -1; c.beginPath(); c.moveTo(bx + h * 0.03, y); c.quadraticCurveTo(bx + d * h * 0.2, y - h * 0.1, bx + d * h * 0.35, y - h * 0.18); c.stroke(); }
      };
      tree(W * 0.12, H * 0.9, H * 0.55); tree(W * 0.9, H * 0.92, H * 0.4);
    }), 0, 0, W, H);
    for (let i = 0; i < 6; i++) {
      const span = W * 1.6, px = wrap(hash(i * 3) * span + t * W * 0.05 * (1 + hash(i)), span) - W * 0.3;
      x.save(); x.translate(px, H * (0.75 + hash(i * 7) * 0.25)); x.scale(1, 0.4); glow(x, 0, 0, W * 0.28, [200, 190, 230], 0.25); x.restore();
    }
    for (let i = 0; i < 3; i++) bat(x, wrap(t * W * 0.12 * (1 + i * 0.3) + i * W * 0.3, W * 1.3) - W * 0.15, H * (0.2 + i * 0.1) + Math.sin(t * 3 + i) * H * 0.03, H * 0.035, Math.sin(t * 14 + i));
  }
  const STYLES = {
    theater: { name: 'Theater', font: FONT.theater, weight: '700', anim: 'zoom', bg: bgTheater, sub: '#ffe9b0', stroke: 'rgba(60,20,0,.85)', glow: 'rgba(255,215,120,.6)',
      fill: (x, a, b) => vg(x, a, b, [[0, '#fff3c0'], [0.5, '#f5c94e'], [1, '#b8860b']]) },
    comic: { name: 'Comic', font: FONT.comic, weight: '700', anim: 'pop', bg: bgComic, sub: '#111', stroke: '#111', strokeW: 0.12, fill: () => '#ffffff' },
    space: { name: 'Space', font: FONT.space, weight: '800', anim: 'spread', bg: bgSpace, sub: '#cfe8ff', glow: 'rgba(110,210,255,.8)', upper: true,
      fill: (x, a, b) => vg(x, a, b, [[0, '#e6fbff'], [0.5, '#70d6ff'], [1, '#b18cff']]) },
    old: { name: 'Old movie', font: FONT.old, weight: '700', anim: 'fade', bg: bgOld, sub: '#4a3418', delay: 1.5, fill: () => '#2b1d0e' },
    fairy: { name: 'Fairy tale', font: FONT.fairy, weight: '400', anim: 'letters', bg: bgFairy, sub: '#ffe3f4', stroke: 'rgba(90,30,90,.5)', glow: 'rgba(255,200,240,.8)',
      fill: (x, a, b) => vg(x, a, b, [[0, '#fff8d0'], [0.5, '#ffcf5a'], [1, '#e08a2a']]) },
    spooky: { name: 'Spooky', font: FONT.spooky, weight: '700', anim: 'wobble', bg: bgSpooky, sub: '#e0d0ff', glow: 'rgba(120,255,90,.75)', fill: () => '#a8ff70' },
  };
  function fontOf(st, size) { return `${st.weight} ${Math.round(size)}px ${st.font}`; }
  // Fits the words on one or two lines, as big as they can be.
  function fitLines(x, text, st, maxW, start, min) {
    let size = start;
    const widest = (lines) => Math.max(...lines.map((l) => x.measureText(l).width));
    x.font = fontOf(st, size);
    let lines = [text];
    if (x.measureText(text).width > maxW) {
      const words = text.split(/\s+/);
      if (words.length > 1) {
        let best = null;
        for (let i = 1; i < words.length; i++) {
          const cand = [words.slice(0, i).join(' '), words.slice(i).join(' ')], w = widest(cand);
          if (!best || w < best.w) best = { cand, w };
        }
        if (best.w < x.measureText(text).width) lines = best.cand;
      }
    }
    while (widest(lines) > maxW && size > min) { size *= 0.93; x.font = fontOf(st, size); }
    return { lines, size };
  }
  function paintText(x, s, cx, cy, size, st, a, sc = 1, rot = 0) {
    if (a <= 0.003 || sc <= 0.01) return;
    x.save(); x.translate(cx, cy); x.rotate(rot); x.scale(sc, sc); x.globalAlpha *= clamp(a, 0, 1);
    x.font = fontOf(st, size); x.textAlign = 'center'; x.textBaseline = 'middle';
    if (st.glow) { x.shadowColor = st.glow; x.shadowBlur = size * 0.3; }
    if (st.stroke) { x.lineJoin = 'round'; x.strokeStyle = st.stroke; x.lineWidth = size * (st.strokeW || 0.06); x.strokeText(s, 0, 0); x.shadowBlur = 0; }
    x.fillStyle = st.fill(x, -size * 0.5, size * 0.5); x.fillText(s, 0, 0);
    x.restore();
  }
  function drawLine(x, line, cx, cy, size, st, t, li) {
    const anim = st.anim;
    if (anim === 'letters' || anim === 'wobble' || anim === 'spread') {
      x.font = fontOf(st, size);
      const chars = [...line], ws = chars.map((c) => x.measureText(c).width);
      const extra = anim === 'spread' ? size * (0.55 * (1 - easeOut(t / 1.3)) + 0.04) : 0;
      const total = ws.reduce((a, b) => a + b, 0) + extra * (chars.length - 1);
      let px = cx - total / 2;
      chars.forEach((c, i) => {
        let a = 1, dy = 0, sc = 1;
        if (anim === 'letters') {
          const u = t - i * 0.06 - li * 0.35;
          a = clamp(u / 0.25, 0, 1); sc = popIn(u / 0.4);
          if (u > 0 && u < 0.6) { x.fillStyle = `rgba(255,250,220,${1 - u / 0.6})`; star4(x, px + ws[i] / 2 + size * 0.3, cy - size * 0.45 - u * size * 0.4, size * 0.12); }
        } else if (anim === 'wobble') { dy = Math.sin(t * 5 + i * 0.9) * size * 0.05; a = clamp(t / 0.8 - i * 0.03, 0, 1); }
        else a = clamp(t / 0.8, 0, 1);
        if (c.trim()) paintText(x, c, px + ws[i] / 2, cy + dy, size, st, a, sc);
        px += ws[i] + extra;
      });
    } else {
      let a = 1, sc = 1, rot = 0;
      if (anim === 'zoom') { a = clamp(t / 0.7, 0, 1); sc = 0.86 + 0.14 * easeOut(t / 1.1); }
      else if (anim === 'pop') { const p = clamp((t - li * 0.15) / 0.5, 0, 1); sc = popIn(p); a = p > 0 ? 1 : 0; rot = -0.06; }
      else a = clamp(t / 0.6, 0, 1);
      paintText(x, line, cx, cy, size, st, a, sc, rot);
    }
  }
  // ti: { text, sub, style }; t: seconds into the title.
  function drawTitle(x, W, H, ti, t) {
    const st = STYLES[ti.style] || STYLES.theater;
    reset(x); x.save();
    st.bg(x, W, H, t);
    const u = t - (st.delay || 0);
    let fadeText = 1;
    if (ti.style === 'theater') fadeText = 1 - clamp((t - (TITLE_DUR - 0.45)) / 0.4, 0, 1);
    if (u > 0) {
      x.globalAlpha = fadeText;
      let text = (ti.text || '').trim() || 'My Movie';
      if (st.upper) text = text.toUpperCase();
      const { lines, size } = fitLines(x, text, st, W * 0.84, H * 0.17, H * 0.06);
      const lh = size * 1.1, sub = (ti.sub || '').trim(), subSize = Math.max(12, H * 0.055);
      const blockH = lh * lines.length + (sub ? subSize * 1.6 : 0);
      let y = H / 2 - blockH / 2 + lh / 2;
      lines.forEach((l, i) => { drawLine(x, l, W / 2, y, size, st, u, i); y += lh; });
      if (sub) {
        const a = clamp((u - 0.9) / 0.5, 0, 1);
        if (a > 0) {
          x.font = `700 ${Math.round(subSize)}px ${ti.style === 'comic' ? FONT.comic : ti.style === 'old' ? FONT.old : FONT.round}`;
          x.textAlign = 'center'; x.textBaseline = 'middle';
          const sy = y + subSize * 0.5;
          if (ti.style === 'comic') {
            const w = x.measureText(sub).width + subSize * 1.2;
            x.globalAlpha = fadeText * a; x.fillStyle = '#fff'; x.strokeStyle = '#111'; x.lineWidth = Math.max(2, subSize * 0.08);
            x.beginPath(); x.ellipse(W / 2, sy, w / 2, subSize * 0.85, 0, 0, TAU); x.fill(); x.stroke();
          }
          x.globalAlpha = fadeText * a; x.fillStyle = st.sub; x.fillText(sub, W / 2, sy);
        }
      }
      x.globalAlpha = 1;
    }
    if (ti.style !== 'theater') {
      const f = clamp((t - (TITLE_DUR - 0.35)) / 0.35, 0, 1);
      if (f > 0) { x.fillStyle = `rgba(0,0,0,${f})`; x.fillRect(0, 0, W, H); }
    }
    x.restore();
  }

  // ---------- credits (and the music line the license asks for) ----------
  const END_DUR = 2.6;
  function creditLines(ed, music) {
    const c = ed.credits || {}, L = [];
    if (c.on) {
      const dir = (c.director || '').trim(), cast = (c.cast || '').split(/\n|,/).map((s) => s.trim()).filter(Boolean);
      if (dir) L.push({ t: 'Directed by', s: 0.045, dim: true }, { t: dir, s: 0.08 }, { gap: 0.07 });
      if (cast.length) { L.push({ t: 'Starring', s: 0.045, dim: true }); cast.slice(0, 16).forEach((n) => L.push({ t: n, s: 0.068 })); L.push({ gap: 0.07 }); }
      if ((c.thanks || '').trim()) L.push({ t: 'Special thanks', s: 0.045, dim: true }, { t: c.thanks.trim(), s: 0.06 }, { gap: 0.07 });
    }
    if (music) L.push({ t: 'Music', s: 0.04, dim: true }, { t: `“${music.title}”`, s: 0.05 }, { t: `by ${music.artist}`, s: 0.045 }, { t: music.note, s: 0.034, dim: true }, { gap: 0.06 });
    if (c.on) L.push({ t: 'Made with Stop Motion', s: 0.036, dim: true });
    return L;
  }
  function scrollTime(L) { return Math.max(2.4, 1 + L.filter((l) => !l.gap).length * 0.45); }
  function creditsDur(ed, music) {
    const L = creditLines(ed, music);
    if (!(ed.credits && ed.credits.on)) return L.length ? 3.2 : 0;
    return L.length ? END_DUR + scrollTime(L) + 1 : END_DUR;
  }
  function creditsBg(x, W, H, ed, t) {
    if (ed.curtains) { drawCurtains(x, W, H, 0); glow(x, W / 2, H / 2, H * 0.6, [255, 236, 190], 0.25); }
    else if (ed.title && ed.title.on && STYLES[ed.title.style] && ed.title.style !== 'theater') STYLES[ed.title.style].bg(x, W, H, 2 + t);
    else { x.fillStyle = vg(x, 0, H, [[0, '#1a1236'], [1, '#07050f']]); x.fillRect(0, 0, W, H); }
  }
  function drawCredits(x, W, H, ed, t, music) {
    reset(x); x.save();
    const L = creditLines(ed, music), full = ed.credits && ed.credits.on;
    const st = STYLES[(ed.title && ed.title.style) || 'theater'] || STYLES.theater;
    if (!full) {
      // Only the music line: a short, quiet card.
      x.fillStyle = '#07050f'; x.fillRect(0, 0, W, H);
      x.globalAlpha = clamp(t / 0.5, 0, 1) * clamp((3.2 - t) / 0.4, 0, 1);
      drawBlock(x, W, H, L, H / 2 - blockHeight(L, H) / 2);
      x.restore(); return;
    }
    creditsBg(x, W, H, ed, t);
    const endText = ((ed.credits.end || '').trim() || 'The End');
    const sc = L.length ? scrollTime(L) : 0, s0 = END_DUR - 0.3;
    const out = L.length ? clamp((t - s0) / 0.6, 0, 1) : 0;
    const endA = clamp(t / 0.6, 0, 1) * (1 - out);
    if (endA > 0) {
      const size = fitLines(x, endText, st, W * 0.8, H * 0.2, H * 0.08).size;
      paintText(x, endText, W / 2, H / 2 - out * H * 0.25, size, st, endA, 0.9 + 0.1 * easeOut(t / 0.9));
    }
    if (L.length && t > s0) {
      const bh = blockHeight(L, H), from = H * 1.02, to = Math.min(H / 2 - bh / 2, H * 0.55 - bh);
      const y0 = from + (to - from) * clamp((t - s0) / sc, 0, 1);
      drawBlock(x, W, H, L, y0, ed.curtains ? '#ffe9b0' : '#ffffff');
    }
    x.restore();
  }
  function blockHeight(L, H) { return L.reduce((s, l) => s + (l.gap ? l.gap * H : l.s * H * 1.35), 0); }
  function drawBlock(x, W, H, L, y, color = '#ffffff') {
    x.textAlign = 'center'; x.textBaseline = 'middle';
    for (const l of L) {
      if (l.gap) { y += l.gap * H; continue; }
      const size = l.s * H, a = x.globalAlpha;
      let fs = size;
      x.font = `${l.dim ? 600 : 800} ${Math.round(fs)}px ${FONT.round}`;
      while (x.measureText(l.t).width > W * 0.9 && fs > 6) { fs *= 0.92; x.font = `${l.dim ? 600 : 800} ${Math.round(fs)}px ${FONT.round}`; }
      x.globalAlpha = a * (l.dim ? 0.72 : 1); x.fillStyle = color;
      x.fillText(l.t, W / 2, y + size * 0.67);
      x.globalAlpha = a;
      y += size * 1.35;
    }
  }

  // ---------- stickers: speech bubbles, comic words, emoji, captions ----------
  const WORDS = [['POW!', '#ff4d3d'], ['BOOM!', '#ff9f1a'], ['ZAP!', '#3aa0ff'], ['WOW!', '#a855f7'], ['OOPS!', '#22c55e'], ['YAY!', '#ff5fa2'], ['HELP!', '#ef4444'], ['ZZZ…', '#60a5fa']];
  const EMOJI = ['⭐', '❤️', '💥', '🔥', '💨', '💦', '❓', '❗', '🎉', '🌈', '😂', '😱', '😍', '👻', '💤', '🎵', '👀', '⚡', '🍕', '👑'];
  function wrapText(x, text, maxW) {
    const out = [];
    for (const para of String(text || '').split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      let line = '';
      for (const w of words) {
        const t = line ? line + ' ' + w : w;
        if (x.measureText(t).width <= maxW || !line) line = t; else { out.push(line); line = w; }
      }
      out.push(line);
    }
    return out.length ? out : [''];
  }
  function bubbleLayout(x, s, W, H) {
    const fs = Math.max(10, s.size * H * 0.3);
    x.font = `700 ${Math.round(fs)}px ${FONT.comic}`;
    const lines = wrapText(x, s.text || '…', W * 0.4), lh = fs * 1.15;
    const w = Math.max(fs, ...lines.map((l) => x.measureText(l).width)), h = lh * lines.length;
    return { fs, lines, lh, rx: w / 2 + fs * 0.9, ry: h / 2 + fs * 0.75 };
  }
  function drawBubble(x, s, W, H) {
    const L = bubbleLayout(x, s, W, H), cx = s.x * W, cy = s.y * H, { rx, ry, fs } = L, dir = s.tail === 'right' ? 1 : -1;
    x.lineWidth = Math.max(2, fs * 0.1); x.strokeStyle = '#111'; x.lineJoin = 'round';
    const fill = s.kind === 'shout' ? '#fffbe0' : '#ffffff';
    if (s.kind === 'think') {
      const bumps = 11;
      const path = (grow) => { x.beginPath(); for (let i = 0; i < bumps; i++) { const a = (i / bumps) * TAU, bx = cx + Math.cos(a) * rx * 0.92, by = cy + Math.sin(a) * ry * 0.88, br = Math.min(rx, ry) * 0.42 + grow; x.moveTo(bx + br, by); x.arc(bx, by, br, 0, TAU); } };
      path(0); x.stroke(); x.fillStyle = fill; path(0); x.fill();
      x.beginPath(); x.ellipse(cx, cy, rx * 0.95, ry * 0.92, 0, 0, TAU); x.fill();
      for (let i = 0; i < 3; i++) { const r = fs * (0.32 - i * 0.08), tx = cx + dir * rx * (0.6 + i * 0.22), ty = cy + ry * (1.1 + i * 0.32); x.beginPath(); x.arc(tx, ty, r, 0, TAU); x.fillStyle = fill; x.fill(); x.stroke(); }
    } else if (s.kind === 'shout') {
      x.save(); x.translate(cx, cy); x.scale(rx * 1.18, ry * 1.3); starPath(x, 0, 0, 1, 0.83, 18, 0); x.restore();
      x.fillStyle = fill; x.fill(); x.stroke();
    } else {
      const tail = () => { x.beginPath(); x.moveTo(cx + dir * rx * 0.15, cy + ry * 0.6); x.lineTo(cx + dir * rx * 0.95, cy + ry * 1.6); x.lineTo(cx + dir * rx * 0.55, cy + ry * 0.55); x.closePath(); };
      tail(); x.stroke();
      x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, TAU); x.stroke();
      x.fillStyle = fill; tail(); x.fill(); x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, TAU); x.fill();
    }
    x.fillStyle = '#111'; x.font = `700 ${Math.round(fs)}px ${FONT.comic}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    L.lines.forEach((l, i) => x.fillText(l, cx, cy - ((L.lines.length - 1) * L.lh) / 2 + i * L.lh));
  }
  function drawWord(x, s, W, H) {
    const fs = Math.max(12, s.size * H * 0.55);
    x.save(); x.translate(s.x * W, s.y * H); x.rotate(-0.1);
    x.font = `900 ${Math.round(fs)}px ${FONT.comic}`; x.textAlign = 'center'; x.textBaseline = 'middle';
    const tw = x.measureText(s.text).width;
    x.save(); x.scale(tw * 0.62 + fs * 0.55, fs * 1.05); starPath(x, 0, 0, 1, 0.72, 14); x.restore();
    x.fillStyle = s.color || '#ff4d3d'; x.fill(); x.lineWidth = Math.max(2, fs * 0.06); x.strokeStyle = '#111'; x.stroke();
    x.lineJoin = 'round'; x.lineWidth = fs * 0.16; x.strokeText(s.text, 0, 0);
    x.fillStyle = vg(x, -fs / 2, fs / 2, [[0, '#fff6a0'], [1, '#ffb000']]); x.fillText(s.text, 0, 0);
    x.restore();
  }
  function captionLayout(x, s, W, H) {
    const fs = Math.max(12, s.size * H * 0.2);
    x.font = `700 ${Math.round(fs)}px ${FONT.round}`;
    const lines = wrapText(x, s.text || '…', W * 0.86), lh = fs * 1.2;
    return { fs, lines, lh, bh: lh * lines.length + fs * 0.7 };
  }
  function drawSticker(x, W, H, s) {
    x.save();
    if (s.kind === 'emoji') {
      const fs = Math.max(12, s.size * H * 0.8);
      x.font = `${Math.round(fs)}px ${FONT.emoji}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(s.text, s.x * W, s.y * H);
    } else if (s.kind === 'word') drawWord(x, s, W, H);
    else if (s.kind === 'caption') {
      const L = captionLayout(x, s, W, H), cy = s.y * H;
      x.fillStyle = 'rgba(0,0,0,.62)'; x.fillRect(0, cy - L.bh / 2, W, L.bh);
      x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
      L.lines.forEach((l, i) => x.fillText(l, W / 2, cy - ((L.lines.length - 1) * L.lh) / 2 + i * L.lh));
    } else drawBubble(x, s, W, H);
    x.restore();
  }
  // Rough box around a sticker, in pixels, for picking it up with a finger.
  function stickerRect(x, W, H, s) {
    const cx = s.x * W, cy = s.y * H;
    if (s.kind === 'emoji') { const r = s.size * H * 0.45; return [cx - r, cy - r, cx + r, cy + r]; }
    if (s.kind === 'word') {
      const fs = Math.max(12, s.size * H * 0.55); x.font = `900 ${Math.round(fs)}px ${FONT.comic}`;
      const rx = x.measureText(s.text).width * 0.62 + fs * 0.55, ry = fs * 1.05; return [cx - rx, cy - ry, cx + rx, cy + ry];
    }
    if (s.kind === 'caption') { const L = captionLayout(x, s, W, H); return [0, cy - L.bh / 2, W, cy + L.bh / 2]; }
    const L = bubbleLayout(x, s, W, H);
    return [cx - L.rx * 1.2, cy - L.ry * 1.3, cx + L.rx * 1.2, cy + L.ry * 1.3];
  }

  // ---------- small preview pictures for the menus ----------
  function sampleScene(x, W, H) {
    x.fillStyle = vg(x, 0, H, [[0, '#6cc3ff'], [0.62, '#cdeeff'], [0.62, '#7ccf6a'], [1, '#4f9e43']]); x.fillRect(0, 0, W, H);
    disc(x, W * 0.8, H * 0.22, H * 0.11, '#ffe680');
    x.fillStyle = '#e8534a'; x.fillRect(W * 0.12, H * 0.42, W * 0.22, H * 0.24);
    x.fillStyle = '#9b3b33'; x.beginPath(); x.moveTo(W * 0.09, H * 0.43); x.lineTo(W * 0.23, H * 0.26); x.lineTo(W * 0.37, H * 0.43); x.fill();
    disc(x, W * 0.58, H * 0.6, H * 0.16, '#ffcc33');
    disc(x, W * 0.54, H * 0.56, H * 0.025, '#222'); disc(x, W * 0.62, H * 0.56, H * 0.025, '#222');
  }
  const tiles = new Map();
  // A small picture (as a data URL) for a menu button.
  function tile(kind, id, w = 132, h = 74) {
    const key = `${kind}:${id}:${w}x${h}`;
    if (tiles.has(key)) return tiles.get(key);
    const c = mk(w, h), x = c.getContext('2d');
    if (kind === 'bg') {
      if (id === 'none') { sampleScene(x, w, h); }
      else if (id === 'photo') { x.fillStyle = '#3b3068'; x.fillRect(0, 0, w, h); x.font = `${Math.round(h * 0.5)}px ${FONT.emoji}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('🖼️', w / 2, h / 2); }
      else drawBg(x, w, h, id, 3);
    } else if (kind === 'fx') {
      x.fillStyle = vg(x, 0, h, [[0, '#3a4a7a'], [1, '#6a7fb0']]); x.fillRect(0, 0, w, h);
      disc(x, w * 0.5, h * 0.66, h * 0.2, '#ffcc33');
      if (id !== 'none') drawEffect(x, w, h, id, 4);
    } else if (kind === 'look') {
      sampleScene(x, w, h);
      if (id !== 'none') applyLook(x, w, h, id, 1, 3);
    } else if (kind === 'light') {
      sampleScene(x, w, h);
      if (id !== 'none') drawLight(x, w, h, id, id === 'lightning' ? 3 : 2, { x: 0.58, y: 0.55, r: 0.35 });
      if (id === 'lightning') { x.fillStyle = 'rgba(230,240,255,.55)'; x.fillRect(0, 0, w, h); }
    } else if (kind === 'title') {
      drawTitle(x, w, h, { text: 'Title', style: id }, 2.2);
    }
    const url = c.toDataURL('image/jpeg', 0.82);
    tiles.set(key, url);
    return url;
  }

  const list = (o) => Object.entries(o).map(([id, v]) => ({ id, name: v.name }));
  return {
    BACKGROUNDS: [{ id: 'none', name: 'Real room' }, ...list(BG)],
    EFFECTS: [{ id: 'none', name: 'No effect' }, ...list(FX)],
    LOOKS: [{ id: 'none', name: 'Normal' }, ...list(LOOKS)],
    LIGHTS: [{ id: 'none', name: 'No lights' }, ...list(LIGHTS)],
    STYLES: list(STYLES), WORDS, EMOJI, FONT, TITLE_DUR,
    reset, drawBg, drawEffect, applyLook, drawLight, flashAt, drawTitle, drawCredits, creditsDur, drawCurtains,
    drawSticker, stickerRect, tile, glow,
  };
})();
