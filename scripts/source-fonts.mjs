// Rebuild complete local webfonts; normal prototype builds need no Python or network.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const dir=fileURLToPath(new URL('../assets/fonts/tsanger-yuyang/',import.meta.url));
const python=process.env.FONTTOOLS_PYTHON||'python';
const fonts=[];
for(let index=1;index<=5;index++){
  const face=`W0${index}`,weight=200+index*100;
  const source=`仓耳渔阳体${face}.ttf`,file=`tsanger-yuyang-${face}-${weight}.woff2`;
  execFileSync(python,['-m','fontTools.ttLib.woff2','compress',path.join(dir,source),'-o',path.join(dir,file)],{stdio:'inherit'});
  fonts.push({family:'Tsanger YuYang',weight,format:'woff2',file,source,sourceSha256:createHash('sha256').update(fs.readFileSync(path.join(dir,source))).digest('hex'),license:'NOTICE.txt',coverage:'Complete original glyph coverage; no copy-based subsetting.'});
}
fs.writeFileSync(path.join(dir,'sources.json'),JSON.stringify(fonts,null,2)+'\n');
const css=fonts.map(f=>`@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};font-display:swap;src:url('./${f.file}') format('woff2');}`).join('\n');
fs.writeFileSync(path.join(dir,'fonts.css'),css+'\n');
console.log('Rebuilt five complete Tsanger YuYang WOFF2 faces from local TTF sources.');
