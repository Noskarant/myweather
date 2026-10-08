import { createDemoForecast, geocode, getForecast, precipitationSignal, reverseGeocodeApprox } from './weather.js?v=1.8.2';
import { analyzeRoute } from './route.js?v=1.6.1';
import {
  cardinal, clamp, confidenceForHorizon, debounce, escapeHtml, formatDateTime, formatDay, formatDuration,
  formatHour, formatPrecipitation, isSnowForecast, nearestIndex, precipitationLabel, round, seasonFor, svgPath, weatherCodeInfo, weatherVisualProfile
} from './utils.js?v=1.8.2';

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
  searchHistory:loadSearchHistory(),
  loading:false,
  demo:false,
  mountainPeriod:'today',
  snowPanelOpen:false
};

const refs = {
  searchForm:$('#searchForm'), searchInput:$('#searchInput'), searchResults:$('#searchResults'), mapPickerBtn:$('#mapPickerBtn'), geoBtn:$('#geoBtn'), nowClock:$('#nowClock'), futureClock:$('#futureClock'), favoriteBtn:$('#favoriteBtn'), favoriteIcon:$('#favoriteIcon'), refreshBtn:$('#refreshBtn'), favoriteQuickbar:$('#favoriteQuickbar'),
  locationName:$('#locationName'), locationElevation:$('#locationElevation'), locationMeta:$('#locationMeta'), confidence:$('#confidenceBadge'), currentTemp:$('#currentTemp'), currentCondition:$('#currentCondition'), feelsLike:$('#feelsLike'), lastUpdated:$('#lastUpdated'), weatherGlyph:$('#weatherGlyph'), heroScene:$('#heroScene'), futurePanel:$('#futureWeatherPanel'), futureScene:$('#futureScene'), futureTemp:$('#futureTemp'), futureCondition:$('#futureCondition'), futureMeta:$('#futureMeta'), quickMetrics:$('#quickMetrics'), sunriseTime:$('#sunriseTime'), sunsetTime:$('#sunsetTime'), insight:$('#weatherInsight'),
  cockpitGrid:$('#cockpitGrid'), expertToggle:$('#expertToggle'), tempChart:$('#tempChart'), tempTimeAxis:$('#tempTimeAxis'), tempRangeLabel:$('#tempRangeLabel'), hourlyRail:$('#hourlyRail'), dailyGrid:$('#dailyGrid'),
  snowFusionToggle:$('#snowFusionToggle'), snowFusionPanel:$('#snowFusionPanel'), snowFusionClose:$('#snowFusionClose'), snowFusionSource:$('#snowFusionSource'), snowFusionHighlights:$('#snowFusionHighlights'), snowFusionTable:$('#snowFusionTable'),
  mountainStats:$('#mountainStats'), mountainStatus:$('#mountainStatus'), mountainStatusIcon:$('#mountainStatusIcon'), mountainStatusTitle:$('#mountainStatusTitle'), mountainStatusText:$('#mountainStatusText'),
  zeroLine:$('#zeroLine'), snowLine:$('#snowLine'), placeLine:$('#placeLine'), mountainPeriodTabs:$('#mountainPeriodTabs'), mountainVisual:$('#mountainVisual'),
  mapFrame:$('#weatherMapFrame'), mapOverlayName:$('#mapOverlayName'),
  forecastView:$('#forecastView'), routeView:$('#routeView'), favoritesView:$('#favoritesView'), favoritesGrid:$('#favoritesGrid'),
  modal:$('#hourModal'), closeModal:$('#closeHourModal'), modalTitle:$('#hourModalTitle'), modalSub:$('#hourModalSub'), modalGlyph:$('#hourModalGlyph'), modalMain:$('#hourModalMain'), hourDetailGrid:$('#hourDetailGrid'),
  routeForm:$('#routeForm'), routeFrom:$('#routeFrom'), routeTo:$('#routeTo'), routeDate:$('#routeDate'), routeTime:$('#routeTime'), swapRoute:$('#swapRoute'), routeLoading:$('#routeLoading'), routeEmpty:$('#routeEmpty'), routeResults:$('#routeResults'), routeSummary:$('#routeSummary'), routeRisk:$('#routeRisk'), routeSketch:$('#routeSketch'), routeTimeline:$('#routeTimeline'),
  bulletinBtn:$('#bulletinBtn'), bulletinModal:$('#bulletinModal'), closeBulletin:$('#closeBulletinModal'), bulletinContent:$('#bulletinContent'), bulletinUpdated:$('#bulletinUpdated'),
  locationPickerModal:$('#locationPickerModal'), closeLocationPicker:$('#closeLocationPicker'), locationPickerMap:$('#locationPickerMap'), locationPickerCoords:$('#locationPickerCoords'), locationPickerMeta:$('#locationPickerMeta'), locationPickerName:$('#locationPickerName'), locationPickerUse:$('#locationPickerUse'), locationPickerSearchInput:$('#locationPickerSearchInput'), locationPickerSearchResults:$('#locationPickerSearchResults'), locationPickerLocate:$('#locationPickerLocate'), locationPickerLayers:$('#locationPickerLayers'),
  toast:$('#toast'), canvas:$('#weatherFx')
};

function normalizeFavorites(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter(place => {
    if (!place || typeof place.name !== 'string') return false;
    const lat = Number(place.lat), lon = Number(place.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(place => ({...place, lat:Number(place.lat), lon:Number(place.lon)}));
}
function loadFavorites() {
  for (const key of ['myweather:favorites','myweather:favorites-backup']) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return normalizeFavorites(parsed);
    } catch {}
  }
  return [];
}
function loadSearchHistory() {
  try {
    const items = JSON.parse(localStorage.getItem('myweather:search-history') || '[]');
    return Array.isArray(items) ? items.filter(x => x && typeof x.name === 'string' && Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lon))).slice(0,8) : [];
  } catch { return []; }
}
function saveSearchHistory() {
  try { localStorage.setItem('myweather:search-history', JSON.stringify(state.searchHistory)); }
  catch { showToast('Impossible de conserver l’historique sur cet appareil.', 'warn'); }
}
function rememberSearch(place) {
  const key = favoriteKey(place);
  state.searchHistory = [{...place},...state.searchHistory.filter(x => favoriteKey(x) !== key)].slice(0,8);
  saveSearchHistory();
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
function saveFavorites() {
  try {
    state.favorites = normalizeFavorites(state.favorites);
    const payload = JSON.stringify(state.favorites);
    localStorage.setItem('myweather:favorites', payload);
    localStorage.setItem('myweather:favorites-backup', payload);
    if (localStorage.getItem('myweather:favorites') !== payload) throw new Error('favorite write verification failed');
  } catch {
    showToast('Impossible de conserver les favoris sur cet appareil.', 'warn');
  }
}
function favoriteKey(loc) { return `${Number(loc.lat).toFixed(3)},${Number(loc.lon).toFixed(3)}`; }
function isFavorite(loc = state.location) { return state.favorites.some(x => favoriteKey(x) === favoriteKey(loc)); }

function showToast(message, type='info') {
  refs.toast.textContent = message;
  refs.toast.dataset.type = type;
  refs.toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => refs.toast.classList.add('hidden'), 3200);
}


let locationPickerMap = null;
let locationPickerMarker = null;
let locationPickerSelection = null;
let locationPickerRequest = 0;
let locationPickerBaseLayer = null;
let locationPickerReferenceLayers = [];
let locationPickerLayerMode = (() => {
  try { return localStorage.getItem('myweather:picker-layer') || 'satellite'; }
  catch { return 'satellite'; }
})();

