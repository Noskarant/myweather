// Explorateur spatial : points échantillonnés, jamais une mesure exhaustive du terrain.
import { estimateEffectiveSunshineSeconds } from './weather.js?v=1.8.24';
const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const R = 6371;
const finite = x => x === null || x === undefined || x === '' ? null : (Number.isFinite(Number(x)) ? Number(x) : null);
export function distanceKm(a,b) {
  const dlat=(b.lat-a.lat)*Math.PI/180, dlon=(b.lon-a.lon)*Math.PI/180;
  const h=Math.sin(dlat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dlon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
}
export function generateCandidates(origin,radius,favorites=[]) {
  if(!Number.isFinite(Number(origin?.lat)) || !Number.isFinite(Number(origin?.lon))) return [];
  const result=[{lat:Number(origin.lat),lon:Number(origin.lon),name:origin.name||'Point de départ'}];
  const steps=[.025,.10,.27,.50,.75,1];
  for(const portion of steps) {
    const d=Math.max(0.5,radius*portion);
    const count=portion<=.10?12:16;
    for(let j=0;j<count;j++) {
      const bearing=(j+.5*(steps.indexOf(portion)%2))*2*Math.PI/count;
      const lat=origin.lat+Math.cos(bearing)*d/111.195;
      const cosLat=Math.max(.15,Math.cos(origin.lat*Math.PI/180));
      const lon=origin.lon+Math.sin(bearing)*d/(111.195*cosLat);
      if(lat<=-89 || lat>=89) continue;
      result.push({lat,lon,name:null});
    }
  }
  for(const p of favorites.slice(0,30)) {
    if(!Number.isFinite(Number(p?.lat)) || !Number.isFinite(Number(p?.lon))) continue;
    if(distanceKm(origin,p)<=radius) result.push({lat:Number(p.lat),lon:Number(p.lon),name:p.name||null});
  }
  const seen=new Set();
  return result.filter(p=>{const key=p.lat.toFixed(3)+','+p.lon.toFixed(3);if(seen.has(key))return false;seen.add(key);return true;});
}
function nearHourIndex(hours,now) {
  if(!hours.length)return 0;
  let i=hours.findIndex(h=>h>now);
  return Math.max(0,(i<0?hours.length:i)-1);
}
export function evaluateCandidate(point,forecast,period='today') {
  const hours=forecast?.hourly?.time||[];
  if(!hours.length)return null;
  const currentTime=forecast?.current?.time || hours[0];
  const idx=nearHourIndex(hours,currentTime);
  const today=(forecast?.daily?.time||[])[0] || currentTime.slice(0,10);
  const tomorrow=(forecast?.daily?.time||[])[1] || '';
  const selected=period==='tomorrow'?tomorrow:today;
  const timeWindow=hours.map((time,i)=>({time,i})).filter(h=>
    period==='48h' ? h.time>=currentTime && h.time<new Date(new Date(currentTime+'Z').getTime()+48*3600000).toISOString().slice(0,16)
      : h.time.slice(0,10)===selected
  );
  const snowDepth=finite(forecast.hourly.snow_depth?.[idx]);
  const snowCm=snowDepth==null?null:Math.max(0,snowDepth*100);
  const snowfallCm=timeWindow.reduce((sum,h)=>sum+Math.max(0,finite(forecast.hourly.snowfall?.[h.i])||0),0);
  const sunshineKnown=timeWindow.some(h=>finite(forecast.hourly.sunshine_duration?.[h.i])!=null);
  const rawSunshineSeconds=timeWindow.reduce((sum,h)=>{
    const raw=finite(forecast.hourly.sunshine_duration?.[h.i]);
    return sum+(raw==null?0:Math.max(0,Math.min(3600,raw)));
  },0);
  const dates=[...new Set(timeWindow.map(h=>h.time.slice(0,10)))];
  const correctedSunshine=dates.map(date=>{
    const dayIndex=forecast.daily?.time?.indexOf(date)??-1;
    const day={time:date,sunrise:forecast.daily?.sunrise?.[dayIndex],
      sunset:forecast.daily?.sunset?.[dayIndex],sunshineDuration:forecast.daily?.sunshine_duration?.[dayIndex]};
    const dayHours=timeWindow.filter(h=>h.time.startsWith(date)).map(h=>({
      time:h.time,sunshine_duration:forecast.hourly.sunshine_duration?.[h.i],
      cloud_cover:forecast.hourly.cloud_cover?.[h.i],
      cloud_cover_low:forecast.hourly.cloud_cover_low?.[h.i],
      cloud_cover_mid:forecast.hourly.cloud_cover_mid?.[h.i],
      cloud_cover_high:forecast.hourly.cloud_cover_high?.[h.i],
      precipitation:forecast.hourly.precipitation?.[h.i],
      weather_code:forecast.hourly.weather_code?.[h.i]
    }));
    return estimateEffectiveSunshineSeconds(day,dayHours);
  });
  const sunshineSeconds=correctedSunshine.length&&correctedSunshine.every(x=>x!=null)
    ?correctedSunshine.reduce((sum,n)=>sum+n,0):rawSunshineSeconds;
  const cloud=timeWindow.reduce((sum,h)=>sum+(finite(forecast.hourly.cloud_cover?.[h.i])??0),0);
  const coverage=timeWindow.filter(h=>finite(forecast.hourly.cloud_cover?.[h.i])!=null).length;
  const alt=finite(forecast.elevation);
  return {...point, altitude:alt, snowCm, snowfallCm, sunHours:sunshineKnown?sunshineSeconds/3600:null,
    cloudAvg:coverage?cloud/coverage:null, temperature:finite(forecast.current?.temperature_2m),
    observedAt:currentTime, distance:null, sampledHours:timeWindow.length};
}
export function rankCandidates(origin,points) {
  const valid=points.filter(Boolean).map(p=>({...p,distance:distanceKm(origin,p)}));
  const snowy=valid.filter(p=>p.snowCm!=null&&p.snowCm>=1).sort((a,b)=>a.distance-b.distance);
  const futureSnow=valid.filter(p=>p.snowfallCm>=.2).sort((a,b)=>a.distance-b.distance);
  const sunny=valid.filter(p=>p.sunHours!=null&&p.sampledHours>0)
    .sort((a,b)=>b.sunHours-a.sunHours || a.distance-b.distance);
  return {points:valid,snow:snowy[0]||null,forecastSnow:futureSnow[0]||null,sun:sunny[0]||null};
}
const displayNum=(n,d=0)=>n==null?'—':n.toLocaleString('fr-FR',{maximumFractionDigits:d,minimumFractionDigits:d});
const detailName=p=>p.name || ('Point '+p.lat.toFixed(3)+'°, '+p.lon.toFixed(3)+'°');
const safeStorage=(key,fallback)=>{try{return localStorage.getItem(key)||fallback}catch{return fallback}};
const saveStorage=(key,value)=>{try{localStorage.setItem(key,value)}catch{}};

export function createDiscoveryController({getContext,onOpenLocation,escapeHtml,showToast}) {
  const $=s=>document.querySelector(s);
  const view=$('#exploreView'),radius=$('#discoverRadius'),period=$('#discoverPeriod'),source=$('#discoverOrigin');
  const run=$('#discoverRun'),status=$('#discoverStatus'),results=$('#discoverResults'),mapEl=$('#discoverMap');
  if(!view||!radius||!period||!source||!run||!results)return {show(){},refresh(){}};
  radius.value=safeStorage('myweather:explore-radius','100');
  period.value=safeStorage('myweather:explore-period','today');
  let gps=null,originType='selected',token=0,lastSearch='',map=null,markers=null,cache=new Map();
  const esc=v=>escapeHtml(String(v??''));
  const originalButton=run.textContent;
  const locate=()=>originType==='gps'&&gps?gps:getContext().location;
  function updateOrigin(){
    const p=locate();
    source.textContent=(originType==='gps'?'GPS · ':'Lieu sélectionné · ')+(p?.name||'Inconnu');
    $('#discoverUseSelected')?.classList.toggle('active',originType==='selected');
    $('#discoverUseGps')?.classList.toggle('active',originType==='gps');
  }
  function viewPlace(p) {
    return {name:detailName(p),lat:p.lat,lon:p.lon,elevation:p.altitude,timezone:'auto',type:'Point exploré'};
  }
  function resultCard(p,kind){
    if(!p) return '<div class="discovery-empty">Aucun point confirmé dans les échantillons. Élargis le rayon ou réessaie.</div>';
    const isSnow=kind==='snow',isFuture=kind==='future';
    const figure=isSnow?displayNum(p.snowCm,1)+' cm':isFuture?displayNum(p.snowfallCm,1)+' cm':displayNum(p.sunHours,1)+' h';
    const expl=isSnow?'Neige au sol prévue / modélisée':isFuture?'Neige fraîche prévue sur la période':'Durée d’ensoleillement modélisée';
    return '<article class="discovery-result glass"><div class="discovery-result-top"><span class="discovery-symbol">'+(isSnow||isFuture?'❄':'☀')+'</span><div><small>'+esc(expl)+'</small><strong>'+esc(figure)+'</strong></div></div>'+
      '<h3>'+esc(detailName(p))+'</h3><p>'+displayNum(p.distance,1)+' km à vol d’oiseau · '+(p.altitude==null?'altitude inconnue':Math.round(p.altitude)+' m d’altitude')+'</p>'+
      '<div class="discovery-facts"><span>Temp. '+(p.temperature==null?'—':displayNum(p.temperature,1)+' °C')+'</span>'+
      (isSnow?' <span>Neige prévue '+displayNum(p.snowfallCm,1)+' cm</span>':isFuture?' <span>Au sol '+(p.snowCm==null?'—':displayNum(p.snowCm,1)+' cm')+'</span>':' <span>Nuages '+(p.cloudAvg==null?'—':displayNum(p.cloudAvg)+' %')+'</span>')+'</div>'+
      '<button class="discovery-open" type="button" data-open-point="'+esc(kind)+'">Voir les prévisions de ce point ↗</button></article>';
  }
  function showMap(origin,ranks) {
    if(!mapEl || !window.L)return;
    const L=window.L;
    try{
      if(!map){
        map=L.map(mapEl,{scrollWheelZoom:false});
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
        markers=L.layerGroup().addTo(map);
      }
      markers.clearLayers();
      const positions=[[origin.lat,origin.lon]];
      L.circleMarker([origin.lat,origin.lon],{radius:7,color:'#d6f2ff',fillColor:'#168ac4',fillOpacity:1,weight:2}).addTo(markers).bindPopup('Point de départ');
      const unique=new Set();
      for(const [kind,p] of [['Neige au sol',ranks.snow],['Neige annoncée',ranks.forecastSnow],['Soleil',ranks.sun]]){
        if(!p)continue;
        const key=p.lat.toFixed(4)+','+p.lon.toFixed(4);
        if(unique.has(key))continue;
        unique.add(key);
        positions.push([p.lat,p.lon]);
        L.circleMarker([p.lat,p.lon],{radius:9,color:'#fff',fillColor:kind==='Soleil'?'#ffc760':'#6ac5f4',fillOpacity:.96,weight:2})
          .addTo(markers).bindPopup(esc(kind)+' · '+esc(detailName(p)));
      }
      map.invalidateSize();
      if(positions.length>1)map.fitBounds(positions,{padding:[35,35],maxZoom:11});
      else map.setView(positions[0],9);
    }catch(err){console.warn('Carte exploration indisponible',err);}
  }
  async function fetchPoints(candidates) {
    const tasks=[];
    for(let i=0;i<candidates.length;i+=15)tasks.push(candidates.slice(i,i+15));
    const responses=await Promise.allSettled(tasks.map(async group=>{
      const q=new URLSearchParams({
        latitude:group.map(p=>p.lat.toFixed(5)).join(','),longitude:group.map(p=>p.lon.toFixed(5)).join(','),
        current:'temperature_2m',hourly:'snow_depth,snowfall,sunshine_duration,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation,weather_code',
        daily:'sunrise,sunset,sunshine_duration',timezone:'auto',forecast_days:'3',wind_speed_unit:'kmh'
      });
      const response=await fetch(BASE_URL+'?'+q.toString(),{signal:AbortSignal.timeout(14000)});
      if(!response.ok)throw Error('Météo indisponible ('+response.status+')');
      const payload=await response.json(),list=Array.isArray(payload)?payload:[payload];
      if(list.length!==group.length)throw Error('Réponse météo incomplète');
      return list.map((data,j)=>evaluateCandidate(group[j],data,period.value));
    }));
    const values=responses.filter(x=>x.status==='fulfilled').flatMap(x=>x.value).filter(Boolean);
    return {values,failed:responses.filter(x=>x.status==='rejected').length};
  }
  async function search(){
    const origin=locate();
    if(!origin||!Number.isFinite(Number(origin.lat))||!Number.isFinite(Number(origin.lon))){
      status.textContent='Choisis un lieu ou autorise le GPS avant la recherche.';return;
    }
    const searchToken=++token;
    const rad=Math.max(25,Math.min(200,Number(radius.value)||100));
    saveStorage('myweather:explore-radius',String(rad));
    saveStorage('myweather:explore-period',period.value);
    const key=[origin.lat.toFixed(3),origin.lon.toFixed(3),rad,period.value].join(':');
    run.disabled=true;run.textContent='Analyse en cours…';
    status.textContent='Comparaison des prévisions sur un maillage géographique…';
    results.innerHTML='';
    try{
      let collected=cache.get(key);
      if(!collected||Date.now()-collected.at>8*60000){
        const candidates=generateCandidates(origin,rad,getContext().favorites||[]);
        const fetched=await fetchPoints(candidates);
        collected={...fetched,at:Date.now(),candidateCount:candidates.length};
        if(fetched.values.length)cache.set(key,collected);
      }
      if(searchToken!==token)return;
      if(!collected.values.length)throw Error('Aucune prévision exploitable reçue.');
      const rank=rankCandidates(origin,collected.values);
      const note=collected.failed?' · '+collected.failed+' lot(s) de prévisions indisponibles':'';
      status.textContent=rank.points.length+' points analysés sur '+collected.candidateCount+' · rayon '+rad+' km'+note;
      const snowfallOnly=!rank.snow && !!rank.forecastSnow;
      results.innerHTML='<div class="discovery-result-grid"><section><div class="discovery-result-label">❄ NEIGE AU SOL · AU PLUS PROCHE</div>'+
        resultCard(rank.snow||rank.forecastSnow,rank.snow?'snow':'future')+
        (snowfallOnly?'<p class="discovery-method">Aucun manteau neigeux confirmé dans les points sondés : ce résultat concerne une chute prévue, pas la neige déjà présente.</p>':'')+
        '</section><section><div class="discovery-result-label">☀ ENSOLEILLEMENT · MAXIMUM</div>'+
        resultCard(rank.sun,'sun')+'</section></div>'+
        '<p class="discovery-method">Comparaison indicative de points échantillonnés, non recherche exhaustive du point absolu le plus proche. Distances à vol d’oiseau. Neige au sol et soleil : estimations de modèle, non observations sur place.</p>';
      results.querySelectorAll('[data-open-point]').forEach(btn=>btn.addEventListener('click',()=>{
        const kind=btn.dataset.openPoint,p=kind==='snow'?rank.snow:kind==='future'?rank.forecastSnow:rank.sun;
        if(p)onOpenLocation(viewPlace(p));
      }));
      showMap(origin,rank);
    }catch(err) {
      if(searchToken!==token)return;
      status.textContent='Recherche indisponible.';
      results.innerHTML='<p class="discovery-method">Impossible d’obtenir les prévisions : '+esc(err.message||'Erreur réseau')+'. La météo principale reste utilisable.</p>';
    }finally{if(searchToken===token){run.disabled=false;run.textContent=originalButton;}}
  }
  $('#discoverUseSelected')?.addEventListener('click',()=>{originType='selected';token++;updateOrigin();});
  $('#discoverUseGps')?.addEventListener('click',()=>{
    if(!navigator.geolocation){showToast('Géolocalisation indisponible.','warn');return;}
    status.textContent='Demande de géolocalisation…';
    navigator.geolocation.getCurrentPosition(pos=>{
      gps={lat:pos.coords.latitude,lon:pos.coords.longitude,name:'Ma position GPS'};
      originType='gps';token++;updateOrigin();status.textContent='Position GPS prête. Lance la recherche.';
    },()=>{status.textContent='Accès GPS refusé ou indisponible. Le lieu sélectionné reste accessible.';},
    {timeout:10000,maximumAge:300000,enableHighAccuracy:false});
  });
  radius.addEventListener('change',()=>{token++;});
  period.addEventListener('change',()=>{token++;});
  run.addEventListener('click',search);
  updateOrigin();
  return {show(){updateOrigin();if(map)setTimeout(()=>map.invalidateSize(),30);},
    refresh(){updateOrigin();if(originType==='selected')lastSearch='';},
    destroy(){token++;map?.remove();map=null;}};
}
