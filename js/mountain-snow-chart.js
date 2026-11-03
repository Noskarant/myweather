// Compact 14-day mountain snowfall graph.
// Station heights are named reference levels, not measured snow-depth observations.
// The selected station height is sent as the explicit Open-Meteo elevation parameter.
const NUMBER = new Intl.NumberFormat('fr-FR', {maximumFractionDigits:1});
const HEIGHT = new Intl.NumberFormat('fr-FR', {maximumFractionDigits:0});
const MAX_DAYS = 14;
const CACHE_MS = 15 * 60 * 1000;

export const SNOW_RESORTS = Object.freeze([
  {
    key:'valmorel', name:'Valmorel', names:['valmorel','le meiller','planchamp','lanchettes','col du mottet'],
    latitude:45.462032, longitude:6.442518,
    levels:[
      {key:'village',name:'Village',place:'Valmorel',altitude:1400},
      {key:'mid',name:'Mi-hauteur',place:'Planchamp',altitude:1920},
      {key:'summit',name:'Sommet',place:'Mottet',altitude:2400}
    ]
  },
  {
    key:'val-thorens', name:'Val Thorens', names:['val thorens','cime caron'],
    latitude:45.2975, longitude:6.58,
    levels:[
      {key:'village',name:'Village',place:'Val Thorens',altitude:2300},
      {key:'mid',name:'Mi-hauteur',place:'Funitel 3 Vallées',altitude:2850},
      {key:'summit',name:'Sommet',place:'Cime Caron',altitude:3200}
    ]
  },
  {
    key:'alpe-dhuez', name:'Alpe d’Huez', names:['alpe d huez','alpe dhuez','pic blanc','marmottes'],
    latitude:45.09711, longitude:6.069027,
    levels:[
      {key:'village',name:'Village',place:'Alpe d’Huez',altitude:1860},
      {key:'mid',name:'Mi-hauteur',place:'Marmottes I',altitude:2300,latitude:45.103971,longitude:6.096168},
      {key:'summit',name:'Sommet',place:'Pic Blanc',altitude:3330,latitude:45.124993,longitude:6.127293}
    ]
  },
  {
    key:'chalmazel', name:'Chalmazel', names:['chalmazel','pierre sur haute'],
    latitude:45.67723, longitude:3.82702,
    levels:[
      {key:'village',name:'Bas des pistes',place:'Chalmazel, pied des pistes',altitude:1110},
      {key:'mid',name:'Mi-hauteur',place:'Secteur intermédiaire (repère)',altitude:1350},
      {key:'summit',name:'Sommet',place:'Haut des pistes, Pierre-sur-Haute',altitude:1600}
    ]
  },
  {
    key:'les-menuires', name:'Les Menuires', names:['les menuires','menuires','mont de la chambre','pointe de la masse'],
    latitude:45.32444, longitude:6.5375,
    levels:[
      {key:'village',name:'Village',place:'Les Menuires',altitude:1850},
      {key:'mid',name:'Mi-hauteur',place:'Roc 1',altitude:2320},
      {key:'summit',name:'Sommet',place:'Mont de la Chambre',altitude:2850}
    ]
  },
  {
    key:'orelle', name:'Orelle', names:['orelle','francoz','plan bouchet','pointe du bouchet'],
    latitude:45.209421, longitude:6.536404,
    levels:[
      {key:'village',name:'Village',place:'Francoz',altitude:900},
      {key:'mid',name:'Mi-hauteur',place:'Plan Bouchet',altitude:2350},
      {key:'summit',name:'Sommet',place:'Pointe du Bouchet (secteur ski)',altitude:3230}
    ]
  },
  {
    key:'tignes', name:'Tignes', names:['tignes','val claret','grande motte'],
    levels:[
      {key:'village',name:'Village',place:'Tignes-le-Lac',altitude:2100},
      {key:'mid',name:'Mi-hauteur',place:'Tovière',altitude:2704},
      {key:'summit',name:'Sommet',place:'Grande Motte (arrivée)',altitude:3456}
    ]
  },
  {
    key:'les-arcs', name:'Les Arcs', names:['les arcs','arc 1600','arc 1800','arc 1950','arc 2000','aiguille rouge'],
    levels:[
      {key:'village',name:'Village',place:'Arc 1600',altitude:1600},
      {key:'mid',name:'Mi-hauteur',place:'Arc 2000',altitude:2000},
      {key:'summit',name:'Sommet',place:'Aiguille Rouge',altitude:3226}
    ]
  }
]);

function normalizeName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[’'`´]/g,' ').replace(/[-‐‑–—_]/g,' ').replace(/\s+/g,' ').trim();
}

export function lookupSnowResort(location) {
  const text = normalizeName(location?.name);
  if (!text) return null;
  return SNOW_RESORTS.find(station => station.names.some(alias => text === alias || text.startsWith(alias+' ')))
    || SNOW_RESORTS.find(station => station.names.some(alias => text.includes(alias))) || null;
}