function pickerFallbackName(lat, lon) {
  return `Point ${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`;
}
function pickerMeta(place) {
  const parts = [place?.admin1, place?.country].filter(Boolean);
  const elevation = Number(place?.elevation);
  if (Number.isFinite(elevation)) parts.push(`${Math.round(elevation)} m`);
  return parts.join(' · ') || 'Coordonnées précises sélectionnées';
}
function closePickerSearchResults() {
  refs.locationPickerSearchResults?.classList.add('hidden');
}
function closeLocationPicker() {
  if (!refs.locationPickerModal) return;
  refs.locationPickerModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  closePickerSearchResults();
  locationPickerRequest++;
}
function clearLocationPickerLayers() {
  if (!locationPickerMap) return;
  if (locationPickerBaseLayer) {
    locationPickerMap.removeLayer(locationPickerBaseLayer);
    locationPickerBaseLayer = null;
  }
  locationPickerReferenceLayers.forEach(layer => locationPickerMap.removeLayer(layer));
  locationPickerReferenceLayers = [];
}
function setLocationPickerLayer(mode) {
  const L = window.L;
  if (!L || !locationPickerMap) return;
  if (!['street','satellite','topo'].includes(mode)) mode = 'satellite';
  locationPickerLayerMode = mode;
  try { localStorage.setItem('myweather:picker-layer', mode); } catch {}
  clearLocationPickerLayers();

  if (mode === 'satellite') {
    locationPickerBaseLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {maxZoom:19, attribution:'Tiles &copy; Esri'}
    ).addTo(locationPickerMap);
    const transport = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
      {maxZoom:19, opacity:.88, attribution:'Esri transportation'}
    ).addTo(locationPickerMap);
    const labels = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      {maxZoom:19, opacity:1, attribution:'Esri labels'}
    ).addTo(locationPickerMap);
    locationPickerReferenceLayers = [transport, labels];
  } else if (mode === 'topo') {
    locationPickerBaseLayer = L.tileLayer(
      'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      {maxNativeZoom:17, maxZoom:19, attribution:'Map data &copy; OpenStreetMap contributors · Map style &copy; OpenTopoMap'}
    ).addTo(locationPickerMap);
  } else {
    locationPickerBaseLayer = L.tileLayer(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {maxZoom:19, attribution:'&copy; OpenStreetMap contributors'}
    ).addTo(locationPickerMap);
  }

  refs.locationPickerLayers?.querySelectorAll('[data-picker-layer]').forEach(button => {
    const active = button.dataset.pickerLayer === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
function setLocationPickerMarker(lat, lon) {
  const L = window.L;
  if (!L || !locationPickerMap) return;
  if (locationPickerMarker) locationPickerMarker.setLatLng([lat, lon]);
  else {
    locationPickerMarker = L.circleMarker([lat, lon], {
      radius:9, weight:3, color:'#e9fbff', fillColor:'#5ddcff', fillOpacity:1
    }).addTo(locationPickerMap);
  }
}
function setLocationPickerPlace(place, {moveMap=true, zoom=13}={}) {
  if (!place) return;
  const lat = Number(place.lat), lon = Number(place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  locationPickerSelection = {
    ...place,
    name:place.name || pickerFallbackName(lat, lon),
    lat, lon,
    timezone:place.timezone || 'auto',
    type:'Point carte'
  };
  refs.locationPickerCoords.textContent = `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`;
  refs.locationPickerMeta.textContent = pickerMeta(locationPickerSelection);
  refs.locationPickerName.value = locationPickerSelection.name;
  refs.locationPickerUse.disabled = false;
  setLocationPickerMarker(lat, lon);
  if (moveMap) locationPickerMap?.flyTo([lat, lon], Math.max(locationPickerMap.getZoom(), zoom), {duration:.45});
}
function openLocationPicker() {
  const L = window.L;
  if (!L || !refs.locationPickerModal || !refs.locationPickerMap) {
    showToast('Carte de sélection indisponible sur cet appareil.', 'warn');
    return;
  }
  if (addingFavorite) closeFavoriteSearch();
  refs.searchResults.classList.add('hidden');
  locationPickerSelection = null;
  locationPickerRequest++;
  refs.locationPickerCoords.textContent = 'Appuie sur la carte';
  refs.locationPickerMeta.textContent = 'Les coordonnées exactes seront utilisées pour la météo.';
  refs.locationPickerName.value = '';
  refs.locationPickerUse.disabled = true;
  refs.locationPickerSearchInput.value = '';
  closePickerSearchResults();
  refs.locationPickerModal.classList.remove('hidden');
  document.body.classList.add('modal-open');

  const lat = Number(state.location?.lat);
  const lon = Number(state.location?.lon);
  const center = [Number.isFinite(lat) ? lat : 45.714, Number.isFinite(lon) ? lon : 4.807];

  if (!locationPickerMap) {
    locationPickerMap = L.map(refs.locationPickerMap, {
      zoomControl:true,
      scrollWheelZoom:true,
      doubleClickZoom:true,
      touchZoom:true
    });
    locationPickerMap.on('click', e => {
      closePickerSearchResults();
      selectLocationPickerPoint(e.latlng.lat, e.latlng.lng);
    });
  }
  setLocationPickerLayer(locationPickerLayerMode);
  if (locationPickerMarker) {
    locationPickerMarker.remove();
    locationPickerMarker = null;
  }
  locationPickerMap.setView(center, 9);
  requestAnimationFrame(() => locationPickerMap?.invalidateSize());
}
async function selectLocationPickerPoint(lat, lon) {
  if (!locationPickerMap) return;
  lat = Number(lat); lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  const fallbackName = pickerFallbackName(lat, lon);
  const requestId = ++locationPickerRequest;
  locationPickerSelection = {name:fallbackName, admin1:'', country:'', lat, lon, elevation:null, timezone:'auto', type:'Point carte'};
  refs.locationPickerCoords.textContent = `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`;
  refs.locationPickerMeta.textContent = 'Recherche du lieu et de l’altitude…';
  refs.locationPickerName.value = fallbackName;
  refs.locationPickerUse.disabled = false;
  setLocationPickerMarker(lat, lon);

  try {
    const resolved = await reverseGeocodeApprox(lat, lon);
    if (requestId !== locationPickerRequest || refs.locationPickerModal.classList.contains('hidden')) return;
    const currentInput = refs.locationPickerName.value.trim();
    locationPickerSelection = {...resolved, lat, lon, type:'Point carte'};
    refs.locationPickerMeta.textContent = pickerMeta(locationPickerSelection);
    if (!currentInput || currentInput === fallbackName) refs.locationPickerName.value = resolved.name || fallbackName;
  } catch {
    if (requestId !== locationPickerRequest) return;
    refs.locationPickerMeta.textContent = 'Point sans nom connu · coordonnées conservées';
  }
}
function renderLocationPickerSearchResults(items) {
  if (!refs.locationPickerSearchResults) return;
  refs.locationPickerSearchResults.innerHTML = items.length
    ? items.map((place,i) => `<button type="button" data-picker-result="${i}"><span class="search-kind-icon">${['Sommet','Col','Volcan'].includes(place.type)?'△':place.type==='Lac'?'≈':'⌖'}</span><div><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml([place.type,place.admin1,place.country].filter(Boolean).join(' · '))}${place.elevation!=null?` · <b>${Math.round(place.elevation)} m</b>`:''}</small></div></button>`).join('')
    : '<div class="search-empty">Aucun lieu trouvé</div>';
  refs.locationPickerSearchResults.classList.remove('hidden');
  refs.locationPickerSearchResults.querySelectorAll('[data-picker-result]').forEach(button => {
    button.addEventListener('click', () => {
      const place = items[Number(button.dataset.pickerResult)];
      if (!place) return;
      refs.locationPickerSearchInput.value = place.name;
      closePickerSearchResults();
      setLocationPickerPlace(place, {moveMap:true, zoom:13});
    });
  });
}
async function locateLocationPickerSelf() {
  if (!navigator.geolocation) {
    showToast('Géolocalisation non prise en charge.', 'warn');
    return;
  }
  refs.locationPickerLocate?.setAttribute('aria-busy','true');
  navigator.geolocation.getCurrentPosition(async pos => {
    try {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      const resolved = await reverseGeocodeApprox(lat, lon);
      setLocationPickerPlace({...resolved, lat, lon, type:'Point carte'}, {moveMap:true, zoom:15});
      refs.locationPickerSearchInput.value = resolved.name || '';
      closePickerSearchResults();
    } catch {
      setLocationPickerPlace({
        name:pickerFallbackName(pos.coords.latitude,pos.coords.longitude),
        admin1:'', country:'', lat:pos.coords.latitude, lon:pos.coords.longitude,
        elevation:null, timezone:'auto', type:'Point carte'
      }, {moveMap:true, zoom:15});
      showToast('Position trouvée, nom du lieu indisponible.', 'warn');
    } finally {
      refs.locationPickerLocate?.removeAttribute('aria-busy');
    }
  }, () => {
    refs.locationPickerLocate?.removeAttribute('aria-busy');
    showToast('Position non accessible. Autorise la localisation dans le navigateur.', 'warn');
  }, {enableHighAccuracy:true, timeout:10000, maximumAge:60000});
}

const searchLocationPicker = debounce(async q => {
  const query = q.trim();
  if (query !== refs.locationPickerSearchInput.value.trim()) return;
  if (query.length < 2) {
    closePickerSearchResults();
    return;
  }
  refs.locationPickerSearchResults.innerHTML = '<div class="search-empty">Recherche…</div>';
  refs.locationPickerSearchResults.classList.remove('hidden');
  try {
    const items = await geocode(query, 7);
    if (query !== refs.locationPickerSearchInput.value.trim()) return;
    renderLocationPickerSearchResults(items);
  } catch {
    refs.locationPickerSearchResults.innerHTML = '<div class="search-empty">Recherche indisponible</div>';
    refs.locationPickerSearchResults.classList.remove('hidden');
  }
}, 450);
async function useLocationPickerSelection() {
  if (!locationPickerSelection || state.loading) return;
  const customName = refs.locationPickerName.value.trim();
  const place = {
    ...locationPickerSelection,
    name:customName || pickerFallbackName(locationPickerSelection.lat, locationPickerSelection.lon),
    type:'Point carte'
  };
  rememberSearch(place);
  closeLocationPicker();
  refs.searchInput.value = place.name;
  refs.searchInput.blur();
  showView('forecast');
  await loadLocation(place);
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

function forecastNowLocal(date=new Date()) {
  const tz=state.location?.timezone;
  if(tz && tz!=='auto'){
    try{
      const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
      return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    }catch{}
  }
  return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
function currentHourly() {
  if (!state.forecast?.hourly?.length) return null;
  return state.forecast.hourly[nearestIndex(state.forecast.hourly.map(x=>x.time), forecastNowLocal())];
}

function renderAll() {
  const f = state.forecast;
  if (!f) return;
  const c = f.current || {};
  const hNow = currentHourly() || {};
  const currentCode = Number(c.precipitation ?? 0) >= 0.1 ? c.weather_code : (hNow.display_weather_code ?? c.weather_code ?? hNow.weather_code);
  const info = weatherCodeInfo(currentCode, c.is_day);
  const loc = state.location;

  refs.locationName.textContent = loc.name || 'Lieu sélectionné';
  updateNowClock();
  const elevation = Number(loc.elevation ?? f.elevation);
  refs.locationElevation.textContent = Number.isFinite(elevation) ? `${Math.round(elevation)} m` : 'alt. —';
  refs.locationMeta.textContent = [loc.type && loc.type !== 'Localité' ? loc.type : '', loc.admin1, loc.country].filter(Boolean).join(' · ');
  if (document.activeElement !== refs.searchInput) refs.searchInput.value = loc.name || '';
  refs.currentTemp.textContent = `${Math.round(c.temperature_2m ?? hNow.temperature_2m ?? 0)}°`;
  const uvNow = Number(hNow.uv_index);
  refs.currentCondition.textContent = Number.isFinite(uvNow) ? `${info.label} · UV ${round(uvNow,1)}` : info.label;
  refs.feelsLike.textContent = `Ressenti ${Math.round(c.apparent_temperature ?? hNow.apparent_temperature ?? 0)}°C`;
  refs.lastUpdated.textContent = formatUpdateAge(c.time || hNow.time);
  refs.weatherGlyph.innerHTML = weatherIcon({...hNow,...c,display_weather_code:currentCode,weather_code:currentCode}, c.is_day);
  try { renderHeroScene({...c, weather_code:currentCode},hNow); } catch (err) { console.warn('Scene météo actuelle',err); }
  try { renderFutureWeather(); } catch (err) { console.warn('Scène météo future',err); }

  const today = f.daily?.[0];
  refs.sunriseTime.textContent = formatClock(today?.sunrise);
  refs.sunriseTime.dateTime = today?.sunrise || '';
  refs.sunsetTime.textContent = formatClock(today?.sunset);
  refs.sunsetTime.dateTime = today?.sunset || '';

  const conf = confidenceForHorizon(1);
  refs.confidence.querySelector('strong').textContent = `${conf}%`;
  refs.confidence.title = 'Indice indicatif lié principalement à l’échéance de prévision ; il ne remplace pas une prévision d’ensemble.';

  const lpn = hNow.snowLevel;
  const visibilityNow = Number(hNow.visibility);
  const pressureNow = Number(c.pressure_msl ?? hNow.pressure_msl);
  const cloudNow = Number(hNow.cloud_cover);
  const nowPrecip = {...hNow, ...c, snowLevel:hNow.snowLevel, wet_bulb_temperature_2m:hNow.wet_bulb_temperature_2m, elevation};
  const metrics = [
    [precipitationLabel(nowPrecip), formatPrecipitation(nowPrecip), '◌'],
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
  renderSnowFusion();
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


function heroSceneKind(data = {}, isDay = 1) {
  const day = Number(isDay) !== 0;
  const source = data && typeof data === 'object' ? data : {weather_code:data};
  const profile = weatherVisualProfile(source);
  if (profile.kind === 'storm') return 'storm';
  if (profile.kind === 'mixed') return 'mixed';
  if (profile.kind === 'ice') return 'ice';
  if (profile.kind === 'snow') return 'snow';
  if (profile.kind === 'rain') return 'rain';
  if (profile.kind === 'fog') return 'fog';
  if ([2,3].includes(profile.code)) return day ? 'partly-cloudy' : 'night-cloudy';
  return day ? 'sunny' : 'clear-night';
}
function sceneClamp(v,min,max){ return Math.min(max,Math.max(min,v)); }
function sceneIntensity(data,kind){
  const profile=weatherVisualProfile(data);
  const base=profile.intensity==='heavy'?3:profile.intensity==='moderate'?2:1;
  const gust=Math.max(0,Number(data.wind_gusts_10m ?? 0));
  if(kind==='storm'&&gust>=75)return 3;
  if(kind==='storm'&&gust>=55)return Math.max(2,base);
  return base;
}
const ASTRO_RAD=Math.PI/180;
const ASTRO_DAY_MS=86400000;
const ASTRO_J2000=2451545;
const ASTRO_E=23.4397*ASTRO_RAD;
let moonSvgSequence=0;

function zonedLocalDate(time){
  const value=String(time||'');
  const match=value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if(!match) return new Date(time||Date.now());
  const target=Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]),Number(match[4]||12),Number(match[5]||0),Number(match[6]||0));
  const timezone=state.location?.timezone;
  if(!timezone||timezone==='auto') return new Date(target);
  try{
    const offsetAt=ms=>{
      const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
        timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',
        hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
      }).formatToParts(new Date(ms)).map(p=>[p.type,p.value]));
      const shownAsUtc=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),Number(parts.hour),Number(parts.minute),Number(parts.second));
      return shownAsUtc-ms;
    };
    let utc=target-offsetAt(target);
    utc=target-offsetAt(utc);
    return new Date(utc);
  }catch{
    return new Date(target);
  }
}
function astroDays(date){ return date.getTime()/ASTRO_DAY_MS+2440587.5-ASTRO_J2000; }
function astroRightAscension(l,b){ return Math.atan2(Math.sin(l)*Math.cos(ASTRO_E)-Math.tan(b)*Math.sin(ASTRO_E),Math.cos(l)); }
function astroDeclination(l,b){ return Math.asin(Math.sin(b)*Math.cos(ASTRO_E)+Math.cos(b)*Math.sin(ASTRO_E)*Math.sin(l)); }
function astroAzimuth(H,phi,dec){ return Math.atan2(Math.sin(H),Math.cos(H)*Math.sin(phi)-Math.tan(dec)*Math.cos(phi)); }
function astroAltitude(H,phi,dec){ return Math.asin(Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(H)); }
function astroSiderealTime(d,lw){ return ASTRO_RAD*(280.16+360.9856235*d)-lw; }
function astroSolarMeanAnomaly(d){ return ASTRO_RAD*(357.5291+.98560028*d); }
function astroEclipticLongitude(M){
  const C=ASTRO_RAD*(1.9148*Math.sin(M)+.02*Math.sin(2*M)+.0003*Math.sin(3*M));
  return M+C+ASTRO_RAD*102.9372+Math.PI;
}
function astroSunCoords(d){
  const M=astroSolarMeanAnomaly(d),L=astroEclipticLongitude(M);
  return {dec:astroDeclination(L,0),ra:astroRightAscension(L,0)};
}
function astroMoonCoords(d){
  const L=ASTRO_RAD*(218.316+13.176396*d),M=ASTRO_RAD*(134.963+13.064993*d),F=ASTRO_RAD*(93.272+13.229350*d);
  const l=L+ASTRO_RAD*6.289*Math.sin(M),b=ASTRO_RAD*5.128*Math.sin(F),dist=385001-20905*Math.cos(M);
  return {ra:astroRightAscension(l,b),dec:astroDeclination(l,b),dist};
}
function sceneAstronomy(time){
  const lat=Number(state.location?.lat),lon=Number(state.location?.lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)) return null;
  const date=zonedLocalDate(time),d=astroDays(date),phi=sceneClamp(lat,-89.8,89.8)*ASTRO_RAD,lw=-lon*ASTRO_RAD,st=astroSiderealTime(d,lw);
  const sunCoords=astroSunCoords(d),moonCoords=astroMoonCoords(d);
  const sunH=st-sunCoords.ra,moonH=st-moonCoords.ra;
  const sunAltitude=astroAltitude(sunH,phi,sunCoords.dec),sunAzimuth=astroAzimuth(sunH,phi,sunCoords.dec);
  const moonAltitude=astroAltitude(moonH,phi,moonCoords.dec),moonAzimuth=astroAzimuth(moonH,phi,moonCoords.dec);
  const separation=Math.acos(sceneClamp(
    Math.sin(sunCoords.dec)*Math.sin(moonCoords.dec)+Math.cos(sunCoords.dec)*Math.cos(moonCoords.dec)*Math.cos(sunCoords.ra-moonCoords.ra),
    -1,1
  ));
  const sunDistance=149598000;
  const incidence=Math.atan2(sunDistance*Math.sin(separation),moonCoords.dist-sunDistance*Math.cos(separation));
  const brightLimbAngle=Math.atan2(
    Math.cos(sunCoords.dec)*Math.sin(sunCoords.ra-moonCoords.ra),
    Math.sin(sunCoords.dec)*Math.cos(moonCoords.dec)-Math.cos(sunCoords.dec)*Math.sin(moonCoords.dec)*Math.cos(sunCoords.ra-moonCoords.ra)
  );
  const illumination=sceneClamp((1+Math.cos(incidence))/2,0,1);
  const rawPhase=.5+.5*incidence*(brightLimbAngle<0?-1:1)/Math.PI;
  const phase=((rawPhase%1)+1)%1;
  return {
    sun:{altitude:sunAltitude,azimuth:sunAzimuth},
    moon:{altitude:moonAltitude,azimuth:moonAzimuth,illumination,phase,brightLimbAngle}
  };
}
function moonPhaseFallback(time){
  const jd=zonedLocalDate(time).getTime()/ASTRO_DAY_MS+2440587.5;
  const phase=(((jd-2451550.25972)/29.530588853)%1+1)%1;
  return {phase,illumination:(1-Math.cos(2*Math.PI*phase))/2};
}
function moonPhaseName(phase){
  const p=((phase%1)+1)%1;
  if(p<.03125||p>=.96875)return 'Nouvelle lune';
  if(p<.21875)return 'Premier croissant';
  if(p<.28125)return 'Premier quartier';
  if(p<.46875)return 'Gibbeuse croissante';
  if(p<.53125)return 'Pleine lune';
  if(p<.71875)return 'Gibbeuse décroissante';
  if(p<.78125)return 'Dernier quartier';
  return 'Dernier croissant';
}
function moonIlluminatedPath(phase,steps=56){
  const p=((phase%1)+1)%1,r=49,cx=50,cy=50,waxing=p<=.5;
  const q=(waxing?p:1-p)*2*Math.PI,c=Math.cos(q),limb=[],term=[];
  for(let i=0;i<=steps;i++){
    const y=-r+2*r*i/steps,s=Math.sqrt(Math.max(0,r*r-y*y));
    limb.push([cx+(waxing?s:-s),cy+y]);
  }
  for(let i=steps;i>=0;i--){
    const y=-r+2*r*i/steps,s=Math.sqrt(Math.max(0,r*r-y*y));
    term.push([cx+(waxing?c*s:-c*s),cy+y]);
  }
  return [...limb,...term].map((point,i)=>(i?'L':'M')+point[0].toFixed(2)+' '+point[1].toFixed(2)).join(' ')+' Z';
}
function sceneMoonSvg(moon){
  const id='mwMoon'+(++moonSvgSequence),path=moonIlluminatedPath(moon.phase);
  const flip=Number(state.location?.lat)<0?-1:1;
  return '<svg viewBox="0 0 100 100" focusable="false" aria-hidden="true" style="--moon-flip:'+flip+'">'+
    '<defs>'+
      '<radialGradient id="'+id+'g" cx="34%" cy="29%" r="78%"><stop offset="0" stop-color="#fffbe5"/><stop offset=".52" stop-color="#f1e6bb"/><stop offset="1" stop-color="#c9bf98"/></radialGradient>'+
      '<clipPath id="'+id+'c"><path d="'+path+'"/></clipPath>'+
    '</defs>'+
    '<circle cx="50" cy="50" r="49" fill="#bdd0da" fill-opacity=".12"/>'+
    '<g clip-path="url(#'+id+'c)">'+
      '<circle cx="50" cy="50" r="49" fill="url(#'+id+'g)"/>'+
      '<circle cx="33" cy="31" r="6.5" fill="#b8ae8b" fill-opacity=".22"/>'+
      '<circle cx="61" cy="25" r="4" fill="#b8ae8b" fill-opacity=".18"/>'+
      '<circle cx="69" cy="53" r="8" fill="#a99f80" fill-opacity=".17"/>'+
      '<circle cx="42" cy="67" r="5.5" fill="#b8ae8b" fill-opacity=".18"/>'+
      '<circle cx="25" cy="57" r="3.5" fill="#a99f80" fill-opacity=".15"/>'+
    '</g>'+
    '<circle cx="50" cy="50" r="49" fill="none" stroke="#fff8db" stroke-opacity=".15" stroke-width="1"/>'+
  '</svg>';
}
function sceneSunPosition(time,fallbackDay){
  const days=state.forecast?.daily||[],date=String(time||'').slice(0,10);
  const index=days.findIndex(d=>d.time===date),daily=days[index],t=new Date(time||Date.now()).getTime();
  const rise=daily?.sunrise?new Date(daily.sunrise).getTime():NaN,set=daily?.sunset?new Date(daily.sunset).getTime():NaN;
  let isDay=Boolean(fallbackDay),fraction;
  if(Number.isFinite(t)&&Number.isFinite(rise)&&Number.isFinite(set)&&set>rise){
    isDay=t>=rise&&t<set;
    if(isDay) fraction=(t-rise)/(set-rise);
    else{
      const previousSet=index>0&&days[index-1]?.sunset?new Date(days[index-1].sunset).getTime():set-86400000;
      const nextRise=index<days.length-1&&days[index+1]?.sunrise?new Date(days[index+1].sunrise).getTime():rise+86400000;
      const start=t<rise?previousSet:set,end=t<rise?rise:nextRise;
      fraction=(t-start)/Math.max(1,end-start);
    }
  }else{
    const hour=Number(String(time||'').slice(11,13))+Number(String(time||'').slice(14,16)||0)/60;
    isDay=Number.isFinite(hour)?hour>=7&&hour<19:isDay;
    fraction=isDay?(hour-7)/12:hour>=19?(hour-19)/12:(hour+5)/12;
  }
  const f=sceneClamp(fraction,0,1),astro=sceneAstronomy(time);
  if(astro&&Number.isFinite(astro.sun.altitude)&&Number.isFinite(astro.sun.azimuth)){
    const altDeg=astro.sun.altitude/ASTRO_RAD,above=Math.max(0,Math.sin(Math.max(0,astro.sun.altitude)));
    return {
      isDay,
      x:sceneClamp(50+32*Math.sin(astro.sun.azimuth),14,86),
      y:74-60*above,
      brightness:.70+.38*above,
      twilight:sceneClamp(1-Math.abs(altDeg)/12,0,1),
      astro
    };
  }
  const altitude=Math.sin(Math.PI*f);
  const twilight=sceneClamp(1-Math.min(f,1-f)/.13,0,1);
  return {isDay,x:20+60*f,y:74-(isDay?53:47)*altitude,brightness:.65+.45*altitude,twilight,astro:null};
}
function sceneMoonState(time,astro,fallbackPos){
  const phaseData=astro?.moon&&Number.isFinite(astro.moon.phase)
    ? {phase:astro.moon.phase,illumination:astro.moon.illumination}
    : moonPhaseFallback(time);
  const alt=astro?.moon?.altitude,az=astro?.moon?.azimuth;
  const hasPosition=Number.isFinite(alt)&&Number.isFinite(az),above=hasPosition?Math.max(0,Math.sin(Math.max(0,alt))):0;
  return {
    ...phaseData,
    name:moonPhaseName(phaseData.phase),
    visible:hasPosition?alt>-1.5*ASTRO_RAD:true,
    altitude:hasPosition?alt:null,
    x:hasPosition?sceneClamp(50+32*Math.sin(az),14,86):fallbackPos.x,
    y:hasPosition?74-58*above:fallbackPos.y
  };
}
function renderWeatherScene(container,data={}){
  if(!container)return;
  const time=data.time||forecastNowLocal(),pos=sceneSunPosition(time,Number(data.is_day ?? isDayAt(time)));
  const astro=pos.astro||sceneAstronomy(time),moon=sceneMoonState(time,astro,pos);
  const profile=weatherVisualProfile(data),kind=heroSceneKind(data,pos.isDay),intensity=sceneIntensity(data,kind);
  const clouds=sceneClamp(Number(data.cloud_cover ?? (['rain','snow','storm','fog','mixed','ice'].includes(kind)?88:kind.includes('cloudy')?55:6)),0,100);
  const wind=Math.max(0,Number(data.wind_speed_10m ?? 0)),gust=Math.max(0,Number(data.wind_gusts_10m ?? 0)),uv=Math.max(0,Number(data.uv_index ?? 0));
  const visibility=Number(data.visibility);
  const snowHaze=kind==='snow'&&intensity===3;
  const blizzardLevel=snowHaze&&(gust>=70||(Number.isFinite(visibility)&&visibility<1000))?2
    :snowHaze&&(gust>=45||(Number.isFinite(visibility)&&visibility<3000))?1:0;
  const rainCurtain=(kind==='rain'||kind==='storm')&&intensity===3;
  const rainCurtainLevel=rainCurtain&&(
      profile.precipitation>=10||gust>=70||(Number.isFinite(visibility)&&visibility<1000)
    )?2:rainCurtain?1:0;
  const cloudLevel=sceneClamp(Math.ceil(clouds/34),0,3);
  const rainCount=kind==='storm'?[0,10,22,38][intensity]
    :kind==='mixed'?[0,5,10,16][intensity]
    :kind==='ice'?[0,6,13,22][intensity]
    :kind==='rain'?[0,6,15,30][intensity]:0;
  const snowCount=kind==='mixed'?[0,5,11,18][intensity]:kind==='snow'?[0,6,16,32][intensity]:0;
  const hailCount=profile.hail?[0,4,8,14][intensity]:(profile.freezing?[0,2,5,9][intensity]:0);
  const rainSpeed=intensity===3?.38:intensity===2?.62:1.02;
  const snowSpeed=intensity===3?2.7:intensity===2?4.2:6.6;
  const hailSpeed=intensity===3?.62:intensity===2?.84:1.12;
  const drops=Array.from({length:rainCount},(_,i)=>{
    const length=intensity===3?22+(i%4)*3:intensity===2?17+(i%3)*2:12+(i%3)*2;
    const width=intensity===3?2.4:intensity===2?2:1.6;
    return '<i style="left:'+(2+((i*17)%96))+'%;height:'+length+'px;width:'+width+'px;animation-delay:'+(-i*.065).toFixed(2)+'s;animation-duration:'+(rainSpeed+(i%5)*.035).toFixed(2)+'s"></i>';
  }).join('');
  const flakes=Array.from({length:snowCount},(_,i)=>{
    const size=intensity===3?5+(i%4):intensity===2?4+(i%3):3+(i%2);
    const drift=blizzardLevel===2?22+(i%5)*5:blizzardLevel===1?12+(i%4)*4:0;
    return '<i style="left:'+(2+((i*23)%95))+'%;width:'+size+'px;height:'+size+'px;--snow-drift:'+drift+'px;--snow-drift-half:'+(drift*.45).toFixed(1)+'px;animation-delay:'+(-i*.19).toFixed(2)+'s;animation-duration:'+(snowSpeed+(i%6)*.22).toFixed(2)+'s"></i>';
  }).join('');
  const pellets=Array.from({length:hailCount},(_,i)=>{
    const size=profile.hail?(intensity===3?5+(i%3):4+(i%2)):3+(i%2);
    return '<i style="left:'+(3+((i*29)%94))+'%;width:'+size+'px;height:'+size+'px;animation-delay:'+(-i*.11).toFixed(2)+'s;animation-duration:'+(hailSpeed+(i%4)*.06).toFixed(2)+'s"></i>';
  }).join('');
  const stars=Array.from({length:13},(_,i)=>'<i style="left:'+(4+((i*23)%88))+'%;top:'+(10+((i*13)%55))+'%;animation-delay:'+(-i*.18).toFixed(2)+'s"></i>').join('');
  const role=container.classList.contains('future-scene')?'future-scene':'current-scene';
  const moonVisible=moon.visible&&moon.illumination>.008;
  container.className='hero-scene '+role+' '+kind+' '+(pos.isDay?'phase-day':'phase-night')+' intensity-'+intensity+' cloud-'+cloudLevel+(moonVisible?' moon-visible':'')+(profile.hail?' hail':'')+(profile.freezing?' freezing':'')+(snowHaze?' snow-haze':'')+(blizzardLevel?' blizzard-'+blizzardLevel:'')+(rainCurtain?' rain-curtain rain-curtain-'+rainCurtainLevel:'');
  container.dataset.sceneKind=kind;
  container.dataset.sceneIntensity=String(intensity);
  container.style.setProperty('--sun-x',pos.x+'%');container.style.setProperty('--sun-y',pos.y+'%');container.style.setProperty('--sun-brightness',String(pos.brightness));
  container.style.setProperty('--moon-x',moon.x+'%');container.style.setProperty('--moon-y',moon.y+'%');
  container.style.setProperty('--sun-alpha',String(sceneClamp((.45+uv*.05)*(1-clouds*.004),.18,.98)));
  container.style.setProperty('--orb-alpha',String(sceneClamp((1-clouds/120)*(.72+uv*.04),.08,.92)));
  container.style.setProperty('--moon-alpha',String(sceneClamp((1-clouds/125)*(.18+.82*Math.sqrt(moon.illumination)),.03,.94)));
  container.style.setProperty('--moon-day-alpha',String(sceneClamp((1-clouds/130)*(.06+.24*Math.sqrt(moon.illumination)),.03,.28)));
  container.style.setProperty('--twilight-alpha',String(pos.twilight*(1-clouds/150)));
  container.style.setProperty('--cloud-speed',sceneClamp(18-wind*.16,7,18)+'s');
  container.style.setProperty('--snow-haze-alpha',snowHaze?String(blizzardLevel===2?.72:blizzardLevel===1?.55:.38):'0');
  container.style.setProperty('--snow-haze-speed',(blizzardLevel===2?2.4:blizzardLevel===1?3.8:6.5)+'s');
  container.style.setProperty('--rain-curtain-alpha',rainCurtain?String(rainCurtainLevel===2?.70:.46):'0');
  container.style.setProperty('--rain-curtain-speed',(rainCurtainLevel===2?.72:1.05)+'s');
  container.style.setProperty('--rain-slant',(gust>=70?'-18deg':gust>=45?'-13deg':'-9deg'));
  container.style.setProperty('--flash-duration',(intensity===3?2.35:intensity===2?4.4:7.8)+'s');
  container.style.setProperty('--storm-flash-alpha',intensity===3?'1':intensity===2?'.72':'.48');
  container.innerHTML='<div class="scene-glow"></div><div class="scene-twilight"></div><div class="scene-stars">'+stars+'</div><div class="scene-sun"><span></span></div><div class="scene-moon">'+sceneMoonSvg(moon)+'</div><div class="scene-horizon"></div><div class="scene-cloud scene-cloud-a"><b></b><em></em></div><div class="scene-cloud scene-cloud-b"><b></b><em></em></div><div class="scene-cloud scene-cloud-c"><b></b><em></em></div><div class="scene-rain">'+drops+'</div><div class="scene-snow">'+flakes+'</div><div class="scene-hail">'+pellets+'</div><div class="scene-snow-haze"><i></i><i></i><i></i></div><div class="scene-rain-curtain"><i></i><i></i><i></i></div><div class="scene-fog"><i></i><i></i><i></i></div>'+(kind==='storm'?'<div class="scene-lightning"></div>'+(intensity===3?'<div class="scene-lightning scene-lightning-secondary"></div>':''):'');
}
function renderHeroScene(current={},hourly={}){
  renderWeatherScene(refs.heroScene,{...hourly,...current,time:forecastNowLocal(),weather_code:current.weather_code ?? hourly.display_weather_code ?? hourly.weather_code,is_day:current.is_day ?? isDayAt(hourly.time ?? new Date().toISOString()),uv_index:hourly.uv_index,cape:hourly.cape,cloud_cover:current.cloud_cover ?? hourly.cloud_cover});
}
function futureHourly(offset=state.futureOffset){
  const hours=state.forecast?.hourly||[]; if(!hours.length)return null; const now=currentHourly(); let i=now?hours.indexOf(now):-1; if(i<0)i=nearestIndex(hours.map(x=>x.time),forecastNowLocal()); return hours[Math.min(hours.length-1,Math.max(0,i+Number(offset||0)))]||null;
}
function updateNowClock(){
  if(refs.nowClock) refs.nowClock.textContent=forecastNowLocal().slice(11,16).replace(':','h');
  if(refs.futureClock) refs.futureClock.textContent=forecastNowLocal(new Date(Date.now()+state.futureOffset*3600000)).slice(11,16).replace(':','h');
}
function renderFutureWeather(){
  const h=futureHourly(); if(!h||!refs.futureScene)return; const day=isDayAt(h.time), code=h.display_weather_code ?? h.weather_code, info=weatherCodeInfo(code,day); renderWeatherScene(refs.futureScene,{...h,weather_code:code,is_day:day});
  updateNowClock();
  refs.futureTemp.textContent=Math.round(h.temperature_2m ?? 0)+'°'; refs.futureCondition.textContent=info.label; const precip=Number(h.precipitation ?? 0), prob=Math.round(h.precipitation_probability ?? 0), gust=Math.round(h.wind_gusts_10m ?? 0);
  refs.futureMeta.textContent='Prévision '+formatHour(h.time)+' · '+(precip>0||isSnowForecast(h)?formatPrecipitation(h):prob+'% précip.')+' · raf. '+gust+' km/h'; $$('[data-future-offset]').forEach(b=>b.classList.toggle('active',Number(b.dataset.futureOffset)===state.futureOffset));
}

