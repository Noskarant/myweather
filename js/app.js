import { createDemoForecast, geocode, getForecast, reverseGeocodeApprox } from './weather.js';
import { analyzeRoute } from './route.js';
import {
  cardinal, clamp, confidenceForHorizon, debounce, escapeHtml, formatDateTime, formatDay, formatDuration,
  formatHour, nearestIndex, round, seasonFor, svgPath, weatherCodeInfo
} from './utils.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const OFFLINE_TEST = new URLSearchParams(location.search).has('offline');

const state = {
  location: { name:'Chamonix', admin1:'Haute-Savoie', country:'France', lat:45.9237, lon:6.8694, elevation:1035, timezone:'Europe/Paris' },
  forecast:null,
  selectedDate:null,
  expert:false,
  mapOverlay:'radar',
  favorites:loadFavorites(),
  loading:false,
  demo:false
};

const refs = {
  searchForm:$('#searchForm'), searchInput:$('#searchInput'), searchResults:$('#searchResults'), geoBtn:$('#geoBtn'), favoriteBtn:$('#favoriteBtn'), favoriteIcon:$('#favoriteIcon'), refreshBtn:$('#refreshBtn'),
  locationName:$('#locationName'), locationMeta:$('#locationMeta'), confidence:$('#confidenceBadge'), currentTemp:$('#currentTemp'), currentCondition:$('#currentCondition'), feelsLike:$('#feelsLike'), weatherGlyph:$('#weatherGlyph'), quickMetrics:$('#quickMetrics'), insight:$('#weatherInsight'),
  cockpitGrid:$('#cockpitGrid'), expertToggle:$('#expertToggle'), tempChart:$('#tempChart'), tempRangeLabel:$('#tempRangeLabel'), hourlyRail:$('#hourlyRail'), dailyGrid:$('#dailyGrid'),
  mountainStats:$('#mountainStats'), mountainStatus:$('#mountainStatus'), zeroLine:$('#zeroLine'), snowLine:$('#snowLine'), placeLine:$('#placeLine'), mapFrame:$('#weatherMapFrame'), mapOverlayName:$('#mapOverlayName'),
  forecastView:$('#forecastView'), routeView:$('#routeView'), favoritesView:$('#favoritesView'), favoritesGrid:$('#favoritesGrid'),
  modal:$('#hourModal'), closeModal:$('#closeHourModal'), modalTitle:$('#hourModalTitle'), modalSub:$('#hourModalSub'), modalGlyph:$('#hourModalGlyph'), modalMain:$('#hourModalMain'), hourDetailGrid:$('#hourDetailGrid'),
  routeForm:$('#routeForm'), routeFrom:$('#routeFrom'), routeTo:$('#routeTo'), routeDate:$('#routeDate'), routeTime:$('#routeTime'), swapRoute:$('#swapRoute'), routeLoading:$('#routeLoading'), routeEmpty:$('#routeEmpty'), routeResults:$('#routeResults'), routeSummary:$('#routeSummary'), routeRisk:$('#routeRisk'), routeSketch:$('#routeSketch'), routeTimeline:$('#routeTimeline'),
  toast:$('#toast'), canvas:$('#weatherFx')
};

function loadFavorites() {
  try { return JSON.parse(localStorage.getItem('myweather:favorites') || '[]'); } catch { return []; }
}
function saveFavorites() { localStorage.setItem('myweather:favorites', JSON.stringify(state.favorites)); }
function favoriteKey(loc) { return `${Number(loc.lat).toFixed(3)},${Number(loc.lon).toFixed(3)}`; }
function isFavorite(loc = state.location) { return state.favorites.some(x => favoriteKey(x) === favoriteKey(loc)); }

function showToast(message, type='info') {
  refs.toast.textContent = message;
  refs.toast.dataset.type = type;
  refs.toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => refs.toast.classList.add('hidden'), 3200);
}

