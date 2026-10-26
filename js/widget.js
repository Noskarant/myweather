import {getForecast,geocode,reverseGeocodeApprox} from './weather.js';
import {weatherCodeInfo} from './utils.js';
import {
 DEFAULT_WIDGET_PLACE,finite,rounded,isValidPlace,normalizePlace,
 locationLabel,placeSuggestion,chooseHours,shouldShowMountain,futureSnowSum,
 parseDepartmentCode,mergeUniquePlaces
} from './widget-model.js';

const $=id=>document.getElementById(id);
const KEY_LOCATION='myweather:widget-location';
const KEY_PLACES='myweather:widget-places';
const KEY_LOCATION_MODE='myweather:widget-location-mode';
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}};
const safeWrite=(key,data)=>{try{localStorage.setItem(key,JSON.stringify(data))}catch(error){console.warn('Widget storage',error)}};
const richPlace=p=>normalizePlace({...p,departmentCode:parseDepartmentCode(p)});
const fallback=richPlace(DEFAULT_WIDGET_PLACE);
let place=richPlace(read(KEY_LOCATION,null))||fallback;
let places=mergeUniquePlaces(read(KEY_PLACES,[])).map(richPlace).filter(Boolean).slice(0,12);
let locationMode=localStorage.getItem(KEY_LOCATION_MODE)||'auto'; // Existing installations become location-aware.
let forecast=null,refreshToken=0,lastRefresh=0,nextRefresh=0,fetchPending=false;
let selectedTime=null,lookupToken=0,lookupTimer=0,currentResults=[];
let locating=false,placeEpoch=0;
const fmt=(x,unit='')=>finite(x)===null?'—':rounded(x)+unit;
const decimal=(x,unit='')=>finite(x)===null?'—':Number(x).toFixed(1).replace('.',',')+unit;
function inform(text){$('status').textContent=text}
function refreshPlaceHeader(){
 $('place').textContent=place.name;
 $('place-meta').textContent=locationLabel(place)||place.country||'Position météo';
 const alt=finite(place.elevation);
 $('altitude').hidden=alt===null;
 if(alt!==null)$('altitude').textContent=Math.round(alt)+' m';
 $('place-button').title='Changer de lieu · '+place.name+(locationLabel(place)?', '+locationLabel(place):'');
}
function savePlace(candidate,mode='manual'){
 const normalized=richPlace(candidate);
 if(!normalized)return;
 place=normalized;
 placeEpoch++;
 locationMode=mode;
 safeWrite(KEY_LOCATION,place);
 localStorage.setItem(KEY_LOCATION_MODE,mode);
 places=mergeUniquePlaces([place,...places]).slice(0,12);
 safeWrite(KEY_PLACES,places);
 $('picker').hidden=true;
 selectedTime=null;forecast=null;
 refreshToken++;
 refreshPlaceHeader();
 $('temp').textContent='--°';
 $('condition').textContent='Chargement de la météo…';
 $('hour-detail').hidden=true;
 $('mountain').hidden=true;
 $('hours').replaceChildren();
 inform('Actualisation…');
 void refresh();
}
function renderPlaces(){
 const list=$('recent-list');
 list.replaceChildren();
 const items=mergeUniquePlaces([place,...places,fallback]).slice(0,9);
 items.forEach(candidate=>{
  const p=richPlace(candidate);
  const b=document.createElement('button');
  b.type='button';b.className='recent-item';
  const icon=document.createElement('span');icon.className='result-symbol';icon.textContent='⌖';
  const copy=document.createElement('span');copy.className='result-copy';
  const title=document.createElement('strong');title.textContent=p.name;
  const sub=document.createElement('small');sub.textContent=locationLabel(p)||p.country;
  copy.append(title,sub);b.append(icon,copy);
  b.addEventListener('click',()=>savePlace(p,'manual'));
  list.append(b);
 });
}
function setPicker(open){
 $('picker').hidden=!open;
 if(open){
  renderPlaces();
  $('geo-status').textContent=locating?'Recherche de votre position…':locationMode==='auto'?'Localisation automatique activée':'Autorisation de Windows requise';
  if($('search').value.trim().length>=2)void lookup();
 }
}
function renderMetrics(current,hour){
 const entries=[
  ['Vent',fmt(current.wind_speed_10m??hour.wind_speed_10m,' km/h')],
  ['Pluie',decimal(current.precipitation??hour.precipitation,' mm')],
  ['Humidité',fmt(current.relative_humidity_2m??hour.relative_humidity_2m,' %')]
 ];
 const container=$('metrics');container.replaceChildren();
 for(const [label,value] of entries){
  const item=document.createElement('div');item.className='metric';
  const name=document.createElement('span');name.textContent=label;
  const number=document.createElement('strong');number.textContent=value;
  item.append(name,number);container.append(item);
 }
}
function renderMountain(hours){
 const hour=hours[0]||{};
 const visible=shouldShowMountain(place,hour);
 $('mountain').hidden=!visible;
 if(!visible)return;
 const lpn=finite(hour.snowLevel);
 $('snowline').textContent=lpn===null?'Indisponible':Math.round(lpn).toLocaleString('fr-FR')+' m';
 $('snowline').title=lpn===null?'Limite pluie-neige non estimée':'Estimation du moteur MyWeather, non une mesure';
 $('snow-amount').textContent=decimal(futureSnowSum(hours,24),' cm');
}
function renderHourDetail(hour){
 const panel=$('hour-detail');
 panel.replaceChildren();panel.hidden=!hour;
 if(!hour)return;
 const values=[
  ['Pluie',decimal(hour.precipitation,' mm')],
  ['Risque pluie',fmt(hour.precipitation_probability,' %')],
  ['Vent',fmt(hour.wind_speed_10m,' km/h')],
  ['Rafales',fmt(hour.wind_gusts_10m,' km/h')],
  ['Neige',decimal(hour.snowfall,' cm')],
  ['LPN',fmt(hour.snowLevel,' m')]
 ];
 for(const [key,val] of values){
  const box=document.createElement('span');
  const label=document.createElement('span');label.textContent=key+' ';
  const value=document.createElement('strong');value.textContent=val;
  box.append(label,value);panel.append(box);
 }
}
function renderHours(hours){
 const rail=$('hours');
 const oldScroll=rail.scrollLeft;
 const items=hours.slice(0,36);
 if(!selectedTime||!items.some(h=>h.time===selectedTime))selectedTime=items[0]?.time||null;
 rail.replaceChildren();
 items.forEach((h,i)=>{
  const day=String(h.time||'').slice(8,10),time=String(h.time||'').slice(11,16);
  const prevDay=i?String(items[i-1].time||'').slice(8,10):day;
  const shownTime=i===0?'Maint.':day!==prevDay?day+'/'+String(h.time||'').slice(5,7):time;
  const b=document.createElement('button');b.type='button';b.className='hour'+(h.time===selectedTime?' selected':'');
  b.setAttribute('aria-pressed',String(h.time===selectedTime));
  b.title='Prévision du '+String(h.time||'').replace('T',' ')+' · détails';
  const glyph=weatherCodeInfo(h.display_weather_code??h.weather_code,1).glyph;
  for(const [cls,value] of [['hour-time',shownTime],['hour-icon',glyph],['hour-temp',fmt(h.temperature_2m,'°')]]){
   const span=document.createElement('span');span.className=cls;span.textContent=value;b.append(span);
  }
  b.addEventListener('click',()=>{
   selectedTime=h.time;
   rail.querySelectorAll('.hour').forEach(x=>{x.classList.remove('selected');x.setAttribute('aria-pressed','false')});
   b.classList.add('selected');b.setAttribute('aria-pressed','true');
   renderHourDetail(h);
  });
  rail.append(b);
 });
 rail.scrollLeft=oldScroll;
 renderHourDetail(items.find(h=>h.time===selectedTime)||null);
}
function display(){
 if(!forecast)return;
 const current=forecast.current||{},hours=chooseHours(forecast,36),first=hours[0]||{};
 const info=weatherCodeInfo(current.display_weather_code??current.weather_code??first.weather_code,current.is_day??1);
 refreshPlaceHeader();
 $('temp').textContent=fmt(current.temperature_2m??first.temperature_2m,'°');
 $('glyph').textContent=info.glyph;
 $('condition').textContent=info.label;
 $('feels').textContent='Ressenti '+fmt(current.apparent_temperature??first.apparent_temperature,' °C');
 renderMetrics(current,first);renderMountain(hours);renderHours(hours);
 inform('Prévisions MyWeather');
 $('updated').textContent='Màj '+new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(new Date(lastRefresh||Date.now()));
}
async function refresh(){
 const generation=++refreshToken;
 if(!forecast)inform('Connexion au moteur météo…');
 fetchPending=true;
 try{
  const result=await getForecast({...place});
  if(generation!==refreshToken)return;
  if(!result?.current)throw new Error('Prévision incomplète');
  forecast=result;lastRefresh=Date.now();nextRefresh=lastRefresh+15*60_000;
  display();
 }catch(error){
  if(generation!==refreshToken)return;
  inform(forecast?'Hors ligne · dernières données':'Connexion indisponible');
  if(!forecast){$('condition').textContent='Données indisponibles';$('updated').textContent='Nouvel essai automatique'}
  nextRefresh=Date.now()+75_000;
  console.warn('MyWeather forecast widget',error);
 }finally{if(generation===refreshToken)fetchPending=false}
}
function renderResults(items){
 const area=$('results');area.replaceChildren();
 if(!items.length){
  const p=document.createElement('p');p.className='search-message';p.textContent='Aucun lieu trouvé. Essaie un nom plus précis.';area.append(p);return;
 }
 for(const item of items){
  const p=richPlace(item);if(!p)continue;
  const {name,detail}=placeSuggestion(p);
  const button=document.createElement('button');button.type='button';button.className='result-item';button.setAttribute('role','option');
  const ico=document.createElement('span');ico.className='result-symbol';ico.textContent='⌖';
  const copy=document.createElement('span');copy.className='result-copy';
  const strong=document.createElement('strong');strong.textContent=name;
  const small=document.createElement('small');small.textContent=detail;
  copy.append(strong,small);button.append(ico,copy);
  button.addEventListener('click',()=>savePlace(p,'manual'));
  area.append(button);
 }
}
async function lookup(){
 const query=$('search').value.trim();const current=++lookupToken;
 if(query.length<2){$('results').replaceChildren();currentResults=[];return}
 $('results').textContent='Recherche des lieux…';
 try{
  const result=await geocode(query,12);
  if(current!==lookupToken||$('picker').hidden)return;
  currentResults=mergeUniquePlaces(result);
  renderResults(currentResults);
 }catch(error){
  if(current===lookupToken)$('results').textContent='Recherche indisponible. Réessaie.';
  console.warn('Recherche MyWeather',error);
 }
}
function findThroughBrowser(){
 return new Promise((resolve,reject)=>{
  if(!navigator.geolocation){reject(new Error('Géolocalisation non disponible'));return}
  navigator.geolocation.getCurrentPosition(
   pos=>resolve({lat:pos.coords.latitude,lon:pos.coords.longitude}),
   err=>reject(new Error(err.message||'Autorisation Windows refusée')),
   {enableHighAccuracy:false,timeout:8500,maximumAge:600000}
  );
 });
}
async function locate(){
 if(locating)return;
 locating=true;
 const status=$('geo-status');
 status.textContent='Localisation en cours…';
 const startingPlaceEpoch=placeEpoch;
 try{
  let coords=null;
  // Windows location provider is preferred. Browser geolocation remains a fallback.
  try{
   const x=await window.myWeatherDesktop?.getLocation?.();
   if(x?.ok&&Number.isFinite(x.lat)&&Number.isFinite(x.lon))coords=x;
  }catch(error){console.warn('Windows location',error)}
  if(!coords)coords=await findThroughBrowser();
  if(!Number.isFinite(coords?.lat)||!Number.isFinite(coords?.lon))throw new Error('Coordonnées indisponibles');
  // A manual location chosen during the async request must never be overwritten.
  if(placeEpoch!==startingPlaceEpoch)return;
  let found;
  try{found=await reverseGeocodeApprox(coords.lat,coords.lon)}catch{}
  const named=richPlace({...found,
   name:found?.name||'Ma position',lat:coords.lat,lon:coords.lon,
   department:found?.department||'',country:found?.country||'France'})||
   richPlace({name:'Ma position',lat:coords.lat,lon:coords.lon,country:'France'});
  if(named){
   savePlace(named,'auto');
   status.textContent='Position actuelle utilisée';
  }
 }catch(error){
  status.textContent='Localisation indisponible · Vérifie Windows > Confidentialité > Localisation';
  if(!forecast)inform('Position non disponible · lieu conservé');
  console.warn('Géolocalisation MyWeather',error);
 }finally{locating=false}
}
$('settings').addEventListener('click',()=>setPicker(true));
$('place-button').addEventListener('click',()=>setPicker(true));
$('close-picker').addEventListener('click',()=>setPicker(false));
$('refresh').addEventListener('click',()=>{nextRefresh=0;void refresh()});
$('open').addEventListener('click',()=>{if(window.myWeatherDesktop?.openWebsite)window.myWeatherDesktop.openWebsite()});
$('locate').addEventListener('click',()=>void locate());
$('search').addEventListener('input',()=>{
 clearTimeout(lookupTimer);
 lookupTimer=setTimeout(()=>void lookup(),330);
});
$('search').addEventListener('keydown',e=>{
 if(e.key==='Escape')setPicker(false);
 else if(e.key==='Enter'){
  e.preventDefault();if(currentResults.length===1)savePlace(currentResults[0],'manual');
 }
});
$('clear-search').addEventListener('click',()=>{$('search').value='';lookupToken++;$('results').replaceChildren();$('search').focus()});
$('hours-prev').addEventListener('click',()=>$('hours').scrollBy({left:-260,behavior:'smooth'}));
$('hours-next').addEventListener('click',()=>$('hours').scrollBy({left:260,behavior:'smooth'}));
$('hours').addEventListener('wheel',e=>{
 const rail=$('hours');
 if(rail.scrollWidth<=rail.clientWidth)return;
 const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;
 if(delta!==0){rail.scrollLeft+=delta;e.preventDefault()}
},{passive:false});
$('hours').addEventListener('keydown',e=>{
 if(e.key==='ArrowRight'||e.key==='ArrowLeft'){
  $('hours').scrollBy({left:e.key==='ArrowRight'?180:-180,behavior:'smooth'});e.preventDefault();
 }
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('picker').hidden)setPicker(false)});
refreshPlaceHeader();
void refresh();
if(locationMode!=='manual')void locate();
setInterval(()=>{if(Date.now()>=nextRefresh&&!fetchPending)void refresh()},60_000);
