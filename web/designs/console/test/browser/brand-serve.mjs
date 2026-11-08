import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
const root=fileURLToPath(new URL('../../../../../', import.meta.url)).replace(/\/$/, '');
const out=process.env.PRODUCTION_DIR ?? join(tmpdir(), `studio-character-production-${process.pid}`);
await build({configFile:root+'/web/vite.config.ts',root:root+'/web',build:{outDir:out,emptyOutDir:true,rollupOptions:{input:root+'/web/designs/console/test/browser/integration-fixture.html'}}});
const rust=await readFile(root+'/src/assets.rs','utf8');const csp=rust.match(/const CSP: &str = "([^"]+)"/)[1];
const types={ico:'image/x-icon',png:'image/png',webmanifest:'application/manifest+json',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml',woff2:'font/woff2'};
const requests=[];
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 const file=path==='/'?'designs/console/test/browser/integration-fixture.html':/^\/assets\/(?:brand\/)?[a-zA-Z0-9_.-]+$/.test(path)?path.slice(1):undefined;
 try { if(!file)throw Error('No route');let bytes=await readFile(out+'/'+file); if(path==='/'){const head=(await readFile(root+'/web/app/index.html','utf8')).match(/<title>[\s\S]*?<\/head>/)[0].replace('</head>','');bytes=Buffer.from(bytes.toString().replace('</head>',head+'</head>'));}res.writeHead(200,{'Content-Type':path==='/'?'text/html; charset=utf-8':types[file.split('.').at(-1)]??'application/octet-stream',...(path==='/'?{'Content-Security-Policy':csp}:{}),'X-Content-Type-Options':'nosniff','Cache-Control':path==='/'||path.startsWith('/assets/brand/')||path.endsWith('.webmanifest')?'no-cache':'public, max-age=31536000, immutable'});res.end(bytes);requests.push({path,status:200}); }
 catch {res.writeHead(404);res.end();requests.push({path,status:404});}
});
server.listen(Number(process.env.FIXTURE_PORT ?? 19430),'127.0.0.1',()=>console.log('Production built synthetic UI; exact existing bridge CSP, only / and /assets routes'));
process.on('SIGTERM',async()=>{await writeFile(process.env.REQUEST_LOG ?? join(out, 'requests.json'),JSON.stringify({csp,requests},null,2));server.close(()=>process.exit(0));});
