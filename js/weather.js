import { estimateSnowLevel, snowfallFor, weatherCodeInfo } from './utils.js?v=1.8.2';
import { applySnowFusion, isFrance, SNOWFUSION_MODELS, SNOWFUSION_ENSEMBLE } from './snowfusion.js?v=1.8.7';
import { inRhoneArea, loadRhoneObservations, applyRhoneObservations } from './rhone-observations.js?v=1.8.8';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const ENSEMBLE = 'https://ensemble-api.open-meteo.com/v1/ensemble';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const ELEVATION = 'https://api.open-meteo.com/v1/elevation';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';


export const HOURLY_VARS = [
  'temperature_2m','relative_humidity_2m','dew_point_2m','apparent_temperature','precipitation_probability',
  'precipitation','rain','showers','snowfall','snow_depth','weather_code','cloud_cover','cloud_cover_low','cloud_cover_mid',
  'cloud_cover_high','visibility','wind_speed_10m','wind_direction_10m','wind_gusts_10m','surface_pressure','pressure_msl',
  'uv_index','cape','wet_bulb_temperature_2m','freezing_level_height','sunshine_duration','shortwave_radiation'
];
export const CURRENT_VARS = [
  'temperature_2m','relative_humidity_2m','apparent_temperature','is_day','precipitation','rain','showers','snowfall',
  'weather_code','cloud_cover','pressure_msl','surface_pressure','wind_speed_10m','wind_direction_10m','wind_gusts_10m'
];
export const DAILY_VARS = [
  'weather_code','temperature_2m_max','temperature_2m_min','apparent_temperature_max','apparent_temperature_min',
  'sunrise','sunset','sunshine_duration','uv_index_max','precipitation_sum','rain_sum','showers_sum','snowfall_sum',
  'precipitation_probability_max','wind_speed_10m_max','wind_gusts_10m_max','wind_direction_10m_dominant'
];


const geocodeCache = new Map();
let lastNominatimRequest = 0;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchWithRetry(url, options = {}, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || (response.status < 500 && response.status !== 429)) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) { lastError = err; }
    if (attempt < attempts - 1) await sleep(450 * (attempt + 1));
  }
  throw lastError || new Error('Service réseau indisponible');
}


function placeTypeLabel(category = '', type = '', address = {}) {
  const key = `${category}:${type}`.toLowerCase();
  const labels = [
    [/natural:peak|peak/, 'Sommet'], [/natural:saddle|saddle|mountain_pass/, 'Col'], [/natural:volcano|volcano/, 'Volcan'],
    [/place:hamlet|hamlet/, 'Hameau'], [/place:isolated_dwelling|isolated_dwelling/, 'Lieu-dit'], [/place:locality|locality/, 'Lieu-dit'],
    [/place:village|village/, 'Village'], [/place:town|town/, 'Ville'], [/place:city|city/, 'Ville'], [/place:suburb|suburb/, 'Quartier'],
    [/tourism:alpine_hut|alpine_hut/, 'Refuge'], [/tourism:chalet|chalet/, 'Chalet'], [/tourism:attraction|attraction/, 'Site'],
    [/natural:water|water|lake|reservoir/, 'Lac'], [/waterway:/, 'Cours d’eau'], [/leisure:ski_resort|ski_resort/, 'Station'],
    [/place:neighbourhood|neighbourhood/, 'Quartier']
  ];
  for (const [re,label] of labels) if (re.test(key)) return label;
  if (address.hamlet) return 'Hameau';
  if (address.village) return 'Village';
  if (address.town || address.city) return 'Ville';
  return 'Lieu';
}

function displayPlaceName(x) {
  return x.namedetails?.name || x.namedetails?.['name:fr'] || x.name || String(x.display_name || '').split(',')[0] || 'Lieu';
}

async function terrainElevations(points) {
  if (!points.length) return [];
  const q = new URLSearchParams({
    latitude: points.map(p => Number(p.lat).toFixed(6)).join(','),
    longitude: points.map(p => Number(p.lon).toFixed(6)).join(',')
  });
  try {
    const r = await fetch(`${ELEVATION}?${q}`);
    if (!r.ok) return points.map(() => null);
    const data = await r.json();
    const values = Array.isArray(data.elevation) ? data.elevation : [data.elevation];
    return points.map((_,i) => Number.isFinite(Number(values[i])) ? Number(values[i]) : null);
  } catch { return points.map(() => null); }
}


function destinationPoint(lat, lon, bearingDeg, distanceKm) {
  const R = 6371;
  const brng = Number(bearingDeg) * Math.PI / 180;
  const d = Number(distanceKm) / R;
  const lat1 = Number(lat) * Math.PI / 180;
  const lon1 = Number(lon) * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat:lat2 * 180 / Math.PI, lon:lon2 * 180 / Math.PI };
}

