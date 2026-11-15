/* ===== util.js · 基础工具 ===== */
(function (global) {
  'use strict';

  const GG = global.GG = global.GG || {};
  const U = GG.Util = {};

  U.TAU = Math.PI * 2;
  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
  U.dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  U.len = (x, y) => Math.hypot(x, y);

  U.easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  U.easeInCubic = t => t * t * t;
  U.easeOutBack = t => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
  U.smooth = (cur, target, k) => cur + (target - cur) * k;

  /** 可复现随机数（用于固定摆盘/AI 试算） */
  U.mulberry32 = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  U.shuffle = function (arr, rnd) {
    const r = rnd || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };

  U.randRange = (rnd, a, b) => a + (b - a) * rnd();
  U.pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

  /** 颜色混合：hex + alpha → rgba 字符串 */
  U.rgba = function (hex, a) {
    const h = hex.replace('#', '');
    const n = h.length === 3
      ? h.split('').map(c => parseInt(c + c, 16))
      : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    return `rgba(${n[0]},${n[1]},${n[2]},${a})`;
  };

  U.mix = function (hexA, hexB, t) {
    const p = h => { const s = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(s.substr(i, 2), 16)); };
    const a = p(hexA), b = p(hexB);
    return '#' + a.map((v, i) => Math.round(U.lerp(v, b[i], t)).toString(16).padStart(2, '0')).join('');
  };

  /** 圆角矩形路径 */
  U.roundRect = function (ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  };

  U.fmt = (n, d) => (d ? n.toFixed(d) : String(n));

  /** 标准正态分布采样（Box–Muller），rnd 可注入以实现可复现 */
  U.gauss = function (rnd) {
    const r = rnd || Math.random;
    let u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(U.TAU * v);
  };

  /** 一组样本的方均根与标准差（自测用） */
  U.stats = function (arr) {
    const n = arr.length || 1;
    let mean = 0;
    for (let i = 0; i < arr.length; i++) mean += arr[i];
    mean /= n;
    let varr = 0;
    for (let i = 0; i < arr.length; i++) varr += (arr[i] - mean) * (arr[i] - mean);
    varr /= n;
    return { mean, sd: Math.sqrt(varr), rms: Math.sqrt(mean * mean + varr), n };
  };

  U.now = () => performance.now();

  GG.Util = U;
})(window);
