// 构建 AM-P 平台管理后台交互原型：单个离线 HTML，内嵌脚本、样式与仓耳渔阳体（400/500 两档）。
// 样式在企业工作台原型（P02）之上叠加，保证两者是同一套视觉。
import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = path.join(root, 'example/prototypes/admin-console');
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const result = await build({absWorkingDir: root, entryPoints: ['example/prototypes/admin-console/src/app.js'], bundle: true, format: 'iife', target: 'es2022', minify: true, legalComments: 'none', write: false});
const fontRoot = path.join(root, 'assets/fonts/tsanger-yuyang');
const fonts = JSON.parse(fs.readFileSync(path.join(fontRoot, 'sources.json'), 'utf8')).filter(f => [400, 500].includes(f.weight));
const fontCss = fonts.map(f => `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};font-display:swap;src:url(data:font/woff2;base64,${fs.readFileSync(path.join(fontRoot, f.file)).toString('base64')}) format('woff2');}`).join('\n');
const notice = `/* Tsanger YuYang fonts\n${read(path.join(fontRoot, 'NOTICE.txt'))}\n*/\n`;
const css = [fontCss, read(path.join(root, 'example/prototypes/enterprise-workbench/src/style.css')), read(path.join(dir, 'src/style.css'))].join('\n');
const html = read(path.join(dir, 'src/index.html'))
  .replace('/* ADMIN_STYLE */', () => css)
  .replace('/* ADMIN_APP */', () => notice + result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
fs.writeFileSync(path.join(dir, 'index.html'), html);
console.log(`Built example/prototypes/admin-console/index.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);
