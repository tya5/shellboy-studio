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
  for(const width of [1280,390]) for(const theme of ['console','light','terminal']) for(const osScheme of ['dark','light']) {
    await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390});
    await cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:osScheme}]});
    await cmd('Page.navigate',{url:`http://127.0.0.1:${appPort}/?theme=${theme}&state=history`});
    let ready=false;for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,100));if(await evaluate("!!document.querySelector('.brand-logo')")){ready=true;break}}
    if(!ready)throw Error('No brand logo');
    if(width===390)await evaluate("document.querySelector('.menu button').click()");
    await new Promise(r=>setTimeout(r,200));
    const result=await evaluate(`(async()=>{
      const image=document.querySelector('.brand-logo');const rect=image.getBoundingClientRect();
      const color=(selector,prop='fill')=>getComputedStyle(image.querySelector(selector))[prop];
      const colors={tile:color('.logo-tile'),face:color('.logo-face'),bubble:color('.logo-bubble'),wink:color('.logo-wink','stroke'),eye:color('.logo-eye'),panel:getComputedStyle(document.querySelector('.side')).backgroundColor};
      const icons=await Promise.all([...document.querySelectorAll('link[rel=icon],link[rel=apple-touch-icon]')].map(async link=>{
        const response=await fetch(link.href);const image=new Image();image.src=link.href;await image.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=390;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,390,390);const pixel=(x,y)=>[...ctx.getImageData(x,y,1,1).data];const pixels={tile:pixel(80,30),face:pixel(200,190),bright:pixel(248,188)};return {pixels,rel:link.rel,href:new URL(link.href).pathname,status:response.status,mime:response.headers.get('content-type'),width:image.naturalWidth,height:image.naturalHeight};
      }));
      const href=document.querySelector('link[rel=manifest]').href;const response=await fetch(href);const manifest=await response.json();
      const manifestIcons=await Promise.all(manifest.icons.map(async icon=>{const response=await fetch(icon.src);const image=new Image();image.src=icon.src;await image.decode();return {...icon,status:response.status,mime:response.headers.get('content-type'),width:image.naturalWidth,height:image.naturalHeight}}));
      return {logo:{inline:image.tagName.toLowerCase()==='svg',colors,loaded:true,x:rect.x,y:rect.y,width:rect.width,height:rect.height,visible:rect.x>=0&&rect.y>=0&&rect.right<=innerWidth},icons,manifest:{href:new URL(href).pathname,status:response.status,mime:response.headers.get('content-type'),start_url:manifest.start_url,scope:manifest.scope,theme_color:manifest.theme_color,icons:manifestIcons},overflow:document.documentElement.scrollWidth>innerWidth};
    })()`);
    if(!result.logo.loaded||!result.logo.visible||result.overflow)throw Error('Brand layout failed '+JSON.stringify(result));
    if(result.icons.length!==3||result.icons.some(i=>i.status!==200)||!result.icons.some(i=>i.mime==='image/svg+xml')||!result.icons.some(i=>i.mime==='image/x-icon'))throw Error('Favicon failed');
    if(result.manifest.status!==200||result.manifest.mime!=='application/manifest+json'||result.manifest.scope!=='/'||result.manifest.start_url!=='/'||result.manifest.icons.some(i=>i.status!==200||i.mime!=='image/png'))throw Error('Manifest failed');
    const favicon=result.icons.find(icon=>icon.mime==='image/svg+xml');
    const expected=osScheme==='dark'?[56,189,248,255]:[3,105,161,255];
    if(JSON.stringify(favicon.pixels.tile)!==JSON.stringify(expected))throw Error('Image-context OS favicon color failed '+JSON.stringify(favicon));
    const appExpected={console:'rgb(56, 189, 248)',light:'rgb(3, 105, 161)',terminal:'rgb(74, 222, 128)'}[theme];
    if(result.logo.colors.tile!==appExpected||result.logo.colors.wink!==appExpected)throw Error('App theme did not follow accent');
    const browserManifest=await cmd('Page.getAppManifest');
    if(browserManifest.errors.length)throw Error('Browser manifest rejected: '+JSON.stringify(browserManifest.errors));
    results.push({width,theme,osScheme,...result,browserManifest});const shot=await cmd('Page.captureScreenshot',{format:'png'});await writeFile(`${base}/accent-logo-${width}-${theme}-${osScheme}.png`,Buffer.from(shot.data,'base64'));
  }
  for(const osScheme of ['dark','light']) {
    await cmd('Emulation.setDeviceMetricsOverride',{width:390,height:390,deviceScaleFactor:1,mobile:false});
    await cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:osScheme}]});
    await cmd('Page.navigate',{url:`http://127.0.0.1:${appPort}/assets/brand/studio-favicon.svg`});
    await new Promise(r=>setTimeout(r,250));
    const svg=await evaluate(`({tile:getComputedStyle(document.querySelector('.tile')).fill,wink:getComputedStyle(document.querySelector('.wink')).stroke,face:getComputedStyle(document.querySelector('.face')).fill,eye:getComputedStyle(document.querySelector('.eye')).fill,dark:matchMedia('(prefers-color-scheme:dark)').matches})`);
    const expected=osScheme==='dark'?'rgb(56, 189, 248)':'rgb(3, 105, 161)';
    if(svg.tile!==expected||svg.wink!==expected)throw Error('OS favicon color mismatch '+JSON.stringify(svg));
    results.push({faviconDocument:true,osScheme,...svg});
    const shot=await cmd('Page.captureScreenshot',{format:'png'});await writeFile(`${base}/favicon-${osScheme}.png`,Buffer.from(shot.data,'base64'));
  }
  for(const size of [192,512]) {
    await cmd('Emulation.setDeviceMetricsOverride',{width:600,height:600,deviceScaleFactor:1,mobile:false});
    await cmd('Page.navigate',{url:`http://127.0.0.1:${appPort}/assets/brand/studio-teal-${size}.png`});
    await new Promise(r=>setTimeout(r,150));
    const shot=await cmd('Page.captureScreenshot',{format:'png'});await writeFile(`${base}/manifest-icon-${size}.png`,Buffer.from(shot.data,'base64'));
  }
  await writeFile(`${base}/brand-results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
  ws.close();
} finally {chrome.kill('SIGTERM')}
