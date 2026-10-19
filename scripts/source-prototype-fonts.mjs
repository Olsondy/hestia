// Run intentionally when prototype copy changes; normal builds remain offline.
import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const files=await fs.readdir(new URL('src/workbench/',root));
const source=(await Promise.all(files.filter(name=>name.endsWith('.js')).map(name=>fs.readFile(new URL('src/workbench/'+name,root),'utf8')))).join('\n');
const text=[...new Set([...source].filter(c=>/[\u3400-\u9fffA-Za-z0-9，。、？！·]/u.test(c)))].sort().join('');
const dir=new URL('src/workbench/fonts/',root);await fs.mkdir(dir,{recursive:true});
const userAgent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const assets=[];
for(const [family,name,weight,licensePath] of [['Noto Sans SC','gallery',600,'notosanssc'],['Noto Serif SC','editorial',500,'notoserifsc']]){
  const cssUrl=`https://fonts.googleapis.com/css2?family=${family.replaceAll(' ','+')}:wght@${weight}&text=${encodeURIComponent(text)}`;
  const response=await fetch(cssUrl,{headers:{'User-Agent':userAgent}});if(!response.ok)throw Error(`Font CSS ${response.status}`);
  const css=await response.text(),match=css.match(/src: url\(([^)]+)\) format\('([^']+)'\)/);if(!match)throw Error('Missing font source');
  const font=await fetch(match[1]);if(!font.ok)throw Error(`Font ${font.status}`);
  const extension=match[2]==='woff2'?'woff2':'ttf';await fs.writeFile(new URL(`${name}.${extension}`,dir),Buffer.from(await font.arrayBuffer()));
  const licenseUrl=`https://raw.githubusercontent.com/google/fonts/main/ofl/${licensePath}/OFL.txt`;
  const license=await fetch(licenseUrl);if(!license.ok)throw Error(`License ${license.status}`);await fs.writeFile(new URL(`${name}-OFL.txt`,dir),await license.text());
  assets.push({family,file:`${name}.${extension}`,weight,format:match[2],source:cssUrl,fontUrl:match[1],licenseUrl,characters:text});
}
await fs.writeFile(new URL('sources.json',dir),JSON.stringify(assets,null,2)+'\n');console.log('Saved two locally hosted Noto display subsets and SIL OFL licenses.');