function weatherIcon(weather = 0, isDay = 1) {
  const day = isDay !== 0;
  const profile = weatherVisualProfile(weather);
  const {code, kind, intensity, hail} = profile;
  const cloud = '<path class="wx-cloud" d="M21 43h27a9 9 0 0 0 .8-18 14 14 0 0 0-26-4A11 11 0 0 0 21 43Z"/>';
  const sun = '<circle class="wx-sun" cx="24" cy="23" r="8"/><g class="wx-rays"><path d="M24 7v5M24 34v5M8 23h5M35 23h5M13 12l4 4M31 30l4 4M35 12l-4 4M17 30l-4 4"/></g>';
  const moon = '<path class="wx-moon" d="M31 10a15 15 0 1 0 14 22A13 13 0 0 1 31 10Z"/>';

  const rainArt = (level = 'moderate', xs = null) => {
    const positions = xs || (level === 'light' ? [36] : level === 'heavy' ? [18,27,36,45,54] : [24,36,48]);
    const length = level === 'heavy' ? 9 : level === 'light' ? 6 : 7;
    return `<g class="wx-rain">${positions.map((x,i)=>`<path d="m${x} ${49 + (i%2)}-3 ${length}"/>`).join('')}</g>`;
  };
  const snowflake = (x, y, r = 4) => {
    const d = r * .87;
    return `<path d="M${x} ${y-r}v${r*2}M${x-d} ${y-r/2}l${d*2} ${r}M${x+d} ${y-r/2}l-${d*2} ${r}"/>`;
  };
  const snowArt = (level = 'moderate') => {
    const flakes = level === 'light'
      ? [[36,54,4]]
      : level === 'heavy'
        ? [[22,52,3.5],[34,57,3.5],[46,51,3.5],[53,59,2.8]]
        : [[28,53,4],[44,57,4]];
    return `<g class="wx-snow">${flakes.map(([x,y,r])=>snowflake(x,y,r)).join('')}</g>`;
  };
  const iceArt = (level = 'moderate') =>
    `${rainArt(level, level === 'heavy' ? [20,32,44,54] : level === 'light' ? [30] : [24,38,50])}<g class="wx-ice"><path d="M48 52l3 3-3 3-3-3Z"/></g>`;
  const hailArt = (heavy = false) => {
    const stones = heavy ? [[19,54,2.1],[30,59,2],[43,53,2.2],[53,59,2]] : [[25,56,2],[46,56,2]];
    return `<g class="wx-hail">${stones.map(([x,y,r])=>`<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>`;
  };
  const mixedArt = () => `<g class="wx-rain"><path d="m25 49-3 7"/></g><g class="wx-snow">${snowflake(45,55,4)}</g>`;
  const bolt = '<path class="wx-bolt" d="m35 46-7 10h7l-3 8 11-13h-7l4-5Z"/>';
  const smallBolt = '<path class="wx-bolt wx-bolt-secondary" d="m48 45-4 6h4l-2 5 7-8h-4l3-3Z"/>';

  let art = '';
  if ([0,1].includes(code)) art = day ? sun : moon;
  else if ([2,3].includes(code)) art = `${day ? sun : moon}${cloud}`;
  else if ([45,48].includes(code)) art = `${cloud}<g class="wx-precip"><path d="M17 50h32M14 56h28"/></g>`;
  else if (kind === 'mixed') art = `${cloud}${mixedArt()}`;
  else if (kind === 'ice') art = `${cloud}${iceArt(intensity)}`;
  else if (kind === 'rain') art = `${cloud}${rainArt(intensity)}`;
  else if (kind === 'snow') {
    if (code === 77) art = `${cloud}<g class="wx-hail wx-snow-grains"><circle cx="27" cy="53" r="1.4"/><circle cx="38" cy="57" r="1.4"/><circle cx="49" cy="52" r="1.4"/></g>`;
    else art = `${cloud}${snowArt(intensity)}`;
  } else if (kind === 'storm') {
    const stormRain = rainArt(intensity === 'light' ? 'light' : intensity, intensity === 'heavy' ? [18,50] : [20,49]);
    art = `${cloud}${stormRain}${bolt}${intensity === 'heavy' ? smallBolt : ''}${hail ? hailArt(code === 99 || intensity === 'heavy') : ''}`;
  } else art = cloud;
  return `<span class="wx-icon wx-${kind} wx-${intensity}" aria-hidden="true"><svg viewBox="0 0 64 64" focusable="false">${art}</svg></span>`;
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

  const hasLocalConsensus = hours.some(h => h.localConsensus);
  if (!hasLocalConsensus) {
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

  const counts = { clear:0, partial:0, cloud:0, robustRain:0, possibleRain:0, showers:0, snow:0, storm:0, fog:0 };
  for (const h of hours) {
    const code = Number(h.display_weather_code ?? h.weather_code);
    const rawCode = Number(h.weather_code);
    const signal = precipitationSignal(h);
    if ([71,73,75,77,85,86].includes(rawCode)) { counts.snow++; continue; }
    if ([95,96,99].includes(rawCode) && signal.robust) { counts.storm++; continue; }
    if (signal.wetCode) {
      if (signal.robust) counts.robustRain++;
      else counts.possibleRain++;
      if (signal.showerCode) counts.showers++;
      if (signal.possible) {
        if (code <= 1) counts.clear++;
        else if (code === 2) counts.partial++;
        else counts.cloud++;
      }
      continue;
    }
    if (code <= 1) counts.clear++;
    else if (code === 2) counts.partial++;
    else if (code === 3) counts.cloud++;
    else if (code === 45 || code === 48) counts.fog++;
  }
  const n = hours.length;
  const robustWet = counts.robustRain + counts.snow + counts.storm;
  const possibleWet = counts.possibleRain;
  const bright = counts.clear + counts.partial;
  if (robustWet / n >= .5) {
    if (counts.snow > counts.robustRain) return 'Neige fréquente';
    if (counts.storm > counts.robustRain) return 'Temps orageux';
    return counts.showers >= counts.robustRain * .6 ? 'Averses fréquentes' : 'Pluie fréquente';
  }
  if (robustWet >= 2 && robustWet / n >= .18 && bright / n >= .3)
    return counts.snow > counts.robustRain ? 'Éclaircies et neige possible' : 'Éclaircies et passages pluvieux';
  if (possibleWet >= 2) return bright / n >= .3 ? 'Éclaircies, averses localisées possibles' : 'Averses localisées possibles';
  if (possibleWet === 1) return 'Risque d’averse localisée';
  if (counts.clear / n >= .6) return 'Ciel généralement dégagé';
  if (bright / n >= .6) return 'Alternance de soleil et de nuages';
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
  if (h.localConsensus?.localized) bits.push(`<strong>Microclimat</strong> · risque d’averses localisées, modèles/secteurs voisins dispersés`);
  else if (h.localConsensus?.disagreement) bits.push(`<strong>Prévision locale incertaine</strong> · modèles en désaccord sur les précipitations`);
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
    [precipitationLabel(h), formatPrecipitation(h, {rate:true}), 'precip'],
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
  const idx=nearestIndex(f.hourly.map(x=>x.time), forecastNowLocal());
  const slice=f.hourly.slice(idx, idx+24);
  const vals=slice.map(x=>x.temperature_2m);
  const {path,min,max,points}=svgPath(vals);
  const area = path ? `${path} L720,150 L0,150 Z` : '';
  refs.tempChart.innerHTML = `<defs><linearGradient id="lineg" x1="0" x2="1"><stop stop-color="#72ebff"/><stop offset="1" stop-color="#7a72ff"/></linearGradient><linearGradient id="areag" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#62ddff" stop-opacity=".28"/><stop offset="1" stop-color="#62ddff" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#areag)"/><path d="${path}" fill="none" stroke="url(#lineg)" stroke-width="4" vector-effect="non-scaling-stroke"/>${points.map((p,i)=>i%4===0||i===points.length-1?`<g><circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#dffbff"/><text class="temp-point-label" x="${clamp(p[0],24,696)}" y="${p[1]<38?p[1]+24:p[1]-11}" text-anchor="middle">${Math.round(vals[i])}°</text><title>${formatHour(slice[i].time)} : ${round(vals[i],1)} °C</title></g>`:'').join('')}`;
  refs.tempRangeLabel.textContent = `${Math.round(min)}° → ${Math.round(max)}°`;
  refs.tempTimeAxis.innerHTML = slice.map((hour,i) =>
    i%4===0 || i===slice.length-1
      ? `<span style="left:${slice.length>1?i/(slice.length-1)*100:0}%" class="${i===0?'first':i===slice.length-1?'last':''}">${formatHour(hour.time)}</span>`
      : ''
  ).join('');
}

function hourlyPrecipitation(h) {
  return Number(h.precipitation ?? 0) > 0 || Number(h.snowfall ?? 0) > 0
    ? formatPrecipitation(h, {icon:true}) : '';
}

function renderHourly(dateStr) {
  const f=state.forecast; if (!f?.hourly?.length) return;
  const now=forecastNowLocal();
  let startIndex=nearestIndex(f.hourly.map(x=>x.time),now);
  while(startIndex < f.hourly.length-1 && f.hourly[startIndex].time < now) startIndex++;
  const items=f.hourly.slice(Math.max(0,startIndex));
  const previousLocation=refs.hourlyRail.dataset.location;
  const previousScroll=refs.hourlyRail.scrollLeft;
  const locationKey=favoriteKey(state.location);

  refs.hourlyRail.innerHTML=items.map(h=>{
    return `<button class="hour-card" data-hour="${escapeHtml(h.time)}">
      <span class="hour-time">${formatHour(h.time)}</span>
      <span class="hour-glyph">${weatherIcon(h, isDayAt(h.time))}</span>
      <strong>${Math.round(h.temperature_2m)}°</strong>
      <span class="hour-meta"><small class="precip">${Math.round(h.precipitation_probability ?? 0)}%</small>${hourlyPrecipitation(h)?`<small class="hour-amount" title="Cumul prévu pendant cette heure">${hourlyPrecipitation(h)}</small>`:''}<small>raf. ${Math.round(h.wind_gusts_10m ?? 0)}</small></span>
    </button>`;
  }).join('');
  refs.hourlyRail.querySelectorAll('[data-hour]').forEach(btn=>btn.addEventListener('click',()=>openHour(btn.dataset.hour)));
  refs.hourlyRail.dataset.date=dateStr || '';
  refs.hourlyRail.dataset.location=locationKey;
  refs.hourlyRail.scrollLeft=previousLocation===locationKey ? previousScroll : 0;
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
    requestAnimationFrame(()=>view.syncVisibleDayHeader?.());
  }));
  let swipeStartX = 0, swipeStartY = 0, swipeTracking = false;
  view.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) { swipeTracking = false; return; }
    swipeStartX = event.touches[0].clientX;
    swipeStartY = event.touches[0].clientY;
    swipeTracking = true;
  }, {passive:true});
  view.addEventListener('touchend', event => {
    if (!swipeTracking || !event.changedTouches.length) return;
    const dx = event.changedTouches[0].clientX - swipeStartX;
    const dy = event.changedTouches[0].clientY - swipeStartY;
    swipeTracking = false;
    if (dx > 85 && Math.abs(dx) > Math.abs(dy) * 1.35) closeDayDetail();
  }, {passive:true});
  view.addEventListener('touchcancel', () => { swipeTracking = false; }, {passive:true});

  let dayHeaderFrame = 0;
  const syncVisibleDayHeader = () => {
    dayHeaderFrame = 0;
    if (view.classList.contains('hidden')) return;
    const header = view.querySelector('.day-detail-bar');
    const dateLabel = view.querySelector('#dayDetailDate');
    const rows = [...view.querySelectorAll('[data-day-hour]')];
    if (!header || !dateLabel || !rows.length) return;
    const viewTop = view.getBoundingClientRect().top;
    const targetY = viewTop + header.getBoundingClientRect().height + 10;
    let activeRow = rows[0];
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (rect.top <= targetY) activeRow = row;
      if (rect.top > targetY) break;
    }
    const visibleDate = activeRow.dataset.dayHour?.slice(0,10);
    if (visibleDate) dateLabel.textContent = formatDetailDate(visibleDate);
  };
  view.addEventListener('scroll', () => {
    if (dayHeaderFrame) return;
    dayHeaderFrame = requestAnimationFrame(syncVisibleDayHeader);
  }, {passive:true});
  view.syncVisibleDayHeader = syncVisibleDayHeader;
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
  view.querySelectorAll('[data-day-step]').forEach(b=>b.classList.toggle('active',Number(b.dataset.dayStep)===state.dayDetailStep));
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
      <div class="day-overview-icon">${weatherIcon(midday || d, 1)}</div>
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
      <div><span>${precipitationLabel(d)}</span><strong>${formatPrecipitation(d)}</strong><small>${Math.round(d.precipProb ?? 0)}% max</small></div>
      <div><span>Vent / rafales</span><strong>${Math.round(d.windMax ?? 0)} / ${Math.round(d.gustMax ?? 0)}</strong><small>km/h · ${cardinal(d.windDir)}</small></div>
      <div><span>Humidité moy.</span><strong>${meanHumidity!=null?Math.round(meanHumidity)+'%':'—'}</strong></div>
      <div><span>Pression moy.</span><strong>${meanPressure!=null?Math.round(meanPressure)+' hPa':'—'}</strong></div>
      <div><span>Visibilité mini</span><strong>${minVis!=null?(minVis/1000).toFixed(1)+' km':'—'}</strong></div>
      <div><span>UV max</span><strong>${Number.isFinite(uv)?round(uv,1):'—'}</strong></div>
      <div><span>LPN la plus basse</span><strong>${minSnow!=null?'~'+Math.round(minSnow)+' m':'—'}</strong></div>
      <div><span>ISO 0 °C mini</span><strong>${minZero!=null?Math.round(minZero)+' m':'—'}</strong></div>
      <div><span>CAPE max</span><strong>${maxCape!=null?Math.round(maxCape)+' J/kg':'—'}</strong></div>
      <div><span>Neige cumulée</span><strong>${d.snowfallEstimated?'≈':''}${round(d.snowfall ?? 0,1)} cm</strong></div>
    </div>`;

  renderDayDetailRows();
  view.classList.remove('hidden');
  document.body.classList.add('day-detail-open');
  view.scrollTop = 0;
  const start = [...view.querySelectorAll('.day-hour-row')].find(row=>Number(row.dataset.dayHour.slice(11,13))>=8);
  if (start) view.scrollTop = start.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop - view.querySelector('.day-detail-bar').offsetHeight - 8;
  requestAnimationFrame(()=>view.syncVisibleDayHeader?.());
}

function renderDayDetailRows() {
  const view = document.querySelector('#dayDetailView');
  if (!view || !state.dayDetailDate) return;
  const rows = view.querySelector('#dayDetailRows');
  const step = state.dayDetailStep || 1;
  const availableDates = new Set((state.forecast?.daily || []).map(day => day.time));
  const hours = (state.forecast?.hourly || []).filter(h => {
    const date = h.time.slice(0,10);
    const hour = Number(h.time.slice(11,13));
    return date >= state.dayDetailDate && availableDates.has(date) && Number.isFinite(hour) && hour % step === 0;
  });
  let renderedDate = state.dayDetailDate;

  rows.innerHTML = hours.map(h=>{
    const hourDate = h.time.slice(0,10);
    const dateDivider = hourDate !== renderedDate
      ? `<div class="day-detail-date-divider"><span>${escapeHtml(formatDetailDate(hourDate))}</span></div>`
      : '';
    renderedDate = hourDate;
    const day = isDayAt(h.time);
    const info = weatherCodeInfo(h.display_weather_code ?? h.weather_code, day);
    const vis = Number(h.visibility);
    const cloud = Number(h.cloud_cover);
    const pressure = Number(h.pressure_msl);
    const humidity = Number(h.relative_humidity_2m);
    const uv = Number(h.uv_index);
    const cape = Number(h.cape);
    return `${dateDivider}<div class="day-hour-entry"><button type="button" class="day-hour-row" data-day-hour="${escapeHtml(h.time)}" aria-expanded="false" aria-controls="science-${escapeHtml(h.time)}">
      <span class="day-hour-time"><strong>${formatHour(h.time)}</strong><small>${day?'jour':'nuit'}</small></span>
      <span class="day-hour-weather">${weatherIcon(h, day)}<small>${escapeHtml(info.label)}</small></span>
      <span class="day-hour-temp"><strong>${Math.round(h.temperature_2m)}°</strong><small>ress. ${Math.round(h.apparent_temperature ?? h.temperature_2m)}°</small></span>
      <span class="day-hour-wind"><strong><i class="wind-arrow" style="--wind-dir:${Number(h.wind_direction_10m ?? 0)}deg">↑</i> ${Math.round(h.wind_speed_10m ?? 0)} km/h</strong><small>raf. ${Math.round(h.wind_gusts_10m ?? 0)} · ${cardinal(h.wind_direction_10m)}</small>${hourlyPrecipitation(h)?`<small class="day-hour-amount" title="Cumul prévu pendant cette heure">${hourlyPrecipitation(h)}</small>`:''}</span>
      <span class="day-hour-chevron">⌄</span>
    </button>
    <div id="science-${escapeHtml(h.time)}" class="day-hour-extra" hidden><div class="day-hour-science">
        <span><b>${precipitationLabel(h)}</b><strong>${formatPrecipitation(h)} · ${Math.round(h.precipitation_probability ?? 0)}%</strong><small>${isSnowForecast(h) && !h.snowfallEstimated && Number(h.rain ?? 0)>0?`pluie ${round(h.rain,1)} mm`:isSnowForecast(h)?(h.snowfallEstimated?'neige estimée':'cumul de neige prévu'):`pluie ${round(h.rain ?? 0,1)} mm`}</small></span>
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
    const sunshineSource=d.effectiveSunshineDuration ?? d.sunshineDuration;
    const sunshineSeconds=sunshineSource == null ? null : Number(sunshineSource);
    const sunshineHours=Number.isFinite(sunshineSeconds) && sunshineSeconds >= 0 ? sunshineSeconds / 3600 : null;
    const dayHour = representativeHour(d.time, 14);
    const nightHour = representativeHour(d.time, 23) || representativeHour(d.time, 2);
    const windRange = windRangeForDate(d.time);
    const windText = windRange ? `${windRange[0]}–${windRange[1]}` : `${Math.round(d.windMax ?? 0)}`;
    const uvValue = Number(d.uv);
    const uvText = d.uv != null && Number.isFinite(uvValue) ? round(uvValue,1) : '—';
    return `<button class="forecast-row ${active?'selected':''}" data-day="${d.time}">
      <span class="forecast-date"><strong>${i===0?'Aujourd’hui':formatDay(d.time).split(' ')[0]}</strong><small>${new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'2-digit'}).format(new Date(`${d.time}T12:00:00`))}</small></span>
      <span class="forecast-weather"><span class="forecast-icons">${weatherIcon(dayHour || d,1)}${weatherIcon(nightHour || d,0)}</span><small>${escapeHtml(daylightCondition(d))}</small></span>
      <span class="forecast-temps"><strong>${Math.round(d.max)}°</strong><em>${Math.round(d.min)}°</em></span>
      <span class="forecast-metrics">
        <span><i class="wind-arrow" style="--wind-dir:${Number(d.windDir ?? 0)}deg">↑</i> ${windText} km/h <small>raf. ${Math.round(d.gustMax ?? 0)}</small></span>
        <span>${formatPrecipitation(d, {icon:true})} <small>${Math.round(d.precipProb ?? 0)}%</small></span>
        <span class="forecast-sunshine" title="Ensoleillement estimé : rayonnement horaire, lever/coucher, nuages et précipitations">☀ ${sunshineHours!=null?`${round(sunshineHours,1)} h`:'—'} <small>${conf}% fiab.</small></span>
        <span class="forecast-uv">UV max. ${uvText}</span>
      </span>
      <span class="forecast-chevron">›</span>
    </button>`;
  }).join('');
  refs.dailyGrid.querySelectorAll('[data-day]').forEach(btn=>btn.addEventListener('click',()=>{
    openDayDetail(btn.dataset.day);
  }));
}