async function loadLocation(location, {silent=false}={}) {
  if (state.loading) return;
  state.loading = true;
  refs.refreshBtn.classList.add('spinning');
  try {
    if (OFFLINE_TEST) throw new Error('offline test mode');
    const data = await getForecast(location);
    state.location = data.location;
    state.forecast = data;
    state.demo = false;
    state.selectedDate = data.daily[0]?.time || null;
  } catch (err) {
    console.warn(err);
    const demoLocation = location?.name ? location : state.location;
    state.location = demoLocation;
    state.forecast = createDemoForecast(demoLocation);
    state.demo = true;
    state.selectedDate = state.forecast.daily[0]?.time || null;
    if (!silent) showToast('Réseau météo indisponible : aperçu de démonstration affiché.', 'warn');
  } finally {
    state.loading = false;
    refs.refreshBtn.classList.remove('spinning');
    renderAll();
  }
}

function currentHourly() {
  if (!state.forecast?.hourly?.length) return null;
  return state.forecast.hourly[nearestIndex(state.forecast.hourly.map(x=>x.time), new Date())];
}

function renderAll() {
  const f = state.forecast;
  if (!f) return;
  const c = f.current || {};
  const hNow = currentHourly() || {};
  const info = weatherCodeInfo(c.weather_code, c.is_day);
  const loc = state.location;

  refs.locationName.textContent = loc.name || 'Lieu sélectionné';
  refs.locationMeta.textContent = [loc.admin1, loc.country, Number.isFinite(Number(loc.elevation)) ? `${Math.round(loc.elevation)} m` : ''].filter(Boolean).join(' · ');
  refs.currentTemp.textContent = `${Math.round(c.temperature_2m ?? hNow.temperature_2m ?? 0)}°`;
  refs.currentCondition.textContent = info.label;
  refs.feelsLike.textContent = `Ressenti ${Math.round(c.apparent_temperature ?? hNow.apparent_temperature ?? 0)}°C`;
  refs.weatherGlyph.textContent = info.glyph;

  const conf = confidenceForHorizon(1);
  refs.confidence.querySelector('strong').textContent = `${conf}%`;
  refs.confidence.title = 'Indice indicatif lié principalement à l’échéance de prévision ; il ne remplace pas une prévision d’ensemble.';

  const lpn = hNow.snowLevel;
  const metrics = [
    ['Précip.', `${round(c.precipitation ?? 0,1)} mm`, '◌'],
    ['Vent', `${Math.round(c.wind_speed_10m ?? 0)} km/h`, '≋'],
    ['Rafales', `${Math.round(c.wind_gusts_10m ?? 0)} km/h`, '⚑'],
    ['Humidité', `${Math.round(c.relative_humidity_2m ?? 0)}%`, '◇'],
    ['LPN', lpn != null ? `~${Math.round(lpn)} m` : '—', '△']
  ];
  refs.quickMetrics.innerHTML = metrics.map(([k,v,i])=>`<div><i>${i}</i><span>${k}<strong>${v}</strong></span></div>`).join('');
  refs.insight.innerHTML = weatherInsight(c,hNow,loc);

  renderCockpit(c,hNow);
  renderTempChart();
  renderHourly(state.selectedDate);
  renderDaily();
  renderMountain(hNow);
  updateFavoriteButton();
  updateMap();
  applyTheme(info.theme, c.is_day);
  renderFavorites();
}

function weatherInsight(c,h,loc) {
  const bits=[];
  if ((c.wind_gusts_10m ?? 0) >= 60) bits.push(`<strong>Rafales marquées</strong> jusqu’à ${Math.round(c.wind_gusts_10m)} km/h`);
  if ((c.precipitation ?? 0) > 0 && h.snowLevel != null && Number(loc.elevation ?? 0) >= h.snowLevel - 150) bits.push(`<strong>Neige plausible</strong> à cette altitude · LPN estimée ~${Math.round(h.snowLevel)} m`);
  if ((h.cape ?? 0) >= 700) bits.push(`<strong>Atmosphère instable</strong> · CAPE ${Math.round(h.cape)} J/kg`);
  if ((h.visibility ?? 99999) < 3000) bits.push(`<strong>Visibilité réduite</strong> · ${(h.visibility/1000).toFixed(1)} km`);
  if (!bits.length) bits.push(`<strong>Conditions sans signal majeur</strong> sur le créneau immédiat.`);
  if (state.demo) bits.push(`<span class="demo-tag">MODE DÉMO</span>`);
  return bits.join('<span class="insight-sep">•</span>');
}

