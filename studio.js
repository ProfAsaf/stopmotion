'use strict';
/* Stop Motion: the Studio, where a set of photos becomes a movie. Fix the camera and
   the light, frame the picture, add magic backgrounds, looks, words, voices, music,
   sounds, titles and credits, then play it or save it to Photos. Nothing here
   changes the photos themselves: every choice is kept with the movie (movie.edit). */
const Studio = (() => {
  const TABS = [
    ['frame', '✂️', 'Frame'], ['fix', '🪄', 'Fix'], ['scene', '🌈', 'Scene'], ['look', '💡', 'Look'],
    ['words', '💬', 'Words'], ['sound', '🎵', 'Sound'], ['titles', '🎬', 'Titles'], ['speed', '⏱️', 'Speed'],
  ];
  const BRUSH = [0.025, 0.05, 0.09]; // eraser sizes, as a share of the picture width
  const ST = { lib: null, tab: 'fix', cur: 0, sel: null, mode: null, brush: 1, surprises: null, si: 0, mix: null, mixKey: '', cursor: null };
  const ed = () => S.movie.edit;
  const count = () => S.frames.length;
  const onPhoto = () => ST.cur >= 0 && ST.cur < count();

  // ---------- little UI builders (also used by the camera screen's menus) ----------
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function btn(text, onClick, cls = 'pill') {
    const b = el('button', cls, text);
    b.onclick = (e) => { primeGestures(); onClick(e); };
    return b;
  }
  function sec(title, ...kids) { const s = el('div', 'st-sec'); if (title) s.appendChild(el('h4', null, title)); kids.flat().forEach((k) => k && s.appendChild(k)); return s; }
  function row(...kids) { const r = el('div', 'st-row'); kids.flat().forEach((k) => k && r.appendChild(k)); return r; }
  function hint(text) { return el('p', 'hint', text); }
  function box(...kids) { const b = el('div', 'st-box'); kids.flat().forEach((k) => k && b.appendChild(typeof k === 'string' ? hint(k) : k)); return b; }
  function toggle(title, sub, on, onChange) {
    const t = el('button', 'st-toggle'), txt = el('span'), sw = el('span', 'switch' + (on ? ' on' : ''));
    txt.appendChild(el('b', null, title)); if (sub) txt.appendChild(el('small', null, sub));
    t.append(txt, sw);
    t.onclick = () => { primeGestures(); on = !on; sw.classList.toggle('on', on); onChange(on); };
    return t;
  }
  function segEl(options, value, onPick) { const d = el('div', 'seg'); seg(d, options, value, onPick); return d; }
  function labeled(label, ctl) { const r = row(el('span', 'label', label), ctl); return r; }
  function slider(label, min, max, step, value, onInput, onDone) {
    const r = el('label', 'st-slider'), i = el('input', 'st-range');
    i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(value);
    i.oninput = () => onInput(Number(i.value));
    i.onchange = () => (onDone || onInput)(Number(i.value));
    r.append(el('span', 'label', label), i);
    return r;
  }
  // Photos per second, from slow motion (turtle) to fast (rabbit).
  function speed(fps, onPick) {
    const box = el('div', 'st-speed'), i0 = Math.max(0, FPS_CHOICES.indexOf(fps)), read = el('div', 'st-speed-read');
    const words = (f) => (f <= 3 ? 'slow motion' : f <= 6 ? 'slow' : f <= 10 ? 'normal' : 'fast');
    const show = (f) => { read.textContent = `${f} photo${f === 1 ? '' : 's'} a second · ${words(f)}`; };
    const i = el('input', 'st-range');
    i.type = 'range'; i.min = '0'; i.max = String(FPS_CHOICES.length - 1); i.step = '1'; i.value = String(i0);
    i.setAttribute('aria-label', 'Speed');
    i.oninput = () => show(FPS_CHOICES[Number(i.value)]);
    i.onchange = () => { const f = FPS_CHOICES[Number(i.value)]; show(f); onPick(f); };
    box.append(row(el('span', 'emo', '🐢'), i, el('span', 'emo', '🐇')), read);
    show(FPS_CHOICES[i0]);
    return box;
  }
  // A grid of picture buttons: kind is 'bg' | 'fx' | 'look' | 'light' | 'title', or 'emoji' for list items with an icon.
  function tiles(list, value, kind, onPick) {
    const g = el('div', 'tiles');
    for (const item of list) {
      const b = el('button', 'tile' + (item.id === value ? ' on' : ''));
      if (kind === 'emoji') b.appendChild(el('span', 'emo', item.icon || '•'));
      else { const img = el('img'); img.alt = ''; img.src = Art.tile(kind, item.id); b.appendChild(img); }
      b.appendChild(el('span', null, item.name));
      b.onclick = () => { primeGestures(); $$('.tile', g).forEach((t) => t.classList.toggle('on', t === b)); onPick(item.id); };
      g.appendChild(b);
    }
    return g;
  }

  // ---------- saving and keeping things in step ----------
  let saveTimer = 0;
  function save(now) {
    clearTimeout(saveTimer);
    const run = () => { S.movie.updated = Date.now(); DB.put('movies', S.movie).catch((e) => console.warn('save failed', e)); };
    if (now) run(); else saveTimer = setTimeout(run, 350);
  }
  function changed({ timeline = false, keys = false, merge = false } = {}) {
    record(merge);
    S.exportBlob = null;
    if (keys && ST.lib) ST.lib.dropKeys();
    save(); updateLen();
    if (timeline) renderTimeline();
    drawPreview();
  }
  // ---------- undo and redo ----------
  // Everything in the Studio can be undone: settings (snapshots of movie.edit), eraser marks, and photos.
  const H = { undo: [], redo: [], last: null, busy: false };
  const snap = () => JSON.stringify({ edit: S.movie.edit, fps: S.movie.fps, name: S.movie.name });
  function undoButtons() {
    const u = $('#stUndo'), r = $('#stRedo');
    if (u) u.classList.toggle('off', !H.undo.length);
    if (r) r.classList.toggle('off', !H.redo.length);
  }
  function pushUndo(entry) {
    H.undo.push(entry);
    if (H.undo.length > 80) H.undo.shift();
    H.redo.length = 0;
    undoButtons();
  }
  // After a settled change: remember the state before it. merge: an automatic follow-up, part of the last step.
  function record(merge) {
    if (!S.movie) return;
    const now = snap();
    if (H.last == null || now === H.last) { H.last = now; return; }
    if (!merge) pushUndo({ kind: 'edit', state: H.last });
    H.last = now;
  }
  async function maskShot(id) { const m = await ST.lib.editMask(id); return m.getContext('2d').getImageData(0, 0, m.width, m.height); }
  async function undo() { await stepHistory(H.undo, H.redo, 'Undone'); }
  async function redo() { await stepHistory(H.redo, H.undo, 'Done again'); }
  async function stepHistory(from, to, word) {
    primeGestures();
    if (H.busy || !ST.lib) return;
    if (Play.on) Play.stop();
    const e = from.pop();
    if (!e) { toast(from === H.undo ? 'Nothing to undo' : 'Nothing to redo'); return; }
    H.busy = true;
    try { to.push(await applyEntry(e)); toast(word); }
    catch (er) { console.error(er); toast('That could not be undone'); }
    finally { H.busy = false; undoButtons(); }
  }
  // Puts one remembered thing back, and returns how to reverse that.
  async function applyEntry(e) {
    if (e.kind === 'edit') { const back = { kind: 'edit', state: snap() }; restore(e.state); return back; }
    if (e.kind === 'mask') {
      const i = S.frames.findIndex((f) => f.id === e.id), back = { kind: 'mask', id: e.id, img: await maskShot(e.id) };
      (await ST.lib.editMask(e.id)).getContext('2d').putImageData(e.img, 0, 0);
      await ST.lib.saveMask(e.id); await ST.lib.editMask(e.id);
      ST.lib.dropKeys();
      if (i >= 0 && i !== ST.cur) await select(i);
      changed({ timeline: true });
      return back;
    }
    if (e.kind === 'photo-del') {   // a deleted photo comes back
      const back = { kind: 'photo-add', id: e.rec.id, state: snap() };
      await putPhotoBack(e);
      restore(e.state, e.index);
      return back;
    }
    // 'photo-add': a copied photo goes away again
    const before = snap(), gone = await takePhotoOut(e.id);
    restore(e.state, Math.min(gone.index, count() - 1));
    return { kind: 'photo-del', ...gone, state: before };
  }
  function restore(json, sel) {
    const o = JSON.parse(json);
    S.movie.edit = o.edit; S.movie.fps = o.fps; S.movie.name = o.name;
    Fx.ensureEdit(S.movie);
    H.last = snap();
    ST.lib.m = S.movie; ST.lib.dropKeys(); ST.mixKey = '';
    if (ST.sel && !ed().stickers.some((q) => q.id === ST.sel)) ST.sel = null;
    if (sel != null) ST.cur = clamp(sel, -1, count());
    $('#stName').textContent = S.movie.name;
    S.exportBlob = null; save(); updateLen(); renderTimeline(); renderPanel(); drawPreview();
  }
  const musicCredit = () => Sonic.credit(ed().music.track);
  const timelineNow = () => Fx.timeline(S.movie, S.frames, musicCredit());
  const titleOf = () => ({ text: ed().title.text || S.movie.name, sub: ed().title.sub, style: ed().title.style });
  function updateLen() { if (S.movie) $('#stLen').textContent = `${count()} photos · ${timelineNow().total.toFixed(1)}s`; }
  let busyN = 0;
  function busy(text, p) {
    const b = $('#stBusy');
    if (text == null) { busyN = Math.max(0, busyN - 1); if (!busyN) b.hidden = true; return; }
    b.hidden = false; b.textContent = p != null ? `${text} ${Math.round(p * 100)}%` : text;
  }
  async function ensureAnalysis() {
    const lib = ST.lib;
    if (!lib || !lib.needsAnalysis()) return;
    busyN++;
    try { await lib.analyze((p) => busy('Lining up photos…', p)); }
    finally { busy(null); }
    if (ST.lib === lib) { ST.mixKey = ''; drawPreview(); }
  }
  const usesLineUp = () => { const e = ed(); return e.steady || e.even || e.scene.bg !== 'none' || S.frames.some((f) => ST.lib && ST.lib.hasMask(f.id)); };

  // ---------- the mix ----------
  const loadVoice = (id) => DB.get('aux', `${S.movie.id}/voice/${id}`).then((r) => (r ? r.blob : null));
  function mixPlan(sampleRate, channels) {
    const tl = timelineNow(), e = ed(), at = (id) => (id === '#start' ? 0 : tl.firstAt[id]);
    const sfx = [];
    e.sounds.forEach((s) => { const t = at(s.at); if (t != null) sfx.push({ kind: s.kind, t }); });
    if (e.light === 'lightning') tl.shots.forEach((s, i) => { if (Art.flashAt(s.k) === 2 && (i === 0 || tl.shots[i - 1].k !== s.k)) sfx.push({ kind: 'thunder', t: s.t0 + 0.12 }); });
    if (e.curtains && tl.n) {
      sfx.push({ kind: 'curtain', t: tl.T0 }, { kind: 'curtain', t: tl.movieEnd });
      if (e.applause) sfx.push({ kind: 'applause', t: tl.movieEnd + 0.3 });
    }
    const voices = e.voices.map((v) => ({ id: v.id, t: at(v.at), vol: v.vol })).filter((v) => v.t != null);
    const music = e.music.track !== 'none' ? { id: e.music.track, vol: e.music.vol } : null;
    return { dur: tl.total, sampleRate, channels, music, voices, sfx };
  }
  const hasSound = (p) => !!(p.music || p.voices.length || p.sfx.length);
  async function mixBuffer(sampleRate = 48000, channels = 2) {
    const plan = mixPlan(sampleRate, channels), key = JSON.stringify(plan);
    if (ST.mixKey === key) return ST.mix;
    const buf = hasSound(plan) ? await Sonic.render(plan, loadVoice) : null;
    ST.mix = buf; ST.mixKey = key;
    return buf;
  }

  // ---------- the preview ----------
  function outAspect(full) { const g = Fx.frameGeom(S.movie, full); return g.cw / g.ch; }
  function sizeCanvases(aspect) {
    const v = $('#stView'), dpr = Math.min(2, window.devicePixelRatio || 1);
    const [cw, ch] = Fx.fitSize(aspect, Math.max(40, v.clientWidth - 12), Math.max(40, v.clientHeight - 12));
    const W = Math.min(1280, Math.round(cw * dpr)), H = Math.max(2, Math.round(W / aspect));
    for (const c of [$('#stCanvas'), $('#stOver')]) {
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      c.style.width = `${cw}px`; c.style.height = `${ch}px`;
    }
    return [W, H];
  }
  let off = null, drawing = null, again = false;
  function drawPreview() {
    if (!S.movie || S.screen !== 'studio' || Play.on) return null;
    if (drawing) { again = true; return drawing; }
    drawing = (async () => {
      do {
        again = false;
        const full = ST.tab === 'frame' && onPhoto(), [W, H] = sizeCanvases(outAspect(full));
        if (!off) off = document.createElement('canvas');
        if (off.width !== W || off.height !== H) { off.width = W; off.height = H; }
        const x = off.getContext('2d');
        try {
          if (ST.cur < 0) Art.drawTitle(x, W, H, titleOf(), 2.3);
          else if (ST.cur >= count()) { const tl = timelineNow(); Art.drawCredits(x, W, H, ed(), Math.max(0, Math.min(tl.creditsDur - 0.2, 1.5)), musicCredit()); }
          else await Fx.drawShot(x, W, H, ST.lib, ST.cur, { full, raw: full, keyRes: 320 });
        } catch (e) { console.error(e); }
        if (Play.on || S.screen !== 'studio') return;
        const c = $('#stCanvas').getContext('2d');
        Art.reset(c); c.drawImage(off, 0, 0);
        drawOverlay();
      } while (again);
    })().finally(() => { drawing = null; });
    return drawing;
  }
  // The transform from the current photo's pixels to the preview, as drawn.
  function photoT(W, H) {
    const f = S.frames[ST.cur], O = Fx.outMatrix(Fx.frameGeom(S.movie), W, H);
    return Fx.M.mul(O, ed().steady ? Fx.M.sim(ST.lib.alignOf(f.id)) : Fx.M.id());
  }
  let tintC = null;
  function tinted(mask, color) {
    if (!tintC) tintC = document.createElement('canvas');
    if (tintC.width !== mask.width || tintC.height !== mask.height) { tintC.width = mask.width; tintC.height = mask.height; }
    const t = tintC.getContext('2d');
    t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, tintC.width, tintC.height); t.drawImage(mask, 0, 0);
    t.globalCompositeOperation = 'source-in'; t.fillStyle = color; t.fillRect(0, 0, tintC.width, tintC.height);
    t.globalCompositeOperation = 'source-over';
    return tintC;
  }
  function drawOverlay() {
    const c = $('#stOver'), x = c.getContext('2d'), W = c.width, H = c.height;
    Art.reset(x); x.clearRect(0, 0, W, H);
    if (!onPhoto() || Play.on) return;
    const m = S.movie, e = ed(), f = S.frames[ST.cur];
    if (ST.tab === 'frame') {
      const g = Fx.frameGeom(m), s = W / m.w, co = Math.cos(g.rot), sn = Math.sin(g.rot), hw = g.cw / 2, hh = g.ch / 2;
      const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([qx, qy]) => [(g.cx + co * qx + sn * qy) * s, (g.cy - sn * qx + co * qy) * s]);
      x.fillStyle = 'rgba(8,5,18,.62)'; x.beginPath(); x.rect(0, 0, W, H);
      pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); x.fill('evenodd');
      x.strokeStyle = '#ffd23f'; x.lineWidth = Math.max(2, W / 320);
      x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); x.stroke();
      return;
    }
    if (ST.mode === 'erase' || ST.mode === 'surprise') {
      const mask = ST.mode === 'surprise' ? ST.surprises[ST.si].mask : ST.lib.masks.get(f.id);
      if (mask) {
        Fx.M.set(x, Fx.M.mul(photoT(W, H), Fx.M.scale(m.w / mask.width, m.h / mask.height)));
        x.globalAlpha = ST.mode === 'surprise' ? 0.55 : 0.35; x.imageSmoothingQuality = 'high';
        x.drawImage(tinted(mask, ST.mode === 'surprise' ? '#ff3b5c' : '#ff6b9a'), 0, 0);
        Art.reset(x);
      }
      if (ST.mode === 'erase' && ST.cursor) {
        const r = BRUSH[ST.brush] * W * (m.w / Fx.frameGeom(m).cw);
        x.strokeStyle = '#fff'; x.lineWidth = 2; x.setLineDash([5, 4]);
        x.beginPath(); x.arc(ST.cursor[0], ST.cursor[1], r, 0, Math.PI * 2); x.stroke(); x.setLineDash([]);
      }
    }
    const sel = selectedHere();
    if (sel && ST.tab === 'words') {
      const [x0, y0, x1, y1] = Art.stickerRect(x, W, H, sel), hs = handlesOf(sel);
      x.strokeStyle = '#ffd23f'; x.lineWidth = Math.max(2, W / 400); x.setLineDash([8, 6]);
      x.strokeRect(x0, y0, x1 - x0, y1 - y0); x.setLineDash([]);
      for (const [k, glyph, col] of [['del', '✕', '#ff4d5e'], ['size', '⤡', '#ffd23f'], ['edit', '✎', '#5cc8ff']]) {
        const h = hs[k];
        if (!h) continue;
        x.fillStyle = col; x.beginPath(); x.arc(h[0], h[1], hs.r, 0, Math.PI * 2); x.fill();
        x.lineWidth = Math.max(2, hs.r * 0.16); x.strokeStyle = '#fff'; x.stroke();
        x.fillStyle = k === 'size' ? '#3a2200' : '#fff'; x.font = `900 ${Math.round(hs.r * 1.15)}px ${Art.FONT.round}`;
        x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(glyph, h[0], h[1] + hs.r * 0.06);
      }
    }
    if (ST.tab === 'look' && e.light === 'spot') {
      x.strokeStyle = '#ffd23f'; x.lineWidth = 3; x.beginPath(); x.arc(e.spot.x * W, e.spot.y * H, Math.max(10, W / 60), 0, Math.PI * 2); x.stroke();
    }
  }

  // ---------- touching the picture ----------
  // The chosen sticker, if it shows on this photo, and the round buttons around it (delete, resize, change words).
  function selectedHere() {
    if (!ST.sel || !onPhoto() || !ST.lib) return null;
    const s = ed().stickers.find((q) => q.id === ST.sel);
    return s && Fx.stickersAt(ST.lib, ST.cur).includes(s) ? s : null;
  }
  function handlesOf(s) {
    const c = $('#stCanvas'), W = c.width, H = c.height, r = 17 * (W / Math.max(1, c.getBoundingClientRect().width));
    const [x0, y0, x1, y1] = Art.stickerRect(c.getContext('2d'), W, H, s);
    const at = (x, y) => [clamp(x, r + 2, W - r - 2), clamp(y, r + 2, H - r - 2)];
    return { r, del: at(x1, y0), size: at(x1, y1), edit: s.kind === 'emoji' ? null : at(x0, y0) };
  }
  const near = (p, h, r) => !!h && Math.hypot(p[0] - h[0], p[1] - h[1]) <= r * 1.35;
  function deleteSticker(s) {
    const e = ed();
    e.stickers = e.stickers.filter((q) => q !== s);
    ST.sel = null;
    changed({ timeline: true }); renderPanel();
    toast('Deleted. Tap Undo to bring it back');
  }
  function editSticker(s) { const t = ask('New words', s.text); if (t) { s.text = t; changed(); } }
  function toCanvas(ev) {
    const c = $('#stCanvas'), r = c.getBoundingClientRect();
    return [((ev.clientX - r.left) * c.width) / Math.max(1, r.width), ((ev.clientY - r.top) * c.height) / Math.max(1, r.height)];
  }
  const ptrs = new Map();
  let drag = null;
  function onDown(ev) {
    if (Play.on) { Play.stop(); drawPreview(); return; }
    if (!onPhoto()) return;
    try { $('#stView').setPointerCapture(ev.pointerId); } catch (e) { /* fine */ }
    const p = toCanvas(ev);
    ptrs.set(ev.pointerId, p);
    const e = ed(), c = $('#stCanvas'), W = c.width, H = c.height;
    if (ST.tab === 'frame') {
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; drag = { kind: 'pinch', d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z0: e.frame.zoom || 1 }; return; }
      const g = Fx.frameGeom(S.movie);
      drag = { kind: 'frame', x: p[0], y: p[1], cx: g.cx / S.movie.w, cy: g.cy / S.movie.h };
      return;
    }
    if (ST.mode === 'erase') { beginStroke(p); drag = { kind: 'erase' }; return; }
    const spot = ST.tab === 'look' && e.light === 'spot';
    if (!ST.mode && !spot) {
      // The round buttons around the chosen sticker come first.
      const s0 = ST.tab === 'words' ? selectedHere() : null;
      if (s0) {
        const hs = handlesOf(s0);
        if (near(p, hs.del, hs.r)) { deleteSticker(s0); return; }
        if (near(p, hs.edit, hs.r)) { editSticker(s0); return; }
        if (near(p, hs.size, hs.r)) { drag = { kind: 'resize', s: s0, d0: Math.hypot(p[0] - s0.x * W, p[1] - s0.y * H) || 1, z0: s0.size }; return; }
      }
      // Any sticker on the picture can be picked up, from any tab: it opens Words.
      const x = c.getContext('2d'), list = Fx.stickersAt(ST.lib, ST.cur).slice().reverse();
      const hit = list.find((q) => { const [x0, y0, x1, y1] = Art.stickerRect(x, W, H, q); return p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1; });
      if (hit) {
        ST.sel = hit.id;
        if (ST.tab !== 'words') setTab('words'); else { renderPanel(); drawOverlay(); }
        drag = { kind: 'sticker', s: hit, x: p[0], y: p[1], sx: hit.x, sy: hit.y };
        return;
      }
      if (ST.tab === 'words' && ST.sel) { ST.sel = null; renderPanel(); drawOverlay(); }
    }
    if (spot) { drag = { kind: 'spot' }; e.spot.x = p[0] / W; e.spot.y = p[1] / H; drawPreview(); }
  }
  function onMove(ev) {
    if (!ptrs.has(ev.pointerId)) {
      if (ST.mode === 'erase' && ev.pointerType === 'mouse') { ST.cursor = toCanvas(ev); drawOverlay(); }
      return;
    }
    const p = toCanvas(ev);
    ptrs.set(ev.pointerId, p);
    if (!drag) return;
    const e = ed(), c = $('#stCanvas'), W = c.width, H = c.height;
    if (drag.kind === 'pinch' && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      e.frame.zoom = clamp((drag.z0 * Math.hypot(a[0] - b[0], a[1] - b[1])) / drag.d0, 1, 4);
      drawOverlay();
    } else if (drag.kind === 'frame') {
      e.frame.cx = clamp(drag.cx + (p[0] - drag.x) / W, 0, 1);
      e.frame.cy = clamp(drag.cy + (p[1] - drag.y) / H, 0, 1);
      drawOverlay();
    } else if (drag.kind === 'erase') strokeTo(p);
    else if (drag.kind === 'sticker') { drag.s.x = clamp(drag.sx + (p[0] - drag.x) / W, 0.02, 0.98); drag.s.y = clamp(drag.sy + (p[1] - drag.y) / H, 0.02, 0.98); drawPreview(); }
    else if (drag.kind === 'resize') { drag.s.size = clamp((drag.z0 * Math.hypot(p[0] - drag.s.x * W, p[1] - drag.s.y * H)) / drag.d0, 0.08, 0.8); drawPreview(); }
    else if (drag.kind === 'spot') { e.spot.x = clamp(p[0] / W, 0, 1); e.spot.y = clamp(p[1] / H, 0, 1); drawPreview(); }
  }
  function onUp(ev) {
    ptrs.delete(ev.pointerId);
    const d = drag;
    if (!d || (d.kind === 'pinch' && ptrs.size)) return;
    drag = null;
    if (d.kind === 'erase') endStroke();
    else if (d.kind === 'frame' || d.kind === 'pinch') frameDone();
    else if (d.kind === 'sticker' || d.kind === 'spot' || d.kind === 'resize') { changed(); if (d.kind === 'resize') renderPanel(); }
  }
  // Keep the stored frame inside the photo, then save.
  function frameDone() {
    const f = ed().frame, g = Fx.frameGeom(S.movie);
    f.cx = g.cx / S.movie.w; f.cy = g.cy / S.movie.h;
    changed();
    if (ST.tab === 'frame') renderPanel();
  }

  // ---------- magic eraser ----------
  let stroke = null;
  async function prepMask() { if (onPhoto()) await ST.lib.editMask(S.frames[ST.cur].id); }
  function brushDot(mask, p) {
    const c = $('#stCanvas'), [u, v] = Fx.M.pt(Fx.M.inv(photoT(c.width, c.height)), p[0], p[1]);
    const s = mask.width / S.movie.w, mx = u * s, my = v * s, r = BRUSH[ST.brush] * mask.width;
    const x = mask.getContext('2d'), g = x.createRadialGradient(mx, my, 0, mx, my, r);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.6, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.globalCompositeOperation = 'source-over'; x.fillStyle = g; x.beginPath(); x.arc(mx, my, r, 0, Math.PI * 2); x.fill();
  }
  function beginStroke(p) {
    const f = S.frames[ST.cur], mask = ST.lib.masks.get(f.id);
    if (!mask) { prepMask().then(() => drawOverlay()); return; }
    pushUndo({ kind: 'mask', id: f.id, img: mask.getContext('2d').getImageData(0, 0, mask.width, mask.height) });
    stroke = { id: f.id, mask, last: p };
    brushDot(mask, p); ST.cursor = p;
    drawPreview();
  }
  function strokeTo(p) {
    if (!stroke) return;
    const c = $('#stCanvas'), step = Math.max(2, BRUSH[ST.brush] * c.width * 0.35), [lx, ly] = stroke.last, d = Math.hypot(p[0] - lx, p[1] - ly);
    for (let s = step; s <= d; s += step) brushDot(stroke.mask, [lx + ((p[0] - lx) * s) / d, ly + ((p[1] - ly) * s) / d]);
    if (d >= step) stroke.last = p;
    ST.cursor = p;
    drawPreview();
  }
  async function endStroke() {
    if (!stroke) return;
    const id = stroke.id;
    stroke = null;
    await ST.lib.saveMask(id);
    ST.lib.dropKeys();
    changed({ timeline: true });
    ensureAnalysis();
  }
  async function clearMask() {
    if (!onPhoto()) return;
    const id = S.frames[ST.cur].id;
    pushUndo({ kind: 'mask', id, img: await maskShot(id) });
    await ST.lib.clearMask(id); await prepMask();
    ST.lib.dropKeys(); changed({ timeline: true });
  }
  async function copyToNext() {
    if (ST.cur >= count() - 1) { toast('This is the last photo'); return; }
    const a = S.frames[ST.cur].id, b = S.frames[ST.cur + 1].id;
    if (!ST.lib.hasMask(a)) { toast('Rub something out first'); return; }
    pushUndo({ kind: 'mask', id: b, img: await maskShot(b) });
    await ST.lib.copyMask(a, b);
    await select(ST.cur + 1);
    ST.lib.dropKeys(); changed({ timeline: true });
  }
  async function setMode(mode) {
    ST.mode = mode; ST.cursor = null;
    if (mode === 'erase') { await prepMask(); ensureAnalysis(); }
    renderPanel(); drawPreview();
  }
  async function findSurprises() {
    busyN++;
    let list = [];
    try { list = await ST.lib.findSurprises((p) => busy('Looking for surprises…', p)); }
    catch (e) { console.error(e); }
    finally { busy(null); }
    if (!list.length) { toast('No surprises found. Nice and tidy!'); return; }
    ST.surprises = list; ST.si = 0; ST.mode = 'surprise';
    await select(list[0].k);
  }
  async function nextSurprise(erase) {
    const s = ST.surprises && ST.surprises[ST.si];
    if (!s) return;
    if (erase) { pushUndo({ kind: 'mask', id: s.id, img: await maskShot(s.id) }); await ST.lib.addToMask(s.id, s.mask); ST.lib.dropKeys(); changed({ timeline: true }); }
    ST.si++;
    if (ST.si >= ST.surprises.length) { ST.mode = null; ST.surprises = null; toast(erase ? 'All cleaned up!' : 'Done'); renderPanel(); drawPreview(); return; }
    await select(ST.surprises[ST.si].k);
  }

  // ---------- panels ----------
  function renderTabs() {
    const nav = $('#stTabs');
    nav.innerHTML = '';
    for (const [id, emo, name] of TABS) {
      const b = el('button', 'st-tab' + (ST.tab === id ? ' on' : ''));
      b.append(el('span', 'emo', emo), el('span', null, name));
      b.onclick = () => { primeGestures(); setTab(id); };
      nav.appendChild(b);
    }
  }
  function setTab(id) {
    if (Play.on) Play.stop();
    ST.tab = id;
    if (ST.mode && id !== 'fix') { ST.mode = null; ST.surprises = null; }
    $$('#stTabs .st-tab').forEach((b, i) => b.classList.toggle('on', TABS[i][0] === id));
    renderPanel(); drawPreview();
  }
  function renderPanel() {
    const p = $('#stPanel'), top = p.scrollTop, build = PANELS[ST.tab];
    p.innerHTML = '';
    (build ? build() : []).flat().forEach((k) => k && p.appendChild(k));
    p.scrollTop = top;
  }
  const ask = (q, v) => { const r = prompt(q, v || ''); return r == null ? null : r.trim().slice(0, 80); };
  const pickPhotoFirst = () => [hint('Pick a photo in the strip first.')];

  const PANELS = {
    frame() {
      const f = ed().frame, upd = () => { drawOverlay(); };
      if (!onPhoto()) return pickPhotoFirst();
      return [
        sec('Shape', segEl([['orig', 'Camera'], ['wide', 'Wide'], ['tv', 'TV'], ['square', 'Square'], ['tall', 'Tall']], f.shape, (v) => { f.shape = v; frameDone(); drawPreview(); })),
        sec('Zoom', slider('Zoom', 1, 3, 0.01, f.zoom, (v) => { f.zoom = v; upd(); }, (v) => { f.zoom = v; frameDone(); })),
        sec('Straighten', slider('Turn', -10, 10, 0.1, ((f.rot || 0) * 180) / Math.PI, (v) => { f.rot = (v * Math.PI) / 180; upd(); }, (v) => { f.rot = (v * Math.PI) / 180; frameDone(); })),
        hint('Drag the yellow box to choose what shows in the movie. Pinch to zoom. The camera screen uses this same frame.'),
        row(btn('↺ Reset', () => { Object.assign(f, { shape: 'orig', zoom: 1, cx: 0.5, cy: 0.5, rot: 0 }); frameDone(); drawPreview(); })),
      ];
    },
    fix() {
      const e = ed(), out = [];
      out.push(sec('Fix the camera',
        toggle('Steady camera', 'Lines every photo up, so bumps and wobbles disappear.', e.steady, async (v) => {
          e.steady = v; changed({ keys: true });
          if (v) { await ensureAnalysis(); toast(steadyReport()); }
        }),
        toggle('Even out the light', 'Stops the picture flickering brighter and darker.', e.even, async (v) => { e.even = v; changed(); if (v) await ensureAnalysis(); })));
      const er = ST.mode === 'erase', plate = ST.lib && ST.lib.plate;
      const tools = [
        hint('Rub out things that should not be there, like a foot or a hand. The empty scene shows through.'),
        row(btn(er ? '✓ Done rubbing' : '🧽 Rub out', () => setMode(er ? null : 'erase'), er ? 'pill on' : 'pill'), btn('🔍 Find surprises', findSurprises)),
      ];
      if (er) {
        tools.push(
          labeled('Brush', segEl([[0, 'Small'], [1, 'Medium'], [2, 'Big']], ST.brush, (v) => { ST.brush = v; })),
          labeled('Fill with', segEl([['first', plate ? 'Empty set' : 'First photo'], ['before', 'Photo before']], e.fillFrom, (v) => { e.fillFrom = v; ST.lib.dropKeys(); changed(); })),
          row(btn('Clear this photo', clearMask, 'pill small'), btn('Same on next photo →', copyToNext, 'pill small')),
          hint('Rubbed the wrong spot? Tap Undo at the top.'));
      }
      if (ST.mode === 'surprise' && ST.surprises) {
        const s = ST.surprises[ST.si];
        tools.push(box(
          el('b', null, `Photo ${s.k + 1}: something poked in at the edge (${ST.si + 1} of ${ST.surprises.length}).`),
          row(btn('🧽 Erase it', () => nextSurprise(true), 'pill primary'), btn('Leave it', () => nextSurprise(false)), btn('Stop', () => { ST.mode = null; ST.surprises = null; renderPanel(); drawPreview(); }, 'pill small'))));
      }
      out.push(sec('Magic eraser', tools));
      return out;
    },
    scene() {
      const s = ed().scene, lib = ST.lib, out = [];
      const bgKids = [tiles(Art.BACKGROUNDS, s.bg, 'bg', async (id) => {
        s.bg = id; changed({ keys: true }); renderPanel();
        if (id === 'photo' && !lib.bgRec) choosePicture();
        if (id !== 'none' && lib.plate) ensureAnalysis();
      })];
      if (s.bg !== 'none') {
        if (!lib.plate) {
          bgKids.push(box('Magic backgrounds need a photo of your set with no toys in it, so the app can tell the toys from the room.',
            row(btn('📷 Take it with the camera', takePlate, 'pill primary'), btn('🧩 Make one from my photos', makePlate))));
        } else {
          bgKids.push(
            slider('Cut-out', 0, 1, 0.01, s.cut, (v) => { s.cut = v; ST.lib.dropKeys(); drawPreview(); }, (v) => { s.cut = v; changed({ keys: true }); }),
            hint('Slide right if parts of your toys disappear, left if shadows or bits of the room show.'),
            toggle('Shadows', 'Shows your toys’ shadows on the new background.', s.shadows !== false, (v) => { s.shadows = v; changed({ keys: true }); }),
            row(btn('📷 New empty photo', takePlate, 'pill small'), btn('🧩 Make from my photos', makePlate, 'pill small')));
          if (lib.plate.made) bgKids.push(hint('The empty set was made from your photos. For the cleanest cut-outs, take one with the camera.'));
        }
        if (s.bg === 'photo') bgKids.push(row(btn('🖼️ Choose a picture', choosePicture)));
      }
      out.push(sec('Magic background', bgKids));
      out.push(sec('Effects in front', tiles(Art.EFFECTS, s.fg, 'fx', (id) => { s.fg = id; changed(); })));
      return out;
    },
    look() {
      const e = ed(), out = [];
      out.push(sec('Colors', tiles(Art.LOOKS, e.look, 'look', (id) => { e.look = id; changed(); renderPanel(); }),
        e.look !== 'none' ? slider('Amount', 0.2, 1, 0.01, e.lookAmt, (v) => { e.lookAmt = v; drawPreview(); }, (v) => { e.lookAmt = v; changed(); }) : null));
      const lightKids = [tiles(Art.LIGHTS, e.light, 'light', (id) => { e.light = id; changed(); renderPanel(); })];
      if (e.light === 'spot') lightKids.push(slider('Size', 0.12, 0.6, 0.01, e.spot.r, (v) => { e.spot.r = v; drawPreview(); }, (v) => { e.spot.r = v; changed(); }), hint('Drag on the picture to move the light.'));
      if (e.light === 'lightning') lightKids.push(hint('Thunder rumbles with every flash.'));
      out.push(sec('Lights', lightKids));
      return out;
    },
    words() {
      if (!onPhoto()) return pickPhotoFirst();
      const e = ed(), f = S.frames[ST.cur], out = [];
      const add = (st) => { st.id = uid(); st.at = f.id; e.stickers.push(st); ST.sel = st.id; changed({ timeline: true }); renderPanel(); };
      const bubble = (kind, q) => { const t = ask(q, ''); if (t) add({ kind, text: t, x: 0.5, y: kind === 'caption' ? 0.88 : 0.28, size: 0.3, len: kind === 'caption' ? 10 : 6, tail: 'left' }); };
      out.push(sec('Add words', row(
        btn('💬 Talk', () => bubble('talk', 'What does it say?')), btn('💭 Think', () => bubble('think', 'What is it thinking?')),
        btn('📢 Shout', () => bubble('shout', 'What does it shout?')), btn('📝 Caption', () => bubble('caption', 'Words for the bottom of the screen')))));
      out.push(sec('Comic words', row(Art.WORDS.map(([w, col]) => btn(w, () => add({ kind: 'word', text: w, color: col, x: 0.5, y: 0.4, size: 0.3, len: 4 }), 'pill word')))));
      const grid = el('div', 'emoji-grid');
      Art.EMOJI.forEach((em) => grid.appendChild(btn(em, () => add({ kind: 'emoji', text: em, x: 0.5, y: 0.45, size: 0.2, len: 6 }), '')));
      out.push(sec('Stickers', grid));
      const s = e.stickers.find((q) => q.id === ST.sel);
      if (s) {
        const kids = [];
        if (s.kind !== 'emoji') kids.push(row(btn('✏️ Change words', () => { const t = ask('New words', s.text); if (t) { s.text = t; changed(); } }, 'pill small')));
        if (s.kind === 'talk' || s.kind === 'think') kids.push(row(btn('↔ Flip the tail', () => { s.tail = s.tail === 'right' ? 'left' : 'right'; changed(); }, 'pill small')));
        kids.push(slider('Size', 0.1, 0.7, 0.01, s.size, (v) => { s.size = v; drawPreview(); }, (v) => { s.size = v; changed(); }));
        kids.push(labeled('Shows for', segEl([[1, '1'], [3, '3'], [6, '6'], [12, '12'], [0, 'All']], s.len, (v) => { s.len = v; changed(); })));
        kids.push(row(btn('🗑 Delete', () => deleteSticker(s), 'pill danger small')));
        out.push(sec('This sticker', kids));
      } else {
        const here = Fx.stickersAt(ST.lib, ST.cur);
        if (here.length) out.push(sec('On this photo', row(here.map((q) => btn(q.kind === 'emoji' ? q.text : `${q.kind === 'word' ? '💥' : q.kind === 'caption' ? '📝' : '💬'} ${(q.text || '').slice(0, 14)}`, () => { ST.sel = q.id; renderPanel(); drawOverlay(); }, 'pill small')))));
      }
      out.push(hint('Tap a sticker on the picture to change it: drag it to move it, the yellow corner to make it bigger or smaller, ✕ to delete it, ✎ to change the words.'));
      return out;
    },
    sound() {
      const e = ed(), out = [];
      const clips = e.voices.map((v, i) => {
        const at = v.at === '#start' ? 'the start' : `photo ${(ST.lib.idx.get(v.at) ?? -1) + 1}`;
        return row(el('span', 'label', `🎤 Voice ${i + 1} · from ${at} · ${v.dur.toFixed(1)}s`), btn('🗑', () => deleteVoice(v), 'pill small danger'));
      });
      out.push(sec('Your voice', btn(onPhoto() ? `🎤 Record from photo ${ST.cur + 1}` : '🎤 Record from the start', recordVoice, 'pill primary'),
        hint('The movie plays while you talk, so you can say what the toys say. Tap Stop when you are done.'), clips));
      const mkids = [tiles(Sonic.TRACKS, e.music.track, 'emoji', (id) => { e.music.track = id; Sonic.previewMusic(id); changed({ timeline: true }); renderPanel(); })];
      if (e.music.track !== 'none') {
        const c = musicCredit();
        mkids.push(slider('Volume', 0.1, 1, 0.01, e.music.vol, () => {}, (v) => { e.music.vol = v; changed(); }));
        if (c) mkids.push(hint(`“${c.title}” by ${c.artist} (${c.note}). The music credit is added to the end of your movie.`));
      }
      out.push(sec('Music', mkids));
      const here = onPhoto() ? e.sounds.filter((s) => s.at === S.frames[ST.cur].id) : [];
      const grid = el('div', 'tiles sfx');
      Sonic.SFX.forEach((sfx) => {
        const b = el('button', 'tile');
        b.append(el('span', 'emo', sfx.icon), el('span', null, sfx.name));
        b.onclick = () => {
          primeGestures(); Sonic.preview(sfx.id);
          if (!onPhoto()) { toast('Pick a photo for the sound first'); return; }
          e.sounds.push({ id: uid(), kind: sfx.id, at: S.frames[ST.cur].id });
          changed({ timeline: true }); renderPanel();
        };
        grid.appendChild(b);
      });
      out.push(sec('Sound effects', hint(onPhoto() ? `Tap a sound to add it to photo ${ST.cur + 1}.` : 'Pick a photo, then tap a sound.'), grid,
        here.length ? row(here.map((s) => btn(`${(Sonic.SFX.find((q) => q.id === s.kind) || {}).icon || '🔊'} ✕`, () => { e.sounds = e.sounds.filter((q) => q !== s); changed({ timeline: true }); renderPanel(); }, 'pill small'))) : null));
      return out;
    },
    titles() {
      const e = ed(), t = e.title, c = e.credits, out = [];
      const tk = [toggle('Show a title at the start', null, t.on, (v) => { t.on = v; changed({ timeline: true }); renderPanel(); })];
      if (t.on) {
        tk.push(row(
          btn(`✏️ ${t.text || S.movie.name}`, () => { const v = ask('Title of your movie', t.text || S.movie.name); if (v != null) { t.text = v; changed(); renderPanel(); } }),
          btn(t.sub ? `✏️ ${t.sub}` : '➕ Add “by …”', () => { const v = ask('A line under the title', t.sub || `by ${c.director || ''}`.trim()); if (v != null) { t.sub = v; changed(); renderPanel(); } })));
        tk.push(tiles(Art.STYLES, t.style, 'title', (id) => { t.style = id; changed(); select(-1); }));
      }
      out.push(sec('Opening title', tk));
      out.push(sec('Curtains', toggle('Curtains open and close', 'Like a real theater.', e.curtains, (v) => { e.curtains = v; changed({ timeline: true }); renderPanel(); }),
        e.curtains ? toggle('Clapping at the end', null, e.applause, (v) => { e.applause = v; changed(); }) : null));
      const ck = [toggle('Show credits at the end', null, c.on, (v) => { c.on = v; changed({ timeline: true }); renderPanel(); })];
      if (c.on) {
        ck.push(row(btn(`🎬 Director: ${c.director || 'add a name'}`, () => { const v = ask('Who directed this movie?', c.director); if (v != null) { c.director = v; Settings.v.director = v; Settings.save(); changed({ timeline: true }); renderPanel(); } })));
        ck.push(row(btn(`⭐ Starring: ${c.cast || 'add names'}`, () => { const v = ask('Who is in it? Put commas between names.', c.cast); if (v != null) { c.cast = v; changed({ timeline: true }); renderPanel(); } })));
        ck.push(row(btn(`✏️ “${c.end || 'The End'}”`, () => { const v = ask('Last words', c.end || 'The End'); if (v != null) { c.end = v || 'The End'; changed(); renderPanel(); } })));
      }
      out.push(sec('Credits', ck));
      return out;
    },
    speed() {
      const e = ed(), out = [];
      out.push(sec('Speed', speed(S.movie.fps, (f) => { S.movie.fps = f; changed({ timeline: true }); renderPanel(); }),
        hint('Photos per second. Slide to the turtle for slow motion.')));
      out.push(sec('Smooth moves', segEl([[0, 'Off'], [1, 'Smooth'], [2, 'Extra smooth']], e.smooth || 0, async (v) => {
        e.smooth = v; changed({ timeline: true }); renderPanel();
        if (v && !e.steady) { e.steady = true; changed({ keys: true, merge: true }); toast('Steady camera is on too, so only the toys move'); await ensureAnalysis(); }
      }),
      hint('The app draws in-between pictures, so moves glide instead of jumping. Tap Play to see it.')));
      if (onPhoto()) {
        const f = S.frames[ST.cur], hold = e.holds[f.id] || 1;
        out.push(sec(`Photo ${ST.cur + 1}`,
          labeled('Hold it', segEl([[1, '1×'], [2, '2×'], [3, '3×'], [5, '5×']], hold, (v) => { if (v === 1) delete e.holds[f.id]; else e.holds[f.id] = v; changed({ timeline: true }); })),
          hint('Holding a photo makes that moment last longer, for a pause or a surprise.'),
          row(btn('📄 Copy photo', copyPhoto, 'pill small'), btn('🗑 Delete photo', deletePhoto, 'pill small danger'))));
      }
      out.push(sec('Fun', toggle('Boomerang', 'Plays forward, then backward.', e.boomerang, (v) => { e.boomerang = v; changed({ timeline: true }); })));
      out.push(hint(`Your movie is ${timelineNow().total.toFixed(1)} seconds long.`));
      return out;
    },
  };
  function steadyReport() {
    const lib = ST.lib, moved = S.frames.filter((f) => { const a = lib.alignOf(f.id); return Math.hypot(a.tx, a.ty) > 1.5 || Math.abs(Math.atan2(a.b, a.a)) > 0.002; }).length;
    return moved ? `Steady! ${moved} photo${moved === 1 ? ' was' : 's were'} nudged back into place` : 'Steady! Your camera was already nice and still';
  }

  // ---------- photos: copy and delete from here ----------
  async function copyPhoto() {
    const i = ST.cur, before = snap();
    await duplicateFrameAt(i);
    afterFramesChanged(i + 1);
    pushUndo({ kind: 'photo-add', id: S.frames[i + 1].id, state: before });
    toast('Copied! That moment now lasts longer');
  }
  async function deletePhoto() {
    const i = ST.cur, f = S.frames[i];
    if (!f) return;
    if (count() < 2) { toast('A movie needs at least one photo'); return; }
    const before = snap(), e = ed();
    e.stickers = e.stickers.filter((s) => s.at !== f.id); e.sounds = e.sounds.filter((s) => s.at !== f.id);
    e.voices.forEach((v) => { if (v.at === f.id) v.at = S.frames[i + 1] ? S.frames[i + 1].id : '#start'; });
    delete e.holds[f.id];
    H.last = snap();   // the photo entry below covers these changes too
    const gone = await takePhotoOut(f.id);
    pushUndo({ kind: 'photo-del', ...gone, state: before });
    toast('Photo deleted. Tap Undo to bring it back');
  }
  // Takes a photo out of the movie, keeping everything needed to put it back.
  async function takePhotoOut(id) {
    const index = S.frames.findIndex((f) => f.id === id);
    const rec = await DB.get('frames', id), aux = await DB.get('aux', `${S.movie.id}/fx/${id}`);
    await deleteFrameAt(index);
    ST.lib.recs.delete(id); ST.lib.masks.delete(id);
    afterFramesChanged(Math.min(index, count() - 1));
    return { rec, aux, index };
  }
  async function putPhotoBack({ rec, aux, index }) {
    const ids = [...S.movie.frames];
    ids.splice(index, 0, rec.id);
    S.movie = { ...S.movie, frames: ids, updated: Date.now() };
    await DB.saveFrame(rec, S.movie);
    if (aux) { await DB.put('aux', aux); ST.lib.recs.set(rec.id, aux); }
    ST.lib.masks.delete(rec.id);
    S.frames.splice(index, 0, toRuntime(rec));
    renderStrip(); refreshLast();   // the camera screen's strip too
    afterFramesChanged(index);
  }
  function afterFramesChanged(sel) {
    S.movie.edit = ed(); ST.lib.m = S.movie; ST.lib.setFrames(S.frames);
    ST.cur = clamp(sel, 0, count() - 1);
    changed({ timeline: true }); renderPanel();
  }

  // ---------- the timeline strip ----------
  function renderTimeline() {
    const strip = $('#stTime'), e = ed(), ar = S.movie.w ? S.movie.w / S.movie.h : 16 / 9;
    strip.innerHTML = '';
    const chip = (cls, emo, label, idx, on) => {
      const b = el('button', `st-chip ${cls}${on ? '' : ' off'}`);
      b.append(el('span', 'emo', emo), el('span', null, label));
      b.onclick = () => { primeGestures(); select(idx); };
      return b;
    };
    strip.appendChild(chip('title', '🎬', 'Title', -1, e.title.on));
    const marks = new Map();
    const mark = (id, m) => { if (!marks.has(id)) marks.set(id, new Set()); marks.get(id).add(m); };
    e.sounds.forEach((s) => mark(s.at, '🔊')); e.voices.forEach((v) => mark(v.at, '🎤')); e.stickers.forEach((s) => mark(s.at, '💬'));
    S.frames.forEach((f, i) => {
      const b = el('button', 'thumb st-thumb');
      b.style.width = `${Math.round(58 * ar)}px`;
      const img = el('img'); img.alt = ''; img.src = f.thumbUrl;
      b.append(img, el('span', null, String(i + 1)));
      const ms = [...(marks.get(f.id) || [])];
      if (e.holds[f.id] > 1) ms.unshift(`×${e.holds[f.id]}`);
      if (ST.lib && ST.lib.hasMask(f.id)) ms.push('✨');
      if (ms.length) b.appendChild(el('em', null, ms.join('')));
      b.onclick = () => { primeGestures(); select(i); };
      strip.appendChild(b);
    });
    strip.appendChild(chip('end', '🎞️', 'End', count(), e.credits.on || e.music.track !== 'none'));
    markCurrent(ST.cur, true);
  }
  function markCurrent(i, jump) {
    const kids = $('#stTime').children;
    for (let j = 0; j < kids.length; j++) kids[j].classList.toggle('sel', j - 1 === i);
    const k = kids[i + 1];
    if (k) {
      const strip = $('#stTime'), l = k.offsetLeft, r = l + k.offsetWidth;
      if (l < strip.scrollLeft + 20 || r > strip.scrollLeft + strip.clientWidth - 20) strip.scrollTo({ left: l - strip.clientWidth / 2 + k.offsetWidth / 2, behavior: jump ? 'auto' : 'smooth' });
    }
  }
  async function select(i) {
    if (Play.on) Play.stop();
    ST.cur = clamp(i, -1, count());
    if (ST.sel && !(onPhoto() && Fx.stickersAt(ST.lib, ST.cur).some((s) => s.id === ST.sel))) ST.sel = null;
    if (ST.mode === 'erase') await prepMask();
    markCurrent(ST.cur);
    renderPanel(); drawPreview();
  }

  // ---------- playing the movie ----------
  // Pictures that come from photos: a photo itself (also under the curtains), or an in-between of two photos.
  const picKey = (it) => (it.kind === 'tween' ? `${it.k}>${it.k2}@${it.f.toFixed(3)}` : it.k != null ? `p${it.k}` : null);
  function drawPic(x, W, H, it, keyRes) {
    return it.kind === 'tween' ? Fx.drawTween(x, W, H, ST.lib, it.k, it.k2, it.f, { keyRes }) : Fx.drawShot(x, W, H, ST.lib, it.k, { keyRes });
  }
  const Play = {
    on: false, list: [], tl: null, t0: 0, stallAt: 0, lastI: -1, cache: new Map(), spare: [], pending: null, buf: null, src: null, raf: 0, timer: 0, W: 0, H: 0, onEnd: null, muted: false,
    async start(from = 0, opts = {}) {
      this.stop();
      const tl = timelineNow(), list = Fx.items(tl);
      if (!list.length) return;
      Object.assign(this, { tl, list, muted: !!opts.muted, onEnd: opts.onEnd || null, lastI: -1, stallAt: 0, buf: null, on: true, token: {} });
      const token = this.token;
      setPlayBtn(true); drawOverlay();
      if (usesLineUp()) await ensureAnalysis();
      if (this.token !== token) return;
      // Pictures are drawn smaller while playing (more so with smooth moves), so they keep up with the clock.
      const [cw, ch] = sizeCanvases(outAspect(false)), sc = Math.min(1, (ed().smooth ? 640 : 960) / cw);
      this.W = Math.round(cw * sc); this.H = Math.round(ch * sc);
      this.cache.clear();
      // Get the first few pictures ready, and the sound, before the clock starts.
      const i0 = Fx.itemAt(list, from), first = [];
      for (let j = i0; j < list.length && first.length < 4; j++) { const key = picKey(list[j]); if (key && !first.some((q) => picKey(q) === key)) first.push(list[j]); }
      for (const it of first) { await this.render(it); if (this.token !== token) return; }
      if (!this.muted) {
        try { this.buf = await mixBuffer(); } catch (e) { console.warn(e); toast('The sound could not be made'); }
        if (this.token !== token) return;
      }
      this.t0 = performance.now() - from * 1000;
      this.startAudio(from);
      this.loop();
    },
    startAudio(at) { this.stopAudio(); if (this.buf && !this.muted) this.src = Sonic.playBuffer(this.buf, at); },
    stopAudio() { if (this.src) { Sonic.stopSource(this.src); this.src = null; } },
    stop() {
      const was = this.on;
      this.on = false; this.token = null;
      cancelAnimationFrame(this.raf); clearTimeout(this.timer);
      this.stopAudio();
      for (const c of this.cache.values()) this.spare.push(c);
      this.cache.clear();
      setPlayBtn(false);
      return was;
    },
    next() {
      cancelAnimationFrame(this.raf); clearTimeout(this.timer);
      this.raf = requestAnimationFrame(() => this.loop());
      this.timer = setTimeout(() => this.loop(), 40); // keeps going where animation frames are paused
    },
    loop() {
      if (!this.on) return;
      const now = performance.now(), t = (now - this.t0) / 1000;
      if (t >= this.tl.total) { this.finish(); return; }
      const i = Fx.itemAt(this.list, t), it = this.list[i];
      const key = picKey(it);
      if (key && !this.cache.has(key)) {
        // A late in-between is skipped (the last picture stays up); a photo is worth waiting for.
        if (it.kind === 'tween') { this.pump(i); this.next(); return; }
        if (!this.stallAt) { this.stallAt = now; this.stopAudio(); }
        this.pump(i); this.next(); return;
      }
      if (this.stallAt) { this.t0 += now - this.stallAt; this.stallAt = 0; this.startAudio((now - this.t0) / 1000); }
      if (i !== this.lastI) { this.paint(it); this.lastI = i; if (it.k != null) markCurrent(it.k); }
      this.pump(i);
      this.next();
    },
    paint(it) {
      const c = $('#stCanvas'), x = c.getContext('2d'), W = c.width, H = c.height;
      Art.reset(x);
      if (it.kind === 'title') Art.drawTitle(x, W, H, titleOf(), it.u);
      else if (it.kind === 'credits') Art.drawCredits(x, W, H, ed(), it.u, musicCredit());
      else {
        x.drawImage(this.cache.get(picKey(it)), 0, 0, W, H);
        if (it.kind === 'open') Art.drawCurtains(x, W, H, it.u / this.tl.open);
        else if (it.kind === 'close') Art.drawCurtains(x, W, H, 1 - it.u / this.tl.close);
      }
    },
    // Draws upcoming pictures ahead of time, one at a time, and lets go of old ones.
    pump(i) {
      const want = [], next = [], ahead = ed().smooth ? 16 : 8;   // in-betweens come thick and fast: get further ahead
      for (let j = i; j < this.list.length && want.length < ahead; j++) {
        const key = picKey(this.list[j]);
        if (key && !want.includes(key)) { want.push(key); next.push(this.list[j]); }
      }
      for (const [key, c] of this.cache) if (!want.includes(key) && this.cache.size > ahead + 2) { this.cache.delete(key); this.spare.push(c); }
      if (this.pending) return;
      // Next to draw: the soonest picture not drawn yet, leaving out in-betweens that are already due.
      const due = (performance.now() - this.t0) / 1000 + 0.03;
      const it = next.find((q) => !this.cache.has(picKey(q)) && !(this.stallAt === 0 && q.kind === 'tween' && q.t < due));
      if (it) this.render(it);
    },
    render(it) {
      const key = picKey(it);
      if (this.cache.has(key)) return Promise.resolve();
      if (this.pending) return this.pending.then(() => this.render(it));
      const token = this.token;
      this.pending = (async () => {
        const c = this.spare.pop() || document.createElement('canvas');
        if (c.width !== this.W || c.height !== this.H) { c.width = this.W; c.height = this.H; }
        await drawPic(c.getContext('2d'), this.W, this.H, it, 320);
        if (this.token === token && this.on) this.cache.set(key, c); else this.spare.push(c);
      })().catch((e) => console.error(e)).finally(() => { this.pending = null; });
      return this.pending;
    },
    finish() {
      const cb = this.onEnd;
      this.stop();
      if (cb) cb(); else drawPreview();
    },
  };
  function setPlayBtn(on) {
    const b = $('#stPlay');
    if (!b) return;
    b.innerHTML = `${icon(on ? 'pause' : 'play')}<span>${on ? 'Stop' : 'Play'}</span>`;
    b.classList.toggle('on', on);
  }
  function togglePlay() {
    primeGestures(); Sonic.stopPreview();
    if (Play.stop()) { drawPreview(); return; }
    ST.mode = ST.mode === 'erase' ? null : ST.mode;
    Play.start(0);
  }

  // ---------- recording a voice ----------
  let REC = null;
  async function recordVoice() {
    Play.stop(); Sonic.stopPreview();
    if (REC) return;
    let mic;
    try { mic = await Sonic.openMic(); }
    catch (e) { toast(e && e.name === 'NotAllowedError' ? 'The microphone is blocked. A grown-up can allow it in Settings.' : (e.message || 'No microphone found')); return; }
    const at = onPhoto() ? S.frames[ST.cur].id : '#start', tl = timelineNow(), from = at === '#start' ? 0 : tl.firstAt[at];
    REC = { mic, at, stopped: false };
    const bar = $('#recBar'), cnt = $('#recCount');
    bar.hidden = false; $('#recText').textContent = 'Get ready…';
    for (let i = 3; i >= 1; i--) {
      cnt.textContent = String(i); cnt.hidden = false; cnt.classList.remove('pop'); void cnt.offsetWidth; cnt.classList.add('pop');
      Sound.beep();
      await sleep(800);
      if (REC.stopped) { mic.close(); bar.hidden = true; cnt.hidden = true; REC = null; return; }
    }
    cnt.hidden = true;
    mic.begin();
    $('#recText').textContent = 'Recording… talk now!';
    const meter = () => { if (!REC) return; $('#recLevel').style.width = `${Math.round(Math.min(1, mic.level() * 2.5) * 100)}%`; setTimeout(meter, 80); };
    meter();
    Play.start(from, { muted: true, onEnd: finishRec });
  }
  async function finishRec() {
    if (!REC || REC.finishing) return;
    if (!REC.mic || !$('#recCount').hidden) { REC.stopped = true; return; } // still counting down
    REC.finishing = true;
    Play.stop();
    const r = REC, res = await r.mic.stop();
    $('#recBar').hidden = true;
    REC = null;
    if (!res || !res.blob.size || res.secs < 0.4) { toast('Nothing was recorded'); drawPreview(); return; }
    const id = uid();
    await DB.put('aux', { id: `${S.movie.id}/voice/${id}`, blob: res.blob });
    ed().voices.push({ id, at: r.at, dur: res.secs, vol: 1 });
    changed({ timeline: true }); renderPanel();
    toast('Got it! Tap Play to hear your movie');
  }
  function deleteVoice(v) {
    const e = ed();
    e.voices = e.voices.filter((q) => q !== v);
    changed({ timeline: true }); renderPanel();
    toast('Recording deleted. Tap Undo to bring it back');
  }
  // Recordings no longer in the movie are thrown away when the Studio closes (until then Undo can bring them back).
  async function dropUnusedVoices(m) {
    try {
      const keep = new Set(m.edit.voices.map((v) => `${m.id}/voice/${v.id}`));
      const keys = await DB.run('aux', 'readonly', (tx) => { const r = tx.objectStore('aux').getAllKeys(IDBKeyRange.bound(`${m.id}/voice/`, `${m.id}/voice/\uffff`)); return () => r.result; });
      const gone = keys.filter((k) => !keep.has(k));
      if (gone.length) await DB.run('aux', 'readwrite', (tx) => { const st = tx.objectStore('aux'); gone.forEach((k) => st.delete(k)); });
    } catch (e) { /* tidying up can wait */ }
  }

  // ---------- empty set + own picture ----------
  function takePlate() { const id = S.movie.id; close(); openMovie(id, { plate: true }); }
  async function makePlate() {
    busyN++;
    try { await ST.lib.makePlate((p) => busy('Making the empty set…', p)); toast('Empty set made from your photos'); }
    catch (e) { toast(e.message || 'Could not make it'); }
    finally { busy(null); }
    changed({ keys: true }); renderPanel();
  }
  function choosePicture() {
    pickImage(async (blob) => {
      await ST.lib.setBgPhoto(blob);
      ed().scene.bg = 'photo';
      changed({ keys: true }); renderPanel();
    });
  }

  // ---------- making the video ----------
  function setExportProgress(p) { $('#exportBar').style.width = `${Math.round(clamp(p, 0, 1) * 100)}%`; }
  function exportSize() {
    const g = Fx.frameGeom(S.movie), A = g.cw / g.ch;
    let W = clamp(Math.round(g.cw), 720, 1920), H = W / A;
    if (H > 1920) { H = 1920; W = H * A; }
    return [Math.round(W / 2) * 2, Math.round(H / 2) * 2];
  }
  async function makeVideo() {
    primeGestures(); Play.stop(); Sonic.stopPreview();
    if (!count()) return;
    $('#exportBox').hidden = false; $('#saveVideo').hidden = true;
    $('#exportTitle').textContent = 'Making your movie…';
    $('#exportMsg').textContent = 'Keep this screen open.';
    setExportProgress(0);
    if (!S.exportBlob) {
      try {
        if (usesLineUp() && ST.lib.needsAnalysis()) await ST.lib.analyze((p) => setExportProgress(p * 0.1));
        S.exportBlob = await exportMovie((p) => setExportProgress(0.1 + p * 0.9));
      } catch (e) {
        console.error(e);
        $('#exportTitle').textContent = 'The video could not be made';
        $('#exportMsg').textContent = String((e && e.message) || e);
        return;
      }
    }
    setExportProgress(1);
    const tl = timelineNow(), mb = (S.exportBlob.size / 1e6).toFixed(1);
    $('#exportTitle').textContent = 'Your movie is ready!';
    $('#exportMsg').textContent = `${count()} photos · ${tl.total.toFixed(1)} seconds · ${mb} MB`;
    $('#saveLabel').textContent = navigator.canShare ? 'Save to Photos' : 'Download';
    $('#saveVideo').hidden = false;
  }
  async function exportMovie(onP) {
    const tl = timelineNow(), list = Fx.items(tl), [W, H] = exportSize();
    const wantSound = hasSound(mixPlan(48000, 2)), acfg = wantSound ? await Sonic.aacConfig() : null;
    const canEncode = !!(window.VideoEncoder && window.VideoFrame);
    if (canEncode && (!wantSound || acfg)) {
      try { return await encodeWebCodecs(tl, list, W, H, acfg, onP); }
      catch (e) { console.warn('WebCodecs export failed, trying the slower way', e); }
    }
    if (window.MediaRecorder && HTMLCanvasElement.prototype.captureStream) return recordRealtime(tl, list, W, H, wantSound, onP);
    if (canEncode) return encodeWebCodecs(tl, list, W, H, null, onP);
    throw new Error('This browser can’t make videos. Try updating the iPad.');
  }
  // Draws picture number i of the video into x (comp keeps the last photo, for curtain moments).
  async function drawItem(x, W, H, it, tl, comp) {
    Art.reset(x);
    if (it.kind === 'title') Art.drawTitle(x, W, H, titleOf(), it.u);
    else if (it.kind === 'credits') Art.drawCredits(x, W, H, ed(), it.u, musicCredit());
    else if (it.kind === 'tween') await Fx.drawTween(x, W, H, ST.lib, it.k, it.k2, it.f, { keyRes: 640 });
    else {
      if (comp.k !== it.k) { await Fx.drawShot(comp.c.getContext('2d'), W, H, ST.lib, it.k, { keyRes: 640 }); comp.k = it.k; }
      Art.reset(x); x.drawImage(comp.c, 0, 0);
      if (it.kind === 'open') Art.drawCurtains(x, W, H, it.u / tl.open);
      else if (it.kind === 'close') Art.drawCurtains(x, W, H, 1 - it.u / tl.close);
    }
  }
  async function encodeWebCodecs(tl, list, W, H, acfg, onP) {
    await loadScript(MUXER_URL);
    const { Muxer, ArrayBufferTarget } = window.Mp4Muxer;
    const mbs = Math.ceil(W / 16) * Math.ceil(H / 16), level = mbs <= 3600 ? '1f' : mbs <= 8192 ? '28' : '33';
    const bitrate = Math.round(clamp(W * H * 5, 3e6, 12e6));
    const candidates = [['avc1.6400' + level, 'avc'], ['avc1.4d00' + level, 'avc'], ['avc1.42e0' + level, 'avc'], ['vp09.00.40.08', 'vp9'], ['av01.0.08M.08', 'av1']];
    let chosen = null;
    for (const [codec, mux] of candidates) {
      const cfg = { codec, width: W, height: H, bitrate, framerate: 30 };
      if (mux === 'avc') cfg.avc = { format: 'avc' };
      try { const s = await VideoEncoder.isConfigSupported(cfg); if (s.supported) { chosen = { cfg, mux }; break; } } catch (e) { /* try the next one */ }
    }
    if (!chosen) throw new Error('No video encoder available');
    // No frameRate here: photos last different times, so the file keeps exact timings.
    const muxer = new Muxer({
      target: new ArrayBufferTarget(), video: { codec: chosen.mux, width: W, height: H },
      audio: acfg ? { codec: 'aac', numberOfChannels: acfg.numberOfChannels, sampleRate: acfg.sampleRate } : undefined,
      fastStart: 'in-memory', firstTimestampBehavior: 'offset',
    });
    let encErr = null;
    const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
    enc.configure(chosen.cfg);
    const canvas = document.createElement('canvas'), comp = { c: document.createElement('canvas'), k: -1 };
    canvas.width = comp.c.width = W; canvas.height = comp.c.height = H;
    const x = canvas.getContext('2d'), audioShare = acfg ? 0.15 : 0;
    let lastKey = -9;
    for (let i = 0; i < list.length; i++) {
      if (encErr) throw encErr;
      const it = list[i];
      await drawItem(x, W, H, it, tl, comp);
      const key = i === 0 || it.t - lastKey >= 2;
      if (key) lastKey = it.t;
      const vf = new VideoFrame(canvas, { timestamp: Math.round(it.t * 1e6), duration: Math.max(1, Math.round(it.d * 1e6)) });
      enc.encode(vf, { keyFrame: key });
      vf.close();
      while (enc.encodeQueueSize > 4) await sleep(3);
      if (i % 3 === 0) { onP(((i + 1) / list.length) * (1 - audioShare)); await sleep(0); }
    }
    await enc.flush();
    if (encErr) throw encErr;
    enc.close();
    if (acfg) {
      onP(1 - audioShare * 0.8);
      const buf = await mixBuffer(acfg.sampleRate, acfg.numberOfChannels);
      if (buf) await Sonic.encodeAAC(muxer, buf, acfg);
    }
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  }
  // For iPads without the fast encoder: play the movie onto a canvas and record it in real time.
  async function recordRealtime(tl, list, W, H, wantSound, onP) {
    const types = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
    const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const canvas = document.createElement('canvas'), comp = { c: document.createElement('canvas'), k: -1 };
    canvas.width = comp.c.width = W; canvas.height = comp.c.height = H;
    const x = canvas.getContext('2d');
    // Draw every photo first, so the real-time pass only has to copy pictures.
    const shots = new Map(), pics = [];
    list.forEach((it) => { const key = picKey(it); if (key && !pics.some((q) => picKey(q) === key)) pics.push(it); });
    for (let j = 0; j < pics.length; j++) {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      await drawPic(c.getContext('2d'), W, H, pics[j], 640);
      shots.set(picKey(pics[j]), await createImageBitmap(c).catch(() => c));
      onP((0.5 * (j + 1)) / pics.length);
    }
    const tracks = [...canvas.captureStream(30).getVideoTracks()];
    let src = null;
    if (wantSound) {
      const buf = await mixBuffer(48000, 2);
      Sound.unlock();
      if (buf && Sound.ctx && Sound.ctx.createMediaStreamDestination) {
        const dest = Sound.ctx.createMediaStreamDestination();
        src = Sound.ctx.createBufferSource(); src.buffer = buf; src.connect(dest);
        tracks.push(...dest.stream.getAudioTracks());
      }
    }
    const rec = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime, videoBitsPerSecond: 8e6 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((r) => { rec.onstop = r; });
    const paint = (it) => {
      Art.reset(x);
      if (it.kind === 'title') Art.drawTitle(x, W, H, titleOf(), it.u);
      else if (it.kind === 'credits') Art.drawCredits(x, W, H, ed(), it.u, musicCredit());
      else { x.drawImage(shots.get(picKey(it)), 0, 0, W, H); if (it.kind === 'open') Art.drawCurtains(x, W, H, it.u / tl.open); else if (it.kind === 'close') Art.drawCurtains(x, W, H, 1 - it.u / tl.close); }
    };
    paint(list[0]);
    rec.start(500);
    if (src) src.start();
    const t0 = performance.now();
    for (let i = 0; i < list.length; i++) {
      const wait = t0 + list[i].t * 1000 - performance.now();
      if (wait > 0) await sleep(wait);
      paint(list[i]);
      onP(0.5 + (0.5 * (i + 1)) / list.length);
    }
    await sleep(Math.max(0, t0 + tl.total * 1000 - performance.now()) + 150);
    rec.stop();
    if (src) try { src.stop(); } catch (e) { /* done */ }
    await stopped;
    return new Blob(chunks, { type: (rec.mimeType || mime || 'video/mp4').split(';')[0] });
  }
  async function saveVideo() {
    const blob = S.exportBlob;
    if (!blob) return;
    const ext = blob.type.includes('webm') ? 'webm' : 'mp4';
    const base = (S.movie.name || 'movie').replace(/[^\w\- ]+/g, '').trim() || 'movie';
    const file = new File([blob], `${base}.${ext}`, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ---------- opening and closing ----------
  async function open(opts = {}) {
    Fx.ensureEdit(S.movie);
    show('studio');
    ST.lib = new Fx.Lib(S.movie, S.frames);
    Object.assign(ST, { cur: count() ? 0 : -1, sel: null, mode: null, surprises: null, mix: null, mixKey: '', cursor: null });
    Object.assign(H, { undo: [], redo: [], last: snap(), busy: false });
    undoButtons();
    $('#stName').textContent = S.movie.name;
    $('#exportBox').hidden = true; $('#recBar').hidden = true;
    setPlayBtn(false); renderTabs(); renderTimeline(); renderPanel(); updateLen();
    await ST.lib.load();
    renderTimeline();
    if (opts.autoplay) Play.start(0); else drawPreview();
    if (usesLineUp()) ensureAnalysis();
  }
  function close() {
    Play.stop(); Sonic.stopPreview();
    if (REC) { REC.stopped = true; if (REC.mic) REC.mic.close(); REC = null; }
    save(true);
    if (S.movie) dropUnusedVoices(S.movie);
    H.undo = []; H.redo = [];
    ST.lib = null; ST.mode = null; ST.surprises = null; ST.mix = null; ST.mixKey = '';
    $('#exportBox').hidden = true; $('#recBar').hidden = true;
  }
  function rename() {
    const v = ask('Name your movie', S.movie.name);
    if (!v) return;
    S.movie.name = v;
    $('#stName').textContent = v;
    changed();
  }
  function wire() {
    $('#stHome').onclick = () => { close(); leaveShoot(); };
    $('#stCam').onclick = () => { const id = S.movie.id; close(); openMovie(id); };
    $('#stName').onclick = rename;
    $('#stPlay').onclick = togglePlay;
    $('#stMake').onclick = makeVideo;
    $('#stUndo').onclick = undo;
    $('#stRedo').onclick = redo;
    $('#saveVideo').onclick = saveVideo;
    $('#exportClose').onclick = () => { $('#exportBox').hidden = true; };
    $('#recStop').onclick = finishRec;
    $('#recCount').addEventListener('animationend', () => $('#recCount').classList.remove('pop'));
    const v = $('#stView');
    v.addEventListener('pointerdown', onDown);
    v.addEventListener('pointermove', onMove);
    v.addEventListener('pointerup', onUp);
    v.addEventListener('pointercancel', onUp);
    v.addEventListener('pointerleave', () => { if (ST.cursor && !drag) { ST.cursor = null; drawOverlay(); } });
    window.addEventListener('resize', () => { if (S.screen === 'studio' && !Play.on) drawPreview(); });
  }
  function onKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedHere()) { e.preventDefault(); deleteSticker(selectedHere()); }
    else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'Escape') { if (Play.stop()) drawPreview(); $('#exportBox').hidden = true; }
    else if (e.key === 'ArrowRight') select(ST.cur + 1);
    else if (e.key === 'ArrowLeft') select(ST.cur - 1);
  }
  function onHidden() { if (Play.stop()) drawPreview(); if (REC) finishRec(); }

  return {
    open, close, wire, onKey, onHidden, Play, select, setTab, mixBuffer, exportMovie, undo, redo,
    ui: { el, btn, sec, row, hint, box, toggle, segEl, labeled, slider, tiles, speed },
    get state() { return ST; },
  };
})();