function validSnow(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number*10)/10 : null;
}

export function extractSnowDays(forecast) {
  const daily = forecast?.daily;
  if (Array.isArray(daily))
    return daily.slice(0,MAX_DAYS).filter(day => typeof day?.time === 'string')
      .map(day => ({time:day.time.slice(0,10),snow:validSnow(day.snowfall)}));
  if (Array.isArray(daily?.time))
    return daily.time.slice(0,MAX_DAYS).map((time,index) =>
      ({time:String(time).slice(0,10),snow:validSnow(daily.snowfall_sum?.[index])}));
  return [];
}

function safe(value) {
  return String(value ?? '').replace(/[&<>"']/g, char =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function dateLabel(iso) {
  const date = new Date(iso+'T12:00:00');
  if (!Number.isFinite(date.getTime())) return {day:'—',number:'—',full:'date inconnue'};
  return {
    day:new Intl.DateTimeFormat('fr-FR',{weekday:'short'}).format(date).replace('.','').slice(0,3),
    number:String(date.getDate()),
    full:new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long'}).format(date)
  };
}

function displaySnow(value) {
  return value === null ? '—' : NUMBER.format(value);
}

function displayDays(bars, days, context) {
  if (!bars) return;
  const total = days.reduce((sum,day) => sum + (day.snow ?? 0),0);
  const count = days.filter(day => day.snow !== null).length;
  const peak = Math.max(1, ...days.map(day => day.snow || 0));
  const slots = days.map((day,i) => {
    const snow = day.snow;
    const date = dateLabel(day.time);
    const height = snow === null ? 0 : snow > 0 ? Math.max(3,Math.round((snow / peak) * 100)) : 0;
    const phase = i < 4 ? 'reliable' : i < 9 ? 'probable' : 'trend';
    const highlight = i >= 9 && snow >= 8 ? ' mountain-snow-highlight' : '';
    const tooltip = date.full + ' : ' + (snow===null?'donnée indisponible':displaySnow(snow)+' cm de neige fraîche');
    return '<div class="mountain-snow-slot mountain-snow-'+phase+highlight+'" title="'+safe(tooltip)+'">'+
      '<div class="mountain-snow-stem" style="--snow-height:'+height+'%">'+
      '<span class="mountain-snow-value'+(snow===null?' unavailable':'')+'">'+displaySnow(snow)+'</span>'+
      (snow !== null && snow > 0 ? '<span class="mountain-snow-column" aria-hidden="true"></span>' : '')+
      '</div><div class="mountain-snow-date">'+safe(date.day)+'<strong>'+safe(date.number)+'</strong></div></div>';
  }).join('');
  const totalText = count ? NUMBER.format(Math.round(total*10)/10)+' cm' : '—';
  bars.style.setProperty('--snow-day-count',String(Math.max(1,days.length)));
  bars.setAttribute('aria-label','Neige fraîche prévue par jour sur '+days.length+' jours. Cumul : '+totalText+'. '+context);
  bars.innerHTML = '<div class="mountain-snow-horizons" aria-hidden="true">'+
    '<span>FIABLE</span><span>PROBABLE</span><span>TENDANCE</span></div>'+
    '<div class="mountain-snow-columns">'+slots+'</div>';
  return {totalText,count};
}

function nearestLevel(station, location) {
  const elevation = Number(location?.elevation);
  if (!Number.isFinite(elevation)) return 'village';
  return station.levels.reduce((closest,level) =>
    Math.abs(level.altitude - elevation) < Math.abs(closest.altitude - elevation) ? level : closest,
    station.levels[0]).key;
}

async function requestAltitudeSnow(station, location, level) {
  const latitude = Number(level.latitude ?? station.latitude ?? location?.lat);
  const longitude = Number(level.longitude ?? station.longitude ?? location?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
    throw new Error('Coordonnées de la station indisponibles');
  const params = new URLSearchParams({
    latitude:String(latitude), longitude:String(longitude),
    elevation:String(level.altitude), timezone:'auto', daily:'snowfall_sum',
    forecast_days:String(MAX_DAYS)
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(),10000);
  try {
    const response = await fetch('https://api.open-meteo.com/v1/forecast?'+params,{signal:controller.signal});
    if (!response.ok) throw new Error('Erreur météo '+response.status);
    const payload = await response.json();
    if (!Array.isArray(payload?.daily?.time) || !Array.isArray(payload.daily.snowfall_sum))
      throw new Error('Données neige indisponibles');
    return extractSnowDays(payload);
  } finally {
    clearTimeout(timeout);
  }
}

export function createMountainSnowChart(root) {
  if (!root) return {render(){},reset(){}};
  const controls = root.querySelector('#mountainSnowControls');
  const message = root.querySelector('#mountainSnowMessage');
  const bars = root.querySelector('#mountainSnowBars');
  const note = root.querySelector('#mountainSnowNote');
  const total = root.querySelector('#mountainSnowTotal');
  const cache = new Map();
  const pending = new Map();
  let locationKey = '';
  let selected = 'village';
  let currentLocation = null;
  let currentForecast = null;
  let requestKey = '';


  function showDays(days, source, station, level) {
    const summary = displayDays(bars,days,source);
    if (total) total.textContent = summary?.count ? 'Cumul 14 j · '+summary.totalText : 'Cumul indisponible';
    if (message) message.textContent = summary?.count ? '' : 'Aucune prévision chiffrée disponible.';
    if (note) note.textContent = 'Neige fraîche quotidienne (cm), pas hauteur au sol. '+source+
      (station ? ' · '+station.name+' / '+level.place+' ('+HEIGHT.format(level.altitude)+' m).' : '')+
      ' · Fiable / Probable / Tendance indiquent uniquement l’échéance, pas une probabilité mesurée.';
  }

  function render(location, forecast) {
    if (!location || !forecast) return;
    currentLocation = location;
    currentForecast = forecast;
    const station = lookupSnowResort(location);
    const nextLocationKey = station
      ? 'station:'+station.key
      : 'place:'+location.name+':'+location.lat+':'+location.lon;
    if (locationKey !== nextLocationKey) {
      locationKey = nextLocationKey;
      selected = station ? nearestLevel(station,location) : 'place';
      requestKey = '';
    }
    const level = station?.levels.find(item => item.key === selected) || station?.levels[0];
    const altitudeText = HEIGHT.format(Number(location.elevation) || Number(forecast.elevation) || 0)+' m';
    if (controls) controls.innerHTML = station
      ? '<span class="mountain-snow-station">'+safe(station.name)+'</span>'+
        station.levels.map(item =>
          '<button type="button" class="mountain-snow-level'+(item.key===selected?' active':'')+
          '" data-snow-level="'+safe(item.key)+'" aria-pressed="'+String(item.key===selected)+'"'+
          ' title="'+safe(item.place)+'">'+safe(item.name)+' <small>'+HEIGHT.format(item.altitude)+' m</small></button>'
        ).join('')
      : '<span class="mountain-snow-station">Altitude du lieu · '+altitudeText+'</span>';
    if (!station) {
      requestKey = '';
      showDays(extractSnowDays(forecast),
        forecast.snowFusion?.active ? 'SnowFusion · prévision du lieu' : 'Open-Meteo · prévision du lieu');
      return;
    }
    const key = station.key+':'+level.key+':'+(level.latitude ?? station.latitude ?? location.lat)+':'+(level.longitude ?? station.longitude ?? location.lon);
    requestKey = key;
    const cached = cache.get(key);
    if (cached && Date.now()-cached.savedAt < CACHE_MS) {
      showDays(cached.days,'Open-Meteo · altitude corrigée par le modèle',station,level);
      return;
    }
    if (total) total.textContent = 'Cumul 14 j · —';
    if (note) note.textContent = 'Prévisions journalières Open-Meteo adaptées à '+HEIGHT.format(level.altitude)+' m. Chargement…';
    if (message) message.textContent = 'Chargement des chutes de neige à '+HEIGHT.format(level.altitude)+' m…';
    if (bars) bars.innerHTML = '<div class="mountain-snow-loading">Prévisions en cours de chargement…</div>';
    if (pending.has(key)) return;
    const promise = requestAltitudeSnow(station,location,level);
    pending.set(key,promise);
    promise.then(days => {
      cache.set(key,{days,savedAt:Date.now()});
      if (requestKey === key)
        showDays(days,'Open-Meteo · altitude corrigée par le modèle',station,level);
    }).catch(() => {
      if (requestKey !== key) return;
      if (message) message.innerHTML = 'Prévisions momentanément indisponibles. <button class="mountain-snow-retry" type="button">Réessayer</button>';
      if (bars) bars.innerHTML = '';
      if (note) note.textContent = 'Aucune quantité n’est affichée sans données météo valides.';
    }).finally(() => pending.delete(key));
  }

  root.addEventListener('click', event => {
    const button = event.target.closest('[data-snow-level]');
    if (button && root.contains(button)) {
      selected = button.dataset.snowLevel;
      requestKey = '';
      render(currentLocation,currentForecast);
      controls?.querySelector('[data-snow-level="'+selected+'"]')?.focus();
    }
    if (event.target.closest('.mountain-snow-retry')) {
      requestKey = '';
      render(currentLocation,currentForecast);
    }
  });

  function reset() {
    requestKey = '';
    if (bars) bars.innerHTML = '';
    if (message) message.textContent = 'Prévisions indisponibles.';
    if (total) total.textContent = 'Cumul indisponible';
  }
  return {render,reset};
}