function renderCockpit(c,h) {
  const rows = [
    ['Température', `${round(c.temperature_2m ?? h.temperature_2m,1)} °C`, 'thermo'],
    ['Ressenti', `${round(c.apparent_temperature ?? h.apparent_temperature,1)} °C`, 'snow'],
    ['Vent', `${Math.round(c.wind_speed_10m ?? h.wind_speed_10m ?? 0)} km/h ${cardinal(c.wind_direction_10m ?? h.wind_direction_10m)}`, 'wind'],
    ['Rafales', `${Math.round(c.wind_gusts_10m ?? h.wind_gusts_10m ?? 0)} km/h`, 'gust'],
    ['Pression', `${Math.round(c.pressure_msl ?? h.pressure_msl ?? 0)} hPa`, 'pressure'],
    ['Humidité', `${Math.round(c.relative_humidity_2m ?? h.relative_humidity_2m ?? 0)} %`, 'humidity'],
    ['ISO 0 °C', h.freezing_level_height != null ? `${Math.round(h.freezing_level_height)} m` : '—', 'mountain'],
    ['LPN estimée', h.snowLevel != null ? `~${Math.round(h.snowLevel)} m` : '—', 'snowline']
  ];
  const expert = [
    ['Point de rosée', h.dew_point_2m != null ? `${round(h.dew_point_2m,1)} °C` : '—', 'dew'],
    ['T° humide', h.wet_bulb_temperature_2m != null ? `${round(h.wet_bulb_temperature_2m,1)} °C` : '—', 'wet'],
    ['Visibilité', h.visibility != null ? `${(h.visibility/1000).toFixed(1)} km` : '—', 'visibility'],
    ['CAPE', h.cape != null ? `${Math.round(h.cape)} J/kg` : '—', 'cape']
  ];
  const data = state.expert ? [...rows,...expert] : rows;
  refs.cockpitGrid.innerHTML = data.map(([label,value,kind])=>`<div class="cockpit-cell" data-kind="${kind}"><span>${label}</span><strong>${value}</strong></div>`).join('');
}

function renderTempChart() {
  const f=state.forecast; if (!f) return;
  const idx=nearestIndex(f.hourly.map(x=>x.time), new Date());
  const slice=f.hourly.slice(idx, idx+24);
  const vals=slice.map(x=>x.temperature_2m);
  const {path,min,max,points}=svgPath(vals);
  const area = path ? `${path} L720,150 L0,150 Z` : '';
  refs.tempChart.innerHTML = `<defs><linearGradient id="lineg" x1="0" x2="1"><stop stop-color="#72ebff"/><stop offset="1" stop-color="#7a72ff"/></linearGradient><linearGradient id="areag" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#62ddff" stop-opacity=".28"/><stop offset="1" stop-color="#62ddff" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#areag)"/><path d="${path}" fill="none" stroke="url(#lineg)" stroke-width="4" vector-effect="non-scaling-stroke"/>${points.filter((_,i)=>i%4===0).map(p=>`<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#dffbff"/>`).join('')}`;
  refs.tempRangeLabel.textContent = `${Math.round(min)}° → ${Math.round(max)}°`;
}

function renderHourly(dateStr) {
  const f=state.forecast; if (!f) return;
  const items=f.hourly.filter(x=>x.time.slice(0,10)===dateStr);
  const now=Date.now();
  refs.hourlyRail.innerHTML = items.map((h,i)=>{
    const info=weatherCodeInfo(h.weather_code, 1);
    const isPast=new Date(h.time).getTime() < now-3600000;
    return `<button class="hour-card ${isPast?'past':''}" data-hour="${escapeHtml(h.time)}">
      <span class="hour-time">${formatHour(h.time)}</span><span class="hour-glyph">${info.glyph}</span><strong>${Math.round(h.temperature_2m)}°</strong>
      <small class="precip">◆ ${Math.round(h.precipitation_probability ?? 0)}%</small><small>⚑ ${Math.round(h.wind_gusts_10m ?? 0)}</small>
    </button>`;
  }).join('');
  refs.hourlyRail.querySelectorAll('[data-hour]').forEach(btn=>btn.addEventListener('click',()=>openHour(btn.dataset.hour)));
}

