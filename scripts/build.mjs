import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'output/3d/ideal-home-3d.html');
const result=await build({absWorkingDir:root,entryPoints:['src/app.js'],bundle:true,format:'iife',target:'es2022',minify:true,legalComments:'inline',write:false});
const template=fs.readFileSync(path.join(root,'src/index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'src/style.css'),'utf8');
const js=result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
const require=createRequire(import.meta.url);
const threeRoot=path.resolve(path.dirname(require.resolve('three')),'..');
const license=fs.readFileSync(path.join(threeRoot,'LICENSE'),'utf8');
// Function replacements preserve literal dollar sequences in the bundled JavaScript.
const html=template.replace('/* INLINE_STYLE */',()=>css).replace('/* INLINE_APP */',()=>`/* Three.js license\n${license}\n*/\n${js}`);
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,html);
console.log(`Built ${path.relative(root,output)} (${(Buffer.byteLength(html)/1024/1024).toFixed(2)} MB)`);
