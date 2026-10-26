import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const weatherMock=`
export async function getForecast(place){
 const hourly=[];
 const start=new Date('2026-10-26T12:00:00Z').getTime();
 for(let i=0;i<48;i++){
  const time=new Date(start+i*3600000).toISOString().slice(0,16);
  hourly.push({time,temperature_2m:10+i%6,weather_code:i%3?3:2,
   wind_speed_10m:10,wind_gusts_10m:18,relative_humidity_2m:64,
   precipitation:i%4?.2:0,precipitation_probability:i%4?35:10,
   snowfall:place.elevation>=650?.5:0,snowLevel:2150});
 }
 return {current:{time:'2026-10-26T12:00',temperature_2m:10,apparent_temperature:7,
  is_day:1,weather_code:3,wind_speed_10m:10,relative_humidity_2m:64,precipitation:0},hourly};
}
export async function geocode(term){
 if(String(term).toLowerCase().includes('meiller'))return [{name:'Le Meiller',lat:45.5,lon:6.5,elevation:1150,
  admin1:'Auvergne-Rhône-Alpes',department:'Savoie',postcode:'73260',country:'France'}];
 return [{name:'Oullins',lat:45.714,lon:4.807,elevation:180,
  admin1:'Auvergne-Rhône-Alpes',department:'Rhône',postcode:'69600',country:'France'}];
}
export async function reverseGeocodeApprox(lat,lon){
 return {name:'Oullins',lat,lon,admin1:'Auvergne-Rhône-Alpes',department:'Rhône',postcode:'69600',country:'France',elevation:180};
}`;
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(pathname==='/js/weather.js'){
  res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(weatherMock);return;
 }
 const dest=path.resolve(root,'.'+pathname);
 if(dest!==root&&!dest.startsWith(root+path.sep)){res.writeHead(403);res.end();return}
 try{
  const body=await fs.readFile(dest);
  res.writeHead(200,{'Content-Type':types[path.extname(dest)]||'application/octet-stream'});
  res.end(body);
 }catch{res.writeHead(404);res.end('Not found')}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();
let browser;
try{
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:412,height:540},deviceScaleFactor:1});
 await context.addInitScript(()=>{
  localStorage.setItem('myweather:widget-location-mode','manual');
  window.myWeatherDesktop={
   getLocation:async()=>({ok:true,lat:45.714,lon:4.807}),
   openWebsite:()=>{}
  };
 });
 const page=await context.newPage();
 const failures=[];
 page.on('pageerror',error=>failures.push(error.message));
 await page.goto('http://127.0.0.1:'+address.port+'/widget.html',{waitUntil:'networkidle'});
 await page.locator('#temp').getByText('10°').waitFor();
 assert.equal(await page.locator('#place').textContent(),'Oullins');
 assert.equal(await page.locator('#mountain').isVisible(),false);

 await page.locator('#place-button').click();
 await page.locator('#search').fill('Le Meiller');
 const result=page.locator('.result-item');
 await result.first().waitFor();
 assert.match(await result.first().innerText(),/Savoie \(73\)/);
 await result.first().click();
 await page.locator('#mountain').waitFor({state:'visible'});
 assert.equal(await page.locator('#snowline').textContent(),'2 150 m');
 assert.equal(await page.locator('#place').textContent(),'Le Meiller');
 await page.screenshot({path:path.join(here,'widget-ui-preview.png')});

 const overlap=await page.evaluate(()=>{
  const measure=selector=>document.querySelector(selector).getBoundingClientRect();
  const location=measure('.location-button'),weather=measure('.current');
  const snow=measure('#mountain'),hours=measure('.hourly-section');
  const footer=measure('.widget-footer');
  const content=measure('.widget-content');
  return {noHorizontalOverflow:document.querySelector('.widget').scrollWidth<=document.querySelector('.widget').clientWidth+2,
   locationNotOverlapped:location.bottom<=weather.top+2,
   snowNotOverlapped:snow.bottom<=hours.top+2,
   footerWithinScreen:footer.bottom<=innerHeight+1,
   hoursAreScrollable:document.querySelector('#hours').scrollWidth>document.querySelector('#hours').clientWidth,
   visibleContent:content.height>200
  };
 });
 for(const [key,value] of Object.entries(overlap))assert.equal(value,true,key);

 await page.locator('#hours-next').click();
 await page.waitForTimeout(550);
 const scroll=await page.locator('#hours').evaluate(el=>el.scrollLeft);
 assert.ok(scroll>90,'Next hour button must horizontally scroll forecast');
 await page.locator('.hour').nth(6).click();
 assert.equal(await page.locator('#hour-detail').isVisible(),true);
 assert.match(await page.locator('#hour-detail').innerText(),/LPN/);
 await page.locator('#settings').click();
 await page.locator('#search').fill('Oullins');
 await page.locator('.result-item').first().waitFor();
 assert.match(await page.locator('.result-item').first().innerText(),/Rhône \(69\)/);
 await page.locator('#locate').click();
 await page.locator('#picker').waitFor({state:'hidden'});
 assert.equal(await page.locator('#place').textContent(),'Oullins');
 assert.equal(await page.evaluate(()=>localStorage.getItem('myweather:widget-location-mode')),'auto');
 assert.deepEqual(failures,[]);
 console.log('Widget desktop: location, Savoie/Rhône department labels, LPN, non-overlap, scroll, hour detail and GPS passed.');
}finally{
 await browser?.close();
 await new Promise(resolve=>server.close(resolve));
}
