// Synthetic static production bundle only. Does not contact an owner or serve auth data.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const csp = (await readFile(root + '/src/assets.rs','utf8')).match(/const CSP: &str = "([^"]+)"/)[1];
const server = createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Cache-Control','no-store');
  if(url.pathname==='/auth-mode') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({authentication_required:false})); return; }
  if(url.pathname==='/guide-preference') { res.setHeader('Content-Type','application/json'); res.end('{"enabled":false}'); return; }
  const file = url.pathname==='/'?'index.html':/^\/assets\/[a-zA-Z0-9_./-]+$/.test(url.pathname)&&!url.pathname.includes('..')?url.pathname.slice(1):undefined;
  try { if(!file) throw Error('not static'); const bytes=await readFile(root+'/web/dist/'+file);res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'application/octet-stream');res.end(bytes); }
  catch {res.writeHead(404);res.end();}
});
server.listen(Number(process.env.FIXTURE_PORT??19532),'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
