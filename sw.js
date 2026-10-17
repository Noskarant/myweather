const CACHE = 'myweather-v1.8.24';
const ASSETS = ['./','./index.html','./styles.css','./js/app.js','./js/hourly-navigation.js','./js/weather.js','./js/weather-nowcast.js','./js/radar-nowcast.js','./js/snowfusion.js','./js/rhone-observations.js','./js/coastal-vendee.js','./data/rhone-observations.json','./data/savoie-observations.json','./data/quebec-observations.json','./data/ile-de-france-observations.json','./data/vendee-observations.json','./data/reunion-observations.json','./js/custom-places.js','./data/custom-places.json','./js/route.js','./js/utils.js','./assets/favicon.svg','./manifest.webmanifest'];
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache=await caches.open(CACHE);
  // Optional observation snapshots must never make the whole PWA install fail.
  await Promise.allSettled(ASSETS.map(asset=>cache.add(asset)));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('myweather-')&&k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim())
));
self.addEventListener('fetch', event => {
  if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
  event.respondWith((async()=>{
    const cached=()=>caches.match(event.request,{ignoreSearch:true});
    try{
      const response=await fetch(event.request,{cache:'no-store',signal:AbortSignal.timeout(6000)});
      if(!response.ok){
        const backup=await cached();
        return backup||response;
      }
      const path=new URL(event.request.url).pathname;
      const type=response.headers.get('content-type')||'';
      const valid=path.endsWith('.js') ? /javascript|ecmascript/.test(type) :
        path.endsWith('.json') ? /json/.test(type) : true;
      if(!valid)return (await cached())||Response.error();
      const copy=response.clone();
      event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{}));
      return response;
    }catch{
      return (await cached()) || (event.request.mode==='navigate'
        ? (await caches.match('./index.html'))||Response.error()
        : Response.error());
    }
  })());
});
