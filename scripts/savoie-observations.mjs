// Authenticated Météo-France Savoie (73) station snapshot for GitHub Pages.
// Reuse the owner's two DPObs / DPPaquetObs secrets, exclusively server-side.
// The Rhône collection stays independent and is never modified here.
import {collectMeteoFranceStations} from './meteo-france-observations.mjs';
import {collectMeteoFrancePackage} from './meteo-france-package.mjs';

const finite=n=>n===null||n===undefined||n===''||!Number.isFinite(Number(n))?null:Number(n);
const MAX_AGE_MS=100*60*1000;
const MAX_STATION_MODEL_RESIDUAL=7;
function fresh(st,now){
  const delta=now-Date.parse(st?.measuredAt||'');
  return Number.isFinite(delta)&&delta>=-5*60_000&&delta<=MAX_AGE_MS &&
    finite(st?.temperature)!==null;
}
async function modelBaseline(stations,now,fetcher){
  const all=[];
  // Request the model *at the physical station altitude* wherever possible;
  // this is particularly important at 1,000–3,000 m in the Alps.
  const known=stations.filter(s=>finite(s.elevation)!==null);
  const unknown=stations.filter(s=>finite(s.elevation)===null);
  for(const group of [known,unknown]){
    for(let i=0;i<group.length;i+=20){
      const batch=group.slice(i,i+20);
      const query=new URLSearchParams({
        latitude:batch.map(s=>s.lat).join(','),
        longitude:batch.map(s=>s.lon).join(','),
        current:'temperature_2m',timezone:'UTC',forecast_days:'1'
      });
      if(group===known) query.set('elevation',batch.map(s=>s.elevation).join(','));
      try{
        const r=await fetcher('https://api.open-meteo.com/v1/forecast?'+query,{
          signal:AbortSignal.timeout(13000),headers:{accept:'application/json'}
        });
        if(!r.ok){console.warn('Savoie co-located model HTTP',r.status);continue;}
        const payload=await r.json();
        const results=Array.isArray(payload)?payload:[payload];
        for(let j=0;j<batch.length;j++){
          const station=batch[j],data=results[j];
          const predicted=finite(data?.current?.temperature_2m);
          const epoch=Date.parse(String(data?.current?.time||'')+'Z');
          const observationTime=Date.parse(station.measuredAt);
          if(predicted===null||!Number.isFinite(epoch)||
            Math.abs(epoch-observationTime)>90*60_000||
            Math.abs(station.temperature-predicted)>MAX_STATION_MODEL_RESIDUAL)continue;
          all.push({...station,modelTemperature:predicted,
            elevation:finite(station.elevation)??finite(data.elevation)});
        }
      }catch(err){console.warn('Savoie model baseline unavailable',err?.name||'request_error');}
    }
  }
  return all;
}
export function mergeOfficialStations(v2=[],packageStations=[]){
  const byId=new Map(v2.map(s=>[s.id,s]));
  for(const station of packageStations){
    const old=byId.get(station.id);
    if(!old||Date.parse(station.measuredAt)>Date.parse(old.measuredAt))
      byId.set(station.id,station);
  }
  return [...byId.values()];
}
export async function collectSavoieObservations(
  now=Date.now(),fetcher=fetch,
  keys={observations:process.env.METEOFRANCE_API_KEY,
    package:process.env.METEOFRANCE_PACKAGE_API_KEY}
){
  const v2=await collectMeteoFranceStations(keys.observations,now,fetcher,'savoie');
  const packet=await collectMeteoFrancePackage(
    keys.package,now,fetcher,v2.catalog||[],'73'
  );
  const official=mergeOfficialStations(v2.stations,packet.stations).filter(s=>fresh(s,now));
  const stations=await modelBaseline(official,now,fetcher);
  return {
    version:1,region:'savoie',generatedAt:new Date(now).toISOString(),
    stations,
    sources:{meteofranceV2:v2.stations.length,meteofrancePackage:packet.stations.length,
      uniqueOfficial:official.length,validated:stations.length},
    checks:{v2:v2.status,package:packet.status,department:'73'},
    note:'Observations réelles de Savoie; correction des seules températures en courte échéance, avec garde-fous de distance, fraîcheur et dénivelé.'
  };
}
