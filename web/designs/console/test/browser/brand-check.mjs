import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const port=Number(process.env.DEBUG_PORT ?? 19331);
const appPort=Number(process.env.FIXTURE_PORT ?? 19330);
const browser=process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome=spawn(browser,['--headless','--disable-gpu','--disable-extensions','--no-first-run','--user-data-dir='+join(tmpdir(),`studio-toolbar-${process.pid}`),'--remote-debugging-port='+port,'--remote-allow-origins=*','about:blank'],{stdio:'ignore'});
try {
  let info; for(let n=0;n<100;n++){try {info=await (await fetch(`http://127.0.0.1:${port}/json`)).json();break}catch{await new Promise(r=>setTimeout(r,100))}}
  if(!info) throw Error('Chrome did not start');
  const ws=new WebSocket(info.find((target)=>target.type==='page' && target.url==='about:blank').webSocketDebuggerUrl); await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  let id=0;const waiting=new Map();ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.method==='Log.entryAdded')console.log('LOG',JSON.stringify(m.params));if(m.method==='Runtime.exceptionThrown')console.log('EXCEPTION',JSON.stringify(m.params));if(m.id){const p=waiting.get(m.id);waiting.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}};
  const cmd=(method,params={})=>new Promise((resolve,reject)=>{const i=++id;waiting.set(i,{resolve,reject});ws.send(JSON.stringify({id:i,method,params}))});
  const evaluate=async(expression)=>{let r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
  const base=process.env.SHOTS_DIR;
  await cmd("Runtime.enable"); await cmd("Page.enable"); await cmd("Log.enable");
  const results = [];
  for(const width of [1280,390]) for(const theme of ['console','light']) {
    await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
    await cmd('Page.navigate',{url:`http://127.0.0.1:${appPort}/?theme=${theme}&state=history`});
    let ready=false;for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,100));if(await evaluate("!!document.querySelector('.brand-logo')")){ready=true;break}}
    if(!ready)throw Error('No brand logo');
    if(width===390)await evaluate("document.querySelector('.menu button').click()");
    await new Promise(r=>setTimeout(r,200));
    const result=await evaluate(`(async()=>{
      const image=document.querySelector('.brand-logo');const rect=image.getBoundingClientRect();
      const icons=await Promise.all([...document.querySelectorAll('link[rel=icon],link[rel=apple-touch-icon]')].map(async link=>{
        const response=await fetch(link.href);const image=new Image();image.src=link.href;await image.decode();return {rel:link.rel,href:new URL(link.href).pathname,status:response.status,mime:response.headers.get('content-type'),width:image.naturalWidth,height:image.naturalHeight};
      }));
      const href=document.querySelector('link[rel=manifest]').href;const response=await fetch(href);const manifest=await response.json();
      const manifestIcons=await Promise.all(manifest.icons.map(async icon=>{const response=await fetch(icon.src);const image=new Image();image.src=icon.src;await image.decode();return {...icon,status:response.status,mime:response.headers.get('content-type'),width:image.naturalWidth,height:image.naturalHeight}}));
      return {logo:{src:image.getAttribute('src'),loaded:image.complete&&image.naturalWidth>0,x:rect.x,y:rect.y,width:rect.width,height:rect.height,visible:rect.x>=0&&rect.y>=0&&rect.right<=innerWidth},icons,manifest:{href:new URL(href).pathname,status:response.status,mime:response.headers.get('content-type'),start_url:manifest.start_url,scope:manifest.scope,theme_color:manifest.theme_color,icons:manifestIcons},overflow:document.documentElement.scrollWidth>innerWidth};
    })()`);
    if(!result.logo.loaded||!result.logo.visible||result.overflow)throw Error('Brand layout failed '+JSON.stringify(result));
    if(result.icons.length!==3||result.icons.some(i=>i.status!==200||i.mime!=='image/png'))throw Error('Favicon failed');
    if(result.manifest.status!==200||result.manifest.mime!=='application/manifest+json'||result.manifest.scope!=='/'||result.manifest.start_url!=='/'||result.manifest.icons.some(i=>i.status!==200||i.mime!=='image/png'))throw Error('Manifest failed');
    const browserManifest=await cmd('Page.getAppManifest');
    if(browserManifest.errors.length)throw Error('Browser manifest rejected: '+JSON.stringify(browserManifest.errors));
    results.push({width,theme,...result,browserManifest});const shot=await cmd('Page.captureScreenshot',{format:'png'});await writeFile(`${base}/bright-teal-${width}-${theme}.png`,Buffer.from(shot.data,'base64'));
  }
  await writeFile(`${base}/brand-results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
  ws.close();
} finally {chrome.kill('SIGTERM')}