function renderSnowFusion() {
  if (!refs.snowFusionPanel || !state.forecast) return;
  refs.snowFusionPanel.hidden = !state.snowPanelOpen;
  refs.snowFusionToggle?.setAttribute('aria-expanded',String(state.snowPanelOpen));
  if (!state.snowPanelOpen) return;
  const f=state.forecast;
  const active=f.snowFusion?.active===true;
  const days=f.daily?.slice(0,15)||[];
  refs.snowFusionSource.textContent=active
    ? 'Prévisions AROME / ICON / ECMWF combinées · probabilités issues des membres ECMWF si disponibles.'
    : 'Prévisions de secours Open-Meteo Best Match · SnowFusion indisponible ou hors de France métropolitaine.';
  const first=days[0];
  const todaySnow=first?.snowfall!=null?round(Math.max(0,Number(first.snowfall)),1)+' cm':'—';
  const firstDepth=first?.snowFusion?.snowpack?.depth ??
    f.hourly?.filter(h=>h.time.startsWith(first?.time||'') && Number.isFinite(Number(h.snow_depth))).at(-1)?.snow_depth*100;
  const totalDepth=firstDepth!=null && Number.isFinite(Number(firstDepth))?round(Number(firstDepth),1)+' cm':'—';
  const chance=first?.snowFusion?.ensemble?.probability;
  refs.snowFusionHighlights.innerHTML=[
    ['❄','Neige fraîche aujourd’hui',todaySnow],
    ['▰','Neige au sol ce soir',totalDepth],
    ['◌','Risque de neige (ensemble)',chance!=null?chance+' %':'—']
  ].map(([icon,label,value])=>'<div class="snowfusion-highlight"><span>'+icon+' '+label+'</span><strong>'+escapeHtml(value)+'</strong></div>').join('');
  const rows=days.map(d=>{
    const sf=d.snowFusion, ensemble=sf?.ensemble;
    const ending=f.hourly?.filter(h=>h.time.startsWith(d.time)).at(-1);
    const depth=sf?.snowpack?.depth ?? (ending?.snow_depth!=null?Number(ending.snow_depth)*100:null);
    const old=sf?.snowpack?.old;
    const fresh=sf?.snowpack?.fresh;
    const showCm=n=>n!=null && Number.isFinite(Number(n)) ? round(Number(n),1)+' cm' : '—';
    const showPercent=n=>n!=null ? Math.round(Number(n))+' %' : '—';
    const range=ensemble?.low!=null && ensemble?.high!=null
      ? showCm(ensemble.low)+' – '+showCm(ensemble.high) : '—';
    return '<tr><th scope="row">'+escapeHtml(formatDay(d.time))+'</th>'+
      '<td><strong>'+showCm(d.snowfall)+'</strong></td>'+
      '<td>'+showCm(depth)+'</td>'+
      '<td>'+showCm(fresh)+' / '+showCm(old)+'</td>'+
      '<td>'+showPercent(ensemble?.probability)+'</td>'+
      '<td>'+showPercent(ensemble?.p5)+'</td>'+
      '<td>'+showPercent(ensemble?.p10)+'</td>'+
      '<td>'+range+'</td></tr>';
  }).join('');
  refs.snowFusionTable.innerHTML='<table class="snowfusion-table"><thead><tr>'+
    '<th>Jour</th><th>Neige fraîche</th><th>Au sol</th><th>Fraîche / ancienne</th>'+
    '<th>Neige ≥ 0,1 cm</th><th>≥ 5 cm</th><th>≥ 10 cm</th><th>Fourchette 10–90 %</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table>'+
    '<p class="snowfusion-table-help">Neige fraîche : cumul prévu sur la journée. Au sol : hauteur estimée en fin de journée. Un tiret signifie donnée non disponible, jamais zéro neige supposé.</p>';
}