function renderDaily() {
  refs.dailyGrid.innerHTML = state.forecast.daily.slice(0,15).map((d,i)=>{
    const conf=confidenceForHorizon(i*24+12);
    const active=d.time===state.selectedDate;
    return `<button class="day-card glass ${active?'selected':''}" data-day="${d.time}">
      <div class="day-head"><span>${i===0?'Aujourd’hui':formatDay(d.time)}</span><span class="day-confidence">${conf}%</span></div>
      <div class="day-glyph">${d.info.glyph}</div>
      <div class="day-temps"><strong>${Math.round(d.max)}°</strong><span>${Math.round(d.min)}°</span></div>
      <div class="day-cond">${d.info.label}</div>
      <div class="day-data"><span>◆ ${Math.round(d.precipProb ?? 0)}%</span><span>⚑ ${Math.round(d.gustMax ?? 0)}</span>${(d.snowfall??0)>0.1?`<span>❄ ${round(d.snowfall,1)} cm</span>`:''}</div>
    </button>`;
  }).join('');
  refs.dailyGrid.querySelectorAll('[data-day]').forEach(btn=>btn.addEventListener('click',()=>{
    state.selectedDate=btn.dataset.day; renderDaily(); renderHourly(state.selectedDate);
    document.querySelector('.hourly-rail')?.scrollIntoView({behavior:'smooth',block:'center'});
  }));
}

function renderMountain(h) {
  const elevation=Number(state.location.elevation ?? state.forecast.elevation ?? 0);
  const zero=Number(h.freezing_level_height);
  const snow=Number(h.snowLevel);
  const maxAlt=Math.max(3000, zero+600, elevation+900);
  const pos = alt => clamp(100 - (alt/maxAlt*86), 8, 92);
  refs.zeroLine.style.top = `${pos(zero)}%`; refs.zeroLine.querySelector('span').textContent = Number.isFinite(zero) ? `ISO 0 °C · ${Math.round(zero)} m` : 'ISO 0 °C · —';
  refs.snowLine.style.top = `${pos(snow)}%`; refs.snowLine.querySelector('span').textContent = Number.isFinite(snow) ? `LPN estimée · ~${Math.round(snow)} m` : 'LPN estimée · —';
  refs.placeLine.style.top = `${pos(elevation)}%`; refs.placeLine.querySelector('span').textContent = `${state.location.name} · ${Math.round(elevation)} m`;
  const precip=h.precipitation ?? 0, wb=h.wet_bulb_temperature_2m;
  const snowHere = Number.isFinite(snow) && elevation >= snow - 100 && precip>0;
  refs.mountainStatus.textContent = snowHere ? 'Neige possible au lieu' : precip>0 ? 'Précipitations à surveiller' : 'Pas de précipitation immédiate';
  refs.mountainStatus.dataset.level=snowHere?'snow':precip>0?'wet':'calm';
  refs.mountainStats.innerHTML = [
    ['Altitude du lieu', `${Math.round(elevation)} m`],['Niveau 0 °C', Number.isFinite(zero)?`${Math.round(zero)} m`:'—'],['LPN estimée',Number.isFinite(snow)?`~${Math.round(snow)} m`:'—'],
    ['Température humide',Number.isFinite(wb)?`${round(wb,1)} °C`:'—'],['Neige au sol modèle',h.snow_depth!=null?`${Math.round(h.snow_depth*100)} cm`:'—'],['Précipitations',`${round(precip,1)} mm/h`]
  ].map(([k,v])=>`<div><span>${k}</span><strong>${v}</strong></div>`).join('');
}

