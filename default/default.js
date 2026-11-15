/* ===== 默认设置版（无障碍版）的锁定配置 =====
 * 这个页面不需要任何设置：按设备（横屏/竖屏）自动套用下面的预设。
 * 只想改数值的话，直接改这里即可。
 */
window.GC_LOCK = {
  title: '围棋弹棋 · 默认版',
  subtitle: '已按你的设备自动配置好，打开就能玩',

  label: {
    desktop: '电脑（横屏）默认配置',
    mobile: '手机（竖屏）默认配置'
  },

  // 电脑 / 横屏
  desktop: {
    mode: 'ai',       // 单人 vs AI
    board: 19,        // 19×19
    troops: 3,        // 每方 3 子
    civ: 50,          // 50 个平民
    obs: 3,           // 3 个大圆盘
    ai: 'normal',     // 标准 AI
    penalty: 'pick',  // 每撞飞 3 个平民，自选一子下场
    aim: 'pull',      // 拉弓式瞄准
    rules: 'classic', // 常规模式（想改成生化模式：'bio'）
    level: null       // 随机关卡（不使用自制关卡）
  },

  // 手机 / 竖屏
  mobile: {
    mode: 'ai',
    board: 11,        // 11×11
    troops: 2,        // 2v2
    civ: 15,          // 15 个平民
    obs: 2,           // 2 个大圆盘
    ai: 'normal',
    penalty: 'pick',
    aim: 'pull',
    rules: 'classic',
    level: null
  }
};