function toggleSnowFusion(open) {
  state.snowPanelOpen=Boolean(open);
  renderSnowFusion();
  if (state.snowPanelOpen) refs.snowFusionPanel?.scrollIntoView({behavior:'smooth',block:'start'});
  else refs.snowFusionToggle?.focus();
}

function mountainHourForPeriod(fallback = null) {
  const hours = state.forecast?.hourly || [];
  if (!hours.length) return fallback;
  const baseTime = state.forecast?.current?.time || fallback?.time || new Date();
  const baseIndex = nearestIndex(hours.map(x => x.time), baseTime);
  const offset = state.mountainPeriod === 'tomorrow' ? 24 : state.mountainPeriod === '7d' ? 168 : 0;
  return hours[clamp(baseIndex + offset, 0, hours.length - 1)] || fallback || hours[0];
}

function mountainAltitudeTop(altitude, maxAlt) {
  const top = 5.5;
  const bottom = 94;
  const safe = clamp(Number(altitude) || 0, 0, maxAlt);
  return top + (1 - safe / maxAlt) * (bottom - top);
}

function updateMountainScale(maxAlt) {
  const labels = refs.mountainVisual?.querySelectorAll('.mountain-altitude-scale span');
  if (!labels?.length) return;
  labels.forEach((label,index) => {
    const fraction = 1 - index / Math.max(1, labels.length - 1);
    label.textContent = `${Math.round(maxAlt * fraction).toLocaleString('fr-FR')} m`;
  });
}

