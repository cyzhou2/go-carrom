/* ===== render.js · 画布渲染与多皮肤 ===== */
(function (global) {
  'use strict';

  const GG = global.GG;
  const U = GG.Util;
  const R = GG.Render = {};

  const SKINS = {
    wood: {
      id: 'wood', glow: false, texture: true,
      pageBg: ['#241a13', '#120d0a'],
      plank: ['#d8a86f', '#b9834a'], plankEdge: '#6d4520', edgeLight: 'rgba(255,236,203,.5)',
      grain: 'rgba(96,58,24,.10)', knots: 'rgba(90,52,20,.16)',
      grid: 'rgba(58,33,13,.78)', star: 'rgba(45,25,8,.9)',
      rimShadow: 'rgba(0,0,0,.55)',
      shadow: 'rgba(30,16,4,.42)',
      black: ['#5d554c', '#171310', '#070605'], white: ['#ffffff', '#f2ece2', '#bdb2a2'],
      civ: { fill: '#7fd8ab', ring: '#2f8f63', core: '#eafff3' },
      obs: { fill: '#4a5058', ring: '#22262c', mark: 'rgba(255,190,120,.35)' },
      aim: '#ffd9a0', aimBad: '#ff8a72', power: ['#8ee0b0', '#ffd166', '#ff7a6a'],
      bannerTint: 'rgba(255,225,180,'
    },
    neon: {
      id: 'neon', glow: true, texture: false,
      pageBg: ['#0a1024', '#03050b'],
      plank: ['#0c1a33', '#060d1c'], plankEdge: '#1de5c5', edgeLight: 'rgba(90,240,255,.16)',
      grain: null, knots: null,
      grid: 'rgba(96,215,255,.42)', star: 'rgba(150,245,255,.9)',
      rimShadow: 'rgba(0,0,0,.7)',
      shadow: 'rgba(0,230,255,.14)',
      black: ['#5b6b8c', '#1b2436', '#0a0e17'], white: ['#ffffff', '#d6ecff', '#8fb6d8'],
      civ: { fill: '#2de1c2', ring: '#00ffd5', core: '#e9fffb' },
      obs: { fill: '#1b2436', ring: '#a98cff', mark: 'rgba(169,140,255,.5)' },
      aim: '#7ef9e6', aimBad: '#ff6b8b', power: ['#4ff0d6', '#a98cff', '#ff6b8b'],
      bannerTint: 'rgba(130,250,240,'
    },
    flat: {
      id: 'flat', glow: false, texture: false,
      pageBg: ['#ffffff', '#eeeae2'],
      plank: ['#ffffff', '#f4f0e8'], plankEdge: '#c9c1b2', edgeLight: 'rgba(255,255,255,.9)',
      grain: null, knots: null,
      grid: 'rgba(45,40,33,.45)', star: 'rgba(35,30,25,.85)',
      rimShadow: 'rgba(80,70,55,.18)',
      shadow: 'rgba(60,50,40,.22)',
      black: ['#4a4a4a', '#232323', '#101010'], white: ['#ffffff', '#f7f4ee', '#cfc8ba'],
      civ: { fill: '#9fe0c4', ring: '#3f9c74', core: '#ffffff' },
      obs: { fill: '#d8d2c6', ring: '#8e8578', mark: 'rgba(60,50,40,.35)' },
      aim: '#2f6df6', aimBad: '#d9452f', power: ['#2f9e6b', '#e8a020', '#d9452f'],
      bannerTint: 'rgba(40,90,200,'
    }
  };
  R.SKINS = SKINS;

  let canvas, ctx, dpr = 1;
  let cw = 0, ch = 0;
  let skin = SKINS.wood;
  let cache = null;          // 离屏棋盘
  let cacheKey = '';
  let view = { scale: 1, ox: 0, oy: 0, w: 0, h: 0, vx0: 0, vy0: 0, vw: 1 };
  let shake = { t: 0, mag: 0 };
  let particles = [];
  let floats = [];           // 命中/惩罚飘字
  let uiFont = '"PingFang SC","Microsoft YaHei",system-ui,sans-serif';
  let uiScale = 1;
  let MARGIN = 34;           // 视野在木板外的留白（世界单位），竖屏会收紧
  R.setMargin = function (v) { if (v && v !== MARGIN) { MARGIN = v; cacheKey = ''; } };

  R.init = function (cv) {
    canvas = cv;
    ctx = canvas.getContext('2d');
    R.resize();
  };

  R.setSkin = function (name) {
    skin = SKINS[name] || SKINS.wood;
    cacheKey = '';
  };
  R.getSkin = function () { return skin; };

  /** 棋盘飘字的字号缩放（跟随界面字号设置） */
  R.setUiScale = function (f) {
    uiScale = f || 1;
  };

  R.resize = function () {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(global.devicePixelRatio || 1, 2);
    cw = Math.max(1, Math.round(rect.width));
    ch = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    cacheKey = '';
  };

  R.stageSize = function () { return { w: cw, h: ch }; };

  /** 依据几何参数计算世界→屏幕变换；insetTop 用于给顶部工具条让出空间 */
  R.setGeom = function (geom, insetTop) {
    const pl = geom.plank;
    const pw = pl.x1 - pl.x0, ph = pl.y1 - pl.y0;
    const vw = pw + MARGIN * 2, vh = ph + MARGIN * 2;
    const top = Math.max(0, insetTop || 0);
    const availH = Math.max(120, ch - top);
    const s = Math.min(cw / vw, availH / vh);
    view = {
      scale: s,
      vx0: pl.x0 - MARGIN, vy0: pl.y0 - MARGIN,
      vw, vh,
      ox: (cw - vw * s) / 2,
      oy: top + (availH - vh * s) / 2
    };
    R.geom = geom;
  };

  R.w2s = function (x, y) {
    return { x: view.ox + (x - view.vx0) * view.scale, y: view.oy + (y - view.vy0) * view.scale };
  };
  R.s2w = function (sx, sy) {
    return { x: (sx - view.ox) / view.scale + view.vx0, y: (sy - view.oy) / view.scale + view.vy0 };
  };
  R.px = function (v) { return v * view.scale; };

  R.shake = function (mag, dur) {
    shake.mag = Math.max(shake.mag, mag);
    shake.t = Math.max(shake.t, dur || 0.22);
  };

  R.spawnHit = function (x, y, impact, kind) {
    const n = Math.min(12, 3 + Math.round(impact / 260));
    const col = kind === 'obstacle' ? '#ffd08a' : kind === 'civilian' ? '#8ff0c4' : '#fff3dd';
    for (let i = 0; i < n; i++) {
      const a = Math.random() * U.TAU;
      const sp = 60 + Math.random() * Math.min(420, impact * 0.5);
      particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0, max: 0.28 + Math.random() * 0.32,
        size: 2 + Math.random() * 3.4, col
      });
    }
  };

  /** 棋盘上的飘字（击落 / 平民 −1 / 下场 …） */
  R.addFloat = function (x, y, text, color) {
    floats.push({ x, y, text: String(text), color: color || '#fff3dd', t: 0, life: 1.15 });
    if (floats.length > 24) floats.shift();
  };

  R.stepEffects = function (dt) {
    if (shake.t > 0) shake.t = Math.max(0, shake.t - dt);
    const ps = [];
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.max) continue;
      const k = Math.pow(0.02, dt);
      p.vx *= k; p.vy *= k;
      p.x += p.vx * dt; p.y += p.vy * dt;
      ps.push(p);
    }
    particles = ps;

    if (floats.length) {
      const fs = [];
      for (let i = 0; i < floats.length; i++) {
        const f = floats[i];
        f.t += dt;
        if (f.t < f.life) fs.push(f);
      }
      floats = fs;
    }
  };

  /* ---------- 离屏棋盘缓存 ---------- */
  function plankPath(c, r) {
    const geo = R.geom, pl = geo.plank;
    const a = R.w2s(pl.x0, pl.y0), b = R.w2s(pl.x1, pl.y1);
    U.roundRect(c, a.x, a.y, b.x - a.x, b.y - a.y, r);
    return { a, b, w: b.x - a.x, h: b.y - a.y };
  }

  function drawBackground(c) {
    const g = c.createRadialGradient(cw * 0.5, ch * 0.18, 40, cw * 0.5, ch * 0.5, Math.max(cw, ch) * 0.95);
    g.addColorStop(0, skin.pageBg[0]);
    g.addColorStop(1, skin.pageBg[1]);
    c.fillStyle = g;
    c.fillRect(0, 0, cw, ch);
    if (skin.id === 'neon') {
      c.save();
      c.globalAlpha = 0.13;
      c.strokeStyle = '#2de1c2';
      c.lineWidth = 1;
      const step = 46;
      for (let x = 0; x < cw; x += step) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, ch); c.stroke(); }
      for (let y = 0; y < ch; y += step) { c.beginPath(); c.moveTo(0, y); c.lineTo(cw, y); c.stroke(); }
      c.restore();
    }
  }

  function drawWoodGrain(c, box) {
    const rnd = U.mulberry32(20251115);
    c.save();
    c.beginPath();
    c.rect(box.a.x, box.a.y, box.w, box.h);
    c.clip();
    const lines = Math.round(box.h / 7);
    for (let i = 0; i < lines; i++) {
      const y = box.a.y + (i / lines) * box.h + (rnd() - 0.5) * 6;
      c.beginPath();
      const amp = 2 + rnd() * 7;
      const ph = rnd() * 6.28;
      const w = box.w;
      for (let x = 0; x <= w; x += 16) {
        const yy = y + Math.sin(x / (60 + rnd() * 12) + ph) * amp;
        x === 0 ? c.moveTo(box.a.x + x, yy) : c.lineTo(box.a.x + x, yy);
      }
      c.strokeStyle = skin.grain;
      c.lineWidth = 0.7 + rnd() * 1.5;
      c.stroke();
    }
    for (let k = 0; k < 7; k++) {
      const kx = box.a.x + rnd() * box.w, ky = box.a.y + rnd() * box.h;
      const rw = 18 + rnd() * 46, rh = 6 + rnd() * 14;
      c.beginPath();
      c.ellipse(kx, ky, rw, rh, rnd() * 0.4 - 0.2, 0, U.TAU);
      c.strokeStyle = skin.knots;
      c.lineWidth = 1.2;
      c.stroke();
    }
    c.restore();
  }

  function drawGrid(c) {
    const geo = R.geom;
    const a = R.w2s(0, 0), b = R.w2s(1000, 1000);
    c.save();
    c.strokeStyle = skin.grid;
    c.lineWidth = Math.max(1, R.px(1.6));
    if (skin.glow) { c.shadowColor = skin.grid; c.shadowBlur = 8; }
    for (let i = 0; i < geo.n; i++) {
      const x = R.w2s(i * geo.cell, 0).x;
      const y = R.w2s(0, i * geo.cell).y;
      c.beginPath(); c.moveTo(Math.round(x) + .5, a.y); c.lineTo(Math.round(x) + .5, b.y); c.stroke();
      c.beginPath(); c.moveTo(a.x, Math.round(y) + .5); c.lineTo(b.x, Math.round(y) + .5); c.stroke();
    }
    // 星位
    const n = geo.n;
    const off = n <= 9 ? 2 : 3;
    const mid = (n - 1) / 2;
    const stars = [[off, off], [n - 1 - off, off], [off, n - 1 - off], [n - 1 - off, n - 1 - off]];
    if (Math.abs(mid - Math.round(mid)) < 0.01 && n >= 9) stars.push([mid, mid]);
    c.fillStyle = skin.star;
    c.shadowBlur = skin.glow ? 12 : 0;
    c.shadowColor = skin.star;
    const rr = Math.max(2.2, R.px(geo.r * 0.17));
    for (const [col, row] of stars) {
      const p = R.w2s(col * geo.cell, row * geo.cell);
      c.beginPath(); c.arc(p.x, p.y, rr, 0, U.TAU); c.fill();
    }
    c.restore();
  }

  function buildCache() {
    const geo = R.geom;
    if (!geo) return;
    const key = [cw, ch, dpr, skin.id, geo.n].join('|');
    if (key === cacheKey && cache) return;
    cacheKey = key;

    cache = document.createElement('canvas');
    cache.width = Math.round(cw * dpr);
    cache.height = Math.round(ch * dpr);
    const c = cache.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    drawBackground(c);

    // 木板阴影
    c.save();
    c.shadowColor = skin.rimShadow;
    c.shadowBlur = R.px(34);
    c.shadowOffsetY = R.px(14);
    plankPath(c, R.px(geo.pad * 0.7));
    c.fillStyle = skin.plankEdge;
    c.fill();
    c.restore();

    // 板面
    const grad = c.createLinearGradient(0, R.w2s(0, 0).y, 0, R.w2s(0, 1000).y);
    grad.addColorStop(0, skin.plank[0]);
    grad.addColorStop(1, skin.plank[1]);
    const box = plankPath(c, R.px(geo.pad * 0.66));
    c.fillStyle = grad;
    c.fill();

    if (skin.texture) drawWoodGrain(c, box);

    if (skin.id === 'neon') {
      c.save();
      c.lineJoin = 'round';
      c.strokeStyle = U.rgba('#1de5c5', 0.14);
      c.lineWidth = R.px(7);
      c.shadowColor = '#1de5c5'; c.shadowBlur = R.px(26);
      plankPath(c, R.px(geo.pad * 0.66));
      c.stroke();
      c.restore();
    }

    // 板缘高光 + 内阴影（出界处）
    c.save();
    plankPath(c, R.px(geo.pad * 0.66));
    c.strokeStyle = skin.glow ? 'rgba(120,250,235,.55)' : (skin.id === 'flat' ? skin.plankEdge : skin.edgeLight);
    c.lineWidth = Math.max(1, R.px(2));
    c.stroke();
    if (skin.id === 'wood') {
      c.shadowColor = 'rgba(60,32,8,.55)';
      c.shadowBlur = R.px(26);
      c.strokeStyle = 'rgba(60,32,8,.25)';
      c.lineWidth = R.px(6);
      c.stroke();
      c.shadowBlur = 0;
      c.strokeStyle = 'rgba(255,240,210,.18)';
      c.lineWidth = R.px(1.4);
      c.stroke();
    }
    c.restore();

    drawGrid(c);

    // 四角装饰
    if (skin.glow) {
      c.save();
      const a = R.w2s(geo.plank.x0, geo.plank.y0), b = R.w2s(geo.plank.x1, geo.plank.y1);
      c.strokeStyle = 'rgba(169,140,255,.55)';
      c.lineWidth = 2;
      const L = R.px(34);
      const corners = [[a.x, a.y, 1, 1], [b.x, a.y, -1, 1], [a.x, b.y, 1, -1], [b.x, b.y, -1, -1]];
      for (const [x, y, sx, sy] of corners) {
        c.beginPath();
        c.moveTo(x + sx * L, y);
        c.lineTo(x, y);
        c.lineTo(x, y + sy * L);
        c.stroke();
      }
      c.restore();
    }
  }

  /* ---------- 棋子绘制 ---------- */
  const clock = () => performance.now() / 1000;

  function drawObstacle(c, p) {
    const s = R.w2s(p.x, p.y), r = R.px(p.r);
    const o = skin.obs;
    c.save();
    c.beginPath(); c.arc(s.x + r * 0.07, s.y + r * 0.14, r * 0.99, 0, U.TAU);
    c.fillStyle = skin.shadow; c.fill();

    const g = c.createRadialGradient(s.x - r * 0.36, s.y - r * 0.42, r * 0.08, s.x, s.y, r);
    g.addColorStop(0, U.mix(o.fill, '#ffffff', skin.id === 'flat' ? 0.5 : 0.34));
    g.addColorStop(0.62, o.fill);
    g.addColorStop(1, U.mix(o.fill, '#000000', skin.id === 'flat' ? 0.18 : 0.55));
    c.beginPath(); c.arc(s.x, s.y, r, 0, U.TAU);
    c.fillStyle = g; c.fill();

    c.save();
    c.beginPath(); c.arc(s.x, s.y, r, 0, U.TAU); c.clip();
    c.strokeStyle = o.mark;
    c.lineWidth = Math.max(1, R.px(2.6));
    c.beginPath(); c.arc(s.x, s.y, r * 0.74, 0, U.TAU); c.stroke();
    c.beginPath(); c.arc(s.x, s.y, r * 0.44, 0, U.TAU); c.stroke();
    const rot = clock() * 0.25;
    c.lineWidth = Math.max(1, R.px(4));
    c.globalAlpha = 0.8;
    for (let i = 0; i < 6; i++) {
      const a = rot + i * Math.PI / 3;
      c.beginPath();
      c.moveTo(s.x + Math.cos(a) * r * 0.5, s.y + Math.sin(a) * r * 0.5);
      c.lineTo(s.x + Math.cos(a) * r * 0.96, s.y + Math.sin(a) * r * 0.96);
      c.stroke();
    }
    c.restore();

    c.beginPath(); c.arc(s.x, s.y, r, 0, U.TAU);
    c.strokeStyle = o.ring;
    c.lineWidth = Math.max(1.5, R.px(3.5));
    if (skin.glow) { c.shadowColor = o.ring; c.shadowBlur = R.px(18); }
    c.stroke();
    c.restore();
  }

  function drawCivilian(c, p, isCurrent) {
    const s = R.w2s(p.x, p.y), r = R.px(p.r);
    const k = skin.civ;
    const t = clock();
    // 生化模式：被收编的平民带上所属阵营的颜色
    const own = p.side === 'black' || p.side === 'white' ? p.side : null;
    const body = own === 'black' ? U.mix(k.fill, '#1b2028', 0.5)
      : own === 'white' ? U.mix(k.fill, '#f7f2e7', 0.5) : k.fill;
    const fresh = own && p.convertAt && (performance.now() - p.convertAt) < 800;
    c.save();
    c.beginPath(); c.arc(s.x + r * 0.08, s.y + r * 0.16, r * 0.98, 0, U.TAU);
    c.fillStyle = skin.shadow; c.fill();

    const g = c.createRadialGradient(s.x - r * 0.35, s.y - r * 0.4, r * 0.05, s.x, s.y, r);
    g.addColorStop(0, U.mix(body, '#ffffff', 0.55));
    g.addColorStop(0.7, body);
    g.addColorStop(1, U.mix(body, '#0a3a28', 0.45));
    c.beginPath(); c.arc(s.x, s.y, r, 0, U.TAU);
    c.fillStyle = g; c.fill();

    // 平民标记：三道弧
    c.save();
    c.beginPath(); c.arc(s.x, s.y, r, 0, U.TAU); c.clip();
    c.strokeStyle = U.rgba(k.ring, 0.65);
    c.lineWidth = Math.max(1, R.px(2.2));
    for (let i = 0; i < 3; i++) {
      const rr = r * (0.34 + i * 0.24);
      c.beginPath(); c.arc(s.x, s.y, rr, t * 0.4 + i, t * 0.4 + i + 2.1); c.stroke();
    }
    c.restore();

    // 阵营环
    if (own) {
      c.beginPath(); c.arc(s.x, s.y, r * 0.82, 0, U.TAU);
      c.strokeStyle = own === 'black' ? 'rgba(12,15,20,.92)' : 'rgba(255,250,240,.95)';
      c.lineWidth = Math.max(2, R.px(3.4));
      c.stroke();
      if (fresh) {
        c.beginPath(); c.arc(s.x, s.y, r * (1.12 + Math.sin(t * 12) * 0.05), 0, U.TAU);
        c.strokeStyle = own === 'black' ? 'rgba(150,190,255,.75)' : 'rgba(255,215,140,.8)';
        c.lineWidth = Math.max(1.5, R.px(2));
        c.stroke();
      }
      // 轮到自己行动时：这已经是一颗可以弹射的棋子
      if (isCurrent) {
        c.beginPath();
        c.arc(s.x, s.y, r * (1.26 + Math.sin(t * 3.4) * 0.06), 0, U.TAU);
        c.strokeStyle = U.rgba(skin.aim, 0.55);
        c.lineWidth = Math.max(1.4, R.px(2.4));
        c.setLineDash([R.px(7), R.px(7)]);
        c.lineDashOffset = -t * 22;
        c.stroke();
        c.setLineDash([]);
      }
    }

    c.beginPath(); c.arc(s.x, s.y, r, 0, U.TAU);
    c.strokeStyle = U.rgba(k.ring, 0.9);
    c.lineWidth = Math.max(1, R.px(2));
    if (skin.glow) { c.shadowColor = k.ring; c.shadowBlur = R.px(14); }
    c.stroke();
    c.restore();
  }

  function drawStone(c, p, isCurrent) {
    const s = R.w2s(p.x, p.y), r = R.px(p.r);
    const black = p.side === 'black';
    const stops = black ? skin.black : skin.white;
    const t = clock();
    c.save();

    // 影子
    c.beginPath();
    c.ellipse(s.x + r * 0.09, s.y + r * 0.2, r * 0.97, r * 0.9, 0, 0, U.TAU);
    c.fillStyle = skin.shadow;
    c.fill();

    // 当前可操作棋子：呼吸光环
    if (isCurrent) {
      c.beginPath();
      c.arc(s.x, s.y, r * (1.26 + Math.sin(t * 3.4) * 0.06), 0, U.TAU);
      c.strokeStyle = U.rgba(skin.aim, 0.55);
      c.lineWidth = Math.max(1.4, R.px(2.4));
      c.setLineDash([R.px(7), R.px(7)]);
      c.lineDashOffset = -t * 22;
      c.stroke();
      c.setLineDash([]);
    }

    const g = c.createRadialGradient(s.x - r * 0.36, s.y - r * 0.42, r * 0.04, s.x - r * 0.05, s.y - r * 0.05, r * 1.18);
    g.addColorStop(0, stops[0]);
    g.addColorStop(0.52, stops[1]);
    g.addColorStop(1, stops[2]);
    c.beginPath(); c.arc(s.x, s.y, r, 0, U.TAU);
    c.fillStyle = g;
    if (skin.glow) { c.shadowColor = black ? 'rgba(120,190,255,.5)' : 'rgba(255,255,255,.75)'; c.shadowBlur = R.px(16); }
    c.fill();
    c.shadowBlur = 0;

    // 边缘
    c.beginPath(); c.arc(s.x, s.y, r * 0.985, 0, U.TAU);
    c.strokeStyle = black ? 'rgba(255,255,255,.16)' : 'rgba(90,74,54,.28)';
    c.lineWidth = Math.max(1, R.px(1.4));
    c.stroke();

    // 高光
    c.beginPath();
    c.ellipse(s.x - r * 0.3, s.y - r * 0.38, r * 0.34, r * 0.22, -0.7, 0, U.TAU);
    c.fillStyle = black ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.85)';
    c.fill();

    // 自旋标记：随角速度转动的短弧 + 圆点（能直接看出棋子在转）
    if (p.r > 6 && Math.abs(p.w || 0) >= 0) {
      c.save();
      c.translate(s.x, s.y);
      c.rotate(p.a || 0);
      const arcR = r * 0.8;
      c.beginPath();
      c.arc(0, 0, arcR, -0.38, 0.38);
      c.strokeStyle = black ? 'rgba(255,255,255,.55)' : 'rgba(70,52,30,.45)';
      c.lineWidth = Math.max(1.1, r * 0.11);
      c.lineCap = 'round';
      c.stroke();
      c.beginPath();
      c.arc(arcR * Math.cos(0), arcR * Math.sin(0), Math.max(1, r * 0.08), 0, U.TAU);
      c.fillStyle = black ? 'rgba(255,255,255,.6)' : 'rgba(70,52,30,.5)';
      c.fill();
      c.restore();
    }

    // 撞击闪光
    if (p.hit > 0.02) {
      c.beginPath(); c.arc(s.x, s.y, r, 0, U.TAU);
      c.strokeStyle = U.rgba('#fff6e0', p.hit * 0.75);
      c.lineWidth = R.px(3) * p.hit + 1;
      c.stroke();
    }
    c.restore();
  }

  function drawFalling(c, p) {
    const k = U.clamp(p.fallT, 0, 1);
    const s = R.w2s(p.x, p.y);
    const r = R.px(p.r) * (1 - k * 0.15);
    c.save();
    c.globalAlpha = Math.max(0, 1 - k * 1.05);
    const sc = 1 - k * 0.55;
    c.translate(s.x, s.y);
    c.rotate(p.fallDir + k * 2.2);
    c.scale(sc, sc * (1 - k * 0.25));
    const col = p.kind === 'civilian' ? skin.civ.fill : p.side === 'black' ? skin.black[1] : skin.white[1];
    c.beginPath(); c.arc(0, 0, r, 0, U.TAU);
    c.fillStyle = col;
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,.35)';
    c.lineWidth = 2;
    c.stroke();
    c.restore();
  }

  /* ---------- 瞄准辅助 ---------- */
  function previewPath(pieces, idx, dirX, dirY, geom) {
    const p = pieces[idx];
    const segs = [{ x: p.x, y: p.y }];
    let x = p.x, y = p.y, dx = dirX, dy = dirY;
    let bounces = 0, end = null;
    const step = 8;
    for (let i = 0; i < 420; i++) {
      x += dx * step; y += dy * step;
      if (x < geom.plank.x0 || x > geom.plank.x1 || y < geom.plank.y0 || y > geom.plank.y1) {
        end = { type: 'out', x, y };
        break;
      }
      let hitP = null;
      for (let k = 0; k < pieces.length; k++) {
        const o = pieces[k];
        if (!o.alive || k === idx) continue;
        const rr = o.r + p.r;
        const ddx = x - o.x, ddy = y - o.y;
        if (ddx * ddx + ddy * ddy <= rr * rr) { hitP = o; break; }
      }
      if (hitP) {
        end = { type: hitP.kind === 'obstacle' ? 'bounce' : 'hit', x, y, target: hitP };
        if (hitP.kind === 'obstacle' && bounces < 1) {
          // 反射一次
          const nx = x - hitP.x, ny = y - hitP.y;
          const nl = Math.hypot(nx, ny) || 1;
          const ux = nx / nl, uy = ny / nl;
          const dot = dx * ux + dy * uy;
          dx = (dx - 2 * dot * ux) * 0.92;
          dy = (dy - 2 * dot * uy) * 0.92;
          x = hitP.x + ux * (hitP.r + p.r + 2);
          y = hitP.y + uy * (hitP.r + p.r + 2);
          segs.push({ x, y, jump: true });
          bounces++;
          end = null;
          continue;
        }
        break;
      }
      if (i % 3 === 0) segs.push({ x, y });
    }
    return { segs, end };
  }

  function drawAim(c, st) {
    const aim = st.aim;
    if (!aim || !aim.active) return;
    const p = st.pieces[aim.idx];
    if (!p || !p.alive) return;
    const geo = st.geom;
    const pw = U.clamp(aim.power, 0, 1);
    const s = R.w2s(p.x, p.y);
    const r = R.px(p.r);
    const col = skin.power[pw < 0.45 ? 0 : pw < 0.78 ? 1 : 2];

    // 轨迹预测
    if (pw > 0.04) {
      const prev = previewPath(st.pieces, aim.idx, aim.dx, aim.dy, geo);
      c.save();
      c.lineCap = 'round';
      for (let i = 1; i < prev.segs.length; i++) {
        const t = i / prev.segs.length;
        const a = R.w2s(prev.segs[i].x, prev.segs[i].y);
        const b = R.w2s(prev.segs[i - 1].x, prev.segs[i - 1].y);
        c.beginPath();
        c.moveTo(b.x, b.y); c.lineTo(a.x, a.y);
        c.strokeStyle = U.rgba(skin.aim, 0.92 * (1 - t * 0.42));
        c.lineWidth = Math.max(1.8, R.px(5.4) * (1 - t * 0.45));
        c.setLineDash([R.px(6), R.px(7)]);
        c.shadowColor = skin.aim;
        c.shadowBlur = R.px(7);
        c.stroke();
      }
      c.setLineDash([]);
      if (prev.end) {
        const e = R.w2s(prev.end.x, prev.end.y);
        const er = Math.max(4, r * 0.42);
        c.beginPath(); c.arc(e.x, e.y, er, 0, U.TAU);
        c.strokeStyle = prev.end.type === 'out' ? skin.aimBad : skin.aim;
        c.fillStyle = U.rgba(prev.end.type === 'out' ? skin.aimBad : skin.aim, 0.28);
        c.lineWidth = 2;
        c.fill();
        c.stroke();
        if (prev.end.type === 'out') {
          c.beginPath();
          c.moveTo(e.x - er * 0.55, e.y - er * 0.55); c.lineTo(e.x + er * 0.55, e.y + er * 0.55);
          c.moveTo(e.x + er * 0.55, e.y - er * 0.55); c.lineTo(e.x - er * 0.55, e.y + er * 0.55);
          c.stroke();
        }
      }
      c.restore();
    }

    // 弹射箭头
    const L = 34 + pw * 96;
    const a2 = R.w2s(p.x + aim.dx * L, p.y + aim.dy * L);
    c.save();
    c.lineCap = 'round';
    c.strokeStyle = col;
    c.lineWidth = Math.max(2, r * 0.22);
    c.shadowColor = col; c.shadowBlur = 16;
    c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(a2.x, a2.y); c.stroke();
    const ang = Math.atan2(a2.y - s.y, a2.x - s.x);
    const ah = Math.max(8, r * 0.52);
    c.beginPath();
    c.moveTo(a2.x, a2.y);
    c.lineTo(a2.x - Math.cos(ang - 0.42) * ah, a2.y - Math.sin(ang - 0.42) * ah);
    c.lineTo(a2.x - Math.cos(ang + 0.42) * ah, a2.y - Math.sin(ang + 0.42) * ah);
    c.closePath();
    c.fillStyle = col; c.fill();
    c.restore();

    // 力度环
    c.save();
    c.beginPath();
    c.arc(s.x, s.y, r * 1.62, -Math.PI * 0.5, -Math.PI * 0.5 + U.TAU * pw);
    c.strokeStyle = col;
    c.lineWidth = Math.max(3, r * 0.16);
    c.lineCap = 'round';
    c.shadowColor = col; c.shadowBlur = 14;
    c.stroke();
    c.restore();

    // 拉弓式的牵引点
    if (aim.anchor) {
      const an = R.w2s(aim.anchor.x, aim.anchor.y);
      c.save();
      c.strokeStyle = U.rgba(skin.aim, 0.4);
      c.lineWidth = 1.5;
      c.setLineDash([4, 5]);
      c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(an.x, an.y); c.stroke();
      c.setLineDash([]);
      c.beginPath(); c.arc(an.x, an.y, 5, 0, U.TAU);
      c.fillStyle = U.rgba(skin.aim, 0.75); c.fill();
      c.restore();
    }
  }

  /* ---------- 编辑器叠加层 ---------- */
  function drawEditorOverlay(c, st) {
    const ed = st.editor;
    const geo = st.geom;
    const L = GG.CONFIG.layout;
    const a = R.w2s(0, 0), b = R.w2s(1000, 1000);

    // 双方聚类区提示
    c.save();
    const yb0 = R.w2s(0, L.clusterY[0] * 1000).y, yb1 = R.w2s(0, L.clusterY[1] * 1000).y;
    c.fillStyle = 'rgba(20,18,16,.055)';
    c.fillRect(a.x, yb0, b.x - a.x, yb1 - yb0);
    const yw0 = R.w2s(0, (1 - L.clusterY[1]) * 1000).y, yw1 = R.w2s(0, (1 - L.clusterY[0]) * 1000).y;
    c.fillStyle = 'rgba(255,255,255,.05)';
    c.fillRect(a.x, yw0, b.x - a.x, yw1 - yw0);
    c.restore();

    // 选中项
    if (ed.selected >= 0 && ed.obstacles && ed.obstacles[ed.selected]) {
      const o = ed.obstacles[ed.selected];
      const s = R.w2s(o.x * 1000, o.y * 1000);
      const rr = R.px(o.r * 1000);
      c.save();
      c.beginPath(); c.arc(s.x, s.y, rr + 2, 0, U.TAU);
      c.strokeStyle = skin.aim;
      c.lineWidth = 2.5;
      c.setLineDash([R.px(7), R.px(6)]);
      c.stroke();
      c.setLineDash([]);
      // 四向移动提示（小点）
      c.fillStyle = U.rgba(skin.aim, 0.5);
      for (let k = 0; k < 4; k++) {
        const ang = k * Math.PI / 2;
        c.beginPath();
        c.arc(s.x + Math.cos(ang) * (rr + 3), s.y + Math.sin(ang) * (rr + 3), Math.max(2.5, R.px(6)), 0, U.TAU);
        c.fill();
      }
      // 缩放手柄：右上 45°，实心大圆 + 双向箭头
      const ka = -Math.PI / 4;
      const kx = s.x + Math.cos(ka) * (rr + 3);
      const ky = s.y + Math.sin(ka) * (rr + 3);
      const kr = Math.max(7, R.px(19));
      c.beginPath(); c.arc(kx, ky, kr, 0, U.TAU);
      c.fillStyle = skin.aim;
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = 'rgba(0,0,0,.4)';
      c.stroke();
      c.save();
      c.translate(kx, ky);
      c.rotate(ka);
      c.strokeStyle = 'rgba(24,18,10,.78)';
      c.lineWidth = 1.7;
      c.lineCap = 'round';
      const a1 = kr * 0.42, a2 = kr * 0.16;
      c.beginPath(); c.moveTo(-a1, 0); c.lineTo(a1, 0); c.stroke();
      c.beginPath();
      c.moveTo(-a1, 0); c.lineTo(-a2, -kr * 0.26);
      c.moveTo(-a1, 0); c.lineTo(-a2, kr * 0.26);
      c.moveTo(a1, 0); c.lineTo(a2, -kr * 0.26);
      c.moveTo(a1, 0); c.lineTo(a2, kr * 0.26);
      c.stroke();
      c.restore();
      c.restore();
    }

    // 笔刷预览
    if (ed.hover) {
      const s = R.w2s(ed.hover.x, ed.hover.y);
      const rr = R.px(ed.brushR * 1000);
      c.save();
      c.beginPath(); c.arc(s.x, s.y, rr, 0, U.TAU);
      c.fillStyle = U.rgba(skin.aim, 0.1);
      c.fill();
      c.setLineDash([5, 5]);
      c.strokeStyle = U.rgba(skin.aim, 0.7);
      c.lineWidth = 1.6;
      c.stroke();
      c.restore();
    }
  }

  /* ---------- 主绘制 ---------- */
  R.draw = function (st) {
    if (!ctx || !st || !st.geom) return;
    R.setGeom(st.geom, st.insetTop);
    buildCache();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    ctx.save();
    if (shake.t > 0) {
      const k = shake.t * 4;
      ctx.translate((Math.random() - 0.5) * shake.mag * k, (Math.random() - 0.5) * shake.mag * k);
    }

    ctx.drawImage(cache, 0, 0, cw, ch);

    const ps = st.pieces;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!p.alive || p.falling || p.kind !== 'obstacle') continue;
      drawObstacle(ctx, p);
    }
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!p.alive || p.falling) continue;
      if (p.kind === 'civilian') drawCivilian(ctx, p, st.ringSide && p.side === st.ringSide && !st.picking);
      else if (p.kind === 'stone') drawStone(ctx, p, st.ringSide && p.side === st.ringSide);
    }
    drawAim(ctx, st);
    if (st.editor) drawEditorOverlay(ctx, st);

    // 粒子
    if (particles.length) {
      ctx.save();
      ctx.globalCompositeOperation = skin.glow ? 'lighter' : 'source-over';
      for (let i = 0; i < particles.length; i++) {
        const pt = particles[i];
        const a = 1 - pt.life / pt.max;
        const s = R.w2s(pt.x, pt.y);
        ctx.globalAlpha = Math.max(0, a) * 0.9;
        ctx.fillStyle = pt.col;
        ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(0.6, R.px(pt.size) * a), 0, U.TAU); ctx.fill();
      }
      ctx.restore();
    }

    // 平民惩罚：标出可以点选下场的己方棋子
    if (st.picking && st.pickSide) {
      const tt = performance.now() / 1000;
      const pulse = 0.55 + Math.sin(tt * 4.2) * 0.25;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (!p.alive || p.falling || p.kind !== 'stone' || p.side !== st.pickSide) continue;
        const s = R.w2s(p.x, p.y), r = R.px(p.r);
        ctx.save();
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * (1.3 + Math.sin(tt * 4.2) * 0.07), 0, U.TAU);
        ctx.strokeStyle = `rgba(239,123,108,${pulse})`;
        ctx.lineWidth = Math.max(2, r * 0.15);
        ctx.stroke();
        // 上方向下的三角：表示"这颗会下场"
        const ay = s.y - r * 1.95;
        const aw = Math.max(4, r * 0.36);
        ctx.beginPath();
        ctx.moveTo(s.x, ay);
        ctx.lineTo(s.x - aw, ay - aw * 1.15);
        ctx.lineTo(s.x + aw, ay - aw * 1.15);
        ctx.closePath();
        ctx.fillStyle = `rgba(239,123,108,${0.65 + pulse * 0.35})`;
        ctx.fill();
        ctx.restore();
      }
    }

    // 飘字
    if (floats.length) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < floats.length; i++) {
        const f = floats[i];
        const k = f.t / f.life;
        const s = R.w2s(f.x, f.y - k * 70);
        const alpha = k < 0.15 ? k / 0.15 : 1 - Math.pow((k - 0.15) / 0.85, 2);
        const size = Math.max(11, R.px(30)) * (1 + (1 - Math.min(1, k * 4)) * 0.25) * uiScale;
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.font = `800 ${size}px ${uiFont}`;
        ctx.lineWidth = Math.max(2, size * 0.16);
        ctx.strokeStyle = 'rgba(10,8,6,.55)';
        ctx.strokeText(f.text, s.x, s.y);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, s.x, s.y);
      }
      ctx.restore();
    }

    // 出界动画
    for (let i = 0; i < ps.length; i++) {
      if (ps[i].falling) drawFalling(ctx, ps[i]);
    }

    ctx.restore();
  };

  R.clear = function () {
    if (ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch); }
  };

  GG.Render = R;
})(window);
