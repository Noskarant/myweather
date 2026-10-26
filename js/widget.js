import {getForecast,geocode} from './weather.js';
import {weatherCodeInfo} from './utils.js';
const DEFAULT={name:'Oullins',admin1:'Auvergne-Rhône-Alpes',country:'France',lat:45.714,lon:4.807,elevation:180,timezone:'Europe/Paris'};
const el=id=>document.getElementById(id);
const num=v=>v==null||!Number.isFinite(Number(v))?null:Number(v);
const fmt=v=>num(v)==null?'—':String(Math.round(Number(v)));
const valid=p=>p&&typeof p.name==='string'&&p.name.length<180&&num(p.lat)!=null&&num(p.lon)!=null&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180;
const read=(key,otherwise)=>{try{return JSON.parse(localStorage.getItem(key))??otherwise}catch{return otherwise}};
let place=read('myweather:widget-location',DEFAULT);
if(!valid(place))place=DEFAULT;
let saved=read('myweather:widget-places',[]);
saved=Array.isArray(saved)?saved.filter(valid).slice(0,8):[];
let data=null,fetching=false,nextRefresh=0,generation=0;
function picker(){
 const select=el('recent');select.replaceChildren();
 const places=[...saved];if(!places.some(p=>Math.abs(p.lat-DEFAULT.lat)<.001))places.push(DEFAULT);
 for(const p of places){const o=document.createElement('option');o.value=JSON.stringify(p);o.textContent=p.name+(p.admin1?' · '+p.admin1:'');select.append(o)}
 const active=places.find(p=>Math.abs(p.lat-place.lat)<.0001&&Math.abs(p.lon-place.lon)<.0001);
 if(active)select.value=JSON.stringify(active);
}
function setPlace(p){
 if(!valid(p))return;
 place={name:p.name,admin1:p.admin1||'',country:p.country||'',lat:Number(p.lat),lon:Number(p.lon),elevation:num(p.elevation),timezone:p.timezone||'auto'};
 saved=[place,...saved.filter(x=>Math.abs(x.lat-place.lat)>.0001||Math.abs(x.lon-place.lon)>.0001)].slice(0,8);
 localStorage.setItem('myweather:widget-location',JSON.stringify(place));
 localStorage.setItem('myweather:widget-places',JSON.stringify(saved));
 el('picker').hidden=true;el('place').textContent=place.name;el('condition').textContent='Chargement…';el('temp').textContent='--°';
 data=null;generation++;picker();void refresh();
}
function nextHours(fc){
 const hours=fc.hourly||[];if(!hours.length)return [];
 const now=String(fc.current?.time||'');
 let i=hours.findIndex(h=>String(h.time).slice(0,13)===now.slice(0,13));
 if(i<0)i=hours.findIndex(h=>String(h.time)>=now);
 return hours.slice(Math.max(i,0),Math.max(i,0)+5);
}
function display(fc){
 const current=fc.current||{},hours=nextHours(fc),hour=hours[0]||{};
 const info=weatherCodeInfo(current.weather_code??hour.weather_code,current.is_day??1);
 el('place').textContent=place.name;
 el('altitude').textContent=place.elevation!=null?Math.round(place.elevation)+' m':'';
 el('temp').textContent=fmt(current.temperature_2m??hour.temperature_2m)+'°';
 el('condition').textContent=info.label;el('glyph').textContent=info.glyph;
 el('feels').textContent='Ressenti '+fmt(current.apparent_temperature??hour.apparent_temperature)+' °C';
 el('metrics').replaceChildren();
 const precip=num(current.precipitation??hour.precipitation);
 for(const label of ['Vent '+fmt(current.wind_speed_10m??hour.wind_speed_10m)+' km/h','Pluie '+(precip===null?'—':precip.toFixed(1).replace('.',','))+' mm','Humidité '+fmt(current.relative_humidity_2m??hour.relative_humidity_2m)+' %']){
   const span=document.createElement('span');span.textContent=label;el('metrics').append(span);
 }
 const mount=el('mountain');mount.hidden=place.elevation==null||place.elevation<800;
 if(!mount.hidden){
   const line=num(hour.snowLevel);
   const snow=hours.reduce((s,h)=>s+Math.max(0,num(h.snowfall)??0),0);
   mount.textContent='LPN '+(line==null?'—':Math.round(line)+' m')+' · Neige sur 5 h : '+snow.toFixed(1).replace('.',',')+' cm';
 }
 el('hours').replaceChildren();
 for(const h of hours){
   const col=document.createElement('div');col.className='hour';
   const values=[['hour-time',String(h.time||'').slice(11,16)],['hour-icon',weatherCodeInfo(h.display_weather_code??h.weather_code,1).glyph],['hour-temp',fmt(h.temperature_2m)+'°']];
   for(const [cls,val] of values){const span=document.createElement('span');span.className=cls;span.textContent=val;col.append(span)}
   el('hours').append(col);
 }
 el('status').textContent='Prévisions MyWeather';
 el('updated').textContent='Actualisé à '+new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(new Date());
}
async function refresh(){
 if(fetching)return;
 fetching=true;const request=generation;
 el('status').textContent='Mise à jour…';
 try{
   const forecast=await getForecast(place);
   if(request!==generation)return;
   if(!forecast?.current)throw Error('Données incomplètes');
   data=forecast;display(data);nextRefresh=Date.now()+15*60_000;
 }catch(error){
   if(request!==generation)return;
   el('status').textContent=data?'Données anciennes · hors ligne':'Connexion indisponible';
   if(!data){el('condition').textContent='Connexion indisponible';el('updated').textContent='Réessai automatique'}
   nextRefresh=Date.now()+60_000;console.warn('MyWeather widget',error);
 }finally{fetching=false;if(request!==generation)queueMicrotask(()=>void refresh())}
}
el('settings').addEventListener('click',()=>{picker();el('picker').hidden=false});
el('close-picker').addEventListener('click',()=>el('picker').hidden=true);
el('refresh').addEventListener('click',()=>{nextRefresh=0;void refresh()});
el('open').addEventListener('click',()=>window.myWeatherDesktop?.openWebsite());
el('recent').addEventListener('change',e=>{try{setPlace(JSON.parse(e.target.value))}catch{}});
let seq=0;
async function search(){
 const term=el('search').value.trim();if(term.length<2)return;
 const id=++seq;el('results').textContent='Recherche…';
 try{
   const matches=await geocode(term,6);if(id!==seq)return;
   el('results').replaceChildren();
   if(!matches.length){el('results').textContent='Aucun lieu trouvé';return}
   for(const p of matches.filter(valid)){
     const b=document.createElement('button');b.textContent=p.name+' · '+(p.admin1||p.country||'');
     b.addEventListener('click',()=>setPlace(p));el('results').append(b);
   }
 }catch(error){if(id===seq)el('results').textContent='Recherche indisponible';console.warn(error)}
}
el('search-btn').addEventListener('click',()=>void search());
el('search').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();void search()}});
picker();void refresh();
setInterval(()=>{if(!fetching&&Date.now()>=nextRefresh)void refresh()},60_000);
