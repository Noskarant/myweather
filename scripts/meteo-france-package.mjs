// Météo-France DPPaquetObs v2 (whole Rhône department hourly observations).
// Runs only in GitHub Actions. Never embeds credentials or logs response bodies.
import {parseCsv, parseMeteoFranceObservation} from './meteo-france-observations.mjs';

const API='https://public-api.meteofrance.fr/public/DPPaquetObs/v2/paquet/horaire';
const DEPARTMENT='69';
const MAX_RESPONSE_BYTES=8_000_000;
const STATION_ID=/^69\d{6}$/;

const safeNumber=value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))
  ?null:Number(value);
const withinRhone=(lat,lon)=>lat!==null&&lon!==null&&
  lat>=45.38&&lat<=46.35&&lon>=4.24&&lon<=5.24;
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
export function parsePackageObservations(payload,now=Date.now(),metadata=[]) {
  const byId=new Map();
  const stationById=new Map(metadata.map(s=>[String(s.id||'').replace(/^mf-/,''),
    {name:s.name,lat:s.lat,lon:s.lon,elevation:s.elevation}]));
  for(const row of rowsFor(payload)){
    const p=row?.properties||row;
    if(!p||typeof p!=='object')continue;
    const code=String(p.geo_id_insee??p.id_station??'');
    if(!STATION_ID.test(code))continue;
    const lat=safeNumber(p.lat??row.geometry?.coordinates?.[1]);
    const lon=safeNumber(p.lon??row.geometry?.coordinates?.[0]);
    if(!withinRhone(lat,lon))continue;
    const known=stationById.get(code);
    const station={
      id:code,name:known?.name||'Météo-France '+code,
      lat,lon,elevation:safeNumber(known?.elevation)
    };
    const reading=parseMeteoFranceObservation(row,station,now);
    if(!reading)continue;
    const prev=byId.get(code);
    if(!prev||Date.parse(reading.measuredAt)>Date.parse(prev.measuredAt)){
      byId.set(code,{...reading,observationProduct:'DPPaquetObs v2'});
    }
  }
  return [...byId.values()];
}
export async function collectMeteoFrancePackage(
  apiKey,now=Date.now(),fetcher=fetch,metadata=[]
){
  if(typeof apiKey!=='string'||!apiKey.trim()){
    return {stations:[],status:'not_configured',department:DEPARTMENT};
  }
  const url=API+'?'+new URLSearchParams({'id-departement':DEPARTMENT,format:'json'});
  try{
    const response=await fetcher(url,{
      headers:{apikey:apiKey,accept:'application/json'},
      signal:AbortSignal.timeout(16_000)
    });
    if(!response.ok){
      console.warn('Météo-France package API status',response.status);
      return {stations:[],status:response.status===401||response.status===403
        ?'authentication_failed':'api_unavailable',department:DEPARTMENT};
    }
    const size=safeNumber(response.headers?.get?.('content-length'));
    if(size!==null&&size>MAX_RESPONSE_BYTES)
      return {stations:[],status:'response_too_large',department:DEPARTMENT};
    const text=await response.text();
    if(text.length>MAX_RESPONSE_BYTES)
      return {stations:[],status:'response_too_large',department:DEPARTMENT};
    let json;
    try{json=JSON.parse(text);}catch{
      return {stations:[],status:'invalid_json',department:DEPARTMENT};
    }
    const stations=parsePackageObservations(json,now,metadata);
    return {stations,department:DEPARTMENT,
      status:stations.length?'ready':'no_fresh_readings',validated:stations.length};
  }catch(error){
    console.warn('Météo-France package API unavailable',error?.name||'error');
    return {stations:[],status:'request_failed',department:DEPARTMENT};
  }
}
