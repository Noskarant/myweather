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
  location: loadLastLocation() || { name:'Oullins', admin1:'Auvergne-Rhône-Alpes', country:'France', lat:45.714, lon:4.807, elevation:180, timezone:'Europe/Paris' },
  baseLocation:loadBaseLocation() || loadLastLocation() || null,
  forecast:null,
  selectedDate:null,
  dayDetailDate:null,
  dayDetailStep:1,
  futureOffset:3,
  bulletinPeriod:'today',
  expert:false,
  mapOverlay:'radar',
  favorites:loadFavorites(),
  loading:false,
  demo:false
};

const refs = {
  searchForm:$('#searchForm'), searchInput:$('#searchInput'), searchResults:$('#searchResults'), geoBtn:$('#geoBtn'), favoriteBtn:$('#favoriteBtn'), favoriteIcon:$('#favoriteIcon'), refreshBtn:$('#refreshBtn'), favoriteQuickbar:$('#favoriteQuickbar'),
  locationName:$('#locationName'), locationElevation:$('#locationElevation'), locationMeta:$('#locationMeta'), confidence:$('#confidenceBadge'), currentTemp:$('#currentTemp'), currentCondition:$('#currentCondition'), feelsLike:$('#feelsLike'), lastUpdated:$('#lastUpdated'), weatherGlyph:$('#weatherGlyph'), heroScene:$('#heroScene'), futurePanel:$('#futureWeatherPanel'), futureScene:$('#futureScene'), futureTemp:$('#futureTemp'), futureCondition:$('#futureCondition'), futureMeta:$('#futureMeta'), quickMetrics:$('#quickMetrics'), insight:$('#weatherInsight'),
  cockpitGrid:$('#cockpitGrid'), expertToggle:$('#expertToggle'), tempChart:$('#tempChart'), tempRangeLabel:$('#tempRangeLabel'), hourlyRail:$('#hourlyRail'), dailyGrid:$('#dailyGrid'),
  mountainStats:$('#mountainStats'), mountainStatus:$('#mountainStatus'), zeroLine:$('#zeroLine'), snowLine:$('#snowLine'), placeLine:$('#placeLine'), mapFrame:$('#weatherMapFrame'), mapOverlayName:$('#mapOverlayName'),
  forecastView:$('#forecastView'), routeView:$('#routeView'), favoritesView:$('#favoritesView'), favoritesGrid:$('#favoritesGrid'),
  modal:$('#hourModal'), closeModal:$('#closeHourModal'), modalTitle:$('#hourModalTitle'), modalSub:$('#hourModalSub'), modalGlyph:$('#hourModalGlyph'), modalMain:$('#hourModalMain'), hourDetailGrid:$('#hourDetailGrid'),
  routeForm:$('#routeForm'), routeFrom:$('#routeFrom'), routeTo:$('#routeTo'), routeDate:$('#routeDate'), routeTime:$('#routeTime'), swapRoute:$('#swapRoute'), routeLoading:$('#routeLoading'), routeEmpty:$('#routeEmpty'), routeResults:$('#routeResults'), routeSummary:$('#routeSummary'), routeRisk:$('#routeRisk'), routeSketch:$('#routeSketch'), routeTimeline:$('#routeTimeline'),
  bulletinBtn:$('#bulletinBtn'), bulletinModal:$('#bulletinModal'), closeBulletin:$('#closeBulletinModal'), bulletinContent:$('#bulletinContent'), bulletinUpdated:$('#bulletinUpdated'),
  toast:$('#toast'), canvas:$('#weatherFx')
};

function loadFavorites() {
  try { return JSON.parse(localStorage.getItem('myweather:favorites') || '[]'); } catch { return []; }
}
function loadLastLocation() {
  try { return JSON.parse(localStorage.getItem('myweather:last-location') || 'null'); } catch { return null; }
}
function loadBaseLocation() {
  try { return JSON.parse(localStorage.getItem('myweather:base-location') || 'null'); } catch { return null; }
}
function saveBaseLocation() {
  try { localStorage.setItem('myweather:base-location', JSON.stringify(state.baseLocation)); } catch {}
}
function saveLastLocation() {
  try { localStorage.setItem('myweather:last-location', JSON.stringify(state.location)); } catch {}
}
function saveFavorites() { try { localStorage.setItem('myweather:favorites', JSON.stringify(state.favorites)); } catch { showToast('Impossible de conserver les favoris sur cet appareil.', 'warn'); } }
function favoriteKey(loc) { return `${Number(loc.lat).toFixed(3)},${Number(loc.lon).toFixed(3)}`; }
function isFavorite(loc = state.location) { return state.favorites.some(x => favoriteKey(x) === favoriteKey(loc)); }

function showToast(message, type='info') {
  refs.toast.textContent = message;
  refs.toast.dataset.type = type;
  refs.toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => refs.toast.classList.add('hidden'), 3200);
}