function openHour(time) {
  const h=state.forecast.hourly.find(x=>x.time===time); if (!h) return;
  const info=weatherCodeInfo(h.weather_code,1);
  refs.modalTitle.textContent=formatDateTime(h.time);
  refs.modalSub.textContent=`${state.location.name} · ${info.label}`;
  refs.modalGlyph.textContent=info.glyph;
  refs.modalMain.innerHTML=`<div><span>Température</span><strong>${round(h.temperature_2m,1)}°C</strong><small>Ressenti ${round(h.apparent_temperature,1)}°C</small></div><div><span>Précipitations</span><strong>${round(h.precipitation,1)} mm/h</strong><small>${Math.round(h.precipitation_probability??0)}% de probabilité</small></div><div><span>Vent / rafales</span><strong>${Math.round(h.wind_speed_10m??0)} / ${Math.round(h.wind_gusts_10m??0)}</strong><small>km/h · ${cardinal(h.wind_direction_10m)}</small></div>`;
  const items=[
    ['Pluie',`${round(h.rain,1)} mm`],['Averses',`${round(h.showers,1)} mm`],['Neige',`${round(h.snowfall,1)} cm`],['LPN estimée',h.snowLevel!=null?`~${Math.round(h.snowLevel)} m`:'—'],
    ['ISO 0 °C',h.freezing_level_height!=null?`${Math.round(h.freezing_level_height)} m`:'—'],['T° humide',h.wet_bulb_temperature_2m!=null?`${round(h.wet_bulb_temperature_2m,1)}°C`:'—'],['Point de rosée',h.dew_point_2m!=null?`${round(h.dew_point_2m,1)}°C`:'—'],
    ['Humidité',`${Math.round(h.relative_humidity_2m??0)}%`],['Pression',`${Math.round(h.pressure_msl??0)} hPa`],['Visibilité',h.visibility!=null?`${(h.visibility/1000).toFixed(1)} km`:'—'],
    ['Nuages',`${Math.round(h.cloud_cover??0)}%`],['Nuages bas',`${Math.round(h.cloud_cover_low??0)}%`],['Nuages moyens',`${Math.round(h.cloud_cover_mid??0)}%`],['Nuages hauts',`${Math.round(h.cloud_cover_high??0)}%`],
    ['UV',round(h.uv_index,1)??'—'],['CAPE',h.cape!=null?`${Math.round(h.cape)} J/kg`:'—']
  ];
  refs.hourDetailGrid.innerHTML=items.map(([k,v])=>`<div><span>${k}</span><strong>${v}</strong></div>`).join('');
  refs.modal.classList.remove('hidden'); document.body.classList.add('modal-open');
}
function closeHour(){refs.modal.classList.add('hidden');document.body.classList.remove('modal-open');}

function updateFavoriteButton(){ const fav=isFavorite(); refs.favoriteIcon.textContent=fav?'♥':'♡'; refs.favoriteBtn.classList.toggle('active',fav); }
function toggleFavorite(){
  const key=favoriteKey(state.location);
  if(isFavorite()) {state.favorites=state.favorites.filter(x=>favoriteKey(x)!==key);showToast('Lieu retiré des favoris.');}
  else {state.favorites.push({...state.location});showToast('Lieu ajouté aux favoris.','success');}
  saveFavorites(); updateFavoriteButton(); renderFavorites();
}
function renderFavorites(){
  if(!state.favorites.length){refs.favoritesGrid.innerHTML='<div class="empty-state glass"><div class="empty-icon">♡</div><h2>Aucun favori</h2><p>Ajoute un lieu depuis les prévisions pour le retrouver ici.</p></div>';return;}
  refs.favoritesGrid.innerHTML=state.favorites.map((x,i)=>`<button class="favorite-card glass" data-fav="${i}"><div><span class="favorite-pin">⌖</span><h3>${escapeHtml(x.name)}</h3><p>${escapeHtml([x.admin1,x.country].filter(Boolean).join(' · '))}</p></div><span>→</span></button>`).join('');
  refs.favoritesGrid.querySelectorAll('[data-fav]').forEach(b=>b.addEventListener('click',async()=>{showView('forecast');await loadLocation(state.favorites[Number(b.dataset.fav)]);}));
}

function buildWindyUrl(overlay){
  const {lat,lon}=state.location;
  const base='https://embed.windy.com/embed2.html';
  const product = overlay==='satellite' ? 'satellite' : overlay==='radar' ? 'radar' : 'ecmwf';
  const q=new URLSearchParams({lat:String(lat),lon:String(lon),detailLat:String(lat),detailLon:String(lon),width:'1200',height:'650',zoom:'7',level:'surface',overlay,product,menu:'',message:'true',marker:'true',calendar:'now',pressure:'',type:'map',location:'coordinates',detail:'',metricWind:'km/h',metricTemp:'°C',radarRange:'-1'});
  if(overlay==='satellite'||overlay==='radar')q.set('lightning','1');
  return `${base}?${q}`;
}
function updateMap(){ if (OFFLINE_TEST) { refs.mapFrame.removeAttribute('src'); refs.mapFrame.srcdoc='<style>body{margin:0;background:#07131f;color:#8eabbc;font-family:system-ui;display:grid;place-items:center;height:100vh}div{text-align:center}b{display:block;color:#d8f7ff;font-size:22px;margin-bottom:8px}</style><div><b>Carte météo</b>Couche externe désactivée pendant les tests locaux</div>'; } else refs.mapFrame.src=buildWindyUrl(state.mapOverlay); const labels={radar:'Radar & foudre',rain:'Précipitations prévues',wind:'Vent',satellite:'Satellite & foudre',thunder:'Orages / foudre prévue'}; refs.mapOverlayName.textContent=labels[state.mapOverlay]||state.mapOverlay; }

