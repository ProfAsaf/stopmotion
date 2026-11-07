'use strict';
/* Stop Motion: sound for movies. Music tracks (files in music/), sound effects made
   from scratch with Web Audio, voice recording, and the final mix. The mix is
   rendered offline, so the saved video sounds exactly like the preview. */
const Sonic = (() => {
  const TRACKS = [
    { id: 'none', name: 'No music', icon: '🔇' },
    { id: 'happy', name: 'Happy', icon: '😄', title: 'Monkeys Spinning Monkeys' },
    { id: 'silly', name: 'Silly', icon: '🤪', title: 'Fluffing a Duck' },
    { id: 'sneaky', name: 'Sneaky', icon: '🕵️', title: 'Sneaky Snitch' },
    { id: 'adventure', name: 'Adventure', icon: '⚔️', title: 'Heroic Age' },
    { id: 'chase', name: 'Chase', icon: '🏃', title: 'Run Amok' },
    { id: 'spooky', name: 'Spooky', icon: '👻', title: 'Scheming Weasel (faster version)' },
    { id: 'mystery', name: 'Mystery', icon: '🔍', title: 'Investigations' },
    { id: 'magic', name: 'Magic', icon: '🧚', title: 'Dance of the Sugar Plum Fairies' },
    { id: 'space', name: 'Space', icon: '🚀', title: 'Space Fighter Loop' },
    { id: 'calm', name: 'Calm', icon: '🌤️', title: 'Carefree' },
    { id: 'game', name: 'Video game', icon: '👾', title: 'Itty Bitty 8 Bit' },
  ];
  const SFX = [
    ['boing', 'Boing', '🦘'], ['pop', 'Pop', '🎈'], ['whoosh', 'Whoosh', '💨'], ['boom', 'Boom', '💥'],
    ['crash', 'Crash', '🥁'], ['zap', 'Zap', '⚡'], ['ding', 'Ding', '🔔'], ['drumroll', 'Drum roll', '🪘'],
    ['tada', 'Ta-da!', '🎺'], ['applause', 'Clapping', '👏'], ['splash', 'Splash', '💦'], ['up', 'Slide up', '⬆️'],
    ['down', 'Slide down', '⬇️'], ['honk', 'Honk', '📯'], ['magic', 'Magic', '✨'], ['sad', 'Sad trombone', '😢'],
    ['steps', 'Footsteps', '👣'], ['thunder', 'Thunder', '⛈️'], ['tick', 'Tick tock', '⏰'], ['heart', 'Heartbeat', '💓'],
  ].map(([id, name, icon]) => ({ id, name, icon }));
  const ARTIST = 'Kevin MacLeod', NOTE = 'incompetech.com · CC BY 4.0';
  const credit = (id) => { const t = TRACKS.find((x) => x.id === id); return t && t.title ? { title: t.title, artist: ARTIST, note: NOTE } : null; };
  const OAC = () => window.OfflineAudioContext || window.webkitOfflineAudioContext;

  // ---------- building blocks ----------
  const noiseBufs = new WeakMap();
  function noiseBuf(c) {
    let b = noiseBufs.get(c);
    if (!b) {
      b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = b.getChannelData(0);
      let s = 12345;
      for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; d[i] = (s / 2147483647) * 2 - 1; }
      noiseBufs.set(c, b);
    }
    return b;
  }
  function env(g, t, peak, a, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function tone(c, out, t, { type = 'sine', f0, f1 = 0, dur = 0.3, vol = 0.3, a = 0.005, glide = 0 }) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + (glide || dur));
    env(g, t, vol, a, dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + a + dur + 0.05);
    return o;
  }
  function hiss(c, out, t, { dur = 0.3, vol = 0.3, type = 'bandpass', f = 1000, f1 = 0, q = 1, a = 0.004, off = 0 }) {
    const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noiseBuf(c);
    fl.type = type; fl.frequency.setValueAtTime(f, t); if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur); fl.Q.value = q;
    env(g, t, vol, a, dur);
    s.connect(fl); fl.connect(g); g.connect(out);
    s.start(t, off % 1.5); s.stop(t + a + dur + 0.05);
  }
  const note = (n) => 440 * Math.pow(2, (n - 69) / 12);

  // ---------- sound effects ----------
  const PLAY = {
    boing(c, o, t) {
      const osc = c.createOscillator(), lfo = c.createOscillator(), depth = c.createGain(), g = c.createGain();
      osc.type = 'triangle'; osc.frequency.setValueAtTime(260, t); osc.frequency.linearRampToValueAtTime(420, t + 0.5);
      lfo.frequency.value = 13; depth.gain.setValueAtTime(160, t); depth.gain.exponentialRampToValueAtTime(5, t + 0.6);
      lfo.connect(depth); depth.connect(osc.frequency);
      env(g, t, 0.5, 0.004, 0.65); osc.connect(g); g.connect(o);
      osc.start(t); lfo.start(t); osc.stop(t + 0.75); lfo.stop(t + 0.75);
    },
    pop(c, o, t) { tone(c, o, t, { f0: 900, f1: 220, dur: 0.08, vol: 0.55 }); hiss(c, o, t, { dur: 0.03, vol: 0.25, f: 2500, q: 0.7 }); },
    whoosh(c, o, t) {
      const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
      s.buffer = noiseBuf(c); fl.type = 'bandpass'; fl.Q.value = 1.4;
      fl.frequency.setValueAtTime(300, t); fl.frequency.exponentialRampToValueAtTime(2600, t + 0.28); fl.frequency.exponentialRampToValueAtTime(500, t + 0.55);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.7, t + 0.25); g.gain.linearRampToValueAtTime(0.0001, t + 0.6);
      s.connect(fl); fl.connect(g); g.connect(o); s.start(t, 0.3); s.stop(t + 0.65);
    },
    curtain(c, o, t) {
      const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
      s.buffer = noiseBuf(c); fl.type = 'lowpass'; fl.frequency.setValueAtTime(500, t); fl.frequency.linearRampToValueAtTime(1500, t + 0.7); fl.frequency.linearRampToValueAtTime(400, t + 1.3);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35, t + 0.5); g.gain.linearRampToValueAtTime(0.0001, t + 1.35);
      s.connect(fl); fl.connect(g); g.connect(o); s.start(t, 0.7); s.stop(t + 1.4);
    },
    boom(c, o, t) { tone(c, o, t, { f0: 130, f1: 32, dur: 0.9, vol: 0.9, a: 0.004 }); hiss(c, o, t, { dur: 0.7, vol: 0.6, type: 'lowpass', f: 900, f1: 120, q: 0.5 }); },
    crash(c, o, t) { hiss(c, o, t, { dur: 1.5, vol: 0.45, type: 'highpass', f: 5000, q: 0.5 }); hiss(c, o, t, { dur: 0.9, vol: 0.3, f: 8000, q: 0.8, off: 0.4 }); },
    zap(c, o, t) { tone(c, o, t, { type: 'square', f0: 1600, f1: 110, dur: 0.28, vol: 0.18 }); tone(c, o, t, { type: 'sawtooth', f0: 1200, f1: 90, dur: 0.28, vol: 0.12 }); },
    ding(c, o, t) { [[1046, 0.32], [2093 * 1.003, 0.12], [3135, 0.06]].forEach(([f, v]) => tone(c, o, t, { f0: f, dur: 1.3, vol: v, a: 0.002 })); },
    drumroll(c, o, t) {
      for (let i = 0; i < 34; i++) hiss(c, o, t + i * 0.045, { dur: 0.06, vol: 0.12 + (i / 34) * 0.3, f: 1800, q: 0.9, off: i * 0.07 });
      PLAY.crash(c, o, t + 1.55); tone(c, o, t + 1.55, { f0: 150, f1: 50, dur: 0.4, vol: 0.6 });
    },
    tada(c, o, t) {
      const chord = (t0, dur, notes) => notes.forEach((n) => {
        const osc = c.createOscillator(), fl = c.createBiquadFilter(), g = c.createGain();
        osc.type = 'sawtooth'; osc.frequency.value = note(n); fl.type = 'lowpass'; fl.frequency.setValueAtTime(900, t0); fl.frequency.linearRampToValueAtTime(3200, t0 + 0.08); fl.frequency.linearRampToValueAtTime(1800, t0 + dur);
        g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.09, t0 + 0.03); g.gain.setValueAtTime(0.09, t0 + dur - 0.1); g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(fl); fl.connect(g); g.connect(o); osc.start(t0); osc.stop(t0 + dur + 0.05);
      });
      chord(t, 0.14, [67, 72, 76]); chord(t + 0.2, 1.0, [72, 76, 79, 84]);
    },
    applause(c, o, t) {
      let s = 7;
      const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      const dur = 2.8;
      for (let x = 0; x < dur; x += 0.012 + r() * 0.02) {
        const swell = Math.min(1, x / 0.5) * Math.min(1, (dur - x) / 1.2);
        hiss(c, o, t + x, { dur: 0.025 + r() * 0.02, vol: 0.05 + 0.13 * swell * r(), f: 900 + r() * 1800, q: 1.2, off: r() * 1.4 });
      }
    },
    splash(c, o, t) {
      hiss(c, o, t, { dur: 0.8, vol: 0.6, type: 'lowpass', f: 3000, f1: 300, q: 0.4 });
      for (let i = 0; i < 6; i++) tone(c, o, t + 0.1 + i * 0.09, { f0: 500 + i * 140, f1: 1100 + i * 180, dur: 0.06, vol: 0.12 });
    },
    up(c, o, t) { tone(c, o, t, { f0: 330, f1: 1320, dur: 0.55, vol: 0.32, a: 0.03 }); },
    down(c, o, t) { tone(c, o, t, { f0: 1320, f1: 300, dur: 0.6, vol: 0.32, a: 0.03 }); },
    honk(c, o, t) {
      [330, 415].forEach((f) => {
        const osc = c.createOscillator(), fl = c.createBiquadFilter(), g = c.createGain();
        osc.type = 'square'; osc.frequency.setValueAtTime(f, t); osc.frequency.linearRampToValueAtTime(f * 0.94, t + 0.4);
        fl.type = 'lowpass'; fl.frequency.value = 1400;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + 0.02); g.gain.setValueAtTime(0.12, t + 0.32); g.gain.linearRampToValueAtTime(0.0001, t + 0.42);
        osc.connect(fl); fl.connect(g); g.connect(o); osc.start(t); osc.stop(t + 0.45);
      });
    },
    magic(c, o, t) {
      [84, 88, 91, 96, 100, 103].forEach((n, i) => tone(c, o, t + i * 0.06, { f0: note(n), dur: 0.7, vol: 0.13, a: 0.003 }));
      hiss(c, o, t, { dur: 0.9, vol: 0.08, type: 'highpass', f: 6000, q: 0.5 });
    },
    sad(c, o, t) {
      [[55, 0.3], [54, 0.3], [53, 0.3], [52, 1.0]].reduce((t0, [n, d]) => {
        const osc = c.createOscillator(), fl = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
        osc.type = 'sawtooth'; osc.frequency.value = note(n); fl.type = 'lowpass'; fl.frequency.value = 900;
        if (d > 0.5) { lfo.frequency.value = 6; lg.gain.value = 6; lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t0); lfo.stop(t0 + d); }
        g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.14, t0 + 0.05); g.gain.setValueAtTime(0.14, t0 + d - 0.08); g.gain.linearRampToValueAtTime(0.0001, t0 + d);
        osc.connect(fl); fl.connect(g); g.connect(o); osc.start(t0); osc.stop(t0 + d + 0.05);
        return t0 + d + 0.04;
      }, t);
    },
    steps(c, o, t) {
      for (let i = 0; i < 4; i++) { const t0 = t + i * 0.3; tone(c, o, t0, { f0: 95, f1: 60, dur: 0.12, vol: 0.5 }); hiss(c, o, t0, { dur: 0.08, vol: 0.25, type: 'lowpass', f: 600, q: 0.5, off: i * 0.2 }); }
    },
    thunder(c, o, t) {
      hiss(c, o, t, { dur: 0.25, vol: 0.5, type: 'highpass', f: 2000, q: 0.5 });
      const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
      s.buffer = noiseBuf(c); s.loop = true; fl.type = 'lowpass'; fl.frequency.value = 220; fl.Q.value = 0.7;
      g.gain.setValueAtTime(0.0001, t);
      [[0.15, 1], [0.5, 0.55], [0.9, 0.85], [1.4, 0.4], [2, 0.6], [2.8, 0.0001]].forEach(([dt, v]) => g.gain.linearRampToValueAtTime(v * 1.2, t + dt));
      s.connect(fl); fl.connect(g); g.connect(o); s.start(t, 0.9); s.stop(t + 2.9);
    },
    tick(c, o, t) { for (let i = 0; i < 4; i++) tone(c, o, t + i * 0.5, { type: 'square', f0: i % 2 ? 1500 : 2000, dur: 0.03, vol: 0.12, a: 0.001 }); },
    heart(c, o, t) { for (let i = 0; i < 3; i++) { const t0 = t + i * 0.8; tone(c, o, t0, { f0: 70, f1: 45, dur: 0.16, vol: 0.8 }); tone(c, o, t0 + 0.22, { f0: 62, f1: 40, dur: 0.14, vol: 0.6 }); } },
  };
  function play(c, out, kind, t) { const f = PLAY[kind]; if (f) try { f(c, out, t); } catch (e) { console.warn('sound', kind, e); } }

  // ---------- decoding files ----------
  let decoder = null;
  function decode(ab) {
    if (!decoder) { const C = OAC(); decoder = C ? new C(1, 1, 44100) : (Sound.unlock(), Sound.ctx); }
    return new Promise((res, rej) => { const p = decoder.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
  }
  let musicCache = { id: null, p: null };
  function musicBuffer(id) {
    if (musicCache.id !== id) {
      const p = fetch(`music/${id}.mp3`).then((r) => { if (!r.ok) throw new Error('Could not load the music. Is the iPad online?'); return r.arrayBuffer(); }).then(decode);
      p.catch(() => { if (musicCache.p === p) musicCache = { id: null, p: null }; });
      musicCache = { id, p };
    }
    return musicCache.p;
  }
  const voiceCache = new Map();
  function voiceBuffer(id, getBlob) {
    if (!voiceCache.has(id)) {
      const p = Promise.resolve(getBlob(id)).then((b) => (b ? b.arrayBuffer() : null)).then((ab) => (ab ? decode(ab) : null));
      p.catch(() => voiceCache.delete(id));
      voiceCache.set(id, p);
    }
    return voiceCache.get(id);
  }

  // ---------- the mix ----------
  function renderOffline(c) {
    return new Promise((res, rej) => {
      c.oncomplete = (e) => res(e.renderedBuffer);
      try { const p = c.startRendering(); if (p && p.then) p.then(res, rej); } catch (e) { rej(e); }
    });
  }
  // plan: { dur, sampleRate, channels, music: {id, vol} | null, voices: [{id, t, vol}], sfx: [{kind, t}] }
  async function render(plan, getVoice) {
    const C = OAC();
    if (!C) throw new Error('This browser can’t mix sound');
    const sr = plan.sampleRate || 48000, ch = plan.channels || 2, dur = Math.max(0.1, plan.dur);
    const voices = [];
    for (const v of plan.voices) {
      const buf = await voiceBuffer(v.id, getVoice).catch(() => null);
      if (buf) voices.push({ buf, t: v.t, vol: v.vol == null ? 1 : v.vol });
    }
    const music = plan.music ? await musicBuffer(plan.music.id).catch(() => null) : null;
    const c = new C(ch, Math.ceil(dur * sr), sr);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    const master = c.createGain(); master.gain.value = 0.92; master.connect(comp); comp.connect(c.destination);
    if (music) {
      const s = c.createBufferSource(), g = c.createGain(), vol = plan.music.vol;
      s.buffer = music; s.loop = true;
      // quieter while someone talks, and a fade at the very end
      const spans = voices.map((v) => [v.t, v.t + v.buf.duration]).sort((a, b) => a[0] - b[0]).reduce((acc, sp) => {
        const last = acc[acc.length - 1];
        if (last && sp[0] <= last[1] + 0.4) last[1] = Math.max(last[1], sp[1]); else acc.push(sp.slice());
        return acc;
      }, []);
      g.gain.setValueAtTime(vol, 0);
      const fadeAt = Math.max(0, dur - 2.5);
      for (const [a, b] of spans) {
        if (a >= fadeAt) break;
        g.gain.setValueAtTime(vol, Math.max(0, a - 0.2)); g.gain.linearRampToValueAtTime(vol * 0.3, a);
        g.gain.setValueAtTime(vol * 0.3, Math.min(b, fadeAt)); g.gain.linearRampToValueAtTime(vol, Math.min(b + 0.4, fadeAt));
      }
      g.gain.setValueAtTime(vol, fadeAt); g.gain.linearRampToValueAtTime(0.0001, dur);
      s.connect(g); g.connect(master); s.start(0);
    }
    for (const v of voices) {
      const s = c.createBufferSource(), g = c.createGain();
      s.buffer = v.buf; g.gain.value = v.vol * 1.25;
      s.connect(g); g.connect(master); s.start(Math.max(0, v.t));
    }
    const fx = c.createGain(); fx.gain.value = 0.85; fx.connect(master);
    for (const e of plan.sfx) if (e.t < dur) play(c, fx, e.kind, Math.max(0, e.t));
    return renderOffline(c);
  }

  // ---------- live playback (preview) ----------
  let live = null;
  function playBuffer(buf, at = 0) {
    Sound.unlock();
    const c = Sound.ctx;
    if (!c || !buf || at >= buf.duration) return null;
    const s = c.createBufferSource();
    s.buffer = buf; s.connect(c.destination);
    s.start(c.currentTime + 0.02, Math.max(0, at));
    return s;
  }
  function stopSource(s) { try { if (s) s.stop(); } catch (e) { /* already stopped */ } }
  function preview(kind) {
    Sound.unlock();
    const c = Sound.ctx;
    if (!c) return;
    const g = c.createGain(); g.gain.value = 0.85; g.connect(c.destination);
    play(c, g, kind, c.currentTime + 0.02);
  }
  async function previewMusic(id) {
    stopPreview();
    if (!id || id === 'none') return;
    Sound.unlock();
    const c = Sound.ctx, token = {};
    live = token;
    let buf;
    try { buf = await musicBuffer(id); } catch (e) { toast(e.message || 'Could not load the music'); return; }
    if (live !== token || !c) return;
    const s = c.createBufferSource(), g = c.createGain(), t = c.currentTime + 0.02;
    s.buffer = buf; g.gain.setValueAtTime(0.7, t); g.gain.setValueAtTime(0.7, t + 5); g.gain.linearRampToValueAtTime(0.0001, t + 6.5);
    s.connect(g); g.connect(c.destination); s.start(t); s.stop(t + 6.6);
    token.src = s;
  }
  function stopPreview() { if (live && live.src) stopSource(live.src); live = null; }

  // ---------- recording a voice ----------
  // open() asks for the microphone; begin() starts recording; stop() gives the sound back.
  async function openMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) throw new Error('This browser can’t record sound');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const types = ['audio/mp4', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    const mime = types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
    let an = null, node = null;
    try { Sound.unlock(); node = Sound.ctx.createMediaStreamSource(stream); an = Sound.ctx.createAnalyser(); an.fftSize = 512; node.connect(an); } catch (e) { /* no meter */ }
    let rec = null, chunks = [], t0 = 0;
    const close = () => { stream.getTracks().forEach((t) => t.stop()); try { if (node) node.disconnect(); } catch (e) { /* gone */ } };
    return {
      begin() {
        chunks = [];
        rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        rec.start(250); t0 = performance.now();
      },
      level() {
        if (!an) return 0;
        const d = new Uint8Array(an.fftSize); an.getByteTimeDomainData(d);
        let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i] - 128));
        return m / 128;
      },
      stop() {
        return new Promise((res) => {
          if (!rec || rec.state === 'inactive') { close(); res(null); return; }
          rec.onstop = () => { close(); res({ blob: new Blob(chunks, { type: (rec.mimeType || mime || 'audio/mp4').split(';')[0] }), secs: (performance.now() - t0) / 1000 }); };
          try { rec.stop(); } catch (e) { close(); res(null); }
        });
      },
      close,
    };
  }

  // ---------- AAC for the saved video ----------
  async function aacConfig() {
    if (!window.AudioEncoder || !window.AudioData) return null;
    for (const sampleRate of [48000, 44100]) for (const numberOfChannels of [2, 1]) {
      const cfg = { codec: 'mp4a.40.2', sampleRate, numberOfChannels, bitrate: 128000 };
      try { const s = await AudioEncoder.isConfigSupported(cfg); if (s && s.supported) return cfg; } catch (e) { /* try the next */ }
    }
    return null;
  }
  async function encodeAAC(muxer, buf, cfg) {
    let err = null;
    const enc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { err = e; } });
    enc.configure(cfg);
    const n = buf.length, ch = cfg.numberOfChannels, step = 4096, chans = [];
    for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(Math.min(c, buf.numberOfChannels - 1)));
    for (let i = 0; i < n; i += step) {
      if (err) throw err;
      const len = Math.min(step, n - i), data = new Float32Array(len * ch);
      for (let c = 0; c < ch; c++) data.set(chans[c].subarray(i, i + len), c * len);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: cfg.sampleRate, numberOfFrames: len, numberOfChannels: ch, timestamp: Math.round((i / cfg.sampleRate) * 1e6), data });
      enc.encode(ad); ad.close();
      if (enc.encodeQueueSize > 24) await new Promise((r) => setTimeout(r, 2));
    }
    await enc.flush();
    enc.close();
    if (err) throw err;
  }

  return { TRACKS, SFX, credit, render, playBuffer, stopSource, preview, previewMusic, stopPreview, openMic, aacConfig, encodeAAC, forgetVoice: (id) => voiceCache.delete(id) };
})();
