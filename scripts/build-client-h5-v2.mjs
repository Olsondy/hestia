// 构建 H5 客户端交互原型 v2（P03）：单个离线 HTML，内嵌脚本、样式、仓耳渔阳体（400 / 500）与效果图（后台真实出图，示意素材）。
import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = path.join(root, 'example/prototypes/client-h5-v2');
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const fontRoot = path.join(root, 'assets/fonts/tsanger-yuyang');
const fonts = JSON.parse(read(path.join(fontRoot, 'sources.json'))).filter(f => [400, 500].includes(f.weight));
const fontCss = fonts.map(f => `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};font-display:swap;src:url(data:font/woff2;base64,${fs.readFileSync(path.join(fontRoot, f.file)).toString('base64')}) format('woff2');}`).join('\n');
const notice = `/* Tsanger YuYang fonts\n${read(path.join(fontRoot, 'NOTICE.txt'))}\n*/\n`;
const result = await build({absWorkingDir: root, entryPoints: ['example/prototypes/client-h5-v2/src/app.js'], bundle: true, format: 'iife', target: 'es2022', minify: true,
  legalComments: 'none', write: false, loader: {'.jpg': 'dataurl'}});
const html = read(path.join(dir, 'src/index.html'))
  .replace('/* STYLE */', () => notice + fontCss + '\n' + read(path.join(dir, 'src/style.css')))
  .replace('/* APP */', () => result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
fs.writeFileSync(path.join(dir, 'index.html'), html);
console.log(`Built example/prototypes/client-h5-v2/index.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);