function setMountainAltitudeLine(ref, altitude, maxAlt, name, value) {
  if (!ref) return null;
  const valid = Number.isFinite(Number(altitude));
  ref.hidden = !valid;
  if (!valid) return null;
  const top = mountainAltitudeTop(Number(altitude), maxAlt);
  ref.style.top = `${top}%`;
  const nameNode = ref.querySelector('.alt-line-name');
  const valueNode = ref.querySelector('.alt-line-value');
  if (nameNode) nameNode.textContent = name;
  if (valueNode) valueNode.textContent = value;
  return top;
}

function bindMountainControls() {
  if (!refs.mountainPeriodTabs || refs.mountainPeriodTabs.dataset.bound) return;
  refs.mountainPeriodTabs.dataset.bound = '1';
  refs.mountainPeriodTabs.addEventListener('click', event => {
    const button = event.target.closest('[data-mountain-period]');
    if (!button) return;
    state.mountainPeriod = button.dataset.mountainPeriod;
    renderMountain();
  });
}

function renderMountain(fallbackHour = null) {
  if (!state.forecast || !refs.mountainStats) return;
  bindMountainControls();

  const h = mountainHourForPeriod(fallbackHour);
  if (!h) return;

  refs.mountainPeriodTabs?.querySelectorAll('[data-mountain-period]').forEach(button => {
    const active = button.dataset.mountainPeriod === state.mountainPeriod;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });

  const elevation = Number(state.location.elevation ?? state.forecast.elevation ?? 0);
  const zero = Number(h.freezing_level_height);
  const snow = Number(h.snowLevel);
  const highest = Math.max(
    5000,
    elevation,
    Number.isFinite(zero) ? zero + 350 : 0,
    Number.isFinite(snow) ? snow + 350 : 0
  );
  const maxAlt = Math.min(8000, Math.ceil(highest / 1000) * 1000);
  updateMountainScale(maxAlt);

  const zeroTop = setMountainAltitudeLine(
    refs.zeroLine,
    zero,
    maxAlt,
    'Niveau 0 °C',
    Number.isFinite(zero) ? `${Math.round(zero)} m` : '—'
  );
  const snowTop = setMountainAltitudeLine(
    refs.snowLine,
    snow,
    maxAlt,
    'LPN estimée',
    Number.isFinite(snow) ? `~${Math.round(snow)} m` : '—'
  );
  const placeTop = setMountainAltitudeLine(
    refs.placeLine,
    elevation,
    maxAlt,
    'Altitude du lieu',
    `${Math.round(elevation)} m`
  );

  [refs.zeroLine, refs.snowLine, refs.placeLine].forEach(line => line?.classList.remove('shift-up','shift-down'));
  if (zeroTop != null && snowTop != null && Math.abs(zeroTop - snowTop) < 8) {
    refs.zeroLine?.classList.add('shift-up');
    refs.snowLine?.classList.add('shift-down');
  }
  if (snowTop != null && placeTop != null && Math.abs(snowTop - placeTop) < 7) {
    refs.placeLine?.classList.add('shift-down');
  }

  const precip = Number(h.precipitation ?? 0);
  const snowHere = Number.isFinite(snow) && elevation >= snow - 100 && precip > 0;
  const statusTitle = snowHere ? 'Neige possible' : precip > 0 ? 'Précipitations à surveiller' : 'Conditions stables';
  const statusText = snowHere
    ? `LPN estimée vers ${Math.round(snow)} m à cette échéance.`
    : precip > 0
      ? `${precipitationLabel(h)} : ${formatPrecipitation(h, {rate:true})}.`
      : 'Pas de précipitation à cette échéance.';
  if (refs.mountainStatusTitle) refs.mountainStatusTitle.textContent = statusTitle;
  if (refs.mountainStatusText) refs.mountainStatusText.textContent = statusText;
  if (refs.mountainStatusIcon) refs.mountainStatusIcon.textContent = snowHere ? '❄' : precip > 0 ? '☂' : '☀';
  if (refs.mountainStatus) refs.mountainStatus.dataset.level = snowHere ? 'snow' : precip > 0 ? 'wet' : 'calm';

  const snowDepth = h.snow_depth != null && Number.isFinite(Number(h.snow_depth))
    ? Math.max(0, Number(h.snow_depth) * 100)
    : null;
  const feels = Number(h.apparent_temperature);
  const wind = Number(h.wind_speed_10m);
  const gust = Number(h.wind_gusts_10m);
  const direction = cardinal(Number(h.wind_direction_10m));

  const stats = [
    ['△','Altitude du lieu', `${Math.round(elevation)} m`, '', 'place'],
    ['❄','LPN estimée', Number.isFinite(snow) ? `~${Math.round(snow)} m` : '—', '', 'snow'],
    ['♨','Niveau 0 °C', Number.isFinite(zero) ? `${Math.round(zero)} m` : '—', '', 'zero'],
    ['▰','Neige au sol', snowDepth != null ? `${round(snowDepth,1)} cm` : '—', 'modèle', 'snowpack'],
    ['🌡','Temp. ressentie', Number.isFinite(feels) ? `${round(feels,1)} °C` : '—', '', 'feels'],
    ['≋','Vent / rafales',
      Number.isFinite(wind) || Number.isFinite(gust)
        ? `${Number.isFinite(wind) ? Math.round(wind) : '—'} / ${Number.isFinite(gust) ? Math.round(gust) : '—'} km/h`
        : '—',
      direction !== '—' ? `du ${direction}` : '',
      'wind']
  ];

  refs.mountainStats.innerHTML = stats.map(([icon,label,value,meta,kind]) => `
    <div class="mountain-summary-card" data-kind="${kind}">
      <span class="mountain-summary-icon" aria-hidden="true">${icon}</span>
      <span class="mountain-summary-copy">
        <span>${label}</span>
        <strong>${value}</strong>
        ${meta ? `<small>${meta}</small>` : ''}
      </span>
    </div>
  `).join('');
}

