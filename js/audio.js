/* ===== audio.js · WebAudio 合成音效（无外部资源） ===== */
(function (global) {
  'use strict';
  const GG = global.GG;
  const A = GG.Audio = { muted: false, ctx: null, master: null };

  A.ensure = function () {
    if (!A.ctx) {
      const C = global.AudioContext || global.webkitAudioContext;
      if (!C) return null;
      A.ctx = new C();
      A.master = A.ctx.createGain();
      A.master.gain.value = 0.55;
      A.master.connect(A.ctx.destination);
    }
    if (A.ctx.state === 'suspended') A.ctx.resume();
    return A.ctx;
  };

  function env(node, t0, a, d, peak) {
    const g = node.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  function tone(freq, dur, type, peak, slideTo) {
    const ctx = A.ensure(); if (!ctx) return;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    env(g, t0, 0.006, dur, peak || 0.2);
    o.connect(g); g.connect(A.master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function noise(dur, peak, type, freq, q, sweepTo) {
    const ctx = A.ensure(); if (!ctx) return;
    const t0 = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type || 'bandpass';
    f.frequency.setValueAtTime(freq || 1200, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(80, sweepTo), t0 + dur);
    f.Q.value = q || 1;
    const g = ctx.createGain();
    env(g, t0, 0.005, dur, peak || 0.18);
    src.connect(f); f.connect(g); g.connect(A.master);
    src.start(t0);
  }

  const BANK = {
    flick: () => { noise(0.16, 0.22, 'bandpass', 2600, 0.8, 700); },
    hit: (d) => {
      const k = Math.min(1, (d && d.impact ? d.impact : 400) / 1400);
      tone(320 + k * 520, 0.07, 'triangle', 0.05 + k * 0.16);
      noise(0.05, 0.05 + k * 0.14, 'highpass', 2200, 0.7);
    },
    peg: () => { tone(1180, 0.12, 'triangle', 0.1); tone(760, 0.2, 'sine', 0.06, 520); },
    fall: () => { noise(0.16, 0.13, 'lowpass', 420, 0.9, 140); tone(90, 0.18, 'sine', 0.12, 55); },
    kill: () => { tone(720, 0.1, 'sine', 0.14); setTimeout(() => tone(1080, 0.16, 'sine', 0.12), 85); },
    penalty: () => { tone(220, 0.14, 'sawtooth', 0.1, 120); setTimeout(() => tone(150, 0.2, 'sawtooth', 0.09, 80), 110); },
    forfeit: () => { noise(0.2, 0.12, 'lowpass', 800, 0.8, 200); },
    selfout: () => { tone(140, 0.22, 'sine', 0.13, 70); },
    win: () => {
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.24, 'triangle', 0.11), i * 110));
    },
    slide: () => { noise(0.42, 0.03, 'lowpass', 900, 0.6, 260); }
  };

  A.play = function (name, data) {
    if (A.muted) return;
    if (name === 'hit') {
      const isPeg = data && data.peg;
      (isPeg ? BANK.peg : BANK.hit)(data);
      return;
    }
    const fn = BANK[name];
    if (fn) { try { fn(data); } catch (e) { /* 忽略音频异常 */ } }
  };

  A.toggle = function () { A.muted = !A.muted; return A.muted; };

  GG.Audio = A;
})(window);
