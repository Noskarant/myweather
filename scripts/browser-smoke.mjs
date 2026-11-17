import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {webkit} from 'playwright';

const root=fileURLToPath(new URL('../',import.meta.url));
const contentType={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.png':'image/png'};
const server=createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost/').pathname);
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root))throw new Error('invalid path');
  const buf=await readFile(file);
  res.writeHead(200,{'content-type':contentType[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});
  res.end(buf);
 }catch {res.writeHead(404);res.end('Not Found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const browser=await webkit.launch({headless:true});
try{
 const ctx=await browser.newContext({serviceWorkers:'block'});
 const page=await ctx.newPage();
 const failures=[],errors=[],weatherResponses=[];
 page.on('pageerror',err=>errors.push('script: '+String(err.message).slice(0,260)));
 page.on('console',msg=>{if(msg.type()==='error'||msg.type()==='warning')errors.push(msg.type()+': '+msg.text().slice(0,350));});
 page.on('requestfailed',req=>{if(req.url().includes('open-meteo.com'))failures.push(req.url().split('?')[0]+' '+req.failure()?.errorText);});
 page.on('response',r=>{if(r.url().includes('open-meteo.com'))weatherResponses.push({status:r.status(),url:r.url().split('?')[0]});});
 await page.goto(base,{waitUntil:'domcontentloaded',timeout:15000});
 await page.waitForFunction(()=>{
   const condition=document.querySelector('#currentCondition')?.textContent||'';
   return condition.includes('indisponible')|| (!condition.includes('Chargement') &&
      document.querySelector('#currentTemp')?.textContent?.trim()!=='--°');
  },{timeout:45000}).catch(()=>{});
 console.log(JSON.stringify({browser:'webkit',result:{
   condition:await page.locator('#currentCondition').innerText().catch(()=>'missing'),
   temperature:await page.locator('#currentTemp').innerText().catch(()=>'missing'),
   hourlyCount:await page.locator('#hourlyRail').locator(':scope > *').count().catch(()=>0),
   dailyCount:await page.locator('#dailyGrid').locator(':scope > *').count().catch(()=>0),
   responses:weatherResponses.slice(0,15),networkFailures:failures.slice(0,15),browserErrors:errors.slice(0,30)
 }}));
  const fallbackCtx=await browser.newContext({serviceWorkers:'block'});
  try {
    await fallbackCtx.route('https://api.open-meteo.com/**',route=>route.abort('failed'));
    await fallbackCtx.route('https://ensemble-api.open-meteo.com/**',route=>route.abort('failed'));
    const fallbackPage=await fallbackCtx.newPage();
    const fallbackErrors=[];
    fallbackPage.on('pageerror',err=>fallbackErrors.push(String(err.message).slice(0,260)));
    await fallbackPage.goto(base,{waitUntil:'domcontentloaded'});
    await fallbackPage.waitForFunction(()=>{
      const condition=document.querySelector('#currentCondition')?.textContent||'';
      return condition.includes('indisponible')||(!condition.includes('Chargement')&&
        document.querySelector('#currentTemp')?.textContent?.trim()!=='--°');
    },{timeout:45000}).catch(()=>{});
    const result={condition:await fallbackPage.locator('#currentCondition').innerText(),
      temp:await fallbackPage.locator('#currentTemp').innerText(),
      updated:await fallbackPage.locator('#lastUpdated').innerText(),
      dailyCount:await fallbackPage.locator('#dailyGrid').locator(':scope > *').count(),
      errors:fallbackErrors};
    console.log(JSON.stringify({browser:'webkit-api-blocked',result}));
    const snapshot=JSON.parse(await readFile(path.join(root,'data/forecast-fallback.json'),'utf8'));
    if(snapshot.forecasts.some(e=>e.location.name==='Oullins')&&
       (result.condition.includes('indisponible')||result.dailyCount<10||!result.updated.includes('Secours Open-Meteo')))
      throw new Error('Safari WebKit did not recover from blocked Open-Meteo using the real published fallback');
  } finally {await fallbackCtx.close();}
  // 3D CNE preview: check real scroll-to-bottom entry and chronology on desktop and iPhone.
  // The terrain tile/CDN delivery still requires separate on-device QA.
  for (const device of [
    {name:'desktop',viewport:{width:1440,height:900},isMobile:false,hasTouch:false},
    {name:'iPhone',viewport:{width:390,height:844},isMobile:true,hasTouch:true}
  ]) {
    const previewCtx=await browser.newContext({...device,serviceWorkers:'block'});
    try {
      const preview=await previewCtx.newPage();
      await preview.goto(base,{waitUntil:'domcontentloaded',timeout:30000});
      if(await preview.locator('#cne3dLaunch').count()!==1)
        throw new Error(device.name+': 3D CNE footer launcher missing');
      if(await preview.locator('#cne3dFooter').evaluate(el=>el.parentElement?.lastElementChild!==el))
        throw new Error(device.name+': experimental launcher is not the last forecast block');
      if(await preview.locator('.bottom-nav #cne3dNav').count()!==0)
        throw new Error(device.name+': experimental launcher must not appear in fixed navigation');
      await preview.locator('#cne3dLaunch').scrollIntoViewIfNeeded();
      if(!await preview.locator('#cne3dLaunch').isVisible())
        throw new Error(device.name+': footer launcher not visible after scrolling');
      await preview.locator('#cne3dLaunch').click();
      if(!await preview.locator('#cne3dView').isVisible())throw new Error(device.name+': 3D page not visible');
      if(await preview.locator('#cneZone option').count()!==3)throw new Error(device.name+': missing zones');
      await preview.locator('#cneZone').selectOption('pilat');
      await preview.locator('#cneLayer').selectOption('lpn');
      await preview.locator('[data-cne-chart-mode="day"]').click();
      if(await preview.locator('[data-cne-chart-mode="day"]').getAttribute('aria-pressed')!=='true')
        throw new Error(device.name+': daily timeline selection failed');
      const chart=await preview.locator('.cne-chart').boundingBox();
      const map=await preview.locator('#cneMapWrap').boundingBox();
      if(!chart||!map||chart.x<map.x||chart.x+chart.width>map.x+map.width+2)
        throw new Error(device.name+': chart overlay escapes map bounds');
      if(Math.abs((chart.x+chart.width)-(map.x+map.width))>40)
        throw new Error(device.name+': timeline is not anchored to bottom right');
      await preview.locator('#cneFull').click();
      if(!await preview.locator('#cne3dView').evaluate(el=>el.classList.contains('cne-immersive')))
        throw new Error(device.name+': fullscreen terrain mode not activated');
      await preview.locator('#cneFull').click();
      if(await preview.locator('#cne3dView').evaluate(el=>el.classList.contains('cne-immersive')))
        throw new Error(device.name+': fullscreen terrain mode did not close');
      console.log('3D CNE WebKit '+device.name+': footer access, zones, chronology and layout OK');
    } finally {await previewCtx.close();}
  }
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
