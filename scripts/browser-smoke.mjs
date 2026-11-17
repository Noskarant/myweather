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
      // A deterministic map engine with Map but intentionally NO deprecated supported().
      // This exercises real module initialization instead of merely checking layout.
      await preview.addInitScript(() => {
        class TestMap {
          constructor(options) {
            this.options=options;
            this.handlers={};
            this.sources=new Map();
            this.layers=new Map();
            this.pitch=options.pitch;
            this.zoom=options.zoom;this.center=options.center;this.bearing=options.bearing;
            window.__cneTestMap=this;
            setTimeout(()=>this.handlers.load?.forEach(callback=>callback()),20);
          }
          on(event,callback){(this.handlers[event]??=[]).push(callback);return this;}
          addControl(){return this;}
          addSource(id,options){const item={...options,updateImage(image){Object.assign(this,image);}};this.sources.set(id,item);}
          getSource(id){return this.sources.get(id);}
          removeSource(id){this.sources.delete(id);}
          addLayer(item){this.layers.set(item.id,item);}
          getLayer(id){return this.layers.get(id);}
          removeLayer(id){this.layers.delete(id);}
          setTerrain(){}
          fitBounds(){}
          getPitch(){return this.pitch;}
          getZoom(){return this.zoom;}
          easeTo(options){
            if(options.pitch!==undefined)this.pitch=options.pitch;
            if(options.zoom!==undefined)this.zoom=options.zoom;
            if(options.center!==undefined)this.center=options.center;
            if(options.bearing!==undefined)this.bearing=options.bearing;
          }
          resize(){}
          queryTerrainElevation(){return 1100;}
        }
        class TestMarker {
          constructor({element}){this.element=element;}
          setLngLat(){return this;}
          addTo(map){map.options.container.appendChild(this.element);return this;}
          remove(){this.element.remove();}
        }
        window.maplibregl={Map:TestMap,Marker:TestMarker,NavigationControl:class{}};
      });
      await preview.route('https://api.open-meteo.com/v1/forecast**',async route=>{
        const requestUrl=new URL(route.request().url());
        const latitudes=requestUrl.searchParams.get('latitude').split(',').map(Number);
        const longitudes=requestUrl.searchParams.get('longitude').split(',').map(Number);
        const time=Array.from({length:168},(_,i)=>'2026-11-'+String(17+Math.floor(i/24)).padStart(2,'0')+'T'+String(i%24).padStart(2,'0')+':00');
        const payload=latitudes.map((latitude,i)=>({
          latitude,longitude:longitudes[i],hourly:{
            time,
            temperature_2m:time.map((_,h)=>2-h*0.03),
            snow_depth:time.map((_,h)=>Math.max(0,h-10)/1000),
            snowfall:time.map(()=>0.7),
            freezing_level_height:time.map(()=>1700)
          }
        }));
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload.length===1?payload[0]:payload)});
      });
      const previewErrors=[];
      preview.on('pageerror',error=>previewErrors.push(error.stack||error.message));
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
      await preview.waitForFunction(()=>{
        const s=document.querySelector('#cneStatus')?.textContent||'';
        const pins=document.querySelectorAll('#cneMap .cne-place-pin').length;
        return s.includes('25 points') && pins>=3;
      },{timeout:15000});
      // The ordinary forecast view may report unrelated Windy iframe failures.
      // Assert only crashes of the new CNE modules; the map/weather readiness
      // assertions above independently detect all initialization failures.
      const cneErrors=previewErrors.filter(message=>/cne3d(?:-model|-timeline)?\.js|maplibre-gl/i.test(message));
      if(cneErrors.length)throw new Error(device.name+': 3D module exceptions: '+cneErrors.join('; '));
      if(await preview.locator('#cneMapWait').isVisible())
        throw new Error(device.name+': terrain startup overlay never closed');
      await preview.locator('#cneChartPlot path').first().waitFor({state:'attached',timeout:15000}).catch(async()=>{
        throw new Error(device.name+': timeline did not render after forecast load: '+await preview.locator('#cneChartPlot').innerText());
      });
      if(!await preview.locator('#cneSelection').innerText().then(s=>s.includes('Neige au sol')))
        throw new Error(device.name+': local snow values never loaded');
      if(await preview.locator('#cneZone option').count()!==3)throw new Error(device.name+': missing zones');
      const firstCamera=await preview.evaluate(()=>({pitch:window.__cneTestMap?.pitch,zoom:window.__cneTestMap?.zoom}));
      if(firstCamera.pitch<75||firstCamera.zoom<12)
        throw new Error(device.name+': Lyonnais camera is too high or too far: '+JSON.stringify(firstCamera));
      await preview.locator('#cneZone').selectOption('valmorel');
      const alpineCamera=await preview.evaluate(()=>({pitch:window.__cneTestMap.pitch,zoom:window.__cneTestMap.zoom}));
      if(alpineCamera.pitch<75||alpineCamera.zoom<12.5)
        throw new Error(device.name+': Valmorel must open close to the ridge: '+JSON.stringify(alpineCamera));
      await preview.locator('#cneZone').selectOption('pilat');
      const pilatCamera=await preview.evaluate(()=>({pitch:window.__cneTestMap.pitch,zoom:window.__cneTestMap.zoom}));
      if(pilatCamera.pitch<75||pilatCamera.zoom<12)
        throw new Error(device.name+': Pilat must open in low-angle relief: '+JSON.stringify(pilatCamera));
      await preview.waitForFunction(()=>document.querySelector('#cneStatus')?.textContent?.includes('25 points'),{timeout:15000});
      // Click arbitrary terrain, not a named place: a point-specific forecast
      // must become visible on the map without scrolling to the bottom details.
      await preview.evaluate(()=>{
        window.__cneTestMap.handlers.click.forEach(callback=>callback({lngLat:{lat:45.3825,lng:4.5728}}));
      });
      await preview.waitForFunction(()=>{
        const card=document.querySelector('#cneMapHit');
        return !card?.hidden && document.querySelector('#cneHitInfo')?.textContent?.includes('Prévision au point');
      },{timeout:15000});
      if(!(await preview.locator('#cneHitSnow').innerText()).includes('cm'))
        throw new Error(device.name+': missing local snow depth on the clicked terrain');
      if(!(await preview.locator('#cneHitAltitude').innerText()).includes('1100'))
        throw new Error(device.name+': terrain elevation not surfaced');
      if(!(await preview.locator('#cneHitInfo').innerText()).includes('altitude DEM'))
        throw new Error(device.name+': point-specific terrain-aware forecast not used');
      await preview.locator('#cneLayer').selectOption('depth');
      if(await preview.locator('#cneChartPlot path').count()===0)
        throw new Error(device.name+': timeline does not update for the selected point');
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