async function loadLocation(location, {silent=false,asBase=false}={}) {
  if (state.loading) return;
  state.loading = true;
  refs.refreshBtn.classList.add('spinning');
  try {
    if (OFFLINE_TEST) throw new Error('offline test mode');
    const data = await getForecast(location);
    state.location = data.location;
    if (asBase) { state.baseLocation = data.location; saveBaseLocation(); }
    state.forecast = data;
    state.demo = false;
    state.selectedDate = data.daily[0]?.time || null;
    saveLastLocation();
  } catch (err) {
    console.warn(err);
    const requestedLocation = location?.name ? location : state.location;
    if (OFFLINE_TEST) {
      state.location = requestedLocation;
      if (asBase) { state.baseLocation = requestedLocation; saveBaseLocation(); }
      state.forecast = createDemoForecast(requestedLocation);
      state.demo = true;
      state.selectedDate = state.forecast.daily[0]?.time || null;
      saveLastLocation();
    } else {
      state.location = requestedLocation;
      if (asBase) { state.baseLocation = requestedLocation; saveBaseLocation(); }
      state.demo = false;
      if (!state.forecast) {
        refs.locationName.textContent = requestedLocation.name || 'Lieu sélectionné';
        const elevation = Number(requestedLocation.elevation);
        refs.locationElevation.textContent = Number.isFinite(elevation) ? `${Math.round(elevation)} m` : 'alt. —';
        refs.locationMeta.textContent = [requestedLocation.type && requestedLocation.type !== 'Localité' ? requestedLocation.type : '', requestedLocation.admin1, requestedLocation.country].filter(Boolean).join(' · ');
        refs.currentTemp.textContent = '—°';
        refs.currentCondition.textContent = 'Données météo momentanément indisponibles';
        refs.feelsLike.textContent = 'Ressenti —';
        refs.lastUpdated.textContent = 'Réessaie dans quelques instants';
        refs.weatherGlyph.innerHTML = weatherIcon(3, 1);
        refs.hourlyRail.innerHTML = '';
        refs.dailyGrid.innerHTML = '';
      }
      if (!silent) showToast('Données météo indisponibles : aucune donnée fictive n’est affichée.', 'warn');
    }
  } finally {
    state.loading = false;
    refs.refreshBtn.classList.remove('spinning');
    if (state.forecast) renderAll();
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
  const elevation = Number(loc.elevation ?? f.elevation);
  refs.locationElevation.textContent = Number.isFinite(elevation) ? `${Math.round(elevation)} m` : 'alt. —';
  refs.locationMeta.textContent = [loc.type && loc.type !== 'Localité' ? loc.type : '', loc.admin1, loc.country].filter(Boolean).join(' · ');
  if (document.activeElement !== refs.searchInput) refs.searchInput.value = loc.name || '';
  refs.currentTemp.textContent = `${Math.round(c.temperature_2m ?? hNow.temperature_2m ?? 0)}°`;
  const uvNow = Number(hNow.uv_index);
  refs.currentCondition.textContent = Number.isFinite(uvNow) ? `${info.label} · UV ${round(uvNow,1)}` : info.label;
  refs.feelsLike.textContent = `Ressenti ${Math.round(c.apparent_temperature ?? hNow.apparent_temperature ?? 0)}°C`;
  refs.lastUpdated.textContent = formatUpdateAge(c.time || hNow.time);
  refs.weatherGlyph.innerHTML = weatherIcon(c.weather_code ?? hNow.weather_code, c.is_day);
  try { renderHeroScene(c,hNow); } catch (err) { console.warn('Scene météo actuelle',err); }
  try { renderFutureWeather(); } catch (err) { console.warn('Scène météo future',err); }

  const conf = confidenceForHorizon(1);
  refs.confidence.querySelector('strong').textContent = `${conf}%`;
  refs.confidence.title = 'Indice indicatif lié principalement à l’échéance de prévision ; il ne remplace pas une prévision d’ensemble.';

  const lpn = hNow.snowLevel;
  const visibilityNow = Number(hNow.visibility);
  const pressureNow = Number(c.pressure_msl ?? hNow.pressure_msl);
  const cloudNow = Number(hNow.cloud_cover);
  const metrics = [
    ['Précip.', `${round(c.precipitation ?? 0,1)} mm`, '◌'],
    ['Vent', `${Math.round(c.wind_speed_10m ?? 0)} km/h`, '≋'],
    ['Rafales', `${Math.round(c.wind_gusts_10m ?? 0)} km/h`, '⚑'],
    ['Humidité', `${Math.round(c.relative_humidity_2m ?? 0)}%`, '◇'],
    ['Pression', Number.isFinite(pressureNow) ? `${Math.round(pressureNow)} hPa` : '—', '▣'],
    ['Visibilité', Number.isFinite(visibilityNow) ? `${(visibilityNow/1000).toFixed(1)} km` : '—', '◎'],
    ['Nuages', Number.isFinite(cloudNow) ? `${Math.round(cloudNow)}%` : '—', '☁'],
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
  try { renderWeatherBulletin(); } catch (err) { console.warn('Bulletin météo',err); }
  renderFavoriteQuickbar();
}

function formatUpdateAge(iso) {
  if (!iso) return 'Mise à jour récente';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (!Number.isFinite(minutes) || minutes < 2) return 'Mise à jour à l’instant';
  if (minutes < 60) return `Mise à jour il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `Mise à jour il y a ${hours} h`;
}


function heroSceneKind(code = 0, isDay = 1) {
  const day = Number(isDay) !== 0;
  if ([95,96,99].includes(code)) return 'storm';
  if ([71,73,75,77,85,86].includes(code)) return 'snow';
  if ([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) return 'rain';
  if ([45,48].includes(code)) return 'fog';
  if ([2,3].includes(code)) return day ? 'partly-cloudy' : 'night-cloudy';
  return day ? 'sunny' : 'clear-night';
}
function sceneClamp(v,min,max){ return Math.min(max,Math.max(min,v)); }
function sceneIntensity(data,kind){
  const code=Number(data.weather_code ?? 0), precip=Math.max(Number(data.precipitation ?? 0),Number(data.rain ?? 0),Number(data.showers ?? 0)), snow=Number(data.snowfall ?? 0), cape=Number(data.cape ?? 0), gust=Number(data.wind_gusts_10m ?? 0);
  if(kind==='storm'){ if(code===99||cape>=1400||gust>=75||precip>=5)return 3; if(code===96||cape>=700||gust>=55||precip>=2)return 2; return 1; }
  if(kind==='snow'){ if([75,86].includes(code)||snow>=1.5)return 3; if([73,85].includes(code)||snow>=.5)return 2; return 1; }
  if(kind==='rain'){ if([65,67,82].includes(code)||precip>=4)return 3; if([63,81,55].includes(code)||precip>=1.2)return 2; return 1; }
  return 1;
}
function sceneSunPosition(time,isDay){
  const d=String(time||'').slice(0,10), daily=state.forecast?.daily?.find(x=>x.time===d), t=new Date(time||Date.now()).getTime();
  if(isDay && daily?.sunrise && daily?.sunset){
    const rise=new Date(daily.sunrise).getTime(), set=new Date(daily.sunset).getTime(), f=sceneClamp((t-rise)/Math.max(1,set-rise),0,1), altitude=Math.sin(Math.PI*f);
    return {x:10+76*f,y:76-58*altitude,brightness:.58+.48*altitude};
  }
  const hour=Number(String(time||'00').slice(11,13)), f=sceneClamp(hour>=18?(hour-18)/12:(hour+6)/12,0,1), altitude=Math.sin(Math.PI*f);
  return {x:12+70*f,y:72-45*altitude,brightness:.72};
}
function renderWeatherScene(container,data={}){
  if(!container)return;
  const time=data.time||new Date().toISOString(), isDay=Number(data.is_day ?? isDayAt(time)), kind=heroSceneKind(Number(data.weather_code ?? 0),isDay), intensity=sceneIntensity(data,kind);
  const clouds=sceneClamp(Number(data.cloud_cover ?? (['rain','snow','storm','fog'].includes(kind)?88:kind.includes('cloudy')?55:6)),0,100), wind=Math.max(0,Number(data.wind_speed_10m ?? 0)), uv=Math.max(0,Number(data.uv_index ?? 0)), pos=sceneSunPosition(time,isDay);
  const cloudLevel=sceneClamp(Math.ceil(clouds/34),0,3), rainCount=kind==='storm'?[0,12,22,34][intensity]:[0,8,16,28][intensity], snowCount=[0,8,17,29][intensity], rainSpeed=intensity===3?.46:intensity===2?.67:.94, snowSpeed=intensity===3?3.1:intensity===2?4.5:6.2;
  const drops=Array.from({length:rainCount},(_,i)=>'<i style="left:'+(3+((i*19)%94))+'%;animation-delay:'+(-i*.08).toFixed(2)+'s;animation-duration:'+(rainSpeed+(i%5)*.04).toFixed(2)+'s"></i>').join('');
  const flakes=Array.from({length:snowCount},(_,i)=>'<i style="left:'+(3+((i*23)%92))+'%;animation-delay:'+(-i*.22).toFixed(2)+'s;animation-duration:'+(snowSpeed+(i%6)*.24).toFixed(2)+'s"></i>').join('');
  const stars=Array.from({length:13},(_,i)=>'<i style="left:'+(4+((i*23)%88))+'%;top:'+(10+((i*13)%55))+'%;animation-delay:'+(-i*.18).toFixed(2)+'s"></i>').join('');
  const role=container.classList.contains('future-scene')?'future-scene':'current-scene';
  container.className='hero-scene '+role+' '+kind+' intensity-'+intensity+' cloud-'+cloudLevel;
  container.style.setProperty('--sun-x',pos.x+'%'); container.style.setProperty('--sun-y',pos.y+'%'); container.style.setProperty('--sun-brightness',String(pos.brightness));
  container.style.setProperty('--sun-alpha',String(sceneClamp((.45+uv*.05)*(1-clouds*.004),.18,.98))); container.style.setProperty('--cloud-speed',sceneClamp(18-wind*.16,7,18)+'s'); container.style.setProperty('--flash-duration',(intensity===3?3:intensity===2?5:8)+'s');
  container.innerHTML='<div class="scene-glow"></div><div class="scene-stars">'+stars+'</div><div class="scene-sun"><span></span></div><div class="scene-moon"></div><div class="scene-cloud scene-cloud-a"><b></b><em></em></div><div class="scene-cloud scene-cloud-b"><b></b><em></em></div><div class="scene-cloud scene-cloud-c"><b></b><em></em></div><div class="scene-rain">'+drops+'</div><div class="scene-snow">'+flakes+'</div><div class="scene-fog"><i></i><i></i><i></i></div>'+(kind==='storm'?'<div class="scene-lightning"></div>':'');
}
function renderHeroScene(current={},hourly={}){
  renderWeatherScene(refs.heroScene,{...hourly,...current,time:current.time ?? hourly.time,weather_code:current.weather_code ?? hourly.weather_code,is_day:current.is_day ?? isDayAt(hourly.time ?? new Date().toISOString()),uv_index:hourly.uv_index,cape:hourly.cape,cloud_cover:current.cloud_cover ?? hourly.cloud_cover});
}
function futureHourly(offset=state.futureOffset){
  const hours=state.forecast?.hourly||[]; if(!hours.length)return null; const now=currentHourly(); let i=now?hours.indexOf(now):-1; if(i<0)i=nearestIndex(hours.map(x=>x.time),new Date()); return hours[Math.min(hours.length-1,Math.max(0,i+Number(offset||0)))]||null;
}
function renderFutureWeather(){
  const h=futureHourly(); if(!h||!refs.futureScene)return; const day=isDayAt(h.time), info=weatherCodeInfo(h.weather_code,day); renderWeatherScene(refs.futureScene,{...h,is_day:day});
  refs.futureTemp.textContent=Math.round(h.temperature_2m ?? 0)+'°'; refs.futureCondition.textContent=info.label; const precip=Number(h.precipitation ?? 0), prob=Math.round(h.precipitation_probability ?? 0), gust=Math.round(h.wind_gusts_10m ?? 0);
  refs.futureMeta.textContent=formatHour(h.time)+' · '+(precip>0?round(precip,1)+' mm':prob+'% pluie')+' · raf. '+gust+' km/h'; $$('[data-future-offset]').forEach(b=>b.classList.toggle('active',Number(b.dataset.futureOffset)===state.futureOffset));
}

function weatherIcon(code = 0, isDay = 1) {
  const day = isDay !== 0;
  const cloud = '<path class="wx-cloud" d="M21 43h27a9 9 0 0 0 .8-18 14 14 0 0 0-26-4A11 11 0 0 0 21 43Z"/>';
  const sun = '<circle class="wx-sun" cx="24" cy="23" r="8"/><g class="wx-rays"><path d="M24 7v5M24 34v5M8 23h5M35 23h5M13 12l4 4M31 30l4 4M35 12l-4 4M17 30l-4 4"/></g>';
  const moon = '<path class="wx-moon" d="M31 10a15 15 0 1 0 14 22A13 13 0 0 1 31 10Z"/>';
  let art = '';
  if ([0,1].includes(code)) art = day ? sun : moon;
  else if ([2,3].includes(code)) art = `${day ? sun : moon}${cloud}`;
  else if ([45,48].includes(code)) art = `${cloud}<g class="wx-precip"><path d="M17 50h32M14 56h28"/></g>`;
  else if ([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) art = `${cloud}<g class="wx-rain"><path d="m24 49-3 7M36 49l-3 7M48 49l-3 7"/></g>`;
  else if ([71,73,75,77,85,86].includes(code)) art = `${cloud}<g class="wx-snow"><path d="M25 49v9M20.5 51.5l9 4M29.5 51.5l-9 4M43 49v9M38.5 51.5l9 4M47.5 51.5l-9 4"/></g>`;
  else if ([95,96,99].includes(code)) art = `${cloud}<path class="wx-bolt" d="m35 47-7 10h7l-3 8 11-13h-7l4-5Z"/>`;
  else art = cloud;
  return `<span class="wx-icon" aria-hidden="true"><svg viewBox="0 0 64 64" focusable="false">${art}</svg></span>`;
}


function isDayAt(time) {
  const date = String(time).slice(0,10);
  const day = state.forecast?.daily?.find(d => d.time === date);
  if (day?.sunrise && day?.sunset) {
    const t = new Date(time).getTime();
    return Number(t >= new Date(day.sunrise).getTime() && t < new Date(day.sunset).getTime());
  }
  const hour = new Date(time).getHours();
  return Number(hour >= 7 && hour < 19);
}

function representativeHour(date, targetHour) {
  const hours = state.forecast?.hourly?.filter(h => h.time.slice(0,10) === date) || [];
  if (!hours.length) return null;
  return hours.reduce((best, h) => {
    const hour = Number(h.time.slice(11,13));
    const bestHour = Number(best.time.slice(11,13));
    return Math.abs(hour-targetHour) < Math.abs(bestHour-targetHour) ? h : best;
  }, hours[0]);
}

function windRangeForDate(date) {
  const values = (state.forecast?.hourly || []).filter(h => h.time.slice(0,10) === date).map(h => Number(h.wind_speed_10m)).filter(Number.isFinite);
  if (!values.length) return null;
  return [Math.round(Math.min(...values)), Math.round(Math.max(...values))];
}

function daylightCondition(d) {
  const hours = dayHours(d.time).filter(h => isDayAt(h.time) && h.weather_code != null);
  if (!hours.length) return weatherCodeInfo(d.weather_code, 1).label;
  const counts = { clear:0, partial:0, cloud:0, rain:0, snow:0, storm:0, fog:0 };
  for (const h of hours) {
    const code = Number(h.weather_code);
    const kind = code <= 1 ? 'clear' : code === 2 ? 'partial' : code === 3 ? 'cloud'
      : code === 45 || code === 48 ? 'fog' : code >= 95 ? 'storm'
      : [71,73,75,77,85,86].includes(code) ? 'snow' : 'rain';
    counts[kind]++;
  }
  const n = hours.length, wet = counts.rain + counts.snow + counts.storm;
  if (wet / n >= .5) return counts.snow > counts.rain ? 'Neige fréquente' : counts.storm > counts.rain ? 'Temps orageux' : 'Pluie fréquente';
  if (wet >= 2 && wet / n >= .18 && (counts.clear + counts.partial) / n >= .3)
    return counts.snow > counts.rain ? 'Éclaircies et neige possible' : 'Éclaircies et passages pluvieux';
  if (counts.clear / n >= .6) return 'Ciel généralement dégagé';
  if ((counts.clear + counts.partial) / n >= .6) return 'Alternance de soleil et de nuages';
  if ((counts.cloud + counts.partial) / n >= .6) return 'Ciel souvent nuageux';
  if (counts.fog / n >= .5) return 'Brouillard persistant';
  return 'Conditions variables';
}

function daylightHours(d) {
  if (!d?.sunrise || !d?.sunset) return null;
  const hours = (new Date(d.sunset).getTime() - new Date(d.sunrise).getTime()) / 3600000;
  return Number.isFinite(hours) ? hours : null;
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
  const desktop = window.matchMedia('(min-width:1101px)').matches;
  const scientific = [
    ['Prob. précip.', `${Math.round(h.precipitation_probability ?? 0)} %`, 'precip'],
    ['Précipitations', `${round(h.precipitation ?? c.precipitation ?? 0,1)} mm/h`, 'precip'],
    ['Couverture nuageuse', `${Math.round(h.cloud_cover ?? c.cloud_cover ?? 0)} %`, 'cloud'],
    ['Nuages bas / moy. / hauts', `${Math.round(h.cloud_cover_low ?? 0)} / ${Math.round(h.cloud_cover_mid ?? 0)} / ${Math.round(h.cloud_cover_high ?? 0)} %`, 'cloud'],
    ['UV', `${round(h.uv_index,1) ?? '—'}`, 'uv'],
    ['Neige au sol', h.snow_depth != null ? `${round(h.snow_depth*100,1)} cm` : '—', 'snow']
  ];
  const data = desktop ? [...rows,...expert,...scientific] : (state.expert ? [...rows,...expert] : rows);
  refs.cockpitGrid.innerHTML = data.map(([label,value,kind])=>`<div class="cockpit-cell" data-kind="${kind}"><span>${label}</span><strong>${value}</strong></div>`).join('');
}

function renderTempChart() {
  const f=state.forecast; if (!f) return;
  const idx=nearestIndex(f.hourly.map(x=>x.time), new Date());
  const slice=f.hourly.slice(idx, idx+24);
  const vals=slice.map(x=>x.temperature_2m);
  const {path,min,max,points}=svgPath(vals);
  const area = path ? `${path} L720,150 L0,150 Z` : '';
  refs.tempChart.innerHTML = `<defs><linearGradient id="lineg" x1="0" x2="1"><stop stop-color="#72ebff"/><stop offset="1" stop-color="#7a72ff"/></linearGradient><linearGradient id="areag" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#62ddff" stop-opacity=".28"/><stop offset="1" stop-color="#62ddff" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#areag)"/><path d="${path}" fill="none" stroke="url(#lineg)" stroke-width="4" vector-effect="non-scaling-stroke"/>${points.map((p,i)=>i%4===0||i===points.length-1?`<g><circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#dffbff"/><text class="temp-point-label" x="${clamp(p[0],24,696)}" y="${p[1]<38?p[1]+24:p[1]-11}" text-anchor="middle">${Math.round(vals[i])}°</text><title>${formatHour(slice[i].time)} : ${round(vals[i],1)} °C</title></g>`:'').join('')}`;
  refs.tempRangeLabel.textContent = `${Math.round(min)}° → ${Math.round(max)}°`;
}

function renderHourly(dateStr) {
  const f=state.forecast; if (!f) return;
  let items, currentIndex = 0;
  if (dateStr === f.daily[0]?.time) {
    const idx = nearestIndex(f.hourly.map(x=>x.time), new Date());
    const start = f.hourly.findIndex(x=>x.time.slice(0,10)===dateStr);
    items = f.hourly.slice(Math.max(0,start), Math.min(f.hourly.length,idx+24));
    currentIndex = Math.max(0,idx-Math.max(0,start));
  } else {
    items = f.hourly.filter(x=>x.time.slice(0,10)===dateStr);
  }
  const previousDate=refs.hourlyRail.dataset.date, previousScroll=refs.hourlyRail.scrollLeft;
  const now=Date.now();
  refs.hourlyRail.innerHTML = items.map(h=>{
    const isPast=new Date(h.time).getTime() < now-3600000;
    return `<button class="hour-card ${isPast?'past':''}" data-hour="${escapeHtml(h.time)}">
      <span class="hour-time">${formatHour(h.time)}</span>
      <span class="hour-glyph">${weatherIcon(h.weather_code, isDayAt(h.time))}</span>
      <strong>${Math.round(h.temperature_2m)}°</strong>
      <span class="hour-meta"><small class="precip">${Math.round(h.precipitation_probability ?? 0)}%</small><small>raf. ${Math.round(h.wind_gusts_10m ?? 0)}</small></span>
    </button>`;
  }).join('');
  refs.hourlyRail.querySelectorAll('[data-hour]').forEach(btn=>btn.addEventListener('click',()=>openHour(btn.dataset.hour)));
  refs.hourlyRail.dataset.date=dateStr || '';
  if (previousDate===dateStr) refs.hourlyRail.scrollLeft=previousScroll;
  else if (dateStr===f.daily[0]?.time) {
    const first=refs.hourlyRail.firstElementChild, selected=refs.hourlyRail.children[currentIndex];
    refs.hourlyRail.scrollLeft=selected&&first?selected.offsetLeft-first.offsetLeft:0;
  } else refs.hourlyRail.scrollLeft=0;
}


function dayHours(date) {
  return (state.forecast?.hourly || []).filter(h => h.time.slice(0,10) === date);
}

function formatClock(iso) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(new Date(iso));
}

function formatDetailDate(date) {
  return new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(date+'T12:00:00'));
}

