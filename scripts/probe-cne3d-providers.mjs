// Live provider integration check for the 3D CNE preview.
// Intentional real requests; never fake or replace absent snow depth data.
import { CNE_ZONES,cneGrid } from '../js/cne3d-model.js';

const timeout=20000;
async function load(url) {
  const response=await fetch(url,{signal:AbortSignal.timeout(timeout),headers:{accept:'application/json, text/javascript, */*'}});
  if (!response.ok) throw new Error('HTTP '+response.status+' for '+url.split('?')[0]);
  return response;
}
const js='https://cdn.jsdelivr.net/npm/maplibre-gl@5.6.1/dist/maplibre-gl.js';
const jsResponse=await load(js);
console.log('MapLibre GL CDN',jsResponse.status,jsResponse.headers.get('content-type'));
if (!/javascript/.test(jsResponse.headers.get('content-type')||'')) throw new Error('MapLibre CDN returned non-JavaScript');
for (const [key,zone] of Object.entries(CNE_ZONES)) {
  const grid=cneGrid(zone.bounds,5);
  const params=new URLSearchParams({
    latitude:grid.map(p=>p.lat.toFixed(5)).join(','),
    longitude:grid.map(p=>p.lon.toFixed(5)).join(','),
    hourly:'temperature_2m,snow_depth,snowfall,freezing_level_height',
    forecast_days:'7',
    timezone:'Europe/Paris',
    models:'best_match'
  });
  const url='https://api.open-meteo.com/v1/forecast?'+params.toString();
  const response=await load(url);
  const data=await response.json();
  if (data.error) throw new Error(key+': '+data.reason);
  const rows=Array.isArray(data)?data:[data];
  if (rows.length!==grid.length)throw new Error(key+': got '+rows.length+' locations instead of '+grid.length);
  const required=['time','temperature_2m','snow_depth','snowfall','freezing_level_height'];
  for(const keyName of required){
    if(!rows.every(row=>Array.isArray(row?.hourly?.[keyName]))) {
      throw new Error(key+': missing hourly field '+keyName);
    }
  }
  console.log(key,':',rows.length,'model points,',rows[0].hourly.time.length,'hours; first snow_depth',rows[0].hourly.snow_depth[0]);
}
console.log('3D CNE: actual CDN + Open-Meteo forecast queries OK');
