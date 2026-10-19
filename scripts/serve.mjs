import http from 'node:http';
import fs from 'node:fs';
const file=new URL('../dist/index.html',import.meta.url);
const port=Number(process.env.PORT||4173);
http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(!['/','/index.html'].includes(url.pathname)){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);}).listen(port,'127.0.0.1',()=>console.log(`Hestia prototype: http://127.0.0.1:${port}`));