function ensureDayDetailView() {
  let view = document.querySelector('#dayDetailView');
  if (view) return view;
  view = document.createElement('section');
  view.id = 'dayDetailView';
  view.className = 'day-detail-view hidden';
  view.innerHTML = `
    <div class="day-detail-shell">
      <header class="day-detail-bar">
        <button type="button" class="day-detail-back" data-day-close aria-label="Retour">‹ <span>Retour</span></button>
        <div class="day-detail-place"><strong id="dayDetailPlace">—</strong><small id="dayDetailDate">—</small></div>
        <button type="button" class="day-detail-close" data-day-close aria-label="Fermer">×</button>
      </header>
      <main class="day-detail-content">
        <section class="day-detail-panel">
          <div class="day-detail-panel-head">
            <div><span class="eyebrow">PRÉVISION HORAIRE</span><h2>Heure par heure</h2></div>
            <div class="day-step-toggle" aria-label="Pas horaire">
              <button type="button" data-day-step="1" class="active">1 h</button>
              <button type="button" data-day-step="3">3 h</button>
            </div>
          </div>
          <div class="day-detail-columns" aria-hidden="true">
            <span>Heure</span><span>Temps</span><span>Temp.</span><span>Vent</span><span>Détails</span>
          </div>
          <div id="dayDetailRows" class="day-detail-rows"></div>
        </section>

        <details id="dayDetailSummary" class="day-science-details">
          <summary>
            <span><small>RÉSUMÉ DE LA JOURNÉE</small><strong>Résumé scientifique</strong></span>
            <span class="day-science-summary-meta">max/min · soleil · pression · LPN · ISO 0 °C</span>
            <span class="day-science-summary-chevron" aria-hidden="true">⌄</span>
          </summary>
          <section id="dayDetailOverview" class="day-detail-overview"></section>
        </details>
      </main>
    </div>`;
  document.body.appendChild(view);
  view.querySelectorAll('[data-day-close]').forEach(b=>b.addEventListener('click',closeDayDetail));
  view.querySelectorAll('[data-day-step]').forEach(b=>b.addEventListener('click',()=>{
    state.dayDetailStep = Number(b.dataset.dayStep) || 1;
    view.querySelectorAll('[data-day-step]').forEach(x=>x.classList.toggle('active', x===b));
    renderDayDetailRows();
  }));
  return view;
}

