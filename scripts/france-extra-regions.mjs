// Météo-France station observations in Île-de-France (8 departments), Vendée (85),
// and the island of La Réunion (974). Runs server-side in GitHub Actions only.
// Both existing Météo-France secrets remain in Actions, never in published JSON.
import {parseMeteoFranceStationList,collectMeteoFranceStations} from './meteo-france-observations.mjs';
import {collectMeteoFrancePackage} from './meteo-france-package.mjs';
import {mergeOfficialStations} from './savoie-observations.mjs';

export const EXTRA_FRANCE_REGIONS={
  idf:{departments:['75','77','78','91','92','93','94','95'],region:'ile-de-france'},
  vendee:{departments:['85'],region:'vendee'},
  reunion:{departments:['974'],region:'reunion'}
};
const CATALOG_URL='https://public-api.meteofrance.fr/public/DPObs/v2/liste-stations?format=csv';
const MODEL_URL='https://api.open-meteo.com/v1/forecast';
const finite=x=>x===null||x===undefined||x===''||!Number.isFinite(Number(x))?null:Number(x);
const fresh=(s,now)=>{
  const delta=now-Date.parse(s?.measuredAt||'');
  return Number.isFinite(delta)&&delta>=-5*60_000&&delta<=100*60_000;
};
async function getCatalog(key,fetcher){
  if(!key)return null;
  try{
    const r=await fetcher(CATALOG_URL,{headers:{apikey:key,accept:'text/csv, text/plain, */*'},
      signal:AbortSignal.timeout(14000)});
    if(!r.ok){console.warn('Regional Météo-France catalog HTTP',r.status);return null;}
    const body=await r.text();
    return body.length<=4e6?body:null;
  }catch(e){console.warn('Regional catalog temporarily unavailable',e?.name||'error');return null;}
}
async function modelBaselines(stations,now,fetcher,region){
  const valid=[],sized=stations.filter(s=>finite(s.elevation)!==null);
  // Especially on Réunion, an unknown altitude is unsafe in high mountain terrain.
  // For metropolitan stations, missing altitude is also skipped rather than guessed.
  for(let i=0;i<sized.length;i+=18){
    const batch=sized.slice(i,i+18);
    const q=new URLSearchParams({latitude:batch.map(x=>x.lat).join(','),
      longitude:batch.map(x=>x.lon).join(','),
      elevation:batch.map(x=>x.elevation).join(','),
      current:region==='vendee'?'temperature_2m,relative_humidity_2m,wind_speed_10m':'temperature_2m',timezone:'UTC',forecast_days:'1'});
    try{
      const response=await fetcher(MODEL_URL+'?'+q,{headers:{accept:'application/json'},
        signal:AbortSignal.timeout(14000)});
      if(!response.ok){console.warn('Regional model baseline HTTP',region,response.status);continue;}
      const body=await response.json();
      const results=Array.isArray(body)?body:[body];
      for(let j=0;j<batch.length;j++){
        const station=batch[j],point=results[j];
        const model=finite(point?.current?.temperature_2m);
        const time=Date.parse(String(point?.current?.time||'')+'Z');
        if(model===null||!Number.isFinite(time)||Math.abs(now-time)>90*60_000||
          Math.abs(Date.parse(station.measuredAt)-time)>95*60_000||
          Math.abs(station.temperature-model)>7)continue;
        valid.push({...station,modelTemperature:model,
          ...(region==='vendee'?{
            modelHumidity:(()=>{const x=finite(point?.current?.relative_humidity_2m);
              return x!==null&&x>=0&&x<=100?x:null;})(),
            modelWindSpeed:(()=>{const x=finite(point?.current?.wind_speed_10m);
              return x!==null&&x>=0&&x<=160?x:null;})()
          }:{})});
      }
    }catch(e){console.warn('Regional model baseline unavailable',region,e?.name||'error');}
  }
  return valid;
}
export async function collectExtraFranceRegions(now=Date.now(),fetcher=fetch,
  keys={observations:process.env.METEOFRANCE_API_KEY,
    package:process.env.METEOFRANCE_PACKAGE_API_KEY}){
  const catalog=await getCatalog(keys.observations,fetcher);
  const responses=new Map();
  // Sequential packages avoid exceeding the Package API's lower per-minute quota.
  for(const [key,config] of Object.entries(EXTRA_FRANCE_REGIONS)){
    const metadata=catalog?parseMeteoFranceStationList(catalog,key):[];
    const datasets=[];
    const checks={};
    for(const department of config.departments){
      const response=await collectMeteoFrancePackage(
        keys.package,now,fetcher,metadata,department);
      checks[department]=response.status;
      datasets.push(...response.stations);
    }
    // Only if *none* of a region's packages worked, obtain a small sample of
    // DPObs v2 stations using the already-fetched catalog (no new account).
    let v2={stations:[],status:'not_needed'};
    if(!datasets.length&&catalog){
      v2=await collectMeteoFranceStations(
        keys.observations,now,fetcher,key,{catalog,limit:10});
    }
    const official=mergeOfficialStations(v2.stations,datasets)
      .filter(s=>fresh(s,now)&&finite(s.temperature)!==null&&finite(s.elevation)!==null);
    const stations=await modelBaselines(official,now,fetcher,key);
    responses.set(key,{
      version:1,region:config.region,generatedAt:new Date(now).toISOString(),stations,
      sources:{package:datasets.length,v2:v2.stations.length,
        uniqueOfficial:official.length,validated:stations.length},
      checks:{departments:checks,v2:v2.status,catalog:catalog?'ready':'unavailable'},
      note:'Températures officielles Météo-France comparées au modèle à altitude équivalente; les observations périmées, sans altitude ou incohérentes ne sont pas utilisées.'
    });
  }
  return Object.fromEntries(responses);
}
