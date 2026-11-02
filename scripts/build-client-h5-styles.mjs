// 构建 H5 客户端风格探索稿：单个离线 HTML，内嵌脚本、样式与效果图（后台真实出图，示意素材）。
import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = path.join(root, 'example/prototypes/client-h5-styles');
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const result = await build({absWorkingDir: root, entryPoints: ['example/prototypes/client-h5-styles/src/app.js'], bundle: true, format: 'iife', target: 'es2022', minify: true,
  legalComments: 'none', write: false, loader: {'.jpg': 'dataurl'}});
const html = read(path.join(dir, 'src/index.html'))
  .replace('/* STYLE */', () => read(path.join(dir, 'src/style.css')))
  .replace('/* APP */', () => result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
fs.writeFileSync(path.join(dir, 'index.html'), html);
console.log(`Built example/prototypes/client-h5-styles/index.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);
