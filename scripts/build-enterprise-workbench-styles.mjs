// 构建 企业工作台风格对比稿：单个离线 HTML，内嵌脚本、样式、Three.js 与仓耳渔阳体（400/500）。
import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = path.join(root, 'example/prototypes/enterprise-workbench-styles');
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const result = await build({absWorkingDir: root, entryPoints: ['example/prototypes/enterprise-workbench-styles/src/app.js'], bundle: true, format: 'iife', target: 'es2022', minify: true, legalComments: 'none', write: false});
const fontRoot = path.join(root, 'assets/fonts/tsanger-yuyang');
const fonts = JSON.parse(fs.readFileSync(path.join(fontRoot, 'sources.json'), 'utf8')).filter(f => [400, 500].includes(f.weight));
const fontCss = fonts.map(f => `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};font-display:swap;src:url(data:font/woff2;base64,${fs.readFileSync(path.join(fontRoot, f.file)).toString('base64')}) format('woff2');}`).join('\n');
const require = createRequire(import.meta.url);
const threeLicense = read(path.join(path.resolve(path.dirname(require.resolve('three')), '..'), 'LICENSE'));
const notice = `/* Three.js\n${threeLicense}\nTsanger YuYang fonts\n${read(path.join(fontRoot, 'NOTICE.txt'))}\n*/\n`;
const html = read(path.join(dir, 'src/index.html'))
  .replace('/* STYLE */', () => fontCss + '\n' + read(path.join(dir, 'src/style.css')))
  .replace('/* APP */', () => notice + result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
fs.writeFileSync(path.join(dir, 'index.html'), html);
console.log(`Built example/prototypes/enterprise-workbench-styles/index.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);
