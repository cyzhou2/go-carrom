/* ===== 无浏览器的规则自测（node test/selftest.js） ===== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const store = {};
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  performance: { now: () => Number(process.hrtime.bigint() / 1000000n) },
  requestAnimationFrame: cb => setTimeout(() => cb(performance.now()), 0),
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  Math, Date, JSON
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const dir = path.join(__dirname, '..', 'js');
for (const f of ['util.js', 'config.js', 'physics.js', 'ai.js', 'editor.js', 'game.js']) {
  if (f === 'game.js') {
    sandbox.GG.Render = { shake() {}, spawnHit() {}, stepEffects() {}, setSkin() {}, addFloat() {} };
  }
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox, { filename: f });
}

const { GG } = sandbox;
const G = GG.Game, P = GG.Physics, AI = GG.AI, U = GG.Util, E = GG.Editor, CFG = GG.CONFIG;
const ER = CFG.error;

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) { fails++; console.log('  \u2717 ' + msg); }
  else console.log('  \u2713 ' + msg);
  return cond;
};

async function playMove(diff, side) {
  const res = await AI.think({
    pieces: G.pieces, geom: G.geom, my: side, opp: G.other(side), difficulty: diff,
    pen: 105, seed: (Math.random() * 1e9) | 0
  });
  if (!res) return false;
  G.state = 'aim';
  G.fire(res.idx, res.dx, res.dy, res.power);
  let guard = 0;
  while (G.state === 'sim' && guard++ < 8000) G.update(1 / 120);
  // 平民惩罚：自动为该方选一颗棋子下场
  let pg = 0;
  while (G.state === 'pick' && pg++ < 12) {
    let idx = -1;
    for (let i = 0; i < G.pieces.length; i++) if (G.pickable(i)) { idx = i; break; }
    if (idx < 0) break;
    G.pickPiece(idx);
  }
  return true;
}

async function main() {
  /* ---------- 1. 物理 ---------- */
  console.log('\n[1] 物理（摩擦 / 碰撞 / 自旋）');
  {
    const geom = P.geometry({ board: 9 });
    ok(Math.abs(geom.cell - 125) < 1e-9, 'cell = 125');

    // 去掉出界边界，单纯检验摩擦模型
    const wide = P.geometry({ board: 9 });
    wide.plank = { x0: -1e7, y0: -1e7, x1: 1e7, y1: 1e7 };
    const pcs = [P.makePiece(0, 'black', 'stone', 0, 0, wide)];
    P.applyShot(pcs, 0, 1, 0, 1, null);
    P.run(pcs, wide, 20);
    const travelled = pcs[0].x;
    const expect = P.MAX_SPEED * P.MAX_SPEED / (2 * P.DECEL);
    ok(travelled > 1200, '满力滑行 > 1.2 块棋盘 (实测 ' + Math.round(travelled) + ')');
    ok(Math.abs(travelled - expect) < expect * 0.06, '滑行距离符合 v²/2a 解析解');

    // 同质量对撞传递动量
    const a = P.makePiece(0, 'black', 'stone', 400, 500, geom);
    const b = P.makePiece(1, 'white', 'stone', 600, 500, geom);
    const arr = [a, b];
    P.applyShot(arr, 0, 1, 0, 0.6, null);
    P.run(arr, geom, 10);
    ok(b.x > 620, '同质量对撞传递动量 (白子被推到 ' + Math.round(b.x) + ')');

    // 无限质量障碍
    const c = P.makePiece(1, 'black', 'stone', 300, 500, geom);
    const ob = P.makePiece(2, null, 'obstacle', 500, 500, geom);
    const arr2 = [c, ob];
    P.applyShot(arr2, 0, 1, 0, 0.8, null);
    P.run(arr2, geom, 10);
    ok(ob.x === 500 && ob.y === 500, '障碍圆盘永不被推动');
    ok(c.x < 420, '撞障碍会反弹回来');

    // 自旋：斜撞产生角速度
    const s1 = P.makePiece(0, 'black', 'stone', 380, 500, geom);
    const s2 = P.makePiece(1, 'white', 'stone', 560, 500, geom);
    const arrS = [s1, s2];
    P.applyShot(arrS, 0, 1, 0.62, 0.55, null);
    for (let i = 0; i < 60; i++) P.step(arrS, geom, P.FIXED_DT, null);
    ok(Math.abs(s1.w) > 0.2 || Math.abs(s2.w) > 0.2,
      '斜撞产生自旋 (w=' + (s1.w + s2.w).toFixed(2) + ' rad/s)');

    // 自旋衰减到 0
    const spin = P.makePiece(0, 'black', 'stone', 500, 500, geom);
    spin.w = 30;
    const arrW = [spin];
    P.run(arrW, geom, 12);
    ok(spin.w === 0, '自旋会因摩擦衰减到 0');

    // 正碰几乎不产生旋转（接触点在质心连线上）
    const h1 = P.makePiece(0, 'black', 'stone', 400, 500, geom);
    const h2 = P.makePiece(1, 'white', 'stone', 600, 500, geom);
    const arrH = [h1, h2];
    P.applyShot(arrH, 0, 1, 0, 0.5, null);
    for (let i = 0; i < 40; i++) P.step(arrH, geom, P.FIXED_DT, null);
    ok(Math.abs(h1.w) < 0.5 && Math.abs(h2.w) < 0.5, '正碰基本不产生自旋');
  }

  /* ---------- 2. 发射误差分布 ---------- */
  console.log('\n[2] 误差模型（正态分布）');
  {
    const wide = P.geometry({ board: 9 });
    wide.plank = { x0: -1e7, y0: -1e7, x1: 1e7, y1: 1e7 };
    const rnd = U.mulberry32(20260101);
    const N = 6000;
    const dvs = [], das = [], speeds = [];
    const power = 0.5;
    const planned = power * P.MAX_SPEED;
    const pcs = [P.makePiece(0, 'black', 'stone', 0, 0, wide)];
    for (let i = 0; i < N; i++) {
      pcs[0].alive = true;
      const info = P.applyShot(pcs, 0, 1, 0, power, rnd);
      dvs.push(info.speed - info.planned);
      das.push(info.angle);
      speeds.push(info.speed);
    }
    const dv = U.stats(dvs), da = U.stats(das);
    const ratio = dv.rms / planned;
    ok(Math.abs(ratio - ER.speedSigmaRatio) < 0.005,
      `速度误差方均根 = ${(ratio * 100).toFixed(3)}% ≈ 配置 ${(ER.speedSigmaRatio * 100).toFixed(1)}%`);
    ok(Math.abs(da.rms - ER.angleSigma) < 0.0018,
      `角度误差方均根 = ${da.rms.toFixed(4)} rad ≈ 配置 ${ER.angleSigma}`);
    ok(Math.abs(dv.mean) < ER.speedSigmaRatio * planned * 0.12,
      '速度误差均值为 0（无系统偏差）');
    // 正态性：约 68% 落在 1σ 内，95% 落在 2σ 内
    const within1 = dvs.filter(v => Math.abs(v) <= dv.sd).length / N;
    const within2 = dvs.filter(v => Math.abs(v) <= dv.sd * 2).length / N;
    ok(within1 > 0.64 && within1 < 0.72, `1σ 覆盖率 ${(within1 * 100).toFixed(1)}% ≈ 68%`);
    ok(within2 > 0.93 && within2 < 0.97, `2σ 覆盖率 ${(within2 * 100).toFixed(1)}% ≈ 95%`);
  }

  /* ---------- 3. 摆盘 ---------- */
  console.log('\n[3] 随机聚类摆盘');
  {
    const cases = [[9, 3, 8], [13, 4, 20], [19, 5, 60], [17, 5, 40], [7, 2, 6]];
    for (const [board, troops, civ] of cases) {
      G.start({ board, troops, civ, obs: 3 });
      const black = G.pieces.filter(p => p.side === 'black' && p.kind === 'stone');
      const white = G.pieces.filter(p => p.side === 'white' && p.kind === 'stone');
      ok(black.length === troops && white.length === troops,
        `${board}路 ${troops}v${troops}：双方棋子数正确`);
      ok(G.pieces.filter(p => p.kind === 'civilian').length === civ,
        `${board}路：平民 ${civ} 个全部放下`);
      ok(G.pieces.filter(p => !p.alive).length === 0, `${board}路：开局无棋子出界`);

      // 黑下白上
      const cyB = black.reduce((s, p) => s + p.y, 0) / black.length;
      const cyW = white.reduce((s, p) => s + p.y, 0) / white.length;
      ok(cyB > 500 && cyW < 500, `${board}路：黑在下、白在上 (${Math.round(cyW)} < 500 < ${Math.round(cyB)})`);

      // 聚类：同侧平均距离应明显小于异侧
      let inSide = 0, nIn = 0, cross = 0, nCross = 0;
      for (let i = 0; i < black.length; i++) {
        for (let j = i + 1; j < black.length; j++) { inSide += U.dist(black[i].x, black[i].y, black[j].x, black[j].y); nIn++; }
        for (const w of white) { cross += U.dist(black[i].x, black[i].y, w.x, w.y); nCross++; }
      }
      ok(nIn === 0 || inSide / nIn < (cross / nCross) * (troops <= 2 ? 0.8 : 0.6),
        `${board}路：己方棋子成团（内部 ${Math.round(inSide / Math.max(1, nIn))} vs 跨方 ${Math.round(cross / nCross)}）`);

      // 不在格点上：坐标极少恰好落在交叉点
      const cell = 1000 / (board - 1);
      const onGrid = G.pieces.filter(p => p.kind !== 'obstacle' &&
        Math.abs(p.x / cell - Math.round(p.x / cell)) < 0.02 &&
        Math.abs(p.y / cell - Math.round(p.y / cell)) < 0.02).length;
      ok(onGrid <= 2, `${board}路：棋子随机分布在格子之间（落在格点 ${onGrid} 个）`);

      // 无明显重叠
      let overlap = 0;
      for (let i = 0; i < G.pieces.length; i++) {
        for (let j = i + 1; j < G.pieces.length; j++) {
          const p = G.pieces[i], q = G.pieces[j];
          if (U.dist(p.x, p.y, q.x, q.y) < (p.r + q.r) * 0.8) overlap++;
        }
      }
      ok(overlap === 0, `${board}路：开局无重叠`);
    }
  }

  /* ---------- 4. 规则 ---------- */
  console.log('\n[4] 规则');
  {
    G.start({ mode: 'pvp', board: 9, troops: 2, civ: 0, obs: 0 });
    const whites = G.pieces.filter(p => p.side === 'white');
    const blackStone = G.pieces.find(p => p.side === 'black');
    G.state = 'aim';
    G.fire(G.pieces.indexOf(blackStone), 0, -1, 0.1);
    whites.forEach(p => { p.alive = false; p.falling = true; p.fallT = 0.9; });
    G.fx.falls = whites.slice();
    G.side = 'black';
    let guard = 0;
    while (G.state === 'sim' && guard++ < 6000) G.update(1 / 120);
    ok(G.state === 'over' && G.result.winner === 'black', '击落全部敌方棋子即获胜');

    // 平民惩罚：每 3 个自选一子下场
    G.start({ mode: 'pvp', board: 9, troops: 3, civ: 6, obs: 0, penalty: 'pick' });
    const civA = G.pieces.find(p => p.kind === 'civilian');
    let shooter = G.pieces.find(p => p.side === 'black');
    G.state = 'aim';
    G.fire(G.pieces.indexOf(shooter), 0, -1, 0.05);
    civA.alive = false; civA.falling = true; civA.fallT = 0.95;
    G.fx.falls = [civA];
    guard = 0;
    while (G.state === 'sim' && guard++ < 6000) G.update(1 / 120);
    ok(G.stats.black.civ === 1, '撞飞 1 个平民计入进度');
    ok(P.count(G.pieces, 'black', 'stone') === 3, '撞飞 1 个平民不损失棋子');
    ok(G.state === 'aim' && G.side === 'white', '1 个平民后正常换手');

    // 再撞 2 个 → 达到 3 个，进入自选下场
    G.stats.black.civ = 2;
    const civB = G.pieces.find(p => p.kind === 'civilian');
    shooter = G.pieces.find(p => p.side === 'black' && p.alive);
    G.side = 'black';
    G.state = 'aim';
    G.fire(G.pieces.indexOf(shooter), 0, -1, 0.05);
    civB.alive = false; civB.falling = true; civB.fallT = 0.95;
    G.fx.falls = [civB];
    guard = 0;
    while (G.state === 'sim' && guard++ < 6000) G.update(1 / 120);
    ok(G.state === 'pick' && G.pickSide === 'black' && G.pickDue === 1,
      '撞满 3 个平民 → 进入自选一子下场');
    const ownIdx = G.pieces.findIndex(p => p.alive && p.side === 'black' && p.kind === 'stone');
    ok(G.pickable(ownIdx), '己方棋子可被选中下场');
    ok(!G.pickable(G.pieces.findIndex(p => p.alive && p.side === 'white' && p.kind === 'stone')),
      '敌方棋子不可被选中下场');
    G.pickPiece(ownIdx);
    ok(P.count(G.pieces, 'black', 'stone') === 2, '自选棋子已下场（3 → 2）');
    ok(G.state === 'aim' && G.side === 'white', '下场后回合移交给对方');

    // 撞 2 个仍然不下场（不能因为第 1、2 个就把人拿下）
    G.start({ mode: 'pvp', board: 9, troops: 3, civ: 8, obs: 0, penalty: 'pick' });
    for (let k = 1; k <= 2; k++) {
      const civK = G.pieces.find(p => p.alive && p.kind === 'civilian');
      G.side = 'black'; G.state = 'aim';
      G.fire(G.pieces.indexOf(G.pieces.find(p => p.alive && p.side === 'black' && p.kind === 'stone')), 0, -1, 0.05);
      civK.alive = false; civK.falling = true; civK.fallT = 0.95;
      G.fx.falls = [civK];
      guard = 0;
      while (G.state === 'sim' && guard++ < 6000) G.update(1 / 120);
    }
    ok(G.stats.black.civ === 2 && G.state !== 'pick' && P.count(G.pieces, 'black', 'stone') === 3,
      '撞飞 2 个平民仍不下场（3 个才触发）');

    // 自灭（弹射棋子自己出界）不能抵消平民罚则
    G.start({ mode: 'pvp', board: 9, troops: 3, civ: 6, obs: 0, penalty: 'pick' });
    G.stats.black.civ = 2;
    const civD = G.pieces.find(p => p.alive && p.kind === 'civilian');
    const selfStone = G.pieces.find(p => p.alive && p.side === 'black' && p.kind === 'stone');
    G.state = 'aim';
    G.fire(G.pieces.indexOf(selfStone), 0, -1, 0.05);
    civD.alive = false; civD.falling = true; civD.fallT = 0.95;
    selfStone.alive = false; selfStone.falling = true; selfStone.fallT = 0.95;
    G.fx.falls = [civD, selfStone];
    guard = 0;
    while (G.state === 'sim' && guard++ < 6000) G.update(1 / 120);
    ok(G.state === 'pick' && G.pickDue === 1, '弹射棋子自灭也要照罚（不因自灭而免单）');
    const own2 = G.pieces.findIndex(p => p.alive && p.side === 'black' && p.kind === 'stone');
    G.pickPiece(own2);
    ok(P.count(G.pieces, 'black', 'stone') === 1, '自灭 + 罚则后黑方剩 1 子');

    // 一次撞飞多个跨过两个 3 的倍数 → 连续下场两颗
    G.start({ mode: 'pvp', board: 9, troops: 4, civ: 8, obs: 0, penalty: 'pick' });
    G.stats.black.civ = 5;
    G.state = 'aim';
    G.fire(G.pieces.indexOf(G.pieces.find(p => p.alive && p.side === 'black' && p.kind === 'stone')), 0, -1, 0.05);
    const civE = G.pieces.find(p => p.alive && p.kind === 'civilian');
    civE.alive = false; civE.falling = true; civE.fallT = 0.95;
    G.fx.falls = [civE];
    guard = 0;
    while (G.state === 'sim' && guard++ < 6000) G.update(1 / 120);
    ok(G.state === 'pick' && G.pickDue === 1, '5 → 6 个平民只补 1 次（跨过 6 的倍数时再算）');
    let pickIdx = -1;
    for (let i = 0; i < G.pieces.length; i++) if (G.pickable(i)) { pickIdx = i; break; }
    G.pickPiece(pickIdx);
    ok(G.state === 'aim', '补齐后恢复行动');

    // 「仅扣分」模式仍可切换
    G.start({ mode: 'pvp', board: 9, troops: 3, civ: 3, obs: 0, penalty: 'score' });
    const civC = G.pieces.find(p => p.kind === 'civilian');
    G.state = 'aim';
    G.fire(G.pieces.indexOf(G.pieces.find(p => p.side === 'black')), 0, -1, 0.05);
    civC.alive = false; civC.falling = true; civC.fallT = 0.95;
    G.fx.falls = [civC];
    guard = 0;
    while (G.state === 'sim' && guard++ < 6000) G.update(1 / 120);
    ok(G.state === 'aim' && P.count(G.pieces, 'black', 'stone') === 3, '「仅扣分」模式不损失棋子');

    G.start({ mode: 'pvp', board: 9, troops: 3, civ: 0, obs: 0 });
    const s2 = G.pieces.find(p => p.side === 'black');
    G.state = 'aim';
    G.fire(G.pieces.indexOf(s2), 0, -1, 0.05);
    s2.alive = false; s2.falling = true; s2.fallT = 0.9;
    G.fx.falls = [s2];
    guard = 0;
    while (G.state === 'sim' && guard++ < 6000) G.update(1 / 120);
    ok(G.stats.black.lost === 1 && G.stats.white.kills === 0, '己方棋子出界不会给对方加击杀分');
    ok(G.side === 'white', '回合正确移交给对方');

    /* ---------- 生化模式 ---------- */
    G.start({ mode: 'pvp', board: 9, troops: 3, civ: 6, obs: 0, penalty: 'pick', rules: 'bio' });
    {
      const civ = G.pieces.find(p => p.kind === 'civilian');
      const wStone = G.pieces.find(p => p.kind === 'stone' && p.side === 'white');
      // 把平民贴到白子上，制造一次接触
      civ.x = wStone.x + wStone.r + civ.r - 0.5;
      civ.y = wStone.y;
      wStone.vx = 40; wStone.vy = 0;
      const fx = { hits: [], falls: [], converts: [] };
      P.step(G.pieces, G.geom, P.FIXED_DT, fx);
      ok(fx.converts.length > 0, '子力接触平民会产生感染事件');
      G.fx = fx;
      G.applyConverts();
      ok(civ.side === 'white', '平民锁定到撞它的那颗子力所属方（白）');
      ok(G.civOf('white') === 1 && G.civOf('black') === 0, 'civOf 统计到感染方');
    }

    // 被感染的子力也会继续传播（子力自身就是传染源）
    G.start({ mode: 'pvp', board: 9, troops: 3, civ: 6, obs: 0, rules: 'bio' });
    {
      const civs = G.pieces.filter(p => p.kind === 'civilian');
      const src = civs[0], dst = civs[1];
      src.side = 'black';
      src.x = 500; src.y = 500; src.vx = 70; src.vy = 0; src.w = 0;
      dst.x = 500 + src.r + dst.r - 1; dst.y = 500; dst.vx = dst.vy = 0;
      const fx = { hits: [], falls: [], converts: [] };
      P.step(G.pieces, G.geom, P.FIXED_DT, fx);
      ok(fx.converts.length > 0, '被感染的子力移动时也会产生感染事件');
      G.fx = fx; G.applyConverts();
      ok(dst.side === 'black', '被感染子力撞到的平民同样变成黑方');
    }

    // 已感染＝锁定：敌方撞上去也改不回来
    G.start({ mode: 'pvp', board: 9, troops: 3, civ: 6, obs: 0, rules: 'bio' });
    {
      const civ = G.pieces.find(p => p.kind === 'civilian');
      const wStone = G.pieces.find(p => p.kind === 'stone' && p.side === 'white');
      civ.side = 'black';
      civ.x = wStone.x + wStone.r + civ.r - 0.5;
      civ.y = wStone.y;
      wStone.vx = 40; wStone.vy = 0;
      const fx = { hits: [], falls: [], converts: [] };
      P.step(G.pieces, G.geom, P.FIXED_DT, fx);
      G.fx = fx; G.applyConverts();
      ok(civ.side === 'black', '已被感染的子力不会被对方改写（锁定）');
    }

    // 撞飞 3 个平民：生化模式无任何惩罚
    G.start({ mode: 'pvp', board: 9, troops: 3, civ: 8, obs: 0, penalty: 'pick', rules: 'bio' });
    for (let k = 1; k <= 3; k++) {
      const civ = G.pieces.find(p => p.alive && p.kind === 'civilian');
      G.side = 'black'; G.state = 'aim';
      G.fire(G.pieces.indexOf(G.pieces.find(p => p.alive && p.side === 'black' && p.kind === 'stone')), 0, -1, 0.05);
      civ.alive = false; civ.falling = true; civ.fallT = 0.95;
      G.fx.falls = [civ];
      guard = 0;
      while (G.state === 'sim' && guard++ < 6000) G.update(1 / 120);
    }
    ok(G.stats.black.civ === 3 && P.count(G.pieces, 'black', 'stone') === 3,
      '生化模式撞飞 3 个平民不损失任何棋子');

    // 常规模式不会同化
    G.start({ mode: 'pvp', board: 9, troops: 3, civ: 6, obs: 0, rules: 'classic' });
    {
      const civ = G.pieces.find(p => p.kind === 'civilian');
      const wStone = G.pieces.find(p => p.kind === 'stone' && p.side === 'white');
      civ.x = wStone.x + wStone.r + civ.r - 0.5;
      civ.y = wStone.y;
      wStone.vx = 40; wStone.vy = 0;
      const fx = { hits: [], falls: [] };
      P.step(G.pieces, G.geom, P.FIXED_DT, fx);
      ok(civ.side === null, '常规模式平民保持中立');
    }

    // 万民皆兵：被同化的平民就是棋子，可选、可弹、计入棋子数
    G.start({ mode: 'pvp', board: 9, troops: 3, civ: 6, obs: 0, rules: 'bio' });
    {
      const civ = G.pieces.find(p => p.kind === 'civilian');
      civ.side = 'black';
      ok(G.selectable(G.pieces.indexOf(civ)), '被同化的平民可以被选中');
      ok(G.leftOf('black') === 4, '同化后该方棋子数 +1（3 → 4）');
      G.side = 'black'; G.state = 'aim';
      ok(G.fire(G.pieces.indexOf(civ), 0, -1, 0.3) === true, '被同化的平民可以弹射');
      let n2 = 0;
      while (G.state === 'sim' && n2++ < 6000) G.update(1 / 120);
      ok(G.state !== 'sim', '弹射被同化的平民能正常结算');
    }

    // 阵营判定：击落对方被同化的平民 = 击杀；自己的 = 自灭
    G.start({ mode: 'pvp', board: 9, troops: 3, civ: 6, obs: 0, rules: 'bio' });
    {
      const civW = G.pieces.find(p => p.kind === 'civilian');
      civW.side = 'white';
      G.side = 'black'; G.state = 'aim';
      G.fire(G.pieces.indexOf(G.pieces.find(p => p.side === 'black' && p.kind === 'stone')), 0, -1, 0.05);
      civW.alive = false; civW.falling = true; civW.fallT = 0.95;
      G.fx.falls = [civW];
      guard = 0;
      while (G.state === 'sim' && guard++ < 6000) G.update(1 / 120);
      ok(G.stats.black.kills === 1, '击落对方被同化的平民计为击杀');
    }
    G.start({ mode: 'pvp', board: 9, troops: 3, civ: 6, obs: 0, rules: 'bio' });
    {
      const civB = G.pieces.find(p => p.kind === 'civilian');
      civB.side = 'black';
      G.side = 'black'; G.state = 'aim';
      G.fire(G.pieces.indexOf(G.pieces.find(p => p.side === 'black' && p.kind === 'stone')), 0, -1, 0.05);
      civB.alive = false; civB.falling = true; civB.fallT = 0.95;
      G.fx.falls = [civB];
      guard = 0;
      while (G.state === 'sim' && guard++ < 6000) G.update(1 / 120);
      ok(G.stats.black.lost === 1, '自己同化的平民出界计为自灭');
    }
  }

  /* ---------- 5. 关卡 ---------- */
  console.log('\n[5] 关卡编辑与存取');
  {
    const lv = E.normLevel({
      name: '测试关卡', board: 13,
      obstacles: [{ x: 0.3, y: 0.3, r: 0.1 }, { x: 2, y: -1, r: 0.9 }, null]
    });
    ok(lv && lv.obstacles.length === 2, '非法数据被过滤');
    ok(lv.obstacles[1].x <= 1 && lv.obstacles[1].x >= lv.obstacles[1].r, '越界坐标被钳制到板内');
    ok(lv.obstacles[1].r <= 0.46, '半径被钳制在上限内');

    E.open({ name: '自测关卡', board: 9, obstacles: [{ x: 0.5, y: 0.5, r: 0.12 }] });
    const idx = E.addAt(200, 800);
    ok(idx === 1 && E.obstacles.length === 2, '点击可新增障碍');
    E.setRadius(idx, 0.2);
    ok(Math.abs(E.obstacles[idx].r - 0.2) < 1e-9, '可调整障碍大小');
    ok(E.hitTest(200, 800) === idx, '命中测试可选中障碍');
    E.moveTo(idx, 2000, -500);
    ok(E.obstacles[idx].x <= 1 && E.obstacles[idx].y >= 0, '拖动被限制在棋盘内');
    ok(E.hitTest(E.obstacles[idx].x * 1000, E.obstacles[idx].y * 1000) === idx, '拖动后仍可点中');
    E.remove(idx);
    ok(E.obstacles.length === 1, '可删除障碍');

    E.name = '自测关卡';
    const saved = E.save();
    ok(E.list().some(x => x.name === '自测关卡'), '关卡可保存到本地');
    const loaded = E.list().find(x => x.name === '自测关卡');
    ok(loaded && loaded.obstacles.length === 1 && Math.abs(loaded.obstacles[0].r - 0.12) < 1e-6, '读取后数据一致');
    E.removeSaved('自测关卡');
    ok(!E.list().some(x => x.name === '自测关卡'), '可删除存档');

    // 关卡用于对局
    G.start({ board: 13, troops: 3, civ: 5, obs: 0, level: saved });
    const obs = G.pieces.filter(p => p.kind === 'obstacle');
    ok(obs.length === 1, '关卡障碍被放进对局');
    ok(G.levelName === '自测关卡', '对局记录了关卡名');
    ok(Math.abs(obs[0].r - 0.12 * 1000) < 1e-6, '关卡障碍半径按比例还原');
  }

  /* ---------- 6. AI ---------- */
  console.log('\n[6] AI');
  {
    G.start({ mode: 'pvp', board: 9, troops: 3, civ: 8, obs: 2 });
    for (const d of ['easy', 'normal', 'hard']) {
      const t0 = Date.now();
      const res = await AI.think({
        pieces: G.pieces, geom: G.geom, my: 'black', opp: 'white', difficulty: d, seed: 42
      });
      const ms = Date.now() - t0;
      ok(!!res && res.power > 0 && res.power <= 1,
        `${d}: 返回合法弹射（候选 ${res ? res.cands : 0}，${ms}ms）`);
    }
  }

  /* ---------- 7. AI 自对局 ---------- */
  console.log('\n[7] AI 自对局');
  {
    for (const d of ['easy', 'normal', 'hard']) {
      let totalMoves = 0, finished = 0, t0 = Date.now();
      for (let k = 0; k < 3; k++) {
        G.start({ mode: 'pvp', board: 13, troops: 3, civ: 10, obs: 2, ai: d, penalty: 'pick' });
        let moves = 0;
        while (G.state !== 'over' && moves < 80) {
          if (!(await playMove(d, G.side))) break;
          moves++;
        }
        totalMoves += moves;
        if (G.state === 'over') finished++;
      }
      console.log(`    ${d}: 3 局共 ${totalMoves} 手 (平均 ${(totalMoves / 3).toFixed(1)})，`
        + `分出胜负 ${finished}/3，耗时 ${Date.now() - t0}ms`);
      ok(finished >= 1, `${d}: 至少有一局能自然分胜负`);
    }
  }

  console.log(fails === 0 ? '\n全部通过 \u2714' : `\n失败 ${fails} 项 \u2718`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