/**
 * Returns a real local terrain transect using the same Open-Meteo elevation
 * endpoint already used by geocoding. The selected place sits around 3 km
 * from the start of the 15 km profile, which keeps the mobile chart readable.
 */
export async function getTerrainProfile(location, options = {}) {
  const lat = Number(location?.lat), lon = Number(location?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const distanceKm = Math.max(3, Math.min(30, Number(options.distanceKm ?? 15)));
  const samples = Math.max(9, Math.min(48, Math.round(Number(options.samples ?? 31))));
  const locationKm = Math.max(0, Math.min(distanceKm, Number(options.locationKm ?? 3)));
  const bearing = Number.isFinite(Number(options.bearing)) ? Number(options.bearing) : 135;
  const start = destinationPoint(lat, lon, bearing + 180, locationKm);
  const points = Array.from({length:samples}, (_,i) => {
    const distance = distanceKm * i / Math.max(1, samples - 1);
    const point = destinationPoint(start.lat, start.lon, bearing, distance);
    return {...point, distanceKm:distance};
  });
  const elevations = await terrainElevations(points);
  return points.map((point,i) => ({
    ...point,
    elevation:Number.isFinite(Number(elevations[i])) ? Number(elevations[i]) : null
  }));
}

async function openMeteoGeocode(name, count) {
  const q = new URLSearchParams({ name, count:String(count), language:'fr', format:'json' });
  const r = await fetch(`${GEOCODE}?${q}`);
  if (!r.ok) throw new Error(`Géocodage indisponible (${r.status})`);
  const data = await r.json();
  return (data.results || []).map(x => ({
    id:`om-${x.id}`, name:x.name, admin1:x.admin1 || x.admin2 || '', country:x.country || '', countryCode:x.country_code || '',
    lat:x.latitude, lon:x.longitude, elevation:x.elevation ?? null, timezone:x.timezone || 'auto', type:'Localité', source:'open-meteo'
  }));
}

export async function geocode(name, count = 8) {
  const query = String(name || '').trim();
  if (!query) return [];
  const cacheKey = `${query.toLocaleLowerCase('fr')}:${count}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 10 * 60_000) return cached.items;

  let osm = [];
  try {
    const wait = Math.max(0, 1050 - (Date.now() - lastNominatimRequest));
    if (wait) await sleep(wait);
    lastNominatimRequest = Date.now();
    const q = new URLSearchParams({
      q:query, format:'jsonv2', addressdetails:'1', namedetails:'1', extratags:'1', limit:String(Math.min(16, Math.max(count * 2, 10))), 'accept-language':'fr'
    });
    const r = await fetch(`${NOMINATIM}?${q}`);
    if (r.ok) {
      const data = await r.json();
      const mapped = data.map(x => {
        const address = x.address || {};
        const taggedEle = Number.parseFloat(x.extratags?.ele);
        return {
          id:`osm-${x.osm_type}-${x.osm_id}`,
          name:displayPlaceName(x),
          admin1:address.state || address.region || address.county || address.municipality || address.city || address.town || '',
          country:address.country || '', countryCode:(address.country_code || '').toUpperCase(),
          lat:Number(x.lat), lon:Number(x.lon), elevation:Number.isFinite(taggedEle) ? taggedEle : null,
          timezone:'auto', type:placeTypeLabel(x.category, x.type, address), source:'openstreetmap', importance:Number(x.importance || 0)
        };
      }).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));
      const missing = mapped.filter(x => x.elevation == null);
      const elevations = await terrainElevations(missing);
      missing.forEach((x,i) => { if (elevations[i] != null) x.elevation = elevations[i]; });
      const seen = new Set();
      osm = mapped.filter(x => {
        const key = `${x.name.toLowerCase()}|${x.lat.toFixed(4)}|${x.lon.toFixed(4)}`;
        if (seen.has(key)) return false; seen.add(key); return true;
      }).slice(0, count);
    }
  } catch (err) { console.warn('Recherche OpenStreetMap indisponible', err); }

  let items = osm;
  if (items.length < Math.min(3, count)) {
    try {
      const fallback = await openMeteoGeocode(query, count);
      const existing = new Set(items.map(x => `${x.name.toLowerCase()}|${Number(x.lat).toFixed(3)}|${Number(x.lon).toFixed(3)}`));
      items = [...items, ...fallback.filter(x => !existing.has(`${x.name.toLowerCase()}|${Number(x.lat).toFixed(3)}|${Number(x.lon).toFixed(3)}`))].slice(0,count);
    } catch (err) { if (!items.length) throw err; }
  }
  geocodeCache.set(cacheKey, {time:Date.now(), items});
  return items;
}

export async function reverseGeocodeApprox(lat, lon) {
  try {
    const q = new URLSearchParams({lat:String(lat), lon:String(lon), format:'jsonv2', addressdetails:'1', zoom:'14', 'accept-language':'fr'});
    const [r, elevations] = await Promise.all([fetch(`${NOMINATIM_REVERSE}?${q}`), terrainElevations([{lat,lon}])]);
    if (r.ok) {
      const x = await r.json(); const a=x.address || {};
      return { name:a.hamlet || a.village || a.town || a.city || a.locality || x.name || 'Ma position', admin1:a.state || a.county || '', country:a.country || '', lat, lon, elevation:elevations[0], timezone:'auto', type:'Position' };
    }
  } catch {}
  const [elevation] = await terrainElevations([{lat,lon}]);
  return { name:'Ma position', admin1:`${lat.toFixed(3)}, ${lon.toFixed(3)}`, country:'', lat, lon, elevation, timezone:'auto', type:'Position' };
}


function finiteWeatherNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clockMinutes(value) {
  const match = String(value || '').match(/T(\d{2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function sunshineConsistencyFactor(hour = {}) {
  const clamp01 = value => Math.max(0, Math.min(1, value));
  const total = finiteWeatherNumber(hour.cloud_cover);
  const low = finiteWeatherNumber(hour.cloud_cover_low);
  const mid = finiteWeatherNumber(hour.cloud_cover_mid);
  const high = finiteWeatherNumber(hour.cloud_cover_high);
  const blockers = [
    total == null ? 0 : total * 0.72,
    low == null ? 0 : low,
    mid == null ? 0 : mid * 0.85,
    high == null ? 0 : high * 0.45
  ];
  const effectiveCloud = Math.max(...blockers, 0);
  let factor = 1 - Math.pow(clamp01(effectiveCloud / 100), 1.25);

  const precipitation = Math.max(0, finiteWeatherNumber(hour.precipitation) ?? 0);
  const code = finiteWeatherNumber(hour.weather_code);
  if (precipitation >= 2) factor *= 0.05;
  else if (precipitation >= 0.5) factor *= 0.18;
  else if (precipitation >= 0.1) factor *= 0.35;
  else if ([45,48].includes(code)) factor *= 0.18;
  else if ([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) factor *= 0.45;
  else if ([71,73,75,77,85,86].includes(code)) factor *= 0.3;
  else if ([95,96,99].includes(code)) factor *= 0.12;

  return clamp01(factor);
}

/**
 * User-facing sunshine estimate.
 * Starts from Open-Meteo hourly sunshine duration (WMO/DNI > 120 W/m²),
 * clips every hourly amount to the astronomical sunrise/sunset window,
 * and applies a consistency cap from clouds/precipitation/fog.
 * This prevents a mostly overcast or rainy day from displaying implausibly
 * high sunshine totals while preserving the scientific radiation signal.
 */
export function estimateEffectiveSunshineSeconds(day, hours = []) {
  const sunrise = clockMinutes(day?.sunrise);
  const sunset = clockMinutes(day?.sunset);
  if (sunrise == null || sunset == null || sunset <= sunrise) {
    const raw = finiteWeatherNumber(day?.sunshineDuration);
    return raw == null ? null : Math.max(0, raw);
  }

  const daylightSeconds = (sunset - sunrise) * 60;
  const sameDay = hours.filter(hour => String(hour?.time || '').startsWith(String(day?.time || '')));
  if (!sameDay.length) {
    const raw = finiteWeatherNumber(day?.sunshineDuration);
    return raw == null ? null : Math.min(Math.max(0, raw), daylightSeconds);
  }

  let totalSeconds = 0;
  let usableHours = 0;
  for (const hour of sameDay) {
    const endMinute = clockMinutes(hour.time);
    if (endMinute == null) continue;
    const startMinute = endMinute - 60;
    const overlapMinutes = Math.max(0, Math.min(endMinute, sunset) - Math.max(startMinute, sunrise));
    if (overlapMinutes <= 0) continue;

    const overlapSeconds = overlapMinutes * 60;
    const consistencyCap = overlapSeconds * sunshineConsistencyFactor(hour);
    const rawHourly = finiteWeatherNumber(hour.sunshine_duration);
    if (rawHourly != null) {
      totalSeconds += Math.min(Math.max(0, rawHourly), overlapSeconds, consistencyCap);
      usableHours++;
    } else {
      totalSeconds += consistencyCap;
    }
  }

  if (!usableHours && totalSeconds === 0) {
    const raw = finiteWeatherNumber(day?.sunshineDuration);
    if (raw != null) return Math.min(Math.max(0, raw), daylightSeconds);
  }
  return Math.round(Math.min(Math.max(0, totalSeconds), daylightSeconds));
}


const SHORT_RANGE_MODELS = ['best_match','ecmwf_ifs','icon_global','ukmo_global_deterministic_10km'];
const WET_WEATHER_CODES = new Set([51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99]);

function isWetWeatherCode(code) {
  return WET_WEATHER_CODES.has(Number(code));
}

function medianWeather(values = []) {
  const sorted = values.map(finiteWeatherNumber).filter(value => value != null).sort((a,b)=>a-b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function ratioWeather(value) {
  const n = finiteWeatherNumber(value);
  return n == null ? null : Math.max(0, Math.min(1, n));
}

async function optionalWithTimeout(promise, timeoutMs = 1800, fallback = null) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise(resolve => { timer = setTimeout(() => resolve(fallback), timeoutMs); })
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function precipitationSignal(data = {}) {
  const code = finiteWeatherNumber(data.weather_code ?? data.code);
  const precipitation = Math.max(0, finiteWeatherNumber(data.precipitation) ?? 0);
  const probability = Math.max(0, finiteWeatherNumber(data.precipitation_probability ?? data.precipProb) ?? 0);
  const local = data.localConsensus || {};
  const modelWetRatio = ratioWeather(local.modelWetRatio);
  const spatialWetRatio = ratioWeather(local.spatialWetRatio);
  const ratios = [modelWetRatio, spatialWetRatio].filter(value => value != null);
  const consensusSupport = ratios.length ? ratios.reduce((sum,value)=>sum+value,0) / ratios.length : null;
  const wetCode = isWetWeatherCode(code);
  const showerCode = [80,81,82].includes(code);
  const strongCode = [63,65,67,81,82,95,96,99].includes(code);
  const localized = local.localized === true ||
    (spatialWetRatio != null && spatialWetRatio <= 0.4) ||
    (modelWetRatio != null && modelWetRatio <= 0.4);
  const meaningfulAmount = precipitation >= (showerCode ? 0.35 : 0.25);
  const supportedProbability = probability >= 70 && (consensusSupport == null || consensusSupport >= 0.5);
  const robust = wetCode && !localized &&
    (meaningfulAmount || supportedProbability || (strongCode && precipitation >= 0.1)) &&
    (consensusSupport == null || consensusSupport >= 0.5);
  return {
    code, wetCode, showerCode, strongCode, localized, robust,
    possible:wetCode && !robust, precipitation, probability,
    modelWetRatio, spatialWetRatio, consensusSupport
  };
}

export function presentationWeatherCode(data = {}) {
  const signal = precipitationSignal(data);
  if (!data.localConsensus || !signal.wetCode || signal.robust || !signal.localized || signal.precipitation >= 0.4) {
    return signal.code;
  }
  const cloud = finiteWeatherNumber(data.cloud_cover);
  return cloud != null && cloud < 65 ? 2 : 3;
}

async function assessLocalTerrain(location) {
  const lat = finiteWeatherNumber(location?.lat);
  const lon = finiteWeatherNumber(location?.lon);
  if (lat == null || lon == null) return null;

  const rings = [6, 12, 25];
  const bearings = [0,45,90,135,180,225,270,315];
  const points = [{lat,lon}, ...rings.flatMap(distanceKm =>
    bearings.map(bearing => destinationPoint(lat, lon, bearing, distanceKm))
  )];
  const elevations = await terrainElevations(points);
  const valid = elevations.map(finiteWeatherNumber).filter(value => value != null);
  if (valid.length < 8) return null;

  const centerElevation = finiteWeatherNumber(elevations[0]) ?? finiteWeatherNumber(location.elevation);
  const elevationRange = Math.max(...valid) - Math.min(...valid);
  const outerElevations = elevations.slice(1 + bearings.length * 2).map(finiteWeatherNumber);
  const nearSeaOuter = outerElevations.filter(value => value != null && value <= 5).length;
  const allNearSea = elevations.slice(1).map(finiteWeatherNumber).filter(value => value != null && value <= 5).length;

  const near = elevations.slice(1,9).map(finiteWeatherNumber).filter(v=>v!=null).sort((a,b)=>a-b);
  const neighborMedian = near.length ? medianWeather(near) : null;
  const valleyDepth = neighborMedian == null || centerElevation == null ? null : Math.max(0, Math.round(neighborMedian-centerElevation));
  const rugged = elevationRange >= 220;
  const coastLike = allNearSea >= 2 || (allNearSea >= 1 && centerElevation != null && centerElevation <= 100);
  const islandLike = nearSeaOuter >= 2;
  const complex = coastLike || islandLike || (rugged && nearSeaOuter >= 1);

  const localPoints = [
    {lat,lon,elevation:centerElevation},
    ...[0,90,180,270].map((bearing,index) => {
      const point = destinationPoint(lat, lon, bearing, 6);
      const elevationIndex = 1 + index * 2;
      return {...point, elevation:finiteWeatherNumber(elevations[elevationIndex])};
    })
  ];

  return {
    complex, rugged, coastLike, islandLike, valleyDepth,
    elevationRange:Math.round(elevationRange), nearSeaOuter, localPoints
  };
}

async function fetchShortRangeModelConsensus(location) {
  const params = new URLSearchParams({
    latitude:String(location.lat),
    longitude:String(location.lon),
    timezone:'auto',
    forecast_days:'4',
    hourly:'precipitation,showers,rain,weather_code,cloud_cover',
    models:SHORT_RANGE_MODELS.join(','),
    precipitation_unit:'mm'
  });
  const elevation = finiteWeatherNumber(location?.elevation);
  if (elevation != null) params.set('elevation', String(Math.round(elevation)));

  const response = await fetchWithRetry(`${FORECAST}?${params}`, {}, 1);
  if (!response.ok) return null;
  const data = await response.json();
  const hourly = data.hourly || {};
  const times = hourly.time || [];
  const suffixes = [...new Set(Object.keys(hourly)
    .filter(key => key.startsWith('weather_code_'))
    .map(key => key.slice('weather_code_'.length))
    .filter(Boolean))];
  if (!times.length || suffixes.length < 2) return null;

  const byTime = {};
  times.forEach((time,i) => {
    const rows = suffixes.map(suffix => {
      const code = finiteWeatherNumber(hourly[`weather_code_${suffix}`]?.[i]);
      const precipitation = finiteWeatherNumber(hourly[`precipitation_${suffix}`]?.[i]);
      const showers = finiteWeatherNumber(hourly[`showers_${suffix}`]?.[i]);
      const cloud = finiteWeatherNumber(hourly[`cloud_cover_${suffix}`]?.[i]);
      if ([code,precipitation,showers,cloud].every(value => value == null)) return null;
      const wet = isWetWeatherCode(code) ||
        (precipitation != null && precipitation >= 0.1) ||
        (showers != null && showers >= 0.1);
      return {
        suffix, code, wet,
        precipitation:precipitation != null ? Math.max(0,precipitation) : 0,
        showers:showers != null ? Math.max(0,showers) : 0,
        cloud:cloud ?? null
      };
    }).filter(Boolean);
    if (!rows.length) return;
    byTime[time] = {
      modelCount:rows.length,
      modelWetRatio:rows.filter(row=>row.wet).length / rows.length,
      modelMedianPrecip:medianWeather(rows.map(row=>row.precipitation)),
      modelMedianCloud:medianWeather(rows.map(row=>row.cloud))
    };
  });
  return {byTime, modelNames:suffixes};
}

async function fetchShortRangeSpatialConsensus(terrain) {
  const points = terrain?.localPoints || [];
  if (points.length < 3) return null;

  const params = new URLSearchParams({
    latitude:points.map(p=>Number(p.lat).toFixed(6)).join(','),
    longitude:points.map(p=>Number(p.lon).toFixed(6)).join(','),
    timezone:'auto',
    forecast_days:'4',
    hourly:'precipitation,showers,weather_code,cloud_cover',
    precipitation_unit:'mm',
    cell_selection:'nearest'
  });
  const elevations = points.map(point => finiteWeatherNumber(point.elevation));
  if (elevations.every(value => value != null)) {
    params.set('elevation', elevations.map(value=>Math.round(value)).join(','));
  }

  const response = await fetchWithRetry(`${FORECAST}?${params}`, {}, 1);
  if (!response.ok) return null;
  const payload = await response.json();
  const locations = Array.isArray(payload) ? payload : [payload];
  if (locations.length < 2) return null;

  const centerTimes = locations[0]?.hourly?.time || [];
  const byTime = {};
  centerTimes.forEach((time,i) => {
    const rows = locations.map(entry => {
      const hourly = entry?.hourly || {};
      const j = hourly.time?.[i] === time ? i : hourly.time?.indexOf(time);
      if (j == null || j < 0) return null;
      const code = finiteWeatherNumber(hourly.weather_code?.[j]);
      const precipitation = finiteWeatherNumber(hourly.precipitation?.[j]);
      const showers = finiteWeatherNumber(hourly.showers?.[j]);
      if ([code,precipitation,showers].every(value => value == null)) return null;
      const wet = isWetWeatherCode(code) ||
        (precipitation != null && precipitation >= 0.1) ||
        (showers != null && showers >= 0.1);
      return {wet, precipitation:precipitation != null ? Math.max(0,precipitation) : 0};
    }).filter(Boolean);
    if (!rows.length) return;
    const precipValues = rows.map(row=>row.precipitation);
    byTime[time] = {
      spatialPointCount:rows.length,
      spatialWetRatio:rows.filter(row=>row.wet).length / rows.length,
      spatialMedianPrecip:medianWeather(precipValues),
      spatialPrecipSpread:precipValues.length ? Math.max(...precipValues)-Math.min(...precipValues) : null
    };
  });
  return {byTime};
}

function mergeLocalConsensus(terrain, models, spatial) {
  if (!terrain?.complex) return null;
  const modelByTime = models?.byTime || {};
  const spatialByTime = spatial?.byTime || {};
  const times = new Set([...Object.keys(modelByTime), ...Object.keys(spatialByTime)]);
  if (!times.size) return null;

  const hourly = {};
  for (const time of times) {
    const m = modelByTime[time] || {};
    const s = spatialByTime[time] || {};
    const modelWetRatio = ratioWeather(m.modelWetRatio);
    const spatialWetRatio = ratioWeather(s.spatialWetRatio);
    const ratios = [modelWetRatio, spatialWetRatio].filter(value => value != null);
    const localized = (spatialWetRatio != null && spatialWetRatio <= 0.4) ||
      (modelWetRatio != null && modelWetRatio <= 0.4);
    const disagreement = ratios.length >= 2 && Math.abs(ratios[0]-ratios[1]) >= 0.35;
    hourly[time] = {...m,...s,modelWetRatio,spatialWetRatio,localized,disagreement};
  }

  return {
    active:true,
    terrain:{
      rugged:terrain.rugged,
      coastLike:terrain.coastLike,
      islandLike:terrain.islandLike,
      elevationRange:terrain.elevationRange
    },
    models:models?.modelNames || [],
    hourly
  };
}

// Full deterministic fusion is optional; outages never prevent the base forecast.
async function fetchSnowFusionModels(location) {
  const params = new URLSearchParams({
    latitude:String(location.lat), longitude:String(location.lon), timezone:'auto', forecast_days:'16',
    hourly:'temperature_2m,precipitation,snowfall,rain',
    models:SNOWFUSION_MODELS.join(','), precipitation_unit:'mm',temperature_unit:'celsius'
  });
  if (finiteWeatherNumber(location.elevation)!=null) params.set('elevation',String(Math.round(location.elevation)));
  const response=await fetchWithRetry(FORECAST+'?'+params,{},1);
  if (!response.ok) return null;
  return response.json();
}

// ECMWF 50+ ensemble members: daily exceedance frequencies, not calibrated probabilities.
async function fetchSnowFusionEnsemble(location) {
  const params = new URLSearchParams({
    latitude:String(location.lat),longitude:String(location.lon),timezone:'auto',forecast_days:'16',
    hourly:'snowfall',models:SNOWFUSION_ENSEMBLE
  });
  if (finiteWeatherNumber(location.elevation)!=null) params.set('elevation',String(Math.round(location.elevation)));
  const response=await fetchWithRetry(ENSEMBLE+'?'+params,{},1);
  if (!response.ok) return null;
  return response.json();
}

export async function getForecast(location) {
  const params = new URLSearchParams({
    latitude:String(location.lat), longitude:String(location.lon), timezone:'auto', forecast_days:'16',
    current:CURRENT_VARS.join(','), hourly:HOURLY_VARS.join(','), daily:DAILY_VARS.join(','),
    wind_speed_unit:'kmh', temperature_unit:'celsius', precipitation_unit:'mm'
  });

  if (isFrance(location) && finiteWeatherNumber(location.elevation)!=null)
    params.set('elevation',String(Math.round(location.elevation)));
  const response = await fetchWithRetry(`${FORECAST}?${params}`, {}, 2);
  if (!response.ok) throw new Error(`Prévisions indisponibles (${response.status})`);
  const data = await response.json();

  const local=isFrance(location);
  const observationPromise=inRhoneArea(location) ? loadRhoneObservations() : Promise.resolve(null);
  const terrainPromise=optionalWithTimeout(assessLocalTerrain(location), 1500, null);
  // Parallel, time-bounded extras keep the old Best Match forecast usable.
  const modelsPromise=local?optionalWithTimeout(fetchSnowFusionModels(location), 3800, null):Promise.resolve(null);
  const ensemblePromise=local?optionalWithTimeout(fetchSnowFusionEnsemble(location), 3800, null):Promise.resolve(null);
  const [terrain, models, ensemble]=await Promise.all([terrainPromise,modelsPromise,ensemblePromise]);
  if (local) {
    try {
      if (!applySnowFusion(data,models,ensemble,terrain)) {
        data.snowFusion={active:false,probabilistic:false,days:{},
          explanation:'Prévision Open-Meteo Best Match : fusion momentanément indisponible.'};
      }
    } catch (err) {
      console.warn('SnowFusion indisponible : prévision de secours conservée',err);
      data.snowFusion={active:false,probabilistic:false,days:{},
        explanation:'Prévision Open-Meteo Best Match : calcul SnowFusion indisponible.'};
    }
  }
  if (terrain?.complex) {
    const [models, spatial] = await Promise.all([
      optionalWithTimeout(fetchShortRangeModelConsensus(location), 1800, null),
      optionalWithTimeout(fetchShortRangeSpatialConsensus(terrain), 1800, null)
    ]);
    data.localConsensus = mergeLocalConsensus(terrain, models, spatial);
  }

  if (inRhoneArea(location)) {
    try {
      const observations=await observationPromise;
      applyRhoneObservations(data,location,observations);
    } catch (err) { console.warn('Observations Rhône indisponibles, modèle standard conservé',err); }
  }
  data.location = { ...location, elevation: data.elevation ?? location.elevation, timezone:data.timezone, timezoneAbbreviation:data.timezone_abbreviation };
  return normalizeForecast(data);
}

export async function getBatchForecast(points, forecastDays = 2) {
  const params = new URLSearchParams({
    latitude:points.map(p=>p.lat).join(','), longitude:points.map(p=>p.lon).join(','), timezone:'auto', forecast_days:String(forecastDays),
    hourly:['temperature_2m','apparent_temperature','precipitation','precipitation_probability','snowfall','weather_code','visibility','wind_speed_10m','wind_direction_10m','wind_gusts_10m','wet_bulb_temperature_2m','freezing_level_height','cape'].join(','),
    wind_speed_unit:'kmh', temperature_unit:'celsius', precipitation_unit:'mm'
  });
  const r = await fetch(`${FORECAST}?${params}`);
  if (!r.ok) throw new Error(`Météo trajet indisponible (${r.status})`);
  const data = await r.json();
  const list = Array.isArray(data) ? data : [data];
  return list.map((x,i)=>({ ...x, routePoint:points[i], elevation:x.elevation ?? points[i].elevation ?? 0 }));
}

export function normalizeForecast(data) {
  const h = data.hourly || {};
  const hourly = (h.time || []).map((time,i) => {
    const obj = { time, elevation:data.elevation ?? data.location?.elevation ?? 0 };
    HOURLY_VARS.forEach(k => obj[k] = h[k]?.[i] ?? null);
    obj.snowLevel = estimateSnowLevel({
      freezingLevel:obj.freezing_level_height, wetBulb:obj.wet_bulb_temperature_2m,
      precipitation:obj.precipitation, elevation:data.elevation ?? 0
    });
    const snow = snowfallFor(obj);
    if (snow.estimated) { obj.snowfall = snow.amount; obj.snowfallEstimated = true; }
    obj.localConsensus = data.localConsensus?.hourly?.[time] ?? null;
    obj.snowpack = data._snowFusionHourly?.[i] ?? null;
    obj.display_weather_code = presentationWeatherCode(obj);
    obj.info = weatherCodeInfo(obj.display_weather_code ?? obj.weather_code, 1);
    return obj;
  });
  const d = data.daily || {};
  const daily = (d.time || []).map((time,i) => ({
    time,
    weather_code:d.weather_code?.[i] ?? null,
    max:d.temperature_2m_max?.[i] ?? null,
    min:d.temperature_2m_min?.[i] ?? null,
    apparentMax:d.apparent_temperature_max?.[i] ?? null,
    apparentMin:d.apparent_temperature_min?.[i] ?? null,
    sunrise:d.sunrise?.[i] ?? null, sunset:d.sunset?.[i] ?? null,
    sunshineDuration:d.sunshine_duration?.[i] ?? null,
    uv:d.uv_index_max?.[i] ?? null,
    precipitation:d.precipitation_sum?.[i] ?? null, rain:d.rain_sum?.[i] ?? null, showers:d.showers_sum?.[i] ?? null,
    snowfall:d.snowfall_sum?.[i] ?? null, precipProb:d.precipitation_probability_max?.[i] ?? null,
    windMax:d.wind_speed_10m_max?.[i] ?? null, gustMax:d.wind_gusts_10m_max?.[i] ?? null, windDir:d.wind_direction_10m_dominant?.[i] ?? null,
    info:weatherCodeInfo(d.weather_code?.[i], 1)
  }));
  daily.forEach(day => {
    const dayHours = hourly.filter(h => h.time.startsWith(day.time));
    day.effectiveSunshineDuration = estimateEffectiveSunshineSeconds(day, dayHours);
    day.snowFusion = data.snowFusion?.days?.[day.time] ?? null;
    if (Number(day.snowfall ?? 0) > 0) return;
    const snowyHours = dayHours.filter(h => Number(h.snowfall) > 0);
    if (!snowyHours.length) return;
    day.snowfall = snowyHours.reduce((sum,h) => sum + Number(h.snowfall), 0);
    day.snowfallEstimated = snowyHours.some(h => h.snowfallEstimated);
  });
  return { ...data, hourly, daily };
}

export function createDemoForecast(location = { name:'Chamonix', admin1:'Haute-Savoie', country:'France', lat:45.9237, lon:6.8694, elevation:1035 }) {
  const now = new Date(); now.setMinutes(0,0,0);
  const hourly = [];
  for (let i=0;i<16*24;i++) {
    const t = new Date(now.getTime()+i*3600000);
    const dayWave = Math.sin(((t.getHours()-8)/24)*Math.PI*2);
    const front = Math.sin(i/15);
    const temp = 1.5 + dayWave*3.3 + front*1.2 - Math.min(i/120,2);
    const snowPhase = i > 14 && i < 29;
    const precip = snowPhase ? Math.max(0, 1.8 + Math.sin(i)*1.1) : (i%37===0 ? .5 : 0);
    const code = snowPhase ? (precip>2 ? 75 : 73) : (precip ? 61 : (t.getHours()>18 || t.getHours()<7 ? 2 : 1));
    const freezing = 1450 + dayWave*350 + front*180;
    const wet = temp - 1.1;
    hourly.push({
      time:t.toISOString().slice(0,16), temperature_2m:temp, relative_humidity_2m:snowPhase?92:72, dew_point_2m:temp-2,
      apparent_temperature:temp-2.4, precipitation_probability:snowPhase?82:18, precipitation:precip, rain:snowPhase?0:precip,
      showers:0, snowfall:snowPhase?precip*.7:0, snow_depth:.18, weather_code:code, cloud_cover:snowPhase?94:35,
      cloud_cover_low:snowPhase?85:24, cloud_cover_mid:snowPhase?75:18, cloud_cover_high:45, visibility:snowPhase?2200:18000,
      wind_speed_10m:18+Math.abs(front)*13, wind_direction_10m:225, wind_gusts_10m:38+Math.abs(front)*24,
      surface_pressure:895, pressure_msl:1018-front*7, uv_index:Math.max(0,2.2*dayWave), cape:snowPhase?40:120,
      wet_bulb_temperature_2m:wet, freezing_level_height:freezing,
      snowLevel:estimateSnowLevel({freezingLevel:freezing, wetBulb:wet, precipitation:precip, elevation:location.elevation}), info:weatherCodeInfo(code,1)
    });
  }
  const daily=[];
  for (let d=0;d<16;d++) {
    const date = new Date(now.getTime()+d*86400000);
    const slice=hourly.slice(d*24,(d+1)*24);
    const temps=slice.map(x=>x.temperature_2m);
    const snow=slice.reduce((a,b)=>a+b.snowfall,0);
    const precip=slice.reduce((a,b)=>a+b.precipitation,0);
    const code=snow>.5?73:(precip>.5?61:(d%4===0?1:2));
    const sunshineDuration = slice.reduce((sum,h) => {
      const hour = Number(h.time.slice(11,13));
      if (hour < 8 || hour >= 17) return sum;
      const cloud = Math.max(0, Math.min(100, Number(h.cloud_cover ?? 100)));
      return sum + 3600 * (1 - cloud/100);
    }, 0);
    daily.push({time:date.toISOString().slice(0,10), weather_code:code, max:Math.max(...temps), min:Math.min(...temps), apparentMax:Math.max(...temps)-2, apparentMin:Math.min(...temps)-3,
      sunrise:`${date.toISOString().slice(0,10)}T08:01`, sunset:`${date.toISOString().slice(0,10)}T16:53`, sunshineDuration, uv:2, precipitation:precip, rain:snow?0:precip, showers:0,
      snowfall:snow, precipProb:snow?84:22, windMax:32, gustMax:61, windDir:225, info:weatherCodeInfo(code,1)});
  }
  const c=hourly[0];
  return {
    location:{...location, timezone:'Europe/Paris'}, elevation:location.elevation, timezone:'Europe/Paris',
    current:{time:c.time,temperature_2m:c.temperature_2m,relative_humidity_2m:c.relative_humidity_2m,apparent_temperature:c.apparent_temperature,is_day:1,
      precipitation:c.precipitation,rain:c.rain,showers:c.showers,snowfall:c.snowfall,weather_code:c.weather_code,cloud_cover:c.cloud_cover,
      pressure_msl:c.pressure_msl,surface_pressure:c.surface_pressure,wind_speed_10m:c.wind_speed_10m,wind_direction_10m:c.wind_direction_10m,wind_gusts_10m:c.wind_gusts_10m},
    hourly,daily, demo:true
  };
}
