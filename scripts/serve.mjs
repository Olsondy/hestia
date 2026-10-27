import http from 'node:http';
import fs from 'node:fs';
const file=new URL('../example/prototypes/projects/index.html',import.meta.url);
const port=Number(process.env.PORT||4173);
http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(!['/','/index.html','/example/prototypes','/example/prototypes/','/example/prototypes/index.html','/example/prototypes/projects','/example/prototypes/projects/','/example/prototypes/projects/index.html','/dist/index.html'].includes(url.pathname)){res.writeHead(404);res.end('Not found');return;}if(!fs.existsSync(file)){res.writeHead(503,{'Content-Type':'text/plain; charset=utf-8'});res.end('Prototype is not built. Run pnpm build.');return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);}).listen(port,'127.0.0.1',()=>console.log(`Hestia prototype: http://127.0.0.1:${port}/example/prototypes/projects/`));
