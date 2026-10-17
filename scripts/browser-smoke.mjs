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
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
