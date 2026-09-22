import { estimateSnowLevel, weatherCodeInfo } from './utils.js';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const ELEVATION = 'https://api.open-meteo.com/v1/elevation';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';

const geocodeCache = new Map();
let lastNominatimRequest = 0;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

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

export async function getForecast(location) {
  const params = new URLSearchParams({
    latitude:String(location.lat), longitude:String(location.lon), timezone:'auto', forecast_days:'16',
    current:CURRENT_VARS.join(','), hourly:HOURLY_VARS.join(','), daily:DAILY_VARS.join(','),
    wind_speed_unit:'kmh', temperature_unit:'celsius', precipitation_unit:'mm'
  });
  const r = await fetch(`${FORECAST}?${params}`);
  if (!r.ok) throw new Error(`Prévisions indisponibles (${r.status})`);
  const data = await r.json();
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
    const obj = { time };
    HOURLY_VARS.forEach(k => obj[k] = h[k]?.[i] ?? null);
    obj.snowLevel = estimateSnowLevel({
      freezingLevel:obj.freezing_level_height, wetBulb:obj.wet_bulb_temperature_2m,
      precipitation:obj.precipitation, elevation:data.elevation ?? 0
    });
    obj.info = weatherCodeInfo(obj.weather_code, 1);
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
    uv:d.uv_index_max?.[i] ?? null,
    precipitation:d.precipitation_sum?.[i] ?? null, rain:d.rain_sum?.[i] ?? null, showers:d.showers_sum?.[i] ?? null,
    snowfall:d.snowfall_sum?.[i] ?? null, precipProb:d.precipitation_probability_max?.[i] ?? null,
    windMax:d.wind_speed_10m_max?.[i] ?? null, gustMax:d.wind_gusts_10m_max?.[i] ?? null, windDir:d.wind_direction_10m_dominant?.[i] ?? null,
    info:weatherCodeInfo(d.weather_code?.[i], 1)
  }));
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
    daily.push({time:date.toISOString().slice(0,10), weather_code:code, max:Math.max(...temps), min:Math.min(...temps), apparentMax:Math.max(...temps)-2, apparentMin:Math.min(...temps)-3,
      sunrise:`${date.toISOString().slice(0,10)}T08:01`, sunset:`${date.toISOString().slice(0,10)}T16:53`, uv:2, precipitation:precip, rain:snow?0:precip, showers:0,
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