function openDayDetail(date) {
  const d = state.forecast?.daily?.find(x=>x.time===date);
  if (!d) return;
  state.dayDetailDate = date;
  state.dayDetailStep = 1;
  state.selectedDate = date;
  renderDaily();

  const view = ensureDayDetailView();
  view.querySelector('#dayDetailPlace').textContent = state.location.name;
  view.querySelector('#dayDetailDate').textContent = formatDetailDate(date);
  view.querySelectorAll('[data-day-step]').forEach(b=>b.classList.toggle('active',b.dataset.dayStep==='1'));
  const scienceDetails = view.querySelector('#dayDetailSummary');
  if (scienceDetails) scienceDetails.open = false;

  const hours = dayHours(date);
  const midday = representativeHour(date, 14) || hours[0];
  const dayIndex = Math.max(0, state.forecast.daily.findIndex(x=>x.time===date));
  const conf = confidenceForHorizon(dayIndex*24+12);
  const visibility = hours.map(h=>Number(h.visibility)).filter(Number.isFinite);
  const pressure = hours.map(h=>Number(h.pressure_msl)).filter(Number.isFinite);
  const humidity = hours.map(h=>Number(h.relative_humidity_2m)).filter(Number.isFinite);
  const snowLevels = hours.map(h=>Number(h.snowLevel)).filter(Number.isFinite);
  const zeroLevels = hours.map(h=>Number(h.freezing_level_height)).filter(Number.isFinite);
  const cape = hours.map(h=>Number(h.cape)).filter(Number.isFinite);
  const maxCape = cape.length ? Math.max(...cape) : null;
  const minVis = visibility.length ? Math.min(...visibility) : null;
  const meanPressure = pressure.length ? pressure.reduce((a,b)=>a+b,0)/pressure.length : null;
  const meanHumidity = humidity.length ? humidity.reduce((a,b)=>a+b,0)/humidity.length : null;
  const minSnow = snowLevels.length ? Math.min(...snowLevels) : null;
  const minZero = zeroLevels.length ? Math.min(...zeroLevels) : null;
  const uv = Number(d.uv);

  view.querySelector('#dayDetailOverview').innerHTML = `
    <div class="day-overview-main">
      <div class="day-overview-icon">${weatherIcon(midday?.weather_code ?? d.weather_code, 1)}</div>
      <div class="day-overview-copy">
        <span class="eyebrow">${escapeHtml(state.location.type || 'PRÉVISION LOCALE')} · ${Math.round(state.location.elevation ?? state.forecast.elevation ?? 0)} m</span>
        <h1>${escapeHtml(daylightCondition(d))}</h1>
        <div class="day-overview-temp"><strong>${Math.round(d.max)}°</strong><span>${Math.round(d.min)}°</span></div>
        <p>Ressenti ${Math.round(d.apparentMin ?? d.min)}° à ${Math.round(d.apparentMax ?? d.max)}° · fiabilité indicative ${conf}%</p>
      </div>
    </div>
    <div class="day-overview-stats">
      <div><span>Lever du soleil</span><strong>${formatClock(d.sunrise)}</strong></div>
      <div><span>Coucher du soleil</span><strong>${formatClock(d.sunset)}</strong></div>
      <div><span>Précipitations</span><strong>${round(d.precipitation ?? 0,1)} mm</strong><small>${Math.round(d.precipProb ?? 0)}% max</small></div>
      <div><span>Vent / rafales</span><strong>${Math.round(d.windMax ?? 0)} / ${Math.round(d.gustMax ?? 0)}</strong><small>km/h · ${cardinal(d.windDir)}</small></div>
      <div><span>Humidité moy.</span><strong>${meanHumidity!=null?Math.round(meanHumidity)+'%':'—'}</strong></div>
      <div><span>Pression moy.</span><strong>${meanPressure!=null?Math.round(meanPressure)+' hPa':'—'}</strong></div>
      <div><span>Visibilité mini</span><strong>${minVis!=null?(minVis/1000).toFixed(1)+' km':'—'}</strong></div>
      <div><span>UV max</span><strong>${Number.isFinite(uv)?round(uv,1):'—'}</strong></div>
      <div><span>LPN la plus basse</span><strong>${minSnow!=null?'~'+Math.round(minSnow)+' m':'—'}</strong></div>
      <div><span>ISO 0 °C mini</span><strong>${minZero!=null?Math.round(minZero)+' m':'—'}</strong></div>
      <div><span>CAPE max</span><strong>${maxCape!=null?Math.round(maxCape)+' J/kg':'—'}</strong></div>
      <div><span>Neige cumulée</span><strong>${round(d.snowfall ?? 0,1)} cm</strong></div>
    </div>`;

  renderDayDetailRows();
  view.classList.remove('hidden');
  document.body.classList.add('day-detail-open');
  view.scrollTop = 0;
  const start = [...view.querySelectorAll('.day-hour-row')].find(row=>Number(row.dataset.dayHour.slice(11,13))>=8);
  if (start) view.scrollTop = start.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop - view.querySelector('.day-detail-bar').offsetHeight - 8;
}

