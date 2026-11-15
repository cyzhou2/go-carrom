/* ===== physics.js · 顶视冰壶物理（含角速度与接触摩擦） ===== */
(function (global) {
  'use strict';

  const GG = global.GG, U = GG.Util;
  const CFG = GG.CONFIG, PH = CFG.physics, ER = CFG.error;
  const P = GG.Physics = {};

  P.FIXED_DT = PH.fixedDt;
  P.MAX_SPEED = PH.maxSpeed;
  P.DECEL = PH.decel;
  P.STOP_SPEED = PH.stopSpeed;
  P.MAX_SIM_TIME = PH.maxSimTime;
  P.REST_EPS = PH.restSampleFrames;
  P.PH = PH;

  /* ---- 空间网格（碰撞粗筛） ---- */
  let buckets = [];
  let GX = 0, GY = 0, gridCell = 200, gridOx = 0, gridOy = 0;
  const NEI = [[1, 0], [-1, 1], [0, 1], [1, 1]];

  const bothRest = (a, b) => a.vx === 0 && a.vy === 0 && a.w === 0 && b.vx === 0 && b.vy === 0 && b.w === 0;

  function buildGrid(pieces, geom) {
    const cs = Math.max(18, Math.max(geom.r, geom.civR) * 2.4);
    const pad = geom.pad + 10;
    gridCell = cs;
    gridOx = -pad;
    gridOy = -pad;
    GX = Math.ceil((1000 + pad * 2) / cs) + 1;
    GY = GX;
    const need = GX * GY;
    if (buckets.length < need) {
      buckets = new Array(need);
      for (let i = 0; i < need; i++) buckets[i] = [];
    } else {
      for (let i = 0; i < need; i++) buckets[i].length = 0;
    }
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (!p.alive) continue;
      // 障碍盘可能跨多格：按包围盒插入所有覆盖的格子
      const x0 = Math.floor((p.x - p.r - gridOx) / cs);
      const x1 = Math.floor((p.x + p.r - gridOx) / cs);
      const y0 = Math.floor((p.y - p.r - gridOy) / cs);
      const y1 = Math.floor((p.y + p.r - gridOy) / cs);
      for (let cy = y0; cy <= y1; cy++) {
        if (cy < 0 || cy >= GY) continue;
        for (let cx = x0; cx <= x1; cx++) {
          if (cx < 0 || cx >= GX) continue;
          buckets[cy * GX + cx].push(i);
        }
      }
    }
  }

  /** 依据棋盘尺寸与棋子总数生成几何参数（棋子太多时整体缩小半径） */
  P.geometry = function (opt) {
    const n = Math.max(2, opt.board | 0);
    const cell = 1000 / (n - 1);
    const load = Math.max(0, opt.load || 0);
    const baseR = cell * PH.radiusRatio.stone;
    const need = load * Math.PI * Math.pow(baseR * 1.35, 2);
    const avail = 1e6 * CFG.layout.maxFillRatio;
    const scale = need > avail ? Math.max(0.4, Math.sqrt(avail / need)) : 1;

    const r = baseR * scale;
    const civR = r * (PH.radiusRatio.civilian / PH.radiusRatio.stone);
    const obsR = U.clamp(cell * PH.obsRadiusRatio, PH.obsRadiusMin, PH.obsRadiusMax);
    const pad = Math.max(cell * 0.6, r + 5);

    return {
      n, cell, r, civR, obsR, pad,
      radiusScale: scale,
      load,
      grid: { x0: 0, y0: 0, x1: 1000, y1: 1000 },
      plank: { x0: -pad, y0: -pad, x1: 1000 + pad, y1: 1000 + pad },
      cx: 500, cy: 500,
      pt(col, row) { return { x: col * cell, y: row * cell }; },
      nearest(x, y) {
        return { col: U.clamp(Math.round(x / cell), 0, n - 1), row: U.clamp(Math.round(y / cell), 0, n - 1) };
      }
    };
  };

  P.makePiece = function (id, side, kind, x, y, geom, radiusOverride) {
    const isObs = kind === 'obstacle';
    const r = radiusOverride != null ? radiusOverride
      : isObs ? geom.obsR : kind === 'civilian' ? geom.civR : geom.r;
    const mass = isObs ? Infinity : (kind === 'civilian' ? PH.mass.civilian : PH.mass.stone);
    return {
      id, side, kind, x, y, vx: 0, vy: 0, r, mass,
      invMass: isObs ? 0 : 1 / mass,
      invI: isObs ? 0 : 2 / (mass * r * r),   // 圆盘 I = ½mr²
      w: 0, a: 0,
      alive: true, falling: false, fallT: 0, fallDir: 0,
      hit: 0, spawn: 0, wobble: Math.random() * 6.283
    };
  };

  P.clonePieces = function (pieces) {
    const out = new Array(pieces.length);
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      out[i] = {
        id: p.id, side: p.side, kind: p.kind, x: p.x, y: p.y, vx: 0, vy: 0,
        r: p.r, mass: p.mass, invMass: p.invMass, invI: p.invI, w: 0, a: p.a || 0,
        alive: p.alive, falling: false, fallT: 0, fallDir: 0, hit: 0, spawn: 0, wobble: 0
      };
    }
    return out;
  };

  /** 采样一次发射误差：速度误差 RMS = 常数 × 预计速度；角度误差 RMS = 常数 */
  P.sampleError = function (plannedSpeed, rnd) {
    if (!ER.enabled) return { dv: 0, da: 0 };
    const r = rnd || Math.random;
    const sigmaV = Math.max(ER.minSpeedSigma, plannedSpeed * ER.speedSigmaRatio);
    return { dv: U.gauss(r) * sigmaV, da: U.gauss(r) * ER.angleSigma };
  };

  /**
   * 出杆。传入 rnd 时按正态分布加入真实误差（游戏与 AI 推演共用同一模型）。
   * 返回这次出杆的实际参数，便于调试。
   */
  P.applyShot = function (pieces, idx, dx, dy, power, rnd, noError) {
    const p = pieces[idx];
    if (!p || !p.alive) return null;
    const l = Math.hypot(dx, dy) || 1;
    const planned = U.clamp(power, 0, 1) * PH.maxSpeed;
    let ang = Math.atan2(dy / l, dx / l);
    let speed = planned;
    let err = null;

    if (rnd && !noError) {
      err = P.sampleError(planned, rnd);
      ang += err.da;
      speed = Math.max(0, planned + err.dv);
    }

    p.vx = Math.cos(ang) * speed;
    p.vy = Math.sin(ang) * speed;
    if (rnd && !noError && ER.launchSpinSigma > 0) {
      p.w = U.gauss(rnd) * ER.launchSpinSigma * (speed / PH.maxSpeed);
    }
    return { planned, speed, angle: ang, err };
  };

  /** 处理一对棋子的碰撞：法向弹开 + 接触点库伦摩擦 + 自旋交换 */
  function resolvePair(a, b, MU, fx) {
    if (!a.alive || !b.alive) return;
    if (a.invMass === 0 && b.invMass === 0) return;

    const dx = b.x - a.x, dy = b.y - a.y;
    const sum = a.r + b.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= sum * sum) return;

    // 生化模式：任何"有阵营的子力"（初始棋子或已被同化的子力）碰到中立平民 → 立刻同化
    if (fx && fx.converts) {
      if (a.side && b.kind === 'civilian' && !b.side) {
        fx.converts.push({ p: b, side: a.side });
      } else if (b.side && a.kind === 'civilian' && !a.side) {
        fx.converts.push({ p: a, side: b.side });
      }
    }

    let d = Math.sqrt(d2), nx, ny;
    if (d < 1e-4) { d = 1e-4; nx = 1; ny = 0; }
    else { nx = dx / d; ny = dy / d; }
    const tx = -ny, ty = nx;

    const ia = a.invMass, ib = b.invMass;
    const s = ia + ib;

    // 位置校正，消除穿插
    const corr = (sum - d) * PH.positionCorrection;
    if (ia > 0) { a.x -= nx * corr * (ia / s); a.y -= ny * corr * (ia / s); }
    if (ib > 0) { b.x += nx * corr * (ib / s); b.y += ny * corr * (ib / s); }

    // 接触点相对各自圆心
    const rax = nx * a.r, ray = ny * a.r;
    const rbx = -nx * b.r, rby = -ny * b.r;

    // 接触点速度 = v + ω × r
    const avx = a.vx - a.w * ray, avy = a.vy + a.w * rax;
    const bvx = b.vx - b.w * rby, bvy = b.vy + b.w * rbx;
    const rvx = bvx - avx, rvy = bvy - avy;

    const vn = rvx * nx + rvy * ny;
    if (vn > 0) return;

    const e = (ia === 0 || ib === 0) ? PH.restitution.obstacle
      : (a.kind === 'civilian' || b.kind === 'civilian') ? PH.restitution.civilian
        : PH.restitution.stone;

    const jn = -(1 + e) * vn / s;
    if (jn <= 0) return;

    // 切向冲量（库伦摩擦，上限 μ·jn）
    const vt = rvx * tx + rvy * ty;
    let jt = 0;
    const kt = s + a.invI * a.r * a.r + b.invI * b.r * b.r;
    if (kt > 1e-9 && MU > 0) {
      jt = -vt / kt;
      const maxJt = MU * jn;
      if (jt > maxJt) jt = maxJt;
      else if (jt < -maxJt) jt = -maxJt;
    }

    const Jx = jn * nx + jt * tx;
    const Jy = jn * ny + jt * ty;

    if (ib > 0) {
      b.vx += Jx * ib; b.vy += Jy * ib;
      b.w += b.invI * (rbx * Jy - rby * Jx);
      if (b.w > PH.spinMax) b.w = PH.spinMax;
      else if (b.w < -PH.spinMax) b.w = -PH.spinMax;
    }
    if (ia > 0) {
      a.vx -= Jx * ia; a.vy -= Jy * ia;
      a.w -= a.invI * (rax * Jy - ray * Jx);
      if (a.w > PH.spinMax) a.w = PH.spinMax;
      else if (a.w < -PH.spinMax) a.w = -PH.spinMax;
    }

    const impact = -vn;
    if (impact > 30) {
      if (a.kind !== 'obstacle') a.hit = Math.min(1, impact / 900);
      if (b.kind !== 'obstacle') b.hit = Math.min(1, impact / 900);
      if (fx) fx.hits.push({
        x: a.x + nx * a.r, y: a.y + ny * a.r,
        impact, kindA: a.kind, kindB: b.kind,
        peg: a.kind === 'obstacle' || b.kind === 'obstacle',
        friction: Math.abs(jt)
      });
    }
  }

  /** 推进一个固定时间步 */
  P.step = function (pieces, geom, dt, fx, full) {
    const n = pieces.length;

    /* --- 1) 桌面摩擦 / 自旋衰减 / 冰壶效应 / 位移 --- */
    for (let i = 0; i < n; i++) {
      const p = pieces[i];
      if (!p.alive || p.invMass === 0) continue;

      let sp = Math.hypot(p.vx, p.vy);

      if (sp > 0) {
        if (PH.curlCoef > 0 && Math.abs(p.w) > 0.05) {
          const px = -p.vy / sp, py = p.vx / sp;
          const mag = PH.curlCoef * p.w * sp;
          p.vx += px * mag * dt;
          p.vy += py * mag * dt;
          const nsp = Math.hypot(p.vx, p.vy);
          if (nsp > 0) { p.vx *= sp / nsp; p.vy *= sp / nsp; }
        }

        let dec = PH.decel * dt;
        if (PH.dragQuadratic > 0) dec += PH.dragQuadratic * sp * sp * dt;

        if (dec >= sp - PH.stopSpeed) {
          p.vx = 0; p.vy = 0;
        } else {
          const k = (sp - dec) / sp;
          p.vx *= k; p.vy *= k;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
        }
      }

      if (p.w !== 0) {
        const dw = PH.spinDecel * dt;
        if (Math.abs(p.w) <= dw + PH.stopSpin) p.w = 0;
        else p.w -= Math.sign(p.w) * dw;
        p.a += p.w * dt;
      }

      if (p.hit > 0) p.hit = Math.max(0, p.hit - dt * 4.5);
    }

    /* --- 2) 碰撞：法向弹开 + 接触点库伦摩擦（产生/消耗旋转） ---
     * 空间网格做粗筛：只检查可能接触的棋对，70+ 棋子也能实时 / 供 AI 高频推演。
     */
    const MU = PH.contactFriction;

    if (full) {
      for (let it = 0; it < PH.subSteps; it++) {
        for (let i = 0; i < n; i++) {
          const a = pieces[i];
          if (!a.alive) continue;
          for (let j = i + 1; j < n; j++) resolvePair(a, pieces[j], MU, fx);
        }
      }
    } else {
      // 全场静止就完全跳过碰撞检测
      let anyMoving = false;
      for (let i = 0; i < n; i++) {
        const p = pieces[i];
        if (p.alive && p.invMass > 0 && (p.vx !== 0 || p.vy !== 0 || p.w !== 0)) { anyMoving = true; break; }
      }
      if (anyMoving) {
        buildGrid(pieces, geom);
        for (let it = 0; it < PH.subSteps; it++) {
          for (let cy = 0; cy < GY; cy++) {
            const row = cy * GX;
            for (let cx = 0; cx < GX; cx++) {
              const b0 = buckets[row + cx];
              const len0 = b0.length;
              if (!len0) continue;
              for (let ii = 0; ii < len0; ii++) {
                const a = pieces[b0[ii]];
                if (!a.alive) continue;
                for (let jj = ii + 1; jj < len0; jj++) {
                  const b = pieces[b0[jj]];
                  if (!bothRest(a, b)) resolvePair(a, b, MU, fx);
                }
                for (let k = 0; k < 4; k++) {
                  const nx2 = cx + NEI[k][0], ny2 = cy + NEI[k][1];
                  if (nx2 < 0 || nx2 >= GX || ny2 < 0 || ny2 >= GY) continue;
                  const b1 = buckets[ny2 * GX + nx2];
                  for (let jj = 0; jj < b1.length; jj++) {
                    const b = pieces[b1[jj]];
                    if (!bothRest(a, b)) resolvePair(a, b, MU, fx);
                  }
                }
              }
            }
          }
        }
      }
    }

    /* --- 3) 出界 --- */
    const pl = geom.plank;
    for (let i = 0; i < n; i++) {
      const p = pieces[i];
      if (!p.alive || p.invMass === 0) continue;
      if (p.x < pl.x0 - 1 || p.x > pl.x1 + 1 || p.y < pl.y0 - 1 || p.y > pl.y1 + 1) {
        p.alive = false;
        p.falling = true;
        p.fallT = 0;
        p.fallDir = Math.atan2(p.vy, p.vx) || 0;
        if (fx) fx.falls.push(p);
      }
    }
  };

  P.isSettled = function (pieces) {
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (!p.alive) continue;
      if (p.vx !== 0 || p.vy !== 0) return false;
      if (p.w !== 0) return false;
    }
    return true;
  };

  /** 无渲染推进（AI 试算 / 开局整理） */
  P.run = function (pieces, geom, maxTime, fx, full) {
    let t = 0, f = 0;
    const limit = maxTime || PH.maxSimTime;
    while (t < limit) {
      P.step(pieces, geom, PH.fixedDt, fx, full);
      t += PH.fixedDt;
      if (++f % PH.restSampleFrames === 0 && P.isSettled(pieces)) break;
    }
    return t;
  };

  P.count = function (pieces, side, kind) {
    let c = 0;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (p.alive && p.side === side && p.kind === kind) c++;
    }
    return c;
  };

  GG.Physics = P;
})(window);
