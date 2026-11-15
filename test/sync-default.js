/* 由根目录 index.html 生成 default/index.html（页面壳共用，只有路径和入口脚本不同）。
 * 改了 index.html 之后跑一次：  node test/sync-default.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// 资源路径改相对上一级
html = html.replace(/href="css\//g, 'href="../css/');
html = html.replace(/src="js\//g, 'src="../js/');

// 标题
html = html.replace('<title>围棋弹棋 · Go Carrom</title>', '<title>围棋弹棋 · 默认版</title>');

// 注入默认配置脚本（必须在 ui.js 之后、且在 DOMContentLoaded 之前执行）
if (!html.includes('src="default.js"')) {
  html = html.replace('</body>', '<script src="default.js"></script>\n</body>');
}

fs.mkdirSync(path.join(root, 'default'), { recursive: true });
fs.writeFileSync(path.join(root, 'default', 'index.html'), html);
console.log('default/index.html generated,', html.length, 'bytes');
