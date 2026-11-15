/* ===== ui.js · 交互、HUD、关卡编辑器、渲染循环 ===== */
(function (global) {
  'use strict';

  const GG = global.GG;
  const U = GG.Util, R = GG.Render, G = GG.Game, A = GG.Audio, E = GG.Editor;
  const CFG = GG.CONFIG, RULES = CFG.rules;
  const $ = id => document.getElementById(id);

  const el = {
    canvas: $('boardCanvas'), wrap: $('boardWrap'),
    banner: $('banner'), hint: $('hint'), buildTag: $('buildTag'),
    p1Name: $('p1Name'), p2Name: $('p2Name'), p1Stat: $('p1Stat'), p2Stat: $('p2Stat'),
    p1Civ: $('p1Civ'), p2Civ: $('p2Civ'),
    cardP1: $('cardP1'), cardP2: $('cardP2'),
    factMode: $('factMode'), factBoard: $('factBoard'), factTroops: $('factTroops'),
    factAI: $('factAI'), factLevel: $('factLevel'),
    statCiv: $('statCiv'), statObs: $('statObs'), statTurn: $('statTurn'),
    log: $('log'),
    overlay: $('overlay'), modalTitle: $('modalTitle'), modalSub: $('modalSub'),
    setupPanel: $('setupPanel'), resultPanel: $('resultPanel'), lockInfo: $('lockInfo'),
    fieldPenalty: $('fieldPenalty'), bioNote: $('bioNote'),
    resultTrophy: $('resultIcon'), resultTitle: $('resultTitle'), resultText: $('resultText'),
    resultStats: $('resultStats'),
    btnStart: $('btnStart'), btnHelp: $('btnHelp'), btnRestart: $('btnRestart'),
    btnRules: $('btnRules'), btnSound: $('btnSound'), btnRulesClose: $('btnRulesClose'),
    btnLevel: $('btnLevel'), btnEditLevel: $('btnEditLevel'), btnSetup: $('btnSetup'),
    rulesOverlay: $('rulesOverlay'),
    fieldAI: $('fieldAI'), segMode: $('segMode'), skinPicker: $('skinPicker'), sizePicker: $('sizePicker'),
    selBoard: $('selBoard'), numTroops: $('numTroops'), numCiv: $('numCiv'), numObs: $('numObs'),
    selLevel: $('selLevel'),
    editorBar: $('editorBar'), edBoard: $('edBoard'), edRadius: $('edRadius'),
    edRadiusNum: $('edRadiusNum'), edRadiusMinus: $('edRadiusMinus'), edRadiusPlus: $('edRadiusPlus'),
    edName: $('edName'), edSaved: $('edSaved'),
    edSave: $('edSave'), edLoad: $('edLoad'), edDelete: $('edDelete'),
    edExport: $('edExport'), edImport: $('edImport'), edClear: $('edClear'),
    edCancel: $('edCancel'), edPlay: $('edPlay'), edFile: $('edFile')
  };

  const setup = {
    mode: 'ai', board: 9, troops: 3, civ: 8, obs: 2,
    ai: 'normal', penalty: 'pick', aim: 'direct', level: null,
    rules: 'classic'
  };
  let modalMode = 'setup';
  let aim = null;
  let last = 0;
  let bannerTimer = 0;
  let drag = null;

  const diffName = k => (CFG.difficulty[k] && CFG.difficulty[k].name) || k;

  /* ---------- 界面字号 ---------- */
  const SIZES = { s: 0.9, m: 1, l: 1.12, xl: 1.26 };

  function setFontSize(name, persist) {
    const key = SIZES[name] ? name : 'm';
    document.documentElement.dataset.size = key;
    R.setUiScale(SIZES[key]);
    document.querySelectorAll('button[data-size]').forEach(b => {
      b.classList.toggle('on', b.dataset.size === key);
    });
    if (persist !== false) savePrefs();
  }

  /* ---------- 本地存档 ---------- */
  function savePrefs() {
    try {
      localStorage.setItem('gocarrom.prefs', JSON.stringify({
        setup,
        skin: document.documentElement.dataset.skin,
        size: document.documentElement.dataset.size
      }));
    } catch (e) { /* ignore */ }
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem('gocarrom.prefs');
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p.setup) {
        Object.assign(setup, p.setup);
        if (setup.penalty === 'shooter') setup.penalty = 'pick';   // 旧存档迁移
        if (setup.level) {
          const lv = E.normLevel(setup.level);
          setup.level = lv && lv.obstacles.length ? lv : null;
        }
      }
      if (p.skin) setSkin(p.skin, false);
      if (p.size) setFontSize(p.size, false);
    } catch (e) { /* ignore */ }
  }

  /* ---------- 皮肤 ---------- */
  function setSkin(name, persist) {
    document.documentElement.dataset.skin = name;
    document.body.dataset.skin = name;
    R.setSkin(name);
    document.querySelectorAll('button[data-skin]').forEach(b => {
      const on = b.dataset.skin === name;
      b.classList.toggle('active', on);
      b.classList.toggle('on', on);
    });
    if (persist !== false) savePrefs();
  }

  /* ---------- 遮罩 / 面板 ---------- */
  function showOverlay() { el.overlay.classList.remove('hidden'); }
  function hideOverlay() { el.overlay.classList.add('hidden'); }

  function showSetup() {
    modalMode = 'setup';
    el.setupPanel.classList.remove('hidden');
    el.resultPanel.classList.add('hidden');
    el.modalTitle.textContent = LOCK ? (LOCK.title || '围棋弹棋') : '围棋弹棋';
    el.modalSub.textContent = LOCK
      ? (LOCK.subtitle || '默认设置版 · 打开即玩')
      : '棋盘上的弹射对决 · 把对方棋子全部打下棋盘';
    el.btnStart.textContent = LOCK ? '开始游戏' : '开始对局';
    el.btnHelp.classList.remove('hidden');
    el.btnHelp.textContent = '怎么玩？';
    if (LOCK) updateLockInfo();
    syncLevelSelect();
    showOverlay();
  }

  function showResult(res) {
    modalMode = 'result';
    el.setupPanel.classList.add('hidden');
    el.resultPanel.classList.remove('hidden');
    const humanWin = res.winner === 'black';
    el.resultTrophy.textContent = humanWin ? '🏆' : '💀';
    if (res.mode === 'pvp') {
      el.resultTitle.textContent = (res.winner === 'black' ? '黑方' : '白方') + '胜利';
      el.modalSub.textContent = '双人对局结束 · 共 ' + res.moves + ' 手';
      el.resultText.textContent = res.winner === 'black'
        ? '黑方把白方所有棋子都送出了棋盘。'
        : '白方把黑方所有棋子都送出了棋盘。';
    } else {
      el.resultTitle.textContent = humanWin ? '你赢了！' : 'AI 赢了';
      el.modalSub.textContent = humanWin ? '白方棋子被全部清空' : '黑方棋子被全部清空';
      el.resultText.textContent = humanWin
        ? '你把 AI 的棋子全部弹出了棋盘 —— 干得漂亮。'
        : '你的棋子被清空了。再试一次，多用障碍反弹或借自旋改变角度。';
    }
    el.modalTitle.textContent = '对局结算';
    el.btnStart.textContent = '再来一局';
    el.btnHelp.textContent = '修改设置';
    const s = res.stats;
    el.resultStats.innerHTML =
      `<div><b>${res.moves}</b>总手数</div>` +
      `<div><b>${s.black.kills}</b>黑方击落</div>` +
      `<div><b>${s.white.kills}</b>白方击落</div>` +
      `<div><b>${s.black.civ + s.white.civ}</b>平民伤亡</div>` +
      `<div><b>${res.left.black}</b>黑方残余</div>` +
      `<div><b>${res.left.white}</b>白方残余</div>` +
      (res.level ? `<div><b>${res.level}</b>关卡</div>` : '');
    showOverlay();
  }

  /* ---------- 设置控件 ---------- */
  function segBind(container, attr, cb) {
    if (!container) return;
    container.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b || !container.contains(b)) return;
      [...container.querySelectorAll('button')].forEach(x => x.classList.toggle('on', x === b));
      cb(b.getAttribute(attr));
      savePrefs();
    });
  }

  function intInput(input, key, min, max) {
    const commit = () => {
      let v = parseInt(input.value, 10);
      if (!isFinite(v)) v = min;
      v = U.clamp(v, min, max);
      input.value = v;
      setup[key] = v;
      savePrefs();
    };
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
  }

  function fillBoardSelect(sel, keep) {
    sel.innerHTML = '';
    for (const n of RULES.boards) {
      const o = document.createElement('option');
      o.value = String(n);
      o.textContent = `${n} × ${n}`;
      sel.appendChild(o);
    }
    sel.value = String(keep || RULES.boards[1]);
  }

  function bindSetup() {
    segBind(el.segMode, 'data-mode', v => {
      setup.mode = v;
      el.fieldAI.style.display = v === 'ai' ? '' : 'none';
      syncNames();
    });
    segBind($('segAI'), 'data-ai', v => { setup.ai = v; });
    segBind($('segPenalty'), 'data-pen', v => { setup.penalty = v; });
    segBind($('segRules'), 'data-rules', v => { setup.rules = v; syncRulesUI(); savePrefs(); });
    segBind($('segAim'), 'data-aim', v => { setup.aim = v; });
    segBind($('segSkin'), 'data-skin', v => setSkin(v, true));

    fillBoardSelect(el.selBoard, setup.board);
    el.selBoard.addEventListener('change', () => {
      setup.board = parseInt(el.selBoard.value, 10) || 9;
      savePrefs();
    });

    intInput(el.numTroops, 'troops', 1, RULES.maxTroops);
    intInput(el.numCiv, 'civ', 0, RULES.maxCivilians);
    intInput(el.numObs, 'obs', 0, RULES.maxObstacles);

    el.numTroops.value = setup.troops;
    el.numCiv.value = setup.civ;
    el.numObs.value = setup.obs;
    el.selBoard.value = String(setup.board);

    [...$('segMode').children].forEach(b => b.classList.toggle('on', b.dataset.mode === setup.mode));
    [...$('segAI').children].forEach(b => b.classList.toggle('on', b.dataset.ai === setup.ai));
    [...$('segPenalty').children].forEach(b => b.classList.toggle('on', b.dataset.pen === setup.penalty));
    [...$('segAim').children].forEach(b => b.classList.toggle('on', b.dataset.aim === setup.aim));
    el.fieldAI.style.display = setup.mode === 'ai' ? '' : 'none';

    el.selLevel.addEventListener('change', () => {
      const name = el.selLevel.value;
      if (!name) { setup.level = null; savePrefs(); syncSetupUI(); return; }
      const lv = E.list().find(x => x.name === name) || null;
      setup.level = lv;
      if (lv) { setup.board = lv.board; el.selBoard.value = String(lv.board); }
      savePrefs();
      syncSetupUI();
    });

    el.btnEditLevel.addEventListener('click', () => openEditor(setup.level));
    el.btnLevel.addEventListener('click', () => openEditor(setup.level));
  }

  function syncLevelSelect() {
    const cur = setup.level ? setup.level.name : '';
    el.selLevel.innerHTML = '<option value="">随机生成（不使用关卡）</option>';
    for (const lv of E.list()) {
      const o = document.createElement('option');
      o.value = lv.name;
      o.textContent = `${lv.name} · ${lv.board}路 · ${lv.obstacles.length} 盘`;
      el.selLevel.appendChild(o);
    }
    el.selLevel.value = [...el.selLevel.options].some(o => o.value === cur) ? cur : '';
    if (cur && el.selLevel.value !== cur) setup.level = null;
  }

  function syncSetupUI() {
    const hasLevel = !!setup.level;
    el.numObs.disabled = hasLevel;
    el.numObs.title = hasLevel ? '已使用关卡内的障碍' : '';
    syncLevelSelect();
    syncRulesUI();
  }

  /** 规则切换：生化模式下隐藏平民惩罚选项 */
  function syncRulesUI() {
    const bio = setup.rules === 'bio';
    document.querySelectorAll('#segRules button').forEach(b => {
      b.classList.toggle('on', b.dataset.rules === setup.rules);
    });
    if (el.fieldPenalty) el.fieldPenalty.classList.toggle('hidden', bio);
    if (el.bioNote) el.bioNote.classList.toggle('hidden', !bio);
    document.querySelectorAll('.civ-line').forEach(n => n.classList.toggle('bio', bio));
  }

  function syncNames() {
    const air = setup.mode === 'ai';
    el.p1Name.textContent = air ? '你 · 黑' : '黑方';
    el.p2Name.textContent = air ? 'AI · 白' : '白方';
    el.factMode.textContent = air ? '单人 vs AI' : '双人同屏';
    el.factAI.textContent = air ? diffName(setup.ai) : '—';
  }

  /* ---------- 默认设置版（锁定参数，去掉设置负担） ---------- */
  let LOCK = null;

  function isPortrait() {
    return window.innerHeight > window.innerWidth || window.matchMedia('(max-width: 760px)').matches;
  }

  function lockPreset() {
    if (!LOCK) return null;
    return isPortrait() ? LOCK.mobile : LOCK.desktop;
  }

  function updateLockInfo() {
    if (!LOCK || !el.lockInfo) return;
    const p = lockPreset();
    const name = (isPortrait() ? LOCK.label.mobile : LOCK.label.desktop) || '默认设置';
    const parts = [
      `棋盘 ${p.board}×${p.board}`,
      `每方 ${p.troops} 子`,
      `平民 ${p.civ}`,
      `障碍圆盘 ${p.obs}`,
      `AI ${diffName(p.ai)}`,
      '每 3 个平民罚 1 子',
      '拉弓式瞄准'
    ];
    el.lockInfo.innerHTML = `<b>${name}</b><span>${parts.join(' · ')}</span>`;
    el.lockInfo.classList.remove('hidden');
  }

  function applyLock(lock) {
    LOCK = lock || null;
    if (!LOCK) return;
    document.body.classList.add('simple');
    ['btnLevel', 'btnEditLevel', 'btnSetup'].forEach(k => {
      if (el[k]) el[k].style.display = 'none';
    });
    if (el.setupPanel) el.setupPanel.classList.add('locked');
    updateLockInfo();
  }

  function applyLockToSetup() {
    const p = lockPreset();
    if (!p) return;
    Object.assign(setup, p, { level: null });
    // 同步（默认版里被隐藏的）表单控件状态，避免出现"显示与实际不一致"
    document.querySelectorAll('#segAim button').forEach(b => b.classList.toggle('on', b.dataset.aim === setup.aim));
    document.querySelectorAll('#segPenalty button').forEach(b => b.classList.toggle('on', b.dataset.pen === setup.penalty));
    document.querySelectorAll('#segMode button').forEach(b => b.classList.toggle('on', b.dataset.mode === setup.mode));
    document.querySelectorAll('#segAI button').forEach(b => b.classList.toggle('on', b.dataset.ai === setup.ai));
    document.querySelectorAll('#segSkin button').forEach(b => b.classList.toggle('on', b.dataset.skin === document.documentElement.dataset.skin));
    if (el.selBoard) el.selBoard.value = String(setup.board);
    if (el.numTroops) el.numTroops.value = setup.troops;
    if (el.numCiv) el.numCiv.value = setup.civ;
    if (el.numObs) el.numObs.value = setup.obs;
  }

  /* ---------- HUD ---------- */
  /** 生化模式：这一栏显示「感染：N」（被同化的平民数） */
  function updateCivCount(node, n) {
    if (!node) return;
    const label = node.querySelector('em b');
    if (label) label.textContent = String(n);
    const lb = node.querySelector('.civ-label');
    if (lb) lb.textContent = '感染：';
    node.classList.add('bio');
  }

  function updateCivDots(node, civ, pendingPick) {
    if (!node) return;
    const lb = node.querySelector('.civ-label');
    if (lb) lb.textContent = '平民';
    node.classList.remove('bio');
    const every = GG.CONFIG.ai.civPenaltyEvery || 3;
    const n = pendingPick ? every : (civ % every);
    const dots = node.querySelectorAll('i');
    for (let i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('on', i < n);
      // 只有"再撞一个就要付棋子"时，下一个空格才闪红警告
      dots[i].classList.toggle('danger', i === n && n === every - 1);
      dots[i].classList.toggle('owed', pendingPick && i < n);
    }
    const label = node.querySelector('em b');
    if (label) label.textContent = String(n);
  }

  function updateHUD() {
    if (!G.cfg) return;
    const P = GG.Physics;
    const total = G.cfg.troops;
    // 生化模式下分母跟着"获得"增长：3/3 → 每感染 1 个变 4/4
    const bioOn = G.cfg.rules === 'bio';
    const bTotal = total + (bioOn ? (G.stats.black.gained || 0) : 0);
    const wTotal = total + (bioOn ? (G.stats.white.gained || 0) : 0);
    const bLeft = G.leftOf('black');
    const wLeft = G.leftOf('white');
    el.p1Stat.textContent = `${bLeft} / ${bTotal}`;
    el.p2Stat.textContent = `${wLeft} / ${wTotal}`;
    if (bioOn) {
      updateCivCount(el.p1Civ, P.count(G.pieces, 'black', 'civilian'));
      updateCivCount(el.p2Civ, P.count(G.pieces, 'white', 'civilian'));
    } else {
      updateCivDots(el.p1Civ, G.stats.black.civ, G.state === 'pick' && G.pickSide === 'black');
      updateCivDots(el.p2Civ, G.stats.white.civ, G.state === 'pick' && G.pickSide === 'white');
    }
    el.cardP1.classList.toggle('active', G.state !== 'over' && G.side === 'black');
    el.cardP2.classList.toggle('active', G.state !== 'over' && G.side === 'white');
    el.cardP1.classList.toggle('dead', bLeft === 0);
    el.cardP2.classList.toggle('dead', wLeft === 0);

    el.factBoard.textContent = `${G.cfg.board} × ${G.cfg.board}`;
    el.factTroops.textContent = String(total);
    el.factLevel.textContent = G.levelName || '随机';
    el.statCiv.textContent = String(P.count(G.pieces, null, 'civilian'));
    el.statObs.textContent = String(P.count(G.pieces, null, 'obstacle'));
    el.statTurn.textContent = String(Math.floor(G.moveNo / 2) + 1);

    const human = G.humanCanAct();
    const picking = G.state === 'pick' && G.isHumanSide(G.pickSide);
    el.canvas.style.cursor = human ? 'crosshair' : (picking ? 'pointer' : 'default');

    let hintHTML;
    if (picking) hintHTML = '<b>点选一颗己方棋子下场</b>（平民伤亡达 3）';
    else if (human) hintHTML = '拖拽自己的棋子 <b>蓄力</b> · 松手弹射';
    else if (G.state === 'ai') hintHTML = '<b>AI 思考中…</b>';
    else if (G.state === 'pick') hintHTML = 'AI 正在选择下场棋子…';
    else if (G.state === 'sim') hintHTML = '撞击结算中…';
    else if (G.state === 'over') hintHTML = '对局结束';
    else hintHTML = (G.side === 'black' ? '黑方' : '白方') + '行动 · 拖拽蓄力弹射';
    if (el.hint._v !== hintHTML) { el.hint._v = hintHTML; el.hint.innerHTML = hintHTML; }
    el.hint.style.opacity = '1';
  }

  function pushLog(entry) {
    const li = document.createElement('li');
    li.className = entry.type === 'turn' ? 'turn' : (entry.type || '');
    li.textContent = entry.text;
    el.log.appendChild(li);
    while (el.log.children.length > 40) el.log.removeChild(el.log.firstChild);
    el.log.scrollTop = el.log.scrollHeight;
  }

  function showBanner(text) {
    el.banner.textContent = text;
    el.banner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.banner.classList.remove('show'), 1600);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- 关卡编辑器 ---------- */
  const MIN_PCT = 1.2, MAX_PCT = 46;

  /** 只同步控件显示，不改变圆盘大小 */
  function syncSizeUI(pct) {
    const p = U.clamp(pct, MIN_PCT, MAX_PCT);
    el.edRadius.value = String(Math.round(p * 10));
    el.edRadiusNum.value = (Math.round(p * 10) / 10).toFixed(1);
  }

  /** 设置笔刷半径；有选中圆盘时同时缩放它 */
  function applyPercent(pct, resizeSelected) {
    const p = U.clamp(pct, MIN_PCT, MAX_PCT);
    E.brushR = p / 100;
    syncSizeUI(p);
    if (resizeSelected !== false && E.selected >= 0) E.setRadius(E.selected, p / 100);
    return p;
  }

  function currentPercent() {
    return E.selected >= 0 && E.obstacles[E.selected]
      ? E.obstacles[E.selected].r * 100
      : E.brushR * 100;
  }

  function openEditor(level) {
    if (!G.cfg) return;
    aim = null;
    G.uiAim = null;
    hideOverlay();
    E.open(level || null, setup.board);
    el.editorBar.classList.remove('hidden');
    el.hint.style.display = 'none';
    fillBoardSelect(el.edBoard, E.board);
    el.edName.value = E.name || '';
    syncSizeUI(E.brushR * 100);
    refreshSavedList();
    if (E.name) el.edSaved.value = E.name;
    showBanner('关卡编辑：单击空白放置障碍');
  }

  function closeEditor(backToSetup) {
    E.close();
    el.editorBar.classList.add('hidden');
    el.hint.style.display = '';
    drag = null;
    if (backToSetup) showSetup();
  }

  function refreshSavedList() {
    const list = E.list();
    el.edSaved.innerHTML = list.length
      ? list.map(l => `<option value="${escapeHtml(l.name)}">${escapeHtml(l.name)} · ${l.board}路 · ${l.obstacles.length}盘</option>`).join('')
      : '<option value="">（暂无存档）</option>';
  }

  function bindEditor() {
    el.edBoard.addEventListener('change', () => {
      E.setBoard(parseInt(el.edBoard.value, 10) || 13);
    });
    // 半径：滑杆（千分比）、数字框（百分比）、± 按钮，三种都能改，且会作用到选中的圆盘
    el.edRadius.addEventListener('input', () => {
      applyPercent(parseFloat(el.edRadius.value) / 10);
    });
    el.edRadiusNum.addEventListener('change', () => {
      const v = parseFloat(el.edRadiusNum.value);
      applyPercent(isFinite(v) ? v : currentPercent());
    });
    el.edRadiusNum.addEventListener('blur', () => syncSizeUI(currentPercent()));
    el.edRadiusMinus.addEventListener('click', () => applyPercent(currentPercent() - 2));
    el.edRadiusPlus.addEventListener('click', () => applyPercent(currentPercent() + 2));
    el.edName.addEventListener('input', () => {
      E.name = el.edName.value.slice(0, 16);
      E.dirty = true;
    });
    el.edSave.addEventListener('click', () => {
      if (!E.name) {
        E.name = '关卡 ' + (E.list().length + 1);
        el.edName.value = E.name;
      }
      E.save();
      refreshSavedList();
      el.edSaved.value = E.name;
      syncLevelSelect();
      showBanner('已保存：' + E.name);
    });
    el.edLoad.addEventListener('click', () => {
      const name = el.edSaved.value;
      const lv = E.list().find(x => x.name === name);
      if (!lv) return;
      E.load(lv);
      el.edBoard.value = String(E.board);
      el.edName.value = E.name;
      showBanner('已读取：' + lv.name);
    });
    el.edDelete.addEventListener('click', () => {
      const name = el.edSaved.value;
      if (!name) return;
      E.removeSaved(name);
      refreshSavedList();
      syncLevelSelect();
      showBanner('已删除：' + name);
    });
    el.edExport.addEventListener('click', () => {
      E.exportJSON();
      showBanner('已导出 JSON');
    });
    el.edImport.addEventListener('click', () => el.edFile.click());
    el.edFile.addEventListener('change', () => {
      const f = el.edFile.files && el.edFile.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const lv = E.importText(String(reader.result));
        if (!lv) { showBanner('导入失败：文件格式不对'); return; }
        el.edBoard.value = String(E.board);
        el.edName.value = E.name;
        showBanner('已导入：' + lv.name);
      };
      reader.readAsText(f);
      el.edFile.value = '';
    });
    el.edClear.addEventListener('click', () => {
      E.clear();
      showBanner('已清空');
    });
    el.edCancel.addEventListener('click', () => closeEditor(true));
    el.edPlay.addEventListener('click', () => {
      const lv = E.toLevel();
      setup.level = lv;
      setup.board = lv.board;
      el.selBoard.value = String(lv.board);
      if (E.name) { E.save(); refreshSavedList(); }
      savePrefs();
      closeEditor(false);
      hideOverlay();
      el.log.innerHTML = '';
      G.start(setup);
      syncNames();
      syncSetupUI();
      showBanner('关卡「' + (lv.name || '自定义') + '」开局');
    });
  }

  /* ---------- 指针交互 ---------- */
  function localPos(e) {
    const rect = el.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function worldFromEvent(e) {
    const lp = localPos(e);
    return R.s2w(lp.x, lp.y);
  }

  function findPieceAt(wx, wy, touch) {
    const mul = touch ? 2.15 : 1.4;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < G.pieces.length; i++) {
      if (!G.selectable(i)) continue;
      const p = G.pieces[i];
      const d = U.dist(wx, wy, p.x, p.y);
      if (d < p.r * mul && d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /** 平民惩罚阶段：挑一颗己方棋子下场 */
  function findPickAt(wx, wy, touch) {
    const mul = touch ? 2.4 : 1.6;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < G.pieces.length; i++) {
      if (!G.pickable(i)) continue;
      const p = G.pieces[i];
      const d = U.dist(wx, wy, p.x, p.y);
      if (d < p.r * mul && d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function computeAim(wx, wy) {
    if (!aim || !G.geom) return null;
    const p = G.pieces[aim.idx];
    if (!p) return null;
    let dx = wx - p.x, dy = wy - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return null;
    if (setup.aim === 'pull') { dx = -dx; dy = -dy; }
    const maxDrag = G.geom.cell * 3.0;
    const power = U.clamp(len / maxDrag, 0, 1);
    return {
      idx: aim.idx,
      dx: dx / len, dy: dy / len,
      power,
      active: len > G.geom.r * 0.4,
      anchor: setup.aim === 'pull' ? { x: wx, y: wy } : null
    };
  }

  el.canvas.addEventListener('pointerdown', e => {
    A.ensure();
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';

    if (E.active) {
      const w = worldFromEvent(e);
      if (!w) return;
      const hit = E.hitTest(w.x, w.y, touch ? 14 : 6);
      if (hit >= 0) {
        E.selected = hit;
        const o = E.obstacles[hit];
        const d = U.dist(w.x, w.y, o.x * 1000, o.y * 1000);
        // 靠近圆盘外缘 → 拖拽缩放；内部 → 拖拽移动
        if (d > o.r * 1000 * 0.82) {
          drag = { mode: 'resize', idx: hit, id: e.pointerId, cx: o.x * 1000, cy: o.y * 1000 };
        } else {
          drag = { mode: 'move', idx: hit, offX: o.x * 1000 - w.x, offY: o.y * 1000 - w.y, id: e.pointerId };
        }
        syncSizeUI(o.r * 100);
      } else {
        const idx = E.addAt(w.x, w.y);
        drag = { mode: 'move', idx, offX: 0, offY: 0, id: e.pointerId };
        syncSizeUI(E.obstacles[idx].r * 100);
      }
      E.hover = { x: w.x, y: w.y };
      try { el.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      e.preventDefault();
      return;
    }

    // 平民惩罚：点选一颗己方棋子下场
    if (G.state === 'pick') {
      if (!G.isHumanSide(G.pickSide)) return;
      const w = worldFromEvent(e);
      const pickIdx = findPickAt(w.x, w.y);
      if (pickIdx >= 0) { G.pickPiece(pickIdx); updateHUD(); }
      return;
    }

    if (!G.humanCanAct() || !G.geom) return;
    const w = worldFromEvent(e);
    const idx = findPieceAt(w.x, w.y);
    if (idx < 0) return;
    aim = { idx, id: e.pointerId };
    G.uiAim = null;
    try { el.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    e.preventDefault();
  });

  el.canvas.addEventListener('pointermove', e => {
    if (E.active) {
      const w = worldFromEvent(e);
      E.hover = w;
      const hit = E.hitTest(w.x, w.y);
      if (hit >= 0) {
        const o = E.obstacles[hit];
        const d = U.dist(w.x, w.y, o.x * 1000, o.y * 1000);
        el.canvas.style.cursor = d > o.r * 1000 * 0.82 ? 'nwse-resize' : 'move';
      } else {
        el.canvas.style.cursor = 'copy';
      }
      if (drag && drag.id === e.pointerId) {
        if (drag.mode === 'resize') {
          applyPercent(U.dist(w.x, w.y, drag.cx, drag.cy) / 10);
        } else {
          E.moveTo(drag.idx, w.x + drag.offX, w.y + drag.offY);
        }
      }
      return;
    }
    if (!aim || e.pointerId !== aim.id) return;
    const w = worldFromEvent(e);
    G.uiAim = computeAim(w.x, w.y);
    e.preventDefault();
  });

  function endAim(cancelled) {
    if (!aim) return;
    const a = G.uiAim;
    const idx = aim.idx;
    aim = null;
    G.uiAim = null;
    if (!cancelled && a && a.active && a.power > 0.05 && G.humanCanAct()) {
      G.fire(idx, a.dx, a.dy, a.power);
      updateHUD();
    }
  }

  el.canvas.addEventListener('pointerup', e => {
    if (E.active) { drag = null; return; }
    if (!aim || e.pointerId !== aim.id) return;
    endAim(false);
  });
  el.canvas.addEventListener('pointercancel', () => {
    if (E.active) { drag = null; return; }
    endAim(true);
  });
  el.canvas.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (!E.active) return;
    const w = worldFromEvent(e);
    if (!w) return;
    const hit = E.hitTest(w.x, w.y);
    if (hit >= 0) { E.remove(hit); drag = null; syncSizeUI(E.brushR * 100); }
  });

  // 滚轮直接缩放：悬停在圆盘上就改它，否则改笔刷大小
  el.canvas.addEventListener('wheel', e => {
    if (!E.active) return;
    e.preventDefault();
    const w = worldFromEvent(e);
    if (!w) return;
    const hit = E.hitTest(w.x, w.y);
    if (hit >= 0) { E.selected = hit; E.hover = w; }
    const base = hit >= 0 ? E.obstacles[hit].r * 100 : E.brushR * 100;
    applyPercent(base + (e.deltaY > 0 ? -2 : 2));
  }, { passive: false });

  /* ---------- 主循环 ---------- */
  let hudSig = '';

  function hudSignature() {
    let s = G.state + '|' + G.side + '|' + G.moveNo + '|' + (G.cfg ? G.cfg.board + '/' + G.cfg.troops : '');
    for (let i = 0; i < G.pieces.length; i++) s += G.pieces[i].alive ? '1' : '0';
    return s;
  }

  function loop(t) {
    const dt = last ? Math.min(0.1, (t - last) / 1000) : 0.016;
    last = t;

    if (E.active) {
      R.draw({
        pieces: E.pieces,
        geom: E.geom,
        aim: null,
        ringSide: null,
        insetTop: el.editorBar.offsetHeight + 18,
        editor: { hover: E.hover, selected: E.selected, brushR: E.brushR, obstacles: E.obstacles }
      });
      requestAnimationFrame(loop);
      return;
    }

    if (G.cfg) {
      G.update(dt);
      R.draw(G.getRenderState());
      const sig = hudSignature();
      if (sig !== hudSig) { hudSig = sig; updateHUD(); }
    }
    requestAnimationFrame(loop);
  }

  /* ---------- 启动 ---------- */
  function restart() {
    if (!G.cfg || E.active) return;
    el.log.innerHTML = '';
    applyLockToSetup();
    G.start(setup);
    syncNames();
    hideOverlay();
    showBanner('新的一局');
  }

  function boot() {
    CFG.applyQuery(location.search);
    R.init(el.canvas);
    if (el.buildTag) el.buildTag.textContent = CFG.build || 'v5';
    loadPrefs();
    setSkin(document.documentElement.dataset.skin || 'wood', false);
    setFontSize(document.documentElement.dataset.size || 'm', false);
    bindSetup();
    bindEditor();
    syncNames();
    syncSetupUI();

    // 默认设置版：锁定配置（按横竖屏给不同预设）
    if (window.GC_LOCK) {
      applyLock(window.GC_LOCK);
      applyLockToSetup();
    }

    G.onLog = pushLog;
    G.onBanner = showBanner;
    G.onSound = (n, d) => A.play(n, d);
    G.onEnd = res => setTimeout(() => showResult(res), 700);
    G.onTick = updateHUD;

    el.btnStart.addEventListener('click', () => {
      A.ensure();
      el.log.innerHTML = '';
      hideOverlay();
      applyLockToSetup();
      G.start(setup);
      syncNames();
      syncSetupUI();
      showBanner(setup.mode === 'ai' ? '你执黑先行' : '黑方先行');
    });

    el.btnHelp.addEventListener('click', () => {
      if (modalMode === 'result') showSetup();
      else el.rulesOverlay.classList.remove('hidden');
    });

    el.btnRestart.addEventListener('click', restart);
    el.btnSetup.addEventListener('click', () => {
      if (E.active) return;
      showSetup();
    });
    el.btnRules.addEventListener('click', () => el.rulesOverlay.classList.remove('hidden'));
    el.btnRulesClose.addEventListener('click', () => el.rulesOverlay.classList.add('hidden'));
    el.rulesOverlay.addEventListener('click', e => {
      if (e.target === el.rulesOverlay) el.rulesOverlay.classList.add('hidden');
    });

    el.btnSound.addEventListener('click', () => {
      const muted = A.toggle();
      el.btnSound.textContent = muted ? '🔈' : '🔊';
    });

    el.skinPicker.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) setSkin(b.dataset.skin, true);
    });

    el.sizePicker.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) setFontSize(b.dataset.size, true);
    });

    new ResizeObserver(() => R.resize()).observe(el.wrap);
    window.addEventListener('resize', () => R.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => R.resize(), 220));
    document.addEventListener('keydown', e => {
      const typing = document.activeElement && document.activeElement.tagName === 'INPUT';
      if (e.key === 'Escape') {
        el.rulesOverlay.classList.add('hidden');
        if (E.active) closeEditor(true);
      }
      if ((e.key === 'r' || e.key === 'R') && !E.active && !typing) restart();
      if (E.active && (e.key === '[' || e.key === ']')) {
        applyPercent(currentPercent() + (e.key === ']' ? 2 : -2));
        e.preventDefault();
      }
    });

    G.start(setup);
    showSetup();
    syncSetupUI();
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
