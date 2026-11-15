/* ===== editor.js · 关卡编辑器（障碍布置 / 保存 / 读取 / 导入导出） ===== */
(function (global) {
  'use strict';

  const GG = global.GG, U = GG.Util, P = GG.Physics;
  const CFG = GG.CONFIG;
  const E = GG.Editor = {};

  const KEY = 'gocarrom.levels.v1';
  const MIN_R = 0.012, MAX_R = 0.46;

  E.active = false;
  E.board = 13;
  E.name = '';
  E.obstacles = [];       // {x,y,r} 归一化：x,y ∈ [0,1]，r 为棋盘边长的比例
  E.brushR = 0.075;
  E.selected = -1;
  E.geom = null;
  E.pieces = [];
  E.hover = null;         // {x,y} 世界坐标
  E.editingId = null;
  E.dirty = false;

  /* ---------------- 校验与规范 ---------------- */
  function normLevel(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const board = U.clamp((raw.board | 0) || 13, 7, 19);
    const list = Array.isArray(raw.obstacles) ? raw.obstacles : [];
    const obstacles = [];
    for (const o of list) {
      if (!o || !isFinite(o.x) || !isFinite(o.y)) continue;
      const r = U.clamp(Number(o.r) || 0.08, MIN_R, MAX_R);
      obstacles.push({
        x: U.clamp(Number(o.x), r, 1 - r),
        y: U.clamp(Number(o.y), r, 1 - r),
        r
      });
      if (obstacles.length >= 40) break;
    }
    return {
      name: String(raw.name || '未命名关卡').slice(0, 24),
      board,
      obstacles
    };
  }
  E.normLevel = normLevel;

  /* ---------------- 生命周期 ---------------- */
  E.open = function (level, board) {
    E.active = true;
    E.geom = P.geometry({ board: 7, load: 0 });
    E.load(level || { name: '', board: board || E.board, obstacles: [] });
    return E;
  };

  E.close = function () {
    E.active = false;
    E.selected = -1;
    E.hover = null;
  };

  E.load = function (level) {
    const lv = normLevel(level) || { name: '', board: E.board, obstacles: [] };
    E.name = lv.name === '未命名关卡' ? '' : lv.name;
    E.board = lv.board;
    E.obstacles = lv.obstacles;
    E.selected = -1;
    E.dirty = false;
    E.setBoard(E.board);
    return E;
  };

  E.setBoard = function (n) {
    E.board = U.clamp(n | 0, 7, 19);
    E.geom = P.geometry({ board: E.board, load: 0 });
    E.syncPieces();
  };

  E.toLevel = function () {
    return {
      name: E.name || '自定义关卡',
      board: E.board,
      obstacles: E.obstacles.map(o => ({ x: +o.x.toFixed(4), y: +o.y.toFixed(4), r: +o.r.toFixed(4) }))
    };
  };

  /* ---------------- 预览棋子的构建 ---------------- */
  E.syncPieces = function () {
    const geom = E.geom;
    E.pieces = E.obstacles.map((o, i) =>
      P.makePiece(i, null, 'obstacle', o.x * 1000, o.y * 1000, geom, o.r * 1000));
    return E.pieces;
  };

  /* ---------------- 编辑操作 ---------------- */
  E.hitTest = function (wx, wy, pad) {
    const extra = pad == null ? 6 : pad;
    let best = -1, bestD = Infinity;
    for (let i = E.obstacles.length - 1; i >= 0; i--) {
      const o = E.obstacles[i];
      const d = U.dist(wx, wy, o.x * 1000, o.y * 1000);
      if (d <= o.r * 1000 + extra && d < bestD) { bestD = d; best = i; }
    }
    return best;
  };

  E.addAt = function (wx, wy) {
    const r = E.brushR;
    const nx = U.clamp(wx / 1000, r, 1 - r);
    const ny = U.clamp(wy / 1000, r, 1 - r);
    E.obstacles.push({ x: nx, y: ny, r });
    E.selected = E.obstacles.length - 1;
    E.dirty = true;
    E.syncPieces();
    return E.selected;
  };

  E.moveTo = function (idx, wx, wy) {
    const o = E.obstacles[idx];
    if (!o) return;
    o.x = U.clamp(wx / 1000, o.r, 1 - o.r);
    o.y = U.clamp(wy / 1000, o.r, 1 - o.r);
    E.dirty = true;
    E.syncPieces();
  };

  E.setRadius = function (idx, r) {
    const o = E.obstacles[idx];
    if (!o) return;
    o.r = U.clamp(r, MIN_R, MAX_R);
    o.x = U.clamp(o.x, o.r, 1 - o.r);
    o.y = U.clamp(o.y, o.r, 1 - o.r);
    E.dirty = true;
    E.syncPieces();
  };

  E.remove = function (idx) {
    if (idx < 0 || idx >= E.obstacles.length) return;
    E.obstacles.splice(idx, 1);
    E.selected = -1;
    E.dirty = true;
    E.syncPieces();
  };

  E.clear = function () {
    E.obstacles = [];
    E.selected = -1;
    E.dirty = true;
    E.syncPieces();
  };

  /* ---------------- 存储 ---------------- */
  function readAll() {
    try {
      const raw = localStorage.getItem(KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.map(normLevel).filter(Boolean) : [];
    } catch (e) { return []; }
  }

  function writeAll(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  E.list = function () { return readAll(); };

  E.save = function () {
    const lv = E.toLevel();
    const list = readAll();
    const idx = list.findIndex(x => x.name === lv.name);
    if (idx >= 0) list[idx] = lv; else list.push(lv);
    writeAll(list);
    E.dirty = false;
    return lv;
  };

  E.removeSaved = function (name) {
    writeAll(readAll().filter(x => x.name !== name));
  };

  E.exportJSON = function () {
    const lv = E.toLevel();
    const text = JSON.stringify(lv, null, 2);
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (lv.name || 'level') + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
    } catch (e) { /* ignore */ }
    return text;
  };

  E.importText = function (text) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { return null; }
    const lv = normLevel(raw);
    if (!lv) return null;
    E.load(lv);
    E.dirty = true;
    return lv;
  };

  GG.Editor = E;
})(window);
