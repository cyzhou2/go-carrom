/* ===== game.js · 对局状态机 ===== */
(function (global) {
  'use strict';

  const GG = global.GG;
  const U = GG.Util, P = GG.Physics, R = GG.Render, AI = GG.AI;
  const CFG = GG.CONFIG;
  const G = GG.Game = {};

  G.cfg = null;
  G.geom = null;
  G.pieces = [];
  G.state = 'idle';      // idle | aim | sim | ai | over
  G.side = 'black';
  G.moveNo = 0;
  G.stats = { black: { kills: 0, lost: 0, civ: 0 }, white: { kills: 0, lost: 0, civ: 0 } };
  G.fx = { hits: [], falls: [] };
  G.acc = 0;
  G.simT = 0;
  G.aiAim = null;
  G.aiWait = 0;
  G.lastShot = null;
  G.token = 0;
  G.result = null;
  G.levelName = null;
  G.placeNote = '';
  G.pickSide = null;     // 正在选棋子下场的阵营
  G.pickDue = 0;         // 还要选几颗

  G.onLog = null;
  G.onBanner = null;
  G.onSound = null;
  G.onEnd = null;
  G.onTick = null;

  const other = s => (s === 'black' ? 'white' : 'black');
  const SIDE_CN = { black: '黑方', white: '白方' };
  const randRange = (a, b) => a + Math.random() * (b - a);
  const GA = 2.399963229728653;   // 黄金角，用来把同色棋子铺成一团

  G.SIDE_CN = SIDE_CN;
  G.other = other;

  /* ================= 摆盘 ================= */

  /** 棋盘内（留边）判定 */
  function inside(x, y, r, marginPx) {
    const m = (marginPx || 0) + r;
    return x >= m && x <= 1000 - m && y >= m && y <= 1000 - m;
  }

  /** 与已放置棋子 / 待放置点是否冲突 */
  function freeAt(pieces, extra, x, y, r, pad) {
    const pd = (pad || 0);
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (!p.alive) continue;
      const dx = x - p.x, dy = y - p.y;
      const rr = r + p.r + pd;
      if (dx * dx + dy * dy < rr * rr) return false;
    }
    if (extra) {
      for (let i = 0; i < extra.length; i++) {
        const p = extra[i];
        const dx = x - p.x, dy = y - p.y;
        const rr = r + (p.r || r) + pd;
        if (dx * dx + dy * dy < rr * rr) return false;
      }
    }
    return true;
  }

  /** 一方棋子聚成一团：高斯散布 + 避开障碍 */
  function placeSide(pieces, add, side, geom, troops) {
    const L = CFG.layout;
    const cell = geom.cell;
    const margin = L.margin * 1000;
    const ring = geom.r * 2 + Math.max(2, cell * L.clusterRing);

    let bestFallback = null;
    for (let att = 0; att < 40; att++) {
      const yFrac = side === 'black' ? randRange(L.clusterY[0], L.clusterY[1])
        : 1 - randRange(L.clusterY[0], L.clusterY[1]);
      const cx = randRange(L.clusterX[0], L.clusterX[1]) * 1000;
      const cy = yFrac * 1000;
      const trial = [];
      let ok = true;

      for (let k = 0; k < troops; k++) {
        let pos = null;
        for (let t = 0; t < 110; t++) {
          let x, y;
          if (k === 0) {
            // 第一颗定在聚类中心附近
            x = cx + U.gauss() * cell * L.clusterJitter;
            y = cy + U.gauss() * cell * L.clusterJitter;
          } else {
            // 其余棋子按黄金角绕中心铺开，堆成紧凑的一团
            const ang = k * GA + (t === 0 ? randRange(-0.28, 0.28) : Math.random() * U.TAU);
            const rad = ring * (0.9 + 0.2 * Math.sqrt(k)) * (0.92 + Math.random() * 0.18);
            x = cx + Math.cos(ang) * rad;
            y = cy + Math.sin(ang) * rad;
          }
          if (!inside(x, y, geom.r, margin * 0.5)) continue;
          if (!freeAt(pieces, trial, x, y, geom.r, 2)) continue;
          pos = { x, y, r: geom.r };
          break;
        }
        if (!pos) { ok = false; break; }
        trial.push(pos);
      }

      if (!ok) continue;
      if (!bestFallback) bestFallback = trial;

      // 与对方棋子至少留出一点间距
      let tooClose = false;
      const opp = other(side);
      for (const t of trial) {
        for (const p of pieces) {
          if (!p.alive || p.side !== opp || p.kind !== 'stone') continue;
          if (U.dist(t.x, t.y, p.x, p.y) < (geom.r * 2 + cell * 0.8)) { tooClose = true; break; }
        }
        if (tooClose) break;
      }
      if (tooClose) continue;

      for (const t of trial) add(side, 'stone', t.x, t.y, geom.r);
      return true;
    }

    // 兜底：按一排在己方半场摆开
    if (bestFallback) {
      for (const t of bestFallback) add(side, 'stone', t.x, t.y, geom.r);
      return true;
    }
    const y0 = side === 'black' ? 850 : 150;
    for (let k = 0; k < troops; k++) {
      const x = U.clamp(200 + (600 * (k + 1)) / (troops + 1), geom.r, 1000 - geom.r);
      add(side, 'stone', x, y0, geom.r);
    }
    return false;
  }

  function placeObstacles(pieces, add, geom, count) {
    const r = geom.obsR;
    let placed = 0;
    for (let att = 0; att < count * 260 && placed < count; att++) {
      const x = randRange(r + 40, 1000 - r - 40);
      const y = randRange(r + 40, 1000 - r - 40);
      if (!freeAt(pieces, null, x, y, r, 18)) continue;
      add(null, 'obstacle', x, y, r);
      placed++;
    }
    return placed;
  }

  function placeCivilians(pieces, add, geom, count) {
    const L = CFG.layout;
    const r = geom.civR;
    let placed = 0;
    const tries = Math.max(200, count * 60);
    for (let att = 0; att < tries && placed < count; att++) {
      let y;
      if (Math.random() < L.civCenterBias) {
        y = randRange(L.civMarginBand[0], L.civMarginBand[1]) * 1000;
      } else {
        y = randRange(0.05, 0.95) * 1000;
      }
      const x = randRange(0.05, 0.95) * 1000;
      if (!inside(x, y, r, 8)) continue;
      if (!freeAt(pieces, null, x, y, r, 2)) continue;
      add(null, 'civilian', x, y, r);
      placed++;
    }
    return placed;
  }

  function buildBoard(cfg, geom) {
    const pieces = [];
    let id = 0;
    const add = (side, kind, x, y, radius) => {
      const p = P.makePiece(id++, side, kind, x, y, geom, radius);
      p.spawn = Math.random();
      pieces.push(p);
      return p;
    };

    // 1) 关卡预设的障碍
    if (cfg.level && Array.isArray(cfg.level.obstacles)) {
      for (const o of cfg.level.obstacles) {
        const rr = U.clamp((o.r || 0.08) * 1000, 12, 460);
        add(null, 'obstacle', U.clamp(o.x, 0, 1) * 1000, U.clamp(o.y, 0, 1) * 1000, rr);
      }
    }

    // 2) 双方棋子（聚类）
    placeSide(pieces, add, 'black', geom, cfg.troops);
    placeSide(pieces, add, 'white', geom, cfg.troops);

    // 3) 随机障碍
    let obsPlaced = 0;
    if (!cfg.level && cfg.obs > 0) {
      obsPlaced = placeObstacles(pieces, add, geom, cfg.obs);
    } else if (cfg.level) {
      obsPlaced = pieces.filter(p => p.kind === 'obstacle').length;
    }

    // 4) 平民
    const civPlaced = cfg.civ > 0 ? placeCivilians(pieces, add, geom, cfg.civ) : 0;

    G.placeNote = '';
    if (cfg.obs > 0 && !cfg.level && obsPlaced < cfg.obs) {
      G.placeNote += `障碍只能放下 ${obsPlaced}/${cfg.obs}；`;
    }
    if (civPlaced < cfg.civ) {
      G.placeNote += `平民只能放下 ${civPlaced}/${cfg.civ}；`;
    }
    return pieces;
  }

  /* ================= 生化模式 ================= */

  function newFx() {
    const fx = { hits: [], falls: [] };
    if (G.cfg && G.cfg.rules === 'bio') fx.converts = [];
    return fx;
  }

  /** 平民被某方棋子撞到 → 加入该方 */
  function applyConvert(civ, side) {
    if (!civ || !civ.alive || civ.falling) return false;
    if (civ.kind !== 'civilian') return false;
    if (civ.side === side) return false;
    civ.side = side;
    civ.convertAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (G.flips) G.flips[side]++;
    return true;
  }

  G.applyConverts = function () {
    const list = G.fx && G.fx.converts;
    if (!list || !list.length) return;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      if (applyConvert(list[i].p, list[i].side)) n++;
    }
    list.length = 0;
    if (n && G.onSound) G.onSound('hit', { soft: true });
  };

  /** 生化模式下某方控制的平民数 */
  G.civOf = function (side) {
    return P.count(G.pieces, side, 'civilian');
  };

  /* ================= 开局 ================= */

  G.start = function (cfg) {
    G.cfg = Object.assign({
      mode: 'ai', board: 9, troops: 3, civ: 8, obs: 2,
      ai: 'normal', penalty: 'pick', aim: 'direct', level: null,
      rules: 'classic'          // classic = 常规 | bio = 生化
    }, cfg || {});

    const level = G.cfg.level;
    if (level && level.board) G.cfg.board = level.board;
    G.cfg.troops = U.clamp(G.cfg.troops | 0, 1, CFG.rules.maxTroops);
    G.cfg.civ = U.clamp(G.cfg.civ | 0, 0, CFG.rules.maxCivilians);
    G.cfg.obs = U.clamp(G.cfg.obs | 0, 0, CFG.rules.maxObstacles);

    const total = G.cfg.troops * 2 + G.cfg.civ +
      (level && level.obstacles ? level.obstacles.length : G.cfg.obs);
    G.token++;
    G.geom = P.geometry({ board: G.cfg.board, load: total });
    G.pieces = buildBoard(G.cfg, G.geom);

    // 消除初始穿插（不做任何出界判定）
    const safeGeom = Object.assign({}, G.geom, {
      plank: { x0: -1e7, y0: -1e7, x1: 1e7, y1: 1e7 }
    });
    P.run(G.pieces, safeGeom, 0.35, null, true);
    for (const p of G.pieces) {
      p.vx = 0; p.vy = 0; p.w = 0; p.fallT = 0; p.falling = false;
    }

    G.levelName = level ? (level.name || '自定义关卡') : null;
    G.stats = { black: { kills: 0, lost: 0, civ: 0 }, white: { kills: 0, lost: 0, civ: 0 } };
    G.moveNo = 0;
    G.side = 'black';
    G.result = null;
    G.aiAim = null;
    G.acc = 0;
    G.simT = 0;
    G.state = 'aim';
    G.fx = newFx();
    G.lastShot = null;
    G.pickSide = null;
    G.pickDue = 0;
    G.flips = { black: 0, white: 0 };

    if (G.onLog) {
      G.onLog({ type: 'turn', text: `开局 · ${G.cfg.board} 路 · 每方 ${G.cfg.troops} 子 · 平民 ${G.cfg.civ}` });
      if (G.cfg.rules === 'bio') G.onLog({ type: 'turn', text: '生化模式：棋子碰到平民即收编，撞飞平民无惩罚' });
      if (G.levelName) G.onLog({ type: 'turn', text: `关卡「${G.levelName}」` });
      if (G.placeNote) G.onLog({ type: 'penalty', text: G.placeNote });
    }
    if (G.onTick) G.onTick();
    G._afterTurnStart();
  };

  G.isHumanSide = function (side) {
    if (!G.cfg) return false;
    if (G.cfg.mode === 'pvp') return true;
    return side === 'black';
  };

  G.humanCanAct = function () {
    return G.state === 'aim' && G.isHumanSide(G.side);
  };

  G.selectable = function (idx) {
    const p = G.pieces[idx];
    return !!p && p.alive && !p.falling && p.kind === 'stone' && p.side === G.side;
  };

  /* ================= 弹射 ================= */

  G.fire = function (idx, dx, dy, power) {
    if (G.state !== 'aim' && G.state !== 'ai') return false;
    if (!G.selectable(idx)) return false;
    const p = G.pieces[idx];
    G.lastShot = { idx, side: G.side, x: p.x, y: p.y };
    const info = P.applyShot(G.pieces, idx, dx, dy, power, Math.random);
    G.lastShot.info = info;
    G.state = 'sim';
    G.simT = 0;
    G.acc = 0;
    G.fx = newFx();
    if (G.cfg.rules === 'bio') G.flips = { black: 0, white: 0 };
    if (G.onSound) G.onSound('flick', { power });
    if (G.onSound) G.onSound('slide', {});
    return true;
  };

  /* ================= 回合推进 ================= */
  G._afterTurnStart = function () {
    if (G.state === 'over') return;
    if (G.onTick) G.onTick();
    if (!G.isHumanSide(G.side)) {
      G.state = 'ai';
      G._beginAI();
    } else {
      G.state = 'aim';
      if (G.onBanner) G.onBanner(SIDE_CN[G.side] + '行动');
    }
  };

  /** 撞飞平民对 AI 的负面价值：自选模式越接近 3 个越要命 */
  function civPenFor(side) {
    if (G.cfg.rules === 'bio') return 0;   // 生化模式撞飞平民无惩罚
    if (G.cfg.penalty === 'score') return CFG.ai.killCivilian;
    if (G.cfg.penalty === 'pick') {
      const every = CFG.ai.civPenaltyEvery || 3;
      const near = (G.stats[side].civ % every) === every - 1;
      return CFG.ai.civilianPenaltyPick * (near ? CFG.ai.civilianPickDangerMul : 1);
    }
    return CFG.ai.civilianPenaltyPiece;
  }

  G._beginAI = function () {
    const token = G.token;
    G.aiAim = null;
    if (G.onBanner) G.onBanner('AI 思考中…');
    const delay = 260 + Math.random() * 260;
    setTimeout(function () {
      if (token !== G.token || G.state !== 'ai') return;
      AI.think({
        pieces: G.pieces,
        geom: G.geom,
        my: G.side,
        opp: other(G.side),
        difficulty: G.cfg.ai,
        pen: civPenFor(G.side),
        seed: (Date.now() ^ (G.moveNo * 7919)) >>> 0
      }).then(function (res) {
        if (token !== G.token || G.state !== 'ai') return;
        if (!res) { G.nextTurn(); return; }
        G.aiAim = { idx: res.idx, dx: res.dx, dy: res.dy, power: res.power, active: true };
        G.aiWait = 0.62;
        G._pendingAI = res;
      });
    }, delay);
  };

  /* ================= 惩罚 ================= */
  function knockOut(p) {
    if (!p || !p.alive) return;
    p.alive = false;
    p.falling = true;
    p.fallT = 0;
    p.fallDir = Math.random() * U.TAU;
    if (G.onSound) G.onSound('forfeit', {});
  }

  /** 额外的「平民惩罚」（非自选模式）：随机失去一子 / 仅扣分 */
  function applyLegacyPenalty(shooterSide) {
    const pen = G.cfg.penalty;
    const st = G.stats[shooterSide];
    if (pen === 'score') {
      if (G.onLog) G.onLog({ type: 'penalty', text: `撞飞平民 · ${SIDE_CN[shooterSide]}扣 1 分` });
      return;
    }
    const own = G.pieces.filter(p => p.alive && p.side === shooterSide && p.kind === 'stone');
    if (own.length > 1) {
      const victim = own[Math.floor(Math.random() * own.length)];
      knockOut(victim);
      st.lost += 1;
      R.addFloat(U.clamp(victim.x, 40, 960), U.clamp(victim.y, 40, 960), '被没收', '#ef7b6c');
      if (G.onLog) G.onLog({ type: 'penalty', text: `撞飞平民 · ${SIDE_CN[shooterSide]}被没收一颗棋子` });
    } else {
      if (G.onLog) G.onLog({ type: 'penalty', text: `撞飞平民 · ${SIDE_CN[shooterSide]}扣 1 分` });
    }
  }

  /* ---------- 自选一子下场 ---------- */
  G._startPick = function (side, due) {
    G.state = 'pick';
    G.pickSide = side;
    G.pickDue = due;
    G.lastShot = null;
    G.aiAim = null;
    G._pendingAI = null;
    const every = CFG.ai.civPenaltyEvery || 3;
    if (G.onLog) G.onLog({ type: 'penalty', text: `${SIDE_CN[side]}撞飞满 ${every} 个平民，需自选 ${due} 颗棋子下场` });
    if (G.onBanner) G.onBanner(G.isHumanSide(side) ? '点选一颗己方棋子下场' : 'AI 正在选择下场棋子…');
    if (G.onSound) G.onSound('penalty', {});
    if (G.onTick) G.onTick();
    if (!G.isHumanSide(side)) G._beginPickAI();
  };

  G.pickable = function (idx) {
    const p = G.pieces[idx];
    return G.state === 'pick' && !!p && p.alive && p.side === G.pickSide && p.kind === 'stone';
  };

  G.pickPiece = function (idx) {
    if (G.state !== 'pick') return false;
    const p = G.pieces[idx];
    if (!p || !p.alive || p.side !== G.pickSide || p.kind !== 'stone') return false;
    const side = G.pickSide;
    knockOut(p);
    G.stats[side].lost += 1;
    R.addFloat(U.clamp(p.x, 40, 960), U.clamp(p.y, 40, 960), '下场', '#ef7b6c');
    if (G.onLog) G.onLog({ type: 'penalty', text: `${SIDE_CN[side]}自选一颗棋子下场` });
    G.pickDue -= 1;

    if (P.count(G.pieces, side, 'stone') === 0) { G._end(other(side)); return true; }

    if (G.pickDue > 0) {
      if (G.onTick) G.onTick();
      if (!G.isHumanSide(side)) G._beginPickAI();
      return true;
    }
    G.pickSide = null;
    G.pickDue = 0;
    G.state = 'aim';
    G.nextTurn();
    return true;
  };

  /** AI 自动挑选最容易被撞出局的棋子下场 */
  G._beginPickAI = function () {
    const token = G.token;
    setTimeout(function () {
      if (token !== G.token || G.state !== 'pick') return;
      const cands = G.pieces.filter(p => p.alive && p.side === G.pickSide && p.kind === 'stone');
      if (!cands.length) {
        G.pickSide = null; G.pickDue = 0; G.state = 'aim'; G.nextTurn();
        return;
      }
      const pl = G.geom.plank;
      let best = cands[0], bestGap = Infinity;
      for (const p of cands) {
        const gap = Math.min(p.x - pl.x0, pl.x1 - p.x, p.y - pl.y0, pl.y1 - p.y);
        if (gap < bestGap) { bestGap = gap; best = p; }
      }
      G.pickPiece(G.pieces.indexOf(best));
    }, 620);
  };

  /* ================= 结算一回合 ================= */
  function resolveTurn() {
    const shooter = G.side;
    const opp = other(shooter);
    const st = G.stats[shooter];
    const civBefore = st.civ;
    let killed = 0, selfOut = 0, civOut = 0;

    for (const p of G.fx.falls) {
      if (p.kind === 'obstacle') continue;
      if (p.kind === 'civilian') { civOut++; continue; }
      if (p.side === opp) killed++;
      else selfOut++;
    }
    st.kills += killed;
    st.lost += selfOut;
    st.civ += civOut;

    // 出界飘字
    for (const p of G.fx.falls) {
      if (p.kind === 'obstacle') continue;
      const fx = U.clamp(p.x, 40, 960), fy = U.clamp(p.y, 40, 960);
      if (p.kind === 'civilian') R.addFloat(fx, fy, '平民 −1', '#ef7b6c');
      else if (p.side === opp) R.addFloat(fx, fy, '击落!', '#7fd0a2');
      else R.addFloat(fx, fy, '自灭', '#c9b7a2');
    }

    if (killed && G.onSound) G.onSound('kill', { n: killed });
    if (civOut && G.onSound) G.onSound('penalty', {});
    if (selfOut && G.onSound) G.onSound('selfout', {});

    if (killed) {
      if (G.onLog) G.onLog({ type: 'kill', text: `${SIDE_CN[shooter]}击落 ${killed} 颗敌方棋子` });
      if (G.onBanner) G.onBanner(`击落 ${killed} 颗！`);
      R.shake(9, 0.3);
    }
    if (selfOut && G.onLog) {
      G.onLog({ type: 'penalty', text: `${SIDE_CN[shooter]}有 ${selfOut} 颗棋子自爆出界` });
    }
    if (civOut && G.onLog) {
      const every = CFG.ai.civPenaltyEvery || 3;
      if (G.cfg.rules === 'bio') {
        G.onLog({ type: 'penalty', text: `撞飞平民 ${civOut} 个（生化模式无惩罚）` });
      } else {
        G.onLog({ type: 'penalty', text: `撞飞平民 · ${SIDE_CN[shooter]} ${st.civ % every || every}/${every}` });
      }
    }
    // 生化模式：本回合同化了多少平民
    const bio = G.cfg.rules === 'bio';
    if (bio && G.flips) {
      if (G.flips[shooter] && G.onLog) {
        G.onLog({ type: 'convert', text: `${SIDE_CN[shooter]}同化 ${G.flips[shooter]} 个平民` });
      }
      if (G.flips[opp] && G.onLog) {
        G.onLog({ type: 'convert', text: `${SIDE_CN[opp]}的棋子碰到平民，${G.flips[opp]} 个平民倒向对方` });
      }
    }
    G.fx = newFx();

    // 胜负优先
    const myLeft = P.count(G.pieces, shooter, 'stone');
    const opLeft = P.count(G.pieces, opp, 'stone');
    if (opLeft === 0 && myLeft > 0) { G._end(shooter); return; }
    if (myLeft === 0) { G._end(opp); return; }

    // 平民惩罚（生化模式完全没有惩罚）
    const bioMode = G.cfg.rules === 'bio';
    if (!bioMode) {
      if (G.cfg.penalty === 'pick') {
        const every = CFG.ai.civPenaltyEvery || 3;
        const due = Math.floor(st.civ / every) - Math.floor(civBefore / every);
        if (due > 0) { G._startPick(shooter, due); return; }
      } else if (civOut) {
        applyLegacyPenalty(shooter);
      }
    }

    G.nextTurn();
  }

  G.nextTurn = function () {
    if (G.state === 'over') return;
    G.moveNo++;
    G.side = other(G.side);
    G.state = 'aim';
    G.aiAim = null;
    G._pendingAI = null;
    G.acc = 0;
    G.simT = 0;
    if (G.onTick) G.onTick();
    G._afterTurnStart();
  };

  G._end = function (winner) {
    G.state = 'over';
    G.result = {
      winner,
      mode: G.cfg.mode,
      stats: JSON.parse(JSON.stringify(G.stats)),
      moves: G.moveNo + 1,
      level: G.levelName,
      left: {
        black: P.count(G.pieces, 'black', 'stone'),
        white: P.count(G.pieces, 'white', 'stone')
      }
    };
    G.aiAim = null;
    G.pickSide = null;
    G.pickDue = 0;
    if (G.onSound) G.onSound('win', {});
    if (G.onLog) G.onLog({ type: 'turn', text: `${SIDE_CN[winner]}胜利！` });
    if (G.onTick) G.onTick();
    if (G.onEnd) G.onEnd(G.result);
  };

  /* ================= 每帧更新 ================= */
  G.update = function (dt) {
    dt = Math.min(dt, 0.1);
    R.stepEffects(dt);

    let fallingAnim = false;
    for (const p of G.pieces) {
      if (p.falling) {
        p.fallT += dt / 0.55;
        if (p.fallT < 1) fallingAnim = true;
        p.x += p.vx * dt * 0.55;
        p.y += p.vy * dt * 0.55;
        p.vx *= 0.92; p.vy *= 0.92;
        p.a += (p.w || 0) * dt;
      }
    }

    if (G.state === 'sim') {
      G.simT += dt;
      G.acc += dt;
      let guard = 0;
      while (G.acc >= P.FIXED_DT && guard++ < P.PH.maxSubSteps) {
        P.step(G.pieces, G.geom, P.FIXED_DT, G.fx);
        G.acc -= P.FIXED_DT;
        G.applyConverts();          // 生化模式：即时同化
      }

      if (G.fx.hits.length) {
        for (const h of G.fx.hits) {
          R.spawnHit(h.x, h.y, h.impact, h.peg ? 'obstacle'
            : (h.kindA === 'civilian' || h.kindB === 'civilian') ? 'civilian' : 'stone');
          if (h.impact > 240 && G.onSound) G.onSound('hit', { impact: h.impact, peg: h.peg });
        }
        G.fx.hits.length = 0;
      }
      if (G.fx.falls.length && G.onSound) G.onSound('fall', {});

      if (G.simT > 0.12 && P.isSettled(G.pieces) && !fallingAnim) {
        resolveTurn();
      } else if (G.simT > P.MAX_SIM_TIME) {
        for (const p of G.pieces) { p.vx = 0; p.vy = 0; p.w = 0; }
        resolveTurn();
      }
    } else if (G.state === 'ai') {
      if (G.aiAim) {
        G.aiWait -= dt;
        if (G.aiWait <= 0 && G._pendingAI) {
          const r = G._pendingAI;
          G._pendingAI = null;
          G.aiAim = null;
          G.fire(r.idx, r.dx, r.dy, r.power);
        }
      }
    }
  };

  /* ================= 渲染状态 ================= */
  G.getRenderState = function () {
    let aim = null;
    if (G.state === 'aim') aim = G.uiAim || null;
    else if (G.state === 'ai' && G.aiAim) {
      aim = { idx: G.aiAim.idx, dx: G.aiAim.dx, dy: G.aiAim.dy, power: G.aiAim.power, active: true };
    }
    let ringSide = null;
    if (G.state === 'aim' && G.isHumanSide(G.side)) ringSide = G.side;
    else if (G.state === 'pick' && G.isHumanSide(G.pickSide)) ringSide = G.pickSide;
    return {
      pieces: G.pieces,
      geom: G.geom,
      aim,
      ringSide,
      picking: G.state === 'pick',
      pickSide: G.state === 'pick' ? G.pickSide : null
    };
  };

  GG.Game = G;
})(window);