function renderDayDetailRows() {
  const view = document.querySelector('#dayDetailView');
  if (!view || !state.dayDetailDate) return;
  const rows = view.querySelector('#dayDetailRows');
  const step = state.dayDetailStep || 1;
  const hours = dayHours(state.dayDetailDate).filter((_,i)=>i%step===0);

  rows.innerHTML = hours.map(h=>{
    const day = isDayAt(h.time);
    const info = weatherCodeInfo(h.weather_code, day);
    const precip = Number(h.precipitation ?? 0);
    const snow = Number(h.snowfall ?? 0);
    const vis = Number(h.visibility);
    const cloud = Number(h.cloud_cover);
    const pressure = Number(h.pressure_msl);
    const humidity = Number(h.relative_humidity_2m);
    const uv = Number(h.uv_index);
    const cape = Number(h.cape);
    return `<div class="day-hour-entry"><button type="button" class="day-hour-row" data-day-hour="${escapeHtml(h.time)}" aria-expanded="false" aria-controls="science-${escapeHtml(h.time)}">
      <span class="day-hour-time"><strong>${formatHour(h.time)}</strong><small>${day?'jour':'nuit'}</small></span>
      <span class="day-hour-weather">${weatherIcon(h.weather_code, day)}<small>${escapeHtml(info.label)}</small></span>
      <span class="day-hour-temp"><strong>${Math.round(h.temperature_2m)}°</strong><small>ress. ${Math.round(h.apparent_temperature ?? h.temperature_2m)}°</small></span>
      <span class="day-hour-wind"><strong><i class="wind-arrow" style="--wind-dir:${Number(h.wind_direction_10m ?? 0)}deg">↑</i> ${Math.round(h.wind_speed_10m ?? 0)} km/h</strong><small>raf. ${Math.round(h.wind_gusts_10m ?? 0)} · ${cardinal(h.wind_direction_10m)}</small></span>
      <span class="day-hour-chevron">⌄</span>
    </button>
    <div id="science-${escapeHtml(h.time)}" class="day-hour-extra" hidden><div class="day-hour-science">
        <span><b>Précip.</b><strong>${precip>0?round(precip,1):'0'} mm · ${Math.round(h.precipitation_probability ?? 0)}%</strong><small>${snow>0?`❄ ${round(snow,1)} cm`:`pluie ${round(h.rain ?? 0,1)} mm`}</small></span>
        <span><b>Atmosphère</b><strong>${Number.isFinite(humidity)?Math.round(humidity)+'%':'—'} · ${Number.isFinite(pressure)?Math.round(pressure)+' hPa':'—'}</strong><small>vis. ${Number.isFinite(vis)?(vis/1000).toFixed(1)+' km':'—'} · nuages ${Number.isFinite(cloud)?Math.round(cloud)+'%':'—'}</small></span>
        <span><b>Montagne</b><strong>LPN ${h.snowLevel!=null?'~'+Math.round(h.snowLevel)+' m':'—'}</strong><small>0 °C ${h.freezing_level_height!=null?Math.round(h.freezing_level_height)+' m':'—'} · UV ${Number.isFinite(uv)?round(uv,1):'—'}${Number.isFinite(cape)&&cape>0?` · CAPE ${Math.round(cape)}`:''}</small></span>
      </div><button type="button" class="day-hour-more" data-hour-more="${escapeHtml(h.time)}">Voir tous les détails →</button></div></div>`;
  }).join('');

  rows.querySelectorAll('[data-day-hour]').forEach(b=>b.addEventListener('click',()=>{
    const expanded=b.getAttribute('aria-expanded')==='true';
    rows.querySelectorAll('[data-day-hour]').forEach(row=>{row.setAttribute('aria-expanded','false');row.nextElementSibling.hidden=true;});
    if (!expanded) { b.setAttribute('aria-expanded','true'); b.nextElementSibling.hidden=false; }
  }));
  rows.querySelectorAll('[data-hour-more]').forEach(b=>b.addEventListener('click',()=>openHour(b.dataset.hourMore)));
}