function applyTheme(theme,isDay=1){
  document.body.dataset.season=seasonFor(state.location.lat);
  document.body.dataset.weather=theme;
  document.body.dataset.day=isDay===0?'night':'day';
  restartWeatherFx(theme);
}

let fxAnim;
function restartWeatherFx(theme){
  const canvas=refs.canvas, ctx=canvas.getContext('2d');
  cancelAnimationFrame(fxAnim);
  const dpr=Math.min(2,window.devicePixelRatio||1); const resize=()=>{canvas.width=innerWidth*dpr;canvas.height=innerHeight*dpr;ctx.setTransform(dpr,0,0,dpr,0,0)}; resize();
  const count=theme==='snow'?90:theme==='rain'||theme==='storm'?120:32;
  const particles=Array.from({length:count},()=>({x:Math.random()*innerWidth,y:Math.random()*innerHeight,s:Math.random()*2+1,v:Math.random()*1.8+0.5,o:Math.random()*.45+.08}));
  function frame(){ctx.clearRect(0,0,innerWidth,innerHeight); if(['snow','rain','storm'].includes(theme)) particles.forEach(p=>{ctx.globalAlpha=p.o;ctx.fillStyle='#dff9ff';if(theme==='snow'){ctx.beginPath();ctx.arc(p.x,p.y,p.s,0,Math.PI*2);ctx.fill();p.y+=p.v;p.x+=Math.sin(p.y/45)*.25;}else{ctx.strokeStyle='#8bdcff';ctx.lineWidth=Math.max(.5,p.s/2);ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-2,p.y+9+p.s*3);ctx.stroke();p.y+=p.v*4;}if(p.y>innerHeight+10){p.y=-10;p.x=Math.random()*innerWidth;}});ctx.globalAlpha=1;fxAnim=requestAnimationFrame(frame);} frame();
  window.onresize=resize;
}