function openHour(time) {
  const h=state.forecast.hourly.find(x=>x.time===time); if (!h) return;
  const info=weatherCodeInfo(h.display_weather_code ?? h.weather_code,1);
  refs.modalTitle.textContent=formatDateTime(h.time);
  refs.modalSub.textContent=`${state.location.name} · ${info.label}`;
  refs.modalGlyph.innerHTML=weatherIcon(h, isDayAt(h.time));
  refs.modalMain.innerHTML=`<div><span>Température</span><strong>${round(h.temperature_2m,1)}°C</strong><small>Ressenti ${round(h.apparent_temperature,1)}°C</small></div><div><span>${precipitationLabel(h)}</span><strong>${formatPrecipitation(h,{rate:true})}</strong><small>${Math.round(h.precipitation_probability??0)}% de probabilité</small></div><div><span>Vent / rafales</span><strong>${Math.round(h.wind_speed_10m??0)} / ${Math.round(h.wind_gusts_10m??0)}</strong><small>km/h · ${cardinal(h.wind_direction_10m)}</small></div>`;
  const items=[
    ['Pluie',h.snowfallEstimated?'— (phase neige estimée)':`${round(h.rain,1)} mm`],['Averses',`${round(h.showers,1)} mm`],['Neige',`${h.snowfallEstimated?'≈':''}${round(h.snowfall,1)} cm`],['LPN estimée',h.snowLevel!=null?`~${Math.round(h.snowLevel)} m`:'—'],
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
function removeFavorite(place) {
  const key = favoriteKey(place);
  state.favorites = state.favorites.filter(x => favoriteKey(x) !== key);
  saveFavorites();
  updateFavoriteButton();
  renderFavorites();
  renderFavoriteQuickbar();
  showToast('Favori supprimé.');
  const base = state.baseLocation || state.location;
  if (favoriteKey(state.location) === key && favoriteKey(base) !== key) loadLocation(base);
}
function bindFavoriteLongPress(button,place,onSelect) {
  let timer, startX=0, startY=0, longPressed=false;
  const cancel=()=>{clearTimeout(timer);timer=null;};
  const offerRemoval=()=>{
    if(longPressed)return;
    longPressed=true;
    if(navigator.vibrate) navigator.vibrate(20);
    if(window.confirm('Supprimer « '+place.name+' » des favoris ?')) removeFavorite(place);
  };
  button.addEventListener('pointerdown',e=>{
    if(e.button !== 0 || !e.isPrimary)return;
    longPressed=false;startX=e.clientX;startY=e.clientY;
    cancel();
    timer=setTimeout(()=>{timer=null;offerRemoval();},600);
  });
  button.addEventListener('pointermove',e=>{if(Math.hypot(e.clientX-startX,e.clientY-startY)>12)cancel();});
  ['pointerup','pointercancel','pointerleave'].forEach(type=>button.addEventListener(type,cancel));
  button.addEventListener('contextmenu',e=>{e.preventDefault();cancel();offerRemoval();});
  button.addEventListener('click',e=>{
    if(longPressed){e.preventDefault();e.stopImmediatePropagation();longPressed=false;return;}
    onSelect();
  });
}
function renderFavoriteQuickbar(){
  if(!refs.favoriteQuickbar) return;
  const base = state.baseLocation || state.location;
  const baseKey = favoriteKey(base), selectedKey = favoriteKey(state.location);
  const baseIsFavorite = isFavorite(base);
  const items = state.favorites.filter(x => favoriteKey(x) !== baseKey);
  refs.favoriteQuickbar.innerHTML = `<button type="button" class="quick-favorite current-location ${selectedKey===baseKey?'active':''} ${baseIsFavorite?'saved-favorite':''}" data-base-location ${selectedKey===baseKey?'aria-current="true"':''} title="${baseIsFavorite?'Favori enregistré · maintenir pour supprimer':'Lieu de base'}">${baseIsFavorite?'♥ ':''}${escapeHtml(base.name || 'Lieu actuel')}</button>${items.map((x,i)=>`<button type="button" data-quick-fav="${i}" class="quick-favorite ${favoriteKey(x)===selectedKey?'active':''}" title="Maintenir pour supprimer ce favori" ${favoriteKey(x)===selectedKey?'aria-current="true"':''}>♥ ${escapeHtml(x.name)}</button>`).join('')}<button type="button" class="quick-favorite quick-add" data-quick-add>+ Favori</button>`;
  const baseButton=refs.favoriteQuickbar.querySelector('[data-base-location]');
  if(isFavorite(base))bindFavoriteLongPress(baseButton,base,()=>loadLocation(base));
  else baseButton?.addEventListener('click',()=>loadLocation(base));
  refs.favoriteQuickbar.querySelectorAll('[data-quick-fav]').forEach(b=>bindFavoriteLongPress(b,items[Number(b.dataset.quickFav)],()=>loadLocation(items[Number(b.dataset.quickFav)])));
  refs.favoriteQuickbar.querySelector('[data-quick-add]')?.addEventListener('click',e=>{e.stopPropagation();openFavoriteSearch();});
}
function renderFavorites(){
  if(!state.favorites.length){refs.favoritesGrid.innerHTML='<div class="empty-state glass"><div class="empty-icon">♡</div><h2>Aucun favori</h2><p>Ajoute un lieu depuis les prévisions pour le retrouver ici.</p></div>';return;}
  refs.favoritesGrid.innerHTML=state.favorites.map((x,i)=>`<button class="favorite-card glass" data-fav="${i}" title="Maintenir pour supprimer ce favori"><div><span class="favorite-pin">⌖</span><h3>${escapeHtml(x.name)}</h3><p>${escapeHtml([x.admin1,x.country].filter(Boolean).join(' · '))}</p></div><span>→</span></button>`).join('');
  refs.favoritesGrid.querySelectorAll('[data-fav]').forEach(b=>bindFavoriteLongPress(b,state.favorites[Number(b.dataset.fav)],async()=>{showView('forecast');await loadLocation(state.favorites[Number(b.dataset.fav)]);}));
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
  parts.push(pmax>=30||psum>=.2?'Le risque de précipitations atteint <strong>'+pmax+'%</strong>'+(psum>0?', pour environ <strong>'+formatPrecipitation(d)+'</strong> cumulés':'')+'.':'Le risque de précipitations reste faible, avec un maximum proche de <strong>'+pmax+'%</strong>.');
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
  refs.searchInput.focus();
  renderSearchHistory();
}
function addSearchedFavorite(place) {
  rememberSearch(place);
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

function renderSearchHistory() {
  const items=state.searchHistory;
  refs.searchResults.innerHTML=items.length
    ? '<div class="search-history-head"><strong>Recherches récentes</strong><button type="button" data-clear-history>Effacer</button></div>'+items.map((x,i)=>`<button type="button" class="search-history-item" data-history="${i}"><span class="search-kind-icon">↺</span><div><strong>${escapeHtml(x.name)}</strong><small>${escapeHtml([x.admin1,x.country].filter(Boolean).join(' · '))}</small></div></button>`).join('')
    : '<div class="search-empty">Aucune recherche récente. Recherche un lieu pour commencer.</div>';
  refs.searchResults.classList.remove('hidden');
  refs.searchResults.querySelector('[data-clear-history]')?.addEventListener('click',()=>{
    state.searchHistory=[];saveSearchHistory();renderSearchHistory();
  });
  refs.searchResults.querySelectorAll('[data-history]').forEach(b=>b.addEventListener('click',async()=>{
    const place=state.searchHistory[Number(b.dataset.history)];
    if(!place)return;
    refs.searchResults.classList.add('hidden');
    refs.searchInput.value=place.name;
    if(addingFavorite)addSearchedFavorite(place);
    else {rememberSearch(place);refs.searchInput.blur();await loadLocation(place);}
  }));
}

const doSearch=debounce(async q=>{
  if(q !== refs.searchInput.value) return;
  if(q.trim().length<2){renderSearchHistory();return;}
  try{
    const items=await geocode(q,7);
    if(q !== refs.searchInput.value) return;
    refs.searchResults.innerHTML=items.length?items.map((x,i)=>`<button type="button" data-result="${i}"><span class="search-kind-icon">${['Sommet','Col','Volcan'].includes(x.type)?'△':['Lac'].includes(x.type)?'≈':'⌖'}</span><div><strong>${escapeHtml(x.name)} <em class="search-type">${escapeHtml(x.type || 'Lieu')}</em></strong><small>${escapeHtml([x.admin1,x.country].filter(Boolean).join(', '))}${x.elevation!=null?` · <b>${Math.round(x.elevation)} m</b>`:''}</small></div></button>`).join(''):'<div class="search-empty">Aucun lieu trouvé</div>';
    refs.searchResults.classList.remove('hidden');
    refs.searchResults.querySelectorAll('[data-result]').forEach(b=>b.addEventListener('click',async()=>{const place=items[Number(b.dataset.result)];refs.searchResults.classList.add('hidden');if(addingFavorite) addSearchedFavorite(place);else {rememberSearch(place);refs.searchInput.blur();await loadLocation(place);}}));
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
  try{const result=await analyzeRoute(from,to,departure);renderRoute(result);refs.routeResults.classList.remove('hidden');requestAnimationFrame(()=>renderRouteMap(result));}
  catch(err){console.error(err);refs.routeEmpty.classList.remove('hidden');refs.routeEmpty.innerHTML=`<div class="empty-icon">!</div><h2>Analyse impossible</h2><p>${escapeHtml(err.message||'Service temporairement indisponible.')}</p>`;showToast('Impossible d’analyser ce trajet.','warn');}
  finally{refs.routeLoading.classList.add('hidden');}
}

let routeMap=null;
function renderRoute(r){
  if(routeMap){routeMap.remove();routeMap=null;refs.routeSketch.classList.remove('has-map');}
  const pts=r.points, worst=pts.reduce((a,b)=>b.risk.score>a.risk.score?b:a,pts[0]);
  const snowPts=pts.filter(p=>p.snowfall>0 || (p.precipitation>0 && p.snowLevel!=null && p.elevation>=p.snowLevel-150));
  const icePts=pts.filter(p=>p.temperature<=1 && p.precipitation>0);
  refs.routeSummary.innerHTML=`<div class="eyebrow">ITINÉRAIRE</div><h2>${escapeHtml(r.from.name)} <span>→</span> ${escapeHtml(r.to.name)}</h2><div class="route-kpis"><div><strong>${Math.round(r.route.distance/1000)} km</strong><span>distance</span></div><div><strong>${formatDuration(r.route.duration)}</strong><span>durée estimée</span></div><div><strong>${formatDateTime(r.departureDate)}</strong><span>départ</span></div></div>`;
  const label={minimal:'Faible',low:'À surveiller',medium:'Marqué',high:'Élevé'}[worst.risk.level];
  refs.routeRisk.innerHTML=`<div class="eyebrow">SYNTHÈSE MÉTÉO</div><div class="risk-title ${worst.risk.level}"><span></span><div><small>Risque maximal</small><strong>${label}</strong></div></div><p>${snowPts.length?`Neige possible sur ${snowPts.length} point${snowPts.length>1?'s':''} du parcours.`:'Pas de signal neigeux marqué sur les points échantillonnés.'} ${icePts.length?`Risque de chaussée glissante sur ${icePts.length} point${icePts.length>1?'s':''}.`:''}</p><small>Analyse basée sur ${pts.length} points répartis le long de la route.</small>`;
  renderRouteSketch(r);
  refs.routeTimeline.innerHTML=pts.map((p,i)=>{
    const info=weatherCodeInfo(p.code,1); const place=i===0?r.from.name:i===pts.length-1?r.to.name:`Km ${Math.round(p.cumKm)}`;
    return `<article class="route-point glass" data-risk="${p.risk.level}"><div class="route-time"><strong>${new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(p.eta)}</strong><span>${Math.round(p.elevation)} m</span></div><div class="route-dot"></div><div class="route-point-main"><div><h3>${escapeHtml(place)}</h3><p>${info.glyph} ${info.label}${p.risk.reasons.length?` · ${escapeHtml(p.risk.reasons.slice(0,2).join(', '))}`:''}</p></div><div class="route-weather-values"><strong>${round(p.temperature,1)}°</strong><span>${formatPrecipitation({...p,weather_code:p.code},{icon:true})}</span><span>⚑ ${Math.round(p.gust??0)} km/h</span><span>LPN ${p.snowLevel!=null?`~${Math.round(p.snowLevel)} m`:'—'}</span></div></div></article>`;
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
function renderRouteMap(r) {
  const L=window.L;
  if (!L || !refs.routeSketch) return;
  const coords=r.route.geometry.coordinates, pts=r.points;
  if (coords.length<2 || !pts.length) return;
  const fallback=refs.routeSketch.innerHTML;
  refs.routeSketch.classList.add('has-map');
  refs.routeSketch.innerHTML='<div id="routeLeaflet" class="route-leaflet" aria-label="Carte du trajet avec villes et points météo"></div>';
  try {
    routeMap=L.map('routeLeaflet',{scrollWheelZoom:false,doubleClickZoom:false,touchZoom:true,zoomControl:false});
    L.control.zoom({position:'topright'}).addTo(routeMap);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
      maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(routeMap);
    const positions=coords.map(c=>[c[1],c[0]]);
    L.polyline(positions,{color:'#163d4d',weight:10,opacity:.85,interactive:false}).addTo(routeMap);
    const lengths=[0];
    for(let i=1;i<coords.length;i++){
      const lat=(coords[i][1]+coords[i-1][1])/2*Math.PI/180;
      lengths[i]=lengths[i-1]+Math.hypot((coords[i][0]-coords[i-1][0])*Math.cos(lat),coords[i][1]-coords[i-1][1]);
    }
    const total=lengths.at(-1)||1, sections=[];
    for(let i=1;i<positions.length;i++){
      const fraction=(lengths[i-1]+lengths[i])/(2*total);
      const closest=i===positions.length-1?pts.at(-1):pts.reduce((best,p)=>Math.abs(p.fraction-fraction)<Math.abs(best.fraction-fraction)?p:best,pts[0]);
      const level=closest.risk.level;
      if(sections.at(-1)?.level===level) sections.at(-1).path.push(positions[i]);
      else sections.push({level,path:[positions[i-1],positions[i]]});
    }
    const colors={minimal:'#20a977',low:'#22a8d2',medium:'#ed982b',high:'#df4859'};
    sections.forEach(s=>L.polyline(s.path,{color:colors[s.level]||colors.minimal,weight:6,opacity:1,interactive:false,lineCap:'round',lineJoin:'round'}).addTo(routeMap));
    const pin=(place,position,letter,finish=false)=>{
      const icon=L.divIcon({className:'route-pin-holder',html:`<span class="route-pin ${finish?'finish':''}">${letter}</span>`,iconSize:[34,34],iconAnchor:[17,17]});
      L.marker(position,{icon,zIndexOffset:1000}).addTo(routeMap)
        .bindTooltip(escapeHtml(place.name),{permanent:true,direction:finish?'left':'right',offset:finish?[-20,0]:[20,0],className:'route-city-label'})
        .bindPopup(`<strong>${escapeHtml(place.name)}</strong><br>${finish?'Arrivée':'Départ'}`);
    };
    pin(r.from,positions[0],'D');
    pin(r.to,positions.at(-1),'A',true);
    pts.forEach((p,i)=>{
      if(i===0||i===pts.length-1||!(i%4===0||p.risk.score>=3))return;
      const color=colors[p.risk.level]||colors.minimal;
      const time=new Intl.DateTimeFormat('fr-FR',{hour:'2-digit',minute:'2-digit'}).format(p.eta);
      const reason=p.risk.reasons.length?`<br><b>Vigilance :</b> ${escapeHtml(p.risk.reasons.join(', '))}`:'<br>Pas de risque marqué.';
      L.circleMarker([p.lat,p.lon],{radius:p.risk.score>=3?7:6,color:'#fff',weight:2,fillColor:color,fillOpacity:1})
        .addTo(routeMap)
        .bindPopup(`<strong>Km ${Math.round(p.cumKm)} · ${time}</strong><br>${round(p.temperature,1)} °C · ${precipitationLabel({...p,weather_code:p.code}).toLowerCase()} ${formatPrecipitation({...p,weather_code:p.code})} · rafales ${Math.round(p.gust??0)} km/h${reason}`);
    });
    routeMap.fitBounds(L.latLngBounds(positions),{padding:[32,32],maxZoom:12});
    const first=pts.find(p=>p.risk.score>=3);
    const caption=first?`Vigilance vers le km ${Math.round(first.cumKm)} : ${escapeHtml(first.risk.reasons.join(', '))}`:'Aucun risque météo marqué aux points analysés.';
    refs.routeSketch.insertAdjacentHTML('beforeend',`<p class="route-map-caption">${caption}</p><div class="route-map-legend"><span><i class="minimal"></i>Calme</span><span><i class="low"></i>À suivre</span><span><i class="medium"></i>Vigilance</span><span><i class="high"></i>Risque marqué</span></div>`);
    routeMap.invalidateSize();
  } catch(err) {
    console.warn('Carte du trajet indisponible',err);
    if(routeMap){routeMap.remove();routeMap=null;}
    refs.routeSketch.classList.remove('has-map');
    refs.routeSketch.innerHTML=fallback;
  }
}

function setupRouteDefaults(){const d=new Date(Date.now()+3600000);refs.routeDate.min=new Date().toISOString().slice(0,10);refs.routeDate.max=new Date(Date.now()+15*86400000).toISOString().slice(0,10);refs.routeDate.value=d.toISOString().slice(0,10);refs.routeTime.value=`${String(d.getHours()).padStart(2,'0')}:00`;}

function bindEvents(){
  refs.searchInput.addEventListener('focus',()=>{refs.searchInput.select();renderSearchHistory();});
  refs.searchInput.addEventListener('input',e=>{if(e.target.value.trim().length<2)renderSearchHistory();else doSearch(e.target.value);}); refs.searchForm.addEventListener('submit',e=>{e.preventDefault();doSearch(refs.searchInput.value)});
  document.addEventListener('click',e=>{if(!refs.searchForm.contains(e.target)){if(addingFavorite)closeFavoriteSearch();else refs.searchResults.classList.add('hidden');}});
  refs.mapPickerBtn?.addEventListener('click',openLocationPicker);refs.geoBtn.addEventListener('click',useGeolocation);refs.favoriteBtn.addEventListener('click',toggleFavorite);refs.refreshBtn.addEventListener('click',()=>loadLocation(state.location));
  refs.closeLocationPicker?.addEventListener('click',closeLocationPicker);
  refs.locationPickerModal?.addEventListener('click',e=>{if(e.target===refs.locationPickerModal)closeLocationPicker()});
  refs.locationPickerUse?.addEventListener('click',useLocationPickerSelection);
  refs.locationPickerName?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!refs.locationPickerUse.disabled)useLocationPickerSelection()});
  refs.locationPickerSearchInput?.addEventListener('input',e=>searchLocationPicker(e.target.value));
  refs.locationPickerSearchInput?.addEventListener('keydown',e=>{if(e.key==='Escape')closePickerSearchResults()});
  refs.locationPickerLocate?.addEventListener('click',locateLocationPickerSelf);
  refs.locationPickerLayers?.querySelectorAll('[data-picker-layer]').forEach(button=>button.addEventListener('click',()=>setLocationPickerLayer(button.dataset.pickerLayer)));
  window.addEventListener('pagehide', saveFavorites);
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') saveFavorites(); });
  $$('[data-future-offset]').forEach(b=>b.addEventListener('click',()=>{state.futureOffset=Number(b.dataset.futureOffset)||3;renderFutureWeather()}));
  refs.bulletinBtn?.addEventListener('click',openBulletin); refs.closeBulletin?.addEventListener('click',closeBulletin); refs.bulletinModal?.addEventListener('click',e=>{if(e.target===refs.bulletinModal)closeBulletin()});
  $$('[data-bulletin-period]').forEach(b=>b.addEventListener('click',()=>{state.bulletinPeriod=b.dataset.bulletinPeriod;renderWeatherBulletin()}));
  refs.snowFusionToggle?.addEventListener('click',()=>toggleSnowFusion(!state.snowPanelOpen));
  refs.snowFusionClose?.addEventListener('click',()=>toggleSnowFusion(false));
  refs.expertToggle.addEventListener('click',()=>{state.expert=!state.expert;refs.expertToggle.setAttribute('aria-pressed',String(state.expert));refs.expertToggle.classList.toggle('active',state.expert);renderCockpit(state.forecast.current,currentHourly())});
  $$('#mapTabs [data-overlay]').forEach(b=>b.addEventListener('click',()=>{state.mapOverlay=b.dataset.overlay;$$('#mapTabs [data-overlay]').forEach(x=>x.classList.toggle('active',x===b));updateMap()}));
  $$('[data-nav]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.nav)));
  refs.closeModal.addEventListener('click',closeHour);refs.modal.addEventListener('click',e=>{if(e.target===refs.modal)closeHour()});document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(refs.locationPickerModal && !refs.locationPickerModal.classList.contains('hidden')) closeLocationPicker(); else if(!refs.modal.classList.contains('hidden')) closeHour(); else if(refs.bulletinModal && !refs.bulletinModal.classList.contains('hidden')) closeBulletin(); else if(addingFavorite)closeFavoriteSearch(); else closeDayDetail();}});
  refs.routeForm.addEventListener('submit',handleRoute);refs.swapRoute.addEventListener('click',()=>{const a=refs.routeFrom.value;refs.routeFrom.value=refs.routeTo.value;refs.routeTo.value=a});
}

async function registerServiceWorker() {
  if (OFFLINE_TEST || !('serviceWorker' in navigator) || !(location.protocol==='https:'||location.hostname==='localhost')) return;
  try {
    const hadController = Boolean(navigator.serviceWorker.controller);
    const registration = await navigator.serviceWorker.register('./sw.js?v=1.8.7', {updateViaCache:'none'});
    let refreshing = false;
    const checkForUpdate = () => registration.update().catch(()=>{});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || refreshing) return;
      refreshing = true;
      location.reload();
    });
    window.addEventListener('pageshow', checkForUpdate);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    });
    checkForUpdate();
  } catch (err) {
    console.warn('Mise à jour PWA indisponible', err);
  }
}

async function init(){
  if (!loadBaseLocation()) { state.baseLocation=state.baseLocation || state.location; saveBaseLocation(); }
  state.expert = window.matchMedia('(min-width:1101px)').matches;
  refs.expertToggle?.setAttribute('aria-pressed', String(state.expert));
  refs.expertToggle?.classList.toggle('active', state.expert);
  bindEvents();setupRouteDefaults();renderFavorites();renderFavoriteQuickbar();
  setInterval(updateNowClock,30000);
  await loadLocation(state.location,{silent:true});
  if(!OFFLINE_TEST) setInterval(()=>{if(document.visibilityState==='visible'&&!state.loading) loadLocation(state.location,{silent:true})},15*60*1000);
  registerServiceWorker();
}
init();
