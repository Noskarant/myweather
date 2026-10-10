// Météo-France DPPaquetObs v2 (department-wide hourly observations for Rhône and Savoie).
// Runs only in GitHub Actions. Never embeds credentials or logs response bodies.
import {parseCsv, parseMeteoFranceObservation} from './meteo-france-observations.mjs';

const API='https://public-api.meteofrance.fr/public/DPPaquetObs/v2/paquet/horaire';
const DEPARTMENTS={
  '69':{south:45.38,north:46.35,west:4.24,east:5.24},
  '73':{south:45.05,north:46.06,west:5.52,east:7.28},
  '75':{south:48.1,north:49.25,west:1.42,east:3.57},
  '77':{south:48.1,north:49.25,west:1.42,east:3.57},
  '78':{south:48.1,north:49.25,west:1.42,east:3.57},
  '91':{south:48.1,north:49.25,west:1.42,east:3.57},
  '92':{south:48.1,north:49.25,west:1.42,east:3.57},
  '93':{south:48.1,north:49.25,west:1.42,east:3.57},
  '94':{south:48.1,north:49.25,west:1.42,east:3.57},
  '95':{south:48.1,north:49.25,west:1.42,east:3.57},
  '85':{south:46.22,north:47.18,west:-2.55,east:-0.5},
  '974':{south:-21.43,north:-20.85,west:55.18,east:55.89}
};
const MAX_RESPONSE_BYTES=8_000_000;

const safeNumber=value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))
  ?null:Number(value);
const withinDepartmentArea=(lat,lon,department='69')=>{
  const b=DEPARTMENTS[department];
  return Boolean(b)&&lat!==null&&lon!==null&&
    lat>=b.south&&lat<=b.north&&lon>=b.west&&lon<=b.east;
};
function rowsFor(payload){
  if(Array.isArray(payload))return payload;
  if(Array.isArray(payload?.features))return payload.features;
  if(Array.isArray(payload?.data))return payload.data;
  if(Array.isArray(payload?.results))return payload.results;
  if(typeof payload==='string')return parseCsv(payload);
  return [];
}
/**
 * One reading per real station, never one per historical hour.
 * All temperatures are kelvins, as documented by Météo-France.
 * The nearest station and metadata are shared with the existing DPObs collector.
 */
export function parsePackageObservations(payload,now=Date.now(),metadata=[],department='69') {
  const byId=new Map();
  const stationById=new Map(metadata.map(s=>[String(s.id||'').replace(/^mf-/,''),
    {name:s.name,lat:s.lat,lon:s.lon,elevation:s.elevation}]));
  for(const row of rowsFor(payload)){
    const p=row?.properties||row;
    if(!p||typeof p!=='object')continue;
    const code=String(p.geo_id_insee??p.id_station??'');
    if(!/^\d{8}$/.test(code)||!code.startsWith(department))continue;
    const lat=safeNumber(p.lat??row.geometry?.coordinates?.[1]);
    const lon=safeNumber(p.lon??row.geometry?.coordinates?.[0]);
    if(!withinDepartmentArea(lat,lon,department))continue;
    const known=stationById.get(code);
    const station={
      id:code,name:known?.name||'Météo-France '+code,
      lat,lon,elevation:safeNumber(known?.elevation)
    };
    const region=department==='73'?'savoie':department==='85'?'vendee':
      department==='974'?'reunion':['75','77','78','91','92','93','94','95'].includes(department)?'idf':'rhone';
    const reading=parseMeteoFranceObservation(row,station,now,region);
    if(!reading)continue;
    const prev=byId.get(code);
    if(!prev||Date.parse(reading.measuredAt)>Date.parse(prev.measuredAt)){
      byId.set(code,{...reading,observationProduct:'DPPaquetObs v2'});
    }
  }
  return [...byId.values()];
}
export async function collectMeteoFrancePackage(
  apiKey,now=Date.now(),fetcher=fetch,metadata=[],department='69'
){
  if(!DEPARTMENTS[department])return {stations:[],status:'invalid_department',department};
  if(typeof apiKey!=='string'||!apiKey.trim()){
    return {stations:[],status:'not_configured',department};
  }
  const url=API+'?'+new URLSearchParams({'id-departement':department,format:'json'});
  try{
    const response=await fetcher(url,{
      headers:{apikey:apiKey,accept:'application/json'},
      signal:AbortSignal.timeout(16_000)
    });
    if(!response.ok){
      console.warn('Météo-France package API status',response.status);
      return {stations:[],status:response.status===401||response.status===403
        ?'authentication_failed':'api_unavailable',department};
    }
    const size=safeNumber(response.headers?.get?.('content-length'));
    if(size!==null&&size>MAX_RESPONSE_BYTES)
      return {stations:[],status:'response_too_large',department};
    const text=await response.text();
    if(text.length>MAX_RESPONSE_BYTES)
      return {stations:[],status:'response_too_large',department};
    let json;
    try{json=JSON.parse(text);}catch{
      return {stations:[],status:'invalid_json',department};
    }
    const stations=parsePackageObservations(json,now,metadata,department);
    return {stations,department,
      status:stations.length?'ready':'no_fresh_readings',validated:stations.length};
  }catch(error){
    console.warn('Météo-France package API unavailable',error?.name||'error');
    return {stations:[],status:'request_failed',department};
  }
}
