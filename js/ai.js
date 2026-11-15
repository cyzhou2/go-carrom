/* ===== ai.js · 候选弹射 + 物理推演评分 ===== */
(function (global) {
  'use strict';

  const GG = global.GG;
  const U = GG.Util, P = GG.Physics;
  const CFG = GG.CONFIG, AIC = CFG.ai;
  const AI = GG.AI = {};

  AI.DIFF = CFG.difficulty;

  function edgeGap(p, pl) {
    return Math.min(p.x - pl.x0, pl.x1 - p.x, p.y - pl.y0, pl.y1 - p.y);
  }

  /** 结果评分：站在 my 的角度 */
  /** 生化模式下被收编的平民也是棋子 */
  function isPiece(p) {
    return p.kind === 'stone' || (p.kind === 'civilian' && !!p.side);
  }

  function scoreOutcome(sim, before, my, opp, geom, pen) {
    const pl = geom.plank;
    const penKill = pen || AIC.killCivilian;
    let s = 0;
    for (let i = 0; i < sim.length; i++) {
      const a = sim[i], b = before[i];
      if (!b.alive || b.kind === 'obstacle') continue;
      const died = !a.alive;
      if (b.side === opp && isPiece(b)) {
        if (died) s += AIC.killEnemy;
        else {
          const near = Math.max(0, 1 - edgeGap(a, pl) / (geom.cell * AIC.edgeRange));
          s += near * near * AIC.edgeWeight;
        }
      } else if (b.side === my && isPiece(b)) {
        if (died) s -= AIC.loseSelf;
        else {
          const near = Math.max(0, 1 - edgeGap(a, pl) / (geom.cell * AIC.selfEdgeRange));
          s -= near * near * AIC.selfEdgeWeight;
        }
      } else if (b.kind === 'civilian') {
        if (died) s -= penKill;
      }
    }
    return s;
  }

  /** 生成候选弹射 */
  function buildCandidates(pieces, geom, my, opp, diff, rnd) {
    const mine = [], enemies = [];
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (!p.alive || p.kind === 'obstacle') continue;
      if (p.side === my) mine.push(i);
      else if (p.side === opp) enemies.push(i);
    }
    const out = [];
    const PWR = [1.02, 1.3, 1.62, 1.95];

    function push(idx, tx, ty, pw) {
      const p = pieces[idx];
      const dx = tx - p.x, dy = ty - p.y;
      if (dx * dx + dy * dy < 4) return;
      out.push({ idx, dx, dy, power: U.clamp(pw, 0.08, 1) });
    }

    for (let a = 0; a < mine.length; a++) {
      const m = pieces[mine[a]];
      for (let b = 0; b < enemies.length; b++) {
        const e = pieces[enemies[b]];
        const d = U.dist(m.x, m.y, e.x, e.y);
        const need = Math.sqrt(2 * P.DECEL * Math.max(d, 1)) / P.MAX_SPEED;
        const tx = -(e.y - m.y), ty = (e.x - m.x);
        const tl = Math.hypot(tx, ty) || 1;
        const nxp = tx / tl, nyp = ty / tl;
        for (let k = 0; k < diff.powers; k++) {
          const pw = need * PWR[k] + 0.05;
          push(mine[a], e.x, e.y, pw);
          const off = e.r * 0.8;
          push(mine[a], e.x + nxp * off, e.y + nyp * off, pw * 0.98);
          push(mine[a], e.x - nxp * off, e.y - nyp * off, pw * 0.98);
        }
      }
      // 借障碍反弹
      for (let o = 0; o < pieces.length; o++) {
        const ob = pieces[o];
        if (!ob.alive || ob.kind !== 'obstacle') continue;
        const d = U.dist(m.x, m.y, ob.x, ob.y);
        if (d > geom.cell * 3.2) continue;
        const need = Math.sqrt(2 * P.DECEL * d) / P.MAX_SPEED;
        const nx = -(ob.y - m.y) / (d || 1), ny = (ob.x - m.x) / (d || 1);
        const off = ob.r * 0.72;
        push(mine[a], ob.x + nx * off, ob.y + ny * off, need * 1.15);
        push(mine[a], ob.x - nx * off, ob.y - ny * off, need * 1.15);
      }
      push(mine[a], geom.cx + (rnd() - 0.5) * 520, geom.cy + (rnd() - 0.5) * 520, 0.35 + rnd() * 0.4);
    }

    for (let k = 0; k < diff.rand && mine.length; k++) {
      const idx = mine[Math.floor(rnd() * mine.length)];
      const ang = rnd() * U.TAU;
      out.push({ idx, dx: Math.cos(ang), dy: Math.sin(ang), power: 0.18 + rnd() * 0.82 });
    }

    // 候选太多时随机抽样，保证每颗己方棋子都有机会被选中
    const cap = diff.cap || 999;
    if (out.length > cap) {
      const keep = [];
      const byStone = new Map();
      for (const c of out) {
        if (!byStone.has(c.idx)) byStone.set(c.idx, []);
        byStone.get(c.idx).push(c);
      }
      const per = Math.max(1, Math.ceil(cap / Math.max(1, mine.length)));
      byStone.forEach(list => {
        U.shuffle(list, rnd);
        for (let i = 0; i < Math.min(per, list.length); i++) keep.push(list[i]);
      });
      U.shuffle(keep, rnd);
      return keep.slice(0, cap);
    }

    return out;
  }

  /** 难度带来的"手不稳"：直接烘进候选，使评估与执行一致 */
  function skillJitter(c, diff, rnd) {
    let ang = Math.atan2(c.dy, c.dx);
    let pow = c.power;
    if (diff.angErr > 0) ang += ((rnd() + rnd() + rnd() - 1.5) / 1.5) * diff.angErr * 2;
    if (diff.powErr > 0) {
      pow = U.clamp(pow * (1 + ((rnd() + rnd() + rnd() - 1.5) / 1.5) * diff.powErr * 2), 0.05, 1);
    }
    return { idx: c.idx, dx: Math.cos(ang), dy: Math.sin(ang), power: pow };
  }

  /**
   * 推演一次。rnd 传入时会带上与实机相同的出杆误差（angErr/powErr 之外）。
   */
  function simulateShot(before, geom, c, rnd, maxTime) {
    const sim = P.clonePieces(before);
    const noErr = !CFG.error.enabled || !CFG.error.aiUsesError;
    if (!P.applyShot(sim, c.idx, c.dx, c.dy, c.power, rnd, noErr)) return null;
    const budget = maxTime || AIC.simTime || P.MAX_SIM_TIME;
    const steps = Math.min(Math.ceil(budget / P.FIXED_DT), 4200);
    for (let s = 0; s < steps; s++) {
      P.step(sim, geom, P.FIXED_DT, null);
      if ((s & 15) === 15 && P.isSettled(sim)) break;
    }
    return sim;
  }

  /** 多次采样评估（降低单次误差带来的高估） */
  function evalCandidate(before, geom, c, my, opp, pen, rnd, samples) {
    let sum = 0, n = 0;
    for (let k = 0; k < samples; k++) {
      const sim = simulateShot(before, geom, c, rnd, AIC.simTime);
      if (!sim) continue;
      sum += scoreOutcome(sim, before, my, opp, geom, pen);
      n++;
    }
    return n ? sum / n : -1e9;
  }

  /** 对手最佳回应的粗略损失估计（凶狠难度用） */
  function oppReply(sim, geom, my, opp, diff, rnd, pen) {
    const cands = buildCandidates(sim, geom, opp, my, diff, rnd);
    const top = U.shuffle(cands.slice(), rnd).slice(0, diff.replyN || 10);
    let worst = 0;
    for (const c of top) {
      const s2 = simulateShot(sim, geom, skillJitter(c, diff, rnd), rnd, AIC.simTimeQuick);
      if (!s2) continue;
      const v = scoreOutcome(s2, sim, opp, my, geom, pen);
      if (v > worst) worst = v;
    }
    return worst;
  }

  /**
   * 思考并返回一手棋：
   * { idx, dx, dy, power, score, cands, ms }
   */
  AI.think = function (opt) {
    const pieces = opt.pieces;
    const geom = opt.geom;
    const my = opt.my, opp = opt.opp;
    const diff = CFG.difficulty[opt.difficulty] || CFG.difficulty.normal;
    const pen = opt.pen || AIC.killCivilian;
    const rnd = U.mulberry32((opt.seed || Date.now()) >>> 0);

    return new Promise(function (resolve) {
      const cands = buildCandidates(pieces, geom, my, opp, diff, rnd);
      if (!cands.length) { resolve(null); return; }

      let i = 0;
      const results = [];
      const t0 = performance.now();

      function work() {
        const sliceEnd = performance.now() + 14;
        while (i < cands.length && performance.now() < sliceEnd) {
          const shot = skillJitter(cands[i++], diff, rnd);
          const sim = simulateShot(pieces, geom, shot, rnd, AIC.simTimeQuick);
          if (!sim) continue;
          results.push({ c: shot, score: scoreOutcome(sim, pieces, my, opp, geom, pen) });
        }
        if (i < cands.length) { setTimeout(work, 0); return; }
        finish();
      }

      function finish() {
        results.sort((a, b) => b.score - a.score);
        let best = null;

        if (diff.soft > 0 && results.length > 1) {
          // 温和：在若干好棋里按 softmax 随机挑，会犯错
          const pool = results.slice(0, Math.min(results.length, diff.soft > 0.4 ? 6 : 4));
          let total = 0;
          const w = pool.map((r, k) => { const v = Math.exp(-k * 0.55); total += v; return v; });
          let pick = rnd() * total;
          best = pool[0];
          for (let k = 0; k < pool.length; k++) {
            pick -= w[k];
            if (pick <= 0) { best = pool[k]; break; }
          }
        } else {
          const pool = results.slice(0, Math.max(1, AIC.reEvalTop));
          let bestVal = -1e9;
          for (const r of pool) {
            let val = AIC.reEvalSamples > 1
              ? evalCandidate(pieces, geom, r.c, my, opp, pen, rnd, AIC.reEvalSamples)
              : r.score;
            if (diff.reply > 0) {
              const sim = simulateShot(pieces, geom, r.c, rnd, 12);
              if (sim) val -= oppReply(sim, geom, my, opp, diff, rnd, pen) * AIC.replyWeight;
            }
            if (val > bestVal) { bestVal = val; best = r; }
          }
        }
        if (!best) best = results[0];

        const c = best.c;
        resolve({
          idx: c.idx,
          dx: c.dx, dy: c.dy, power: c.power,
          score: best.score,
          cands: cands.length,
          ms: Math.round(performance.now() - t0)
        });
      }

      work();
    });
  };

  GG.AI = AI;
})(window);