function showView(name){
  refs.forecastView.classList.toggle('active',name==='forecast'); refs.routeView.classList.toggle('active',name==='route'); refs.favoritesView.classList.toggle('active',name==='favorites');
  $$('.bottom-nav [data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===(name==='forecast'?'forecast':name)));
  if(name==='maps'){refs.forecastView.classList.add('active');refs.routeView.classList.remove('active');refs.favoritesView.classList.remove('active');setTimeout(()=>$('#mapsSection').scrollIntoView({behavior:'smooth'}),50);$$('.bottom-nav [data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav==='maps'));}
  if(name!=='maps')scrollTo({top:0,behavior:'smooth'});
}

const doSearch=debounce(async q=>{
  if(q.trim().length<2){refs.searchResults.classList.add('hidden');return;}
  try{
    const items=await geocode(q,7);
    refs.searchResults.innerHTML=items.length?items.map((x,i)=>`<button type="button" data-result="${i}"><span>⌖</span><div><strong>${escapeHtml(x.name)}</strong><small>${escapeHtml([x.admin1,x.country].filter(Boolean).join(', '))}${x.elevation!=null?` · ${Math.round(x.elevation)} m`:''}</small></div></button>`).join(''):'<div class="search-empty">Aucun lieu trouvé</div>';
    refs.searchResults.classList.remove('hidden');
    refs.searchResults.querySelectorAll('[data-result]').forEach(b=>b.addEventListener('click',async()=>{refs.searchResults.classList.add('hidden');refs.searchInput.value='';await loadLocation(items[Number(b.dataset.result)]);}));
  }catch{refs.searchResults.innerHTML='<div class="search-empty">Recherche indisponible</div>';refs.searchResults.classList.remove('hidden');}
},320);

async function useGeolocation(){
  if(!navigator.geolocation){showToast('Géolocalisation non prise en charge.','warn');return;}
  refs.geoBtn.classList.add('spinning');
  navigator.geolocation.getCurrentPosition(async pos=>{
    const loc=await reverseGeocodeApprox(pos.coords.latitude,pos.coords.longitude); refs.geoBtn.classList.remove('spinning'); await loadLocation(loc);
  },()=>{refs.geoBtn.classList.remove('spinning');showToast('Position non accessible. Autorise la localisation dans le navigateur.','warn');},{enableHighAccuracy:false,timeout:8000,maximumAge:300000});
}

async function handleRoute(e){
  e.preventDefault();
  const from=refs.routeFrom.value.trim(),to=refs.routeTo.value.trim(); if(!from||!to)return;
  const departure=new Date(`${refs.routeDate.value}T${refs.routeTime.value}:00`);
  if(Number.isNaN(departure.getTime())){showToast('Date ou heure invalide.','warn');return;}
  if(departure.getTime() < Date.now()-30*60000){showToast('Choisis un horaire de départ futur.','warn');return;}
  if(departure.getTime() > Date.now()+15*86400000){showToast('Le trajet météo est limité à l’horizon de prévision (15 jours).','warn');return;}
  refs.routeEmpty.classList.add('hidden');refs.routeResults.classList.add('hidden');refs.routeLoading.classList.remove('hidden');
  try{const result=await analyzeRoute(from,to,departure);renderRoute(result);refs.routeResults.classList.remove('hidden');}
  catch(err){console.error(err);refs.routeEmpty.classList.remove('hidden');refs.routeEmpty.innerHTML=`<div class="empty-icon">!</div><h2>Analyse impossible</h2><p>${escapeHtml(err.message||'Service temporairement indisponible.')}</p>`;showToast('Impossible d’analyser ce trajet.','warn');}
  finally{refs.routeLoading.classList.add('hidden');}
}

function renderRoute(r){
  const pts=r.points, worst=pts.reduce((a,b)=>b.risk.score>a.risk.score?b:a,pts[0]);
  const snowPts=pts.filter(p=>p.snowfall>0 || (p.precipitation>0 && p.snowLevel!=null && p.elevation>=p.snowLevel-150));
  const icePts=pts.filter(p=>p.temperature<=1 && p.precipitation>0);
  refs.routeSummary.innerHTML=`<div class="eyebrow">ITINÉRAIRE</div><h2>${escapeHtml(r.from.name)} <span>→</span> ${escapeHtml(r.to.name)}</h2><div class="route-kpis"><div><strong>${Math.round(r.route.distance/1000)} km</strong><span>distance</span></div><div><strong>${formatDuration(r.route.duration)}</strong><span>durée estimée</span></div><div><strong>${formatDateTime(r.departureDate)}</strong><span>départ</span></div></div>`;
  const label={minimal:'Faible',low:'À surveiller',medium:'Marqué',high:'Élevé'}[worst.risk.level];
  refs.routeRisk.innerHTML=`<div class="eyebrow">SYNTHÈSE MÉTÉO</div><div class="risk-title ${worst.risk.level}"><span></span><div><small>Risque maximal</small><strong>${label}</strong></div></div><p>${snowPts.length?`Neige possible sur ${snowPts.length} point${snowPts.length>1?'s':''} du parcours.`:'Pas de signal neigeux marqué sur les points échantillonnés.'} ${icePts.length?`Risque de chaussée glissante sur ${icePts.length} point${icePts.length>1?'s':''}.`:''}</p><small>Analyse basée sur ${pts.length} points répartis le long de la route.</small>`;
  renderRouteSketch(r);
  refs.routeTimeline.innerHTML=pts.map((p,i)=>{
    const info=weatherCodeInfo(p.code,1); const place=i===0?r.from.name:i===pts.length-1?r.to.name:`Km ${Math.round(p.cumKm)}`;
    return `<article class="route-point glass" data-risk="${p.risk.level}"><div class="route-time"><strong>${new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(p.eta)}</strong><span>${Math.round(p.elevation)} m</span></div><div class="route-dot"></div><div class="route-point-main"><div><h3>${escapeHtml(place)}</h3><p>${info.glyph} ${info.label}${p.risk.reasons.length?` · ${escapeHtml(p.risk.reasons.slice(0,2).join(', '))}`:''}</p></div><div class="route-weather-values"><strong>${round(p.temperature,1)}°</strong><span>◆ ${round(p.precipitation,1)} mm</span><span>❄ ${round(p.snowfall,1)} cm</span><span>⚑ ${Math.round(p.gust??0)} km/h</span><span>LPN ${p.snowLevel!=null?`~${Math.round(p.snowLevel)} m`:'—'}</span></div></div></article>`;
  }).join('');
}

function renderRouteSketch(r){
  const coords=r.route.geometry.coordinates; const lons=coords.map(c=>c[0]),lats=coords.map(c=>c[1]); const minX=Math.min(...lons),maxX=Math.max(...lons),minY=Math.min(...lats),maxY=Math.max(...lats); const w=900,h=340,pad=24;
  const proj=c=>[pad+(c[0]-minX)/(maxX-minX||1)*(w-pad*2),h-pad-(c[1]-minY)/(maxY-minY||1)*(h-pad*2)];
  const base=coords.map((c,i)=>`${i?'L':'M'}${proj(c)[0].toFixed(1)},${proj(c)[1].toFixed(1)}`).join(' ');
  const markers=r.points.map(p=>{const [x,y]=proj([p.lon,p.lat]);return `<g><circle cx="${x}" cy="${y}" r="7" class="risk-${p.risk.level}"/><circle cx="${x}" cy="${y}" r="14" class="risk-ring risk-${p.risk.level}"/></g>`}).join('');
  refs.routeSketch.innerHTML=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet"><defs><linearGradient id="routeGlow" x1="0" x2="1"><stop stop-color="#54ecff"/><stop offset=".5" stop-color="#7e7cff"/><stop offset="1" stop-color="#ffba66"/></linearGradient></defs><path class="route-shadow" d="${base}"/><path class="route-path" d="${base}"/>${markers}</svg><div class="sketch-label start">${escapeHtml(r.from.name)}</div><div class="sketch-label end">${escapeHtml(r.to.name)}</div>`;
}

function setupRouteDefaults(){const d=new Date(Date.now()+3600000);refs.routeDate.min=new Date().toISOString().slice(0,10);refs.routeDate.max=new Date(Date.now()+15*86400000).toISOString().slice(0,10);refs.routeDate.value=d.toISOString().slice(0,10);refs.routeTime.value=`${String(d.getHours()).padStart(2,'0')}:00`;}

function bindEvents(){
  refs.searchInput.addEventListener('input',e=>doSearch(e.target.value)); refs.searchForm.addEventListener('submit',e=>{e.preventDefault();doSearch(refs.searchInput.value)});
  document.addEventListener('click',e=>{if(!refs.searchForm.contains(e.target))refs.searchResults.classList.add('hidden')});
  refs.geoBtn.addEventListener('click',useGeolocation);refs.favoriteBtn.addEventListener('click',toggleFavorite);refs.refreshBtn.addEventListener('click',()=>loadLocation(state.location));
  refs.expertToggle.addEventListener('click',()=>{state.expert=!state.expert;refs.expertToggle.setAttribute('aria-pressed',String(state.expert));refs.expertToggle.classList.toggle('active',state.expert);renderCockpit(state.forecast.current,currentHourly())});
  $$('#mapTabs [data-overlay]').forEach(b=>b.addEventListener('click',()=>{state.mapOverlay=b.dataset.overlay;$$('#mapTabs [data-overlay]').forEach(x=>x.classList.toggle('active',x===b));updateMap()}));
  $$('[data-nav]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.nav)));
  refs.closeModal.addEventListener('click',closeHour);refs.modal.addEventListener('click',e=>{if(e.target===refs.modal)closeHour()});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeHour()});
  refs.routeForm.addEventListener('submit',handleRoute);refs.swapRoute.addEventListener('click',()=>{const a=refs.routeFrom.value;refs.routeFrom.value=refs.routeTo.value;refs.routeTo.value=a});
}

async function init(){
  bindEvents();setupRouteDefaults();renderFavorites();
  await loadLocation(state.location,{silent:true});
  if(!OFFLINE_TEST && 'serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
init();
