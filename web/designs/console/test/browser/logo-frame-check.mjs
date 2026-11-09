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
  await cmd('Runtime.enable');await cmd('Page.enable');
  for(const width of [1280,390]) for(const initialTheme of ['console','light','terminal']) {
    await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
    await cmd('Page.navigate',{url:`http://127.0.0.1:${appPort}/?theme=${initialTheme}&state=history`});
    let ready=false;for(let n=0;n<100;n++){await new Promise(r=>setTimeout(r,100));if(await evaluate("typeof window.setFixtureTheme==='function'")){ready=true;break;}}
    if(!ready)throw Error('fixture not ready');
    if(width===390)await evaluate("document.querySelector('.menu button').click()");
    await evaluate(`(async()=>{
      await document.fonts.ready;
      const href=document.querySelector('link[rel="icon"][type="image/svg+xml"]').href;
      const image=new Image();image.src=href;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=canvas.height=390;
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      const original=document.querySelector('.brand-logo');
      const samples=[];let running=true;
      const rgb=s=>s.match(/[0-9.]+/g).slice(0,3).map(Number);
      const luminance=arr=>arr.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
      const contrast=(a,b)=>{a=luminance(a);b=luminance(b);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
      function sample(){
        const logo=document.querySelector('.brand-logo');const rect=logo?.getBoundingClientRect();
        const get=selector=>logo?getComputedStyle(logo.querySelector(selector)):null;
        ctx.clearRect(0,0,390,390);ctx.drawImage(image,0,0,390,390);
        const pixel=[...ctx.getImageData(80,30,1,1).data];
        const accent=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
        const tile=get('.logo-tile')?.fill;const face=get('.logo-face')?.fill;const wink=get('.logo-wink')?.stroke;const bright=get('.logo-eye')?.fill;
        const panel=getComputedStyle(document.querySelector('.side')).backgroundColor;
        if(samples.length<256)samples.push({theme:document.documentElement.dataset.ds,dark:matchMedia('(prefers-color-scheme:dark)').matches,tile,face,wink,bright,panel,svgImagePixel:pixel,loaded:image.complete&&image.naturalWidth>0,missing:!rect||!rect.width||!rect.height,same:logo===original,visible:!!rect&&rect.left>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight,faceContrast:tile&&face?contrast(rgb(tile),rgb(face)):0,detailContrast:bright&&face?contrast(rgb(bright),rgb(face)):0,panelContrast:tile?contrast(rgb(tile),rgb(panel)):0,accent});
        if(running)requestAnimationFrame(sample);
      }
      window.logoObservation={samples,stop:()=>{running=false;}};
      requestAnimationFrame(sample);
      for(let n=0;n<5;n++)await new Promise(r=>requestAnimationFrame(r));
    })()`);
    for(const os of ['dark','light','dark','light']) {
      await cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:os}]});
      await evaluate("new Promise(resolve=>{let n=0;const step=()=>++n===6?resolve():requestAnimationFrame(step);requestAnimationFrame(step);})");
    }
    for(const theme of ['light','terminal','console']) {
      await evaluate(`window.setFixtureTheme('${theme}')`);
      await evaluate("new Promise(resolve=>{let n=0;const step=()=>++n===6?resolve():requestAnimationFrame(step);requestAnimationFrame(step);})");
    }
    const samples=await evaluate('window.logoObservation.stop();window.logoObservation.samples');
    const expected={console:'rgb(56, 189, 248)',light:'rgb(3, 105, 161)',terminal:'rgb(74, 222, 128)'};
    const missing=samples.filter(s=>s.missing||!s.visible||!s.loaded).length;
    const appWrong=samples.filter(s=>s.tile!==expected[s.theme]||s.wink!==expected[s.theme]).length;
    const imageWrong=samples.filter(s=>JSON.stringify(s.svgImagePixel)!==JSON.stringify(s.dark?[56,189,248,255]:[3,105,161,255])).length;
    console.log(JSON.stringify({width,initialTheme,samples:samples.length,missing,appWrong,imageWrong,replaced:samples.filter(s=>!s.same).length,minFaceContrast:Math.min(...samples.map(s=>s.faceContrast)),minDetailContrast:Math.min(...samples.map(s=>s.detailContrast)),minPanelContrast:Math.min(...samples.map(s=>s.panelContrast)),trace:samples}));
    if(!samples.length||missing||appWrong||imageWrong||samples.some(s=>s.faceContrast<3||s.detailContrast<3||s.panelContrast<3))process.exitCode=2;
  }
  ws.close();
} finally {chrome.kill('SIGTERM')}