function closeDayDetail() {
  const view = document.querySelector('#dayDetailView');
  if (!view) return;
  view.classList.add('hidden');
  document.body.classList.remove('day-detail-open');
}


function renderDaily() {
  refs.dailyGrid.innerHTML = state.forecast.daily.slice(0,15).map((d,i)=>{
    const conf=confidenceForHorizon(i*24+12);
    const active=d.time===state.selectedDate;
    const daylight=daylightHours(d);
    const snow = Number(d.snowfall ?? 0);
    const dayHour = representativeHour(d.time, 14);
    const nightHour = representativeHour(d.time, 23) || representativeHour(d.time, 2);
    const windRange = windRangeForDate(d.time);
    const windText = windRange ? `${windRange[0]}–${windRange[1]}` : `${Math.round(d.windMax ?? 0)}`;
    return `<button class="forecast-row ${active?'selected':''}" data-day="${d.time}">
      <span class="forecast-date"><strong>${i===0?'Aujourd’hui':formatDay(d.time).split(' ')[0]}</strong><small>${new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'2-digit'}).format(new Date(`${d.time}T12:00:00`))}</small></span>
      <span class="forecast-weather"><span class="forecast-icons">${weatherIcon(dayHour?.weather_code ?? d.weather_code,1)}${weatherIcon(nightHour?.weather_code ?? d.weather_code,0)}</span><small>${escapeHtml(daylightCondition(d))}</small></span>
      <span class="forecast-temps"><strong>${Math.round(d.max)}°</strong><em>${Math.round(d.min)}°</em></span>
      <span class="forecast-metrics">
        <span><i class="wind-arrow" style="--wind-dir:${Number(d.windDir ?? 0)}deg">↑</i> ${windText} km/h <small>raf. ${Math.round(d.gustMax ?? 0)}</small></span>
        <span>◌ ${round(d.precipitation ?? 0,1)} mm <small>${Math.round(d.precipProb ?? 0)}%</small></span>
        <span>${snow>0.1?`❄ ${round(snow,1)} cm`:`☼ ${daylight!=null?`${round(daylight,1)} h`:'—'}`} <small>${conf}% fiab.</small></span>
      </span>
      <span class="forecast-chevron">›</span>
    </button>`;
  }).join('');
  refs.dailyGrid.querySelectorAll('[data-day]').forEach(btn=>btn.addEventListener('click',()=>{
    openDayDetail(btn.dataset.day);
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
  refs.modalGlyph.innerHTML=weatherIcon(h.weather_code, isDayAt(h.time));
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
  saveFavorites(); updateFavoriteButton(); renderFavorites(); renderFavoriteQuickbar();
}
function renderFavoriteQuickbar(){
  if(!refs.favoriteQuickbar) return;
  const base = state.baseLocation || state.location;
  const baseKey = favoriteKey(base), selectedKey = favoriteKey(state.location);
  const items = state.favorites.filter(x => favoriteKey(x) !== baseKey);
  refs.favoriteQuickbar.innerHTML = `<button type="button" class="quick-favorite current-location ${selectedKey===baseKey?'active':''}" data-base-location ${selectedKey===baseKey?'aria-current="true"':''}>${escapeHtml(base.name || 'Lieu actuel')}</button>${items.map((x,i)=>`<button type="button" data-quick-fav="${i}" class="quick-favorite ${favoriteKey(x)===selectedKey?'active':''}" ${favoriteKey(x)===selectedKey?'aria-current="true"':''}>${escapeHtml(x.name)}</button>`).join('')}<button type="button" class="quick-favorite quick-add" data-quick-add>+ Favori</button>`;
  refs.favoriteQuickbar.querySelector('[data-base-location]')?.addEventListener('click',()=>loadLocation(base));
  refs.favoriteQuickbar.querySelectorAll('[data-quick-fav]').forEach(b=>b.addEventListener('click',()=>loadLocation(items[Number(b.dataset.quickFav)])));
  refs.favoriteQuickbar.querySelector('[data-quick-add]')?.addEventListener('click',e=>{e.stopPropagation();openFavoriteSearch();});
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

function bulletinMean(values){ const nums=values.map(Number).filter(Number.isFinite); return nums.length?nums.reduce((a,b)=>a+b,0)/nums.length:null; }
function bulletinDate(iso){ return new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long'}).format(new Date(iso+'T12:00:00')); }
function bulletinToday(){
  const d=state.forecast?.daily?.[0]; if(!d)return '<p>Données indisponibles.</p>'; const hours=dayHours(d.time), morning=representativeHour(d.time,9), afternoon=representativeHour(d.time,15), evening=representativeHour(d.time,20), parts=[];
  const current = state.forecast.current;
  const now = current?.time?.slice(0,10) === d.time && current.weather_code != null
    ? 'En ce moment à <strong>'+escapeHtml(state.location.name)+'</strong> : '+weatherCodeInfo(current.weather_code, current.is_day).label.toLowerCase()+'. '
    : 'Aujourd’hui à <strong>'+escapeHtml(state.location.name)+'</strong>. ';
  parts.push(now+'Pour la journée, '+daylightCondition(d).toLowerCase()+'. Les températures iront approximativement de <strong>'+Math.round(d.min)+' °C</strong> à <strong>'+Math.round(d.max)+' °C</strong>.');
  const periods=[['matin',morning],['après-midi',afternoon],['soirée',evening]].filter(x=>x[1]); if(periods.length)parts.push('Dans le détail, '+periods.map(x=>x[0]+' : '+weatherCodeInfo(x[1].weather_code,isDayAt(x[1].time)).label.toLowerCase()+', '+Math.round(x[1].temperature_2m)+' °C').join(' ; ')+'.');
  const pmax=Math.round(d.precipProb ?? Math.max(0,...hours.map(h=>Number(h.precipitation_probability)||0))), psum=Number(d.precipitation ?? hours.reduce((a,h)=>a+(Number(h.precipitation)||0),0));
  parts.push(pmax>=30||psum>=.2?'Le risque de précipitations atteint <strong>'+pmax+'%</strong>'+(psum>0?', pour environ <strong>'+round(psum,1)+' mm</strong> cumulés':'')+'.':'Le risque de précipitations reste faible, avec un maximum proche de <strong>'+pmax+'%</strong>.');
  const gust=Math.round(d.gustMax ?? Math.max(0,...hours.map(h=>Number(h.wind_gusts_10m)||0))); parts.push(gust>=35?'Des rafales proches de <strong>'+gust+' km/h</strong> sont possibles.':'Le vent ne présente pas de signal fort, avec des rafales maximales proches de <strong>'+gust+' km/h</strong>.');
  const lpn=hours.map(h=>h.snowLevel).filter(v=>v != null && Number.isFinite(Number(v))).map(Number); if(lpn.length&&(Number(d.snowfall)>0||Math.min(...lpn)<1800))parts.push('En relief, la LPN pourrait descendre vers <strong>'+Math.round(Math.min(...lpn))+' m</strong> au plus bas.');
  return parts.map(x=>'<p>'+x+'</p>').join('');
}
function bulletinWeek(){
  const days=(state.forecast?.daily||[]).slice(0,7); if(!days.length)return '<p>Données indisponibles.</p>'; const maxs=days.map(d=>Number(d.max)).filter(Number.isFinite), mins=days.map(d=>Number(d.min)).filter(Number.isFinite);
  const warm=days.reduce((a,b)=>Number(b.max)>Number(a.max)?b:a,days[0]), cold=days.reduce((a,b)=>Number(b.min)<Number(a.min)?b:a,days[0]), first=bulletinMean(days.slice(0,3).map(d=>d.max)), last=bulletinMean(days.slice(-3).map(d=>d.max)), delta=(Number.isFinite(first)&&Number.isFinite(last))?last-first:0, wet=days.filter(d=>Number(d.precipProb)>=40||Number(d.precipitation)>=1);
  const trend=delta>=2?'une hausse des maximales en fin de période':delta<=-2?'un rafraîchissement en fin de période':'des températures assez stables';
  return '<p>Sur les <strong>7 prochains jours</strong> à '+escapeHtml(state.location.name)+', la tendance indique <strong>'+trend+'</strong>. Les maximales se situent entre <strong>'+Math.round(Math.min(...maxs))+' et '+Math.round(Math.max(...maxs))+' °C</strong>, les minimales entre <strong>'+Math.round(Math.min(...mins))+' et '+Math.round(Math.max(...mins))+' °C</strong>.</p><p>Le pic de douceur ressort <strong>'+bulletinDate(warm.time)+'</strong> autour de '+Math.round(warm.max)+' °C ; le point le plus frais autour de <strong>'+bulletinDate(cold.time)+'</strong>, vers '+Math.round(cold.min)+' °C.</p><p>'+(wet.length?'<strong>'+wet.length+' jour'+(wet.length>1?'s':'')+'</strong> présentent actuellement un signal de précipitations notable.':'La période ressort actuellement plutôt sèche dans le modèle.')+'</p>';
}
function bulletinMonth(){
  const days=(state.forecast?.daily||[]).slice(0,15); if(!days.length)return '<p>Données indisponibles.</p>'; const first=bulletinMean(days.slice(0,5).map(d=>d.max)), last=bulletinMean(days.slice(-5).map(d=>d.max)), delta=(Number.isFinite(first)&&Number.isFinite(last))?last-first:0, wet=days.filter(d=>Number(d.precipProb)>=40||Number(d.precipitation)>=1);
  const trend=delta>=2?'un signal de douceur croissante':delta<=-2?'un signal de rafraîchissement progressif':'pas de tendance thermique nette';
  return '<p>Pour la <strong>tendance du mois</strong>, MyWeather reste volontairement prudent : l’app dispose ici d’environ 15 jours de prévision, pas d’une prévision quotidienne fiable à 30 jours. Sur cet horizon, on observe <strong>'+trend+'</strong> à '+escapeHtml(state.location.name)+'.</p><p>'+wet.length+' journée'+(wet.length>1?'s':'')+' sur '+days.length+' montrent actuellement un signal de précipitations notable.</p><p class="bulletin-caution">Au-delà de cet horizon, il faut parler de tendance saisonnière ou climatologique, avec une incertitude nettement plus forte.</p>';
}
function buildWeatherBulletin(period=state.bulletinPeriod){ if(period==='week')return bulletinWeek(); if(period==='month')return bulletinMonth(); return bulletinToday(); }
function renderWeatherBulletin(){ if(!refs.bulletinContent||!state.forecast)return; refs.bulletinContent.innerHTML=buildWeatherBulletin(); const time=state.forecast?.current?.time||currentHourly()?.time; refs.bulletinUpdated.textContent=state.demo?'Données de démonstration':time?'Données de '+formatHour(time)+' · actualisation toutes les 15 min lorsque l’app est ouverte':'Actualisation à chaque ouverture.'; $$('[data-bulletin-period]').forEach(b=>b.classList.toggle('active',b.dataset.bulletinPeriod===state.bulletinPeriod)); }
function openBulletin(){ state.bulletinPeriod='today'; renderWeatherBulletin(); refs.bulletinModal?.classList.remove('hidden'); document.body.classList.add('modal-open'); }
function closeBulletin(){ refs.bulletinModal?.classList.add('hidden'); document.body.classList.remove('modal-open'); }

function showView(name){
  refs.forecastView.classList.toggle('active',name==='forecast'); refs.routeView.classList.toggle('active',name==='route'); refs.favoritesView.classList.toggle('active',name==='favorites');
  $$('.bottom-nav [data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===(name==='forecast'?'forecast':name)));
  if(name==='maps'){refs.forecastView.classList.add('active');refs.routeView.classList.remove('active');refs.favoritesView.classList.remove('active');setTimeout(()=>$('#mapsSection').scrollIntoView({behavior:'smooth'}),50);$$('.bottom-nav [data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav==='maps'));}
  if(name!=='maps')scrollTo({top:0,behavior:'smooth'});
}

let addingFavorite = false;
const normalSearchPlaceholder = refs.searchInput.placeholder;
function closeFavoriteSearch() {
  if (!addingFavorite) return;
  addingFavorite = false;
  refs.searchInput.placeholder = normalSearchPlaceholder;
  refs.searchInput.value = state.location.name || '';
  refs.searchResults.classList.add('hidden');
}
function openFavoriteSearch() {
  addingFavorite = true;
  refs.searchInput.value = '';
  refs.searchInput.placeholder = 'Rechercher un lieu à ajouter aux favoris…';
  refs.searchResults.innerHTML = '<div class="search-empty">Recherche un lieu pour l’ajouter aux favoris.</div>';
  refs.searchResults.classList.remove('hidden');
  refs.searchInput.focus();
}
function addSearchedFavorite(place) {
  if (isFavorite(place)) showToast('Ce lieu est déjà dans les favoris.');
  else {
    state.favorites.push({...place});
    saveFavorites();
    renderFavorites();
    renderFavoriteQuickbar();
    showToast('Lieu ajouté aux favoris.', 'success');
  }
  closeFavoriteSearch();
  refs.searchInput.blur();
}

const doSearch=debounce(async q=>{
  if(q !== refs.searchInput.value) return;
  if(q.trim().length<2){if(addingFavorite){refs.searchResults.innerHTML='<div class="search-empty">Recherche un lieu pour l’ajouter aux favoris.</div>';refs.searchResults.classList.remove('hidden');}else refs.searchResults.classList.add('hidden');return;}
  try{
    const items=await geocode(q,7);
    if(q !== refs.searchInput.value) return;
    refs.searchResults.innerHTML=items.length?items.map((x,i)=>`<button type="button" data-result="${i}"><span class="search-kind-icon">${['Sommet','Col','Volcan'].includes(x.type)?'△':['Lac'].includes(x.type)?'≈':'⌖'}</span><div><strong>${escapeHtml(x.name)} <em class="search-type">${escapeHtml(x.type || 'Lieu')}</em></strong><small>${escapeHtml([x.admin1,x.country].filter(Boolean).join(', '))}${x.elevation!=null?` · <b>${Math.round(x.elevation)} m</b>`:''}</small></div></button>`).join(''):'<div class="search-empty">Aucun lieu trouvé</div>';
    refs.searchResults.classList.remove('hidden');
    refs.searchResults.querySelectorAll('[data-result]').forEach(b=>b.addEventListener('click',async()=>{const place=items[Number(b.dataset.result)];refs.searchResults.classList.add('hidden');if(addingFavorite) addSearchedFavorite(place);else await loadLocation(place,{asBase:true});}));
  }catch{refs.searchResults.innerHTML='<div class="search-empty">Recherche indisponible</div>';refs.searchResults.classList.remove('hidden');}
},700);

async function useGeolocation(){
  if(!navigator.geolocation){showToast('Géolocalisation non prise en charge.','warn');return;}
  refs.geoBtn.classList.add('spinning');
  navigator.geolocation.getCurrentPosition(async pos=>{
    const loc=await reverseGeocodeApprox(pos.coords.latitude,pos.coords.longitude); refs.geoBtn.classList.remove('spinning'); await loadLocation(loc,{asBase:true});
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

function renderRouteSketch(r) {
  const coords=r.route.geometry.coordinates, pts=r.points;
  const lons=coords.map(c=>c[0]), lats=coords.map(c=>c[1]);
  const minX=Math.min(...lons),maxX=Math.max(...lons),minY=Math.min(...lats),maxY=Math.max(...lats);
  const w=900,h=340,pad=26;
  const proj=c=>[pad+(c[0]-minX)/(maxX-minX||1)*(w-pad*2),h-pad-(c[1]-minY)/(maxY-minY||1)*(h-pad*2)];
  const xy=coords.map(proj);
  const lengths=[0];
  for(let i=1;i<coords.length;i++){
    const lat=(coords[i][1]+coords[i-1][1])/2*Math.PI/180;
    lengths[i]=lengths[i-1]+Math.hypot((coords[i][0]-coords[i-1][0])*Math.cos(lat),coords[i][1]-coords[i-1][1]);
  }
  const total=lengths.at(-1)||1;
  const base=xy.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const sections=[];
  for(let i=1;i<xy.length;i++){
    const fraction=(lengths[i-1]+lengths[i])/(2*total);
    const nearest=i===xy.length-1?pts.at(-1):pts.reduce((best,p)=>Math.abs(p.fraction-fraction)<Math.abs(best.fraction-fraction)?p:best,pts[0]);
    const level=nearest.risk.level;
    const point=`${xy[i][0].toFixed(1)},${xy[i][1].toFixed(1)}`;
    if(sections.at(-1)?.level===level) sections.at(-1).path+=` L${point}`;
    else sections.push({level,path:`M${xy[i-1][0].toFixed(1)},${xy[i-1][1].toFixed(1)} L${point}`});
  }
  const segments=sections.map(s=>`<path class="route-section ${s.level}" d="${s.path}"/>`).join('');
  const markers=pts.map((p,i)=>{
    const [x,y]=proj([p.lon,p.lat]);
    const title=`Km ${Math.round(p.cumKm)} · ${p.risk.reasons.length?p.risk.reasons.join(', '):'conditions calmes'}`;
    return `<g><title>${escapeHtml(title)}</title><circle cx="${x}" cy="${y}" r="${i===0||i===pts.length-1?7:p.risk.score>=3?5:3.5}" class="risk-${p.risk.level}"/></g>`;
  }).join('');
  const alerts=pts.filter(p=>p.risk.score>=3);
  const firstAlert=alerts[0];
  const caption=firstAlert?`Vigilance vers le km ${Math.round(firstAlert.cumKm)} : ${escapeHtml(firstAlert.risk.reasons.join(', '))}.`:'Aucun risque météo marqué aux points analysés.';
  refs.routeSketch.innerHTML=`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Tracé de ${escapeHtml(r.from.name)} à ${escapeHtml(r.to.name)}, segments colorés selon la vigilance météo"><path class="route-shadow" d="${base}"/>${segments}${markers}</svg><div class="sketch-label start">${escapeHtml(r.from.name)}</div><div class="sketch-label end">${escapeHtml(r.to.name)}</div><div class="route-map-legend"><span><i class="minimal"></i>Calme</span><span><i class="low"></i>À suivre</span><span><i class="medium"></i>Vigilance</span><span><i class="high"></i>Risque marqué</span></div><p class="route-map-caption">${caption}</p>`;
}
function setupRouteDefaults(){const d=new Date(Date.now()+3600000);refs.routeDate.min=new Date().toISOString().slice(0,10);refs.routeDate.max=new Date(Date.now()+15*86400000).toISOString().slice(0,10);refs.routeDate.value=d.toISOString().slice(0,10);refs.routeTime.value=`${String(d.getHours()).padStart(2,'0')}:00`;}

function bindEvents(){
  refs.searchInput.addEventListener('input',e=>doSearch(e.target.value)); refs.searchForm.addEventListener('submit',e=>{e.preventDefault();doSearch(refs.searchInput.value)});
  document.addEventListener('click',e=>{if(!refs.searchForm.contains(e.target)){if(addingFavorite)closeFavoriteSearch();else refs.searchResults.classList.add('hidden');}});
  refs.geoBtn.addEventListener('click',useGeolocation);refs.favoriteBtn.addEventListener('click',toggleFavorite);refs.refreshBtn.addEventListener('click',()=>loadLocation(state.location));
  $$('[data-future-offset]').forEach(b=>b.addEventListener('click',()=>{state.futureOffset=Number(b.dataset.futureOffset)||3;renderFutureWeather()}));
  refs.bulletinBtn?.addEventListener('click',openBulletin); refs.closeBulletin?.addEventListener('click',closeBulletin); refs.bulletinModal?.addEventListener('click',e=>{if(e.target===refs.bulletinModal)closeBulletin()});
  $$('[data-bulletin-period]').forEach(b=>b.addEventListener('click',()=>{state.bulletinPeriod=b.dataset.bulletinPeriod;renderWeatherBulletin()}));
  refs.expertToggle.addEventListener('click',()=>{state.expert=!state.expert;refs.expertToggle.setAttribute('aria-pressed',String(state.expert));refs.expertToggle.classList.toggle('active',state.expert);renderCockpit(state.forecast.current,currentHourly())});
  $$('#mapTabs [data-overlay]').forEach(b=>b.addEventListener('click',()=>{state.mapOverlay=b.dataset.overlay;$$('#mapTabs [data-overlay]').forEach(x=>x.classList.toggle('active',x===b));updateMap()}));
  $$('[data-nav]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.nav)));
  refs.closeModal.addEventListener('click',closeHour);refs.modal.addEventListener('click',e=>{if(e.target===refs.modal)closeHour()});document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!refs.modal.classList.contains('hidden')) closeHour(); else if(refs.bulletinModal && !refs.bulletinModal.classList.contains('hidden')) closeBulletin(); else if(addingFavorite)closeFavoriteSearch(); else closeDayDetail();}});
  refs.routeForm.addEventListener('submit',handleRoute);refs.swapRoute.addEventListener('click',()=>{const a=refs.routeFrom.value;refs.routeFrom.value=refs.routeTo.value;refs.routeTo.value=a});
}

async function init(){
  if (!loadBaseLocation()) { state.baseLocation=state.baseLocation || state.location; saveBaseLocation(); }
  state.expert = window.matchMedia('(min-width:1101px)').matches;
  refs.expertToggle?.setAttribute('aria-pressed', String(state.expert));
  refs.expertToggle?.classList.toggle('active', state.expert);
  bindEvents();setupRouteDefaults();renderFavorites();renderFavoriteQuickbar();
  await loadLocation(state.location,{silent:true});
  if(!OFFLINE_TEST) setInterval(()=>{if(document.visibilityState==='visible'&&!state.loading) loadLocation(state.location,{silent:true})},15*60*1000);
  if(!OFFLINE_TEST && 'serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost')) navigator.serviceWorker.register('./sw.js?v=1.5.9').catch(()=>{});
}
init();
