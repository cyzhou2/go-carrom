/* ===== config.js · 全部可调参数（改这里即可，不暴露在前台界面） =====
 *
 * 世界坐标：棋盘网格边长固定为 1000 世界单位，速度单位为「世界单位/秒」。
 * 修改本文件后刷新页面即可生效。
 */
(function (global) {
  'use strict';
  const GG = global.GG = global.GG || {};

  const CONFIG = {
    /* 版本号：显示在左上角，方便确认浏览器有没有跑旧缓存 */
    build: 'v8',

    /* ---------------- 物理 ---------------- */
    physics: {
      fixedDt: 1 / 240,        // 固定步长
      maxSpeed: 2600,          // 满力初速
      decel: 780,              // 桌面滑动摩擦（恒定减速度）
      dragQuadratic: 0,        // 可选的二次阻力（与速度平方成正比，0 = 关闭）
      spinDecel: 7.0,          // 角速度衰减（rad/s²）
      spinMax: 52,             // 角速度上限（rad/s）
      stopSpeed: 6,            // 低于该速度直接停住
      stopSpin: 0.45,          // 低于该角速度直接停转
      restitution: { stone: 0.95, civilian: 0.92, obstacle: 0.86 },
      contactFriction: 0.24,   // 接触点库伦摩擦系数（决定碰撞时能"搓"出多少旋转）
      curlCoef: 0.00055,       // 旋转引起的侧向偏转（冰壶效应，0 = 关闭）
      mass: { stone: 1, civilian: 0.72, obstacle: Infinity },
      radiusRatio: { stone: 0.44, civilian: 0.40 },  // × 格距
      obsRadiusRatio: 0.95,    // 随机障碍盘半径 × 格距（关卡里的由关卡自己定）
      obsRadiusMin: 38,
      obsRadiusMax: 155,
      maxSimTime: 15,          // 单回合最长推演时间（秒）
      restSampleFrames: 26,    // 静止采样间隔
      positionCorrection: 0.92,
      subSteps: 2,             // 每步碰撞迭代次数
      maxSubSteps: 60          // 每帧最多追赶的物理步数
    },

    /* ---------------- 发射误差（符合真实世界的高斯散布） ----------------
     * 速度误差 RMS = speedSigmaRatio × 预计速度；角度误差 RMS = angleSigma（弧度）
     */
    error: {
      enabled: true,
      speedSigmaRatio: 0.200,  // 速度误差方均根 / 预计速度（原 0.035，翻倍试手感）
      angleSigma: 0.1700,      // 角度误差方均根（弧度，约 0.97°）（原 0.0085）
      minSpeedSigma: 5,        // 低速时保留的最小抖动（避免"完美赞"）
      launchSpinSigma: 4.5,    // 出杆残余角速度的方均根（rad/s）
      aiUsesError: true        // AI 试算是否使用同一误差模型
    },

    /* ---------------- 摆盘 ---------------- */
    layout: {
      margin: 0.05,            // 距棋盘边缘的最小留白（占棋盘比例）
      clusterY: [0.64, 0.86],  // 双方聚类中心的纵向范围（黑方，白方镜像）
      clusterX: [0.30, 0.70],  // 聚类中心横向范围
      clusterSigma: 0.80,      // 聚类散布（× 格距），越小越抱团
      clusterSigmaPerStone: 0.05,
      clusterJitter: 0.16,     // 聚类中心抖动（× 格距）
      clusterRing: 0.24,       // 棋子附着间距增量（× 格距），越小越紧
      minClusterGap: 4.2,      // 两个聚类中心最小间距（× 格距）
      maxFillRatio: 0.26,      // 棋子总面积占棋盘面积的上限（超出会整体缩小半径）
      civMarginBand: [0.24, 0.76], // 平民更倾向撒在中部
      civCenterBias: 0.65,     // 落在中部的概率
      placeTries: 480          // 每个棋子的最大尝试次数
    },

    /* ---------------- AI 评估权重 ---------------- */
    ai: {
      killEnemy: 150,
      loseSelf: 130,
      killCivilian: 105,       // 「仅扣分」惩罚时的平民代价
      civilianPenaltyPiece: 235, // 「没收棋子」惩罚时的平民代价
      civilianPenaltyPick: 70,   // 「每 3 个自选一子下场」时单个平民的代价
      civilianPickDangerMul: 3,  // 再杀 1 个就触发下场时的代价倍数
      civPenaltyEvery: 3,        // 每撞飞多少个平民触发一次惩罚
      edgeWeight: 16,
      edgeRange: 2.3,          // × 格距
      selfEdgeWeight: 14,
      selfEdgeRange: 1.9,
      replyWeight: 0.8,        // 凶狠难度对对手回应的折扣
      reEvalTop: 5,            // 复评候选数
      reEvalSamples: 3,        // 每个候选的复评采样次数
      simTimeQuick: 3.5,       // 初筛推演时长（秒）
      simTime: 6               // 复评推演时长（秒）
    },

    /* ---------------- 三档难度 ---------------- */
    difficulty: {
      easy: { name: '温和', powers: 2, rand: 42, soft: 0.55, angErr: 0.050, powErr: 0.130, reply: 0, replyN: 0, cap: 40 },
      normal: { name: '标准', powers: 3, rand: 12, soft: 0.10, angErr: 0.016, powErr: 0.045, reply: 0, replyN: 0, cap: 64 },
      hard: { name: '凶狠', powers: 4, rand: 4, soft: 0.00, angErr: 0.004, powErr: 0.012, reply: 9, replyN: 10, cap: 88 }
    },

    /* ---------------- 规则默认值 ---------------- */
    rules: {
      maxTroops: 5,            // 每方最多棋子数
      maxCivilians: 60,
      maxObstacles: 12,
      boards: [7, 9, 11, 13, 15, 17, 19]
    }
  };

  /* ---------------- 调试钩子（非前台界面） ----------------
   * 例如 ?err.speed=0.08&phys.decel=1200 临时覆盖，便于调参对比，刷新即失效。
   */
  CONFIG.applyQuery = function (search) {
    const q = String(search || '').replace(/^\?/, '');
    if (!q) return CONFIG;
    const set = (path, val) => {
      const parts = path.split('.');
      let node = CONFIG;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node[parts[i]] || typeof node[parts[i]] !== 'object') return;
        node = node[parts[i]];
      }
      const key = parts[parts.length - 1];
      if (!(key in node)) return;
      const prev = node[key];
      node[key] = typeof prev === 'boolean' ? val === '1' || val === 'true'
        : typeof prev === 'number' ? Number(val) : val;
    };
    q.split('&').forEach(pair => {
      const [k, v] = pair.split('=');
      if (k && v !== undefined) set(decodeURIComponent(k), decodeURIComponent(v));
    });
    return CONFIG;
  };

  GG.CONFIG = CONFIG;
})(window);
